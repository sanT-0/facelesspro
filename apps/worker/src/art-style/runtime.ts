/**
 * The real wiring for `build-art-style`: Postgres row, ffmpeg previews, the
 * `STYLE=…` vision chain and the disk under `DATA_DIR`.
 *
 * Kept out of `worker.ts` so the handler wiring stays testable with fakes and
 * `main.ts` only has to hand over one function. Everything the orchestration
 * needs is assembled here, once.
 */

import { join } from 'node:path';

import {
  PREVIEW_CLIP_FRAMES,
  PREVIEW_CLIP_SECONDS,
  PREVIEW_FPS,
} from '@facelesspro/core';
import type { ArtStyleBuildJob } from '@facelesspro/contracts';
import { artStyle } from '@facelesspro/db';
import type { Database } from '@facelesspro/db';
import { eq } from 'drizzle-orm';

import { sampleFrames } from './frame-sampling';
import { analyzeFrames } from './numeric-analysis';
import { buildArtStyle } from './build';
import type {
  ArtStyleBuildDeps,
  ArtStyleBuildStore,
  PreviewArtifact,
} from './build';
import { previewPlan } from './preview-plan';
import {
  buildPreviewClip,
  buildPreviewGrid,
  selectPreviewFrames,
  verifyPreviewClip,
  verifyPreviewGrid,
} from './preview';
import {
  dataDir,
  resolveStorageKey,
} from './storage';
import { createStyleVisionChainFromEnv } from './vision/factory';

export { previewPlan } from './preview-plan';
export type { PreviewPlan } from './preview-plan';

function createStore(db: Database): ArtStyleBuildStore {
  return {
    async load(styleId) {
      const rows = await db
        .select({ id: artStyle.id, formats: artStyle.formats, status: artStyle.status })
        .from(artStyle)
        .where(eq(artStyle.id, styleId))
        .limit(1);
      const row = rows[0];
      return row === undefined ? null : { id: row.id, formats: row.formats, status: row.status };
    },

    async markReady(input) {
      await db
        .update(artStyle)
        .set({
          profile: input.profile as unknown as Record<string, unknown>,
          status: 'ready',
          preview_url: input.previewKey,
          portrait_preview_url: input.portraitPreviewKey ?? null,
        })
        .where(eq(artStyle.id, input.styleId));
    },

    async markFailed(input) {
      await db
        .update(artStyle)
        .set({ status: 'failed' })
        .where(eq(artStyle.id, input.styleId));
    },
  };
}

export interface ArtStyleRuntimeOptions {
  readonly db: Database;
  readonly env?: NodeJS.ProcessEnv;
  readonly log?: (line: string) => void;
}

/**
 * Build the handler the worker registers on `ART_STYLE_QUEUE`.
 *
 * The chain is created once per process: adapters are stateless, and rebuilding
 * the chain per job would re-read `STYLE` for no reason.
 */
export function createArtStyleBuildHandler(
  options: ArtStyleRuntimeOptions,
): (job: ArtStyleBuildJob) => Promise<void> {
  const env = options.env ?? process.env;
  const log = options.log ?? ((line: string) => console.log(line));
  const root = dataDir(env);

  const vision = createStyleVisionChainFromEnv({
    env,
    logger: (line) => log(`[worker] ${line}`),
  });

  const deps: ArtStyleBuildDeps = {
    store: createStore(options.db),
    resolve(key) {
      return resolveStorageKey(root, key);
    },
    async sample(referencePath, styleId) {
      const samples = await sampleFrames(styleId, referencePath, {
        framesRoot: join(root, 'frames'),
      });
      return samples.map((sample) => sample.path);
    },
    analyze: analyzeFrames,
    describe: (request) => vision.describe(request),
    async renderPreviews(input) {
      const plan = previewPlan(input.profile, input.formats);
      const framePaths = selectPreviewFrames(input.framePaths);
      const palette = input.profile.palette;
      const inkColor = input.profile.line.color;
      const artifacts: PreviewArtifact[] = [];

      const gridPath = resolveStorageKey(root, input.keys.grid);
      await buildPreviewGrid({
        framePaths,
        palette,
        inkColor,
        outPath: gridPath,
        canvas: plan.grid,
      });
      artifacts.push({ kind: 'grid', key: input.keys.grid, path: gridPath, canvas: plan.grid });

      if (plan.portrait !== null) {
        const portraitPath = resolveStorageKey(root, input.keys.portrait);
        await buildPreviewGrid({
          framePaths,
          palette,
          inkColor,
          outPath: portraitPath,
          canvas: plan.portrait,
          portrait: true,
        });
        artifacts.push({
          kind: 'portrait',
          key: input.keys.portrait,
          path: portraitPath,
          canvas: plan.portrait,
        });
      }

      const clipPath = resolveStorageKey(root, input.keys.clip);
      await buildPreviewClip({
        framePaths,
        palette,
        inkColor,
        outPath: clipPath,
        canvas: plan.clip,
      });
      artifacts.push({
        kind: 'clip',
        key: input.keys.clip,
        path: clipPath,
        canvas: plan.clip,
        clip: {
          fps: PREVIEW_FPS,
          frames: PREVIEW_CLIP_FRAMES,
          seconds: PREVIEW_CLIP_SECONDS,
        },
      });

      return artifacts;
    },
    async verifyPreviews(artifacts) {
      for (const artifact of artifacts) {
        if (artifact.kind === 'clip') {
          const clip = artifact.clip;
          if (clip === undefined) throw new Error(`preview clip ${artifact.path} has no expectation`);
          await verifyPreviewClip(artifact.path, {
            canvas: artifact.canvas,
            fps: clip.fps,
            frames: clip.frames,
            seconds: clip.seconds,
          });
        } else {
          await verifyPreviewGrid(artifact.path, artifact.canvas);
        }
      }
    },
  };

  return async (job) => {
    try {
      await buildArtStyle(job, deps);
      log(`[worker] art style ${job.styleId} ready`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`[worker] art style ${job.styleId} failed: ${message}`);
      throw error;
    }
  };
}
