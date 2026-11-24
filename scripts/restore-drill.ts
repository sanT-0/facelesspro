#!/usr/bin/env node
/**
 * Restore drill — verifies a Postgres dump can be restored and a known video
 * is still reachable. Run against the live compose stack.
 *
 * Usage:
 *   tsx scripts/restore-drill.ts [--keep-scratch]
 *
 * Requires: docker compose stack running with postgres + api healthy.
 * The script creates a temporary database `faceless_restore_<ts>` on the same
 * Postgres instance, restores the dump there, and probes a known video's
 * artifact path in the shared Docker volume.
 */

import { spawnSync } from 'node:child_process';

const keepScratch = process.argv.includes('--keep-scratch');
const TS = Date.now();
const SCRATCH_DB = `faceless_restore_${TS}`;
const COMPOSE = 'docker compose';

function run(cmd: string, opts: { stdio?: 'inherit' | 'pipe'; encoding?: 'utf8' } = {}) {
  const full = `${COMPOSE} ${cmd}`;
  const res = spawnSync('bash', ['-c', full], { stdio: opts.stdio ?? 'pipe', encoding: opts.encoding ?? 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) {
    throw new Error(`command failed: ${full}\n${res.stderr}`);
  }
  return res.stdout;
}

function main() {
  console.log('=== restore drill ===');
  console.log('scratch DB:', SCRATCH_DB);

  // 1. Dump the running database
  console.log('\n[1/5] pg_dump from compose postgres...');
  const dump = run('exec -T postgres pg_dump -U faceless -d faceless --no-owner --no-privileges', { stdio: 'pipe' });
  console.log('  dump size:', dump.length, 'bytes');

  // 2. Create scratch database
  console.log('\n[2/5] creating scratch database...');
  run(`exec -T postgres psql -U faceless -d postgres -c "CREATE DATABASE ${SCRATCH_DB};"`);

  // 3. Restore into scratch
  console.log('\n[3/5] restoring dump...');
  const restore = spawnSync('bash', ['-c', `${COMPOSE} exec -T postgres psql -U faceless -d ${SCRATCH_DB}`], {
    input: dump,
    stdio: 'pipe',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (restore.status !== 0) {
    throw new Error(`restore failed: ${restore.stderr?.toString()}`);
  }
  console.log('  restored');

  // 4. Pick a known video from the dump (the latest completed one)
  console.log('\n[4/5] finding a completed video in the dump...');
  const pick = spawnSync('bash', ['-c', `${COMPOSE} exec -T postgres psql -U faceless -d ${SCRATCH_DB} -t -c "SELECT id FROM video WHERE status = 'completed' ORDER BY created_at DESC LIMIT 1;"`], { stdio: 'pipe', encoding: 'utf8' });
  if (pick.status !== 0 || !pick.stdout?.trim()) {
    throw new Error('no completed video found in dump');
  }
  const videoId = pick.stdout.trim();
  console.log('  video:', videoId);

  // 5. Query artifact path from scratch DB and verify it exists in the Docker volume
  console.log('\n[5/5] querying artifact path from scratch DB...');

  // video_url stores the public path (e.g. /files/ws/... or ws/...)
  const fileQuery = run(`exec -T postgres psql -U faceless -d ${SCRATCH_DB} -t -c "SELECT video_url FROM video WHERE id = '${videoId}';"`);
  const videoUrl = fileQuery.trim();
  if (!videoUrl) throw new Error('video_url null in scratch DB');

  console.log('  video_url from scratch DB:', videoUrl);

  // Extract the storage key and verify the file exists in the Docker volume
  // URL format: /files/ws/... or ws/... (relative)
  const keyMatch = videoUrl.match(/(?:^\/files\/|^)ws\/(.+)$/);
  if (!keyMatch) throw new Error(`cannot parse storage key from ${videoUrl}`);
  const storageKey = 'ws/' + keyMatch[1];  // volume path is ws/...

  // Check the Docker volume where the compose stack stores artifacts
  const volCheck = spawnSync('bash', ['-c', `docker run --rm -v facelesspro_data:/vol alpine test -f /vol/${storageKey} && echo OK || echo MISSING`], { stdio: 'pipe', encoding: 'utf8' });
  if (!volCheck.stdout.includes('OK')) {
    throw new Error(`artifact missing in volume at ${storageKey}`);
  }
  // Get file size
  const sizeCheck = spawnSync('bash', ['-c', `docker run --rm -v facelesspro_data:/vol alpine stat -c %s /vol/${storageKey}`], { stdio: 'pipe', encoding: 'utf8' });
  const size = sizeCheck.stdout.trim();
  console.log('  artifact exists in volume:', storageKey, `(${size} bytes)`);

  // Cleanup unless --keep-scratch
  if (!keepScratch) {
    console.log('\n[cleanup] dropping scratch database...');
    run(`exec -T postgres psql -U faceless -d postgres -c "DROP DATABASE ${SCRATCH_DB};"`);
    console.log('  dropped');
  } else {
    console.log('\n[keep-scratch] leaving', SCRATCH_DB, 'intact');
  }

  console.log('\n=== restore drill PASSED ===');
}

main();