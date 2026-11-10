/**
 * Signed-in session state for the web app.
 *
 * The token itself lives in `api.ts` (localStorage). This module validates a
 * token against `GET /v1/workspace` and caches the workspace so the header can
 * show the workspace name without a request on every navigation.
 */

import { clearAuthToken, getAuthToken, getWorkspace, type Workspace } from './api';

let cached: { readonly token: string; readonly workspace: Workspace } | null = null;

/**
 * Resolve the signed-in workspace, or `null` when there is no usable token.
 * A rejected token is discarded so the UI cannot stay stuck on a dead key.
 */
export async function loadSession(): Promise<Workspace | null> {
  const token = getAuthToken();
  if (token === null) return null;
  if (cached !== null && cached.token === token) return cached.workspace;

  try {
    const workspace = await getWorkspace();
    cached = { token, workspace };
    return workspace;
  } catch (error) {
    if (isUnauthorized(error)) clearAuthToken();
    return null;
  }
}

/** Drop the cached workspace, e.g. after signing in as someone else. */
export function invalidateSession(): void {
  cached = null;
}

function isUnauthorized(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status?: unknown }).status === 401
  );
}
