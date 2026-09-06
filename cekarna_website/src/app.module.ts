import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CvImportModule } from './cv-import/cv-import.module';

@Module({
  imports: [CvImportModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
