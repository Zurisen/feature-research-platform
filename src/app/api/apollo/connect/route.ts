import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { authorizeUrl, oauthConfig } from "@/lib/apollo";

export async function GET() {
  if (!oauthConfig().configured) {
    return new Response(
      "Apollo OAuth is not configured. Set APOLLO_CLIENT_ID, APOLLO_CLIENT_SECRET and APOLLO_REDIRECT_URI in .env.local.",
      { status: 400 },
    );
  }
  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(authorizeUrl(state));
  res.cookies.set("apollo_oauth_state", state, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
