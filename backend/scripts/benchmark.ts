import { MongoClient } from 'mongodb';
import * as dotenv from 'dotenv';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { createLogger } from '../src/logger';

dotenv.config();
const logger = createLogger('benchmark.ts');

type BenchmarkResult = {
  label: string;
  durationMs: number;
  docsExamined?: number;
  keysExamined?: number;
  indexUsed?: string | null;
  error?: string;
};

const MAX_TIME_MS = Number(process.env.BENCH_MAX_MS || 15000);
const SKIP_EXPLAIN = process.env.BENCH_SKIP_EXPLAIN === '1';
const BASELINE_HINT_NATURAL = process.env.BENCH_BASELINE_NATURAL !== '0';

type IndexDef = { name: string; key: Record<string, unknown> };
type IndexHealth = {
  name: string;
  status: 'ok' | 'missing' | 'mismatch' | 'different_name';
  existingName?: string;
};

const EXPECTED_INDEXES: IndexDef[] = [
  { name: 'idx_claims_serviceDate_id', key: { serviceDate: -1, _id: -1 } },
  { name: 'idx_claims_status_amount', key: { status: 1, totalAmount: -1 } },
  { name: 'idx_claims_region_specialty', key: { memberRegion: 1, providerSpecialty: 1 } },
  { name: 'idx_claims_text', key: { searchText: 'text' } },
];

const sameKey = (a: Record<string, unknown>, b: Record<string, unknown>) => {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  return aKeys.every((key) => bKeys.includes(key) && String(a[key]) === String(b[key]));
};

async function runFind(
  collection: any,
  label: string,
  filter: any,
  sort: any,
  options: { hint?: Record<string, number> } = {}
) {
  // eslint-disable-next-line no-console
  logger.info(`Running query: ${label}`);
  const start = Date.now();
  let durationMs = 0;
  try {
    let cursor = collection.find(filter).sort(sort).limit(100).maxTimeMS(MAX_TIME_MS);
    if (options.hint) {
      cursor = cursor.hint(options.hint);
    }
    await cursor.toArray();
    durationMs = Date.now() - start;
  } catch (error) {
    durationMs = Date.now() - start;
    // eslint-disable-next-line no-console
    logger.warn(`Query failed for ${label}: ${(error as Error).message}`);
    return { label, durationMs, error: (error as Error).message } as BenchmarkResult;
  }

  if (SKIP_EXPLAIN) {
    return { label, durationMs } as BenchmarkResult;
  }

  let stats: any = {};
  let indexUsed: string | null = null;
  try {
    // eslint-disable-next-line no-console
    logger.info(`Explaining query: ${label}`);
    let explainCursor = collection
      .find(filter)
      .sort(sort)
      .limit(100)
      .maxTimeMS(MAX_TIME_MS);
    if (options.hint) {
      explainCursor = explainCursor.hint(options.hint);
    }
    const explain = await explainCursor.explain('executionStats');
    stats = explain.executionStats || {};
    const winningPlan = explain.queryPlanner?.winningPlan;
    indexUsed = winningPlan?.inputStage?.indexName || null;
  } catch (error) {
    // eslint-disable-next-line no-console
    logger.warn(`Explain failed for ${label}: ${(error as Error).message}`);
  }

  return {
    label,
    durationMs,
    docsExamined: stats.totalDocsExamined,
    keysExamined: stats.totalKeysExamined,
    indexUsed,
  } as BenchmarkResult;
}

async function runAggregate(
  collection: any,
  label: string,
  pipeline: any[],
  options: { hint?: Record<string, number> } = {}
) {
  // eslint-disable-next-line no-console
  logger.info(`Running aggregation: ${label}`);
  const start = Date.now();
  let durationMs = 0;
  let usedHint = Boolean(options.hint);
  try {
    const cursor = collection.aggregate(pipeline, options.hint ? { hint: options.hint } : undefined);
    await cursor.maxTimeMS(MAX_TIME_MS).toArray();
    durationMs = Date.now() - start;
  } catch (error) {
    if (options.hint) {
      // eslint-disable-next-line no-console
      logger.warn(`Aggregation failed with hint for ${label}, retrying without hint.`);
      usedHint = false;
      try {
        const cursor = collection.aggregate(pipeline);
        await cursor.maxTimeMS(MAX_TIME_MS).toArray();
        durationMs = Date.now() - start;
      } catch (retryError) {
        durationMs = Date.now() - start;
        // eslint-disable-next-line no-console
        logger.warn(`Aggregation failed for ${label}: ${(retryError as Error).message}`);
        return { label, durationMs, error: (retryError as Error).message } as BenchmarkResult;
      }
    } else {
      durationMs = Date.now() - start;
      // eslint-disable-next-line no-console
      logger.warn(`Aggregation failed for ${label}: ${(error as Error).message}`);
      return { label, durationMs, error: (error as Error).message } as BenchmarkResult;
    }
  }

  if (SKIP_EXPLAIN) {
    return { label, durationMs } as BenchmarkResult;
  }

  let stats: any = {};
  try {
    // eslint-disable-next-line no-console
    logger.info(`Explaining aggregation: ${label}`);
    const explainCursor = collection.aggregate(pipeline, usedHint && options.hint ? { hint: options.hint } : undefined);
    const explain = await explainCursor.maxTimeMS(MAX_TIME_MS).explain('executionStats');
    stats = explain.executionStats || {};
  } catch (error) {
    // eslint-disable-next-line no-console
    logger.warn(`Explain failed for ${label}: ${(error as Error).message}`);
  }

  return {
    label,
    durationMs,
    docsExamined: stats.totalDocsExamined,
    keysExamined: stats.totalKeysExamined,
    indexUsed: null,
  } as BenchmarkResult;
}

async function ensureIndexes(collection: any) {
  // eslint-disable-next-line no-console
  logger.info('Ensuring optimization indexes...');
  const existing = await collection.indexes();
  const health: IndexHealth[] = [];

  for (const def of EXPECTED_INDEXES) {
    const byName = existing.find((idx: any) => idx.name === def.name);
    const byKey = existing.find((idx: any) => sameKey(idx.key || {}, def.key));
    if (byName && sameKey(byName.key || {}, def.key)) {
      health.push({ name: def.name, status: 'ok' });
      continue;
    }
    if (byName && !sameKey(byName.key || {}, def.key)) {
      // eslint-disable-next-line no-console
      logger.warn(`[bench] ${def.name} exists but has a different key (stale).`);
      health.push({ name: def.name, status: 'mismatch' });
      continue;
    }
    if (byKey && byKey.name && byKey.name !== def.name) {
      // eslint-disable-next-line no-console
      logger.warn(`[bench] ${def.name} exists under a different name (${byKey.name}).`);
      health.push({ name: def.name, status: 'different_name', existingName: byKey.name });
      continue;
    }

    // eslint-disable-next-line no-console
    logger.info(`[bench] creating ${def.name}`);
    await collection.createIndex(def.key, { name: def.name });
    health.push({ name: def.name, status: 'ok' });
  }

  return health;
}

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
  const dbName = process.env.MONGODB_DB || 'health_claims';

  // eslint-disable-next-line no-console
  logger.info(`Connecting to ${uri}/${dbName}...`);
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const collection = db.collection('claims');
  // eslint-disable-next-line no-console
  logger.info('Connected. Starting benchmark...');

  const baselineHint = BASELINE_HINT_NATURAL ? { $natural: 1 } : undefined;
  const countStart = await collection.estimatedDocumentCount();
  const indexesBefore = await collection.indexes();

  const searchLabel = 'Member/provider search';
  const baselineQueries = [
    () => runFind(collection, 'Recent claims by status', { status: 'submitted' }, { serviceDate: -1 }, { hint: baselineHint }),
    () => runFind(collection, 'High amount claims', { totalAmount: { $gte: 5000 } }, { totalAmount: -1 }, { hint: baselineHint }),
    () => runFind(collection, 'Region + specialty', { memberRegion: 'South', providerSpecialty: 'Cardiology' }, { serviceDate: -1 }, { hint: baselineHint }),
    () => runFind(collection, searchLabel, { searchText: { $regex: 'Provider 10 99213', $options: 'i' } }, { serviceDate: -1 }, { hint: baselineHint }),
    () => runAggregate(collection, 'Top procedures', [
      { $unwind: '$procedureCodes' },
      { $group: { _id: '$procedureCodes', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ], { hint: baselineHint }),
  ];

  // eslint-disable-next-line no-console
  logger.info('Running baseline queries...');
  const baselineResults: BenchmarkResult[] = [];
  for (const run of baselineQueries) {
    baselineResults.push(await run());
  }

  // eslint-disable-next-line no-console
  logger.info('Baseline complete. Applying indexes and re-running...');
  const indexHealth = await ensureIndexes(collection);

  const optimizedQueries = [
    () => runFind(collection, 'Recent claims by status', { status: 'submitted' }, { serviceDate: -1 }),
    () => runFind(collection, 'High amount claims', { totalAmount: { $gte: 5000 } }, { totalAmount: -1 }),
    () => runFind(collection, 'Region + specialty', { memberRegion: 'South', providerSpecialty: 'Cardiology' }, { serviceDate: -1 }),
    () => runFind(collection, searchLabel, { $text: { $search: 'Provider 10 99213' } }, { serviceDate: -1 }),
    () => runAggregate(collection, 'Top procedures', [
      { $unwind: '$procedureCodes' },
      { $group: { _id: '$procedureCodes', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]),
  ];

  const optimizedResults: BenchmarkResult[] = [];
  for (const run of optimizedQueries) {
    optimizedResults.push(await run());
  }

  const countEnd = await collection.estimatedDocumentCount();
  const indexesAfter = await collection.indexes();
  const warnings: string[] = [];
  if (countStart !== countEnd) {
    warnings.push(`claims count changed during benchmark (${countStart} → ${countEnd})`);
  }
  if (process.env.CLAIM_INSERT_ENABLED === '1') {
    warnings.push('CLAIM_INSERT_ENABLED=1 may cause changing data during benchmark');
  }

  const slowQueries = baselineResults.map((result, index) => {
    const optimized = optimizedResults[index];
    return {
      label: result.label,
      baselineMs: result.durationMs,
      optimizedMs: optimized.durationMs,
      improvement: Number((result.durationMs / Math.max(1, optimized.durationMs)).toFixed(2)),
      docsExamined: result.docsExamined,
      keysExamined: result.keysExamined,
      indexUsed: optimized.indexUsed,
    };
  });

  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      database: dbName,
      benchMaxMs: MAX_TIME_MS,
      baselineHint: BASELINE_HINT_NATURAL ? 'natural' : 'none',
      claimsCountStart: countStart,
      claimsCountEnd: countEnd,
      claimsDelta: countEnd - countStart,
      warnings,
      indexHealth,
      indexesBefore: indexesBefore.map((idx: any) => ({ name: idx.name, key: idx.key })),
      indexesAfter: indexesAfter.map((idx: any) => ({ name: idx.name, key: idx.key })),
    },
    baselineResults,
    optimizedResults,
    slowQueries,
    actions: [
      'Add compound indexes for high-selectivity filters (memberId + serviceDate).',
      'Use text index for keyword search across member/provider fields.',
      'Avoid full collection scans by limiting aggregation stages and projecting needed fields.',
    ],
  };

  // eslint-disable-next-line no-console
  logger.info('Writing report...');
  await mkdir(join(process.cwd(), 'reports'), { recursive: true });
  await writeFile(join(process.cwd(), 'reports', 'last-report.json'), JSON.stringify(report, null, 2));

  // eslint-disable-next-line no-console
  logger.info('Benchmark complete. Report written to reports/last-report.json');
  await client.close();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  logger.error(error);
  process.exit(1);
});
