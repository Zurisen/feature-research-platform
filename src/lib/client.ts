// Browser-side fetch helper: returns parsed JSON or throws the server's error message.
export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    ...(json !== undefined
      ? { body: JSON.stringify(json), headers: { "Content-Type": "application/json" }, method: rest.method ?? "POST" }
      : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export type ApolloStatus = {
  oauthConfigured: boolean;
  redirectUri: string;
  connected: boolean;
  apiKeyFallback: boolean;
  usable: boolean;
};
