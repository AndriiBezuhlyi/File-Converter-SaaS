import { createServer, connect, type Socket } from 'node:net';

// Owned loopback services only. Disconnects real transports, not adapter methods.
export async function faultProxy(port: number) {
  let offline = false;
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    if (offline) return socket.destroy();
    const upstream = connect(port, '127.0.0.1');
    for (const connection of [socket, upstream]) {
      sockets.add(connection);
      connection.on('close', () => sockets.delete(connection));
      connection.on('error', () => {
        socket.destroy();
        upstream.destroy();
      });
    }
    socket.pipe(upstream).pipe(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address.');
  return {
    port: address.port,
    disconnect(value: boolean) {
      offline = value;
      if (value) for (const socket of sockets) socket.destroy();
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
