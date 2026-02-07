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
        if (change.fullDocument) {
          this.gateway.emitSummaryUpdate({
            data: change.fullDocument.data,
            meta: change.fullDocument.meta,
          });
        }
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
}
