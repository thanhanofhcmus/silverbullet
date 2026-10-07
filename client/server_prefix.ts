/**
 * Server-wide URL prefix support.
 *
 * SilverBullet can be mounted under a URL prefix (e.g. `/notes`) via
 * `SB_SERVER_PREFIX`. The server rewrites each admin shell's `<base href>` to
 * include the prefix, so `document.baseURI` already points at the prefixed
 * surface — e.g. `/notes/.dashboard/` for the dashboard and
 * `/notes/.auth/central/` for the login page.
 *
 * Client code that needs to address a *different* server surface than the one
 * it is running in (the dashboard reaching central auth, the login page
 * reaching the dashboard) must therefore include the same prefix. These
 * helpers derive it once from `document.baseURI`.
 */

/** The known server surface mounts, longest first so prefixes resolve right. */
const SURFACES = ["/.auth/central", "/.dashboard", "/.setup"] as const;

/**
 * The server prefix (e.g. `/notes`), or `""` when the server is mounted at the
 * origin root. Derived from the current shell's base URI.
 */
export function serverPrefix(): string {
  if (typeof document === "undefined" || !document.baseURI) return "";
  let pathname: string;
  try {
    pathname = new URL(document.baseURI).pathname;
  } catch {
    return "";
  }
  // Strip a trailing slash, then remove the surface suffix if present.
  const trimmed = pathname.replace(/\/+$/, "");
  for (const surface of SURFACES) {
    if (trimmed.endsWith(surface)) {
      return trimmed.slice(0, trimmed.length - surface.length);
    }
  }
  // Unknown surface: no detectable prefix.
  return "";
}

/**
 * Build an absolute, origin-rooted path to a server surface, honoring the
 * server prefix. `path` must start with a known surface, e.g.
 * `serverPath("/.auth/central/public")` → `/notes/.auth/central/public`.
 */
export function serverPath(path: string): string {
  const prefix = serverPrefix();
  if (!prefix) return path;
  return `${prefix}${path}`;
}

/**
 * Whether an origin-rooted `pathname` addresses this server's dashboard,
 * i.e. `{prefix}/.dashboard` or anything below it.
 */
export function isDashboardPath(pathname: string): boolean {
  const dashboard = serverPath("/.dashboard");
  return pathname === dashboard || pathname.startsWith(`${dashboard}/`);
}

/**
 * Like {@link serverPath}, but returns a full URL on the request's origin.
 */
export function serverUrl(path: string): URL {
  return new URL(serverPath(path), location.origin);
}

/**
 * Combine an origin-rooted primary URL with this server's prefix to get the
 * origin of the central-auth surface.
 *
 * The primary URL configured under Admin → Server is the *bare* origin
 * (`https://host`): it addresses the space, which the server dispatches at the
 * root. The admin surfaces, central auth included, live under the server
 * prefix instead (`https://host/notes/.auth/central/...`), so building the
 * central origin from the primary URL alone drops the prefix and produces a
 * callback URL the identity provider has not registered.
 *
 * A primary URL that already carries the prefix is left alone, so this stays
 * correct if the two are ever configured to coincide.
 */
export function centralOriginFor(primaryUrl: string): string {
  const prefix = serverPrefix();
  let url: URL;
  try {
    url = new URL(primaryUrl);
  } catch {
    return primaryUrl;
  }
  const base = url.origin;
  const path = url.pathname.replace(/\/+$/, "");
  if (!prefix || path === prefix || path.startsWith(`${prefix}/`)) {
    return path ? `${base}${path}` : base;
  }
  return `${base}${prefix}${path}`;
}

/**
 * Like {@link serverPath}, but works from a **space** shell as well as from an
 * admin surface.
 *
 * {@link serverPrefix} only recognizes the admin surface mounts, so from a
 * space (whose base URI is just `{prefix}/`) it reports no prefix and
 * {@link serverPath} silently returns an origin-rooted path. Code that runs in
 * both contexts — the profile menu and logout flow, which live in the editor —
 * must instead fall back to {@link spaceServerPrefix}, whose value is the base
 * path itself. Getting this wrong sends logout to `/.auth/central/logout`
 * rather than `{prefix}/.auth/central/logout`, which 404s.
 */
export function anyServerPath(path: string): string {
  const prefix = serverOnSurface() ? serverPrefix() : spaceServerPrefix();
  if (!prefix) return path;
  return `${prefix}${path}`;
}

/** Whether the current base URI identified one of the admin surface mounts. */
function serverOnSurface(): boolean {
  if (typeof document === "undefined" || !document.baseURI) return false;
  try {
    const trimmed = new URL(document.baseURI).pathname.replace(/\/+$/, "");
    return SURFACES.some((surface) => trimmed.endsWith(surface));
  } catch {
    return false;
  }
}

/**
 * The server prefix as seen from inside a **space** client.
 *
 * A space is served under its own `host_url_prefix` (e.g. `/notes`), and the
 * server-wide admin surfaces (`/.dashboard`, `/.auth/central`) are mounted
 * under the same prefix. The space shell's `document.baseURI` is therefore
 * `{serverPrefix}/`, so the prefix is just the base path with any trailing
 * slash removed. This is deliberately separate from {@link serverPrefix},
 * which identifies one of the admin surface mounts.
 */
export function spaceServerPrefix(): string {
  if (typeof document === "undefined" || !document.baseURI) return "";
  try {
    return new URL(document.baseURI).pathname.replace(/\/+$/, "");
  } catch {
    return "";
  }
}
