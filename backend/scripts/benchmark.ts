import { MongoClient } from 'mongodb';
import * as dotenv from 'dotenv';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

dotenv.config();

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

async function runFind(collection: any, label: string, filter: any, sort: any) {
  // eslint-disable-next-line no-console
  console.log(`Running query: ${label}`);
  const start = Date.now();
  let durationMs = 0;
  try {
    await collection.find(filter).sort(sort).limit(100).maxTimeMS(MAX_TIME_MS).toArray();
    durationMs = Date.now() - start;
  } catch (error) {
    durationMs = Date.now() - start;
    // eslint-disable-next-line no-console
    console.warn(`Query failed for ${label}: ${(error as Error).message}`);
    return { label, durationMs, error: (error as Error).message } as BenchmarkResult;
  }

  if (SKIP_EXPLAIN) {
    return { label, durationMs } as BenchmarkResult;
  }

  let stats: any = {};
  let indexUsed: string | null = null;
  try {
    // eslint-disable-next-line no-console
    console.log(`Explaining query: ${label}`);
    const explain = await collection
      .find(filter)
      .sort(sort)
      .limit(100)
      .maxTimeMS(MAX_TIME_MS)
      .explain('executionStats');
    stats = explain.executionStats || {};
    const winningPlan = explain.queryPlanner?.winningPlan;
    indexUsed = winningPlan?.inputStage?.indexName || null;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`Explain failed for ${label}: ${(error as Error).message}`);
  }

  return {
    label,
    durationMs,
    docsExamined: stats.totalDocsExamined,
    keysExamined: stats.totalKeysExamined,
    indexUsed,
  } as BenchmarkResult;
}

async function runAggregate(collection: any, label: string, pipeline: any[]) {
  // eslint-disable-next-line no-console
  console.log(`Running aggregation: ${label}`);
  const start = Date.now();
  let durationMs = 0;
  try {
    await collection.aggregate(pipeline).maxTimeMS(MAX_TIME_MS).toArray();
    durationMs = Date.now() - start;
  } catch (error) {
    durationMs = Date.now() - start;
    // eslint-disable-next-line no-console
    console.warn(`Aggregation failed for ${label}: ${(error as Error).message}`);
    return { label, durationMs, error: (error as Error).message } as BenchmarkResult;
  }

  if (SKIP_EXPLAIN) {
    return { label, durationMs } as BenchmarkResult;
  }

  let stats: any = {};
  try {
    // eslint-disable-next-line no-console
    console.log(`Explaining aggregation: ${label}`);
    const explain = await collection.aggregate(pipeline).maxTimeMS(MAX_TIME_MS).explain('executionStats');
    stats = explain.executionStats || {};
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`Explain failed for ${label}: ${(error as Error).message}`);
  }

  return {
    label,
    durationMs,
    docsExamined: stats.totalDocsExamined,
    keysExamined: stats.totalKeysExamined,
    indexUsed: null,
  } as BenchmarkResult;
}

async function ensureTextIndex(collection: any) {
  // eslint-disable-next-line no-console
  console.log('Ensuring text index exists...');
  await collection.createIndex({ searchText: 'text' });
}

async function applyIndexes(collection: any) {
  // eslint-disable-next-line no-console
  console.log('Applying optimization indexes...');
  await Promise.all([
    collection.createIndex({ memberId: 1, serviceDate: -1 }),
    collection.createIndex({ providerId: 1, serviceDate: -1 }),
    collection.createIndex({ status: 1, totalAmount: -1 }),
    collection.createIndex({ memberRegion: 1, providerSpecialty: 1 }),
    collection.createIndex({ serviceDate: -1 }),
  ]);
  await ensureTextIndex(collection);
}

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
  const dbName = process.env.MONGODB_DB || 'health_claims';

  // eslint-disable-next-line no-console
  console.log(`Connecting to ${uri}/${dbName}...`);
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const collection = db.collection('claims');
  // eslint-disable-next-line no-console
  console.log('Connected. Starting benchmark...');

  const searchLabel = 'Member/provider search';
  const baselineQueries = [
    () => runFind(collection, 'Recent claims by status', { status: 'submitted' }, { serviceDate: -1 }),
    () => runFind(collection, 'High amount claims', { totalAmount: { $gte: 5000 } }, { totalAmount: -1 }),
    () => runFind(collection, 'Region + specialty', { memberRegion: 'South', providerSpecialty: 'Cardiology' }, { serviceDate: -1 }),
    () => runFind(collection, searchLabel, { searchText: { $regex: 'Provider 10 99213', $options: 'i' } }, { serviceDate: -1 }),
    () => runAggregate(collection, 'Top procedures', [
      { $unwind: '$procedureCodes' },
      { $group: { _id: '$procedureCodes', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]),
  ];

  // eslint-disable-next-line no-console
  console.log('Running baseline queries...');
  const baselineResults: BenchmarkResult[] = [];
  for (const run of baselineQueries) {
    baselineResults.push(await run());
  }

  // eslint-disable-next-line no-console
  console.log('Baseline complete. Applying indexes and re-running...');
  await applyIndexes(collection);

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
  console.log('Writing report...');
  await mkdir(join(process.cwd(), 'reports'), { recursive: true });
  await writeFile(join(process.cwd(), 'reports', 'last-report.json'), JSON.stringify(report, null, 2));

  // eslint-disable-next-line no-console
  console.log('Benchmark complete. Report written to reports/last-report.json');
  await client.close();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
