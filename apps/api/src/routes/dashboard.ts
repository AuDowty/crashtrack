import { Hono } from "hono";
import type { AppEnv, Env } from "../types";
import { requireAuth, requireProject } from "../lib/middleware";
import { symbolicateBulk, peWalkUnwind } from "../lib/symbolicate";
import { moduleNameStem } from "./symbols";

/** Cached R2 fetch via Workers Cache API (persists across requests/isolates
 *  within a CF region). Big perf win for the 28MB PDB + 4MB EXE — second
 *  view of any project hits this instead of hitting R2 again. */
type CtxLike = { waitUntil?: (p: Promise<unknown>) => void };
async function fetchCachedR2(
  bucket: R2Bucket,
  key: string,
  ctx: CtxLike | undefined,
): Promise<ArrayBuffer | null> {
  const cacheKey = new Request(`https://cache.crashtrack.dev/r2/${encodeURIComponent(key)}`);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return await hit.arrayBuffer();

  const obj = await bucket.get(key);
  if (!obj) return null;
  const bytes = await obj.arrayBuffer();

  // Stash in cache for 24 h; ctx?.waitUntil keeps the Response alive past the
  // current request. Falls back to inline put when ctx isn't available.
  const resp = new Response(bytes, {
    headers: { "Cache-Control": "public, max-age=86400" },
  });
  if (ctx?.waitUntil) ctx.waitUntil(cache.put(cacheKey, resp.clone()));
  else await cache.put(cacheKey, resp.clone());
  return bytes;
}

type RawFrame = { address: string; module: string | null; offset: string | null };
type SourceLine = { line: number; text: string; is_focus: boolean };
type EnrichedFrame = RawFrame & {
  function: string | null;
  file: string | null;
  line: number | null;
  source?: SourceLine[];        // ±3 lines around `line` when github_repo is set
};

// Map a PDB file path (e.g. C:\Users\austi\Desktop\myapp\src\main.rs) to a
// repo-relative path (src/main.rs) by stripping everything before the source
// root marker. Returns null if no match.
function pdbPathToRepoPath(pdbPath: string, sourceRoot: string): string | null {
  const norm = pdbPath.replace(/\\/g, "/");
  const marker = `/${sourceRoot}/`;
  const idx = norm.lastIndexOf(marker);
  if (idx < 0) {
    // Last-resort: just take the last 3 path components.
    const parts = norm.split("/");
    if (parts.length < 2) return null;
    return parts.slice(-3).join("/");
  }
  return norm.slice(idx + 1);  // include "src/..." prefix
}

// Fetch ±3 lines around `targetLine` from GitHub raw. Cached for 1h by CF.
async function fetchSourceContext(
  githubRepo: string,
  ref: string,
  path: string,
  targetLine: number,
): Promise<SourceLine[] | null> {
  const url = `https://raw.githubusercontent.com/${githubRepo}/${ref}/${path}`;
  const res = await fetch(url, {
    cf: { cacheTtl: 3600, cacheEverything: true },
    headers: { "User-Agent": "crashtrack-dashboard/1.0" },
  } as RequestInit);
  if (!res.ok) return null;
  const text = await res.text();
  // Hard cap: don't process huge files (>500 KB) inline.
  if (text.length > 500_000) return null;
  const lines = text.split("\n");
  const start = Math.max(1, targetLine - 3);
  const end = Math.min(lines.length, targetLine + 3);
  const out: SourceLine[] = [];
  for (let i = start; i <= end; i++) {
    out.push({ line: i, text: lines[i - 1] ?? "", is_focus: i === targetLine });
  }
  return out;
}

// Run the SEH .pdata-based precise unwinder when (a) the user uploaded the
// matching PE binary AND (b) the ingest stored unwind context. Otherwise
// returns null so the caller keeps the heuristic walk.
async function tryPreciseUnwind(
  env: Env,
  projectId: number,
  crashId: string,
  heuristicFrames: RawFrame[],
): Promise<RawFrame[] | null> {
  const first = heuristicFrames[0];
  if (!first?.module) return null;
  const moduleBasename = first.module.toLowerCase();

  const pe = (await env.DB
    .prepare("SELECT r2_key FROM pe_files WHERE project_id = ? AND basename = ?")
    .bind(projectId, moduleBasename)
    .first()) as { r2_key: string } | null;
  if (!pe) return null;

  const crash = (await env.DB
    .prepare("SELECT unwind_data FROM crashes WHERE id = ? AND project_id = ?")
    .bind(crashId, projectId)
    .first()) as { unwind_data: string | null } | null;
  if (!crash?.unwind_data) return null;

  let unwind: { rip: string; rsp: string; rbp: string; stack_base: string; stack_b64: string };
  try { unwind = JSON.parse(crash.unwind_data); } catch { return null; }

  // First frame's RIP determines which module-base offset we're unwinding
  // from. Module base = (RIP - first.offset).
  if (!first.offset) return null;
  const firstAddr = BigInt(first.address);
  const firstOffset = BigInt(first.offset);
  const moduleBase = firstAddr - firstOffset;

  const peBytes = await fetchCachedR2(env.PE_FILES, pe.r2_key, undefined);
  if (!peBytes) return null;

  // Decode stack memory.
  const stackBin = atob(unwind.stack_b64);
  const stackBytes = new Uint8Array(stackBin.length);
  for (let i = 0; i < stackBin.length; i++) stackBytes[i] = stackBin.charCodeAt(i);

  try {
    const result = await peWalkUnwind({
      peBytes,
      stackBytes,
      stackBase:      BigInt(unwind.stack_base),
      moduleBase,
      moduleBasename,
      rip:            BigInt(unwind.rip),
      rsp:            BigInt(unwind.rsp),
    });
    if (!result.frames || result.frames.length === 0) return null;
    return result.frames.map((f) => ({
      address: f.rip,
      module:  f.module,
      offset:  f.offset,
    }));
  } catch {
    return null;
  }
}

// Some old crashes were stored with messy stacks (dupes, module-base `+0x0`
// entries) before the walker was tightened up. Clean them on read so the UI
// renders consistently regardless of when the dump was ingested.
function cleanStack(frames: RawFrame[]): RawFrame[] {
  const seen = new Set<string>();
  const out: RawFrame[] = [];
  for (const f of frames) {
    if (seen.has(f.address)) continue;
    seen.add(f.address);
    // Drop frames pointing to module base (rarely real return addresses).
    // Always keep the very first frame (the faulting one) even if it's odd.
    if (out.length > 0 && f.offset === "0x0") continue;
    out.push(f);
  }
  return out;
}

// View-time symbolication: for each frame whose module has a matching
// uploaded PDB (by basename stem), look up the function name. Caches in
// symbol_cache so repeat views are cheap.
async function enrichFrames(
  env: Env,
  projectId: number,
  frames: RawFrame[],
  ctx?: CtxLike,
): Promise<EnrichedFrame[]> {
  if (frames.length === 0) return [];

  const { results: symRows } = await env.DB
    .prepare(
      `SELECT id, module_name, signature, age, r2_key
         FROM symbol_files WHERE project_id = ?`,
    )
    .bind(projectId)
    .all<{ id: number; module_name: string; signature: string; age: number; r2_key: string }>();
  if (symRows.length === 0) {
    return frames.map((f) => ({ ...f, function: null, file: null, line: null }));
  }
  const byStem = new Map<string, typeof symRows[number]>();
  for (const row of symRows) byStem.set(moduleNameStem(row.module_name), row);

  // Group frames by (symbol_file_id) so we can run one bulk lookup per PDB.
  type SlottedFrame = { index: number; sym: typeof symRows[number]; rva: number };
  const out: EnrichedFrame[] = frames.map((f) => ({ ...f, function: null, file: null, line: null }));
  const bySym = new Map<number, SlottedFrame[]>();

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]!;
    if (!f.module || !f.offset) continue;
    const sym = byStem.get(moduleNameStem(f.module));
    if (!sym) continue;
    const rva = Number(BigInt(f.offset));
    const arr = bySym.get(sym.id) ?? [];
    arr.push({ index: i, sym, rva });
    bySym.set(sym.id, arr);
  }

  for (const [, slots] of bySym) {
    const sym = slots[0]!.sym;

    // Check cache for each RVA first; only the misses need WASM work.
    const cacheRows = (await env.DB
      .prepare(
        `SELECT rva, function, file, line FROM symbol_cache
           WHERE symbol_file_id = ? AND rva IN (${slots.map(() => "?").join(",")})`,
      )
      .bind(sym.id, ...slots.map((s) => s.rva))
      .all<{ rva: number; function: string | null; file: string | null; line: number | null }>()).results;
    const cacheByRva = new Map(cacheRows.map((r) => [r.rva, r]));

    const missSlots = slots.filter((s) => !cacheByRva.has(s.rva));

    // Apply hits.
    for (const s of slots) {
      const hit = cacheByRva.get(s.rva);
      if (hit) {
        out[s.index] = { ...out[s.index]!, function: hit.function, file: hit.file, line: hit.line };
      }
    }
    if (missSlots.length === 0) continue;

    // Fetch PDB once via CF cache.
    const pdbBytes = await fetchCachedR2(env.SYMBOLS, sym.r2_key, ctx);
    if (!pdbBytes) continue;

    // ONE bulk WASM call for all misses.
    let results: BulkSymbolHit[] = [];
    try {
      results = await symbolicateBulk(pdbBytes, missSlots.map((s) => s.rva));
    } catch {/* swallow — frames stay unsymbolicated */}

    // Apply results + persist to cache.
    const cacheInserts: { rva: number; fn: string | null; file: string | null; line: number | null }[] = [];
    for (let i = 0; i < missSlots.length; i++) {
      const s = missSlots[i]!;
      const r = results[i] ?? { function: null, file: null, line: null };
      out[s.index] = { ...out[s.index]!, function: r.function, file: r.file, line: r.line };
      cacheInserts.push({ rva: s.rva, fn: r.function, file: r.file, line: r.line });
    }

    // Batch cache write.
    if (cacheInserts.length > 0) {
      try {
        const now = Date.now();
        await env.DB.batch(
          cacheInserts.map((ci) =>
            env.DB.prepare(
              `INSERT OR REPLACE INTO symbol_cache (symbol_file_id, rva, function, file, line, resolved_at)
               VALUES (?, ?, ?, ?, ?, ?)`,
            ).bind(sym.id, ci.rva, ci.fn, ci.file, ci.line, now),
          ),
        );
      } catch {/* cache miss is acceptable; subsequent view will re-resolve */}
    }
  }

  return out;
}

type BulkSymbolHit = { function: string | null; file: string | null; line: number | null };

export const dashboard = new Hono<AppEnv>();

dashboard.use("*", requireAuth);

dashboard.get("/:slug/stats", async (c) => {
  const project = await requireProject(c, c.req.param("slug"));
  if (project instanceof Response) return project;

  const days = clamp(parseInt(c.req.query("days") ?? "14", 10), 1, 90);
  const today = Math.floor(Date.now() / 86_400_000);
  const fromDay = today - days + 1;

  const { results } = await c.env.DB.prepare(
    `SELECT day, count FROM crash_daily
       WHERE project_id = ? AND day >= ?
       ORDER BY day ASC`,
  )
    .bind(project.id, fromDay)
    .all<{ day: number; count: number }>();

  // Fill missing days with zero so the chart is continuous.
  const filled: { day: number; date: string; count: number }[] = [];
  const map = new Map(results.map((r) => [r.day, r.count]));
  for (let d = fromDay; d <= today; d++) {
    filled.push({ day: d, date: new Date(d * 86_400_000).toISOString().slice(0, 10), count: map.get(d) ?? 0 });
  }
  const total = filled.reduce((sum, p) => sum + p.count, 0);
  return c.json({ stats: filled, total });
});

dashboard.get("/:slug/top-modules", async (c) => {
  const project = await requireProject(c, c.req.param("slug"));
  if (project instanceof Response) return project;
  const days = clamp(parseInt(c.req.query("days") ?? "14", 10), 1, 90);
  const since = Date.now() - days * 86_400_000;

  const { results } = await c.env.DB.prepare(
    `SELECT cg.top_module AS module, COUNT(c.id) AS count
       FROM crashes c
       JOIN crash_groups cg ON cg.id = c.group_id
       WHERE c.project_id = ? AND c.uploaded_at >= ? AND cg.top_module IS NOT NULL
       GROUP BY cg.top_module
       ORDER BY count DESC
       LIMIT 8`,
  )
    .bind(project.id, since)
    .all<{ module: string; count: number }>();
  return c.json({ modules: results });
});

dashboard.get("/:slug/groups", async (c) => {
  const project = await requireProject(c, c.req.param("slug"));
  if (project instanceof Response) return project;

  const status = c.req.query("status") ?? "open";
  const limit = clamp(parseInt(c.req.query("limit") ?? "50", 10), 1, 200);
  const before = c.req.query("before");
  const q = (c.req.query("q") ?? "").trim().toLowerCase();

  const params: (string | number)[] = [project.id, status];
  let where = "WHERE project_id = ? AND status = ?";
  if (q) {
    where += ` AND (
      LOWER(exception_code) LIKE ?
      OR LOWER(top_module)  LIKE ?
      OR LOWER(top_function) LIKE ?
    )`;
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  if (before) {
    where += " AND last_seen_at < ?";
    params.push(Number(before));
  }
  params.push(limit);

  const { results } = await c.env.DB.prepare(
    `SELECT id, signature, first_seen_at, last_seen_at, count,
            exception_code, top_module, top_function, status
       FROM crash_groups
       ${where}
       ORDER BY last_seen_at DESC
       LIMIT ?`,
  )
    .bind(...params)
    .all();

  const nextBefore =
    results.length === limit ? Number(results[results.length - 1]!.last_seen_at) : null;
  return c.json({ groups: results, next_before: nextBefore });
});

dashboard.patch("/:slug/groups/:id", async (c) => {
  const project = await requireProject(c, c.req.param("slug"));
  if (project instanceof Response) return project;
  const groupId = Number(c.req.param("id"));
  if (!Number.isInteger(groupId)) return c.json({ error: "invalid_id" }, 400);

  const body = (await c.req.json().catch(() => ({}))) as { status?: unknown };
  const status = typeof body.status === "string" ? body.status : "";
  if (!["open", "resolved", "ignored"].includes(status)) {
    return c.json({ error: "invalid_status" }, 400);
  }

  const res = await c.env.DB
    .prepare("UPDATE crash_groups SET status = ? WHERE id = ? AND project_id = ?")
    .bind(status, groupId, project.id)
    .run();
  if (res.meta.changes === 0) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

dashboard.get("/:slug/groups/:id", async (c) => {
  const project = await requireProject(c, c.req.param("slug"));
  if (project instanceof Response) return project;
  const groupId = Number(c.req.param("id"));
  if (!Number.isInteger(groupId)) return c.json({ error: "invalid_id" }, 400);

  const group = await c.env.DB
    .prepare(
      `SELECT id, signature, first_seen_at, last_seen_at, count,
              exception_code, top_module, top_function, status
         FROM crash_groups WHERE id = ? AND project_id = ?`,
    )
    .bind(groupId, project.id)
    .first();
  if (!group) return c.json({ error: "not_found" }, 404);

  const { results: samples } = await c.env.DB
    .prepare(
      `SELECT id, occurred_at, uploaded_at, app_version, os_version, cpu_arch, dump_size, stack_json,
              exception_name, av_operation, av_address
         FROM crashes WHERE group_id = ? AND project_id = ?
         ORDER BY uploaded_at DESC LIMIT 20`,
    )
    .bind(groupId, project.id)
    .all<{ stack_json: string | null } & Record<string, unknown>>();

  const samples_out = samples.map(({ stack_json, ...rest }) => ({
    ...rest,
    stack: stack_json ? cleanStack(JSON.parse(stack_json) as RawFrame[]) : null,
  }));

  // Canonical stack = the most-recent sample's, enriched with symbolication.
  let rawStack = samples_out[0]?.stack ?? null;

  // SEH .pdata refinement: if the user uploaded the matching PE and we have
  // unwind context cached on the crash, run the precise unwinder.
  const latestSampleId = samples[0]?.id as string | undefined;
  if (rawStack && rawStack.length > 0 && latestSampleId) {
    const refined = await tryPreciseUnwind(c.env, project.id, latestSampleId, rawStack);
    if (refined && refined.length > 0) rawStack = refined;
  }

  let canonical_stack: EnrichedFrame[] | null = null;
  if (rawStack) {
    try {
      canonical_stack = await enrichFrames(c.env, project.id, rawStack, c.executionCtx);
    } catch (e) {
      console.error("enrichFrames failed", e);
      canonical_stack = rawStack.map((f) => ({ ...f, function: null, file: null, line: null }));
    }
  }

  // Attach source context (±3 lines from GitHub raw) when the project has a
  // GitHub repo configured. Cap at the first N frames to bound per-request
  // cost (N GitHub round-trips + N text slicings). User mostly cares about
  // the top of the stack anyway.
  const MAX_SOURCE_FRAMES = 6;
  if (canonical_stack && project.github_repo) {
    const repo = project.github_repo;
    const ref = project.github_ref ?? "main";
    const sourceRoot = project.source_root ?? "src";
    const targets = canonical_stack.slice(0, MAX_SOURCE_FRAMES);
    await Promise.allSettled(targets.map(async (f) => {
      try {
        if (!f.file || f.line == null) return;
        const path = pdbPathToRepoPath(f.file, sourceRoot);
        if (!path) return;
        f.source = (await fetchSourceContext(repo, ref, path, f.line)) ?? undefined;
      } catch {/* never bring down the whole request because of source fetch */}
    }));
  }

  return c.json({ group, samples: samples_out, canonical_stack });
});

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

// --- webhooks ---

const ALLOWED_KINDS = new Set(["slack", "discord"]);

dashboard.get("/:slug/webhooks", async (c) => {
  const project = await requireProject(c, c.req.param("slug"));
  if (project instanceof Response) return project;
  const { results } = await c.env.DB.prepare(
    "SELECT id, kind, url, events, created_at FROM webhooks WHERE project_id = ? ORDER BY created_at DESC",
  )
    .bind(project.id)
    .all();
  return c.json({ webhooks: results });
});

dashboard.post("/:slug/webhooks", async (c) => {
  const project = await requireProject(c, c.req.param("slug"));
  if (project instanceof Response) return project;
  const body = (await c.req.json().catch(() => ({}))) as { kind?: unknown; url?: unknown };
  const kind = typeof body.kind === "string" ? body.kind : "";
  const url = typeof body.url === "string" ? body.url : "";
  if (!ALLOWED_KINDS.has(kind)) return c.json({ error: "invalid_kind" }, 400);
  if (!/^https:\/\//i.test(url) || url.length > 500) {
    return c.json({ error: "invalid_url" }, 400);
  }
  const ins = await c.env.DB
    .prepare(
      `INSERT INTO webhooks (project_id, kind, url, events, created_at)
       VALUES (?, ?, ?, 'new_group', ?)`,
    )
    .bind(project.id, kind, url, Date.now())
    .run();
  return c.json({ id: Number(ins.meta.last_row_id) }, 201);
});

dashboard.get("/:slug/crashes/:id{.+}/dump", async (c) => {
  const project = await requireProject(c, c.req.param("slug"));
  if (project instanceof Response) return project;
  const id = c.req.param("id");
  if (!id.startsWith(`${project.id}/`)) return c.json({ error: "not_found" }, 404);

  const obj = await c.env.DUMPS.get(id);
  if (!obj) return c.json({ error: "dump_expired" }, 410);

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("Content-Disposition", `attachment; filename="${id.split("/").pop()}"`);
  return new Response(obj.body, { headers });
});

dashboard.get("/:slug/releases", async (c) => {
  const project = await requireProject(c, c.req.param("slug"));
  if (project instanceof Response) return project;
  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.version, r.channel, r.first_seen_at, r.install_count,
            COUNT(c.id) AS crash_count
       FROM releases r
       LEFT JOIN crashes c ON c.release_id = r.id
       WHERE r.project_id = ?
       GROUP BY r.id
       ORDER BY r.first_seen_at DESC
       LIMIT 100`,
  )
    .bind(project.id)
    .all();
  return c.json({ releases: results });
});

dashboard.delete("/:slug/webhooks/:id", async (c) => {
  const project = await requireProject(c, c.req.param("slug"));
  if (project instanceof Response) return project;
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  await c.env.DB
    .prepare("DELETE FROM webhooks WHERE id = ? AND project_id = ?")
    .bind(id, project.id)
    .run();
  return c.body(null, 204);
});
