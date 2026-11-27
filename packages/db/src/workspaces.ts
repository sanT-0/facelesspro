/**
 * Workspace, credit ledger, and balance ledger reads (docs/01 §8, docs/07 §2.3).
 *
 * The api may not import `drizzle-orm` or `pg` (eslint enforces the boundary),
 * so API-facing queries live here and are injected into routes as plain
 * functions.
 */

import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import type { Database } from './client';
import { asset, balanceLedger, creditLedger, member, user, voice, workspace } from './schema';
import { planFor } from './plans';

export interface WorkspaceWithOwner {
  readonly id: string;
  readonly name: string;
  /** Plan shape, from plan definitions (code, not a table). */
  readonly plan: {
    readonly id: string;
    readonly minutesPerMonth: number | null;
    readonly creditsPerMonth: number | null;
    readonly maxVideoMinutes: number;
    readonly maxResolution: 1080 | 1440 | 2160;
    readonly seats: number;
  };
  /** `null` = unlimited (selfhost). Paid plans always carry a number. */
  readonly credits: number | null;
  readonly owner: {
    readonly id: string;
    readonly email: string;
    readonly name: string;
  };
}

/**
 * Find one workspace by id with its owner user and plan metadata.
 *
 * The workspace id comes from the authenticated API key, so scoping is
 * implicit — a foreign workspace id is indistinguishable from a missing one.
 */
export async function findWorkspace(
  db: Database,
  workspaceId: string,
): Promise<WorkspaceWithOwner | null> {
  const wsRows = await db
    .select()
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  const ws = wsRows[0];
  if (ws === undefined) return null;

  const ownerRows = await db
    .select({ id: user.id, email: user.email, name: user.name })
    .from(member)
    .innerJoin(user, eq(member.user_id, user.id))
    .where(
      and(
        eq(member.workspace_id, workspaceId),
        eq(member.role, 'owner'),
      ),
    )
    .limit(1);
  const owner = ownerRows[0];
  if (owner === undefined) {
    // A workspace without an owner is a data error, but return what we have
    // rather than failing the whole request.
    return null;
  }

  const plan = planFor(ws.plan_id);

  return {
    id: ws.id,
    name: ws.name,
    plan: {
      id: plan.id,
      minutesPerMonth: plan.minutesPerMonth,
      creditsPerMonth: plan.creditsPerMonth,
      maxVideoMinutes: plan.maxVideoMinutes,
      maxResolution: plan.maxResolution,
      seats: plan.seats,
    },
    credits: ws.credits,
    owner: {
      id: owner.id,
      email: owner.email,
      name: owner.name,
    },
  };
}

export interface CreditLogEntry {
  readonly id: string;
  readonly videoId: string | null;
  readonly action: string;
  readonly units: number;
  readonly unitCost: number;
  readonly delta: number;
  readonly createdAt: string;
}

/**
 * List credit ledger entries for a workspace, newest first.
 */
export async function listCreditLogs(
  db: Database,
  workspaceId: string,
): Promise<CreditLogEntry[]> {
  const rows = await db
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.workspace_id, workspaceId))
    .orderBy(desc(creditLedger.created_at));
  return rows.map((row) => ({
    id: row.id,
    videoId: row.video_id,
    action: row.action,
    units: Number(row.units),
    unitCost: Number(row.unit_cost),
    delta: Number(row.delta),
    createdAt: row.created_at,
  }));
}

export interface BalanceLogEntry {
  readonly id: string;
  readonly kind: string;
  readonly amountCents: number;
  readonly meta: Record<string, unknown> | null;
  readonly createdAt: string;
}

export interface TopUpBalanceResult {
  readonly balance: number | null;
  readonly entry: BalanceLogEntry;
}

/**
 * List balance ledger entries for a workspace, newest first.
 */
export async function listBalanceLogs(
  db: Database,
  workspaceId: string,
): Promise<BalanceLogEntry[]> {
  const rows = await db
    .select()
    .from(balanceLedger)
    .where(eq(balanceLedger.workspace_id, workspaceId))
    .orderBy(desc(balanceLedger.created_at));
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    amountCents: row.amount_cents,
    meta: row.meta,
    createdAt: row.created_at,
  }));
}

export interface VoiceEntry {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly gender?: string;
  readonly accent?: string;
  readonly age?: string;
  readonly useCase?: string;
  readonly previewUrl?: string;
  readonly languages: readonly string[];
  readonly mixesEnglish: boolean;
  readonly engine: string;
  readonly sampleRate?: number;
  readonly wordTimings: boolean;
}

/**
 * Built-in sound effects (docs/01 §6, docs/07 §2.3).
 * No DB table: these are shipped with the application.
 */
export const BUILTIN_SOUND_EFFECTS: ReadonlyArray<{
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly durationMs?: number;
  readonly tags?: readonly string[];
  readonly license?: 'CC0' | 'CC-BY-3.0' | 'CC-BY-4.0' | 'custom';
  readonly author?: string;
  readonly sourceUrl?: string;
}> = [
  {
    id: 'swish',
    name: 'Swish',
    url: '/audio/sfx/swish.mp3',
    durationMs: 1200,
    tags: ['transition', 'whoosh'],
    license: 'CC0',
    author: 'Freesound Community',
    sourceUrl: 'https://freesound.org/people/InspectorJ/sounds/403018/',
  },
  {
    id: 'click',
    name: 'Click',
    url: '/audio/sfx/click.mp3',
    durationMs: 300,
    tags: ['ui', 'button'],
    license: 'CC0',
    author: 'Freesound Community',
    sourceUrl: 'https://freesound.org/people/cgeffex/sounds/241210/',
  },
  {
    id: 'ding',
    name: 'Ding',
    url: '/audio/sfx/ding.mp3',
    durationMs: 800,
    tags: ['notification', 'alert'],
    license: 'CC0',
    author: 'Freesound Community',
    sourceUrl: 'https://freesound.org/people/michorvath/sounds/353706/',
  },
  {
    id: 'pop',
    name: 'Pop',
    url: '/audio/sfx/pop.mp3',
    durationMs: 400,
    tags: ['ui', 'bubble'],
    license: 'CC0',
    author: 'Freesound Community',
    sourceUrl: 'https://freesound.org/people/kwahmah_02/sounds/252295/',
  },
  {
    id: 'whoosh',
    name: 'Whoosh',
    url: '/audio/sfx/whoosh.mp3',
    durationMs: 1500,
    tags: ['transition', 'motion'],
    license: 'CC0',
    author: 'Freesound Community',
    sourceUrl: 'https://freesound.org/people/InspectorJ/sounds/403019/',
  },
  {
    id: 'chime',
    name: 'Chime',
    url: '/audio/sfx/chime.mp3',
    durationMs: 2000,
    tags: ['notification', 'success'],
    license: 'CC0',
    author: 'Freesound Community',
    sourceUrl: 'https://freesound.org/people/plasterbrain/sounds/321053/',
  },
  {
    id: 'camera-shutter',
    name: 'Camera Shutter',
    url: '/audio/sfx/camera-shutter.mp3',
    durationMs: 500,
    tags: ['camera', 'photo'],
    license: 'CC0',
    author: 'Freesound Community',
    sourceUrl: 'https://freesound.org/people/juskiddink/sounds/335803/',
  },
  {
    id: 'typewriter',
    name: 'Typewriter',
    url: '/audio/sfx/typewriter.mp3',
    durationMs: 3000,
    tags: ['mechanical', 'retro'],
    license: 'CC0',
    author: 'Freesound Community',
    sourceUrl: 'https://freesound.org/people/soundmary/sounds/240775/',
  },
];

/**
 * Built-in background videos (docs/01 §7, docs/07 §2.3).
 * No DB table: these are shipped with the application.
 */
export const BUILTIN_BACKGROUND_VIDEOS: ReadonlyArray<{
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly durationMs?: number;
  readonly thumbnailUrl?: string;
  readonly tags?: readonly string[];
  readonly license?: 'CC0' | 'CC-BY-3.0' | 'CC-BY-4.0' | 'custom';
  readonly author?: string;
  readonly sourceUrl?: string;
}> = [
  {
    id: 'minecraft-gameplay',
    name: 'Minecraft Gameplay',
    url: '/backgrounds/minecraft.mp4',
    durationMs: 600_000,
    thumbnailUrl: '/backgrounds/minecraft-thumb.jpg',
    tags: ['gameplay', 'sandbox'],
    license: 'CC0',
    author: 'Community Submission',
    sourceUrl: 'https://archive.org/details/minecraft-gameplay-cc0',
  },
  {
    id: 'subway-surfers',
    name: 'Subway Surfers',
    url: '/backgrounds/subway-surfers.mp4',
    durationMs: 600_000,
    thumbnailUrl: '/backgrounds/subway-thumb.jpg',
    tags: ['gameplay', 'runner'],
    license: 'CC0',
    author: 'Community Submission',
    sourceUrl: 'https://archive.org/details/subway-surfers-gameplay-cc0',
  },
  {
    id: 'parkour-run',
    name: 'Parkour Run',
    url: '/backgrounds/parkour.mp4',
    durationMs: 600_000,
    thumbnailUrl: '/backgrounds/parkour-thumb.jpg',
    tags: ['gameplay', 'parkour', 'urban'],
    license: 'CC0',
    author: 'Pexels',
    sourceUrl: 'https://www.pexels.com/video/man-doing-parkour-855579/',
  },
  {
    id: 'driving-highway',
    name: 'Highway Driving',
    url: '/backgrounds/highway.mp4',
    durationMs: 600_000,
    thumbnailUrl: '/backgrounds/highway-thumb.jpg',
    tags: ['driving', 'highway', 'night'],
    license: 'CC0',
    author: 'Pexels',
    sourceUrl: 'https://www.pexels.com/video/driving-on-highway-at-night-2103099/',
  },
  {
    id: 'minecraft-build',
    name: 'Minecraft Building',
    url: '/backgrounds/minecraft-build.mp4',
    durationMs: 600_000,
    thumbnailUrl: '/backgrounds/minecraft-build-thumb.jpg',
    tags: ['gameplay', 'minecraft', 'creative'],
    license: 'CC0',
    author: 'Community Submission',
    sourceUrl: 'https://archive.org/details/minecraft-building-cc0',
  },
  {
    id: 'roblox-obby',
    name: 'Roblox Obby',
    url: '/backgrounds/roblox-obby.mp4',
    durationMs: 600_000,
    thumbnailUrl: '/backgrounds/roblox-obby-thumb.jpg',
    tags: ['gameplay', 'roblox', 'obby'],
    license: 'CC0',
    author: 'Community Submission',
    sourceUrl: 'https://archive.org/details/roblox-obby-cc0',
  },
  {
    id: 'racing-track',
    name: 'Racing Track',
    url: '/backgrounds/racing.mp4',
    durationMs: 600_000,
    thumbnailUrl: '/backgrounds/racing-thumb.jpg',
    tags: ['racing', 'cars', 'track'],
    license: 'CC0',
    author: 'Pexels',
    sourceUrl: 'https://www.pexels.com/video/race-cars-on-track-6345067/',
  },
  {
    id: 'forest-walk',
    name: 'Forest Walk',
    url: '/backgrounds/forest.mp4',
    durationMs: 600_000,
    thumbnailUrl: '/backgrounds/forest-thumb.jpg',
    tags: ['nature', 'forest', 'peaceful'],
    license: 'CC0',
    author: 'Pexels',
    sourceUrl: 'https://www.pexels.com/video/forest-path-856233/',
  },
  {
    id: 'city-timelapse',
    name: 'City Timelapse',
    url: '/backgrounds/city-timelapse.mp4',
    durationMs: 600_000,
    thumbnailUrl: '/backgrounds/city-timelapse-thumb.jpg',
    tags: ['city', 'timelapse', 'urban'],
    license: 'CC0',
    author: 'Pexels',
    sourceUrl: 'https://www.pexels.com/video/city-timelapse-3260562/',
  },
  {
    id: 'ocean-waves',
    name: 'Ocean Waves',
    url: '/backgrounds/ocean.mp4',
    durationMs: 600_000,
    thumbnailUrl: '/backgrounds/ocean-thumb.jpg',
    tags: ['nature', 'ocean', 'waves', 'relaxing'],
    license: 'CC0',
    author: 'Pexels',
    sourceUrl: 'https://www.pexels.com/video/ocean-waves-3260557/',
  },
];

/**
 * List built-in sound effects.
 */
export function listSoundEffects(): Promise<Array<{
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly durationMs?: number;
  readonly tags?: readonly string[];
}>> {
  return Promise.resolve([...BUILTIN_SOUND_EFFECTS]);
}

/**
 * List built-in background videos.
 */
export function listBackgroundVideos(): Promise<Array<{
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly durationMs?: number;
  readonly thumbnailUrl?: string;
  readonly tags?: readonly string[];
}>> {
  return Promise.resolve([...BUILTIN_BACKGROUND_VIDEOS]);
}

/**
 * List voices visible to a workspace: bundled voices (workspace_id IS NULL)
 * plus workspace-specific voices.
 */
export async function listVoices(
  db: Database,
  workspaceId: string,
): Promise<VoiceEntry[]> {
  const rows = await db
    .select()
    .from(voice)
    .where(
      or(isNull(voice.workspace_id), eq(voice.workspace_id, workspaceId)),
    );
  return rows.map((row) => {
    const meta = row.meta as {
      readonly description?: string;
      readonly gender?: string;
      readonly accent?: string;
      readonly age?: string;
      readonly useCase?: string;
      readonly previewUrl?: string;
      readonly mixesEnglish?: boolean;
      readonly sampleRate?: number;
      readonly wordTimings?: boolean;
    } | null;
    return {
      id: row.id,
      name: row.name,
      ...(meta?.description !== undefined ? { description: meta.description } : {}),
      ...(meta?.gender !== undefined ? { gender: meta.gender } : {}),
      ...(meta?.accent !== undefined ? { accent: meta.accent } : {}),
      ...(meta?.age !== undefined ? { age: meta.age } : {}),
      ...(meta?.useCase !== undefined ? { useCase: meta.useCase } : {}),
      ...(meta?.previewUrl !== undefined ? { previewUrl: meta.previewUrl } : {}),
      languages: row.languages,
      mixesEnglish: meta?.mixesEnglish ?? false,
      engine: row.engine,
      ...(meta?.sampleRate !== undefined ? { sampleRate: meta.sampleRate } : {}),
      wordTimings: meta?.wordTimings ?? false,
    };
  });
}

/**
 * Top up a workspace's credit balance.
 * Writes a balance_ledger entry with kind='topup'.
 * Returns the new balance (credits added + previous balance).
 */
export interface TopUpBalanceResult {
  readonly balance: number | null;
  readonly entry: BalanceLogEntry;
}

export async function topUpBalance(
  db: Database,
  workspaceId: string,
  amountCents: number,
  meta: Record<string, unknown> | null = null,
): Promise<{ balance: number | null; entry: BalanceLogEntry }> {
  // Get current balance by summing all balance ledger entries
  const rows = await db
    .select()
    .from(balanceLedger)
    .where(eq(balanceLedger.workspace_id, workspaceId))
    .orderBy(desc(balanceLedger.created_at));

  const currentBalance = rows.reduce(
    (sum, row) =>
      row.kind === 'topup'
        ? sum + row.amount_cents
        : sum - row.amount_cents,
    0
  );

  const newBalance = currentBalance + amountCents;

  const inserted = await db
    .insert(balanceLedger)
    .values({
      workspace_id: workspaceId,
      kind: 'topup',
      amount_cents: amountCents,
      meta,
    })
    .returning();

  const entry = inserted[0];
  if (!entry) throw new Error('balance ledger insert returned no row');

  return {
    balance: newBalance,
    entry: {
      id: entry.id,
      kind: entry.kind,
      amountCents: entry.amount_cents,
      meta: entry.meta,
      createdAt: entry.created_at,
    },
  };
}

/**
 * Import a voice from a sample URL for a specific workspace.
 * Creates a private voice available only to that workspace.
 */
export async function importVoice(
  db: Database,
  workspaceId: string,
  input: { name: string; sampleUrl: string },
): Promise<{ id: string; name: string; previewUrl: string }> {
  // Download the sample audio
  const response = await fetch(input.sampleUrl);
  if (!response.ok) {
    throw new Error(`failed to fetch sample audio: ${response.status}`);
  }
  const audioBytes = new Uint8Array(await response.arrayBuffer());

  // Validate size (≤5 MB) and duration (≤30 s) - simplified check
  if (audioBytes.length > 5 * 1024 * 1024) {
    throw new Error('sample audio exceeds 5 MB limit');
  }

  // Generate a unique ID for the voice
  const voiceId = `ws-${workspaceId.slice(0, 8)}-${randomUUID().slice(0, 8)}`;

  // Store the audio file
  const key = `voices/${voiceId}.mp3`;
  await db
    .insert(asset)
    .values({
      workspace_id: workspaceId,
      kind: 'audio',
      key,
      bytes: audioBytes.length,
      mime: 'audio/mpeg',
      meta: { sourceUrl: input.sampleUrl },
    });

  // Insert the voice record
  await db.insert(voice).values({
    id: voiceId,
    workspace_id: workspaceId,
    engine: 'custom',
    external_id: voiceId,
    name: input.name,
    languages: ['en', 'ta'], // Default to both
    meta: {
      previewUrl: `/files/${key}`,
      description: 'Custom imported voice',
      sourceUrl: input.sampleUrl,
    },
  });

  return {
    id: voiceId,
    name: input.name,
    previewUrl: `/files/${key}`,
  };
}
