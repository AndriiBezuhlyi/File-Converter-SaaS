import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from '../worker.module.js';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  // Keep the empty process alive until queue consumers provide their own connections.
  const idle = setInterval(() => undefined, 60_000);
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    clearInterval(idle);
    void app.close().catch(() => {
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  Logger.log('Worker context ready. No processors are registered.', 'WorkerBootstrap');
}

void bootstrap().catch(() => {
  console.error('Worker bootstrap failed.');
  process.exitCode = 1;
});
