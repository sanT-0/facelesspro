/**
 * Shared chrome for every view: the header, navigation wiring, and the one
 * HTML escaper.
 *
 * Keeping the header here means the signed-in state, the nav and the sign-out
 * action cannot drift between pages.
 */

import { clearAuthToken } from './api';

export interface HeaderOptions {
  /** Path of the page currently rendered, so the nav can mark it. */
  readonly active?: string;
  /** Display name of the signed-in workspace, when known. */
  readonly workspaceName?: string | null;
}

const LINKS: ReadonlyArray<{ path: string; label: string }> = [
  { path: '/', label: 'Home' },
  { path: '/studio', label: 'Create Video' },
  { path: '/keys', label: 'API Keys' },
];

/** Markup for the app header. `active` is a path such as `/studio`. */
export function headerHtml(options: HeaderOptions = {}): string {
  const { active, workspaceName } = options;
  const links = LINKS.map((link) => {
    const current = link.path === active ? ' aria-current="page" class="is-active"' : '';
    return `<a href="#" data-nav="${link.path}"${current}>${link.label}</a>`;
  }).join('');

  const account =
    workspaceName === undefined || workspaceName === null
      ? '<a href="#" class="nav-key" data-nav="/sign-in">Sign in</a>'
      : `<span class="nav-workspace" title="Signed in">${escapeHtml(workspaceName)}</span>
         <button type="button" class="nav-key nav-signout" data-action="sign-out">Sign out</button>`;

  return `
    <header class="header">
      <a href="#" class="brand" data-nav="/">
        <span class="brand-mark" aria-hidden="true">FP</span>
        <span>FacelessPro</span>
      </a>
      <nav class="nav" aria-label="Main">
        ${links}
        ${account}
      </nav>
    </header>
  `;
}

/**
 * Wire every `[data-nav]` link in `root`, and the sign-out button when the
 * header rendered one.
 */
export function bindChrome(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[data-nav]').forEach((el) => {
    el.addEventListener('click', (event) => {
      event.preventDefault();
      const target = el.getAttribute('data-nav');
      if (target) navigate(target);
    });
  });

  root.querySelectorAll<HTMLElement>('[data-action="sign-out"]').forEach((el) => {
    el.addEventListener('click', () => {
      clearAuthToken();
      navigate('/');
    });
  });
}

/** Navigate through the app's router event, so views do not import it. */
export function navigate(path: string): void {
  window.dispatchEvent(new CustomEvent('facelesspro:navigate', { detail: path }));
}

/** Escape untrusted text before putting it in an HTML string. */
export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
