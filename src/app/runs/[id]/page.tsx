"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { api } from "@/lib/client";
import type { Project, Run, RunRound } from "@/lib/types";

export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<{ run: Run; project: Project | null } | null>(null);
  const [error, setError] = useState("");
  const [roundIdx, setRoundIdx] = useState<number | null>(null);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const d = await api<{ run: Run; project: Project | null }>(`/api/runs/${id}`);
        if (stop) return;
        setData(d);
        setError("");
        if (d.run.status === "running") timer = setTimeout(tick, 2000);
      } catch (e) {
        if (stop) return;
        setError((e as Error).message);
        timer = setTimeout(tick, 5000);
      }
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [id]);

  if (!data) return <p className={error ? "text-sm text-bad" : "hint"}>{error || "Loading…"}</p>;
  const { run, project } = data;
  const leads = project?.leads ?? [];
  const leadName = (leadId: string) => {
    const l = leads.find((x) => x.id === leadId);
    return l ? l.name || l.title || "Lead" : "Lead";
  };
  const shown = run.rounds.length ? run.rounds[Math.min(roundIdx ?? run.rounds.length - 1, run.rounds.length - 1)] : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {project && (
            <Link href={`/projects/${project.id}`} className="hint hover:text-text">← {project.name}</Link>
          )}
          <h1 className="mt-1 flex items-center gap-3 text-2xl font-semibold">
            Run <StatusBadge status={run.status} />
          </h1>
          <p className="hint mt-1" aria-live="polite">
            {run.phase}
            {run.costUsd > 0 && ` · estimated cost $${run.costUsd.toFixed(2)}`}
          </p>
        </div>
        {run.status === "running" && (
          <button className="btn btn-danger" onClick={() => api(`/api/runs/${id}/cancel`, { method: "POST" })}>
            Cancel run
          </button>
        )}
      </div>

      {run.error && <div className="card border-bad text-sm text-bad" role="alert">{run.error}</div>}

      {run.ranking && (
        <section className="card space-y-4">
          <h2 className="text-lg font-semibold">Feature ranking</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-muted">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3 font-medium">#</th>
                  <th className="py-2 pr-3 font-medium">Feature</th>
                  <th className="py-2 pr-3 font-medium" title="Reach × Impact × Confidence ÷ Effort">RICE</th>
                  <th className="py-2 pr-3 font-medium">Leads</th>
                  <th className="py-2 pr-3 font-medium">Reach</th>
                  <th className="py-2 pr-3 font-medium">Impact</th>
                  <th className="py-2 pr-3 font-medium">Conf.</th>
                  <th className="py-2 font-medium">Effort</th>
                </tr>
              </thead>
              <tbody>
                {run.ranking.map((r) => (
                  <tr key={r.featureId} className="border-b border-border align-top last:border-0">
                    <td className="py-3 pr-3 font-semibold">{r.rank}</td>
                    <td className="py-3 pr-3">
                      <p className="font-medium">{r.title}</p>
                      <p className="mt-1 text-muted">{r.rationale}</p>
                      {r.champions.length > 0 && <p className="mt-1"><span className="text-good">Wanted by:</span> {r.champions.join(", ")}</p>}
                      {r.concerns && <p className="mt-1"><span className="text-warn">Concern:</span> {r.concerns}</p>}
                    </td>
                    <td className="py-3 pr-3 font-semibold">{r.rice}</td>
                    <td className="py-3 pr-3 whitespace-nowrap">{r.avgLeadScore !== null ? `${r.avgLeadScore}/5` : "—"}</td>
                    <td className="py-3 pr-3">{r.reach}</td>
                    <td className="py-3 pr-3">{r.impact}</td>
                    <td className="py-3 pr-3">{r.confidence}%</td>
                    <td className="py-3 whitespace-nowrap">{r.effortWeeks} wk</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">
            RICE inputs are the developer agent&apos;s estimates; &quot;Leads&quot; is the average score from the final feedback round. Lead
            agents are simulated from profile data, so validate the top items with real customers.
          </p>
          {run.summary && (
            <div>
              <h3 className="mb-1 font-semibold">Recommendation</h3>
              <p className="prose-block">{run.summary}</p>
            </div>
          )}
        </section>
      )}

      {shown && (
        <section className="card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Features and lead feedback</h2>
            <div className="flex gap-1" role="tablist" aria-label="Feedback round">
              {run.rounds.map((r, i) => (
                <button key={r.round} role="tab" aria-selected={r === shown} className={`btn ${r === shown ? "btn-primary" : ""}`} onClick={() => setRoundIdx(i)}>
                  Round {r.round}
                </button>
              ))}
            </div>
          </div>
          <RoundView round={shown} leadCount={leads.length} leadName={leadName} />
        </section>
      )}

      {run.research && (
        <details className="card">
          <summary className="cursor-pointer font-semibold">Developer agent research</summary>
          <p className="prose-block mt-3">{run.research}</p>
        </details>
      )}

      <details className="card" open={run.status === "running"}>
        <summary className="cursor-pointer font-semibold">Activity ({run.events.length})</summary>
        <ol className="mt-3 max-h-80 space-y-1 overflow-auto font-mono text-xs">
          {[...run.events].reverse().map((e, i) => (
            <li key={i} className={e.kind === "error" ? "text-bad" : e.kind === "activity" ? "text-muted" : ""}>
              <span className="text-muted">{new Date(e.ts).toLocaleTimeString()}</span>{" "}
              <span className="font-semibold">{e.agent}</span> {e.text}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

function RoundView({ round, leadCount, leadName }: { round: RunRound; leadCount: number; leadName: (id: string) => string }) {
  const done = round.feedback.length;
  const failed = round.feedback.filter((f) => f.error);
  return (
    <div className="space-y-4">
      <p className="hint">{done} of {leadCount} leads have responded{failed.length > 0 && `, ${failed.length} failed`}.</p>
      {round.changelog && (
        <div className="rounded-lg bg-accent-soft p-3 text-sm">
          <p className="font-medium">What the developer agent changed for this round</p>
          <p className="prose-block mt-1">{round.changelog}</p>
        </div>
      )}
      {round.features.map((f) => {
        const reactions = round.feedback.flatMap((fb) =>
          fb.items.filter((i) => i.featureId === f.id).map((i) => ({ ...i, leadId: fb.leadId })),
        );
        const avg = reactions.length ? reactions.reduce((a, b) => a + b.score, 0) / reactions.length : null;
        return (
          <div key={f.id} className="rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="font-semibold">{f.id} · {f.title}</h3>
              <span className="flex gap-2">
                <span className="badge">Effort {f.effort}</span>
                {avg !== null && <span className="badge">{avg.toFixed(1)}/5 from {reactions.length}</span>}
              </span>
            </div>
            <p className="mt-2 text-sm">{f.description}</p>
            <p className="mt-1 text-sm text-muted">Problem: {f.problem} · For: {f.targetUsers}</p>
            {reactions.length > 0 && (
              <ul className="mt-3 space-y-2 border-t border-border pt-3 text-sm">
                {reactions.map((r) => (
                  <li key={r.leadId} className="flex gap-3">
                    <span className={`w-8 shrink-0 font-semibold ${r.score >= 4 ? "text-good" : r.score <= 2 ? "text-bad" : "text-warn"}`}>{r.score}/5</span>
                    <span><span className="font-medium">{leadName(r.leadId)}:</span> {r.comment}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      {round.feedback.some((f) => !f.error) && (
        <div>
          <h3 className="mb-2 font-semibold">Overall takes</h3>
          <ul className="space-y-3 text-sm">
            {round.feedback.filter((f) => !f.error).map((f) => (
              <li key={f.leadId}>
                <p><span className="font-medium">{leadName(f.leadId)}:</span> {f.overall}</p>
                {f.missing.length > 0 && <p className="mt-1 text-muted">Would also want: {f.missing.join("; ")}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
