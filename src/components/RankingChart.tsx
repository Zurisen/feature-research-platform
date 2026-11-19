"use client";

import { motion } from "motion/react";
import type { RankedFeature } from "@/lib/types";

// Two measures with different scales, so two side-by-side bar panels sharing the feature rows
// (never one chart with two axes). One hue per panel; values sit at the bar tips in text colour.
// The table below the chart is the full table view of the same data.

function Bar({ value, max, color, label, delay }: { value: number; max: number; color: string; label: string; delay: number }) {
  const pct = max > 0 ? Math.max((value / max) * 100, value > 0 ? 1.5 : 0) : 0;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="h-3.5 min-w-0 flex-1 border-l border-border-strong">
        <motion.div
          className="h-full rounded-r-[4px]"
          style={{ background: color, width: `${pct}%`, transformOrigin: "left" }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ type: "spring", stiffness: 120, damping: 22, delay }}
        />
      </div>
      <span className="num w-10 shrink-0 text-right text-xs text-muted">{label}</span>
    </div>
  );
}

export default function RankingChart({ ranking }: { ranking: RankedFeature[] }) {
  const maxRice = Math.max(...ranking.map((r) => r.rice), 0);
  const hasBudget = ranking.some((r) => r.pointsShare != null);
  const maxShare = Math.max(...ranking.map((r) => r.pointsShare ?? 0), 0);
  const cols = hasBudget ? "grid-cols-[1.25rem_minmax(0,1fr)_minmax(0,1fr)] sm:grid-cols-[1.5rem_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]" : "grid-cols-[1.5rem_minmax(0,1fr)_minmax(0,1.4fr)]";

  return (
    <figure>
      <figcaption className="sr-only">
        Features by RICE score{hasBudget ? " and by the share of the leads' budget points spent on each" : ""}. The table below has the same values.
      </figcaption>
      <div className={`grid ${cols} items-center gap-x-3 gap-y-1 text-sm`}>
        <span />
        <span className="hint">Feature</span>
        <span className="hint flex items-center gap-1.5">
          <i aria-hidden="true" className="h-2 w-2 rounded-sm bg-viz-1" />
          RICE score
        </span>
        {hasBudget && (
          <span className="hint hidden items-center gap-1.5 sm:flex">
            <i aria-hidden="true" className="h-2 w-2 rounded-sm bg-viz-2" />
            Share of leads&apos; budget
          </span>
        )}
        {ranking.map((r, i) => (
          <div key={r.featureId} className="group relative col-span-full grid grid-cols-subgrid items-center rounded-md py-1.5 hover:bg-surface-2 focus-within:bg-surface-2" tabIndex={0}>
            <span className="num pl-1 text-muted">{r.rank}</span>
            <span className="truncate font-medium" title={r.title}>
              {r.title}
            </span>
            <Bar value={r.rice} max={maxRice} color="var(--viz-1)" label={String(r.rice)} delay={i * 0.04} />
            {hasBudget && (
              <div className="hidden sm:block">
                <Bar value={r.pointsShare ?? 0} max={maxShare} color="var(--viz-2)" label={`${Math.round((r.pointsShare ?? 0) * 100)}%`} delay={i * 0.04 + 0.05} />
              </div>
            )}
            <div
              role="tooltip"
              className="pointer-events-none absolute left-8 top-full z-10 hidden w-max max-w-xs rounded-lg border border-border bg-surface p-3 text-xs shadow-lg group-hover:block group-focus-within:block"
            >
              <p className="text-sm font-medium">{r.title}</p>
              <dl className="mt-1.5 grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5">
                <dt className="text-muted">RICE score</dt>
                <dd className="num text-right">{r.rice}</dd>
                <dt className="text-muted">Average lead score</dt>
                <dd className="num text-right">{r.avgLeadScore != null ? `${r.avgLeadScore}/5` : "–"}</dd>
                {r.pointsShare != null && (
                  <>
                    <dt className="text-muted">Share of budget points</dt>
                    <dd className="num text-right">{Math.round(r.pointsShare * 100)}%</dd>
                  </>
                )}
                <dt className="text-muted">First choice of</dt>
                <dd className="num text-right">{Math.round((r.firstChoiceShare ?? 0) * 100)}% of leads</dd>
                <dt className="text-muted">Reach · impact · confidence · effort</dt>
                <dd className="num text-right">
                  {r.reach} · {r.impact} · {r.confidence} · {String(r.effort ?? "–").toUpperCase()}
                </dd>
              </dl>
            </div>
          </div>
        ))}
      </div>
    </figure>
  );
}
