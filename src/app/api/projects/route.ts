import { createProject, listProjects } from "@/lib/store";
import { MIN_MANUAL_LEADS, ProjectInputSchema } from "@/lib/types";

export async function GET() {
  return Response.json(await listProjects());
}

export async function POST(req: Request) {
  const parsed = ProjectInputSchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid project" }, { status: 400 });
  const input = parsed.data;
  const min = input.source === "manual" ? MIN_MANUAL_LEADS : 1;
  if (input.leads.length < min) {
    return Response.json({ error: `Add at least ${min} lead${min > 1 ? "s" : ""}.` }, { status: 400 });
  }
  if (input.leads.some((l) => !l.title.trim() && !l.notes.trim())) {
    return Response.json({ error: "Every lead needs at least a job title or a description." }, { status: 400 });
  }
  return Response.json(await createProject(input), { status: 201 });
}
