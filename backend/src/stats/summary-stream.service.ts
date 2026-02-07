import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { ChangeStream } from 'mongodb';
import { getDb } from '../db';
import { SummaryGateway } from './summary.gateway';

@Injectable()
export class SummaryStreamService implements OnModuleInit, OnModuleDestroy {
  private changeStream: ChangeStream | null = null;
  private retryTimer: NodeJS.Timeout | null = null;

  constructor(private readonly gateway: SummaryGateway) {}

  async onModuleInit() {
    this.startStream().catch(() => undefined);
  }

  async onModuleDestroy() {
    await this.stopStream();
  }

  private async startStream() {
    await this.stopStream();
    try {
      const db = await getDb();
      const collection = db.collection('stats_summary');
      this.changeStream = collection.watch([], { fullDocument: 'updateLookup' });

      this.changeStream.on('change', (change) => {
        if (!change.fullDocument) {
          return;
        }
        this.emitSummary(change.fullDocument).catch(() => undefined);
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

  private async emitSummary(doc: Record<string, any>) {
    const totals = doc.totals || {};
    const statusCounts = doc.statusCounts || {};
    const hasMaterialized = Object.keys(totals).length > 0 || Object.keys(statusCounts).length > 0;

    if (!hasMaterialized && doc.data) {
      this.gateway.emitSummaryUpdate({
        data: doc.data,
        meta: doc.meta,
      });
      return;
    }

    const statusBreakdown = Object.entries(statusCounts)
      .map(([key, count]) => ({ _id: key, count: Number(count) || 0 }))
      .sort((a, b) => b.count - a.count);

    let topProcedures: Array<{ _id: string; count: number }> = [];
    try {
      const db = await getDb();
      topProcedures = await db.collection('stats_procedure_counts')
        .find({})
        .sort({ count: -1 })
        .limit(5)
        .project({ _id: 1, count: 1 })
        .toArray();
    } catch {
      topProcedures = [];
    }

    this.gateway.emitSummaryUpdate({
      data: {
        totalClaims: totals.totalClaims || 0,
        totalAmount: totals.totalAmount || 0,
        statusBreakdown,
        topProcedures,
      },
      meta: doc.meta,
    });
  }
}
