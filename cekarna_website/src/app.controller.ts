import {
  Controller,
  Get,
  Header,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { AppService } from './app.service';
import { ReadinessService, type ReadinessReport } from './readiness.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly readiness: ReadinessService,
  ) {}

  @Get()
  getInfo(): { name: string; status: string } {
    return this.appService.getInfo();
  }

  @Get('health')
  @Header('Cache-Control', 'no-store')
  getHealth(): { status: string } {
    return { status: 'ok' };
  }

  @Get('health/ready')
  @Header('Cache-Control', 'no-store')
  async getReadiness(): Promise<ReadinessReport> {
    const report = await this.readiness.check();
    if (report.status !== 'ready')
      throw new HttpException(report, HttpStatus.SERVICE_UNAVAILABLE);
    return report;
  }
}
