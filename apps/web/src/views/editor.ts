/**
 * Editor view — inspect a video project.
 *
 * Shows the scene list with script text and duration, a narration waveform with
 * a scrub playhead, the voice plan (which runs went to Tamil vs English), the
 * stored caption cues with a sidecar preview/download for each format, and the
 * render panel. Fetches video details from GET /v1/videos/:id.
 *
 * A completed video can redraw one scene: the API stores a one-scene marker and
 * the worker regenerates only that still, then re-renders. The same completed
 * video can also re-narrate edited scene text: only changed scenes are sent,
 * unchanged text is a media-cache hit, and the worker re-stitches the master
 * and re-renders from `create-captions` without touching the artwork.
 */

import { MAX_SCRIPT_CHARS } from '@facelesspro/contracts';

import {
  getCaptionDocument,
  getCaptionSidecar,
  getCaptionTemplates,
  getVideo,
  getVideoPlan,
  previewCaptions,
  redrawScene,
  renderVideo,
  revocalNarration,
  updateCaptionStyle,
  type CaptionDocument,
  type CaptionSidecarFormat,
  type CaptionTemplate,
  type Video,
} from '../api';
import { loadSession } from '../session';
import { bindChrome, escapeHtml, headerHtml } from '../ui';

const CAPTION_FORMATS: readonly CaptionSidecarFormat[] = ['srt', 'vtt', 'ass', 'json'];

const WAVEFORM_WIDTH = 800;
const WAVEFORM_HEIGHT = 96;

function formatCaptionTime(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = ((milliseconds % 60_000) / 1000).toFixed(1).padStart(4, '0');
  return `${minutes}:${seconds}`;
}

/** Minimal structural type so the view does not depend on a vendor-prefixed ctor. */
type AudioContextConstructor = new () => AudioContext;

function audioContextConstructor(): AudioContextConstructor | null {
  const scoped = window as unknown as {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  return scoped.AudioContext ?? scoped.webkitAudioContext ?? null;
}

/**
 * Draw the peak envelope of one decoded channel, plus scene boundaries, then
 * overlay the playhead. Redrawing from the buffer (instead of compositing)
 * keeps the waveform clean after a scrub.
 */
function paintWaveform(
  canvas: HTMLCanvasElement,
  buffer: AudioBuffer,
  sceneStartsMs: readonly number[],
  playheadFraction: number,
): void {
  const context = canvas.getContext('2d');
  if (context === null) return;

  const width = canvas.width;
  const height = canvas.height;
  const middle = height / 2;
  const channel = buffer.getChannelData(0);
  const samplesPerColumn = Math.max(1, Math.floor(channel.length / width));

  context.fillStyle = '#0f172a';
  context.fillRect(0, 0, width, height);

  context.fillStyle = '#60a5fa';
  for (let x = 0; x < width; x += 1) {
    let peak = 0;
    const start = x * samplesPerColumn;
    const end = Math.min(start + samplesPerColumn, channel.length);
    for (let i = start; i < end; i += 1) {
      const value = Math.abs(channel[i] ?? 0);
      if (value > peak) peak = value;
    }
    const barHeight = Math.max(1, Math.round(peak * (height - 8)));
    context.fillRect(x, Math.round(middle - barHeight / 2), 1, barHeight);
  }

  // Scene boundaries: a cachet on the timeline, not a caption line-break point.
  context.fillStyle = '#f59e0b';
  const durationMs = buffer.duration * 1000;
  for (const startMs of sceneStartsMs) {
    if (startMs <= 0 || startMs >= durationMs) continue;
    const x = Math.round((startMs / durationMs) * width);
    context.fillRect(x, 0, 1, height);
  }

  const playheadX = Math.round(playheadFraction * width);
  context.fillStyle = '#f8fafc';
  context.fillRect(playheadX, 0, 2, height);

  canvas.dataset.ready = 'true';
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
        <div class="form-group mt-2">
          <label class="form-label" for="redraw-prompt">Redraw direction (optional)</label>
          <input id="redraw-prompt" class="form-input" type="text" maxlength="500"
            placeholder="e.g. warmer light, closer crop" />
        </div>
        <div id="redraw-status" class="status-line" role="status"></div>
        <div id="renarrate-panel" class="form-group mt-2" hidden>
          <button class="btn btn-primary" id="renarrate-btn" type="button">
            Re-narrate changed scenes
          </button>
          <div id="renarrate-status" class="status-line" role="status"></div>
        </div>
      </section>

      <section class="card">
        <h2 class="card-title">Timeline</h2>
        <div id="timeline" class="mt-2">
          <div class="text-muted">Loading narration…</div>
        </div>
      </section>

      <section class="card">
        <h2 class="card-title">Plan</h2>
        <div id="plan-panel" class="mt-2">
          <div class="text-muted">Loading plan…</div>
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
  const timelineEl = container.querySelector('#timeline') as HTMLElement;
  const planPanel = container.querySelector('#plan-panel') as HTMLElement;
  const voicePlanEl = container.querySelector('#voice-plan') as HTMLElement;
  const captionsPanel = container.querySelector('#captions-panel') as HTMLElement;
  const renderBtn = container.querySelector('#render-btn') as HTMLButtonElement;
  const renderResult = container.querySelector('#render-result') as HTMLDivElement;
  const redrawPrompt = container.querySelector('#redraw-prompt') as HTMLInputElement;
  const redrawStatus = container.querySelector('#redraw-status') as HTMLElement;
  const renarratePanel = container.querySelector('#renarrate-panel') as HTMLElement;
  const renarrateBtn = container.querySelector('#renarrate-btn') as HTMLButtonElement;
  const renarrateStatus = container.querySelector('#renarrate-status') as HTMLElement;

  let video: Video | null = null;
  /** Text as loaded, so "changed" means edited by the user, not re-sent. */
  let storedTexts = new Map<number, string>();

  // Bound once: the button is not part of the re-rendered scene list.
  renarrateBtn.addEventListener('click', () => {
    void renarrateChangedScenes();
  });

  async function loadVideo(): Promise<void> {
    try {
      video = await getVideo(videoId);
      renderVideoDetails(video);
      await loadTimeline();
      await loadPlan();
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
      // Redraw and re-narrate only make sense on a finished project:
      // generation in flight or failed is resumed through retry, not by
      // swapping one still or one line.
      const canRedraw = v.status === 'completed';
      storedTexts = new Map(scenes.map((s) => [s.idx, s.text]));
      renarratePanel.hidden = !canRedraw;
      scenesList.innerHTML = scenes.map((s) => `
        <div class="scene-item">
          <img src="${s.imageUrl ?? 'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2796%27 height=%2754%27%3E%3Crect width=%2796%27 height=%2754%27 fill=%27%23334155%27/%3E%3C/svg%3E'}" alt="Scene ${s.idx}" />
          <div class="scene-text">
            ${canRedraw
              ? `<textarea class="form-input scene-text-input" rows="2" maxlength="${MAX_SCRIPT_CHARS}" data-scene-text="${s.idx}" aria-label="Scene ${s.idx + 1} text">${escapeHtml(s.text)}</textarea>`
              : `<p>${escapeHtml(s.text)}</p>`}
            <div class="scene-meta">
              <span>Scene ${s.idx + 1}</span>
              <span>${((s.endMs - s.startMs) / 1000).toFixed(1)}s</span>
              ${canRedraw ? `<button class="btn btn-secondary" type="button" data-redraw-scene="${s.idx}">Redraw</button>` : ''}
            </div>
          </div>
        </div>
      `).join('');
      bindSceneRedraw();
    } else {
      scenesList.innerHTML = '<div class="text-muted">No scenes available yet.</div>';
      renarratePanel.hidden = true;
    }

    renderVoicePlan(v.voicePlan);
  }

  /**
   * Wire each redraw button. Called again after every `renderVideoDetails`,
   * because replacing the scene list detaches the old buttons.
   */
  function bindSceneRedraw(): void {
    scenesList
      .querySelectorAll<HTMLButtonElement>('[data-redraw-scene]')
      .forEach((button) => {
        button.addEventListener('click', async () => {
          const idx = Number(button.dataset.redrawScene);
          if (!Number.isInteger(idx) || idx < 0) return;

          const nudge = redrawPrompt.value.trim();
          const buttons = scenesList.querySelectorAll<HTMLButtonElement>(
            '[data-redraw-scene]',
          );
          buttons.forEach((other) => {
            other.disabled = true;
          });
          button.textContent = 'Redrawing…';
          redrawStatus.textContent = `Redrawing scene ${idx + 1}…`;
          delete redrawStatus.dataset.state;

          try {
            const updated = await redrawScene(
              videoId,
              idx,
              nudge.length === 0 ? {} : { prompt: nudge },
            );
            video = updated;
            renderVideoDetails(updated);
            redrawStatus.textContent = `Scene ${idx + 1} queued. The video re-renders when the new still is ready.`;
          } catch (err) {
            redrawStatus.textContent = (err as Error).message;
            redrawStatus.dataset.state = 'error';
            button.disabled = false;
            button.textContent = 'Redraw';
          }
        });
      });
  }

  /**
   * Send only the scenes whose textarea differs from the loaded text.
   *
   * Re-sending unchanged scenes would make the server charge them as edits,
   * so the comparison happens here and an empty set is reported as a no-op
   * rather than a request the API would reject.
   */
  async function renarrateChangedScenes(): Promise<void> {
    const fields = scenesList.querySelectorAll<HTMLTextAreaElement>(
      '[data-scene-text]',
    );
    const changed: { idx: number; text: string }[] = [];
    fields.forEach((field) => {
      const idx = Number(field.dataset.sceneText);
      if (!Number.isInteger(idx) || idx < 0) return;
      const text = field.value.trim();
      if (text.length > 0 && text !== storedTexts.get(idx)) {
        changed.push({ idx, text });
      }
    });

    if (changed.length === 0) {
      renarrateStatus.textContent = 'No scene text changed.';
      delete renarrateStatus.dataset.state;
      return;
    }

    renarrateBtn.disabled = true;
    renarrateStatus.textContent = `Re-narrating ${changed.length} scene${changed.length === 1 ? '' : 's'}…`;
    delete renarrateStatus.dataset.state;

    try {
      const updated = await revocalNarration(videoId, changed);
      video = updated;
      renderVideoDetails(updated);
      renarrateStatus.textContent = `Queued. The video re-renders after the captions are rebuilt.`;
    } catch (err) {
      renarrateStatus.textContent = (err as Error).message;
      renarrateStatus.dataset.state = 'error';
    } finally {
      renarrateBtn.disabled = false;
    }
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

  async function loadTimeline(): Promise<void> {
    const url = video?.narrationUrl;
    if (url === undefined) {
      timelineEl.innerHTML =
        '<div class="text-muted">Narration is not ready yet.</div>';
      return;
    }

    timelineEl.innerHTML = `
      <canvas id="waveform" class="waveform" width="${WAVEFORM_WIDTH}" height="${WAVEFORM_HEIGHT}"
        tabindex="0" role="img"
        aria-label="Narration waveform. Click or use the arrow keys to scrub."></canvas>
      <div class="scene-meta mt-2">
        <span id="playhead-time">0:00.0</span>
        <span class="text-muted">Click the waveform or use the arrow keys to scrub</span>
      </div>
    `;

    const canvas = timelineEl.querySelector('#waveform') as HTMLCanvasElement | null;
    const label = timelineEl.querySelector('#playhead-time') as HTMLElement | null;
    if (canvas === null || label === null) return;

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`narration ${response.status}`);
      const AudioCtor = audioContextConstructor();
      if (AudioCtor === null) throw new Error('Web Audio is unavailable');
      const context = new AudioCtor();
      let buffer: AudioBuffer;
      try {
        buffer = await context.decodeAudioData(await response.arrayBuffer());
      } finally {
        void context.close();
      }

      const durationMs = Math.round(buffer.duration * 1000);
      const sceneStarts = (video?.scenes ?? []).map((scene) => scene.startMs);
      let fraction = 0;

      const paint = (next: number): void => {
        fraction = Math.min(Math.max(next, 0), 1);
        paintWaveform(canvas, buffer, sceneStarts, fraction);
        label.textContent = formatCaptionTime(Math.round(fraction * durationMs));
      };

      paint(0);

      canvas.addEventListener('click', (event) => {
        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0) return;
        paint((event.clientX - rect.left) / rect.width);
      });

      canvas.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        paint(fraction + (event.key === 'ArrowRight' ? 0.02 : -0.02));
      });
    } catch {
      timelineEl.innerHTML =
        '<div class="text-muted">Waveform unavailable.</div>';
    }
  }

  let captionTemplates: CaptionTemplate[] = [];

  async function loadPlan(): Promise<void> {
    try {
      const { plan } = await getVideoPlan(videoId);
      const degraded =
        plan.degradedFrom.length === 0
          ? ''
          : ` <span class="text-muted">(after ${plan.degradedFrom.join(', ')})</span>`;
      planPanel.innerHTML = `
        <div class="scene-meta plan-summary">
          <span class="plan-adapter">Adapter: ${escapeHtml(plan.adapter)}${degraded}</span>
          <span>${(plan.totalMs / 1000).toFixed(1)}s</span>
          <span>${plan.scenes.length} scene${plan.scenes.length === 1 ? '' : 's'}</span>
        </div>
        <div class="plan-scenes">
          ${plan.scenes
            .map(
              (scene, index) => `
                <div class="plan-scene">
                  <div class="scene-meta">
                    <span>Scene ${index + 1}</span>
                    <span>${formatCaptionTime(scene.startMs)} → ${formatCaptionTime(scene.endMs)}</span>
                    <span class="plan-motion">${escapeHtml(scene.motion)}</span>
                  </div>
                  <p>${escapeHtml(scene.text)}</p>
                  ${
                    scene.emphasis.length === 0
                      ? ''
                      : `<div class="plan-emphasis">${scene.emphasis
                          .map((word) => `<span class="plan-chip">${escapeHtml(word)}</span>`)
                          .join('')}</div>`
                  }
                  <p class="plan-prompt text-muted">${escapeHtml(scene.imagePrompt)}</p>
                </div>
              `,
            )
            .join('')}
        </div>
      `;
    } catch (err) {
      if ((err as { status?: number }).status === 404) {
        planPanel.innerHTML =
          '<div class="text-muted">Plan is not ready yet.</div>';
        return;
      }
      planPanel.innerHTML = `<div style="color:var(--color-danger);">Failed to load plan: ${escapeHtml((err as Error).message)}</div>`;
    }
  }

  async function loadCaptions(): Promise<void> {
    try {
      const [document, templates] = await Promise.all([
        getCaptionDocument(videoId),
        getCaptionTemplates().catch(() => [] as CaptionTemplate[]),
      ]);
      captionTemplates = templates;
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

  function cueListHtml(document: CaptionDocument): string {
    return document.cues
      .map((cue) => {
        const emoji =
          cue.emoji === undefined
            ? ''
            : ` <span class="caption-emoji" aria-hidden="true">${escapeHtml(cue.emoji)}</span>`;
        return `
          <div class="caption-cue">
            <div class="caption-time">${formatCaptionTime(cue.startMs)} → ${formatCaptionTime(cue.endMs)}</div>
            <div class="caption-text">${escapeHtml(cue.lines.join(' '))}${emoji}</div>
          </div>
        `;
      })
      .join('');
  }

  function renderCaptionCues(document: CaptionDocument): void {
    const selectedTemplate =
      captionTemplates.find((template) => template.id === -1) ?? captionTemplates[0];
    const templateControl =
      selectedTemplate === undefined
        ? ''
        : `
          <div class="form-group">
            <label class="form-label" for="caption-template">Template</label>
            <select id="caption-template" class="form-select">
              ${captionTemplates
                .map(
                  (template) =>
                    `<option value="${template.id}"${template.id === selectedTemplate.id ? ' selected' : ''}>${escapeHtml(template.name)}</option>`,
                )
                .join('')}
            </select>
          </div>
        `;

    captionsPanel.innerHTML = `
      <div class="caption-controls">
        ${templateControl}
        <div class="form-group">
          <label class="form-label" for="caption-word-limit">Words per cue</label>
          <input id="caption-word-limit" class="form-input" type="number" min="1" max="10" step="1" value="6" />
        </div>
        <div class="form-group caption-emoji-toggle">
          <label class="form-check-label" for="caption-emoji">
            <input id="caption-emoji" type="checkbox" />
            Emoji emphasis
          </label>
        </div>
        <div class="form-group">
          <button class="btn btn-secondary" type="button" id="caption-preview-btn">Preview</button>
          <button class="btn btn-primary" type="button" id="caption-save-btn"${video?.status === 'completed' ? '' : ' hidden'}>
            Save style and re-render
          </button>
        </div>
      </div>
      <p class="text-muted caption-preview-note">
        Preview does not change the stored captions. Save rebuilds them and the MP4.
      </p>
      <div id="caption-preview-status" class="caption-preview-status" role="status"></div>
      <div class="caption-cues" id="caption-cues">${cueListHtml(document)}</div>
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

    const templateSelect = captionsPanel.querySelector(
      '#caption-template',
    ) as HTMLSelectElement | null;
    const wordLimitInput = captionsPanel.querySelector(
      '#caption-word-limit',
    ) as HTMLInputElement;
    const emojiInput = captionsPanel.querySelector(
      '#caption-emoji',
    ) as HTMLInputElement;
    const previewButton = captionsPanel.querySelector(
      '#caption-preview-btn',
    ) as HTMLButtonElement;
    const saveButton = captionsPanel.querySelector(
      '#caption-save-btn',
    ) as HTMLButtonElement;
    const previewStatus = captionsPanel.querySelector(
      '#caption-preview-status',
    ) as HTMLElement;
    const cueList = captionsPanel.querySelector('#caption-cues') as HTMLElement;

    /** The complete style choice, or `null` after reporting a bad word limit. */
    function captionGroup(): {
      templateId?: number;
      spec: { wordLimit: number; emoji: boolean };
    } | null {
      const wordLimit = Number(wordLimitInput.value);
      if (!Number.isInteger(wordLimit) || wordLimit < 1 || wordLimit > 10) {
        previewStatus.textContent = 'Words per cue must be a whole number from 1 to 10.';
        previewStatus.dataset.state = 'error';
        return null;
      }
      return {
        spec: { wordLimit, emoji: emojiInput.checked },
        ...(templateSelect === null
          ? {}
          : { templateId: Number(templateSelect.value) }),
      };
    }

    previewButton.addEventListener('click', async () => {
      const group = captionGroup();
      if (group === null) return;

      previewButton.disabled = true;
      previewStatus.textContent = 'Regrouping…';
      delete previewStatus.dataset.state;
      try {
        const preview = await previewCaptions(videoId, group);
        cueList.innerHTML = cueListHtml(preview);
        previewStatus.textContent = `Preview: ${preview.cues.length} cue${preview.cues.length === 1 ? '' : 's'}.`;
      } catch (err) {
        previewStatus.textContent = (err as Error).message;
        previewStatus.dataset.state = 'error';
      } finally {
        previewButton.disabled = false;
      }
    });

    saveButton.addEventListener('click', async () => {
      const group = captionGroup();
      if (group === null) return;

      previewButton.disabled = true;
      saveButton.disabled = true;
      previewStatus.textContent = 'Saving style…';
      delete previewStatus.dataset.state;
      try {
        const updated = await updateCaptionStyle(videoId, group);
        // The 202 body is the video row only — scenes/voicePlan come from the
        // separate read paths. Keep the ones already on screen so saving a
        // style does not blank the scene list.
        const previous = video;
        video = {
          ...updated,
          ...(previous?.scenes === undefined ? {} : { scenes: previous.scenes }),
          ...(previous?.voicePlan === undefined ? {} : { voicePlan: previous.voicePlan }),
        };
        renderVideoDetails(video);
        // The panel keeps the last stored cues: the worker has not rebuilt
        // them yet, and the status line says so.
        previewStatus.textContent =
          'Queued. Captions and the MP4 rebuild with this style; audio and artwork are unchanged.';
        saveButton.textContent = 'Style saved';
        saveButton.disabled = true;
      } catch (err) {
        previewStatus.textContent = (err as Error).message;
        previewStatus.dataset.state = 'error';
        previewButton.disabled = false;
        saveButton.disabled = false;
      }
    });

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
