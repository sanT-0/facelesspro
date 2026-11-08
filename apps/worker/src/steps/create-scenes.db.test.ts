/**
 * The real voiceover commit against Postgres (docs/04 §1b).
 *
 * Run with `npm run test:db` after `docker compose up -d postgres`. The hermetic
 * suite proves the decisions; this proves the rows they produce satisfy the
 * shared contracts — the audio asset, the narration row (ASR words, empty
 * `runs`), the scene spans and the video's plan/duration — inside one
 * transaction.
 */

import { randomUUID } from 'node:crypto';

import {
  assetRowSchema,
  createAiVideoV3RequestSchema,
  narrationRowSchema,
  sceneRowSchema,
  videoRowSchema,
} from '@facelesspro/contracts';
import {
  asset,
  createDb,
  narration,
  scene,
  video,
  workspace,
} from '@facelesspro/db';
import type { Database } from '@facelesspro/db';
import type { CommitTx } from '@facelesspro/queue';
import { asc, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AsrTranscription } from '../ports/asr';
import {
  buildVoiceoverPlan,
  persistVoiceoverPlan,
  type PersistVoiceoverInput,
  type StoredVoiceover,
} from './create-scenes';

const TAMIL = 'வணக்கம் நண்பர்களே.';
const ENGLISH = 'Today we plan one useful scene.';
const VOICEOVER_URL = 'https://cdn.example.com/audio/narration.mp3';

const TRANSCRIPTION: AsrTranscription = {
  requestId: 'asr-db-1',
  language: 'ta',
  durationMs: 6_400,
  text: `${TAMIL} ${ENGLISH}`,
  segments: [
    {
      text: TAMIL,
      startMs: 120,
      endMs: 2_400,
      words: [
        { text: 'வணக்கம்', startMs: 120, endMs: 1_100 },
        { text: 'நண்பர்களே.', startMs: 1_200, endMs: 2_400 },
      ],
    },
    {
      text: ENGLISH,
      startMs: 2_700,
      endMs: 6_000,
      words: [
        { text: 'Today', startMs: 2_700, endMs: 3_200 },
        { text: 'we', startMs: 3_300, endMs: 3_600 },
        { text: 'plan', startMs: 3_700, endMs: 4_100 },
        { text: 'one', startMs: 4_200, endMs: 4_500 },
        { text: 'useful', startMs: 4_600, endMs: 5_200 },
        { text: 'scene.', startMs: 5_300, endMs: 6_000 },
      ],
    },
  ],
};

let db: Database;
let pool: Pool;
let workspaceId: string;
let videoId: string;

describe('create-scenes voiceover commit (Postgres)', () => {
  beforeAll(() => {
    const created = createDb();
    db = created.db;
    pool = created.pool;
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    const rows = await db
      .insert(workspace)
      .values({ name: `create-scenes-${randomUUID()}`, credits: null })
      .returning({ id: workspace.id });
    workspaceId = rows[0]!.id;

    const body = createAiVideoV3RequestSchema.parse({
      artStyleId: randomUUID(),
      voiceoverUrl: VOICEOVER_URL,
      size: 'landscape',
    });
    const videos = await db
      .insert(video)
      .values({
        workspace_id: workspaceId,
        kind: 'ai-video-v3',
        status: 'processing',
        step: 'create-scenes',
        request: { kind: 'ai-video-v3', body },
      })
      .returning({ id: video.id });
    videoId = videos[0]!.id;
  });

  afterEach(async () => {
    await db.delete(narration).where(eq(narration.video_id, videoId));
    await db.delete(scene).where(eq(scene.video_id, videoId));
    await db.delete(asset).where(eq(asset.workspace_id, workspaceId));
    await db.delete(video).where(eq(video.id, videoId));
    await db.delete(workspace).where(eq(workspace.id, workspaceId));
  });

  it('writes the plan, scenes, audio asset and narration in one transaction', async () => {
    const plan = buildVoiceoverPlan(TRANSCRIPTION, { prefix: 'flat vector illustration' });
    const stored: StoredVoiceover = {
      key: `ws/${workspaceId}/videos/${videoId}/audio/narration.mp3`,
      bytes: 4_096,
      mime: 'audio/mpeg',
    };
    const input: PersistVoiceoverInput = {
      videoId,
      workspaceId,
      plan,
      transcription: TRANSCRIPTION,
      stored,
    };

    await db.transaction(async (tx) => {
      // The helper only reads `tx.db`; the queue owns the rest of CommitTx.
      await persistVoiceoverPlan({ db: tx } as unknown as CommitTx, input);
    });

    const [videoRow] = await db.select().from(video).where(eq(video.id, videoId));
    const parsedVideo = videoRowSchema.parse(videoRow);
    expect(parsedVideo.duration_ms).toBe(6_400);
    expect(parsedVideo.plan).toEqual(plan);

    const scenes = await db
      .select()
      .from(scene)
      .where(eq(scene.video_id, videoId))
      .orderBy(asc(scene.idx));
    expect(scenes.map((row) => sceneRowSchema.parse(row))).toMatchObject([
      { idx: 0, text: TAMIL, start_ms: 0, end_ms: 2_700 },
      { idx: 1, text: ENGLISH, start_ms: 2_700, end_ms: 6_400 },
    ]);

    const [narrationRow] = await db
      .select()
      .from(narration)
      .where(eq(narration.video_id, videoId));
    const parsedNarration = narrationRowSchema.parse(narrationRow);
    expect(parsedNarration.duration_ms).toBe(6_400);
    expect(parsedNarration.word_timings[0]).toEqual({
      text: 'வணக்கம்',
      start_ms: 120,
      end_ms: 1_100,
    });
    expect(parsedNarration.voice_plan).toEqual({
      script: TRANSCRIPTION.text,
      spokenText: TRANSCRIPTION.text,
      runs: [],
      overrides: [],
      pair: null,
    });

    const [assetRow] = await db
      .select()
      .from(asset)
      .where(eq(asset.id, parsedNarration.asset_id));
    expect(assetRowSchema.parse(assetRow)).toMatchObject({
      workspace_id: workspaceId,
      kind: 'audio',
      key: stored.key,
      bytes: stored.bytes,
      mime: 'audio/mpeg',
    });
  });
});
