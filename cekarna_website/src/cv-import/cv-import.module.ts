import { Module } from '@nestjs/common';
import { ENVIRONMENT, readEnvironment } from '../config/environment';
import { CvImportController } from './cv-import.controller';
import { CvImportService } from './cv-import.service';
import { CLOCK, ExtractionStore } from './extraction-store';

@Module({
  controllers: [CvImportController],
  providers: [
    CvImportService,
    ExtractionStore,
    { provide: CLOCK, useValue: () => Date.now() },
    { provide: ENVIRONMENT, useFactory: () => readEnvironment(process.env) },
  ],
  exports: [CvImportService],
})
export class CvImportModule {}
