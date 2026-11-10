/**
 * Client-side router for the FacelessPro web app.
 *
 * Supports hash-based and history-based routing. Views register themselves
 * with a name and a render function; the router switches views on
 * `popstate` and on `navigate()` calls.
 */

export type ViewRender = (params: Record<string, string>) => HTMLElement | Promise<HTMLElement>;

interface Route {
  path: string;       // e.g. "/studio", "/videos/:id"
  render: ViewRender;
  exact?: boolean;    // exact match (default: prefix match for nested)
}

export class Router {
  private routes: Route[] = [];
  private container: HTMLElement;
  private currentView?: { element: HTMLElement; cleanup?: () => void };
  private readonly base: string;

  constructor(container: HTMLElement, base = '') {
    this.container = container;
    this.base = base;
  }

  add(route: Route): void {
    this.routes.push(route);
  }

  private matchPath(path: string): Route | null {
    for (const route of this.routes) {
      if (route.exact) {
        if (path === route.path) return route;
      } else {
        const routeRegex = new RegExp(
          '^' +
            route.path.replace(/:\w+/g, '([^/]+)').replace(/\*/g, '.*') +
            '(?:/|$)',
        );
        if (routeRegex.test(path)) return route;
      }
    }
    return null;
  }

  private extractParams(path: string, route: Route): Record<string, string> {
    const params: Record<string, string> = {};
    const keys = route.path.match(/:\w+/g) ?? [];
    const regex = new RegExp(
      '^' +
        route.path.replace(/:\w+/g, '([^/]+)').replace(/\*/g, '.*') +
        '(?:/|$)',
    );
    const match = path.match(regex);
    if (!match) return params;
    keys.forEach((key, idx) => {
      params[key.slice(1)] = match[idx + 1] ?? '';
    });
    return params;
  }

  async navigate(path: string): Promise<void> {
    // Normalize: strip base, ensure leading slash.
    let normalized = path;
    if (this.base && normalized.startsWith(this.base)) {
      normalized = normalized.slice(this.base.length);
    }
    if (!normalized.startsWith('/')) normalized = '/' + normalized;

    history.pushState({}, '', this.base + normalized);
    await this.render(normalized.split('?')[0] ?? normalized);
  }

  async render(path: string): Promise<void> {
    const route = this.matchPath(path);
    if (!route) {
      this.container.innerHTML = '<div class="card mt-3"><h1>404 Not Found</h1><p>The page you are looking for does not exist.</p></div>';
      return;
    }

    // Clean up previous view.
    if (this.currentView) {
      this.currentView.element.remove();
      if (this.currentView.cleanup) this.currentView.cleanup();
      this.currentView = undefined;
    }

    // Path parameters win over query parameters of the same name.
    const params = { ...this.queryParams(), ...this.extractParams(path, route) };
    const element = await route.render(params);
    this.container.appendChild(element);
    this.currentView = { element };
  }

  private queryParams(): Record<string, string> {
    const params: Record<string, string> = {};
    new URLSearchParams(window.location.search).forEach((value, key) => {
      params[key] = value;
    });
    return params;
  }

  start(): void {
    window.addEventListener('popstate', async () => {
      await this.render(window.location.pathname);
    });
    // Initial render.
    void this.render(window.location.pathname);
  }

  link(path: string): void {
    // Programmatic navigation without pushing state (used by <a onclick>).
    void this.navigate(path);
  }
}
