import 'reflect-metadata';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StorageService } from '../../infrastructure/storage/storage.service.js';
import { validateInfrastructureEnvironment } from '../../infrastructure/config/infrastructure-config.js';

it('enumerates only generated object keys with timestamps and preserves bounded S3 pagination', async () => {
  const key = `outputs/${randomUUID()}`;
  const queries: URLSearchParams[] = [];
  const server = createServer((request, response) => {
    expect(request.headers.authorization).toBeDefined();
    queries.push(new URL(request.url!, 'http://fixture.test').searchParams);
    response.setHeader('Content-Type', 'application/xml');
    response.end(`<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
      <IsTruncated>true</IsTruncated><NextContinuationToken>next-page</NextContinuationToken>
      <Contents><Key>${key}</Key><LastModified>2026-01-01T00:00:00.000Z</LastModified><Size>5</Size></Contents>
      <Contents><Key>outputs/unrelated</Key><LastModified>2026-01-01T00:00:00.000Z</LastModified></Contents>
      <Contents><Key>other/${randomUUID()}</Key><LastModified>2026-01-01T00:00:00.000Z</LastModified></Contents>
      </ListBucketResult>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address.');
  const storage = new StorageService(
    validateInfrastructureEnvironment({
      NODE_ENV: 'test',
      S3_ENDPOINT: `http://127.0.0.1:${address.port}`,
    }),
  );
  try {
    const page = await storage.list('outputs/', 'previous-page');
    expect(page).toEqual({
      items: [{ key, modifiedAt: new Date('2026-01-01T00:00:00Z') }],
      cursor: 'next-page',
    });
    expect(queries[0]!.get('max-keys')).toBe('100');
    expect(queries[0]!.get('prefix')).toBe('outputs/');
    expect(queries[0]!.get('continuation-token')).toBe('previous-page');
  } finally {
    storage.stop();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
