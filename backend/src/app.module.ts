import { Module } from '@nestjs/common';
import { ClaimsModule } from './claims/claims.module';
import { StatsModule } from './stats/stats.module';
import { PerfModule } from './perf/perf.module';

@Module({
  imports: [ClaimsModule, StatsModule, PerfModule],
})
export class AppModule {}
