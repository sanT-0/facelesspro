/**
 * FacelessPro web app entry point.
 *
 * Bootstraps the client-side router, registers views, and guards the pages
 * that need an API key. API calls go through `src/api.ts`, which the dev
 * server proxies to the API backend on the same origin.
 */

import { Router } from './router';
import type { ViewRender } from './router';
import { getAuthToken } from './api';
import { renderHome } from './views/home';
import { renderSignIn } from './views/sign-in';
import { renderKeys } from './views/keys';
import { renderStudio } from './views/studio';
import { renderJob } from './views/job';
import { renderEditor } from './views/editor';

const appContainer = document.getElementById('app');
if (!appContainer) {
  throw new Error('#app element not found in index.html');
}

const router = new Router(appContainer);

/** Send visitors without a key to the sign-in page instead of a broken view. */
function requireAuth(render: ViewRender): ViewRender {
  return async (params) => {
    if (getAuthToken() === null) {
      await router.navigate('/sign-in');
      return document.createElement('div');
    }
    return render(params);
  };
}

// Public routes.
router.add({ path: '/', render: renderHome, exact: true });
router.add({ path: '/sign-in', render: renderSignIn, exact: true });

// Workspace routes.
router.add({ path: '/studio', render: requireAuth(renderStudio), exact: true });
router.add({ path: '/keys', render: requireAuth(renderKeys), exact: true });
router.add({ path: '/videos/:id', render: requireAuth(renderJob) });
router.add({ path: '/editor', render: requireAuth(renderEditor), exact: true });
router.add({ path: '/editor/:id', render: requireAuth(renderEditor) });

// Views navigate by dispatching this event, so they do not import the router.
window.addEventListener('facelesspro:navigate', (event) => {
  const target = (event as CustomEvent<string>).detail;
  void router.navigate(target);
});

void router.start();
