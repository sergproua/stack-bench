import { Module } from '@nestjs/common';
import { PerfController } from './perf.controller';
import { PerfService } from './perf.service';

@Module({
  controllers: [PerfController],
  providers: [PerfService],
})
export class PerfModule {}
