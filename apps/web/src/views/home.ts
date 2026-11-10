/**
 * Home / landing page view.
 *
 * Signed-in visitors see the template gallery (`GET /v1/art-styles`) and their
 * plan and credit balance (`GET /v1/workspace`). Signed-out visitors get the
 * product pitch and a sign-in call to action — the gallery needs a key.
 */

import { getArtStyles, type ArtStyle } from '../api';
import { loadSession } from '../session';
import { bindChrome, escapeHtml, headerHtml } from '../ui';

export async function renderHome(_params: Record<string, string>): Promise<HTMLElement> {
  const container = document.createElement('div');
  container.className = 'app';

  const session = await loadSession();
  let styles: ArtStyle[] = [];

  if (session !== null) {
    try {
      styles = await getArtStyles();
    } catch {
      styles = [];
    }
  }

  container.innerHTML = `
    ${headerHtml({ active: '/', workspaceName: session?.name })}

    <section class="card mt-3">
      <h1 class="card-title">Create faceless videos</h1>
      <p class="text-muted mt-2">
        Generate AI videos from a script or voiceover. Supports Tamil, English
        and Tanglish with artwork-first styles and per-scene voice plans.
      </p>
      <div class="mt-3 flex gap-2">
        ${
          session === null
            ? '<button class="btn btn-primary" type="button" data-nav="/sign-in">Sign in to start</button>'
            : '<button class="btn btn-primary" type="button" data-nav="/studio">Create a video</button>'
        }
        <button class="btn btn-secondary" type="button" data-nav="/keys">Manage API keys</button>
      </div>
    </section>

    ${
      session === null
        ? ''
        : `<section class="card mt-3">
             <h2 class="card-title">Your plan</h2>
             <div class="plan-grid mt-2">
               <div>
                 <div class="form-label">Plan</div>
                 <div class="plan-value">${escapeHtml(session.plan.id)}</div>
               </div>
               <div>
                 <div class="form-label">Video minutes / month</div>
                 <div class="plan-value">${formatLimit(session.plan.minutesPerMonth)}</div>
               </div>
               <div>
                 <div class="form-label">Max resolution</div>
                 <div class="plan-value">${session.plan.maxResolution}p</div>
               </div>
               <div>
                 <div class="form-label">Credits</div>
                 <div class="plan-value">${session.credits === null ? 'Unlimited' : session.credits}</div>
               </div>
             </div>
           </section>`
    }

    <section class="card mt-3">
      <h2 class="card-title">Templates</h2>
      <div id="template-grid" class="template-grid mt-2">
        ${
          session === null
            ? '<p class="text-muted">Sign in to browse the art styles available to your workspace.</p>'
            : styles.length === 0
              ? '<p class="text-muted">No templates available yet. Upload an art style to get started.</p>'
              : styles.map(renderStyleCard).join('')
        }
      </div>
    </section>

    <section class="card mt-3">
      <h2 class="card-title">How it works</h2>
      <ol class="steps mt-2">
        <li><span class="badge badge-processing">1</span><p class="text-muted">Paste a script (Tamil, English or Tanglish)</p></li>
        <li><span class="badge badge-processing">2</span><p class="text-muted">Choose an art style and voice pair</p></li>
        <li><span class="badge badge-rendering">3</span><p class="text-muted">Generate scenes, narration and render MP4</p></li>
        <li><span class="badge badge-completed">4</span><p class="text-muted">Download or share the finished video</p></li>
      </ol>
    </section>
  `;

  bindChrome(container);
  return container;
}

function renderStyleCard(style: ArtStyle): string {
  const preview = style.previewUrl
    ? `style="background-image:url('${escapeHtml(style.previewUrl)}')"`
    : '';
  return `
    <div class="style-card">
      <div class="style-preview" ${preview}></div>
      <div class="style-info">
        <div class="style-name">${escapeHtml(style.name)}</div>
        <div class="style-meta">
          ${escapeHtml(style.formats.join(', '))} · ${escapeHtml(style.status)}
        </div>
      </div>
    </div>
  `;
}

function formatLimit(value: number | null): string {
  return value === null ? 'Unlimited' : String(value);
}
