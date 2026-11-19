"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import RankingChart from "@/components/RankingChart";
import { StatusBadge } from "@/components/StatusBadge";
import { api } from "@/lib/client";
import { finalPoints, finalScores, type Project, type Run, type RunRound } from "@/lib/types";

// three.js needs the browser, so the scene is loaded on the client only.
const AgentScene = dynamic(() => import("@/components/AgentScene"), {
  ssr: false,
  loading: () => <div className="skeleton h-[440px]" aria-label="Loading the agent view…" />,
});

export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<{ run: Run; project: Project | null } | null>(null);
  const [error, setError] = useState("");
  const [roundIdx, setRoundIdx] = useState<number | null>(null);
  const [tick, setTick] = useState(0); // bump to restart polling after resuming a run
  const [actionError, setActionError] = useState("");

  async function resume(addRound: boolean) {
    setActionError("");
    try {
      await api(`/api/runs/${id}/resume`, { json: { addRound } });
      setRoundIdx(null);
      setTick((t) => t + 1);
    } catch (e) {
      setActionError((e as Error).message);
    }
  }

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
  }, [id, tick]);

  if (!data) {
    return error ? (
      <p className="text-sm text-bad" role="alert">{error}</p>
    ) : (
      <div className="space-y-6" aria-busy="true" aria-label="Loading the run…">
        <div className="skeleton h-16 max-w-md" />
        <div className="skeleton h-[440px]" />
      </div>
    );
  }
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
          <h1 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-semibold sm:text-3xl">
            Run <StatusBadge status={run.status} />
          </h1>
          <p className="mt-1 text-sm text-muted" aria-live="polite">{run.phase}</p>
          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3 text-sm">
            <div>
              <dt className="hint">Rounds</dt>
              <dd className="num text-lg font-medium">{run.rounds.length}<span className="text-muted">/{run.settings.rounds}</span></dd>
            </div>
            <div>
              <dt className="hint">Leads</dt>
              <dd className="num text-lg font-medium">{leads.length}</dd>
            </div>
            <div>
              <dt className="hint">Estimated cost</dt>
              <dd className="num text-lg font-medium">${run.costUsd.toFixed(2)}</dd>
            </div>
            <div>
              <dt className="hint">Started</dt>
              <dd className="text-lg font-medium">{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(run.createdAt))}</dd>
            </div>
          </dl>
        </div>
        <div className="flex flex-wrap gap-2">
          {run.status === "running" && (
            <button className="btn btn-danger" onClick={() => api(`/api/runs/${id}/cancel`, { method: "POST" })}>
              Cancel run
            </button>
          )}
          {(run.status === "failed" || run.status === "cancelled") && (
            <button className="btn btn-primary" onClick={() => resume(false)} title="Continues from the last completed step; finished steps are not repeated">
              Resume run
            </button>
          )}
          {run.status === "completed" && run.settings.rounds < 5 && (
            <button className="btn" onClick={() => resume(true)} title="The developer agent revises the list, the leads review it again, and the ranking is redone">
              Add another round
            </button>
          )}
        </div>
      </div>
      {actionError && <p className="text-sm text-bad" role="alert">{actionError}</p>}

      {run.error && <div className="card border-bad text-sm text-bad" role="alert">{run.error}</div>}

      {run.status === "running" ? (
        <section className="card p-2">
          <AgentScene run={run} project={project} />
        </section>
      ) : (
        <details className="card">
          <summary className="cursor-pointer font-semibold">Agent view</summary>
          <div className="mt-3">
            <AgentScene run={run} project={project} />
          </div>
        </details>
      )}

      {run.ranking && (
        <section className="card space-y-4">
          <h2 className="text-lg font-semibold">Feature Ranking</h2>
          <RankingChart ranking={run.ranking} />
          <div className="overflow-x-auto border-t border-border pt-2">
            <table className="w-full min-w-[720px] text-left text-sm [&_td]:align-top [&_td:nth-child(n+3)]:font-mono [&_td:nth-child(n+3)]:tabular-nums">
              <thead className="text-muted">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3 font-medium">#</th>
                  <th className="py-2 pr-3 font-medium">Feature</th>
                  <th className="py-2 pr-3 font-medium" title="Reach × Impact × Confidence ÷ Effort">RICE</th>
                  <th className="py-2 pr-3 font-medium" title="Average score from the final round">Leads</th>
                  <th className="py-2 pr-3 font-medium" title="Share of all the leads' 10-point budgets spent on it">Budget</th>
                  <th className="py-2 pr-3 font-medium" title="Share of leads who chose it as their single top feature">1st choice</th>
                  <th className="py-2 pr-3 font-medium">Reach</th>
                  <th className="py-2 pr-3 font-medium">Impact</th>
                  <th className="py-2 pr-3 font-medium">Conf.</th>
                  <th className="py-2 pr-3 font-medium">Effort</th>
                  <th className="py-2 font-medium" title="Quarter it fits in at the team capacity set for this run">Qtr</th>
                </tr>
              </thead>
              <tbody>
                {run.ranking.map((r) => (
                  <tr key={r.featureId} className="border-b border-border align-top last:border-0">
                    <td className="py-3 pr-3 font-semibold whitespace-nowrap">
                      {r.rank}
                      {r.draftRank != null && r.draftRank !== r.rank && (
                        <span className={`ml-1 text-xs font-normal ${r.draftRank > r.rank ? "text-good" : "text-bad"}`} title={`Was #${r.draftRank} before the sceptic's challenge`}>
                          {r.draftRank > r.rank ? "▲" : "▼"}{Math.abs(r.draftRank - r.rank)}
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-3">
                      <p className="font-medium">
                        {r.title}
                        {run.insights?.quickWins.includes(r.featureId) && <span className="badge ml-2 text-good">Quick win</span>}
                        {run.insights?.bigBets.includes(r.featureId) && <span className="badge ml-2 text-warn">Big bet</span>}
                      </p>
                      <p className="mt-1 text-muted">{r.rationale}</p>
                      {r.champions.length > 0 && <p className="mt-1"><span className="text-good">Wanted by:</span> {r.champions.join(", ")}</p>}
                      {r.concerns && <p className="mt-1"><span className="text-warn">Concern:</span> {r.concerns}</p>}
                      {run.critique?.challenges
                        .filter((c) => c.featureId === r.featureId)
                        .map((c, i) => (
                          <p key={i} className="mt-1">
                            <span className={c.severity === "high" ? "text-bad" : "text-warn"}>Sceptic ({c.kind}):</span> {c.issue}
                          </p>
                        ))}
                    </td>
                    <td className="py-3 pr-3 font-semibold">{r.rice}</td>
                    <td className="py-3 pr-3 whitespace-nowrap">{r.avgLeadScore !== null ? `${r.avgLeadScore}/5` : "—"}</td>
                    <td className="py-3 pr-3">{r.pointsShare != null ? `${Math.round(r.pointsShare * 100)}%` : "—"}</td>
                    <td className="py-3 pr-3">{r.firstChoiceShare !== undefined ? `${Math.round(r.firstChoiceShare * 100)}%` : "—"}</td>
                    <td className="py-3 pr-3">{r.reach}</td>
                    <td className="py-3 pr-3">{r.impact}</td>
                    <td className="py-3 pr-3">{r.confidence}</td>
                    <td className="py-3 pr-3 uppercase">{r.effort ?? "—"}</td>
                    <td className="py-3">{r.quarter ? `Q${r.quarter}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">
            RICE inputs are the developer agent&apos;s estimates
            {run.insights && <>, scored by {run.insights.scoredBy === "built-in" ? "the built-in formula" : <code>rice_prioritizer.py</code>}</>}.
            Quarters assume {run.settings.teamCapacity ?? 10} person-months of capacity each. Lead agents are simulated from profile
            data, so validate the top items with real customers.
          </p>
          {run.insights && <Insights run={run} />}
          {run.summary && (
            <div>
              <h3 className="mb-1 font-semibold">Recommendation</h3>
              <p className="prose-block">{run.summary}</p>
            </div>
          )}
          {run.critique && (
            <details className="rounded-lg border border-border p-4">
              <summary className="cursor-pointer font-semibold">
                Sceptic&apos;s challenge ({run.critique.challenges.length} points) and the developer agent&apos;s answer
              </summary>
              <div className="mt-3 space-y-4 text-sm">
                <div>
                  <h4 className="mb-1 font-medium">How far to trust this ranking</h4>
                  <p className="prose-block">{run.critique.overall}</p>
                </div>
                {run.critique.weakLeads.length > 0 && (
                  <div>
                    <h4 className="mb-1 font-medium">Leads to weigh less</h4>
                    <ul className="list-disc space-y-1 pl-5">
                      {run.critique.weakLeads.map((w) => <li key={w.lead}><span className="font-medium">{w.lead}:</span> {w.reason}</li>)}
                    </ul>
                  </div>
                )}
                <div>
                  <h4 className="mb-1 font-medium">Challenges</h4>
                  <ul className="space-y-2">
                    {run.critique.challenges.map((c, i) => (
                      <li key={i}>
                        <span className={`badge mr-2 ${c.severity === "high" ? "text-bad" : c.severity === "medium" ? "text-warn" : ""}`}>{c.severity}</span>
                        <span className="font-medium">{c.featureId} · {c.kind}.</span> {c.issue} <span className="text-muted">Suggested: {c.suggestion}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                {run.critiqueResponse && (
                  <div>
                    <h4 className="mb-1 font-medium">Developer agent&apos;s answer</h4>
                    <p className="prose-block">{run.critiqueResponse}</p>
                  </div>
                )}
              </div>
            </details>
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

      {run.briefs && Object.keys(run.briefs).length > 0 && (
        <details className="card">
          <summary className="cursor-pointer font-semibold">Persona briefs ({Object.keys(run.briefs).length})</summary>
          <ul className="mt-3 space-y-4 text-sm">
            {leads.filter((l) => run.briefs![l.id]).map((l) => {
              const b = run.briefs![l.id];
              return (
                <li key={l.id}>
                  <p className="font-medium">
                    {l.name || l.title} <span className="badge ml-1">{b.buyingRole}</span> <span className="badge">{b.fit} fit</span>
                  </p>
                  <p className="mt-1">{b.companyContext}</p>
                  <p className="mt-1 text-muted">Cares about: {b.rolePriorities.join("; ")}</p>
                  <p className="mt-1 text-muted">Likely objections: {b.likelyObjections.join("; ")}</p>
                  <p className="mt-1 text-muted">Fit: {b.fitReason}</p>
                </li>
              );
            })}
          </ul>
        </details>
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
          fb.items
            .filter((i) => i.featureId === f.id)
            .map((i) => ({
              ...i,
              leadId: fb.leadId,
              first: i.score,
              score: finalScores(fb).get(f.id) ?? i.score,
              rebuttal: fb.rebuttal?.revised.find((x) => x.featureId === f.id)?.comment,
              points: finalPoints(fb).get(f.id),
              topPick: fb.topPick === f.id,
            })),
        );
        const avg = reactions.length ? reactions.reduce((a, b) => a + b.score, 0) / reactions.length : null;
        const budget = reactions.some((r) => r.points !== undefined) ? reactions.reduce((a, b) => a + (b.points ?? 0), 0) : null;
        return (
          <div key={f.id} className="rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="font-semibold">{f.id} · {f.title}</h3>
              <span className="flex gap-2">
                <span className="badge">Effort {f.effort}</span>
                {avg !== null && <span className="badge">{avg.toFixed(1)}/5 from {reactions.length}</span>}
                {budget !== null && <span className="badge" title="Budget points the leads spent on this feature, out of 10 each">{Math.round(budget * 10) / 10} pts</span>}
              </span>
            </div>
            <p className="mt-2 text-sm">{f.description}</p>
            <p className="mt-1 text-sm text-muted">Problem: {f.problem} · For: {f.targetUsers}</p>
            {reactions.length > 0 && (
              <ul className="mt-3 space-y-2 border-t border-border pt-3 text-sm">
                {reactions.map((r) => (
                  <li key={r.leadId} className="flex gap-3">
                    <span className={`w-12 shrink-0 font-semibold ${r.score >= 4 ? "text-good" : r.score <= 2 ? "text-bad" : "text-warn"}`}>
                      {r.first !== r.score ? `${r.first}→${r.score}` : `${r.score}/5`}
                    </span>
                    <span>
                      <span className="font-medium">{leadName(r.leadId)}:</span> {r.comment}
                      {r.topPick && <span className="badge ml-2">Top pick</span>}
                      {r.points !== undefined && r.points > 0 && <span className="badge ml-2">{Math.round(r.points * 10) / 10} pts</span>}
                      {r.rebuttal && <span className="mt-1 block text-muted">After hearing the others: {r.rebuttal}</span>}
                    </span>
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
                {f.quote && <p className="mt-1 italic">“{f.quote}”</p>}
                {f.rebuttal?.closing && <p className="mt-1 text-muted">Closing: {f.rebuttal.closing}</p>}
                {f.missing.length > 0 && <p className="mt-1 text-muted">Would also want: {f.missing.join("; ")}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Insights({ run }: { run: Run }) {
  const i = run.insights!;
  const total = i.sentiment ? i.sentiment.positive + i.sentiment.neutral + i.sentiment.negative : 0;
  return (
    <div className="grid gap-4 rounded-lg border border-border p-4 text-sm sm:grid-cols-3">
      <div>
        <p className="hint">Likelihood to buy if top pick ships</p>
        <p className="text-xl font-semibold">{i.meanAdoption !== null ? `${i.meanAdoption}/5` : "—"}</p>
        <p className="hint mt-2">Total effort for the list</p>
        <p className="font-medium">{i.totalEffortMonths} person-months</p>
      </div>
      <div>
        <p className="hint">Recurring themes in the feedback</p>
        {i.themes.length > 0 ? (
          <p className="mt-1 flex flex-wrap gap-1">
            {i.themes.map((t) => <span key={t.name} className="badge">{t.name} · {t.count}</span>)}
          </p>
        ) : <p>—</p>}
        {total > 0 && (
          <p className="hint mt-2">
            Tone of leads: {i.sentiment!.positive} positive, {i.sentiment!.neutral} neutral, {i.sentiment!.negative} negative
          </p>
        )}
      </div>
      <div>
        <p className="hint">Requests picked out of the comments</p>
        {i.requests.length > 0 ? (
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {i.requests.slice(0, 4).map((q) => <li key={q}>{q}</li>)}
          </ul>
        ) : <p>—</p>}
      </div>
    </div>
  );
}
