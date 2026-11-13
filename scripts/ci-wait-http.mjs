import { setTimeout } from 'node:timers/promises';

const url = new URL(process.argv[2]);
if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password)
  throw new Error('An explicit loopback HTTP endpoint is required.');
const deadline = Date.now() + 60_000;
let ready = false;
while (Date.now() < deadline) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    await response.body?.cancel();
    if (response.ok) {
      ready = true;
      break;
    }
  } catch {
    // Startup can temporarily refuse connections.
  }
  await setTimeout(500);
}
if (!ready) throw new Error('Local HTTP readiness deadline exceeded.');
