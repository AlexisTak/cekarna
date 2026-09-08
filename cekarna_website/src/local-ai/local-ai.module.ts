import { Module } from '@nestjs/common';
import { CvImportModule } from '../cv-import/cv-import.module';
import { OffersModule } from '../offers/offers.module';
import { LocalAiController } from './local-ai.controller';
import { LocalAiService } from './local-ai.service';
@Module({
  imports: [CvImportModule, OffersModule],
  controllers: [LocalAiController],
  providers: [LocalAiService],
})
export class LocalAiModule {}
