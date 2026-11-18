import { getSecrets, updateSecrets, newId, ApolloTokens } from "./store";
import { Business, Lead } from "./types";

// Apollo.io integration.
// Primary: OAuth 2.0 partner flow (needs an OAuth app registered and approved by Apollo).
// Dev fallback: APOLLO_API_KEY in .env.local, sent as x-api-key, for use until the OAuth app is approved.
// Docs: https://docs.apollo.io/docs/use-oauth-20-authorization-flow-to-access-apollo-user-information-partners

const AUTHORIZE_URL = "https://app.apollo.io/#/oauth/authorize";
const TOKEN_URL = "https://app.apollo.io/api/v1/oauth/token";
const API = "https://api.apollo.io/api/v1";
const DEFAULT_SCOPES = "read_user_profile app_scopes organizations_enrich contacts_search";

export function oauthConfig() {
  const clientId = process.env.APOLLO_CLIENT_ID ?? "";
  const clientSecret = process.env.APOLLO_CLIENT_SECRET ?? "";
  const redirectUri = process.env.APOLLO_REDIRECT_URI ?? "";
  const scopes = process.env.APOLLO_SCOPES ?? DEFAULT_SCOPES;
  return { clientId, clientSecret, redirectUri, scopes, configured: !!(clientId && clientSecret && redirectUri) };
}

export async function apolloStatus() {
  const cfg = oauthConfig();
  const { apollo } = await getSecrets();
  return {
    oauthConfigured: cfg.configured,
    redirectUri: cfg.redirectUri,
    connected: !!apollo,
    apiKeyFallback: !!process.env.APOLLO_API_KEY,
    usable: !!apollo || !!process.env.APOLLO_API_KEY,
  };
}

export function authorizeUrl(state: string) {
  const cfg = oauthConfig();
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: cfg.scopes,
    state,
  });
  return `${AUTHORIZE_URL}?${q}`;
}

async function tokenRequest(params: Record<string, string>): Promise<ApolloTokens> {
  const cfg = oauthConfig();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ ...params, client_id: cfg.clientId, client_secret: cfg.clientSecret }),
  });
  if (!res.ok) throw new Error(`Apollo token request failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const t = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number; scope?: string };
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: Date.now() + (t.expires_in ?? 0) * 1000,
    scope: t.scope ?? "",
  };
}

export async function exchangeCode(code: string) {
  const tokens = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: oauthConfig().redirectUri,
  });
  await updateSecrets((s) => ({ ...s, apollo: tokens }));
}

export const disconnect = () => updateSecrets((s) => ({ ...s, apollo: undefined }));

async function authHeaders(): Promise<Record<string, string>> {
  const { apollo } = await getSecrets();
  if (apollo) {
    let tokens = apollo;
    // Apollo rotates the refresh token on every refresh, so the new pair is persisted before use.
    if (tokens.expiresAt - Date.now() < 24 * 60 * 60 * 1000) {
      tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refreshToken });
      await updateSecrets((s) => ({ ...s, apollo: tokens }));
    }
    return { Authorization: `Bearer ${tokens.accessToken}` };
  }
  if (process.env.APOLLO_API_KEY) return { "x-api-key": process.env.APOLLO_API_KEY };
  throw new Error("Apollo is not connected.");
}

async function call<T>(method: "GET" | "POST", pathAndQuery: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${pathAndQuery}`, {
    method,
    headers: {
      ...(await authHeaders()),
      Accept: "application/json",
      "Cache-Control": "no-cache",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const hint =
      res.status === 403 ? " (this endpoint may need a paid Apollo plan or an extra scope)" : res.status === 429 ? " (rate limited)" : "";
    throw new Error(`Apollo ${pathAndQuery.split("?")[0]} failed with ${res.status}${hint}: ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

type ApolloOrg = {
  name?: string;
  website_url?: string;
  primary_domain?: string;
  industry?: string;
  estimated_num_employees?: number;
  short_description?: string;
  seo_description?: string;
  keywords?: string[];
  city?: string;
  country?: string;
};

function orgToBusiness(o: ApolloOrg): Business {
  const desc = [o.short_description || o.seo_description, o.keywords?.length ? `Keywords: ${o.keywords.slice(0, 15).join(", ")}` : ""]
    .filter(Boolean)
    .join("\n\n");
  return {
    name: o.name ?? "",
    website: o.website_url ?? o.primary_domain ?? "",
    industry: o.industry ?? "",
    employees: o.estimated_num_employees ? String(o.estimated_num_employees) : "",
    description: desc,
  };
}

/** The connected user's email domain, used to identify "my business". 0 credits. */
export async function myDomain(): Promise<string> {
  const p = await call<{ email?: string }>("GET", "/users/api_profile");
  const domain = p.email?.split("@")[1] ?? "";
  if (!domain) throw new Error("Could not read the account email from Apollo; enter the company domain instead.");
  return domain;
}

/** Organization Enrichment. Costs 1 Apollo credit per call. */
export async function enrichBusiness(domain: string): Promise<Business> {
  const r = await call<{ organization?: ApolloOrg }>("GET", `/organizations/enrich?${new URLSearchParams({ domain })}`);
  if (!r.organization) throw new Error(`Apollo has no organization for ${domain}.`);
  return orgToBusiness(r.organization);
}

type ApolloContact = {
  id?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  headline?: string;
  organization_name?: string;
  city?: string;
  state?: string;
  country?: string;
  organization?: ApolloOrg;
  account?: ApolloOrg;
};

/** Saved contacts from the user's Apollo account. 0 credits, paid plans only. Emails and phones are deliberately dropped. */
export async function searchContacts(opts: { keywords?: string; page?: number; perPage?: number }) {
  const r = await call<{ contacts?: ApolloContact[]; pagination?: { total_entries?: number; total_pages?: number } }>(
    "POST",
    "/contacts/search",
    {
      q_keywords: opts.keywords || undefined,
      page: opts.page ?? 1,
      per_page: Math.min(opts.perPage ?? 25, 100),
      sort_by_field: "contact_last_activity_date",
      sort_ascending: false,
    },
  );
  const leads: Lead[] = (r.contacts ?? []).map((c) => {
    const org = c.organization ?? c.account ?? {};
    return {
      id: c.id ?? newId(),
      name: c.name ?? [c.first_name, c.last_name].filter(Boolean).join(" "),
      title: c.title ?? "",
      company: c.organization_name ?? org.name ?? "",
      industry: org.industry ?? "",
      companySize: org.estimated_num_employees ? String(org.estimated_num_employees) : "",
      location: [c.city, c.state, c.country].filter(Boolean).join(", "),
      notes: c.headline ?? "",
    };
  });
  return { leads, total: r.pagination?.total_entries ?? leads.length };
}
