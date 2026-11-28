/**
 * Studio view — create a new AI video.
 *
 * Form fields map 1:1 to POST /v1/ai-videos-v3 request fields.
 * On submit, calls createAiVideoV3 and shows the created video.
 */

import { createVideoV3, getArtStyles, getVoices, type Voice } from '../api';
import { loadSession } from '../session';
import { bindChrome, escapeHtml, headerHtml } from '../ui';

export async function renderStudio(_params: Record<string, string>): Promise<HTMLElement> {
  const container = document.createElement('div');
  container.className = 'app';

  const session = await loadSession();

  container.innerHTML = `
    ${headerHtml({ active: '/studio', workspaceName: session?.name })}

    <section class="card mt-3">
      <h1 class="card-title">Create a video</h1>
      <p class="text-muted mt-2">
        Generate an AI video from a script or voiceover. Choose an art style,
        voice, and render settings below.
      </p>
    </section>

    <form id="create-form" class="card mt-3">
      <div class="form-group">
        <label class="form-label" for="script-input">Script</label>
        <textarea
          id="script-input"
          class="form-input"
          rows="6"
          placeholder="Paste your script here (Tamil, English or Tanglish)…"
        ></textarea>
        <p class="text-muted mt-1">Exactly one of script or voiceover URL is required.</p>
        <details class="mt-2">
          <summary class="text-muted cursor-pointer">Production script format (Visual + Voiceover)</summary>
          <pre class="text-xs mt-1 p-2 bg-muted/30 rounded overflow-auto">
# TITLE

### [0:00–0:30] SECTION HEADING

**Visual:** What the camera sees. Drives image prompts.

**Voiceover:**
"Only this text is narrated. Markdown, quotes, emoji and end-screen CTA are removed."
          </pre>
        </details>
      </div>

      <div class="form-group">
        <label class="form-label" for="voiceover-url">Voiceover URL (optional)</label>
        <input
          type="url"
          id="voiceover-url"
          class="form-input"
          placeholder="https://cdn.example.com/voice.mp3"
        />
        <p class="text-muted mt-1">MP3, M4A, WAV, OGG, AAC, FLAC. Max 200 MB.</p>
      </div>

      <div class="grid-2 mt-3">
        <div class="form-group">
          <label class="form-label" for="art-style">Art style</label>
          <select id="art-style" class="form-select">
            <option value="">Loading styles…</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="size">Size</label>
          <select id="size" class="form-select">
            <option value="landscape">Landscape (16:9)</option>
            <option value="portrait">Portrait (9:16)</option>
          </select>
        </div>
      </div>

      <div class="grid-2 mt-3">
        <div class="form-group">
          <label class="form-label" for="voice-id">Voice</label>
          <select id="voice-id" class="form-select">
            <option value="">Default voice</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="speed">Speed</label>
          <select id="speed" class="form-select">
            <option value="standard">Standard</option>
            <option value="slow">Slow (−10% cost)</option>
          </select>
        </div>
      </div>

      <div class="mt-3">
        <label class="form-label" style="display:flex; align-items:center; gap:0.5rem; cursor:pointer;">
          <input type="checkbox" id="captions-toggle" />
          <span>Enable captions</span>
        </label>
      </div>

      <div class="mt-3">
        <label class="form-label" for="render">Render (MP4)</label>
        <select id="render" class="form-select">
          <option value="">Don't render (editable project)</option>
          <option value="1080">1080p / 30fps / standard</option>
          <option value="2160">2160p / 60fps / standard</option>
        </select>
      </div>

      <div class="form-group mt-3">
        <label class="form-label" for="webhook-url">Webhook URL (optional)</label>
        <input
          type="url"
          id="webhook-url"
          class="form-input"
          placeholder="https://hooks.example.com/facelesspro"
        />
      </div>

      <div class="mt-3">
        <button type="submit" class="btn btn-primary" id="submit-btn">Create video</button>
      </div>
      <div id="create-result" class="mt-2"></div>
    </form>
  `;

  const form = container.querySelector('#create-form') as HTMLFormElement;
  const scriptInput = container.querySelector('#script-input') as HTMLTextAreaElement;
  const voiceoverUrlInput = container.querySelector('#voiceover-url') as HTMLInputElement;
  const artStyleSelect = container.querySelector('#art-style') as HTMLSelectElement;
  const sizeSelect = container.querySelector('#size') as HTMLSelectElement;
  const voiceSelect = container.querySelector('#voice-id') as HTMLSelectElement;
  const speedSelect = container.querySelector('#speed') as HTMLSelectElement;
  const captionsToggle = container.querySelector('#captions-toggle') as HTMLInputElement;
  const renderSelect = container.querySelector('#render') as HTMLSelectElement;
  const webhookUrlInput = container.querySelector('#webhook-url') as HTMLInputElement;
  const submitBtn = container.querySelector('#submit-btn') as HTMLButtonElement;
  const resultDiv = container.querySelector('#create-result') as HTMLDivElement;

  // Load art styles and voices.
  let styles: Awaited<ReturnType<typeof getArtStyles>> = [];
  let voices: Voice[] = [];

  try {
    [styles, voices] = await Promise.all([getArtStyles(), getVoices()]);
  } catch {
    // Auth may not be set yet.
  }

  // Populate art style dropdown.
  artStyleSelect.innerHTML = styles.map(
    (s) => `<option value="${s.id}">${escapeHtml(s.name)} (${s.status})</option>`
  ).join('');

  // Populate voice dropdown.
  voices.forEach((v) => {
    const option = document.createElement('option');
    option.value = v.id;
    option.textContent = `${v.name} (${v.languages.join(', ')})`;
    voiceSelect.appendChild(option);
  });

  form.addEventListener('submit', async (e: Event) => {
    e.preventDefault();
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating…';
    resultDiv.innerHTML = '';

    const script = scriptInput.value.trim();
    const voiceoverUrl = voiceoverUrlInput.value.trim();
    const artStyleId = artStyleSelect.value;
    const size = sizeSelect.value as 'landscape' | 'portrait';
    const voiceId = voiceSelect.value || undefined;
    const speed = speedSelect.value as 'slow' | 'standard';
    const captions = captionsToggle.checked;
    const renderValue = renderSelect.value;
    const webhookUrl = webhookUrlInput.value.trim();

    const body: {
      artStyleId: string;
      script?: string;
      voiceoverUrl?: string;
      size: 'landscape' | 'portrait';
      speed: 'slow' | 'standard';
      voiceId?: string;
      voiceStyle?: {
        stability: number;
        similarityBoost: number;
        style: number;
        speed: number;
      };
      captions: boolean;
      render?: { resolution: number; frameRate: number; format: string };
      webhookUrl?: string;
    } = {
      artStyleId,
      size,
      speed,
      captions,
    };

    if (script) body.script = script;
    if (voiceoverUrl) body.voiceoverUrl = voiceoverUrl;
    if (voiceId) body.voiceId = voiceId;
    if (webhookUrl) body.webhookUrl = webhookUrl;

    if (renderValue) {
      const [res, fps] = renderValue.split('/') as [string, string];
      body.render = {
        resolution: parseInt(res, 10),
        frameRate: parseInt(fps, 10),
        format: 'standard',
      };
    }

    try {
      const result = await createVideoV3(body);
      resultDiv.innerHTML = `
        <div style="border:1px solid var(--color-success); padding:1rem; border-radius:var(--radius-sm); background:rgba(34,197,94,0.1);">
          <div class="form-label">Video created!</div>
          <div style="font-family:var(--font-mono); font-size:0.875rem; margin:0.5rem 0;">
            ID: ${result.id}
          </div>
          <div style="font-size:0.875rem; color:var(--color-text-muted);">
            Status: ${result.status} | Render: ${result.render ? 'yes' : 'no'}
          </div>
          <a href="#" class="btn btn-primary mt-2" data-nav="/videos/${encodeURIComponent(result.id)}">Follow progress</a>
          <a href="/editor?id=${encodeURIComponent(result.id)}" class="btn btn-secondary mt-2">Open in editor</a>
        </div>
      `;
      bindChrome(resultDiv);
      scriptInput.value = '';
      voiceoverUrlInput.value = '';
    } catch (err) {
      resultDiv.innerHTML = `
        <div style="border:1px solid var(--color-danger); padding:1rem; border-radius:var(--radius-sm); background:rgba(239,68,68,0.1);">
          <div class="form-label" style="color:var(--color-danger);">Error creating video</div>
          <div style="font-size:0.875rem; margin:0.5rem 0;">${(err as Error).message}</div>
        </div>
      `;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create video';
    }
  });

  // Wire up data-nav links.
  bindChrome(container);

  return container;
}
