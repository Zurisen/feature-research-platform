import { promises as fs } from "node:fs";
import path from "node:path";
import { createProject } from "@/lib/store";
import { ProjectInputSchema } from "@/lib/types";

/** Creates the fictional sample project shipped in samples/traillog.json. */
export async function POST() {
  const raw = await fs.readFile(path.join(process.cwd(), "samples", "traillog.json"), "utf8");
  const project = await createProject(ProjectInputSchema.parse(JSON.parse(raw)));
  return Response.json(project, { status: 201 });
}
