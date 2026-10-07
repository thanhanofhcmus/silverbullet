import { anyServerPath } from "./server_prefix.ts";

export type LogoutRoute = {
  endpoint: string;
  method: "GET" | "POST";
  destination: string;
};

async function primaryUrl(fetchFn: typeof fetch): Promise<string | undefined> {
  try {
    const response = await fetchFn(anyServerPath("/.auth/central/public"));
    if (!response.ok) return;
    const { primaryUrl } = await response.json();
    if (typeof primaryUrl !== "string") return;
    const url = new URL(primaryUrl);
    if (["https:", "http:"].includes(url.protocol) && url.origin === primaryUrl)
      return primaryUrl;
  } catch {}
}

export async function dashboardUrl(
  path = "",
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  return `${(await primaryUrl(fetchFn)) ?? ""}${anyServerPath("/.dashboard")}${path}`;
}

export async function dashboardSessionRoutes(
  fetchFn: typeof fetch = fetch,
): Promise<{
  profile: string;
  logout: LogoutRoute;
}> {
  return (await primaryUrl(fetchFn))
    ? {
        profile: anyServerPath("/.auth/central/profile"),
        logout: {
          endpoint: anyServerPath("/.auth/central/logout"),
          method: "POST",
          destination: anyServerPath("/.auth/central/signed-out"),
        },
      }
    : {
        profile: anyServerPath("/.dashboard/api/profile"),
        logout: {
          endpoint: anyServerPath("/.dashboard/api/logout"),
          method: "GET",
          destination: anyServerPath("/.dashboard/login?signedOut=true"),
        },
      };
}
