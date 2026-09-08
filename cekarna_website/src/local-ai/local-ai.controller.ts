import { Body, Controller, Headers, Post } from '@nestjs/common';
import { IsArray, IsObject, IsOptional } from 'class-validator';
import { IdentityService } from '../cv-import/identity.service';
import { OffersService } from '../offers/offers.service';
import { LocalAiService } from './local-ai.service';
class CompareDto {
  @IsObject() profile!: object;
  @IsObject() job!: object;
}
class RecommendOffersDto {
  @IsObject() profile!: object;
  @IsOptional() @IsArray() experiences?: unknown[];
  @IsOptional() @IsArray() education?: unknown[];
  @IsOptional() @IsObject() filters?: object;
}
@Controller('v1/local-ai')
export class LocalAiController {
  constructor(
    private readonly ai: LocalAiService,
    private readonly identity: IdentityService,
    private readonly offers: OffersService,
  ) {}
  @Post('compare')
  async compare(
    @Body() body: CompareDto,
    @Headers('authorization') authorization?: string,
  ) {
    await this.identity.userId(authorization);
    return this.ai.compare(body.profile, body.job);
  }

  @Post('recommend-offers')
  async recommendOffers(
    @Body() body: RecommendOffersDto,
    @Headers('authorization') authorization?: string,
  ) {
    const userId = await this.identity.userId(authorization);
    const filters = body.filters as Record<string, unknown> | undefined;
    const page = await this.offers.list({
      limit: '100',
      q: typeof filters?.q === 'string' ? filters.q.slice(0, 200) : undefined,
      location:
        typeof filters?.location === 'string'
          ? filters.location.slice(0, 200)
          : undefined,
      contract:
        typeof filters?.contract === 'string'
          ? filters.contract.slice(0, 40)
          : undefined,
    });
    return this.ai.recommendOffers(
      userId,
      body.profile,
      body.experiences,
      body.education,
      page,
    );
  }
}
