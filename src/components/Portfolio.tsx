import Markdown from "@/components/Markdown";
import type { RankedFeature, Run } from "@/lib/types";

export const TRACKS = {
  build: { label: "Build", hint: "Strong, consistent evidence: plan it.", className: "text-good" },
  validate: { label: "Validate first", hint: "Could matter a lot, but the evidence is thin or split: test it cheaply with real customers.", className: "text-warn" },
  park: { label: "Park", hint: "Weak support for now.", className: "text-muted" },
} as const;

export function TrackBadge({ track }: { track?: RankedFeature["track"] }) {
  if (!track) return null;
  const t = TRACKS[track];
  return (
    <span className={`badge badge-dot ml-2 ${t.className}`} title={t.hint}>
      {t.label}
    </span>
  );
}

/** Splits the ranking into what to build, what to test first and what to park. */
export function Portfolio({ ranking }: { ranking: RankedFeature[] }) {
  if (!ranking.some((r) => r.track)) return null;
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {(Object.keys(TRACKS) as (keyof typeof TRACKS)[]).map((key) => {
        const items = ranking.filter((r) => r.track === key);
        const t = TRACKS[key];
        return (
          <div key={key} className="rounded-lg border border-border p-4 text-sm">
            <h3 className={`font-semibold ${t.className}`}>
              {t.label} <span className="num font-normal text-muted">({items.length})</span>
            </h3>
            <p className="hint mt-0.5">{t.hint}</p>
            {items.length > 0 ? (
              <ul className="mt-3 space-y-3">
                {items.map((r) => (
                  <li key={r.featureId}>
                    <p className="font-medium">
                      <span className="num text-muted">{r.rank}.</span> {r.title}
                    </p>
                    {key === "validate" && r.experiment?.trim() && (
                      <div className="mt-1 text-muted">
                        <span className="text-text">Test:</span> <Markdown inline>{r.experiment}</Markdown>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint mt-3">None</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The diverge phase: what each explorer proposed and which ideas were parked. */
export function ExplorationPanel({ run }: { run: Run }) {
  const lenses = run.exploration ?? [];
  if (!lenses.length) return null;
  const shortlisted = new Set(run.rounds[0]?.features.flatMap((f) => f.origins ?? []) ?? []);
  const total = lenses.reduce((a, e) => a + e.ideas.length, 0);
  return (
    <details className="card">
      <summary className="cursor-pointer font-semibold">
        Exploration ({total} ideas from {lenses.filter((e) => !e.error).length} explorers, {shortlisted.size} used in round 1)
      </summary>
      <div className="mt-3 grid gap-4 text-sm md:grid-cols-2">
        {lenses.map((e) => (
          <div key={e.lens} className="rounded-lg border border-border p-4">
            <h3 className="font-semibold">{e.label}</h3>
            {e.error ? (
              <p className="mt-1 text-bad">Failed: {e.error}</p>
            ) : (
              <>
                <p className="mt-1 text-muted">{e.notes}</p>
                <ul className="mt-3 space-y-2">
                  {e.ideas.map((i) => (
                    <li key={i.id}>
                      <p className="font-medium">
                        <span className="num text-muted">{i.id}</span> {i.title}
                        {shortlisted.has(i.id) ? <span className="badge ml-2 text-good">Shortlisted</span> : <span className="badge ml-2">Parked</span>}
                      </p>
                      <p className="text-muted">{i.description}</p>
                      {!shortlisted.has(i.id) && run.parked?.find((x) => x.ideaId === i.id) && (
                        <p className="hint">Parked: {run.parked.find((x) => x.ideaId === i.id)!.reason}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}
