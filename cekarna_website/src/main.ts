import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { readEnvironment } from './config/environment';
import { configureApp } from './configure-app';

async function bootstrap(): Promise<void> {
  const config = readEnvironment(process.env);
  const app = await NestFactory.create(AppModule);
  configureApp(app, config);
  await app.listen(config.port, config.host);
}

bootstrap().catch((error: unknown) => {
  Logger.error(
    error instanceof Error ? error.message : 'Unknown startup error',
    'Bootstrap',
  );
  process.exitCode = 1;
});
