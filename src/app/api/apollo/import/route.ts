import { z } from "zod";
import { enrichBusiness, myDomain, searchContacts } from "@/lib/apollo";

const Body = z.discriminatedUnion("kind", [
  // Organization Enrichment costs 1 Apollo credit, so it only runs on an explicit request.
  z.object({ kind: z.literal("business"), domain: z.string().optional() }),
  z.object({ kind: z.literal("leads"), keywords: z.string().optional(), page: z.number().int().min(1).optional() }),
]);

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  try {
    if (parsed.data.kind === "business") {
      const domain = parsed.data.domain?.trim() || (await myDomain());
      return Response.json({ business: await enrichBusiness(domain) });
    }
    return Response.json(await searchContacts({ keywords: parsed.data.keywords, page: parsed.data.page }));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
