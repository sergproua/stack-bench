import { Controller, Get } from '@nestjs/common';
import { PerfService } from './perf.service';

@Controller('stats')
export class PerfController {
  constructor(private readonly perfService: PerfService) {}

  @Get('slow-queries')
  async slowQueries() {
    return this.perfService.slowQueries();
  }
}
