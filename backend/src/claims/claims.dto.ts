import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

const SORT_FIELDS = ['serviceDate', 'totalAmount', 'status', 'memberRegion', 'providerSpecialty'] as const;

export class ClaimsQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  providerSpecialty?: string;

  @IsOptional()
  @IsString()
  codes?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(500)
  pageSize: number = 50;

  @IsOptional()
  @IsString()
  @IsIn(SORT_FIELDS as unknown as string[])
  sortBy: string = 'serviceDate';

  @IsOptional()
  @IsString()
  @IsIn(['asc', 'desc'])
  sortDir: 'asc' | 'desc' = 'desc';

  @IsOptional()
  @Type(() => Number)
  minAmount?: number;

  @IsOptional()
  @Type(() => Number)
  maxAmount?: number;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  includeTotal?: string;
}

export type ClaimsQuery = ClaimsQueryDto;
