import { Module } from '@nestjs/common';
import { ENVIRONMENT, readEnvironment } from '../config/environment';
import { CvImportController } from './cv-import.controller';
import { CvImportService } from './cv-import.service';
import { CLOCK, ExtractionStore } from './extraction-store';
import { IdentityService } from './identity.service';

@Module({
  controllers: [CvImportController],
  providers: [
    CvImportService,
    ExtractionStore,
    IdentityService,
    { provide: CLOCK, useValue: () => Date.now() },
    { provide: ENVIRONMENT, useFactory: () => readEnvironment(process.env) },
  ],
  exports: [CvImportService, IdentityService],
})
export class CvImportModule {}
