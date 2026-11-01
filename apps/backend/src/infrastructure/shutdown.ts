import type { INestApplicationContext } from '@nestjs/common';

export function installShutdown(app: INestApplicationContext, timeoutMs: number) {
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => {
      process.exit(1);
    }, timeoutMs);
    void app.close().then(
      () => {
        clearTimeout(deadline);
        process.removeListener('SIGTERM', stop);
        process.removeListener('SIGINT', stop);
      },
      () => {
        process.exitCode = 1;
      },
    );
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
