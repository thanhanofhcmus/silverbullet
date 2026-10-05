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
