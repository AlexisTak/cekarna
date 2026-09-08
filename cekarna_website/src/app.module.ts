import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CvImportModule } from './cv-import/cv-import.module';
import { LocalAiModule } from './local-ai/local-ai.module';
import { OffersModule } from './offers/offers.module';
import { ENVIRONMENT, readEnvironment } from './config/environment';
import { ReadinessService } from './readiness.service';

@Module({
  imports: [CvImportModule, LocalAiModule, OffersModule],
  controllers: [AppController],
  providers: [
    AppService,
    ReadinessService,
    { provide: ENVIRONMENT, useFactory: () => readEnvironment(process.env) },
  ],
})
export class AppModule {}
