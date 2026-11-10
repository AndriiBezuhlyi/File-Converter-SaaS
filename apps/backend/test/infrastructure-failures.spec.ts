import { faultProxy } from './fixtures/fault-proxy.js';
import { infrastructureServers } from './fixtures/infrastructure-servers.js';
import { validateInfrastructureEnvironment } from '../src/infrastructure/config/infrastructure-config.js';
import { StorageService } from '../src/infrastructure/storage/storage.service.js';
import { EmailService } from '../src/infrastructure/email/email.service.js';

it('bounds storage/SMTP outages and recovers without public objects or false mail delivery', async () => {
  const servers = await infrastructureServers();
  const storageProxy = await faultProxy(servers.storagePort);
  const smtpProxy = await faultProxy(servers.smtpPort);
  const config = validateInfrastructureEnvironment({
    NODE_ENV: 'test',
    INFRA_TIMEOUT_MS: 2_000,
    S3_ENDPOINT: `http://127.0.0.1:${storageProxy.port}`,
    SMTP_PORT: smtpProxy.port,
  });
  const storage = new StorageService(config);
  const email = new EmailService(config);
  const key = storage.createKey('inputs');
  const bytes = Buffer.from('owned synthetic outage fixture');
  const message = { to: 'owned@example.test', subject: 'Recovery', text: 'Synthetic.' };
  try {
    await Promise.all([storage.start(), email.start()]);
    storageProxy.disconnect(true);
    smtpProxy.disconnect(true);
    const started = Date.now();
    await expect(
      storage.put(key, bytes, 'application/octet-stream', bytes.length),
    ).rejects.toThrow();
    await expect(email.send(message)).rejects.toThrow('Email delivery failed.');
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(servers.objects.size).toBe(0);
    expect(servers.messages).toHaveLength(0);
    storageProxy.disconnect(false);
    smtpProxy.disconnect(false);
    await Promise.all([storage.check(), email.check()]);
    await storage.put(key, bytes, 'application/octet-stream', bytes.length);
    expect((await storage.head(key)).sizeBytes).toBe(bytes.length);
    await email.send(message);
    expect(servers.messages).toHaveLength(1);
    expect(servers.requests.every((entry) => entry.signed && !entry.acl)).toBe(true);
    storageProxy.disconnect(true);
    await expect(storage.remove(key)).rejects.toThrow();
    expect(servers.objects.size).toBe(1);
    storageProxy.disconnect(false);
    await storage.remove(key);
    await storage.remove(key);
    expect(servers.objects.size).toBe(0);
  } finally {
    storage.stop();
    email.stop();
    await Promise.all([storageProxy.close(), smtpProxy.close()]);
    await servers.close();
  }
}, 30_000);
