import { afterEach, describe, expect, test, vi } from "vitest";

async function load(baseURI: string, href = "https://host.test/") {
  vi.resetModules();
  // deno-lint-ignore no-explicit-any
  (globalThis as any).document = { baseURI };
  // deno-lint-ignore no-explicit-any
  (globalThis as any).location = new URL(href);
  return await import("./server_prefix.ts");
}

afterEach(() => {
  // deno-lint-ignore no-explicit-any
  delete (globalThis as any).document;
  // deno-lint-ignore no-explicit-any
  delete (globalThis as any).location;
});

describe("serverPrefix", () => {
  test("is empty when mounted at the origin root", async () => {
    const { serverPrefix } = await load("https://host.test/.dashboard/");
    expect(serverPrefix()).toBe("");
  });

  test("is derived from each admin surface mount", async () => {
    for (const base of [
      "https://host.test/notes/.dashboard/",
      "https://host.test/notes/.auth/central/",
      "https://host.test/notes/.setup/",
    ]) {
      const { serverPrefix } = await load(base);
      expect(serverPrefix(), base).toBe("/notes");
    }
  });

  test("handles a nested prefix", async () => {
    const { serverPrefix } = await load("https://host.test/a/b/.dashboard/");
    expect(serverPrefix()).toBe("/a/b");
  });
});

describe("serverPath / serverUrl", () => {
  test("prefixes origin-rooted paths", async () => {
    const { serverPath, serverUrl } = await load(
      "https://host.test/notes/.dashboard/",
      "https://host.test/notes/.dashboard/",
    );
    expect(serverPath("/.auth/central/public")).toBe(
      "/notes/.auth/central/public",
    );
    expect(serverUrl("/.dashboard").href).toBe(
      "https://host.test/notes/.dashboard",
    );
  });

  test("leaves paths untouched without a prefix", async () => {
    const { serverPath } = await load("https://host.test/.dashboard/");
    expect(serverPath("/.auth/central/public")).toBe("/.auth/central/public");
  });
});

describe("isDashboardPath", () => {
  test("matches the prefixed dashboard on a segment boundary", async () => {
    const { isDashboardPath } = await load(
      "https://host.test/notes/.auth/central/",
    );
    expect(isDashboardPath("/notes/.dashboard")).toBe(true);
    expect(isDashboardPath("/notes/.dashboard/users")).toBe(true);
    expect(isDashboardPath("/.dashboard/")).toBe(false);
    expect(isDashboardPath("/notes/.dashboard-other")).toBe(false);
    expect(isDashboardPath("/notes/Page")).toBe(false);
  });

  test("matches the root dashboard without a prefix", async () => {
    const { isDashboardPath } = await load("https://host.test/.auth/central/");
    expect(isDashboardPath("/.dashboard/")).toBe(true);
    expect(isDashboardPath("/.dashboard-other")).toBe(false);
  });
});

describe("centralOriginFor", () => {
  test("appends the server prefix to a bare primary URL", async () => {
    // Regression: the OIDC wizard pre-filled the central login URL from the
    // primary URL (a bare origin) and then disabled the field, so a prefixed
    // server produced a callback URL without the prefix — one the identity
    // provider had not registered.
    const { centralOriginFor } = await load(
      "https://host.test/notes/.dashboard/",
      "https://host.test/notes/.dashboard/",
    );
    expect(centralOriginFor("https://host.test")).toBe(
      "https://host.test/notes",
    );
  });

  test("leaves an unprefixed server at the bare origin", async () => {
    const { centralOriginFor } = await load("https://host.test/.dashboard/");
    expect(centralOriginFor("https://host.test")).toBe("https://host.test");
  });

  test("does not double up a prefix the primary URL already carries", async () => {
    const { centralOriginFor } = await load(
      "https://host.test/notes/.dashboard/",
    );
    expect(centralOriginFor("https://host.test/notes")).toBe(
      "https://host.test/notes",
    );
  });

  test("preserves an unrelated path on the primary URL", async () => {
    const { centralOriginFor } = await load(
      "https://host.test/notes/.dashboard/",
    );
    expect(centralOriginFor("https://host.test/base")).toBe(
      "https://host.test/notes/base",
    );
  });

  test("returns the input unchanged when it is not a URL", async () => {
    const { centralOriginFor } = await load(
      "https://host.test/notes/.dashboard/",
    );
    expect(centralOriginFor("not a url")).toBe("not a url");
  });
});

describe("spaceServerPrefix", () => {
  test("is the space base path, independent of admin surfaces", async () => {
    const { spaceServerPrefix } = await load("https://host.test/notes/");
    expect(spaceServerPrefix()).toBe("/notes");
  });

  test("is empty for a root-bound space", async () => {
    const { spaceServerPrefix } = await load("https://host.test/");
    expect(spaceServerPrefix()).toBe("");
  });
});
