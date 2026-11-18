import { cancelRun } from "@/lib/orchestrator";

export async function POST(_req: Request, ctx: RouteContext<"/api/runs/[id]/cancel">) {
  const { id } = await ctx.params;
  cancelRun(id);
  return Response.json({ ok: true });
}
