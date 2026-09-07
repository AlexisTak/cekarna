import { Body, Controller, Headers, Post } from '@nestjs/common';
import { IsObject } from 'class-validator';
import { IdentityService } from '../cv-import/identity.service';
import { LocalAiService } from './local-ai.service';
class CompareDto {
  @IsObject() profile!: object;
  @IsObject() job!: object;
}
@Controller('v1/local-ai')
export class LocalAiController {
  constructor(
    private readonly ai: LocalAiService,
    private readonly identity: IdentityService,
  ) {}
  @Post('compare')
  async compare(
    @Body() body: CompareDto,
    @Headers('authorization') authorization?: string,
  ) {
    await this.identity.userId(authorization);
    return this.ai.compare(body.profile, body.job);
  }
}
