import { createReadStream, existsSync } from 'fs';
import { join } from 'path';
import { MongoClient, ObjectId } from 'mongodb';
import * as readline from 'readline';
import * as dotenv from 'dotenv';
import { createLogger } from '../src/logger';

dotenv.config();
const logger = createLogger('seed-load.ts');

const DEFAULT_OUT_DIR = 'seed-data';
const DEFAULT_CONCURRENCY = 4;
const BATCH_SIZE = 1000;

function parseArg(prefix: string) {
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

async function loadFile(collection: any, filePath: string, transform?: (doc: any) => any) {
  const fileStream = createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let batch: Array<{ insertOne: { document: Record<string, unknown> } }> = [];
  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }
    const doc = JSON.parse(line);
    const finalDoc = transform ? transform(doc) : doc;
    batch.push({ insertOne: { document: finalDoc } });
    if (batch.length >= BATCH_SIZE) {
      await collection.bulkWrite(batch, { ordered: false });
      batch = [];
    }
  }
  if (batch.length > 0) {
    await collection.bulkWrite(batch, { ordered: false });
  }
}

function toObjectId(value: string) {
  return ObjectId.isValid(value) ? new ObjectId(value) : value;
}

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  const queue = [...items];
  const workers = Array.from({ length: limit }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item !== undefined) {
        await worker(item);
      }
    }
  });
  await Promise.all(workers);
}

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
  const dbName = process.env.MONGODB_DB || 'health_claims';
  const outDir = parseArg('--out=') || DEFAULT_OUT_DIR;
  const reset = process.argv.includes('--reset');
  const concurrency = Number(parseArg('--concurrency=') || process.env.SEED_CONCURRENCY || DEFAULT_CONCURRENCY);

  if (!existsSync(outDir)) {
    throw new Error(`Seed directory not found: ${outDir}`);
  }

  const client = new MongoClient(uri, { maxPoolSize: Math.max(10, concurrency * 2) });
  await client.connect();
  const db = client.db(dbName);

  if (reset) {
    await Promise.all([
      db.collection('members').drop().catch(() => undefined),
      db.collection('providers').drop().catch(() => undefined),
      db.collection('claims').drop().catch(() => undefined),
      db.collection('payments').drop().catch(() => undefined),
      db.collection('procedures').drop().catch(() => undefined),
      db.collection('diagnoses').drop().catch(() => undefined),
    ]);
  }

  const membersPath = join(outDir, 'members.ndjson');
  const providersPath = join(outDir, 'providers.ndjson');
  const proceduresPath = join(outDir, 'procedures.ndjson');
  const diagnosesPath = join(outDir, 'diagnoses.ndjson');

  logger.info('Loading members...');
  await loadFile(db.collection('members'), membersPath, (doc) => ({
    ...doc,
    _id: toObjectId(doc._id),
    dob: doc.dob ? new Date(doc.dob) : null,
  }));

  logger.info('Loading providers...');
  await loadFile(db.collection('providers'), providersPath, (doc) => ({
    ...doc,
    _id: toObjectId(doc._id),
  }));

  logger.info('Loading procedures...');
  await loadFile(db.collection('procedures'), proceduresPath);

  logger.info('Loading diagnoses...');
  await loadFile(db.collection('diagnoses'), diagnosesPath);

  const claimsFiles = Array.from({ length: 9999 })
    .map((_, index) => join(outDir, `claims-${String(index + 1).padStart(4, '0')}.ndjson`))
    .filter((path) => existsSync(path));

  const paymentsFiles = Array.from({ length: 9999 })
    .map((_, index) => join(outDir, `payments-${String(index + 1).padStart(4, '0')}.ndjson`))
    .filter((path) => existsSync(path));

  logger.info(`Loading ${claimsFiles.length} claim files...`);
  await runWithConcurrency(claimsFiles, concurrency, async (filePath) => {
    await loadFile(db.collection('claims'), filePath, (doc) => ({
      ...doc,
      _id: toObjectId(doc._id),
      memberId: toObjectId(doc.memberId),
      providerId: toObjectId(doc.providerId),
      serviceDate: doc.serviceDate ? new Date(doc.serviceDate) : null,
    }));
  });

  logger.info(`Loading ${paymentsFiles.length} payment files...`);
  await runWithConcurrency(paymentsFiles, concurrency, async (filePath) => {
    await loadFile(db.collection('payments'), filePath, (doc) => ({
      ...doc,
      claimId: toObjectId(doc.claimId),
      paidDate: doc.paidDate ? new Date(doc.paidDate) : null,
    }));
  });

  logger.info('Load complete');
  await client.close();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  logger.error(error);
  process.exit(1);
});
