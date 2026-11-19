import { createServer, type Server } from 'node:http';

export function createDiffServer(): Server {
  return createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Hello from the diff container');
  });
}
