/**
 * Editor view — edit a video project.
 *
 * Shows scene list with script text and duration, redraw per scene,
 * script edit → selective re-narrate, caption style preview, render panel.
 * Fetches video details from GET /v1/videos/:id.
 */

import { getVideo, renderVideo, type Video } from '../api';
import { loadSession } from '../session';
import { bindChrome, escapeHtml, headerHtml } from '../ui';

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
  const renderBtn = container.querySelector('#render-btn') as HTMLButtonElement;
  const renderResult = container.querySelector('#render-result') as HTMLDivElement;

  let video: Video | null = null;

  async function loadVideo(): Promise<void> {
    try {
      video = await getVideo(videoId);
      renderVideoDetails(video);
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

    // Render scenes (placeholder since scenes may not be in the API response yet).
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
