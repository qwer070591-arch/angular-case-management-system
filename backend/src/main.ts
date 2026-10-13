import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './shared/api-exception.filter';
import { authConfig } from './auth/auth-config';

async function bootstrap(): Promise<void> {
  const security = authConfig();
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableCors({
    origin: security.origin,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    credentials: true,
  });

  const port = Number(process.env.PORT ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  // This transitional Auth phase is local-development-only until Angular integration and deployment hardening.
  await app.listen(port, '127.0.0.1');
}

void bootstrap();
