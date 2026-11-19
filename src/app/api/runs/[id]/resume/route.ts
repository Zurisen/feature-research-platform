import { resumeRun } from "@/lib/orchestrator";

/** Resumes a failed or cancelled run, or with { addRound: true } adds one more round to a completed run. */
export async function POST(req: Request, ctx: RouteContext<"/api/runs/[id]/resume">) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { addRound?: boolean };
  const result = await resumeRun(id, { addRound: body.addRound === true });
  if (result.error) return Response.json({ error: result.error }, { status: 409 });
  return Response.json({ ok: true });
}
