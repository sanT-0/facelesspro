/**
 * Job view — shows video status with live step progress, error panel, and retry.
 *
 * Polls GET /v1/videos/:id for status updates. Supports retrying failed videos
 * via POST /v1/videos/:id/retry.
 */

import { getVideo, retryVideo, type Video } from '../api';
import { loadSession } from '../session';
import { bindChrome, escapeHtml, headerHtml } from '../ui';

export async function renderJob(params: Record<string, string>): Promise<HTMLElement> {
  const videoId = params.id!;
  const container = document.createElement('div');
  container.className = 'app';

  const session = await loadSession();

  container.innerHTML = `
    ${headerHtml({ active: '/videos', workspaceName: session?.name })}

    <section class="card mt-3">
      <h1 class="card-title">Video <span id="video-id">${escapeHtml(videoId)}</span></h1>
      <div id="video-status" class="mt-2">
        <div class="spinner" style="display:inline-block; margin-right:0.5rem;"></div>
        <span>Loading…</span>
      </div>
    </section>

    <section id="video-details" class="card mt-3 hidden">
      <h2 class="card-title">Details</h2>
      <div class="mt-2">
        <div class="flex gap-3">
          <div>
            <div class="form-label">Status</div>
            <div id="status-badge" class="badge badge-processing">processing</div>
          </div>
          <div>
            <div class="form-label">Step</div>
            <div id="step-badge" class="badge" style="background:var(--color-surface); color:var(--color-text-muted); border:1px solid var(--color-border);">—</div>
          </div>
          <div>
            <div class="form-label">Render</div>
            <div id="render-badge" class="badge" style="background:var(--color-surface); color:var(--color-text-muted); border:1px solid var(--color-border);">—</div>
          </div>
        </div>
        <div class="mt-2">
          <div class="form-label">Editor URL</div>
          <a id="editor-url" class="btn btn-secondary" target="_blank" rel="noopener">Open in editor</a>
        </div>
      </div>
    </section>

    <section id="error-panel" class="card mt-3" style="border-color: var(--color-danger);" hidden>
      <h2 class="card-title" style="color: var(--color-danger);">Error</h2>
      <div id="error-message" class="mt-2" style="font-family: var(--font-mono); font-size: 0.875rem;"></div>
      <button class="btn btn-danger mt-2" id="retry-btn">Retry</button>
    </section>

    <section id="timeline" class="card mt-3 hidden">
      <h2 class="card-title">Pipeline steps</h2>
      <div id="steps-list" class="mt-2"></div>
    </section>

    <section id="downloads" class="card mt-3 hidden">
      <h2 class="card-title">Result</h2>
      <div class="mt-2 flex gap-2 wrap">
        <a id="download-link" class="btn btn-primary" download>Download MP4</a>
        <button id="copy-share" class="btn btn-secondary" type="button">Copy share link</button>
        <span id="share-status" class="text-muted" role="status"></span>
      </div>
      <video id="video-preview" class="video-preview mt-3" controls playsinline hidden></video>
    </section>
  `;

  const statusDiv = container.querySelector('#video-status')!;
  const detailsSection = container.querySelector('#video-details') as HTMLElement;
  const errorPanel = container.querySelector('#error-panel') as HTMLElement;
  const timelineSection = container.querySelector('#timeline') as HTMLElement;
  const statusBadge = container.querySelector('#status-badge') as HTMLElement;
  const stepBadge = container.querySelector('#step-badge') as HTMLElement;
  const renderBadge = container.querySelector('#render-badge') as HTMLElement;
  const editorUrlLink = container.querySelector('#editor-url') as HTMLAnchorElement;
  const errorMessage = container.querySelector('#error-message') as HTMLElement;
  const retryBtn = container.querySelector('#retry-btn') as HTMLButtonElement;
  const stepsList = container.querySelector('#steps-list') as HTMLElement;
  const downloadsSection = container.querySelector('#downloads') as HTMLElement;
  const downloadLink = container.querySelector('#download-link') as HTMLAnchorElement;
  const copyShareBtn = container.querySelector('#copy-share') as HTMLButtonElement;
  const shareStatus = container.querySelector('#share-status') as HTMLElement;
  const videoPreview = container.querySelector('#video-preview') as HTMLVideoElement;

  const STEPS_ORDER: string[] = ['create-scenes', 'create-vocal', 'create-images', 'create-captions', 'render'];

  let pollInterval: ReturnType<typeof setInterval> | null = null;

  async function loadVideo(): Promise<void> {
    try {
      const video = await getVideo(videoId);
      renderVideo(video);

      // If video is still processing/rendering, keep polling.
      if (video.status === 'processing' || video.status === 'rendering') {
        if (!pollInterval) {
          pollInterval = setInterval(() => {
            // The router replaces the view element on navigation; stop
            // polling once this view is no longer in the document.
            if (!container.isConnected) {
              if (pollInterval) clearInterval(pollInterval);
              pollInterval = null;
              return;
            }
            void loadVideo();
          }, 5000);
        }
      } else {
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
      }
    } catch (err) {
      statusDiv.innerHTML = `<span style="color:var(--color-danger);">Failed to load video: ${(err as Error).message}</span>`;
    }
  }

  function renderVideo(video: Video): void {
    // Update status badge.
    statusBadge.textContent = video.status;
    statusBadge.className = `badge badge-${video.status}`;

    // Update step badge.
    stepBadge.textContent = video.step ?? '—';

    // Update render badge.
    renderBadge.textContent = video.render ? 'yes' : 'no';

    // Update editor URL. The video's editorUrl points at the API's public
    // base; this app owns the editor route, so link locally instead.
    editorUrlLink.href = `/editor?id=${encodeURIComponent(video.id)}`;

    // `.hidden` is a CSS class, so toggle the class (not just the attribute).
    detailsSection.classList.remove('hidden');

    if (video.status === 'failed' && video.error) {
      errorPanel.hidden = false;
      errorMessage.textContent = `${video.error.code}: ${video.error.message}`;
    } else {
      errorPanel.hidden = true;
    }

    // Completed videos get a download + share affordance.
    if (video.status === 'completed' && video.videoUrl) {
      downloadsSection.classList.remove('hidden');
      downloadLink.href = video.videoUrl;
      downloadLink.setAttribute(
        'download',
        `facelesspro-${video.id.slice(0, 8)}.mp4`,
      );
      videoPreview.src = video.videoUrl;
      videoPreview.hidden = false;
    } else {
      downloadsSection.classList.add('hidden');
      videoPreview.pause();
      videoPreview.removeAttribute('src');
      videoPreview.hidden = true;
    }

    // Show timeline.
    timelineSection.classList.remove('hidden');
    renderSteps(video);

    // Update status text.
    statusDiv.innerHTML = `<span class="badge badge-${video.status}">${video.status}</span> <span class="text-muted ml-2">Updated ${new Date(video.updatedAt).toLocaleTimeString()}</span>`;
  }

  function renderSteps(video: Video): void {
    const currentStepIndex = video.step ? STEPS_ORDER.indexOf(video.step) : -1;

    const stepsHtml = STEPS_ORDER.map((step, idx) => {
      const completed = idx < currentStepIndex;
      const current = idx === currentStepIndex;

      let badgeClass: string;
      let badgeText: string;
      if (completed) {
        badgeClass = 'badge badge-completed';
        badgeText = 'Done';
      } else if (current) {
        badgeClass = 'badge badge-processing';
        badgeText = 'Current';
      } else {
        badgeClass = 'badge' // no status badge class
        badgeText = 'Pending';
      }

      return `
        <div style="display:flex; align-items:center; gap:0.75rem; padding:0.5rem 0; border-bottom:1px solid var(--color-border);">
          <div style="flex:1;">
            <div style="font-size:0.875rem; font-weight:500; color:var(--color-text);">${step}</div>
          </div>
          <div class="${badgeClass}" style="${completed ? '' : current ? '' : 'background:var(--color-surface); color:var(--color-text-muted); border:1px solid var(--color-border);'}">
            ${badgeText}
          </div>
        </div>
      `;
    }).join('');

    stepsList.innerHTML = stepsHtml;
  }

  retryBtn.addEventListener('click', async () => {
    retryBtn.disabled = true;
    retryBtn.textContent = 'Retrying…';
    try {
      await retryVideo(videoId);
      await loadVideo();
    } catch (err) {
      alert(`Failed to retry: ${(err as Error).message}`);
      retryBtn.disabled = false;
      retryBtn.textContent = 'Retry';
    }
  });

  copyShareBtn.addEventListener('click', async () => {
    const shareUrl = `${window.location.origin}/videos/${encodeURIComponent(videoId)}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      shareStatus.textContent = 'Copied to clipboard';
    } catch {
      shareStatus.textContent = shareUrl;
    }
    setTimeout(() => {
      shareStatus.textContent = '';
    }, 2500);
  });

  // Wire up nav.
  bindChrome(container);

  await loadVideo();

  return container;
}
