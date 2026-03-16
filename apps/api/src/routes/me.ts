import { Hono } from "hono";
import type { AppEnv } from "../types";
import { getCurrentUser } from "../lib/session";

export const me = new Hono<AppEnv>();

me.get("/", async (c) => {
  const user = await getCurrentUser(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  return c.json({ user });
});
