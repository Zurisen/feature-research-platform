import { NextRequest, NextResponse } from "next/server";
import { exchangeCode } from "@/lib/apollo";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const expected = req.cookies.get("apollo_oauth_state")?.value;
  if (!code || !state || !expected || state !== expected) {
    return new Response(
      "Apollo sign-in could not be verified (missing code or state mismatch). Start again from Settings.",
      { status: 400 },
    );
  }
  try {
    await exchangeCode(code);
  } catch (e) {
    return new Response(`Apollo sign-in failed: ${(e as Error).message}`, { status: 502 });
  }
  const res = NextResponse.redirect(new URL("/settings", req.nextUrl.origin));
  res.cookies.delete("apollo_oauth_state");
  return res;
}
