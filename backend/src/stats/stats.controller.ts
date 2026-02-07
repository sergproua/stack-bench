import { Controller, Delete, Get, Query } from '@nestjs/common';
import { StatsService } from './stats.service';

@Controller('stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('summary')
  async summary() {
    return this.statsService.summary();
  }

  @Get('slow-ops')
  async slowOps(
    @Query('minMs') minMs = '1000',
    @Query('limit') limit = '20',
    @Query('keyword') keyword = '',
    @Query('startDate') startDate = '',
    @Query('endDate') endDate = ''
  ) {
    const min = Number(minMs);
    const lim = Number(limit);
    return this.statsService.slowOps(
      Number.isFinite(min) ? min : 1000,
      Number.isFinite(lim) ? Math.min(Math.max(lim, 1), 200) : 20,
      keyword || undefined,
      startDate || undefined,
      endDate || undefined
    );
  }

  @Delete('slow-ops')
  async clearSlowOps() {
    return this.statsService.clearSlowOps();
  }
}
