/**
 * Public pricing view.
 *
 * Signed-out visitors can compare the plan shape before creating a key. The
 * catalog comes from `@facelesspro/contracts` — the same definitions the server
 * resolves a workspace against — so no request and no auth are needed.
 *
 * This build ships no prices: billing is deployment-specific, and inventing a
 * number here would be a promise the product cannot keep. The page advertises
 * the limits it can actually enforce.
 */

import { PLAN_DEFINITIONS, type PlanDef } from '@facelesspro/contracts';

import { loadSession } from '../session';
import { bindChrome, escapeHtml, headerHtml } from '../ui';

export async function renderPricing(_params: Record<string, string>): Promise<HTMLElement> {
  const container = document.createElement('div');
  container.className = 'app';

  const session = await loadSession();

  container.innerHTML = `
    ${headerHtml({ active: '/pricing', workspaceName: session?.name })}

    <section class="card mt-3">
      <h1 class="card-title">Plans</h1>
      <p class="text-muted mt-2">
        Every plan covers Tamil, English and Tanglish scripts with per-scene voice
        routing. Limits below are enforced by the API; prices and billing are set
        by each deployment, so this build ships no price list.
      </p>
    </section>

    <div class="pricing-grid mt-3">
      ${PLAN_DEFINITIONS.map(renderPlanCard).join('')}
    </div>

    <section class="card mt-3">
      <h2 class="card-title">Which plan fits?</h2>
      <p class="text-muted mt-2">
        The free plan is for trying the pipeline end to end. Paid tiers raise the
        monthly minutes, the longest single video and the export resolution.
        Self-hosting removes the monthly caps entirely: the ledger still records
        unit costs so you can measure cost per video.
      </p>
      <div class="mt-3">
        ${
          session === null
            ? '<button class="btn btn-primary" type="button" data-nav="/sign-in">Sign in to start</button>'
            : '<button class="btn btn-primary" type="button" data-nav="/studio">Create a video</button>'
        }
      </div>
    </section>
  `;

  bindChrome(container);
  return container;
}

function renderPlanCard(plan: PlanDef): string {
  const selfhost = plan.id === 'selfhost';
  return `
    <section class="card plan-card" data-plan="${escapeHtml(plan.id)}">
      <h2 class="card-title">${escapeHtml(planLabel(plan.id))}</h2>
      <p class="text-muted plan-tagline">${escapeHtml(planTagline(plan.id))}</p>
      <dl class="plan-limits mt-2">
        <div>
          <dt class="form-label">Video minutes / month</dt>
          <dd class="plan-value">${formatLimit(plan.minutesPerMonth)}</dd>
        </div>
        <div>
          <dt class="form-label">Credits / month</dt>
          <dd class="plan-value">${formatLimit(plan.creditsPerMonth)}</dd>
        </div>
        <div>
          <dt class="form-label">Longest video</dt>
          <dd class="plan-value">${plan.maxVideoMinutes} min</dd>
        </div>
        <div>
          <dt class="form-label">Max export</dt>
          <dd class="plan-value">${plan.maxResolution}p</dd>
        </div>
        <div>
          <dt class="form-label">Seats</dt>
          <dd class="plan-value">${plan.seats}</dd>
        </div>
      </dl>
      ${
        selfhost
          ? '<p class="text-muted plan-note">Install it yourself; no per-month cap.</p>'
          : ''
      }
    </section>
  `;
}

function planLabel(id: PlanDef['id']): string {
  switch (id) {
    case 'free':
      return 'Free';
    case 'pro':
      return 'Pro';
    case 'premium':
      return 'Premium';
    case 'premium_plus':
      return 'Premium Plus';
    case 'max':
      return 'Max';
    case 'selfhost':
      return 'Self-hosted';
  }
}

function planTagline(id: PlanDef['id']): string {
  switch (id) {
    case 'free':
      return 'Try the full pipeline on short videos.';
    case 'pro':
      return 'For a regular publishing schedule in 2K.';
    case 'premium':
      return 'More minutes and 4K exports for a small team.';
    case 'premium_plus':
      return 'High volume with more seats.';
    case 'max':
      return 'The largest monthly allowance we operate.';
    case 'selfhost':
      return 'Run the stack on your own hardware.';
  }
}

function formatLimit(value: number | null): string {
  return value === null ? 'Unlimited' : String(value);
}
