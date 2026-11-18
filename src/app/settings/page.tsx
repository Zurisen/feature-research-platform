"use client";

import { useEffect, useState } from "react";
import { api, ApolloStatus } from "@/lib/client";
import { MODELS, Settings } from "@/lib/types";

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [apiKeyPresent, setApiKeyPresent] = useState(false);
  const [apollo, setApollo] = useState<ApolloStatus | null>(null);
  const [saved, setSaved] = useState("");

  const loadApollo = () => api<ApolloStatus>("/api/apollo/status").then(setApollo, () => {});
  useEffect(() => {
    api<{ settings: Settings; apiKeyPresent: boolean }>("/api/settings").then((r) => {
      setSettings(r.settings);
      setApiKeyPresent(r.apiKeyPresent);
    }, () => {});
    loadApollo();
  }, []);

  async function save(next: Settings) {
    setSettings(next);
    setSaved("");
    try {
      await api("/api/settings", { method: "PUT", json: next });
      setSaved("Saved");
    } catch (e) {
      setSaved((e as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section className="card space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Agents</h2>
          <span className="hint" aria-live="polite">{saved}</span>
        </div>
        {settings && (
          <>
            <fieldset className="space-y-2">
              <legend className="label">Agent authentication</legend>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name="auth" className="mt-1" checked={settings.authMode === "local"} onChange={() => save({ ...settings, authMode: "local" })} />
                <span>
                  <span className="font-medium">Local Claude Code login</span>
                  <span className="hint block">Agents run through the Claude Code installation on this machine and use its sign-in. For personal, local use.</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name="auth" className="mt-1" checked={settings.authMode === "apiKey"} onChange={() => save({ ...settings, authMode: "apiKey" })} />
                <span>
                  <span className="font-medium">Anthropic API key</span>
                  <span className="hint block">
                    Uses ANTHROPIC_API_KEY from .env.local ({apiKeyPresent ? "found" : "not set"}). This is the mode to use once the app is hosted for other people.
                  </span>
                </span>
              </label>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-4">
              <div>
                <label className="label" htmlFor="dm">Developer agent model</label>
                <select id="dm" className="input" value={settings.developerModel} onChange={(e) => save({ ...settings, developerModel: e.target.value })}>
                  {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="lm">Lead agent model</label>
                <select id="lm" className="input" value={settings.leadModel} onChange={(e) => save({ ...settings, leadModel: e.target.value })}>
                  {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="rounds">Default feedback rounds</label>
                <input id="rounds" type="number" min={1} max={5} className="input" value={settings.rounds} onChange={(e) => save({ ...settings, rounds: Math.max(1, Math.min(5, Number(e.target.value) || 1)) })} />
              </div>
              <div>
                <label className="label" htmlFor="conc">Lead agents in parallel</label>
                <input id="conc" type="number" min={1} max={8} className="input" value={settings.concurrency} onChange={(e) => save({ ...settings, concurrency: Math.max(1, Math.min(8, Number(e.target.value) || 1)) })} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={settings.webResearch} onChange={(e) => save({ ...settings, webResearch: e.target.checked })} />
              Let the developer agent search the web during research
            </label>
          </>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Apollo.io</h2>
        {apollo && (
          <>
            <p className="text-sm">
              Status:{" "}
              <span className="font-medium">
                {apollo.connected ? "Connected with OAuth" : apollo.apiKeyFallback ? "Using APOLLO_API_KEY from .env.local" : "Not connected"}
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
              {apollo.connected ? (
                <button className="btn btn-danger" onClick={async () => { await api("/api/apollo/disconnect", { method: "POST" }); loadApollo(); }}>
                  Disconnect
                </button>
              ) : (
                <a className={`btn btn-primary ${apollo.oauthConfigured ? "" : "pointer-events-none opacity-50"}`} aria-disabled={!apollo.oauthConfigured} href={apollo.oauthConfigured ? "/api/apollo/connect" : undefined}>
                  Connect Apollo
                </a>
              )}
            </div>
            {!apollo.oauthConfigured && (
              <div className="hint space-y-1">
                <p>To enable the Connect button:</p>
                <ol className="list-decimal space-y-1 pl-5">
                  <li>In Apollo, open Settings → Integrations → API Keys → OAuth registration and register an app. Apollo has to approve it before it can be used.</li>
                  <li>Give it an https redirect URL ending in <code>/api/apollo/callback</code> (use a tunnel to this machine while developing) and the scopes <code>read_user_profile app_scopes organizations_enrich contacts_search</code>.</li>
                  <li>Put APOLLO_CLIENT_ID, APOLLO_CLIENT_SECRET and APOLLO_REDIRECT_URI in <code>.env.local</code> and restart the app.</li>
                </ol>
                <p>Until then, APOLLO_API_KEY in <code>.env.local</code> works as a development fallback.</p>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
