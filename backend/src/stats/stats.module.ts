import { Module } from '@nestjs/common';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';
import { SummaryGateway } from './summary.gateway';
import { SummaryStreamService } from './summary-stream.service';
import { SummaryUpdaterService } from './summary-updater.service';
import { ClaimInserterService } from './claim-inserter.service';

@Module({
  controllers: [StatsController],
  providers: [StatsService, SummaryGateway, SummaryStreamService, SummaryUpdaterService, ClaimInserterService],
})
export class StatsModule {}
