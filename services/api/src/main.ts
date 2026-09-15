import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // Preserve raw body for Razorpay webhook signature verification
  app.use(
    json({
      verify: (req, _res, buf) => {
        const r = req as typeof req & {
          originalUrl?: string;
          rawBody?: Buffer;
        };
        if (r.originalUrl?.includes('/payments/webhooks/razorpay')) {
          r.rawBody = buf;
        }
      },
    }),
  );
  app.use(urlencoded({ extended: true }));

  app.setGlobalPrefix('v1');
  app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`ShareHaul API listening on http://localhost:${port}/v1`);
}
bootstrap();
