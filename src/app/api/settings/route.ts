import { getSettings, saveSettings } from "@/lib/store";
import { SettingsSchema } from "@/lib/types";

export async function GET() {
  return Response.json({ settings: await getSettings(), apiKeyPresent: !!process.env.ANTHROPIC_API_KEY });
}

export async function PUT(req: Request) {
  const parsed = SettingsSchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  await saveSettings(parsed.data);
  return Response.json({ settings: parsed.data });
}
