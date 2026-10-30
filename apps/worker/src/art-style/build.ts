/**
 * One art-style build, start to finish — docs/04 §4.
 *
 * sample → numeric → vision → merge → previews → verify → `status=ready`.
 *
 * The order is the contract, and the last step is deliberately the only one
 * that writes `ready`: `verifyPreviews` receives real files and throws when one
 * is missing, the wrong size, or the clip is not silent/6 s. A build that
 * produced a profile but no usable preview therefore ends `failed`, never
 * `ready`. A rerun overwrites the same keys, so the job is idempotent; a row
 * already `ready` is left alone instead of re-billed for a VLM call.
 *
 * Dependencies are injected — ffmpeg, the model chain, the filesystem and the
 * database are all ports here — so the orchestration tests need none of them.
 */

import type {
  ArtStyleBuildJob,
  ArtStyleStatus,
  NumericStyleProfile,
  StyleProfile,
  StyleVision,
} from '@facelesspro/contracts';

import { mergeStyleProfile } from './merge';
import { previewKeys } from './storage';

export interface PreviewSize {
  readonly width: number;
  readonly height: number;
}

export interface PreviewArtifact {
  readonly kind: 'grid' | 'portrait' | 'clip';
  readonly key: string;
  readonly path: string;
  /** Expected geometry, so verification needs no hidden state. */
  readonly canvas: PreviewSize;
  /** Clip only. */
  readonly clip?: {
    readonly fps: number;
    readonly frames: number;
    readonly seconds: number;
  };
}

export interface LoadedArtStyle {
  readonly id: string;
  readonly formats: readonly string[];
  readonly status: ArtStyleStatus;
}

export interface MarkReadyInput {
  readonly styleId: string;
  readonly profile: StyleProfile;
  readonly previewKey: string;
  readonly portraitPreviewKey?: string;
}

export interface ArtStyleBuildStore {
  load(styleId: string): Promise<LoadedArtStyle | null>;
  markReady(input: MarkReadyInput): Promise<void>;
  markFailed(input: { readonly styleId: string; readonly message: string }): Promise<void>;
}

export interface RenderPreviewsInput {
  readonly styleId: string;
  readonly framePaths: readonly string[];
  readonly profile: StyleProfile;
  readonly formats: readonly string[];
  readonly keys: ReturnType<typeof previewKeys>;
}

export interface ArtStyleBuildDeps {
  readonly store: ArtStyleBuildStore;
  /** Storage key → absolute path. Injected so tests never touch a real root. */
  resolve(key: string): string;
  sample(referencePath: string, styleId: string): Promise<readonly string[]>;
  analyze(framePaths: readonly string[]): Promise<NumericStyleProfile>;
  describe(request: {
    readonly framePaths: readonly string[];
    readonly numeric: NumericStyleProfile;
  }): Promise<StyleVision>;
  renderPreviews(input: RenderPreviewsInput): Promise<readonly PreviewArtifact[]>;
  verifyPreviews(artifacts: readonly PreviewArtifact[]): Promise<void>;
}

export type ArtStyleBuildResult =
  | { readonly status: 'ready' }
  | { readonly status: 'failed'; readonly message: string };

/**
 * Build one style.
 *
 * @throws only when the row does not exist — there is nothing to mark failed,
 *         and a job for a deleted style is a producer bug worth surfacing.
 */
export async function buildArtStyle(
  job: ArtStyleBuildJob,
  deps: ArtStyleBuildDeps,
): Promise<ArtStyleBuildResult> {
  const row = await deps.store.load(job.styleId);
  if (row === null) {
    throw new Error(`art style ${job.styleId} not found`);
  }

  // Already built: a duplicate job must not pay for another VLM call or
  // rewrite previews that are currently serving users.
  if (row.status === 'ready') {
    return { status: 'ready' };
  }

  try {
    const framePaths = await deps.sample(deps.resolve(job.referenceKey), job.styleId);
    const numeric = await deps.analyze(framePaths);
    const vision = await deps.describe({ framePaths, numeric });
    const profile = mergeStyleProfile(numeric, vision);
    const keys = previewKeys(job.styleId);

    const artifacts = await deps.renderPreviews({
      styleId: job.styleId,
      framePaths,
      profile,
      formats: row.formats,
      keys,
    });

    const grid = artifacts.find((artifact) => artifact.kind === 'grid');
    if (grid === undefined || !artifacts.some((artifact) => artifact.kind === 'clip')) {
      throw new Error('preview build did not return both a grid and a clip');
    }

    // The gate: files first, status second.
    await deps.verifyPreviews(artifacts);

    const portrait = artifacts.find((artifact) => artifact.kind === 'portrait');
    await deps.store.markReady({
      styleId: job.styleId,
      profile,
      previewKey: grid.key,
      ...(portrait === undefined ? {} : { portraitPreviewKey: portrait.key }),
    });

    return { status: 'ready' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.store.markFailed({ styleId: job.styleId, message });
    return { status: 'failed', message };
  }
}
