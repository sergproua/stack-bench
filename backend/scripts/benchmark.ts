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
};

async function runFind(collection: any, label: string, filter: any, sort: any) {
  const start = Date.now();
  await collection.find(filter).sort(sort).limit(100).toArray();
  const durationMs = Date.now() - start;

  const explain = await collection.find(filter).sort(sort).limit(100).explain('executionStats');
  const stats = explain.executionStats || {};
  const winningPlan = explain.queryPlanner?.winningPlan;
  const indexUsed = winningPlan?.inputStage?.indexName || null;

  return {
    label,
    durationMs,
    docsExamined: stats.totalDocsExamined,
    keysExamined: stats.totalKeysExamined,
    indexUsed,
  } as BenchmarkResult;
}

async function runAggregate(collection: any, label: string, pipeline: any[]) {
  const start = Date.now();
  await collection.aggregate(pipeline).toArray();
  const durationMs = Date.now() - start;

  const explain = await collection.aggregate(pipeline).explain('executionStats');
  const stats = explain.executionStats || {};

  return {
    label,
    durationMs,
    docsExamined: stats.totalDocsExamined,
    keysExamined: stats.totalKeysExamined,
    indexUsed: null,
  } as BenchmarkResult;
}

async function applyIndexes(collection: any) {
  await Promise.all([
    collection.createIndex({ memberId: 1, serviceDate: -1 }),
    collection.createIndex({ providerId: 1, serviceDate: -1 }),
    collection.createIndex({ status: 1, totalAmount: -1 }),
    collection.createIndex({ memberRegion: 1, providerSpecialty: 1 }),
    collection.createIndex({ serviceDate: -1 }),
    collection.createIndex({ searchText: 'text' }),
  ]);
}

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
  const dbName = process.env.MONGODB_DB || 'health_claims';

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const collection = db.collection('claims');

  const queries = [
    () => runFind(collection, 'Recent claims by status', { status: 'submitted' }, { serviceDate: -1 }),
    () => runFind(collection, 'High amount claims', { totalAmount: { $gte: 5000 } }, { totalAmount: -1 }),
    () => runFind(collection, 'Region + specialty', { memberRegion: 'South', providerSpecialty: 'Cardiology' }, { serviceDate: -1 }),
    () => runFind(collection, 'Text search', { $text: { $search: 'Provider 10' } }, { score: { $meta: 'textScore' } }),
    () => runAggregate(collection, 'Top procedures', [
      { $unwind: '$procedureCodes' },
      { $group: { _id: '$procedureCodes', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]),
  ];

  const baselineResults: BenchmarkResult[] = [];
  for (const run of queries) {
    baselineResults.push(await run());
  }

  await applyIndexes(collection);

  const optimizedResults: BenchmarkResult[] = [];
  for (const run of queries) {
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
