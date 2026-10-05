import { serverPath } from "./server_prefix.ts";

export type LogoutRoute = {
  endpoint: string;
  method: "GET" | "POST";
  destination: string;
};

async function primaryUrl(fetchFn: typeof fetch): Promise<string | undefined> {
  try {
    const response = await fetchFn(serverPath("/.auth/central/public"));
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
  return `${(await primaryUrl(fetchFn)) ?? ""}${serverPath("/.dashboard")}${path}`;
}

export async function dashboardSessionRoutes(
  fetchFn: typeof fetch = fetch,
): Promise<{
  profile: string;
  logout: LogoutRoute;
}> {
  return (await primaryUrl(fetchFn))
    ? {
        profile: serverPath("/.auth/central/profile"),
        logout: {
          endpoint: serverPath("/.auth/central/logout"),
          method: "POST",
          destination: serverPath("/.auth/central/signed-out"),
        },
      }
    : {
        profile: serverPath("/.dashboard/api/profile"),
        logout: {
          endpoint: serverPath("/.dashboard/api/logout"),
          method: "GET",
          destination: serverPath("/.dashboard/login?signedOut=true"),
        },
      };
}
