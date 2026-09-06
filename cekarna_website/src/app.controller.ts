import { Controller, Get, Header } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getInfo(): { name: string; status: string } {
    return this.appService.getInfo();
  }

  @Get('health')
  @Header('Cache-Control', 'no-store')
  getHealth(): { status: string } {
    return { status: 'ok' };
  }
}
