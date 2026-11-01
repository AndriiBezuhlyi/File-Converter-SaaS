import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createServer as createTcpServer, type Server as TcpServer, type Socket } from 'node:net';

async function listen(server: HttpServer | TcpServer) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address.');
  return address.port;
}

// Minimal local protocol fixtures, not production-compatible storage or mail services.
export async function infrastructureServers() {
  const objects = new Map<string, { bytes: Buffer; contentType: string }>();
  const requests: { method: string; signed: boolean; acl: boolean }[] = [];
  const http = createHttpServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? '/', 'http://fixture.test').pathname;
      const key = path.split('/').slice(2).join('/');
      requests.push({
        method: request.method ?? '',
        signed: Boolean(request.headers.authorization),
        acl: 'x-amz-acl' in request.headers,
      });
      if (!key && request.method === 'HEAD') {
        response.end();
        return;
      }
      if (request.method === 'PUT') {
        const chunks: Buffer[] = [];
        for await (const chunk of request)
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
        objects.set(key, {
          bytes: Buffer.concat(chunks),
          contentType: String(request.headers['content-type'] ?? ''),
        });
        response.end();
        return;
      }
      if (request.method === 'DELETE') {
        objects.delete(key);
        response.statusCode = 204;
        response.end();
        return;
      }
      const object = objects.get(key);
      if (!object) {
        response.statusCode = 404;
        response.end();
        return;
      }
      response.setHeader('Content-Length', object.bytes.length);
      response.setHeader('Content-Type', object.contentType);
      response.end(request.method === 'HEAD' ? undefined : object.bytes);
    })().catch(() => {
      response.statusCode = 500;
      response.end();
    });
  });
  const sockets = new Set<Socket>();
  const messages: string[] = [];
  const smtp = createTcpServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.setEncoding('utf8');
    socket.write('220 fixture.test ESMTP\r\n');
    let buffered = '';
    let body: string[] | undefined;
    socket.on('data', (chunk: string) => {
      buffered += chunk;
      let end: number;
      while ((end = buffered.indexOf('\r\n')) >= 0) {
        const line = buffered.slice(0, end);
        buffered = buffered.slice(end + 2);
        if (body) {
          if (line === '.') {
            messages.push(body.join('\r\n'));
            body = undefined;
            socket.write('250 Accepted\r\n');
          } else body.push(line);
        } else if (/^EHLO|^HELO/.test(line)) socket.write('250-fixture.test\r\n250 PIPELINING\r\n');
        else if (line === 'DATA') {
          body = [];
          socket.write('354 End with dot\r\n');
        } else if (line === 'QUIT') socket.end('221 Bye\r\n');
        else socket.write('250 OK\r\n');
      }
    });
  });
  const storagePort = await listen(http);
  const smtpPort = await listen(smtp);
  return {
    storagePort,
    smtpPort,
    objects,
    requests,
    messages,
    async close() {
      for (const socket of sockets) socket.destroy();
      http.closeAllConnections();
      await Promise.all(
        [http, smtp].map(
          (server) =>
            new Promise<void>((resolve, reject) =>
              server.close((error) => (error ? reject(error) : resolve())),
            ),
        ),
      );
    },
  };
}
