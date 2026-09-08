import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ReadinessService } from './readiness.service';

describe('AppController', () => {
  let appController: AppController;
  let readinessCheck: jest.MockedFunction<ReadinessService['check']>;

  beforeEach(async () => {
    readinessCheck = jest.fn();
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: ReadinessService, useValue: { check: readinessCheck } },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('returns the API identity', () => {
      expect(appController.getInfo()).toEqual({
        name: 'Cekarna API',
        status: 'initialization',
      });
    });
  });

  it('returns 503 with the generic dependency report when readiness is degraded', async () => {
    const report = {
      status: 'degraded' as const,
      dependencies: {
        identity: {
          status: 'down' as const,
          latency_ms: 2,
          detail: 'unreachable' as const,
        },
        offers: { status: 'up' as const, latency_ms: 1 },
        hermes: {
          status: 'up' as const,
          latency_ms: 1,
          model: 'hermes3:3b',
        },
      },
    };
    readinessCheck.mockResolvedValue(report);
    await expect(appController.getReadiness()).rejects.toMatchObject({
      status: 503,
      response: report,
    });
  });
});
