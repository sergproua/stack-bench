import { Controller, Get, Param, Query } from '@nestjs/common';
import { ClaimsService } from './claims.service';
import { ClaimsQueryDto } from './claims.dto';

@Controller('claims')
export class ClaimsController {
  constructor(private readonly claimsService: ClaimsService) {}

  @Get()
  async list(@Query() query: ClaimsQueryDto) {
    return this.claimsService.listClaims(query);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.claimsService.getClaim(id);
  }
}
