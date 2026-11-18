import { loadRun } from "@/lib/orchestrator";
import { getProject } from "@/lib/store";

export async function GET(_req: Request, ctx: RouteContext<"/api/runs/[id]">) {
  const { id } = await ctx.params;
  const run = await loadRun(id);
  if (!run) return Response.json({ error: "Run not found" }, { status: 404 });
  return Response.json({ run, project: await getProject(run.projectId) });
}
