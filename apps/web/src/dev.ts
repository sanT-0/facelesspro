/**
 * `facelesspro-web` dev server.
 *
 * Serves the bundled web app static files and proxies `/v1/*` requests to the
 * API server so the frontend can call the API from the same origin (avoiding
 * CORS issues in development).
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { context } from 'esbuild';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = __dirname;
const DIST_DIR = resolve(__dirname, '..', 'dist');
const API_BASE = process.env.API_BASE_URL || 'http://127.0.0.1:3001';
const PORT = Number(process.env.PORT ?? 3003);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function serveFile(res: ServerResponse, filePath: string): void {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
}

async function proxyToApi(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
): Promise<void> {
  const target = `${API_BASE}${path}`;
  const bodyChunks: Buffer[] = [];
  for await (const chunk of req) {
    bodyChunks.push(chunk);
  }
  const body = Buffer.concat(bodyChunks);

  try {
    const response = await fetch(target, {
      method: req.method ?? 'GET',
      headers: {
        ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
        ...(req.headers['content-type']
          ? { 'content-type': req.headers['content-type'] as string }
          : {}),
      },
      body: body.length ? body : undefined,
    });
    const responseBody = await response.arrayBuffer();
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'content-length') return;
      responseHeaders[key] = value;
    });
    res.writeHead(response.status, responseHeaders);
    res.end(Buffer.from(responseBody));
  } catch {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('API proxy error');
  }
}

async function startDevServer(): Promise<void> {
  // Bundle the app with esbuild in watch mode.
  const ctx = await context({
    entryPoints: ['src/main.ts'],
    bundle: true,
    outfile: join(DIST_DIR, 'bundle.js'),
    minify: false,
    sourcemap: true,
    target: 'es2020',
  });
  await ctx.watch();
  console.log('[web] esbuild watch mode started');

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '', `http://localhost:${PORT}`);
    const pathname = url.pathname;

    // Proxy API requests to the backend.
    if (pathname.startsWith('/v1/') || pathname === '/health') {
      await proxyToApi(req, res, pathname);
      return;
    }

    // Serve static files.
    let filePath: string;
    if (pathname === '/' || pathname === '') {
      filePath = join(PUBLIC_DIR, 'index.html');
    } else if (pathname === '/styles.css') {
      filePath = join(PUBLIC_DIR, 'styles.css');
    } else {
      filePath = join(DIST_DIR, pathname.slice(1));
    }

    try {
      await import('node:fs/promises').then((fs) => fs.access(filePath));
      serveFile(res, filePath);
    } catch {
      // Fall back to index.html for client-side routing.
      serveFile(res, join(PUBLIC_DIR, 'index.html'));
    }
  });

  server.listen(PORT, () => {
    console.log(`[web] dev server listening on http://127.0.0.1:${PORT}`);
    console.log(`[web] proxying API to ${API_BASE}`);
  });

  process.on('SIGINT', () => {
    server.close();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    server.close();
    process.exit(0);
  });
}

await startDevServer();
