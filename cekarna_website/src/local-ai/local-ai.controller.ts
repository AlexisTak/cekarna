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
class ApplicationDraftDto {
  @IsObject() profile!: object;
  @IsObject() job!: object;
  @IsOptional() @IsArray() experiences?: unknown[];
  @IsOptional() @IsArray() education?: unknown[];
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
    const profile = body.profile as Record<string, unknown>;
    const field = (key: string, max: number) =>
      typeof profile[key] === 'string' ? profile[key].slice(0, max) : '';
    const entry = (value: unknown) => {
      const item =
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {};
      return Object.fromEntries(
        ['role', 'employer', 'degree', 'institution', 'description']
          .filter((key) => typeof item[key] === 'string')
          .map((key) => [key, String(item[key]).slice(0, 500)]),
      );
    };
    const page = await this.offers.shortlist({
      profile: {
        title: field('title', 200),
        city: field('city', 200),
        contract: field('contract', 80),
        skills: field('skills', 1_000),
        about: field('about', 600),
        experiences: Array.isArray(body.experiences)
          ? body.experiences.slice(0, 50).map(entry)
          : [],
        education: Array.isArray(body.education)
          ? body.education.slice(0, 50).map(entry)
          : [],
      },
      filters: {
        q: typeof filters?.q === 'string' ? filters.q.slice(0, 200) : '',
        location:
          typeof filters?.location === 'string'
            ? filters.location.slice(0, 200)
            : '',
        contract:
          typeof filters?.contract === 'string'
            ? filters.contract.slice(0, 40)
            : '',
      },
    });
    return this.ai.recommendOffers(
      userId,
      body.profile,
      body.experiences,
      body.education,
      page,
    );
  }

  @Post('application-draft')
  async applicationDraft(
    @Body() body: ApplicationDraftDto,
    @Headers('authorization') authorization?: string,
  ) {
    await this.identity.userId(authorization);
    return this.ai.applicationDraft(
      body.profile,
      body.experiences,
      body.education,
      body.job,
    );
  }
}
