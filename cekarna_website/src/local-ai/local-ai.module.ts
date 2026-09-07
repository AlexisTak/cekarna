import { Module } from '@nestjs/common';
import { CvImportModule } from '../cv-import/cv-import.module';
import { LocalAiController } from './local-ai.controller';
import { LocalAiService } from './local-ai.service';
@Module({
  imports: [CvImportModule],
  controllers: [LocalAiController],
  providers: [LocalAiService],
})
export class LocalAiModule {}
