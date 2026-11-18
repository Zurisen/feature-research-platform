import { apolloStatus } from "@/lib/apollo";

export async function GET() {
  return Response.json(await apolloStatus());
}
