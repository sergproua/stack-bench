import { MongoClient } from 'mongodb';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
  const dbName = process.env.MONGODB_DB || 'health_claims';

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  // eslint-disable-next-line no-console
  console.log('Creating indexes...');
  await db.collection('claims').createIndexes([
    { key: { serviceDate: -1, _id: -1 } },
    { key: { status: 1, totalAmount: -1 } },
    { key: { memberRegion: 1, providerSpecialty: 1 } },
    { key: { searchText: 'text' } },
  ]);

  // eslint-disable-next-line no-console
  console.log('Indexes created.');
  await client.close();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
