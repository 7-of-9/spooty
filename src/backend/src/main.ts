import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as fs from 'fs';
import { resolve } from 'path';
import { spawn } from 'child_process';
import { EnvironmentEnum } from './environmentEnum';

async function bootstrap() {
  // Dev-server proxy sockets can outlive a browser reload. Close those HTTP
  // connections during shutdown so watch can start the replacement listener;
  // this does not terminate the independent acquisition CLI or remove jobs.
  const app = await NestFactory.create(AppModule, { forceCloseConnections: true });
  app.enableShutdownHooks();
  app.setGlobalPrefix('api');
  await app.listen(
    process.env.PORT || 3000,
    process.env[EnvironmentEnum.BIND_HOST] || '127.0.0.1',
  );
}
bootstrap();

if (!process.env[EnvironmentEnum.DOWNLOADS_PATH]) {
  throw new Error('DOWNLOADS_PATH environment variable is missing');
}
const folderName = resolve(
  __dirname,
  process.env[EnvironmentEnum.DOWNLOADS_PATH],
);
!fs.existsSync(folderName) && fs.mkdirSync(folderName);

const runRedis = /^(1|true|yes)$/i.test(
  process.env[EnvironmentEnum.REDIS_RUN] || '',
);
if (runRedis) {
  const redis = spawn(
    'redis-server',
    ['--port', String(process.env.REDIS_PORT || 6379)],
    { stdio: 'inherit' },
  );
  redis.on('error', (error) => {
    console.error('Unable to run Redis server from app');
    console.error(error);
  });
}
