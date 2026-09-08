import { Module } from '@nestjs/common';
import { ENVIRONMENT, readEnvironment } from '../config/environment';
import { OffersController } from './offers.controller';
import { OffersService } from './offers.service';
@Module({
  controllers: [OffersController],
  providers: [
    OffersService,
    { provide: ENVIRONMENT, useFactory: () => readEnvironment(process.env) },
  ],
  exports: [OffersService],
})
export class OffersModule {}
