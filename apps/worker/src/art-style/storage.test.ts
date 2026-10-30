import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  dataDir,
  ensureParentPath,
  fileSize,
  previewKeys,
  publicUrlForKey,
  resolveStorageKey,
  storageKey,
} from './storage';

const cleanups: string[] = [];

afterEach(async () => {
  for (const path of cleanups.splice(0)) {
    await rm(path, { recursive: true, force: true });
  }
});

describe('dataDir', () => {
  it('uses DATA_DIR when set, otherwise ./storage', () => {
    expect(dataDir({ DATA_DIR: '.data' })).toBe(resolve('.data'));
    expect(dataDir({})).toBe(resolve(process.cwd(), 'storage'));
    expect(dataDir({ DATA_DIR: '   ' })).toBe(resolve(process.cwd(), 'storage'));
  });
});

describe('storageKey', () => {
  it('joins validated segments with POSIX separators', () => {
    expect(storageKey('art-styles', 'abc-123', 'preview.png')).toBe(
      'art-styles/abc-123/preview.png',
    );
  });

  it('rejects traversal, absolute paths, backslashes and dot segments', () => {
    expect(() => storageKey('..', 'x')).toThrow(/invalid storage path segment/);
    expect(() => storageKey('')).toThrow(/invalid storage path segment/);
    expect(() => storageKey('/abs')).toThrow(/invalid storage path segment/);
    expect(() => storageKey('a\\b')).toThrow(/invalid storage path segment/);
    expect(() => storageKey('.')).toThrow(/invalid storage path segment/);
  });
});

describe('resolveStorageKey', () => {
  it('resolves a key inside the root', () => {
    expect(resolveStorageKey('/data', 'art-styles/x/preview.png')).toBe(
      resolve('/data/art-styles/x/preview.png'),
    );
  });

  it('refuses a key that would leave the root', () => {
    expect(() => resolveStorageKey('/data', '../etc/passwd')).toThrow(/invalid storage path segment/);
    expect(() => resolveStorageKey('/data', 'a/../../b')).toThrow(/invalid storage path segment/);
    expect(() => resolveStorageKey('/data', '.')).toThrow(/invalid storage path segment/);
    expect(() => resolveStorageKey('/data', '')).toThrow(/invalid storage path segment/);
  });
});

describe('previewKeys', () => {
  it('names all three artifacts under one style directory', () => {
    expect(previewKeys('abc')).toEqual({
      grid: 'art-styles/abc/preview.png',
      portrait: 'art-styles/abc/preview-portrait.png',
      clip: 'art-styles/abc/preview.mp4',
    });
    expect(() => previewKeys('../abc')).toThrow(/invalid storage path segment/);
  });
});

describe('publicUrlForKey', () => {
  it('builds a /files URL without doubling a trailing slash', () => {
    expect(publicUrlForKey('art-styles/abc/preview.png', 'http://127.0.0.1:3001')).toBe(
      'http://127.0.0.1:3001/files/art-styles/abc/preview.png',
    );
    expect(publicUrlForKey('art-styles/abc/preview.png', 'https://x.test///')).toBe(
      'https://x.test/files/art-styles/abc/preview.png',
    );
  });

  it('rejects an empty base URL and an unsafe key', () => {
    expect(() => publicUrlForKey('a/b.png', '')).toThrow(/PUBLIC_BASE_URL/);
    expect(() => publicUrlForKey('../b.png', 'http://x')).toThrow(/invalid storage path segment/);
  });
});

describe('file helpers', () => {
  it('reports a byte size for a file and null for a missing path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'faceless-storage-'));
    cleanups.push(root);
    const target = join(root, 'nested', 'file.txt');

    expect(await fileSize(target)).toBeNull();
    await ensureParentPath(target);
    await writeFile(target, '12345');
    expect(await fileSize(target)).toBe(5);
  });
});
