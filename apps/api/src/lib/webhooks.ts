import type { Env } from "../types";

type Project = { slug: string; name: string };
type Group = {
  id: number;
  count: number;
  exception_code: string | null;
  top_module: string | null;
  top_function: string | null;
};

type WebhookRow = { id: number; kind: string; url: string };

const COLOR_RED = 0xef4444; // tailwind red-500

export async function deliverNewGroup(
  env: Env,
  project: Project,
  group: Group,
): Promise<void> {
  const { results } = await env.DB
    .prepare("SELECT id, kind, url FROM webhooks WHERE project_id = (SELECT id FROM projects WHERE slug = ?)")
    .bind(project.slug)
    .all<WebhookRow>();

  if (results.length === 0) return;

  const dashboardUrl = `${env.APP_ORIGIN}/app/${project.slug}/groups/${group.id}`;
  const title = `${group.exception_code ?? "unknown"}${group.top_module ? ` · ${group.top_module}` : ""}${group.top_function ?? ""}`;

  await Promise.all(
    results.map((wh) =>
      fetch(wh.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: wh.kind === "discord"
          ? discordPayload(project, title, dashboardUrl)
          : slackPayload(project, title, dashboardUrl),
      }).catch(() => {/* silently swallow; webhook outages aren't our problem */}),
    ),
  );
}

function slackPayload(project: Project, title: string, url: string): string {
  return JSON.stringify({
    text: `🚨 new crash group in *${project.name}*`,
    attachments: [
      {
        color: "#ef4444",
        title,
        title_link: url,
        text: `<${url}|view in crashtrack>`,
      },
    ],
  });
}

function discordPayload(project: Project, title: string, url: string): string {
  return JSON.stringify({
    content: `🚨 new crash group in **${project.name}**`,
    embeds: [
      {
        title,
        url,
        color: COLOR_RED,
      },
    ],
  });
}
