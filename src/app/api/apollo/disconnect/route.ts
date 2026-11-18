import { disconnect } from "@/lib/apollo";

export async function POST() {
  await disconnect();
  return Response.json({ ok: true });
}
