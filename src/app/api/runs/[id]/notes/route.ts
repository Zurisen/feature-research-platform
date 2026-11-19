import { addNote } from "@/lib/orchestrator";

/** Adds a note from the person watching the run; a liaison agent restates it for the other agents. */
export async function POST(req: Request, ctx: RouteContext<"/api/runs/[id]/notes">) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { text?: unknown };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return Response.json({ error: "Write a note first." }, { status: 400 });
  if (text.length > 4000) return Response.json({ error: "Keep the note under 4,000 characters." }, { status: 400 });
  const result = await addNote(id, text);
  if (result.error) return Response.json({ error: result.error }, { status: 404 });
  return Response.json({ note: result.note }, { status: 201 });
}
