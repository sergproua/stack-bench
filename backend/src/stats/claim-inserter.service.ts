import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { getDb } from '../db';
import { createLogger } from '../logger';

const INSERT_ENABLED = process.env.CLAIM_INSERT_ENABLED === '1';
const INSERT_INTERVAL_MS = Number(process.env.CLAIM_INSERT_INTERVAL_MS || 15000);
const INSERT_BATCH = Number(process.env.CLAIM_INSERT_BATCH || 5);
const logger = createLogger('claim-inserter.service.ts');

const FIRST_NAMES = ['Ava', 'Liam', 'Mia', 'Noah', 'Olivia', 'Ethan', 'Emma', 'Sophia'];
const LAST_NAMES = ['Nguyen', 'Patel', 'Garcia', 'Kim', 'Lee', 'Johnson', 'Brown', 'Smith'];
const STATUSES = ['submitted', 'in_review', 'approved', 'denied', 'paid'];
const REGIONS = ['Northeast', 'Midwest', 'South', 'West'];
const SPECIALTIES = ['Cardiology', 'Orthopedics', 'Primary Care', 'Neurology', 'Oncology', 'Dermatology'];
const CPT_CODES = ['99213', '93000', '71020', '80050', '36415', '99214', '87086'];
const ICD_CODES = ['I10', 'E11.9', 'J20.9', 'M54.5', 'R51', 'K21.9'];

const pick = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];
const pickMany = (items: string[], count: number) => {
  const result = new Set<string>();
  while (result.size < count) {
    result.add(pick(items));
  }
  return Array.from(result);
};

@Injectable()
export class ClaimInserterService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  async onModuleInit() {
    if (!INSERT_ENABLED) {
      return;
    }
    setTimeout(() => {
      this.insertBatch().catch(() => undefined);
    }, 1000);
    this.timer = setInterval(() => {
      this.insertBatch().catch(() => undefined);
    }, INSERT_INTERVAL_MS);
  }

  async onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async insertBatch() {
    if (this.running) {
      return;
    }
    this.running = true;
    const start = Date.now();
    try {
      const db = await getDb();
      const docs = Array.from({ length: INSERT_BATCH }).map(() => {
        const memberName = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
        const providerName = `Provider ${Math.floor(Math.random() * 5000) + 1}`;
        const status = pick(STATUSES);
        const memberRegion = pick(REGIONS);
        const providerSpecialty = pick(SPECIALTIES);
        const totalAmount = Math.round(50 + Math.random() * 9000);
        const serviceDate = new Date(Date.now() - Math.floor(Math.random() * 1000 * 60 * 60 * 24 * 365));
        const procedureCodes = pickMany(CPT_CODES, 2 + Math.floor(Math.random() * 2));
        const diagnosisCodes = pickMany(ICD_CODES, 1 + Math.floor(Math.random() * 2));

        return {
          _id: new ObjectId(),
          memberId: new ObjectId(),
          providerId: new ObjectId(),
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
        };
      });

      await db.collection('claims').insertMany(docs, { ordered: false });
      logger.info(`[seed-job] inserted ${docs.length} claims in ${Date.now() - start} ms`);
    } finally {
      this.running = false;
    }
  }
}
