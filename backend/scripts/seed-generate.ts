import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { ObjectId } from 'mongodb';
import { once } from 'events';
import { cpus } from 'os';
import { spawn } from 'child_process';
import { createLogger } from '../src/logger';

const DEFAULT_SIZE = 500_000;
const LARGE_SIZE = 5_000_000;
const XL_SIZE = 50_000_000;
const DEFAULT_CLAIMS_PER_FILE = 1_000_000;
const MAX_FILES = 10;
const logger = createLogger('seed-generate.ts');

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

function objectIdFromIndex(prefix: number, index: number) {
  const buffer = Buffer.alloc(12);
  buffer.writeUInt32BE(0x65000000 + prefix, 0);
  buffer.writeUInt32BE(prefix, 4);
  buffer.writeUInt32BE(index, 8);
  return new ObjectId(buffer);
}

function memberForIndex(index: number) {
  const first = FIRST_NAMES[index % FIRST_NAMES.length];
  const last = LAST_NAMES[Math.floor(index / FIRST_NAMES.length) % LAST_NAMES.length];
  const region = REGIONS[index % REGIONS.length];
  const plan = index % 2 === 0 ? 'PPO' : 'HMO';
  const dob = new Date(1950 + (index % 50), (index % 12), (index % 28) + 1).toISOString();
  const name = `${first} ${last}`;
  return { first, last, name, region, plan, dob };
}

function providerForIndex(index: number) {
  const name = `Provider ${index + 1}`;
  const specialty = SPECIALTIES[index % SPECIALTIES.length];
  const region = REGIONS[(index + 1) % REGIONS.length];
  const facilityId = `FAC-${1000 + index}`;
  return { name, specialty, region, facilityId };
}

function parseArg(prefix: string) {
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

async function writeFileIfMissing(path: string, writeFn: () => Promise<void>, force: boolean) {
  if (existsSync(path) && !force) {
    return false;
  }
  await writeFn();
  return true;
}

async function writeLine(stream: ReturnType<typeof createWriteStream>, line: string) {
  if (!stream.write(line)) {
    await once(stream, 'drain');
  }
}

async function finalizeStream(stream: ReturnType<typeof createWriteStream>) {
  await new Promise<void>((resolve, reject) => {
    stream.end(() => resolve());
    stream.on('error', reject);
  });
}

async function runTasksInParallel(
  tasks: Array<() => Promise<void>>,
  concurrency: number
) {
  let index = 0;
  let stopped = false;
  const running = new Set<Promise<void>>();

  const runNext = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    if (index >= tasks.length) {
      return;
    }
    const task = tasks[index++];
    const promise = task()
      .catch((error) => {
        stopped = true;
        throw error;
      })
      .finally(() => {
        running.delete(promise);
      });
    running.add(promise);
    if (running.size < concurrency) {
      await runNext();
    }
  };

  const starters = Array.from({ length: Math.min(concurrency, tasks.length) }, () => runNext());
  await Promise.all(starters);
  await Promise.all(running);
}

function spawnWorker(args: string[]) {
  const scriptPath = resolve(__dirname, 'seed-generate.ts');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const tsNodeRegister = require.resolve('ts-node/register');

  return new Promise<void>((resolveWorker, rejectWorker) => {
    const child = spawn(process.execPath, ['-r', tsNodeRegister, scriptPath, '--worker', ...args], {
      stdio: 'inherit',
    });
    child.on('error', rejectWorker);
    child.on('exit', (code) => {
      if (code === 0) {
        resolveWorker();
      } else {
        rejectWorker(new Error(`Worker exited with code ${code}`));
      }
    });
  });
}

async function generateFileChunk(options: {
  outDir: string;
  start: number;
  end: number;
  fileIndex: number;
  membersCount: number;
  providersCount: number;
  force: boolean;
}) {
  const { outDir, start, end, fileIndex, membersCount, providersCount, force } = options;
  const claimsPath = join(outDir, `claims-${String(fileIndex + 1).padStart(4, '0')}.ndjson`);
  const paymentsPath = join(outDir, `payments-${String(fileIndex + 1).padStart(4, '0')}.ndjson`);

  const shouldWriteClaims = await writeFileIfMissing(claimsPath, async () => {
    const claimStream = createWriteStream(claimsPath);
    const paymentStream = createWriteStream(paymentsPath);

    for (let i = start; i < end; i += 1) {
      const rand = mulberry32(i + 13);
      const memberIndex = Math.floor(rand() * membersCount);
      const providerIndex = Math.floor(rand() * providersCount);
      const member = memberForIndex(memberIndex);
      const provider = providerForIndex(providerIndex);

      const status = pick(STATUSES, rand);
      const totalAmount = Math.round(50 + rand() * 9000);
      const serviceDate = new Date(2021 + Math.floor(rand() * 4), Math.floor(rand() * 12), Math.floor(rand() * 28) + 1).toISOString();
      const procedureCodes = pickMany(CPT_CODES, 2 + Math.floor(rand() * 3), rand);
      const diagnosisCodes = pickMany(ICD_CODES, 1 + Math.floor(rand() * 2), rand);

      const claimId = objectIdFromIndex(3, i).toHexString();
      const memberId = objectIdFromIndex(1, memberIndex).toHexString();
      const providerId = objectIdFromIndex(2, providerIndex).toHexString();
      const searchText = `${member.name} ${provider.name} ${procedureCodes.join(' ')} ${diagnosisCodes.join(' ')}`;

      await writeLine(claimStream, `${JSON.stringify({
        _id: claimId,
        memberId,
        providerId,
        memberName: member.name,
        providerName: provider.name,
        memberRegion: member.region,
        providerSpecialty: provider.specialty,
        status,
        totalAmount,
        serviceDate,
        procedureCodes,
        diagnosisCodes,
        searchText,
      })}\n`);

      await writeLine(paymentStream, `${JSON.stringify({
        claimId,
        paidAmount: status === 'denied' ? 0 : Math.round(totalAmount * (0.5 + rand() * 0.5)),
        payer: rand() > 0.7 ? 'Medicare' : 'Commercial',
        status: status === 'paid' ? 'paid' : 'pending',
        paidDate: status === 'paid' ? new Date(new Date(serviceDate).getTime() + 86400000 * 30).toISOString() : null,
      })}\n`);
    }

    await finalizeStream(claimStream);
    await finalizeStream(paymentStream);
  }, force);

  if (shouldWriteClaims) {
    // eslint-disable-next-line no-console
    logger.info(`Generated ${claimsPath} and ${paymentsPath}`);
  } else if (!force && !existsSync(paymentsPath)) {
    // If claims exists but payments missing, regenerate both.
    await generateFileChunk({ outDir, start, end, fileIndex, membersCount, providersCount, force: true });
  }
}

async function workerMain() {
  const outDir = parseArg('--out=') || 'seed-data';
  const start = Number(parseArg('--start=') || '0');
  const end = Number(parseArg('--end=') || '0');
  const fileIndex = Number(parseArg('--file-index=') || '0');
  const membersCount = Number(parseArg('--members=') || '0');
  const providersCount = Number(parseArg('--providers=') || '0');
  const force = process.argv.includes('--force');

  await generateFileChunk({
    outDir,
    start,
    end,
    fileIndex,
    membersCount,
    providersCount,
    force,
  });
}

async function main() {
  const scaleArg = parseArg('--scale=');
  const sizeArg = parseArg('--size=');
  const outDir = parseArg('--out=') || 'seed-data';
  const requestedClaimsPerFile = Number(parseArg('--claims-per-file=') || DEFAULT_CLAIMS_PER_FILE);
  const force = process.argv.includes('--force');
  const maxFiles = Number(parseArg('--max-files=') || MAX_FILES);
  const concurrency = Number(parseArg('--concurrency=') || Math.max(1, cpus().length - 1));

  let totalClaims = DEFAULT_SIZE;
  if (sizeArg) {
    totalClaims = Number(sizeArg);
  } else if (scaleArg) {
    if (scaleArg === 'large') {
      totalClaims = LARGE_SIZE;
    } else if (scaleArg === 'xl') {
      totalClaims = XL_SIZE;
    }
  }

  const membersCount = Math.max(50_000, Math.floor(totalClaims / 5));
  const providersCount = Math.max(5_000, Math.floor(totalClaims / 50));

  const totalFiles = Math.min(maxFiles, Math.ceil(totalClaims / requestedClaimsPerFile));
  const claimsPerFile = Math.ceil(totalClaims / totalFiles);

  mkdirSync(outDir, { recursive: true });

  const manifestPath = join(outDir, 'manifest.json');
  if (existsSync(manifestPath) && !force) {
    // eslint-disable-next-line no-console
    logger.info('Manifest exists. Use --force to regenerate.');
  }

  const membersPath = join(outDir, 'members.ndjson');
  const providersPath = join(outDir, 'providers.ndjson');
  const proceduresPath = join(outDir, 'procedures.ndjson');
  const diagnosesPath = join(outDir, 'diagnoses.ndjson');

  if (await writeFileIfMissing(membersPath, async () => {
    const stream = createWriteStream(membersPath);
    for (let i = 0; i < membersCount; i += 1) {
      const _id = objectIdFromIndex(1, i).toHexString();
      const member = memberForIndex(i);
      await writeLine(stream, `${JSON.stringify({
        _id,
        firstName: member.first,
        lastName: member.last,
        region: member.region,
        plan: member.plan,
        dob: member.dob,
      })}\n`);
    }
    await finalizeStream(stream);
  }, force)) {
    // eslint-disable-next-line no-console
    logger.info(`Generated ${membersPath}`);
  }

  if (await writeFileIfMissing(providersPath, async () => {
    const stream = createWriteStream(providersPath);
    for (let i = 0; i < providersCount; i += 1) {
      const _id = objectIdFromIndex(2, i).toHexString();
      const provider = providerForIndex(i);
      await writeLine(stream, `${JSON.stringify({
        _id,
        name: provider.name,
        specialty: provider.specialty,
        region: provider.region,
        facilityId: provider.facilityId,
      })}\n`);
    }
    await finalizeStream(stream);
  }, force)) {
    // eslint-disable-next-line no-console
    logger.info(`Generated ${providersPath}`);
  }

  if (await writeFileIfMissing(proceduresPath, async () => {
    const stream = createWriteStream(proceduresPath);
    for (const code of CPT_CODES) {
      await writeLine(stream, `${JSON.stringify({ code, description: `Procedure ${code}` })}\n`);
    }
    await finalizeStream(stream);
  }, force)) {
    // eslint-disable-next-line no-console
    logger.info(`Generated ${proceduresPath}`);
  }

  if (await writeFileIfMissing(diagnosesPath, async () => {
    const stream = createWriteStream(diagnosesPath);
    for (const code of ICD_CODES) {
      await writeLine(stream, `${JSON.stringify({ code, description: `Diagnosis ${code}` })}\n`);
    }
    await finalizeStream(stream);
  }, force)) {
    // eslint-disable-next-line no-console
    logger.info(`Generated ${diagnosesPath}`);
  }

  const tasks: Array<() => Promise<void>> = [];
  for (let fileIndex = 0; fileIndex < totalFiles; fileIndex += 1) {
    const start = fileIndex * claimsPerFile;
    const end = Math.min(totalClaims, start + claimsPerFile);
    tasks.push(() => spawnWorker([
      `--out=${outDir}`,
      `--start=${start}`,
      `--end=${end}`,
      `--file-index=${fileIndex}`,
      `--members=${membersCount}`,
      `--providers=${providersCount}`,
      force ? '--force' : '',
    ].filter(Boolean)));
  }

  await runTasksInParallel(tasks, concurrency);

  const manifest = {
    generatedAt: new Date().toISOString(),
    totalClaims,
    membersCount,
    providersCount,
    claimsPerFile,
    totalFiles,
    concurrency,
    scale: scaleArg || 'custom',
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  // eslint-disable-next-line no-console
  logger.info(`Seed files ready in ${outDir}`);
}

if (process.argv.includes('--worker')) {
  workerMain().catch((error) => {
    // eslint-disable-next-line no-console
    logger.error(error);
    process.exit(1);
  });
} else {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    logger.error(error);
    process.exit(1);
  });
}
