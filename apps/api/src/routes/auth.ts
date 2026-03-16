import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AppEnv } from "../types";
import { randomHex, constantTimeEqual } from "../lib/crypto";
import { createSession, destroySession } from "../lib/session";

const OAUTH_STATE_COOKIE = "ct_oauth_state";

export const auth = new Hono<AppEnv>();

auth.get("/github", (c) => {
  const state = randomHex(16);
  setCookie(c, OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: new URL(c.env.API_ORIGIN).protocol === "https:",
    sameSite: "Lax",
    path: "/api/auth",
    maxAge: 600,
  });

  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", c.env.GITHUB_CLIENT_ID);
  url.searchParams.set("redirect_uri", `${c.env.API_ORIGIN}/api/auth/github/callback`);
  url.searchParams.set("scope", "read:user user:email");
  url.searchParams.set("state", state);

  return c.redirect(url.toString());
});

auth.get("/github/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const expected = getCookie(c, OAUTH_STATE_COOKIE);
  deleteCookie(c, OAUTH_STATE_COOKIE, { path: "/api/auth" });

  if (!code || !state || !expected || !constantTimeEqual(state, expected)) {
    return c.json({ error: "invalid_state" }, 400);
  }

  // Exchange code for access token
  const tokenResp = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${c.env.API_ORIGIN}/api/auth/github/callback`,
    }),
  });
  if (!tokenResp.ok) return c.json({ error: "token_exchange_failed" }, 502);
  const token = (await tokenResp.json()) as { access_token?: string; error?: string };
  if (!token.access_token) return c.json({ error: token.error ?? "no_token" }, 502);

  // Fetch user profile + primary email
  const headers = {
    Authorization: `Bearer ${token.access_token}`,
    "User-Agent": "crashtrack",
    Accept: "application/vnd.github+json",
  };
  const [userResp, emailResp] = await Promise.all([
    fetch("https://api.github.com/user", { headers }),
    fetch("https://api.github.com/user/emails", { headers }),
  ]);
  if (!userResp.ok) return c.json({ error: "user_fetch_failed" }, 502);

  const ghUser = (await userResp.json()) as {
    id: number;
    login: string;
    avatar_url: string;
  };
  const emails = emailResp.ok
    ? ((await emailResp.json()) as Array<{ email: string; primary: boolean; verified: boolean }>)
    : [];
  const primaryEmail =
    emails.find((e) => e.primary && e.verified)?.email ?? emails[0]?.email ?? null;

  // Upsert user
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO users (github_id, github_login, email, avatar_url, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(github_id) DO UPDATE SET
       github_login = excluded.github_login,
       email        = excluded.email,
       avatar_url   = excluded.avatar_url`,
  )
    .bind(ghUser.id, ghUser.login, primaryEmail, ghUser.avatar_url, now)
    .run();

  const row = await c.env.DB.prepare("SELECT id FROM users WHERE github_id = ?")
    .bind(ghUser.id)
    .first<{ id: number }>();
  if (!row) return c.json({ error: "user_upsert_failed" }, 500);

  await createSession(c, row.id);
  return c.redirect(`${c.env.APP_ORIGIN}/app`);
});

auth.post("/logout", async (c) => {
  await destroySession(c);
  return c.body(null, 204);
});
