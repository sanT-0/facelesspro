/**
 * Sign-in view.
 *
 * FacelessPro is API-first: a browser session is an API key. The key is
 * validated against `GET /v1/workspace` before it is stored, so a typo or a
 * revoked key never becomes a stored dead session.
 */

import { clearAuthToken, getWorkspace, setAuthToken } from '../api';
import { invalidateSession, loadSession } from '../session';
import { bindChrome, escapeHtml, headerHtml, navigate } from '../ui';

export async function renderSignIn(_params: Record<string, string>): Promise<HTMLElement> {
  const container = document.createElement('div');
  container.className = 'app';

  const session = await loadSession();

  container.innerHTML = `
    ${headerHtml({ active: undefined, workspaceName: session?.name })}

    <section class="card mt-3">
      <h1 class="card-title">Sign in</h1>
      <p class="text-muted mt-2">
        Paste a workspace API key to use the studio, the editor and the API
        keys page. Keys start with <code>vp_</code>.
      </p>
      ${
        session
          ? `<p class="mt-2">
               Signed in as <strong>${escapeHtml(session.name)}</strong>
               (${escapeHtml(session.plan.id)} plan).
             </p>
             <div class="mt-3 flex gap-2">
               <button class="btn btn-primary" type="button" data-nav="/studio">Open the studio</button>
               <button class="btn btn-secondary" type="button" data-action="sign-out">Sign out</button>
             </div>`
          : `<form id="sign-in-form" class="mt-3" novalidate>
               <div class="form-group">
                 <label class="form-label" for="api-key">API key</label>
                 <input
                   id="api-key"
                   name="api-key"
                   class="form-input"
                   type="password"
                   autocomplete="off"
                   spellcheck="false"
                   placeholder="vp_…"
                   required
                 />
               </div>
               <button class="btn btn-primary" type="submit" id="sign-in-btn">Sign in</button>
               <div id="sign-in-error" class="form-error mt-2" role="alert" hidden></div>
             </form>`
      }
      <p class="text-muted mt-3">
        No key yet? Create one on the server with
        <code>npm run key:create</code> — the key is printed once.
      </p>
    </section>
  `;

  if (session === null) {
    const form = container.querySelector('#sign-in-form') as HTMLFormElement;
    const input = container.querySelector('#api-key') as HTMLInputElement;
    const button = container.querySelector('#sign-in-btn') as HTMLButtonElement;
    const errorBox = container.querySelector('#sign-in-error') as HTMLDivElement;

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      errorBox.hidden = true;
      const key = input.value.trim();
      if (key === '') {
        showError(errorBox, 'Enter an API key.');
        input.focus();
        return;
      }

      button.disabled = true;
      button.textContent = 'Checking…';
      setAuthToken(key);
      invalidateSession();

      try {
        const workspace = await getWorkspace();
        navigate('/studio');
        // Keep a reference so the success path is observable to the user
        // even if navigation is interrupted.
        container.dataset['signedInAs'] = workspace.name;
      } catch (error) {
        clearAuthToken();
        invalidateSession();
        showError(errorBox, messageFor(error));
        input.select();
      } finally {
        button.disabled = false;
        button.textContent = 'Sign in';
      }
    });

    // Bind nav/sign-out after the form exists.
    bindChrome(container);
    input.focus();
    return container;
  }

  bindChrome(container);
  return container;
}

function showError(box: HTMLDivElement, message: string): void {
  box.textContent = message;
  box.hidden = false;
}

function messageFor(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status?: unknown }).status === 401
  ) {
    return 'That key was not accepted. Check it was copied whole and is not revoked.';
  }
  return error instanceof Error ? error.message : 'Could not reach the API.';
}
