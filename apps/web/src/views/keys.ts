/**
 * API keys view.
 *
 * Lists existing API keys (`GET /v1/keys`), creates a new key (`POST /v1/keys`)
 * and revokes keys (`DELETE /v1/keys/:id`). The secret is shown once, at
 * creation time — the list only ever returns the prefix.
 */

import { createApiKey, listApiKeys, revokeApiKey, type ApiKeyRow } from '../api';
import { loadSession } from '../session';
import { bindChrome, escapeHtml, headerHtml } from '../ui';

export async function renderKeys(_params: Record<string, string>): Promise<HTMLElement> {
  const container = document.createElement('div');
  container.className = 'app';

  const session = await loadSession();

  container.innerHTML = `
    ${headerHtml({ active: '/keys', workspaceName: session?.name })}

    <section class="card mt-3">
      <h1 class="card-title">API Keys</h1>
      <p class="text-muted mt-2">
        API keys authenticate requests to the FacelessPro API. Keys are
        workspace-scoped and immediately revocable. The full key is shown once,
        when you create it.
      </p>
    </section>

    <section class="card mt-3">
      <h2 class="card-title">Create a new key</h2>
      <form id="create-key-form" class="mt-2">
        <div class="form-group">
          <label class="form-label" for="key-name">Key name</label>
          <input
            type="text"
            id="key-name"
            class="form-input"
            placeholder="e.g. My video bot"
            autocomplete="off"
            required
          />
        </div>
        <button class="btn btn-primary mt-2" type="submit" id="create-key">Create key</button>
      </form>
      <div id="key-created" class="mt-2" role="status"></div>
    </section>

    <section class="card mt-3">
      <h2 class="card-title">Your keys</h2>
      <div id="keys-list" class="mt-2">
        <p class="text-muted">Loading keys…</p>
      </div>
    </section>
  `;

  const form = container.querySelector('#create-key-form') as HTMLFormElement;
  const createBtn = container.querySelector('#create-key') as HTMLButtonElement;
  const nameInput = container.querySelector('#key-name') as HTMLInputElement;
  const createdDiv = container.querySelector('#key-created') as HTMLDivElement;
  const keysList = container.querySelector('#keys-list') as HTMLDivElement;

  async function loadKeys(): Promise<void> {
    try {
      const keys = await listApiKeys();
      keysList.innerHTML =
        keys.length === 0
          ? '<p class="text-muted">No keys yet.</p>'
          : keys.map(renderKeyRow).join('');
    } catch (error) {
      keysList.innerHTML = `<p class="form-error">Failed to load keys: ${escapeHtml(messageOf(error))}</p>`;
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = nameInput.value.trim();
    if (name === '') return;

    createBtn.disabled = true;
    createBtn.textContent = 'Creating…';
    try {
      const result = await createApiKey(name);
      nameInput.value = '';
      createdDiv.innerHTML = `
        <div class="card" style="border-color: var(--color-success);">
          <div class="form-label">New API key — copy it now, it will not be shown again:</div>
          <div class="key-secret">${escapeHtml(result.key)}</div>
          <button class="btn btn-secondary mt-2" type="button" id="copy-key">Copy to clipboard</button>
        </div>
      `;
      const copyBtn = createdDiv.querySelector('#copy-key') as HTMLButtonElement | null;
      copyBtn?.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(result.key);
          copyBtn.textContent = 'Copied!';
          setTimeout(() => {
            copyBtn.textContent = 'Copy to clipboard';
          }, 1500);
        } catch {
          copyBtn.textContent = 'Select the key and copy manually';
        }
      });
      await loadKeys();
    } catch (error) {
      createdDiv.innerHTML = `<p class="form-error">Failed to create key: ${escapeHtml(messageOf(error))}</p>`;
    } finally {
      createBtn.disabled = false;
      createBtn.textContent = 'Create key';
    }
  });

  // Event delegation: rows are re-rendered after every change.
  keysList.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLButtonElement>('[data-revoke-key]');
    if (!button) return;
    const id = button.dataset['revokeKey'];
    if (!id) return;
    if (!confirm('Revoke this key? Requests using it will start failing immediately.')) return;

    button.disabled = true;
    try {
      await revokeApiKey(id);
      await loadKeys();
    } catch (error) {
      button.disabled = false;
      alert(`Failed to revoke key: ${messageOf(error)}`);
    }
  });

  bindChrome(container);
  await loadKeys();
  return container;
}

function renderKeyRow(key: ApiKeyRow): string {
  const revoked = key.revoked_at !== null;
  const lastUsed =
    key.last_used_at === null ? 'never' : new Date(key.last_used_at).toLocaleString();
  return `
    <div class="key-row">
      <div>
        <div class="key-name">
          ${escapeHtml(key.name)}
          ${revoked ? '<span class="badge badge-failed">revoked</span>' : ''}
        </div>
        <div class="key-prefix">${escapeHtml(key.prefix)}…</div>
        <div class="key-meta">Last used: ${escapeHtml(lastUsed)}</div>
      </div>
      ${
        revoked
          ? ''
          : `<button class="btn btn-danger key-revoke" type="button" data-revoke-key="${escapeHtml(key.id)}">
               Revoke
             </button>`
      }
    </div>
  `;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
