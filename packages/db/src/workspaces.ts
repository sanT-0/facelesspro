/**
 * Workspace, credit ledger, and balance ledger reads (docs/01 §8, docs/07 §2.3).
 *
 * The api may not import `drizzle-orm` or `pg` (eslint enforces the boundary),
 * so API-facing queries live here and are injected into routes as plain
 * functions.
 */

import { and, desc, eq, isNull, or } from 'drizzle-orm';

import type { Database } from './client';
import { balanceLedger, creditLedger, member, user, voice, workspace } from './schema';
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
}> = [
  {
    id: 'swish',
    name: 'Swish',
    url: '/audio/sfx/swish.mp3',
    durationMs: 1200,
    tags: ['transition', 'whoosh'],
  },
  {
    id: 'click',
    name: 'Click',
    url: '/audio/sfx/click.mp3',
    durationMs: 300,
    tags: ['ui', 'button'],
  },
  {
    id: 'ding',
    name: 'Ding',
    url: '/audio/sfx/ding.mp3',
    durationMs: 800,
    tags: ['notification', 'alert'],
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
}> = [
  {
    id: 'minecraft-gameplay',
    name: 'Minecraft Gameplay',
    url: '/backgrounds/minecraft.mp4',
    durationMs: 600_000,
    thumbnailUrl: '/backgrounds/minecraft-thumb.jpg',
    tags: ['gameplay', 'sandbox'],
  },
  {
    id: 'subway-surfers',
    name: 'Subway Surfers',
    url: '/backgrounds/subway-surfers.mp4',
    durationMs: 600_000,
    thumbnailUrl: '/backgrounds/subway-thumb.jpg',
    tags: ['gameplay', 'runner'],
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
