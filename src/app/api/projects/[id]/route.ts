import { reconcile } from "@/lib/orchestrator";
import { deleteProject, getProject, listRuns } from "@/lib/store";

export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const { id } = await ctx.params;
  const project = await getProject(id);
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
  const runs = await Promise.all((await listRuns(id)).map(reconcile));
  return Response.json({
    project,
    runs: runs.map((r) => ({
      id: r.id,
      status: r.status,
      phase: r.phase,
      createdAt: r.createdAt,
      finishedAt: r.finishedAt,
      costUsd: r.costUsd,
      rounds: r.settings.rounds,
    })),
  });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const { id } = await ctx.params;
  await deleteProject(id);
  return Response.json({ ok: true });
}
