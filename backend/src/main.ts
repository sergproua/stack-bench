import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as dotenv from 'dotenv';
import { createLogger } from './logger';

dotenv.config();
const logger = createLogger('main.ts');

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  const port = Number(process.env.PORT || 3001);
  await app.listen(port);
  logger.info(`API listening on http://localhost:${port}/api`);
}

bootstrap();
