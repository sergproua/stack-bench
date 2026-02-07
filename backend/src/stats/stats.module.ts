import { Module } from '@nestjs/common';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';
import { SummaryGateway } from './summary.gateway';
import { SummaryStreamService } from './summary-stream.service';

@Module({
  controllers: [StatsController],
  providers: [StatsService, SummaryGateway, SummaryStreamService],
})
export class StatsModule {}
