/**
 * `create-captions`: narration timings → one cue track + four sidecars.
 *
 * Every sidecar is serialized from the same decorated cue list. The worker
 * never independently regroups SRT, VTT, ASS and JSON, so authored line breaks,
 * karaoke words, Tamil grapheme boundaries and optional emoji cannot drift.
 *
 * Pure cue/export work and disk writes happen after `withStep` claims the job
 * and before the commit opens. The transaction contains only asset rows, the
 * caption track, the subtitles ledger row and the cursor move.
 */

import {
  captionCueSchema,
  captionJsonExportSchema,
  captionTemplateRowSchema,
  createAiVideoRequestSchema,
  createAiVideoV3RequestSchema,
  createFakeTextVideoRequestSchema,
  createQuizVideoRequestSchema,
  createRobloxVideoRequestSchema,
  narrationRowSchema,
  videoRowSchema,
  type VideoKind,
} from '@facelesspro/contracts';
import type {
  CaptionCue,
  CaptionSpec,
  CaptionTemplateRow,
  NarrationRow,
  RenderOptions,
  Size,
} from '@facelesspro/contracts';
import {
  CAPTION_EXPORT_FORMATS,
  CAPTION_MAX_CHARS_PER_LINE,
  DEFAULT_CAPTION_TEMPLATE_ID,
  buildCaptionTrack,
  exportCaptions,
  renderDimensions,
} from '@facelesspro/core';
import type {
  AssStyleSpec,
  CaptionExportFormat,
  CaptionWord,
} from '@facelesspro/core';
import {
  asset,
  captionTrack,
  findCaptionTemplate,
  narration as narrationTable,
  video as videoTable,
} from '@facelesspro/db';
import type { Database } from '@facelesspro/db';
import { StepFailure, withStep } from '@facelesspro/queue';
import type {
  CommitTx,
  StepBody,
  StepDeps,
  StepHandler,
} from '@facelesspro/queue';
import { eq, sql } from 'drizzle-orm';
import { writeFile } from 'node:fs/promises';

import {
  dataDir,
  ensureParentPath,
  resolveStorageKey,
  storageKey,
} from '../art-style/storage';

export { DEFAULT_CAPTION_TEMPLATE_ID } from '@facelesspro/core';
export const DEFAULT_SUBTITLE_UNIT_COST = 20;

export type FindCaptionTemplate = (
  db: Database,
  id: number,
) => Promise<CaptionTemplateRow | null>;
export type LoadNarration = (
  db: Database,
  videoId: string,
) => Promise<NarrationRow | null>;

export interface CaptionArtifact {
  readonly format: CaptionExportFormat;
  readonly key: string;
  readonly mime: string;
  readonly bytes: Uint8Array;
}

export interface CaptionStoreInput {
  readonly workspaceId: string;
  readonly videoId: string;
  readonly artifacts: readonly CaptionArtifact[];
}

export type StoreCaptionArtifacts = (input: CaptionStoreInput) => Promise<void>;

export interface PersistCaptionsInput {
  readonly workspaceId: string;
  readonly videoId: string;
  readonly templateId: number;
  readonly cues: readonly CaptionCue[];
  readonly artifacts: readonly CaptionArtifact[];
}

export type PersistCaptions = (
  tx: CommitTx,
  input: PersistCaptionsInput,
) => Promise<void>;
export type CompleteProject = (tx: CommitTx, videoId: string) => Promise<void>;

export interface CreateCaptionsWorkDeps {
  readonly findTemplate?: FindCaptionTemplate;
  readonly loadNarration?: LoadNarration;
  readonly storeCaptionArtifacts?: StoreCaptionArtifacts;
  readonly persistCaptions?: PersistCaptions;
  readonly completeProject?: CompleteProject;
  readonly subtitleUnitCost?: number;
}

export interface CreateCaptionsHandlerDeps extends StepDeps, CreateCaptionsWorkDeps {}

/** Business body exported separately so unit tests need no Postgres or pg-boss. */
export function createCreateCaptionsWork(deps: CreateCaptionsWorkDeps = {}): StepBody {
  const lookupTemplate = deps.findTemplate ?? findCaptionTemplate;
  const load = deps.loadNarration ?? loadNarration;
  const store = deps.storeCaptionArtifacts ?? storeCaptionArtifacts;
  const persist = deps.persistCaptions ?? persistCaptions;
  const complete = deps.completeProject ?? completeProject;
  const unitCost = deps.subtitleUnitCost ?? DEFAULT_SUBTITLE_UNIT_COST;

  return async (ctx) => {
    const row = videoRowSchema.safeParse(ctx.video);
    if (!row.success) {
      throw new StepFailure('internal', 'stored video row does not match the video contract', {
        cause: row.error,
      });
    }
    // TypeScript narrowing: cast to the full VideoKind union so all branches
    // are reachable in the switch statement.
    const kind: VideoKind = row.data.kind;

    if (row.data.request.kind !== kind) {
      throw new StepFailure('internal', 'stored request kind does not match the video kind');
    }

    if (kind === 'caption' || kind === 'commentary') {
      throw new StepFailure(
        'internal',
        `create-captions received an unsupported video kind ${kind}`,
      );
    }

    let withCaptions: boolean;
    let templateId: number;
    let captionSpec: CaptionSpec | undefined;
    let size: Size;
    let render: RenderOptions | undefined;

    switch (kind) {
      case 'ai-video-v3': {
        const request = createAiVideoV3RequestSchema.safeParse(row.data.request.body);
        if (!request.success) {
          throw new StepFailure('internal', 'stored V3 request does not match the request contract', {
            cause: request.error,
          });
        }
        withCaptions = request.data.captions;
        templateId = request.data.captionTemplateId ?? DEFAULT_CAPTION_TEMPLATE_ID;
        captionSpec = request.data.captionSpec;
        size = request.data.size;
        render = request.data.render;
        break;
      }
      case 'roblox': {
        // Strip internal `_robloxAssets` key added by create-images before schema validation.
        const { _robloxAssets: _ignored, ...robloxBody } = row.data.request.body as Record<string, unknown>;
        const request = createRobloxVideoRequestSchema.safeParse(robloxBody);
        if (!request.success) {
          throw new StepFailure('internal', 'stored roblox request does not match the request contract', {
            cause: request.error,
          });
        }
        withCaptions = true;
        templateId = DEFAULT_CAPTION_TEMPLATE_ID;
        captionSpec = {
          wordLimit: request.data.captionWordLimit,
          emoji: request.data.autoAddEmoji,
        };
        size = 'portrait';
        render = request.data.render;
        break;
      }
      case 'quiz': {
        // Strip internal `_quizAssets` key added by create-images before schema validation.
        const { _quizAssets: _ignored, ...quizBody } = row.data.request.body as Record<string, unknown>;
        const request = createQuizVideoRequestSchema.safeParse(quizBody);
        if (!request.success) {
          throw new StepFailure('internal', 'stored quiz request does not match the request contract', {
            cause: request.error,
          });
        }
        // Quiz always captions its narration; same as V2.
        withCaptions = true;
        templateId = DEFAULT_CAPTION_TEMPLATE_ID;
        captionSpec = undefined;
        size = request.data.size;
        render = request.data.render;
        break;
      }
      case 'fake-text': {
        // Strip internal `_fakeTextScenes` key before schema validation.
        const { _fakeTextScenes: _ignored, ...fakeTextBody } = row.data.request.body as Record<string, unknown>;
        const request = createFakeTextVideoRequestSchema.safeParse(fakeTextBody);
        if (!request.success) {
          throw new StepFailure('internal', 'stored fake-text request does not match the request contract', {
            cause: request.error,
          });
        }
        // Fake text always captions its narration
        withCaptions = true;
        templateId = DEFAULT_CAPTION_TEMPLATE_ID;
        captionSpec = undefined;
        size = 'portrait';
        render = request.data.render;
        break;
      }
      default: {
        // V2 / caption / commentary
        const request = createAiVideoRequestSchema.safeParse(row.data.request.body);
        if (!request.success) {
          throw new StepFailure('internal', 'stored V2 request does not match the request contract', {
            cause: request.error,
          });
        }
        // V2 always captions its narration; the artwork-first opt-out is V3-only.
        withCaptions = true;
        templateId = DEFAULT_CAPTION_TEMPLATE_ID;
        captionSpec = undefined;
        size = request.data.size;
        render = request.data.render;
        break;
      }
    }

    // V3 is artwork-first. The stable step remains in the cursor even when the
    // user opted out, but it produces no artifact and no zero-value charge.
    if (!withCaptions) {
      await ctx.transaction(async (tx) => {
        if (render === undefined) {
          await complete(tx, ctx.videoId);
        } else {
          await tx.advance();
        }
      });
      return;
    }

    const candidateTemplate = await lookupTemplate(ctx.db, templateId);
    const selectedTemplate = parseUsableTemplate(
      candidateTemplate,
      row.data.workspace_id,
      templateId,
    );

    const candidateNarration = await load(ctx.db, ctx.videoId);
    if (candidateNarration === null) {
      throw new StepFailure('internal', 'create-captions found no narration row');
    }
    const parsedNarration = narrationRowSchema.safeParse(candidateNarration);
    if (!parsedNarration.success) {
      throw new StepFailure('internal', 'stored narration does not match the narration contract', {
        cause: parsedNarration.error,
      });
    }
    if (parsedNarration.data.video_id !== ctx.videoId) {
      throw new StepFailure('internal', 'stored narration belongs to a different video');
    }
    if (row.data.duration_ms === null) {
      throw new StepFailure('internal', 'video has no narration duration');
    }
    if (row.data.duration_ms !== parsedNarration.data.duration_ms) {
      throw new StepFailure('internal', 'video and narration durations do not match');
    }

    const words = captionWords(parsedNarration.data);
    // The per-video override wins over the template's own spec, so the style
    // saved through `POST /v1/videos/:id/captions` reaches cues, sidecars and
    // the ASS that `render` burns.
    const spec = { ...selectedTemplate.spec, ...(captionSpec ?? {}) };
    const cues = buildCues(words, spec, size);
    const artifacts = buildCaptionArtifacts(
      row.data.workspace_id,
      ctx.videoId,
      cues,
      spec,
      size,
    );

    await storeSafely(store, {
      workspaceId: row.data.workspace_id,
      videoId: ctx.videoId,
      artifacts,
    });

    ctx.observe({
      items: cues.length,
      bytes: artifacts.reduce((total, artifact) => total + artifact.bytes.byteLength, 0),
      costUnits: 1,
    });

    await ctx.transaction(async (tx) => {
      await persist(tx, {
        workspaceId: row.data.workspace_id,
        videoId: ctx.videoId,
        templateId: selectedTemplate.id,
        cues,
        artifacts,
      });
      await tx.charge({ action: 'subtitles', units: 1, unitCost });
      if (render === undefined) {
        await complete(tx, ctx.videoId);
      } else {
        await tx.advance();
      }
    });
  };
}

/** Queue handler: `withStep` owns locking, failures, idempotency and commit fencing. */
export function createCreateCaptionsHandler(
  deps: CreateCaptionsHandlerDeps,
): StepHandler {
  const work = createCreateCaptionsWork(deps);
  return async (job) => {
    await withStep(deps, job.videoId, 'create-captions', work);
  };
}

export async function loadNarration(
  db: Database,
  videoId: string,
): Promise<NarrationRow | null> {
  const rows = await db
    .select()
    .from(narrationTable)
    .where(eq(narrationTable.video_id, videoId))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : narrationRowSchema.parse(row);
}

export function captionKey(
  workspaceId: string,
  videoId: string,
  format: CaptionExportFormat,
): string {
  return storageKey('ws', workspaceId, 'videos', videoId, `captions.${format}`);
}

export async function storeCaptionArtifacts(input: CaptionStoreInput): Promise<void> {
  const root = dataDir();
  for (const artifact of input.artifacts) {
    const path = resolveStorageKey(root, artifact.key);
    await ensureParentPath(path);
    await writeFile(path, artifact.bytes);
  }
}

/** Everything the enabled branch writes, inside one `withStep` transaction. */
export async function persistCaptions(
  tx: CommitTx,
  input: PersistCaptionsInput,
): Promise<void> {
  const formats = new Set(input.artifacts.map((artifact) => artifact.format));
  const keys = new Set(input.artifacts.map((artifact) => artifact.key));
  if (
    input.cues.length === 0 ||
    input.artifacts.length !== CAPTION_EXPORT_FORMATS.length ||
    formats.size !== CAPTION_EXPORT_FORMATS.length ||
    CAPTION_EXPORT_FORMATS.some((format) => !formats.has(format)) ||
    keys.size !== input.artifacts.length ||
    input.artifacts.some((artifact) => artifact.bytes.byteLength === 0)
  ) {
    throw new StepFailure('internal', 'persistCaptions received an incomplete caption bundle');
  }

  const inserted = await tx.db
    .insert(asset)
    .values(
      input.artifacts.map((artifact) => ({
        workspace_id: input.workspaceId,
        kind: 'caption' as const,
        key: artifact.key,
        bytes: artifact.bytes.byteLength,
        mime: artifact.mime,
        meta: {
          format: artifact.format,
          templateId: input.templateId,
          cueCount: input.cues.length,
        },
      })),
    )
    .returning({ key: asset.key });
  const insertedKeys = new Set(inserted.map((row) => row.key));
  if (
    insertedKeys.size !== input.artifacts.length ||
    input.artifacts.some((artifact) => !insertedKeys.has(artifact.key))
  ) {
    throw new StepFailure('internal', 'caption asset insert returned the wrong rows');
  }

  await tx.db
    .insert(captionTrack)
    .values({
      video_id: input.videoId,
      template_id: input.templateId,
      cues: [...input.cues],
    })
    // `caption_track.video_id` is the primary key: re-narrating the video
    // replaces the cue track instead of violating it.
    .onConflictDoUpdate({
      target: captionTrack.video_id,
      set: {
        template_id: input.templateId,
        cues: [...input.cues],
      },
    });
}

/** Complete an editable project without inventing or enqueueing an MP4 render. */
export async function completeProject(tx: CommitTx, videoId: string): Promise<void> {
  await tx.db
    .update(videoTable)
    .set({
      status: 'completed',
      step: null,
      error: null,
      updated_at: sql`now()`,
    })
    .where(eq(videoTable.id, videoId));
  await tx.fireWebhook('completed');
}

function parseUsableTemplate(
  candidate: CaptionTemplateRow | null,
  workspaceId: string,
  templateId: number,
): CaptionTemplateRow {
  if (candidate === null) {
    throw new StepFailure('not_found', `caption template ${templateId} does not exist`);
  }
  const parsed = captionTemplateRowSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new StepFailure('internal', `caption template ${templateId} is invalid`, {
      cause: parsed.error,
    });
  }
  if (parsed.data.id !== templateId) {
    throw new StepFailure('internal', `caption template lookup returned ${parsed.data.id}`);
  }
  if (parsed.data.workspace_id !== null && parsed.data.workspace_id !== workspaceId) {
    throw new StepFailure('forbidden', 'caption template is not available to this workspace');
  }
  return parsed.data;
}

function captionWords(stored: NarrationRow): CaptionWord[] {
  if (stored.duration_ms <= 0) {
    throw new StepFailure('internal', 'narration duration is not positive');
  }
  if (stored.word_timings.length === 0) {
    throw new StepFailure('unprocessable', 'narration has no word timings for captions');
  }

  let previousEnd = 0;
  return stored.word_timings.map((word, index) => {
    if (word.text.length === 0 || /[\r\n]/u.test(word.text)) {
      throw new StepFailure('internal', `narration word ${index} has invalid text`);
    }
    if (word.end_ms < word.start_ms) {
      throw new StepFailure('internal', `narration word ${index} has an invalid timing span`);
    }
    if (word.start_ms < previousEnd) {
      throw new StepFailure('internal', `narration word ${index} overlaps the previous word`);
    }
    if (word.end_ms > stored.duration_ms) {
      throw new StepFailure('internal', `narration word ${index} ends after the master`);
    }
    previousEnd = word.end_ms;
    return { text: word.text, startMs: word.start_ms, endMs: word.end_ms };
  });
}

function buildCues(
  words: readonly CaptionWord[],
  spec: CaptionSpec,
  size: Size,
): CaptionCue[] {
  try {
    return buildCaptionTrack(words, {
      wordLimit: spec.wordLimit,
      maxLines: spec.maxLines,
      maxCharsPerLine: CAPTION_MAX_CHARS_PER_LINE[size],
      emoji: spec.emoji ?? false,
    }).map((cue) => captionCueSchema.parse(cue));
  } catch (error) {
    throw new StepFailure(
      'unprocessable',
      `could not build captions: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function buildCaptionArtifacts(
  workspaceId: string,
  videoId: string,
  cues: readonly CaptionCue[],
  spec: CaptionSpec,
  size: Size,
): CaptionArtifact[] {
  // Keep one 1080p design canvas. libass scales PlayRes to 2K/4K, so a later
  // re-render can reuse these exact sidecars instead of rebuilding captions.
  const dimensions = renderDimensions(1080, size);
  const style: AssStyleSpec = spec;
  try {
    const artifacts = CAPTION_EXPORT_FORMATS.map((format) => {
      const exported = exportCaptions(cues, format, { dimensions, style });
      return {
        format,
        key: captionKey(workspaceId, videoId, format),
        mime: exported.mimeType,
        bytes: Uint8Array.from(Buffer.from(exported.contents, 'utf8')),
      } satisfies CaptionArtifact;
    });

    const json = artifacts.find((artifact) => artifact.format === 'json');
    if (json === undefined) throw new Error('caption JSON export is missing');
    const document: unknown = JSON.parse(Buffer.from(json.bytes).toString('utf8'));
    captionJsonExportSchema.parse(document);
    return artifacts;
  } catch (error) {
    throw new StepFailure('internal', 'caption serializers produced an invalid sidecar', {
      cause: error,
    });
  }
}

/** A disk write is infrastructure: deterministic keys make a retry safe. */
async function storeSafely(
  store: StoreCaptionArtifacts,
  input: CaptionStoreInput,
): Promise<void> {
  try {
    await store(input);
  } catch (error) {
    throw new StepFailure(
      'internal',
      `could not store caption sidecars: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { retryable: true, cause: error },
    );
  }
}
