import { reconcile } from "@/lib/orchestrator";
import { deleteProject, getProject, listRuns, updateProject } from "@/lib/store";
import { validateProjectInput } from "@/lib/types";

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

export async function PUT(req: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const { id } = await ctx.params;
  const checked = validateProjectInput(await req.json());
  if ("error" in checked) return Response.json({ error: checked.error }, { status: 400 });
  const project = await updateProject(id, checked.input);
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
  return Response.json(project);
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const { id } = await ctx.params;
  await deleteProject(id);
  return Response.json({ ok: true });
}
