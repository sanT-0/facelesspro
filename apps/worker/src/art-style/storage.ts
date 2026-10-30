/**
 * Disk storage for art-style artifacts — docs/03 §5.
 *
 * The repo has one disk root, `DATA_DIR` (default `./storage`): uploads land in
 * `references/`, sampled frames in `frames/<styleId>/`, previews in
 * `art-styles/<styleId>/`. Keys are POSIX-style and relative; a URL is derived
 * later by the api's `/files/*` route, so the database stores a **key** and not
 * an absolute host that would break on the next deployment.
 *
 * Deliberately not a full `StoragePort` yet: only the disk adapter is needed
 * for previews, and an S3 adapter should arrive with `put/get` semantics rather
 * than be guessed from these three helpers. Every write here goes through
 * ffmpeg, so there is no `putBytes` to abstract.
 *
 * This module is the only place allowed to join a key onto a path. It rejects
 * `..`, empty segments, absolute keys and backslashes, then re-checks the
 * resolved path is still inside the root — a key that escaped would let an
 * upload name decide where the worker writes.
 */

import { mkdir, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Absolute root for every disk artifact. `DATA_DIR` is the only input. */
export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.DATA_DIR?.trim();
  return resolve(
    configured !== undefined && configured.length > 0 ? configured : join(process.cwd(), 'storage'),
  );
}

function assertSegment(segment: string): void {
  if (!SEGMENT.test(segment)) {
    throw new TypeError(
      `invalid storage path segment ${JSON.stringify(segment)}; ` +
        'use letters, digits, dot, dash or underscore',
    );
  }
}

/** Join validated segments into a POSIX key (never a filesystem path). */
export function storageKey(...segments: readonly string[]): string {
  if (segments.length === 0) throw new TypeError('storageKey needs at least one segment');
  for (const segment of segments) assertSegment(segment);
  return segments.join('/');
}

/** Resolve a key inside `root`, refusing anything that would escape it. */
export function resolveStorageKey(root: string, key: string): string {
  const segments = key.split('/');
  if (segments.length === 0) throw new TypeError('storage key is empty');
  for (const segment of segments) assertSegment(segment);

  const resolvedRoot = resolve(root);
  const resolved = resolve(resolvedRoot, ...segments);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + sep)) {
    throw new RangeError(`storage key ${JSON.stringify(key)} escapes ${resolvedRoot}`);
  }
  if (resolved === resolvedRoot) {
    throw new TypeError(`storage key ${JSON.stringify(key)} resolves to the storage root`);
  }
  return resolved;
}

/** Keys written for one style. Overwritten on a rebuild, never appended. */
export function previewKeys(styleId: string): {
  readonly grid: string;
  readonly portrait: string;
  readonly clip: string;
} {
  return {
    grid: storageKey('art-styles', styleId, 'preview.png'),
    portrait: storageKey('art-styles', styleId, 'preview-portrait.png'),
    clip: storageKey('art-styles', styleId, 'preview.mp4'),
  };
}

/**
 * Public URL for a key, once the api serves `/files/*`.
 *
 * A trailing slash in `PUBLIC_BASE_URL` does not produce `//files`. Each
 * segment is URL-encoded because a key may contain dots or dashes but never a
 * slash inside one.
 */
export function publicUrlForKey(key: string, baseUrl: string): string {
  const segments = key.split('/');
  for (const segment of segments) assertSegment(segment);
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (trimmed.length === 0) throw new TypeError('PUBLIC_BASE_URL is empty');
  return `${trimmed}/files/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;
}

/** Create the parent directory of an output path. */
export async function ensureParentPath(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

/** Byte size, or `null` when the file does not exist. */
export async function fileSize(path: string): Promise<number | null> {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}
