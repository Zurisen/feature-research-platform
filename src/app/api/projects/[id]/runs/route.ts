import { startRun } from "@/lib/orchestrator";
import { getProject, getSettings } from "@/lib/store";
import { SettingsSchema } from "@/lib/types";

export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/runs">) {
  const { id } = await ctx.params;
  const project = await getProject(id);
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
  const overrides = await req.json().catch(() => ({}));
  const settings = SettingsSchema.safeParse({ ...(await getSettings()), ...overrides });
  if (!settings.success) return Response.json({ error: settings.error.issues[0]?.message }, { status: 400 });
  const run = await startRun(project, settings.data);
  return Response.json({ id: run.id }, { status: 201 });
}
