import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CvImportModule } from './cv-import/cv-import.module';
import { LocalAiModule } from './local-ai/local-ai.module';
import { OffersModule } from './offers/offers.module';

@Module({
  imports: [CvImportModule, LocalAiModule, OffersModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
