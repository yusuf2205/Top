import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { loadEnv } from "@top/config";
import { AppModule } from "./app.module";

async function bootstrap() {
  const env = loadEnv();

  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({ origin: env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()) });

  await app.listen(env.API_PORT);
  // eslint-disable-next-line no-console
  console.log(`[api] listening on :${env.API_PORT} (${env.NODE_ENV})`);
}

bootstrap();
