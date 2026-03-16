import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Context } from "hono";
import type { Env } from "../types";
import { randomHex } from "./crypto";

export const SESSION_COOKIE = "ct_sess";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export type User = {
  id: number;
  github_id: number;
  github_login: string;
  email: string | null;
  avatar_url: string | null;
};

// All routers in this app share the same shape; import locally to avoid cycle.
type Ctx = Context<{ Bindings: Env; Variables: { user: User } }>;

export async function createSession(c: Ctx, userId: number): Promise<string> {
  const id = randomHex(32);
  const now = Date.now();
  const expiresAt = now + THIRTY_DAYS_MS;

  await c.env.DB.prepare(
    "INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(id, userId, expiresAt, now)
    .run();

  setCookie(c, SESSION_COOKIE, id, {
    httpOnly: true,
    secure: new URL(c.env.API_ORIGIN).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: THIRTY_DAYS_MS / 1000,
  });

  return id;
}

export async function getCurrentUser(c: Ctx): Promise<User | null> {
  const sid = getCookie(c, SESSION_COOKIE);
  if (!sid) return null;

  const row = await c.env.DB.prepare(
    `SELECT u.id, u.github_id, u.github_login, u.email, u.avatar_url, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`,
  )
    .bind(sid)
    .first<User & { expires_at: number }>();

  if (!row) return null;
  if (row.expires_at < Date.now()) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sid).run();
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return null;
  }

  const { expires_at: _expires, ...user } = row;
  return user;
}

export async function destroySession(c: Ctx): Promise<void> {
  const sid = getCookie(c, SESSION_COOKIE);
  if (sid) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sid).run();
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}
