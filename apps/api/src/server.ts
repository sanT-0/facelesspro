import { serve } from '@hono/node-server';
import { app } from './app';

const port = Number(process.env.PORT ?? 3001);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`facelesspro-api listening on http://127.0.0.1:${info.port}`);
});
