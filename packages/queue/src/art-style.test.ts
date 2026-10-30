import { describe, expect, it, vi } from 'vitest';
import type PgBoss from 'pg-boss';

import {
  ART_STYLE_QUEUE,
  ART_STYLE_QUEUE_OPTIONS,
  enqueueArtStyleBuild,
  parseArtStyleJob,
} from './art-style';
import { InvalidJobError } from './jobs';

const styleId = '11111111-1111-4111-8111-111111111111';
const job = { styleId, referenceKey: 'references/reference.mp4' };

describe('parseArtStyleJob', () => {
  it('accepts a style id and a relative reference key', () => {
    expect(parseArtStyleJob(job)).toEqual(job);
  });

  it('rejects a path that could leave the storage root', () => {
    for (const referenceKey of [
      '../references/x.mp4',
      'references/../../x.mp4',
      '/references/x.mp4',
      'references\\x.mp4',
      'references//x.mp4',
    ]) {
      expect(() => parseArtStyleJob({ ...job, referenceKey })).toThrow(InvalidJobError);
    }
  });

  it('rejects a non-uuid style id and missing fields', () => {
    expect(() => parseArtStyleJob({ ...job, styleId: 'style-1' })).toThrow(InvalidJobError);
    expect(() => parseArtStyleJob({ styleId })).toThrow(InvalidJobError);
    expect(() => parseArtStyleJob(null)).toThrow(InvalidJobError);
  });
});

describe('enqueueArtStyleBuild', () => {
  it('sends one job with the style as its singleton key', async () => {
    const send = vi.fn(async () => 'job-1');
    const boss = { send } as unknown as PgBoss;

    await expect(enqueueArtStyleBuild(boss, job)).resolves.toBe('job-1');

    expect(send).toHaveBeenCalledWith(ART_STYLE_QUEUE, job, {
      ...ART_STYLE_QUEUE_OPTIONS,
      singletonKey: styleId,
    });
  });

  it('passes a transaction handle and a start delay through', async () => {
    const send = vi.fn(async () => 'job-2');
    const boss = { send } as unknown as PgBoss;
    const db = {} as PgBoss.Db;
    const startAfter = new Date('2026-10-30T00:00:00.000Z');

    await enqueueArtStyleBuild(boss, job, { db, startAfter });

    expect(send).toHaveBeenCalledWith(ART_STYLE_QUEUE, job, {
      ...ART_STYLE_QUEUE_OPTIONS,
      singletonKey: styleId,
      db,
      startAfter,
    });
  });

  it('is a distinct queue from every video step', () => {
    expect(ART_STYLE_QUEUE).toBe('build-art-style');
  });
});
