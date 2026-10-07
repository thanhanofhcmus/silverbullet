import { afterEach, expect, test, vi } from "vitest";
import {
  dashboardUrl,
  dashboardSessionRoutes,
} from "./dashboard_navigation.ts";

afterEach(() => vi.unstubAllGlobals());

const configured = async () =>
  new Response(
    JSON.stringify({ primaryUrl: "https://dashboard.example.test" }),
  );
test("dashboard links use the configured primary origin", async () => {
  expect(await dashboardUrl("/profile", configured)).toBe(
    "https://dashboard.example.test/.dashboard/profile",
  );
});
test("deployments without a primary URL use origin-relative dashboard links", async () => {
  expect(
    await dashboardUrl("", async () => new Response("", { status: 404 })),
  ).toBe("/.dashboard");
});
test("isolated space session operations stay on the space origin", async () => {
  expect(await dashboardSessionRoutes(configured)).toEqual({
    profile: "/.auth/central/profile",
    logout: {
      endpoint: "/.auth/central/logout",
      method: "POST",
      destination: "/.auth/central/signed-out",
    },
  });
});

/**
 * Point the prefix helpers at a shell whose `<base href>` is `baseURI`, with a
 * primary URL configured so the central (OIDC) session routes are selected.
 */
async function routesFrom(
  baseURI: string,
  primaryUrl: string | null = "https://host.test",
) {
  vi.resetModules();
  // deno-lint-ignore no-explicit-any
  (globalThis as any).document = { baseURI };
  // deno-lint-ignore no-explicit-any
  (globalThis as any).location = new URL(baseURI);
  // The prefix helpers read document.baseURI at call time, so a fresh module
  // registry is enough to point them at a different shell.
  const { dashboardSessionRoutes: routes } = await import(
    "./dashboard_navigation.ts"
  );
  return routes(async () =>
    new Response(JSON.stringify({ primaryUrl }), { status: 200 }),
  );
}

test("prefixes central session routes when called from inside a space", async () => {
  // Regression: the profile menu and logout flow run in the editor, whose
  // shell's base URI is just the space prefix. serverPath() only recognizes the
  // admin surface mounts, so it reported no prefix here and logout was sent to
  // an origin-rooted /.auth/central/logout — which 404s and surfaced as
  // "Could not log out. Your edits remain saved on this device."
  const routes = await routesFrom("https://host.test/notes/");
  expect(routes.logout.endpoint).toBe("/notes/.auth/central/logout");
  expect(routes.logout.method).toBe("POST");
  expect(routes.logout.destination).toBe("/notes/.auth/central/signed-out");
  expect(routes.profile).toBe("/notes/.auth/central/profile");
});

test("prefixes central session routes when called from the dashboard", async () => {
  const routes = await routesFrom("https://host.test/notes/.dashboard/");
  expect(routes.logout.endpoint).toBe("/notes/.auth/central/logout");
  expect(routes.profile).toBe("/notes/.auth/central/profile");
});

test("leaves routes origin-rooted on an unprefixed server", async () => {
  const routes = await routesFrom("https://host.test/");
  expect(routes.logout.endpoint).toBe("/.auth/central/logout");
  expect(routes.profile).toBe("/.auth/central/profile");
});

test("uses the local dashboard routes when no primary URL is configured", async () => {
  const routes = await routesFrom("https://host.test/notes/", null);
  expect(routes.logout.endpoint).toBe("/notes/.dashboard/api/logout");
  expect(routes.logout.method).toBe("GET");
  expect(routes.logout.destination).toBe(
    "/notes/.dashboard/login?signedOut=true",
  );
  expect(routes.profile).toBe("/notes/.dashboard/api/profile");
});

test("does not double an already-prefixed dashboard path", async () => {
  const routes = await routesFrom("https://host.test/notes/.dashboard/", null);
  expect(routes.logout.endpoint).toBe("/notes/.dashboard/api/logout");
});
