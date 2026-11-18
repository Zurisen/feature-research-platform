"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { api, fmtDate } from "@/lib/client";
import { MODELS, Project, Settings } from "@/lib/types";

type RunRow = { id: string; status: string; phase: string; createdAt: string; costUsd: number; rounds: number };

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<{ project: Project; runs: RunRow[] } | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    api<{ project: Project; runs: RunRow[] }>(`/api/projects/${id}`).then(setData, (e) => setError(e.message));
    api<{ settings: Settings }>("/api/settings").then((r) => setSettings(r.settings), () => {});
  }, [id]);

  async function start() {
    if (!settings) return;
    setStarting(true);
    setError("");
    try {
      const r = await api<{ id: string }>(`/api/projects/${id}/runs`, { json: settings });
      router.push(`/runs/${r.id}`);
    } catch (e) {
      setError((e as Error).message);
      setStarting(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this project? Its runs are kept on disk but no longer listed.")) return;
    await api(`/api/projects/${id}`, { method: "DELETE" });
    router.push("/");
  }

  if (error && !data) return <p className="text-sm text-bad">{error}</p>;
  if (!data) return <p className="hint">Loading…</p>;
  const { project: p, runs } = data;
  const agentCalls = settings ? 2 + (settings.rounds - 1) + settings.rounds * p.leads.length : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{p.name}</h1>
          <p className="hint mt-1">
            {p.business.name} · {p.source === "apollo" ? "from Apollo" : "entered manually"} · {fmtDate(p.createdAt)}
          </p>
        </div>
        <button className="btn btn-danger" onClick={remove}>Delete project</button>
      </div>

      <section className="card space-y-4">
        <h2 className="font-semibold">Start a run</h2>
        {settings && (
          <>
            <div className="grid gap-4 sm:grid-cols-4">
              <div>
                <label className="label" htmlFor="rounds">Feedback rounds</label>
                <input id="rounds" type="number" min={1} max={5} className="input" value={settings.rounds} onChange={(e) => setSettings({ ...settings, rounds: Math.max(1, Math.min(5, Number(e.target.value) || 1)) })} />
              </div>
              <div>
                <label className="label" htmlFor="dm">Developer agent model</label>
                <select id="dm" className="input" value={settings.developerModel} onChange={(e) => setSettings({ ...settings, developerModel: e.target.value })}>
                  {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="lm">Lead agent model</label>
                <select id="lm" className="input" value={settings.leadModel} onChange={(e) => setSettings({ ...settings, leadModel: e.target.value })}>
                  {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input type="checkbox" checked={settings.webResearch} onChange={(e) => setSettings({ ...settings, webResearch: e.target.checked })} />
                Web research
              </label>
            </div>
            <p className="hint">
              This run makes about {agentCalls} agent calls ({p.leads.length} leads × {settings.rounds} rounds, plus the developer
              agent), using {settings.authMode === "local" ? "the Claude Code login on this machine" : "your Anthropic API key"}.
            </p>
          </>
        )}
        {error && <p className="text-sm text-bad" role="alert">{error}</p>}
        <button className="btn btn-primary" onClick={start} disabled={starting || !settings}>
          {starting ? "Starting…" : "Start run"}
        </button>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Runs</h2>
        {runs.length === 0 && <p className="hint">No runs yet.</p>}
        <ul className="divide-y divide-border">
          {runs.map((r) => (
            <li key={r.id}>
              <Link href={`/runs/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm hover:text-accent">
                <span>{fmtDate(r.createdAt)} · {r.rounds} round{r.rounds > 1 ? "s" : ""}</span>
                <span className="flex items-center gap-3">
                  <span className="text-muted">{r.status === "running" ? r.phase : ""}</span>
                  <StatusBadge status={r.status} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Business</h2>
        <p className="hint">{[p.business.industry, p.business.employees && `${p.business.employees} employees`, p.business.website].filter(Boolean).join(" · ")}</p>
        <p className="prose-block">{p.business.description}</p>
        {p.focusArea && <p className="text-sm"><span className="font-medium">Area to develop:</span> {p.focusArea}</p>}
        {p.extraContext && <p className="text-sm"><span className="font-medium">Extra context:</span> {p.extraContext}</p>}
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Leads ({p.leads.length})</h2>
        <ul className="divide-y divide-border">
          {p.leads.map((l) => (
            <li key={l.id} className="py-2 text-sm">
              <span className="font-medium">{l.name || "Unnamed lead"}</span>{" "}
              <span className="text-muted">{[l.title, l.company, l.industry, l.companySize, l.location].filter(Boolean).join(" · ")}</span>
              {l.notes && <p className="mt-1 text-muted">{l.notes}</p>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
