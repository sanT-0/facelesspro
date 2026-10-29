import { describe, expect, it } from 'vitest';

import { DEFAULT_DATABASE_URL, databaseUrl, loadEnv } from './client';

describe('connection string', () => {
  it('agrees with .env.example and docker-compose.yml', () => {
    expect(DEFAULT_DATABASE_URL).toBe(
      'postgresql://faceless:faceless@127.0.0.1:5433/faceless',
    );
  });

  it('falls back to the documented default and ignores an empty variable', () => {
    const saved = process.env.DATABASE_URL;
    try {
      delete process.env.DATABASE_URL;
      expect(databaseUrl()).toBe(DEFAULT_DATABASE_URL);

      process.env.DATABASE_URL = '';
      expect(databaseUrl()).toBe(DEFAULT_DATABASE_URL);

      process.env.DATABASE_URL = 'postgresql://u:p@db:5432/x';
      expect(databaseUrl()).toBe('postgresql://u:p@db:5432/x');
    } finally {
      if (saved === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = saved;
    }
  });
});

describe('loadEnv', () => {
  it('is silent when there is no .env, because env vars are authoritative', () => {
    expect(() => loadEnv('.env.definitely-not-here')).not.toThrow();
  });
});
