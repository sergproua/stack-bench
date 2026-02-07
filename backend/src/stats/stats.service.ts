import { Injectable } from '@nestjs/common';
import { getDb } from '../db';

const SUMMARY_DOC_ID = 'latest';

type SummaryDoc = {
  totals?: {
    totalClaims?: number;
    totalAmount?: number;
  };
  statusCounts?: Record<string, number>;
  data?: {
    totalClaims?: number;
    totalAmount?: number;
    statusBreakdown?: Array<{ _id: string; count: number }>;
    topProcedures?: Array<{ _id: string; count: number }>;
  };
  meta?: Record<string, unknown>;
};

@Injectable()
export class StatsService {
  async summary() {
    const db = await getDb();
    const summary = await db.collection<SummaryDoc>('stats_summary').findOne({ _id: SUMMARY_DOC_ID });
    const totals = summary?.totals || {};
    const statusCounts = summary?.statusCounts || {};
    const legacyData = summary?.data;

    const statusBreakdown = Object.entries(statusCounts).length > 0
      ? Object.entries(statusCounts)
          .map(([key, count]) => ({ _id: key, count: Number(count) || 0 }))
          .sort((a, b) => b.count - a.count)
      : (legacyData?.statusBreakdown || []);

    const topProcedures = await db.collection('stats_procedure_counts')
      .find({})
      .sort({ count: -1 })
      .limit(5)
      .project({ _id: 1, count: 1 })
      .toArray();

    return {
      data: {
        totalClaims: totals.totalClaims ?? legacyData?.totalClaims ?? 0,
        totalAmount: totals.totalAmount ?? legacyData?.totalAmount ?? 0,
        statusBreakdown,
        topProcedures: topProcedures.length > 0 ? topProcedures : (legacyData?.topProcedures || []),
      },
      meta: {
        ...(summary?.meta || {}),
        cached: Boolean(summary),
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
