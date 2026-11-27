/**
 * Idempotent seed: built-in caption templates (negative ids, parity) and a dev
 * workspace on the `selfhost` plan.
 *
 * Plans are **code**, not rows: docs/03 §3 has no plan table, and the catalogue
 * in docs/01 §8 is a shape with no prices to copy. `workspace.plan_id` is the
 * pointer; whatever resolves it can stay a constant until billing exists.
 */

import { pathToFileURL } from 'node:url';

import type { Database } from './client';
import { artStyle, captionTemplate, member, user, workspace } from './schema';

/** Fixed ids make the seed re-runnable and keep editor links stable in dev. */
export const DEV_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
export const DEV_USER_ID = '00000000-0000-4000-8000-000000000002';

export const BUILTIN_CAPTION_TEMPLATES = [
  {
    id: -1,
    name: 'Bold Tamil',
    spec: {
      fontFamily: 'Noto Sans Tamil',
      fontSize: 72,
      wordLimit: 4,
      maxLines: 2,
      uppercase: false,
      emoji: false,
      position: 'bottom',
      highlightColor: '#FFD400',
      outlineColor: '#000000',
      outlineWidth: 6,
    },
  },
  {
    id: -2,
    name: 'Clean Sans',
    spec: {
      fontFamily: 'Noto Sans Tamil',
      fontSize: 56,
      wordLimit: 6,
      maxLines: 2,
      uppercase: false,
      emoji: false,
      position: 'bottom',
      outlineColor: '#000000',
      outlineWidth: 4,
    },
  },
  {
    id: -3,
    name: 'Emoji Pop',
    spec: {
      fontFamily: 'Noto Sans Tamil',
      fontSize: 64,
      wordLimit: 3,
      maxLines: 2,
      uppercase: true,
      emoji: true,
      position: 'center',
      highlightColor: '#FF4D8D',
      outlineColor: '#FFFFFF',
      outlineWidth: 5,
    },
  },
  {
    id: -4,
    name: 'Top Headline',
    spec: {
      fontFamily: 'Noto Sans Tamil',
      fontSize: 58,
      wordLimit: 5,
      maxLines: 2,
      uppercase: true,
      emoji: false,
      position: 'top',
      highlightColor: '#00E5FF',
      outlineColor: '#000000',
      outlineWidth: 5,
    },
  },
  {
    id: -5,
    name: 'Minimal Center',
    spec: {
      fontFamily: 'Noto Sans Tamil',
      fontSize: 52,
      wordLimit: 6,
      maxLines: 2,
      uppercase: false,
      emoji: false,
      position: 'center',
      highlightColor: '#FFFFFF',
      outlineColor: '#000000',
      outlineWidth: 2,
    },
  },
  {
    id: -6,
    name: 'Focus Word',
    spec: {
      fontFamily: 'Noto Sans Tamil',
      fontSize: 82,
      wordLimit: 2,
      maxLines: 2,
      uppercase: false,
      emoji: false,
      position: 'center',
      highlightColor: '#7CFF6B',
      outlineColor: '#000000',
      outlineWidth: 7,
    },
  },
] satisfies readonly (typeof captionTemplate.$inferInsert)[];

/** Built-in art styles with complete StyleProfiles (fixed UUIDs). */
export const BUILTIN_ART_STYLES = [
  {
    id: '00000000-0000-4000-8000-000000000101',
    workspace_id: null,
    name: 'Cinematic',
    published: true,
    formats: ['landscape', 'portrait'],
    profile: {
      version: 1,
      medium: 'cinematic live action',
      promptPrefix: 'cinematic shot, professional lighting, depth of field, ',
      palette: { hex: ['#1a283f', '#f1bf4d', '#fefefe', '#020202', '#e2562d'] },
      line: { weight: 'medium', color: '#1a283f', texture: 'smooth' },
      shading: 'cinematic',
      background: 'cinematic environment with dramatic lighting and atmospheric depth',
      composition: 'rule of thirds, leading lines, cinematic framing',
      characters: 'realistic proportions, natural poses, expressive faces',
      typography: 'clean sans-serif, minimal, high contrast',
      negative: 'cartoon, illustration, flat, oversaturated, blurry, low quality, watermark, text, logo',
      seedBase: 123456789,
      measured: {
        line: { strokeDensity: 0.65, edgeEnergy: 0.72 },
        tone: { saturation: { min: 0.2, max: 0.9, mean: 0.55 }, contrast: { min: 0.3, max: 0.95, mean: 0.65 }, brightness: { min: 0.1, max: 0.7, mean: 0.35 } },
        aspect: { width: 1920, height: 1080, ratio: 1.7777777777777777, orientation: 'landscape' },
        safeArea: { edgeContentRatio: 0.15, margin: 0.1 },
        frameCount: 5,
      },
      source: { adapter: 'heuristic', degradedFrom: [] },
    },
    preview_url: '/art-styles/builtin/cinematic-preview.png',
    portrait_preview_url: '/art-styles/builtin/cinematic-portrait-preview.png',
    sample_video_urls: [],
    status: 'ready',
    created_at: new Date('2026-10-27T09:00:00.000Z').toISOString(),
  },
  {
    id: '00000000-0000-4000-8000-000000000102',
    workspace_id: null,
    name: 'Clean Minimal',
    published: true,
    formats: ['landscape', 'portrait'],
    profile: {
      version: 1,
      medium: 'clean vector illustration',
      promptPrefix: 'minimal flat vector, clean lines, solid colors, ',
      palette: { hex: ['#ffffff', '#000000', '#0066cc', '#ff6600', '#00cc66'] },
      line: { weight: 'medium', color: '#000000', texture: 'crisp' },
      shading: 'flat',
      background: 'simple geometric background with negative space',
      composition: 'centered subject, balanced negative space, grid-aligned',
      characters: 'simplified geometric characters, clear silhouettes',
      typography: 'geometric sans-serif, bold, high readability',
      negative: 'photorealistic, 3d, gradient, texture, noise, complex patterns, watermark',
      seedBase: 987654321,
      measured: {
        line: { strokeDensity: 0.35, edgeEnergy: 0.45 },
        tone: { saturation: { min: 0.1, max: 0.8, mean: 0.4 }, contrast: { min: 0.2, max: 0.9, mean: 0.55 }, brightness: { min: 0.5, max: 1.0, mean: 0.85 } },
        aspect: { width: 1920, height: 1080, ratio: 1.7777777777777777, orientation: 'landscape' },
        safeArea: { edgeContentRatio: 0.05, margin: 0.1 },
        frameCount: 5,
      },
      source: { adapter: 'heuristic', degradedFrom: [] },
    },
    preview_url: '/art-styles/builtin/clean-minimal-preview.png',
    portrait_preview_url: '/art-styles/builtin/clean-minimal-portrait-preview.png',
    sample_video_urls: [],
    status: 'ready',
    created_at: new Date('2026-10-27T09:00:00.000Z').toISOString(),
  },
  {
    id: '00000000-0000-4000-8000-000000000103',
    workspace_id: null,
    name: 'Vibrant Anime',
    published: true,
    formats: ['landscape', 'portrait'],
    profile: {
      version: 1,
      medium: 'anime illustration',
      promptPrefix: 'anime style, cel shaded, vibrant colors, detailed linework, ',
      palette: { hex: ['#ff6b9d', '#4ecdc4', '#ffe66d', '#95e1d3', '#f38181'] },
      line: { weight: 'thin', color: '#2d2d2d', texture: 'clean' },
      shading: 'cel',
      background: 'detailed anime background with atmospheric perspective',
      composition: 'dynamic angle, speed lines, emotional framing',
      characters: 'anime proportions, large expressive eyes, dynamic poses',
      typography: 'stylized japanese-inspired, bold outlines',
      negative: 'photorealistic, western cartoon, muted colors, rough lines, watermark',
      seedBase: 555555555,
      measured: {
        line: { strokeDensity: 0.55, edgeEnergy: 0.6 },
        tone: { saturation: { min: 0.4, max: 1.0, mean: 0.75 }, contrast: { min: 0.3, max: 0.95, mean: 0.65 }, brightness: { min: 0.3, max: 0.9, mean: 0.6 } },
        aspect: { width: 1920, height: 1080, ratio: 1.7777777777777777, orientation: 'landscape' },
        safeArea: { edgeContentRatio: 0.1, margin: 0.1 },
        frameCount: 5,
      },
      source: { adapter: 'heuristic', degradedFrom: [] },
    },
    preview_url: '/art-styles/builtin/vibrant-anime-preview.png',
    portrait_preview_url: '/art-styles/builtin/vibrant-anime-portrait-preview.png',
    sample_video_urls: [],
    status: 'ready',
    created_at: new Date('2026-10-27T09:00:00.000Z').toISOString(),
  },
] satisfies readonly (typeof artStyle.$inferInsert)[];

export interface SeedResult {
  templates: number;
  artStyles: number;
  workspace: boolean;
}

/** Exported so the seed test can validate them against the row contracts. */
export const DEV_WORKSPACE = {
  id: DEV_WORKSPACE_ID,
  name: 'Personal',
  plan_id: 'selfhost',
  credits: null,
  balance_cents: 0,
} satisfies typeof workspace.$inferInsert;

export const DEV_USER = {
  id: DEV_USER_ID,
  email: 'dev@example.com',
  name: 'Dev',
  created_at: new Date('2026-10-27T09:00:00.000Z').toISOString(),
} satisfies typeof user.$inferInsert;

export const DEV_MEMBER = {
  workspace_id: DEV_WORKSPACE_ID,
  user_id: DEV_USER_ID,
  role: 'owner',
} satisfies typeof member.$inferInsert;

export async function seedBuiltins(db: Database): Promise<SeedResult> {
  const templates = await db
    .insert(captionTemplate)
    .values([...BUILTIN_CAPTION_TEMPLATES])
    // Built-ins are immutable: changing a spec means a new id, so an existing
    // row is never overwritten by a later seed.
    .onConflictDoNothing({ target: captionTemplate.id })
    .returning({ id: captionTemplate.id });

  const artStyles = await db
    .insert(artStyle)
    .values([...BUILTIN_ART_STYLES])
    .onConflictDoNothing({ target: artStyle.id })
    .returning({ id: artStyle.id });

  const workspaces = await db
    .insert(workspace)
    .values(DEV_WORKSPACE)
    .onConflictDoNothing({ target: workspace.id })
    .returning({ id: workspace.id });

  await db
    .insert(user)
    .values(DEV_USER)
    .onConflictDoNothing({ target: user.id });

  await db.insert(member).values(DEV_MEMBER).onConflictDoNothing();

  return { templates: templates.length, artStyles: artStyles.length, workspace: workspaces.length > 0 };
}

async function main(): Promise<void> {
  const { createDb, loadEnv } = await import('./client');
  loadEnv();
  const { db, pool } = createDb();
  try {
    const result = await seedBuiltins(db);
    console.log(
      `seed: ${result.templates} new caption templates, ` +
        `${result.artStyles} new art styles, ` +
        `workspace ${result.workspace ? 'created' : 'already present'}`,
    );
  } finally {
    await pool.end();
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
