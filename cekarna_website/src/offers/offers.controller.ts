import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { OffersService } from './offers.service';
export class OffersQuery {
  @IsOptional() @IsString() @Length(1, 200) q?: string;
  @IsOptional() @IsString() @Length(1, 200) location?: string;
  @IsOptional() @IsString() @Length(1, 40) contract?: string;
  @IsOptional() @IsString() @Length(1, 100) cursor?: string;
  @IsOptional() @Matches(/^([1-9]|[1-9]\d|1\d\d|200)$/) limit?: string;
  @IsOptional() @IsIn(['include']) duplicates?: string;
}
@Controller('v1/offers')
export class OffersController {
  constructor(private readonly offers: OffersService) {}
  @Get() @Header('Cache-Control', 'public, max-age=60') list(
    @Query() query: OffersQuery,
  ) {
    return this.offers.list(query);
  }
  @Get(':id') @Header('Cache-Control', 'public, max-age=60') get(
    @Param('id') id: string,
  ) {
    return this.offers.get(id);
  }
}
