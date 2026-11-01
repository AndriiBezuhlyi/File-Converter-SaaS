import { infrastructureServers } from './fixtures/infrastructure-servers.js';
import { validateInfrastructureEnvironment } from '../src/infrastructure/config/infrastructure-config.js';
import { StorageService } from '../src/infrastructure/storage/storage.service.js';
import { EmailService } from '../src/infrastructure/email/email.service.js';

it('round-trips signed private objects and sends SMTP mail through real SDK transports', async () => {
  const servers = await infrastructureServers();
  const config = validateInfrastructureEnvironment({
    NODE_ENV: 'test',
    S3_ENDPOINT: `http://127.0.0.1:${servers.storagePort}`,
    SMTP_PORT: servers.smtpPort,
  });
  const storage = new StorageService(config);
  const email = new EmailService(config);
  try {
    await Promise.all([storage.start(), email.start()]);
    expect(servers.messages).toHaveLength(0); // verify never sends a message.
    const key = storage.createKey('inputs');
    const bytes = Buffer.from('owned synthetic fixture');
    await storage.put(key, bytes, 'application/octet-stream', bytes.length);
    const metadata = await storage.head(key);
    expect(metadata.sizeBytes).toBe(bytes.length);
    const object = await storage.get(key);
    const chunks: Buffer[] = [];
    for await (const chunk of object.body)
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    expect(Buffer.concat(chunks).equals(bytes)).toBe(true);
    await storage.remove(key);
    await storage.remove(key);
    expect(servers.objects.size).toBe(0);
    expect(servers.requests.every((entry) => entry.signed && !entry.acl)).toBe(true);
    const count = servers.requests.length;
    await expect(storage.remove('../unowned-object')).rejects.toThrow('Invalid storage key.');
    expect(servers.requests).toHaveLength(count);
    await email.send({
      to: 'recipient@example.test',
      subject: 'Infrastructure probe',
      text: 'Synthetic delivery.',
    });
    expect(servers.messages).toHaveLength(1);
    expect(servers.messages[0]).toContain('Synthetic delivery.');
    await expect(
      email.send({ to: 'recipient@example.test', subject: 'invalid\r\nheader', text: '' }),
    ).rejects.toThrow('Invalid email envelope.');
  } finally {
    storage.stop();
    email.stop();
    await servers.close();
  }
});
