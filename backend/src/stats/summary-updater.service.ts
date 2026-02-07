import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { ChangeStream } from 'mongodb';
import { getDb } from '../db';
import { createLogger } from '../logger';

const SUMMARY_DOC_ID = 'latest';
const BOOTSTRAP_ON_START = process.env.SUMMARY_BOOTSTRAP_ON_START !== '0';
const logger = createLogger('summary-updater.service.ts');

type ClaimDoc = {
  totalAmount?: number;
  status?: string;
  procedureCodes?: string[];
};

@Injectable()
export class SummaryUpdaterService implements OnModuleInit, OnModuleDestroy {
  private changeStream: ChangeStream | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private bootstrapTimer: NodeJS.Timeout | null = null;
  private bootstrapRunning = false;

  async onModuleInit() {
    const startStream = () => this.startStream().catch(() => undefined);
    await this.migrateLegacySummaryIfNeeded().catch(() => undefined);
    if (BOOTSTRAP_ON_START) {
      this.bootstrapTimer = setTimeout(() => {
        this.bootstrapTimer = null;
        this.bootstrapIfNeeded()
          .catch(() => undefined)
          .finally(() => startStream());
      }, 0);
      return;
    }
    startStream();
  }

  async onModuleDestroy() {
    if (this.bootstrapTimer) {
      clearTimeout(this.bootstrapTimer);
      this.bootstrapTimer = null;
    }
    await this.stopStream();
  }

  private async bootstrapIfNeeded() {
    if (this.bootstrapRunning) {
      return;
    }
    this.bootstrapRunning = true;
    try {
    const db = await getDb();
    const summary = await db.collection('stats_summary').findOne({ _id: SUMMARY_DOC_ID });
    const hasProcedures = await db.collection('stats_procedure_counts').countDocuments({}, { limit: 1 });
    if (summary && hasProcedures > 0) {
      return;
    }

    const start = Date.now();
    logger.info('[summary-bootstrap] started');
    const claims = db.collection('claims');

    const [totalClaims, totalAmount, statusBreakdown, procedureCounts] = await Promise.all([
      claims.countDocuments(),
      claims.aggregate([{ $group: { _id: null, total: { $sum: '$totalAmount' } } }]).toArray(),
      claims.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).toArray(),
      claims.aggregate([
        { $unwind: '$procedureCodes' },
        { $group: { _id: '$procedureCodes', count: { $sum: 1 } } },
      ]).toArray(),
    ]);

    const statusCounts = Object.fromEntries(
      statusBreakdown.map((item) => [String(item._id || 'unknown'), Number(item.count) || 0]),
    );

    await db.collection('stats_procedure_counts').deleteMany({});
    if (procedureCounts.length > 0) {
      await db.collection('stats_procedure_counts').insertMany(
        procedureCounts.map((item) => ({ _id: item._id, count: item.count })),
        { ordered: false },
      );
    }

    const durationMs = Date.now() - start;
    await db.collection('stats_summary').updateOne(
      { _id: SUMMARY_DOC_ID },
      {
        $set: {
          totals: {
            totalClaims,
            totalAmount: totalAmount[0]?.total || 0,
          },
          statusCounts,
          meta: {
            generatedAt: new Date().toISOString(),
            durationMs,
            source: 'bootstrap',
          },
        },
      },
      { upsert: true },
    );
    logger.info(`[summary-bootstrap] finished in ${durationMs} ms`);
    } finally {
      this.bootstrapRunning = false;
    }
  }

  private async migrateLegacySummaryIfNeeded() {
    const db = await getDb();
    const summary = await db.collection('stats_summary').findOne({ _id: SUMMARY_DOC_ID });
    if (!summary || !summary.data) {
      return;
    }

    const needsTotals = summary.totals === undefined;
    const needsStatusCounts = summary.statusCounts === undefined;
    if (!needsTotals && !needsStatusCounts) {
      return;
    }

    const totals = needsTotals
      ? {
          totalClaims: Number(summary.data.totalClaims) || 0,
          totalAmount: Number(summary.data.totalAmount) || 0,
        }
      : undefined;

    const statusCounts = needsStatusCounts && Array.isArray(summary.data.statusBreakdown)
      ? Object.fromEntries(
          summary.data.statusBreakdown.map((item: { _id?: string; count?: number }) => [
            String(item._id || 'unknown'),
            Number(item.count) || 0,
          ]),
        )
      : undefined;

    const set: Record<string, unknown> = {
      'meta.generatedAt': new Date().toISOString(),
      'meta.source': 'legacy-migration',
    };
    if (totals) {
      set.totals = totals;
    }
    if (statusCounts) {
      set.statusCounts = statusCounts;
    }

    await db.collection('stats_summary').updateOne(
      { _id: SUMMARY_DOC_ID },
      { $set: set },
    );
  }

  private async startStream() {
    await this.stopStream();
    try {
      const db = await getDb();
      const collection = db.collection('claims');
      this.changeStream = collection.watch([{ $match: { operationType: 'insert' } }], {
        fullDocument: 'updateLookup',
      });

      this.changeStream.on('change', (change) => {
        const doc = change.fullDocument as ClaimDoc | undefined;
        if (!doc) {
          return;
        }
        this.applyInsert(doc).catch(() => undefined);
      });

      this.changeStream.on('error', () => {
        this.scheduleRetry();
      });

      this.changeStream.on('close', () => {
        this.scheduleRetry();
      });
    } catch {
      this.scheduleRetry();
    }
  }

  private scheduleRetry() {
    if (this.retryTimer) {
      return;
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.startStream().catch(() => undefined);
    }, 5000);
  }

  private async stopStream() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.changeStream) {
      try {
        await this.changeStream.close();
      } catch {
        // ignore
      }
      this.changeStream = null;
    }
  }

  private async applyInsert(doc: ClaimDoc) {
    const start = Date.now();
    const db = await getDb();

    const totalAmount = typeof doc.totalAmount === 'number' ? doc.totalAmount : 0;
    const status = typeof doc.status === 'string' && doc.status ? doc.status : 'unknown';
    const procedureCodes = Array.isArray(doc.procedureCodes)
      ? doc.procedureCodes.filter((code) => typeof code === 'string' && code.length > 0)
      : [];

    const inc: Record<string, number> = {
      'totals.totalClaims': 1,
      'totals.totalAmount': totalAmount,
    };
    inc[`statusCounts.${status}`] = 1;

    await db.collection('stats_summary').updateOne(
      { _id: SUMMARY_DOC_ID },
      {
        $inc: inc,
        $set: {
          'meta.generatedAt': new Date().toISOString(),
          'meta.durationMs': Date.now() - start,
          'meta.source': 'change-stream',
        },
      },
      { upsert: true },
    );

    if (procedureCodes.length > 0) {
      await db.collection('stats_procedure_counts').bulkWrite(
        procedureCodes.map((code) => ({
          updateOne: {
            filter: { _id: code },
            update: { $inc: { count: 1 } },
            upsert: true,
          },
        })),
        { ordered: false },
      );
    }
  }
}
