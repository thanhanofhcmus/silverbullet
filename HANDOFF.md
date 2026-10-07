# HANDOFF — SilverBullet fork with a server-wide URL prefix

State as of the tip of `feature/url-prefix-all-surfaces`.
Written for the next agent picking this up cold. Read this whole file before
acting.

Placeholders used throughout — substitute your real values:

| Placeholder | Meaning |
|---|---|
| `<FORK_REPO>` | the fork's git URL |
| `<CLONE>` | path to the local clone |
| `<PUBLIC_HOST>` | public hostname the app is served on |
| `<IDP_HOST>` | public hostname of the OIDC provider |
| `<DEPLOY_HOST>` | host running the container stack |
| `<DEPLOY_USER>` | unprivileged user owning `<DEPLOY_DIR>` |
| `<DEPLOY_DIR>` | project directory holding `docker-compose.yaml` |
| `<PREFIX>` | the URL prefix, e.g. `/notes` |

---

## 1. What this is

A **fork of SilverBullet** adding a server-wide URL prefix so the *entire*
application — space, dashboard, setup wizard, OIDC login and callback — can be
served under `<PREFIX>` on a shared host. It is deployed behind Traefik with
Authelia as the OIDC identity provider.

The "everything under one prefix" requirement is **hard** and is the reason for
the fork; serving it on a dedicated subdomain instead was considered and
explicitly rejected.

- **Fork:** `<FORK_REPO>`
- **Branch:** `feature/url-prefix-all-surfaces`
- **Local clone:** `<CLONE>`
- **Upstream:** `upstream` remote → `silverbulletmd/silverbullet`

---

## 2. Where it is deployed

| Thing | Value |
|---|---|
| Public URL | `https://<PUBLIC_HOST><PREFIX>/` |
| Dashboard | `https://<PUBLIC_HOST><PREFIX>/.dashboard` |
| OIDC provider | `https://<IDP_HOST>` |
| Deploy host | `<DEPLOY_HOST>`, user `<DEPLOY_USER>` |
| Project dir | `<DEPLOY_DIR>` (owned by `<DEPLOY_USER>`) |
| Compose service | `silverbullet` in `<DEPLOY_DIR>/docker-compose.yaml` |
| Data dir | `<DEPLOY_DIR>/silverbullet/data` → `/data` (uid/gid 1000) |
| Space folder | `data/spaces/<space>` bound at the prefix, no host binding |
| Provider config | `<DEPLOY_DIR>/authelia/configuration.yml` |
| Traefik network | `public_app` bridge |

**The operator's working tree and the deploy host are different machines, and
the agent cannot write to `<DEPLOY_DIR>`.** All deploy-host edits go through a
terminal multiplexer pane running as `<DEPLOY_USER>`. See §6.

### Auth model (important — do not "fix" this)

SilverBullet is itself the OIDC **client**. The Traefik router for `<PREFIX>`
must **not** carry forward-auth middleware — that would double-prompt and break
the OIDC callback. The provider's only role here is IdP (an OIDC client
registration). Other apps in the same stack may well use forward-auth; this one
deliberately does not.

---

## 3. What the fork changed

Commits, oldest first:

| Commit | What |
|---|---|
| `51b2a7c` | `SB_SERVER_PREFIX` config knob; prefix plumbing through boot/multi/single |
| `1eab4aa` | Central login + OIDC served under the prefix |
| `0e914ef` | Client TS resolves admin/central/auth URLs against the prefix |
| `9ff32e9` | **Critical:** mount admin surfaces via axum `nest` so prefixed spaces still dispatch |
| `a25705a` | `Dockerfile.fork` + `deploy/` kit (compose snippet, provider client block, README) |
| `9d9781b` | gitignore the locally built image tarballs |
| `8e3ae7a` | **Fix:** derive the OIDC central login URL under the prefix |
| `dce8b9e` | **Fix:** stop preferring `client_secret_basic` over the client's registration |
| `8e8387c` | **Fix:** resolve session routes from a space shell, not just admin surfaces |
| `c8e98f5` | **Fix:** carry `version.json` into the server stage |

Key files (the prefix plumbing is the fork's addition):
`bin/silverbullet/src/{config,multi,boot,single}.rs`,
`server/src/multi/{dispatch,dashboard,setup_api,html_prefix,mod}.rs`,
`server/src/auth/oidc/{config,client}.rs`,
`client/server_prefix.ts`, `client/dashboard_navigation.ts`.

`deploy/` holds the compose snippet, the provider OIDC client block, and an
end-to-end README.

### Tests

- Server: `cargo test -p silverbullet-server`
- Client: `npx vitest run`, plus `npx tsc --noEmit`

Both suites were green at `c8e98f5`.

---

## 4. Version stamp — resolved, pending deploy

**Symptom (old image):** the client permanently shows *"A new version of
SilverBullet client is available. A reload or two is required to update."*

**Cause:** the running server reported `version:"0.0.0"` from its `/.instance`
probe. The client compares that to its own compiled-in version
(`client/client.ts`, `case "server-version"`), so they could never match.
`bin/silverbullet/build.rs` reads `../../version.json` and fell back to
`"0.0.0"` because the file was never copied into the server stage.

**Fixed in `c8e98f5`:** `Dockerfile.fork` stage 2 now copies `version.json`
from stage 1.

**Tags:** upstream tags have been fetched into the clone, so `git describe`
yields `<semver>-N-g<sha>` (e.g. `2.11.1-80-gc657251`) instead of the
`-unknown-` fallback.

**Timestamp — decided, keep as is:** `build/version.ts` appends a wall-clock
build timestamp, and Docker builds never carry a prior `version.json`, so
every image gets a distinct version. Consequence: the banner appears **once
per deploy** and clears after a reload. That is accepted and intended — it
guarantees a rebuilt bundle is never silently served under a stale version.
Don't "fix" it.

### Related fallout

Because the version never matched across redeploys, browsers accumulated
orphaned `sb_files_*` IndexedDB databases. These block the normal logout path
(see §5) and can only be cleared by force logout or by wiping site data for
`<PUBLIC_HOST>` in devtools. Worth recommending after the version fix ships.

---

## 5. Bugs already fixed — and why they were missed

Five fixes landed after the initial "it works" verification. Each was a real
defect that the original verification did not catch. The pattern is worth
internalising: **the first round of testing exercised the HTTP surface with
`curl`, which bypassed the client UI and the browser redirect chain where
these bugs lived.**

1. **`8e3ae7a` — OIDC central login URL lost the prefix.** The wizard
   pre-filled "Central login URL" from the primary URL (a *bare* origin) and
   then **disabled the field**, so the derived callback dropped `<PREFIX>` and
   no longer matched the provider's registered redirect URI. Only appeared when
   a primary URL was configured. Fix: `centralOriginFor()` + field left
   editable.

2. **`dce8b9e` — token endpoint auth method.** Discovery advertises
   `token_endpoint_auth_methods_supported` **provider-wide**; it says nothing
   about how an individual client is registered. Authelia advertises both
   `client_secret_basic` and `client_secret_post` while a given client pins
   exactly one, and the code blindly preferred basic. Fix: a `tokenAuthMethod`
   provider setting (`auto` | `client_secret_post` | `client_secret_basic`),
   defaulting to POST and exposed in the dashboard. The mock IdP previously
   advertised only the method it accepted, which is why tests never caught it —
   it can now advertise both independently.

3. **`8e8387c` — logout 404'd from inside a space.** `serverPrefix()` only
   recognizes the admin surface mounts, so from a space shell (base URI
   `<PREFIX>/`) it returned `""` and logout POSTed to the origin-rooted
   `/.auth/central/logout` → 404 → *"Could not log out. Your edits remain saved
   on this device."* Affected force logout too. Fix: `anyServerPath()`.

4. **`c8e98f5`** — the version stamp, §4.

5. **OIDC return URL lost the prefix (`d10f4db`, `aa56dad`, `b8edbbb`).**
   After sign-in (local *or* OIDC — both go through `complete()`) the handoff
   redirected to `{origin}/.auth/central/return`, then `return_to_host`
   redirected to `/.auth/central/unlock`, both without the prefix → 404. The
   session cookie was already set, so reopening the app showed the user signed
   in, which masked it. A follow-up audit fixed the rest of this class: retry
   page link, `/.dashboard` destination checks (server and `isDashboardPath()`
   in the client), unlock page `resume`/`start` URLs, the dashboard
   primary-origin redirect, `/` / `/.spaces` / "No space here" in dispatch,
   setup's hand-off target, server-settings origin switch, self-demotion /
   sign-out / deletion, and the login page's default `next`. Prefixed tests:
   `Fixture::with_prefix` in `server/tests/central_security.rs`,
   `server_prefix_is_kept_on_generated_dashboard_urls` in `dispatch.rs`.

### Known prefix gaps (not fixed; do not affect a space bound at `<PREFIX>`)

- `client/server_prefix.ts` `spaceServerPrefix()` treats the space's own base
  path as the server prefix. Correct only when a space is bound exactly at the
  prefix. Proper fix: have the server send the real prefix to the space shell.
- Single-space mode (`bin/silverbullet/src/boot.rs`, `single.rs`) ignores
  `SB_SERVER_PREFIX` silently; it should warn or refuse.
- `client/service_worker/proxy_router.ts` `alwaysProxy` uses space-relative
  `/.dashboard` etc. — only matters for a root-bound space plus a prefix.

### Logout is guarded by design

Normal logout refuses while any local space is unsynced (`client/logout.ts`,
the `sb_files_*` / `covered` check) because logout discards local data. That is
**intentional**; force logout skips it. Don't "fix" the guard — the real
problem was the 404 from bug 3.

---

## 6. How to operate on the deploy host

The agent cannot write to `<DEPLOY_DIR>`. Edits happen through a terminal
multiplexer pane.

```bash
test "${HERDR_ENV:-}" = 1                     # must pass first
herdr pane list --workspace "$HERDR_WORKSPACE_ID"
herdr pane run <pane> "<command>"
sleep 3
herdr pane read <pane> --source recent-unwrapped --lines 40
```

**Pane IDs are not stable across sessions** — rediscover the pane from
`pane list` by its terminal title (the `<DEPLOY_USER>` shell) rather than
reusing an ID from an earlier session.

**Paste hazards — two real incidents:**

- A multi-line paste into the compose file hard-wrapped a long Traefik rule at
  `&&`, leaving an unindented continuation, and the whole block landed one
  space short. The file would not parse.
- Transfer complex/quoting-heavy content as **base64** and decode on the far
  side, then validate:
  `docker compose config` (exit 0) for compose, and a YAML parse for the
  provider config.

**Always validate after editing:**

```bash
cd <DEPLOY_DIR> && docker compose config >/dev/null   # exit 0 required
python3 -c "import yaml;yaml.safe_load(open('authelia/configuration.yml'))"
```

Note `authelia config validate` reports a **false positive** on the `jwks`
template (`{{ secret "/config/secrets/..." }}` is not expanded outside the
running container). The *pre-edit* backup shows the identical error — use that
as the control, and rely on the startup log instead:

```
Registering OpenID Connect 1.0 client with client id '<client>'
```

### Shipping a new image

The agent generally cannot `scp` to the deploy host (no SSH key), and a public
hostname may resolve to a CDN rather than the host. **Assume the operator
transfers the file.**

```bash
# build on the operator's machine. Cargo registry and target/ live in BuildKit
# cache mounts, so a server-only change rebuilds in ~70s (cold: ~2 min).
cd <CLONE>
docker build -f Dockerfile.fork -t <IMAGE_REF> .
docker save <IMAGE_REF> | gzip -1 > dist-image/<name>.tar.gz
sha256sum dist-image/<name>.tar.gz    # report to the operator

# operator copies it, then on the deploy host:
sha256sum /tmp/<name>.tar.gz
gunzip -c /tmp/<name>.tar.gz | docker load
cd <DEPLOY_DIR> && docker compose up -d --force-recreate silverbullet
rm /tmp/<name>.tar.gz
```

`--force-recreate` is required: the tag never changes, so Compose would
otherwise keep the running container.

**Verify the fix actually landed in the image** before shipping — grep the
binary, since the client bundle is embedded via `rust-embed`:

```bash
docker run --rm --entrypoint sh <IMAGE_REF> -c \
  "strings /silverbullet | grep -c '<a unique string from your change>'"
```

---

## 7. Runtime configuration

**`docker-compose.yaml`** (`silverbullet` service) — `SB_SERVER_PREFIX` set to
the prefix, `SB_HOSTNAME=0.0.0.0`, `SB_PORT=3000`, a timezone, bind mount
`./silverbullet/data:/data`, healthcheck on the **unprefixed** `/.instance`
(the fork keeps that at the origin root so the stock healthcheck works), and a
single Traefik router: `Host(<PUBLIC_HOST>) && PathPrefix(<PREFIX>)`, explicit
priority, the usual entrypoint, **no StripPrefix**, **no forward-auth
middleware**.

**Provider OIDC client** — id `<client>`, public false, redirect URI
`https://<PUBLIC_HOST><PREFIX>/.auth/central/oidc/callback`,
`require_pkce: true`, `pkce_challenge_method: S256`,
`token_endpoint_auth_method: client_secret_post`, one-factor authorization
policy, scopes `openid profile email`. Issuer `https://<IDP_HOST>`.

**SilverBullet OIDC settings** (dashboard → Authentication) — central login
`https://<PUBLIC_HOST><PREFIX>` (**with** the prefix), issuer
`https://<IDP_HOST>`, the client id, token endpoint auth `auto`. The callback
is derived as `{central_origin}/.auth/central/oidc/callback`.

### Secrets

The client secret was **generated by an agent and printed into a chat
session**. The operator evaluated the exposure and **decided not to rotate**.
If that decision is revisited: regenerate with
`authelia crypto hash generate pbkdf2 --variant sha512 --random --random.length 72`,
replace `client_secret` in the provider config, restart the provider, and paste
the *plaintext* into the dashboard.

While reading `authelia/configuration.yml`, **read only the `clients:` region**
(search for it; it is well past the top-of-file settings). The file's top
section holds plaintext `reset_password` JWT secret, `session.secret`,
`storage.encryption_key` and OIDC `hmac_secret`. An earlier session dumped the
whole file into the transcript; don't repeat it.

If backups were left on the deploy host (`docker-compose.yaml.bak.*`,
`configuration.yml.bak.*`), note that a compose backup taken *after* a bad
paste is the **broken** file, not a pristine original — restoring it
reintroduces the parse error.

---

## 8. Next steps

1. **Build and ship** the current tip via §6. Before shipping, confirm the
   binary carries a real version (`strings /silverbullet | grep 2.11.1-`),
   not `0.0.0`.
2. On the deploy host: `docker load` + `--force-recreate silverbullet`.
3. **Verify** the `/.instance` probe reports that version and that the banner
   clears after one reload.
4. **Confirm logout works** from inside a space (it should hit
   `<PREFIX>/.auth/central/logout`). Recommend clearing site data for
   `<PUBLIC_HOST>` if stale `sb_files_*` databases still block it.
5. **Re-test OIDC end to end:** Save → Test → Activate in the dashboard, then
   confirm sign-in redirects to the provider and returns a code to the callback.
   (Note: Save/Test/Activate uses a `revision` concurrency token — editing any
   field after Test requires a re-Test or Activate is rejected.)
6. Consider offering these fixes upstream as separate PRs — the prefix support
   is the substantive one. Note the fork may have upstream's `ci.yml`
   **disabled** in the repo's Actions settings (kept in the tree for
   rebaseability).

---

## 9. Environment notes

Build quirks: the client build may need explicit approval of install scripts
for `esbuild` / `@parcel/watcher`; the server build may need a particular
`rustup` toolchain override. `.dockerignore` keeps `.git` (needed for version
stamping) and excludes `target/`, `node_modules/` and `dist-image/` (where the
saved image tarballs go; also gitignored).

The Git host CLI may be authenticated with scopes that **lack package-write**,
which is part of why a registry push route was abandoned in favour of
`docker save` / `docker load`.
