# Deploying the SilverBullet fork (server mounted under a URL prefix)

This fork adds **`SB_SERVER_PREFIX`**, which mounts the *entire* SilverBullet
server — the notes space, `/.dashboard`, the OIDC central-auth surface
(`/.auth/central`), and `/.setup` — under a URL prefix, so the default upstream
"admin surfaces live at the origin root" assumption no longer applies.

- Fork: `<FORK_REPO>`, branch `feature/url-prefix-all-surfaces`
- Image: `<IMAGE_REF>`
- Target: `https://<PUBLIC_HOST><PREFIX>`, OIDC via the identity provider.

Placeholders: `<PREFIX>` (e.g. `/notes`), `<PUBLIC_HOST>`, `<IDP_HOST>`,
`<DEPLOY_DIR>`, `<IMAGE_REF>`, `<FORK_REPO>`.

Empty `SB_SERVER_PREFIX` keeps upstream behaviour byte-for-byte.

## 1. Build the image

```sh
cd <CLONE>
docker build -f Dockerfile.fork -t <IMAGE_REF> .
# optional Chromium/runtime API layer:
docker build -f Dockerfile.runtime-api \
  --build-arg BASE_IMAGE=<IMAGE_REF> -t <IMAGE_REF>-runtime .
```

If the deploy host cannot pull from a registry, transfer with save/load
instead — see the handoff document for the transfer and reload commands,
including the `--force-recreate` requirement.

## 2. Add the compose service

Merge `compose-snippet.yaml` into `<DEPLOY_DIR>/docker-compose.yaml`.
Create the data dir owned by uid 1000:

```sh
mkdir -p silverbullet/data
```

## 3. Register the OIDC client in the provider

Append the block in `authelia-client.yaml` to the provider's configuration
under `identity_providers.oidc.clients`, then restart the provider:

```sh
docker compose restart authelia
```

The redirect URI is
`https://<PUBLIC_HOST><PREFIX>/.auth/central/oidc/callback` — note the prefix;
the fork builds it from the central origin.

## 4. First run

Bring the service up:

```sh
docker compose up -d silverbullet
```

Open `https://<PUBLIC_HOST><PREFIX>/.dashboard`, sign in with the admin account
you create on first run, then:

1. **Server settings → Primary URL**: `https://<PUBLIC_HOST>`
   (bare origin, no path — this is required).
2. **Authentication**: enter the issuer `https://<IDP_HOST>`, the client id,
   the plaintext client secret, then Save → Test → Activate.

The fork derives the OIDC central login URL as
`https://<PUBLIC_HOST><PREFIX>` and the callback as
`...<PREFIX>/.auth/central/oidc/callback` automatically.

Note: Save → Test → Activate is guarded by a `revision` concurrency token —
editing any field after Test requires a re-Test, or Activate is rejected.

## Why no forward-auth middleware on the router

SilverBullet is itself an OIDC client: it redirects users to the provider and
handles the callback. Adding the provider's Traefik *forward-auth* middleware
in front would double-prompt and break the callback. Leave the router without
it; the provider's only role here is being the IdP.

## Surface map

| URL | Served by |
|---|---|
| `https://<PUBLIC_HOST><PREFIX>/` | the notes space |
| `...<PREFIX>/.dashboard` | admin dashboard |
| `...<PREFIX>/.auth/central/*` | OIDC login / callback |
| `...<PREFIX>/.setup/` | first-run wizard |
| `...<PREFIX>/.instance` | version probe |
| `/.instance` (unprefixed) | container healthcheck |

## What the fork changed

| Commit | Area |
|---|---|
| 1 | `SB_SERVER_PREFIX` config + plumbing |
| 2 | central auth / OIDC honour the prefix |
| 3 | client TS resolves URLs against the prefix |
| 4 | admin surfaces mounted with axum `nest`; prefixed spaces still dispatch |
| 5 | Docker image (`Dockerfile.fork`) + this deploy kit |

Rebasing on upstream: the change is confined to
`bin/silverbullet/src/{config,multi,boot,single}.rs`,
`server/src/multi/{dispatch,dashboard,setup_api,html_prefix}.rs`,
`server/src/auth/oidc/config.rs`, `server/src/handlers/central_auth.rs`, and a
handful of `client/` files. Empty prefix preserves upstream behaviour, so the
fork can track `main` closely.
