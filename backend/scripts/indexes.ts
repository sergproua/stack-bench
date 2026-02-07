import { MongoClient, IndexSpecification } from 'mongodb';
import * as dotenv from 'dotenv';
import { createLogger } from '../src/logger';

dotenv.config();
const logger = createLogger('indexes.ts');

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
  const dbName = process.env.MONGODB_DB || 'health_claims';
  const memoryLimitMb = Number(process.env.INDEX_BUILD_MEM_MB || 1024);
  const rebuild = process.argv.includes('--rebuild');
  const abortInProgress = process.argv.includes('--abort-in-progress');
  const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
  const onlyList = onlyArg ? onlyArg.replace('--only=', '').split(',').map((item) => item.trim()).filter(Boolean) : null;

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const adminDb = db.admin();
  logger.info(`[indexes] connected to ${uri}/${dbName} (collection=claims)`);

  let memoryLimitApplied = false;
  try {
    await adminDb.command({ setParameter: 1, maxIndexBuildMemoryUsageMegabytes: memoryLimitMb });
    memoryLimitApplied = true;
    // eslint-disable-next-line no-console
    logger.info(`[indexes] set maxIndexBuildMemoryUsageMegabytes=${memoryLimitMb}`);
  } catch (error) {
    // eslint-disable-next-line no-console
    logger.warn(`[indexes] unable to set index build memory limit: ${(error as Error).message}`);
  }

  const sameKey = (a: Record<string, unknown>, b: Record<string, unknown>) => {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) {
      return false;
    }
    return aKeys.every((key) => bKeys.includes(key) && String(a[key]) === String(b[key]));
  };

  const buildIndex = async (name: string, key: IndexSpecification) => {
    // eslint-disable-next-line no-console
    logger.info(`[indexes] starting ${name}`);
    const start = Date.now();
    if (abortInProgress) {
      try {
        const currentOps = await adminDb.command({ currentOp: 1, $all: true });
        const inProgress = (currentOps.inprog || [])
          .filter((op: any) => op?.desc === 'IndexBuildsCoordinator' || String(op?.msg || '').includes('Index Build'))
          .filter((op: any) => {
            const ns = op?.ns || op?.command?.createIndexes;
            return ns && String(ns).includes('claims');
          });
        for (const op of inProgress) {
          if (op.opid) {
            // eslint-disable-next-line no-console
            logger.warn(`[indexes] aborting in-progress index build (opid=${op.opid})`);
            await adminDb.command({ killOp: 1, op: op.opid });
          }
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        logger.warn(`[indexes] unable to abort in-progress index builds: ${(error as Error).message}`);
      }
    }
    const existing = await db.collection('claims').indexes();
    const byName = existing.find((idx) => idx.name === name);
    const byKey = existing.find((idx) => sameKey(idx.key as Record<string, unknown>, key as Record<string, unknown>));

    if (byName && !sameKey(byName.key as Record<string, unknown>, key as Record<string, unknown>)) {
      // eslint-disable-next-line no-console
      logger.warn(`[indexes] ${name} exists but key differs. Rebuilding to avoid stale definition.`);
      try {
        await db.collection('claims').dropIndex(name);
      } catch (error) {
        const message = (error as Error).message || '';
        if (message.includes('unfinished index') || message.includes('IndexNotFound')) {
          // eslint-disable-next-line no-console
          logger.warn(`[indexes] unable to drop ${name} (still building). Skipping rebuild.`);
          return;
        }
        throw error;
      }
    } else if (byKey && byKey.name) {
      if (rebuild && byKey.name !== name) {
        // eslint-disable-next-line no-console
        logger.info(`[indexes] dropping existing ${byKey.name} to rebuild ${name}`);
        try {
          await db.collection('claims').dropIndex(byKey.name);
        } catch (error) {
          const message = (error as Error).message || '';
          if (message.includes('unfinished index') || message.includes('IndexNotFound')) {
            // eslint-disable-next-line no-console
            logger.warn(`[indexes] unable to drop ${byKey.name} (still building). Skipping rebuild.`);
            return;
          }
          throw error;
        }
      } else {
        // eslint-disable-next-line no-console
        logger.info(`[indexes] skipping ${name} (already exists as ${byKey.name})`);
        return;
      }
    }
    try {
      const createdName = await db.collection('claims').createIndex(key, { name });
      logger.info(`[indexes] createIndex result: ${createdName}`);
    } catch (error) {
      const message = (error as Error).message || '';
      if (message.includes('IndexOptionsConflict') || message.includes('already exists with a different name')) {
        // eslint-disable-next-line no-console
        logger.warn(`[indexes] ${name} already exists with a different name. Skipping.`);
        return;
      }
      throw error;
    }
    const durationMs = Date.now() - start;
    // eslint-disable-next-line no-console
    logger.info(`[indexes] finished ${name} in ${durationMs} ms`);
  };

  const indexQueue: Array<{ key: IndexSpecification; name: string; tag: string }> = [
    { name: 'idx_claims_serviceDate_id', key: { serviceDate: -1, _id: -1 }, tag: 'serviceDate' },
    { name: 'idx_claims_status_amount', key: { status: 1, totalAmount: -1 }, tag: 'status' },
    { name: 'idx_claims_region_specialty', key: { memberRegion: 1, providerSpecialty: 1 }, tag: 'region' },
    { name: 'idx_claims_text', key: { searchText: 'text' }, tag: 'text' },
  ];

  const selected = onlyList
    ? indexQueue.filter((idx) => onlyList.includes(idx.tag))
    : indexQueue;

  for (const idx of selected) {
    await buildIndex(idx.name, idx.key);
  }

  try {
    const finalIndexes = await db.collection('claims').indexes();
    const missing = selected.filter((idx) => {
      return !finalIndexes.some((existing) =>
        sameKey(existing.key as Record<string, unknown>, idx.key as Record<string, unknown>));
    });
    if (missing.length > 0) {
      logger.warn(`[indexes] missing indexes after build: ${missing.map((idx) => idx.name).join(', ')}`);
      process.exitCode = 1;
    }
  } catch {
    // ignore
  }

  if (memoryLimitApplied) {
    try {
      await adminDb.command({ setParameter: 1, maxIndexBuildMemoryUsageMegabytes: 200 });
      // eslint-disable-next-line no-console
      logger.info('[indexes] restored maxIndexBuildMemoryUsageMegabytes=200');
    } catch {
      // ignore
    }
  }

  try {
    const indexNames = (await db.collection('claims').indexes()).map((idx) => idx.name);
    logger.info(`[indexes] current indexes: ${indexNames.join(', ')}`);
  } catch {
    // ignore
  }

  // eslint-disable-next-line no-console
  logger.info('[indexes] all indexes created.');
  await client.close();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  logger.error(error);
  process.exit(1);
});
