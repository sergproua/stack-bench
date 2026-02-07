import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { getDb } from '../db';

const SUMMARY_REFRESH_MS = Number(process.env.SUMMARY_REFRESH_MS || 300000);
const SUMMARY_DOC_ID = 'latest';

@Injectable()
export class StatsService implements OnModuleInit, OnModuleDestroy {
  private refreshTimer: NodeJS.Timeout | null = null;

  async onModuleInit() {
    setTimeout(() => {
      this.refreshSummary().catch(() => undefined);
    }, 0);
    this.refreshTimer = setInterval(() => {
      this.refreshSummary().catch(() => undefined);
    }, SUMMARY_REFRESH_MS);
  }

  async onModuleDestroy() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private async computeSummary() {
    const db = await getDb();
    const collection = db.collection('claims');

    const [totalClaims, totalAmount, statusBreakdown, topProcedures] = await Promise.all([
      collection.countDocuments(),
      collection.aggregate([
        { $group: { _id: null, total: { $sum: '$totalAmount' } } },
      ]).toArray(),
      collection.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).toArray(),
      collection.aggregate([
        { $unwind: '$procedureCodes' },
        { $group: { _id: '$procedureCodes', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
    ]).toArray(),
    ]);

    return {
      totalClaims,
      totalAmount: totalAmount[0]?.total || 0,
      statusBreakdown,
      topProcedures,
    };
  }

  private async refreshSummary() {
    const start = Date.now();
    // eslint-disable-next-line no-console
    console.log('[summary-job] started');
    const data = await this.computeSummary();
    const db = await getDb();
    const durationMs = Date.now() - start;
    await db.collection('stats_summary').updateOne(
      { _id: SUMMARY_DOC_ID },
      {
        $set: {
          data,
          meta: {
            generatedAt: new Date().toISOString(),
            durationMs,
          },
        },
      },
      { upsert: true }
    );
    // eslint-disable-next-line no-console
    console.log(`[summary-job] finished in ${durationMs} ms`);
  }

  async summary() {
    const db = await getDb();
    const cached = await db.collection('stats_summary').findOne({ _id: SUMMARY_DOC_ID });
    if (!cached) {
      const start = Date.now();
      const data = await this.computeSummary();
      const durationMs = Date.now() - start;
      return {
        data,
        meta: {
          generatedAt: new Date().toISOString(),
          durationMs,
          cached: false,
        },
      };
    }

    return {
      data: cached.data,
      meta: {
        ...(cached.meta || {}),
        cached: true,
      },
    };
  }

  async slowOps(minMs: number, limit: number, keyword?: string, startDate?: string, endDate?: string) {
    const db = await getDb();
    const profileCollection = db.collection('system.profile');

    let profiler: Record<string, unknown> | null = null;
    try {
      profiler = await db.command({ profile: -1 });
    } catch {
      profiler = null;
    }

    let data: Array<Record<string, unknown>> = [];
    try {
      const filter: Record<string, unknown> = {
        millis: { $gte: minMs },
      };

      if (startDate || endDate) {
        filter.ts = {
          ...(startDate ? { $gte: new Date(startDate) } : {}),
          ...(endDate ? { $lte: new Date(`${endDate}T23:59:59.999Z`) } : {}),
        };
      }

      if (keyword) {
        const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escaped, 'i');
        filter.$or = [
          { ns: regex },
          { op: regex },
          { planSummary: regex },
          { 'command.find': regex },
          { 'command.aggregate': regex },
          { 'command.count': regex },
          { 'command.distinct': regex },
        ];
      }

      data = await profileCollection
        .find(filter)
        .sort({ ts: -1, millis: -1 })
        .limit(limit)
        .project({
          ts: 1,
          millis: 1,
          op: 1,
          ns: 1,
          command: 1,
          planSummary: 1,
          nreturned: 1,
          keysExamined: 1,
          docsExamined: 1,
          responseLength: 1,
        })
        .toArray();
    } catch {
      data = [];
    }

    return {
      data,
      meta: {
        minMs,
        limit,
        keyword: keyword || null,
        startDate: startDate || null,
        endDate: endDate || null,
        profiler,
        message: data.length === 0
          ? 'No slow ops found or profiler disabled. Set PROFILER_ENABLED=1 and PROFILER_SLOW_MS=1000.'
          : undefined,
      },
    };
  }

  async clearSlowOps() {
    const db = await getDb();
    const profileCollection = db.collection('system.profile');
    const slowMs = Number(process.env.PROFILER_SLOW_MS || 1000);
    const shouldEnableProfiler = process.env.PROFILER_ENABLED === '1';
    let deletedCount = 0;
    let cleared = false;
    try {
      await db.command({ profile: 0 });
      await profileCollection.drop().catch(() => undefined);
      cleared = true;
      deletedCount = 0;
    } catch {
      deletedCount = 0;
    }
    if (shouldEnableProfiler) {
      try {
        await db.command({ profile: 1, slowms: slowMs });
      } catch {
        // ignore
      }
    }
    return {
      data: { deletedCount, cleared },
    };
  }
}
