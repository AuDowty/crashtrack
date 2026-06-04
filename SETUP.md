# Local dev setup

One-time prerequisites:

- Node 22+
- Rust 1.75+ with `wasm-pack` (for the WASM parser)
- `wrangler` is installed via npm — no global install needed
- A Cloudflare account (free)
- A GitHub account (you already have one if you're reading this)

## 1. Install deps

```sh
npm install
```

## 2. Create Cloudflare resources

```sh
cd apps/api

# D1
npx wrangler d1 create crashtrack
# -> copy the database_id it prints, paste it into wrangler.toml (replace REPLACE_WITH_D1_ID)

# R2
npx wrangler r2 bucket create crashtrack-dumps
npx wrangler r2 bucket create crashtrack-symbols
```

## 3. Create a GitHub OAuth app

Go to https://github.com/settings/developers -> New OAuth App.

| Field | Value (local dev) |
|---|---|
| Application name | crashtrack (local) |
| Homepage URL | http://localhost:5173 |
| Authorization callback URL | http://localhost:8787/api/auth/github/callback |

Save. Copy the Client ID. Generate a new client secret, copy it too.

## 4. Set secrets

For LOCAL dev, create `apps/api/.dev.vars`:

```
GITHUB_CLIENT_ID=Iv1.xxxxxxxxxxxx
GITHUB_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

(`.dev.vars` is gitignored. Never commit it.)

For PRODUCTION, push them with wrangler:

```sh
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
```

## 5. Run migrations

```sh
npm run migrate:local
```

## 6. Start dev servers (two terminals)

```sh
# terminal 1 — api on :8787
npm run dev:api

# terminal 2 — web on :5173
npm run dev:web
```

Open http://localhost:5173 -> click "Sign in with GitHub" -> should land you back at /app logged in.
