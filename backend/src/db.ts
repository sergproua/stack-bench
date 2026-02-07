import { MongoClient, Db } from 'mongodb';
import * as dotenv from 'dotenv';

dotenv.config();

let client: MongoClient | null = null;
let db: Db | null = null;
let profilerInitialized = false;

export async function getDb(): Promise<Db> {
  if (db) {
    return db;
  }
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
  const dbName = process.env.MONGODB_DB || 'health_claims';
  client = new MongoClient(uri, { maxPoolSize: 20 });
  await client.connect();
  db = client.db(dbName);
  if (process.env.PROFILER_ENABLED === '1' && !profilerInitialized) {
    const slowMs = Number(process.env.PROFILER_SLOW_MS || 1000);
    try {
      await db.command({ profile: 1, slowms: slowMs });
      profilerInitialized = true;
    } catch {
      profilerInitialized = true;
    }
  }
  return db;
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.close();
  }
  client = null;
  db = null;
}
