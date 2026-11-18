import { createProject, listProjects } from "@/lib/store";
import { validateProjectInput } from "@/lib/types";

export async function GET() {
  return Response.json(await listProjects());
}

export async function POST(req: Request) {
  const checked = validateProjectInput(await req.json());
  if ("error" in checked) return Response.json({ error: checked.error }, { status: 400 });
  return Response.json(await createProject(checked.input), { status: 201 });
}
