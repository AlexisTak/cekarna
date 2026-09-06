import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { Environment } from './config/environment';

export function configureApp(app: INestApplication, config: Environment): void {
  app.use(helmet());
  app.enableCors({ origin: config.corsOrigins });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      validationError: { target: false, value: false },
    }),
  );
  app.enableShutdownHooks();
}
