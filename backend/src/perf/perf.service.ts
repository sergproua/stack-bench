import { Injectable } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { join } from 'path';

@Injectable()
export class PerfService {
  async slowQueries() {
    const reportPath = join(process.cwd(), 'reports', 'last-report.json');
    try {
      const raw = await readFile(reportPath, 'utf-8');
      const parsed = JSON.parse(raw);
      return { data: parsed.slowQueries || [], meta: parsed.meta || {} };
    } catch (error) {
      return { data: [], meta: { message: 'No report found. Run backend/scripts/benchmark.ts.' } };
    }
  }
}
