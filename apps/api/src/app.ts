import { Hono } from 'hono';

export const app = new Hono();

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    service: 'facelesspro-api',
    version: '0.1.0',
    time: new Date().toISOString(),
  }),
);
