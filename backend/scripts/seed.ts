import { MongoClient, ObjectId } from 'mongodb';
import * as dotenv from 'dotenv';

dotenv.config();

const DEFAULT_SIZE = 500_000;
const LARGE_SIZE = 5_000_000;
const XL_SIZE = 50_000_000;
const BATCH_SIZE = 1_000;
const DEFAULT_CONCURRENCY = 4;

const FIRST_NAMES = ['Ava', 'Noah', 'Mia', 'Liam', 'Emma', 'Ethan', 'Olivia', 'Mason', 'Sophia', 'Logan'];
const LAST_NAMES = ['Smith', 'Johnson', 'Brown', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez'];
const REGIONS = ['Northeast', 'Midwest', 'South', 'West'];
const SPECIALTIES = ['Cardiology', 'Orthopedics', 'Primary Care', 'Neurology', 'Oncology', 'Dermatology'];
const STATUSES = ['submitted', 'in_review', 'approved', 'denied', 'paid'];
const CPT_CODES = ['99213', '99214', '93000', '71020', '36415', '45378', '80050', '87086'];
const ICD_CODES = ['E11.9', 'I10', 'M54.5', 'J06.9', 'K21.9', 'F41.1', 'E78.5'];

function mulberry32(seed: number) {
  return function () {
    let t = seed += 0x6d2b79f5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function pick<T>(arr: T[], rand: () => number) {
  return arr[Math.floor(rand() * arr.length)];
}

function pickMany<T>(arr: T[], count: number, rand: () => number) {
  const result: T[] = [];
  for (let i = 0; i < count; i += 1) {
    result.push(pick(arr, rand));
  }
  return Array.from(new Set(result));
}

async function main() {
  const startedAt = Date.now();
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
  const dbName = process.env.MONGODB_DB || 'health_claims';

  const sizeArg = process.argv.find((arg) => arg.startsWith('--size='));
  const reset = process.argv.includes('--reset');
  const scaleArg = process.argv.find((arg) => arg.startsWith('--scale='));
  const concurrencyArg = process.argv.find((arg) => arg.startsWith('--concurrency='));
  const skipIndexes = process.argv.includes('--no-indexes');

  let totalClaims = DEFAULT_SIZE;
  if (sizeArg) {
    totalClaims = Number(sizeArg.split('=')[1]);
  } else if (scaleArg) {
    const scale = scaleArg.split('=')[1];
    if (scale === 'large') {
      totalClaims = LARGE_SIZE;
    } else if (scale === 'xl') {
      totalClaims = XL_SIZE;
    } else {
      totalClaims = DEFAULT_SIZE;
    }
  }

  const requestedConcurrency = concurrencyArg
    ? Number(concurrencyArg.split('=')[1])
    : Number(process.env.SEED_CONCURRENCY || DEFAULT_CONCURRENCY);
  const concurrency = Number.isFinite(requestedConcurrency) && requestedConcurrency > 0
    ? Math.floor(requestedConcurrency)
    : DEFAULT_CONCURRENCY;

  const membersCount = Math.max(50_000, Math.floor(totalClaims / 5));
  const providersCount = Math.max(5_000, Math.floor(totalClaims / 50));

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

  const rand = mulberry32(42);

  const memberIds: ObjectId[] = [];
  const providerIds: ObjectId[] = [];

  const enqueueWrite = async (pending: Promise<unknown>[], promise: Promise<unknown>) => {
    pending.push(promise);
    if (pending.length >= concurrency) {
      await Promise.all(pending);
      pending.length = 0;
    }
  };

  const flushWrites = async (pending: Promise<unknown>[]) => {
    if (pending.length > 0) {
      await Promise.all(pending);
      pending.length = 0;
    }
  };

  let membersBatch = [] as Array<{ insertOne: { document: Record<string, unknown> } }>;
  const memberWrites: Promise<unknown>[] = [];
  for (let i = 0; i < membersCount; i += 1) {
    const _id = new ObjectId();
    memberIds.push(_id);
    const first = pick(FIRST_NAMES, rand);
    const last = pick(LAST_NAMES, rand);
    membersBatch.push({
      insertOne: {
        document: {
          _id,
          firstName: first,
          lastName: last,
          region: pick(REGIONS, rand),
          plan: rand() > 0.5 ? 'PPO' : 'HMO',
          dob: new Date(1950 + Math.floor(rand() * 50), Math.floor(rand() * 12), Math.floor(rand() * 28) + 1),
        },
      },
    });
    if (membersBatch.length === BATCH_SIZE || i === membersCount - 1) {
      const batch = membersBatch;
      membersBatch = [] as Array<{ insertOne: { document: Record<string, unknown> } }>;
      await enqueueWrite(memberWrites, db.collection('members').bulkWrite(batch, { ordered: false }));
    }
  }
  await flushWrites(memberWrites);

  let providersBatch = [] as Array<{ insertOne: { document: Record<string, unknown> } }>;
  const providerWrites: Promise<unknown>[] = [];
  for (let i = 0; i < providersCount; i += 1) {
    const _id = new ObjectId();
    providerIds.push(_id);
    const name = `Provider ${i + 1}`;
    providersBatch.push({
      insertOne: {
        document: {
          _id,
          name,
          specialty: pick(SPECIALTIES, rand),
          region: pick(REGIONS, rand),
          facilityId: `FAC-${1000 + i}`,
        },
      },
    });
    if (providersBatch.length === BATCH_SIZE || i === providersCount - 1) {
      const batch = providersBatch;
      providersBatch = [] as Array<{ insertOne: { document: Record<string, unknown> } }>;
      await enqueueWrite(providerWrites, db.collection('providers').bulkWrite(batch, { ordered: false }));
    }
  }
  await flushWrites(providerWrites);

  await db.collection('procedures').insertMany(
    CPT_CODES.map((code) => ({ code, description: `Procedure ${code}` }))
  );
  await db.collection('diagnoses').insertMany(
    ICD_CODES.map((code) => ({ code, description: `Diagnosis ${code}` }))
  );

  let claimsBatch = [] as Array<{ insertOne: { document: Record<string, unknown> } }>;
  let paymentsBatch = [] as Array<{ insertOne: { document: Record<string, unknown> } }>;
  const claimWrites: Promise<unknown>[] = [];

  for (let i = 0; i < totalClaims; i += 1) {
    const memberId = pick(memberIds, rand);
    const providerId = pick(providerIds, rand);
    const memberName = `${pick(FIRST_NAMES, rand)} ${pick(LAST_NAMES, rand)}`;
    const providerName = `Provider ${Math.floor(rand() * providersCount) + 1}`;
    const memberRegion = pick(REGIONS, rand);
    const providerSpecialty = pick(SPECIALTIES, rand);
    const status = pick(STATUSES, rand);
    const totalAmount = Math.round(50 + rand() * 9000);
    const serviceDate = new Date(2021 + Math.floor(rand() * 4), Math.floor(rand() * 12), Math.floor(rand() * 28) + 1);

    const claimId = new ObjectId();
    const procedureCodes = pickMany(CPT_CODES, 2 + Math.floor(rand() * 3), rand);
    const diagnosisCodes = pickMany(ICD_CODES, 1 + Math.floor(rand() * 2), rand);

    claimsBatch.push({
      insertOne: {
        document: {
          _id: claimId,
          memberId,
          providerId,
          memberName,
          providerName,
          memberRegion,
          providerSpecialty,
          status,
          totalAmount,
          serviceDate,
          procedureCodes,
          diagnosisCodes,
          searchText: `${memberName} ${providerName} ${procedureCodes.join(' ')} ${diagnosisCodes.join(' ')}`,
        },
      },
    });

    paymentsBatch.push({
      insertOne: {
        document: {
          claimId,
          paidAmount: status === 'denied' ? 0 : Math.round(totalAmount * (0.5 + rand() * 0.5)),
          payer: rand() > 0.7 ? 'Medicare' : 'Commercial',
          status: status === 'paid' ? 'paid' : 'pending',
          paidDate: status === 'paid' ? new Date(serviceDate.getTime() + 86400000 * 30) : null,
        },
      },
    });

    if (claimsBatch.length === BATCH_SIZE || i === totalClaims - 1) {
      const claimsToWrite = claimsBatch;
      const paymentsToWrite = paymentsBatch;
      claimsBatch = [] as Array<{ insertOne: { document: Record<string, unknown> } }>;
      paymentsBatch = [] as Array<{ insertOne: { document: Record<string, unknown> } }>;
      await enqueueWrite(
        claimWrites,
        Promise.all([
          db.collection('claims').bulkWrite(claimsToWrite, { ordered: false }),
          db.collection('payments').bulkWrite(paymentsToWrite, { ordered: false }),
        ])
      );
      if ((i + 1) % 50_000 === 0) {
        // eslint-disable-next-line no-console
        console.log(`Inserted ${i + 1} / ${totalClaims} claims`);
      }
    }
  }
  await flushWrites(claimWrites);

  if (!skipIndexes) {
    // eslint-disable-next-line no-console
    console.log('Creating indexes...');
    await db.collection('claims').createIndexes([
      { key: { serviceDate: -1, _id: -1 } },
      { key: { status: 1, totalAmount: -1 } },
      { key: { memberRegion: 1, providerSpecialty: 1 } },
      { key: { searchText: 'text' } },
    ]);
  }

  // eslint-disable-next-line no-console
  console.log(`Seeding complete in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  await client.close();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
