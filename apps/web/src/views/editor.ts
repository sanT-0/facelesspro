/**
 * Editor view — inspect a video project.
 *
 * Shows the scene list with script text and duration, the narration voice plan
 * (which runs went to Tamil vs English), the stored caption cues with a sidecar
 * preview/download for each format, and the render panel.
 * Fetches video details from GET /v1/videos/:id.
 *
 * Redraw and selective re-narrate are deliberately absent: neither route
 * exists yet, and a button that cannot work is worse than no button.
 */

import {
  getCaptionDocument,
  getCaptionSidecar,
  getVideo,
  renderVideo,
  type CaptionDocument,
  type CaptionSidecarFormat,
  type Video,
} from '../api';
import { loadSession } from '../session';
import { bindChrome, escapeHtml, headerHtml } from '../ui';

const CAPTION_FORMATS: readonly CaptionSidecarFormat[] = ['srt', 'vtt', 'ass', 'json'];

function formatCaptionTime(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = ((milliseconds % 60_000) / 1000).toFixed(1).padStart(4, '0');
  return `${minutes}:${seconds}`;
}

export async function renderEditor(params: Record<string, string>): Promise<HTMLElement> {
  const videoId = params.id!;
  const container = document.createElement('div');
  container.className = 'app';

  const session = await loadSession();

  container.innerHTML = `
    ${headerHtml({ active: '/editor', workspaceName: session?.name })}

    <section class="card mt-3">
      <h1 class="card-title">Editor <span id="video-id" style="font-size:0.875rem; font-weight:normal; color:var(--color-text-muted);">#${escapeHtml(videoId)}</span></h1>
      <div id="editor-status" class="mt-2">
        <div class="spinner" style="display:inline-block; margin-right:0.5rem;"></div>
        <span>Loading…</span>
      </div>
    </section>

    <div class="editor mt-3">
      <section class="card">
        <h2 class="card-title">Scenes</h2>
        <div id="scenes-list" class="mt-2">
          <div class="text-muted">Loading scenes…</div>
        </div>
      </section>

      <section class="card">
        <h2 class="card-title">Voice plan</h2>
        <div id="voice-plan" class="mt-2">
          <div class="text-muted">No narration yet.</div>
        </div>
      </section>

      <section class="card">
        <h2 class="card-title">Captions</h2>
        <div id="captions-panel" class="mt-2">
          <div class="text-muted">Loading captions…</div>
        </div>
      </section>

      <section class="card">
        <h2 class="card-title">Render</h2>
        <div class="mt-2">
          <div class="form-group">
            <label class="form-label" for="render-resolution">Resolution</label>
            <select id="render-resolution" class="form-select">
              <option value="1080">1080p</option>
              <option value="1440">2K (1440p)</option>
              <option value="2160">4K (2160p)</option>
            </select>
          </div>
          <div class="form-group mt-2">
            <label class="form-label" for="render-fps">Frame rate</label>
            <select id="render-fps" class="form-select">
              <option value="30">30 fps</option>
              <option value="60">60 fps</option>
            </select>
          </div>
          <div class="form-group mt-2">
            <label class="form-label" for="render-format">Format</label>
            <select id="render-format" class="form-select">
              <option value="standard">Standard</option>
              <option value="greenscreen">Greenscreen</option>
            </select>
          </div>
          <div class="mt-2">
            <button class="btn btn-primary" id="render-btn">Render video</button>
          </div>
          <div id="render-result" class="mt-2"></div>
        </div>
      </section>
    </div>
  `;

  const editorStatus = container.querySelector('#editor-status')!;
  const scenesList = container.querySelector('#scenes-list') as HTMLElement;
  const voicePlanEl = container.querySelector('#voice-plan') as HTMLElement;
  const captionsPanel = container.querySelector('#captions-panel') as HTMLElement;
  const renderBtn = container.querySelector('#render-btn') as HTMLButtonElement;
  const renderResult = container.querySelector('#render-result') as HTMLDivElement;

  let video: Video | null = null;

  async function loadVideo(): Promise<void> {
    try {
      video = await getVideo(videoId);
      renderVideoDetails(video);
      await loadCaptions();
    } catch (err) {
      editorStatus.innerHTML = `<span style="color:var(--color-danger);">Failed to load: ${(err as Error).message}</span>`;
    }
  }

  function renderVideoDetails(v: Video): void {
    editorStatus.innerHTML = `
      <span class="badge badge-${v.status}">${v.status}</span>
      <span class="text-muted ml-2">Step: ${v.step ?? '—'} | Render: ${v.render ? 'yes' : 'no'}</span>
    `;

    if (v.status === 'failed' && v.error) {
      editorStatus.innerHTML += ` <span style="color:var(--color-danger); font-size:0.875rem;">Error: ${v.error.message}</span>`;
    }

    // The API serves scenes once `create-scenes` has committed.
    const scenes = v.scenes;
    if (scenes && scenes.length > 0) {
      scenesList.innerHTML = scenes.map((s, _idx) => `
        <div class="scene-item">
          <img src="${s.imageUrl ?? 'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2796%27 height=%2754%27%3E%3Crect width=%2796%27 height=%2754%27 fill=%27%23334155%27/%3E%3C/svg%3E'}" alt="Scene ${s.idx}" />
          <div class="scene-text">
            <p>${escapeHtml(s.text)}</p>
            <div class="scene-meta">
              <span>Scene ${s.idx + 1}</span>
              <span>${((s.endMs - s.startMs) / 1000).toFixed(1)}s</span>
            </div>
          </div>
        </div>
      `).join('');
    } else {
      scenesList.innerHTML = '<div class="text-muted">No scenes available yet.</div>';
    }

    renderVoicePlan(v.voicePlan);
  }

  function renderVoicePlan(plan: Video['voicePlan']): void {
    // `voicePlan` is present only after `create-vocal` has committed.
    if (!plan) {
      voicePlanEl.innerHTML = '<div class="text-muted">No narration yet.</div>';
      return;
    }

    voicePlanEl.innerHTML = `
      <div class="voice-runs">
        ${plan.runs.map((run) => `
          <div class="voice-run">
            <span class="badge">${run.lang.toUpperCase()}</span>
            <span class="voice-run-text">${escapeHtml(run.text)}</span>
            <span class="text-muted">${escapeHtml(run.voice)}</span>
          </div>
        `).join('')}
      </div>
      <div class="scene-meta mt-2">
        <span>${plan.runs.length} run${plan.runs.length === 1 ? '' : 's'}</span>
        <span>${plan.overrides.length} override${plan.overrides.length === 1 ? '' : 's'}</span>
      </div>
    `;
  }

  async function loadCaptions(): Promise<void> {
    try {
      const document = await getCaptionDocument(videoId);
      renderCaptionCues(document);
    } catch (err) {
      if ((err as { status?: number }).status === 404) {
        captionsPanel.innerHTML =
          '<div class="text-muted">Captions are not ready yet.</div>';
        return;
      }
      captionsPanel.innerHTML = `<div style="color:var(--color-danger);">Failed to load captions: ${escapeHtml((err as Error).message)}</div>`;
    }
  }

  function renderCaptionCues(document: CaptionDocument): void {
    captionsPanel.innerHTML = `
      <div class="caption-cues">
        ${document.cues.map((cue) => `
          <div class="caption-cue">
            <div class="caption-time">${formatCaptionTime(cue.startMs)} → ${formatCaptionTime(cue.endMs)}</div>
            <div class="caption-text">${escapeHtml(cue.lines.join(' '))}</div>
          </div>
        `).join('')}
      </div>
      <div class="caption-actions mt-2">
        ${CAPTION_FORMATS.map((format) => `
          <button class="btn btn-secondary" type="button" data-caption-format="${format}">${format.toUpperCase()}</button>
        `).join('')}
      </div>
      <div id="caption-raw-wrap" class="mt-2" hidden>
        <div class="caption-raw-head">
          <span class="form-label" id="caption-raw-name"></span>
          <a class="btn btn-secondary" id="caption-download" download>Download</a>
        </div>
        <pre class="caption-raw" id="caption-raw"></pre>
      </div>
    `;

    const rawWrap = captionsPanel.querySelector('#caption-raw-wrap') as HTMLElement;
    const raw = captionsPanel.querySelector('#caption-raw') as HTMLElement;
    const rawName = captionsPanel.querySelector('#caption-raw-name') as HTMLElement;
    const download = captionsPanel.querySelector('#caption-download') as HTMLAnchorElement;
    let downloadUrl: string | null = null;

    captionsPanel
      .querySelectorAll<HTMLButtonElement>('[data-caption-format]')
      .forEach((button) => {
        button.addEventListener('click', async () => {
          const format = button.dataset.captionFormat as CaptionSidecarFormat;
          button.disabled = true;
          try {
            const sidecar = await getCaptionSidecar(videoId, format);
            rawWrap.hidden = false;
            rawName.textContent = `${format.toUpperCase()} · ${sidecar.mime}`;
            raw.textContent = sidecar.contents;

            if (downloadUrl !== null) URL.revokeObjectURL(downloadUrl);
            downloadUrl = URL.createObjectURL(
              new Blob([sidecar.contents], { type: sidecar.mime.split(';')[0] }),
            );
            download.href = downloadUrl;
            download.download = `captions.${format}`;
          } catch (err) {
            rawWrap.hidden = false;
            rawName.textContent = `${format.toUpperCase()} · failed`;
            raw.textContent = (err as Error).message;
          } finally {
            button.disabled = false;
          }
        });
      });
  }

  renderBtn.addEventListener('click', async () => {
    const resolutionSelect = container.querySelector('#render-resolution') as HTMLSelectElement;
    const fpsSelect = container.querySelector('#render-fps') as HTMLSelectElement;
    const formatSelect = container.querySelector('#render-format') as HTMLSelectElement;

    renderBtn.disabled = true;
    renderBtn.textContent = 'Rendering…';
    renderResult.innerHTML = '';

    try {
      const updated = await renderVideo(videoId, {
        resolution: Number(resolutionSelect.value),
        frameRate: Number(fpsSelect.value),
        format: formatSelect.value,
      });
      video = updated;
      renderVideoDetails(updated);
      renderResult.innerHTML = `
        <div class="notice notice-info">
          <div class="form-label">Render queued</div>
          <div class="text-muted" style="font-size:0.875rem;">
            ${resolutionSelect.value}p · ${fpsSelect.value} fps · ${formatSelect.value}
          </div>
          <button class="btn btn-secondary mt-2" type="button" data-nav="/videos/${encodeURIComponent(videoId)}">
            Follow progress
          </button>
        </div>
      `;
      bindChrome(container);
    } catch (err) {
      renderResult.innerHTML = `
        <div class="notice notice-error">
          <div class="form-label" style="color:var(--color-danger);">Render failed</div>
          <div style="font-size:0.875rem; margin:0.5rem 0;">${escapeHtml((err as Error).message)}</div>
        </div>
      `;
    } finally {
      renderBtn.disabled = false;
      renderBtn.textContent = 'Render video';
    }
  });

  // Wire up nav.
  bindChrome(container);

  await loadVideo();

  return container;
}
