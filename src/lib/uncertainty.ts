import { builtInRice, EFFORT_MONTHS } from "./toolkit";
import { finalScores, type RankedFeature, type RankingOutput, type RunRound } from "./types";

// How sure can we be of a ranking built on five or so simulated leads? Resample the leads with
// replacement (a bootstrap), recompute every feature's lead support for each resample, and see how
// far scores and ranks move. The final order uses the pessimistic end of each feature's range, so a
// feature only ranks high if it still looks good when the leads who liked it least are the ones that
// count. A seeded generator keeps the numbers stable when the page reloads.

const SAMPLES = 2000;
const LOW = 0.1; // the range shown is the 10th to 90th percentile
const HIGH = 0.9;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const quantile = (sorted: number[], q: number) => {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};

const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;

/** Final 1–5 scores per lead, one row per lead that responded: featureId -> score. */
function leadRows(round: RunRound) {
  return round.feedback.filter((f) => !f.error).map((f) => finalScores(f));
}

export type LeadEvidence = {
  n: number; // leads who scored it
  mean: number | null;
  low: number | null; // 10th percentile of the mean across resamples
  high: number | null;
  spread: number | null; // standard deviation of the individual scores: how much the leads disagree
};

/** How much lead support each feature has, with the range it could plausibly have had. */
export function leadEvidence(round: RunRound, featureIds: string[], seed = 1): Map<string, LeadEvidence> {
  const rows = leadRows(round);
  const next = rng(seed);
  const out = new Map<string, LeadEvidence>();
  for (const id of featureIds) {
    const scores = rows.map((r) => r.get(id)).filter((x): x is number => x !== undefined);
    if (!scores.length) {
      out.set(id, { n: 0, mean: null, low: null, high: null, spread: null });
      continue;
    }
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const sd = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length);
    const means: number[] = [];
    for (let b = 0; b < SAMPLES; b++) {
      let s = 0;
      for (let k = 0; k < scores.length; k++) s += scores[Math.floor(next() * scores.length)];
      means.push(s / scores.length);
    }
    means.sort((a, b) => a - b);
    out.set(id, { n: scores.length, mean: round2(mean), low: round2(quantile(means, LOW)), high: round2(quantile(means, HIGH)), spread: round2(sd) });
  }
  return out;
}

export type UncertainScore = {
  riceLow: number;
  riceHigh: number;
  rankLow: number; // best rank seen in most resamples (10th percentile)
  rankHigh: number; // worst rank seen in most resamples (90th percentile)
  pTop: number; // share of resamples in which it lands in the top 3
};

/**
 * Re-ranks the features under resampled lead panels. RICE uses the developer agent's inputs, which
 * rest on the leads' support, so each resample scales a feature's RICE by how its mean lead score
 * moved. Resampling whole leads (not each feature separately) keeps the ranks consistent with each other.
 */
export function uncertainRice(
  round: RunRound,
  rice: Map<string, number>,
  seed = 1,
  ratios?: { k: number; byFeature: Map<string, number[]> },
): Map<string, UncertainScore> {
  const ids = [...rice.keys()];
  const rows = leadRows(round);
  const means = new Map<string, number>();
  for (const id of ids) {
    const s = rows.map((r) => r.get(id)).filter((x): x is number => x !== undefined);
    if (s.length) means.set(id, s.reduce((a, b) => a + b, 0) / s.length);
  }
  const values = new Map(ids.map((id) => [id, [] as number[]]));
  const ranks = new Map(ids.map((id) => [id, [] as number[]]));
  const next = rng(seed);

  for (let b = 0; b < SAMPLES && rows.length; b++) {
    const sample = Array.from({ length: rows.length }, () => rows[Math.floor(next() * rows.length)]);
    // One of the independent estimates, picked for the whole panel so the features move together.
    const k = ratios && ratios.k > 1 ? Math.floor(next() * ratios.k) : -1;
    const scored = ids.map((id) => {
      const base = (rice.get(id)! * (k >= 0 ? (ratios!.byFeature.get(id)?.[k] ?? 1) : 1));
      const m = means.get(id);
      if (m === undefined) return { id, v: base };
      const s = sample.map((r) => r.get(id)).filter((x): x is number => x !== undefined);
      // A resample can miss every lead who scored a feature; it then keeps its full-panel mean.
      const mb = s.length ? s.reduce((a, c) => a + c, 0) / s.length : m;
      return { id, v: (base * mb) / m };
    });
    scored.forEach((x) => values.get(x.id)!.push(x.v));
    [...scored].sort((a, b2) => b2.v - a.v).forEach((x, i) => ranks.get(x.id)!.push(i + 1));
  }

  const out = new Map<string, UncertainScore>();
  for (const id of ids) {
    const v = values.get(id)!.sort((a, b) => a - b);
    const r = ranks.get(id)!.sort((a, b) => a - b);
    const base = rice.get(id)!;
    if (!v.length) {
      out.set(id, { riceLow: base, riceHigh: base, rankLow: 0, rankHigh: 0, pTop: 0 });
      continue;
    }
    out.set(id, {
      riceLow: round2(quantile(v, LOW)),
      riceHigh: round2(quantile(v, HIGH)),
      rankLow: Math.round(quantile(r, LOW)),
      rankHigh: Math.round(quantile(r, HIGH)),
      pTop: round2(r.filter((x) => x <= 3).length / r.length),
    });
  }
  return out;
}

/** Lays features out quarter by quarter in the given order, the way rice_prioritizer.py does. */
export function planQuarters(order: { id: string; effort: string }[], capacity: number): Map<string, number> {
  const out = new Map<string, number>();
  let quarter = 1;
  let used = 0;
  for (const f of order) {
    const effort = EFFORT_MONTHS[f.effort] ?? 5;
    if (used + effort > capacity && used > 0) {
      quarter += 1;
      used = 0;
    }
    used += effort;
    out.set(f.id, quarter);
  }
  return out;
}

/** Plain-text table of lead support for the developer agent's ranking prompt. */
export function evidenceTable(round: RunRound, evidence: Map<string, LeadEvidence>) {
  return round.features
    .map((f) => {
      const e = evidence.get(f.id);
      if (!e || e.mean === null) return `- ${f.id} ${f.title}: no lead scores`;
      return `- ${f.id} ${f.title}: mean ${round1(e.mean)}/5 from ${e.n} leads, likely range ${round1(e.low!)}–${round1(e.high!)}, disagreement (std dev) ${round1(e.spread!)}`;
    })
    .join("\n");
}

/** A stable seed from the run id, so reloading a run gives the same ranges. */
export function seedFrom(id: string) {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

type Row = RankingOutput["ranked"][number];
/** The highest RICE any independent estimate gave each feature. */
export function estimateCeiling(samples: Row[][] | undefined) {
  const out = new Map<string, number>();
  for (const s of samples ?? []) for (const r of s) out.set(r.featureId, Math.max(out.get(r.featureId) ?? 0, riceOf(r)));
  return out;
}

export const riceOf = (r: Row) => builtInRice({ id: r.featureId, name: r.featureId, reach: r.reach, impact: r.impact, confidence: r.confidence, effort: r.effort });

/**
 * Combines independent draft estimates. For each feature it keeps the estimate with the median RICE
 * (so the inputs, rationale and track stay consistent with each other) and records how far each
 * estimate was from that median. Returns the index of the estimate that supplied most rows, whose
 * summary is used.
 */
export function combineEstimates(samples: Row[][], featureIds: string[]) {
  const picks = new Array(samples.length).fill(0);
  const ranked: Row[] = [];
  for (const id of featureIds) {
    const rows = samples.map((s, i) => ({ i, row: s.find((r) => r.featureId === id) })).filter((x): x is { i: number; row: Row } => !!x.row);
    if (!rows.length) continue;
    const sorted = [...rows].sort((a, b) => riceOf(a.row) - riceOf(b.row));
    const mid = sorted[Math.floor((sorted.length - 1) / 2)];
    picks[mid.i] += 1;
    ranked.push(mid.row);
  }
  return { ranked, best: picks.indexOf(Math.max(...picks)) };
}

/** Each estimate's RICE for every feature, and its ratio to the median. */
export function estimateSpread(samples: Row[][] | undefined, featureIds: string[]) {
  const rice = new Map<string, number[]>();
  const byFeature = new Map<string, number[]>();
  if (!samples || samples.length < 2) return { k: 1, rice, byFeature };
  for (const id of featureIds) {
    const values = samples.map((s) => {
      const r = s.find((x) => x.featureId === id);
      return r ? riceOf(r) : null;
    });
    const known = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
    if (!known.length) continue;
    const median = quantile(known, 0.5);
    rice.set(id, known.map(round2));
    byFeature.set(id, values.map((v) => (v === null || median <= 0 ? 1 : v / median)));
  }
  return { k: samples.length, rice, byFeature };
}

/**
 * Adds score and rank ranges, reorders by the pessimistic end of each range, and lays out the
 * quarters again in that order. Parked features are left out of the quarter plan.
 */
export function applyUncertainty(
  ranking: RankedFeature[],
  round: RunRound,
  estimates: Row[][] | undefined,
  capacity: number,
  seed: number,
): RankedFeature[] {
  const ids = ranking.map((r) => r.featureId);
  const spread = estimateSpread(estimates, ids);
  const evidence = leadEvidence(round, ids, seed);
  const u = uncertainRice(round, new Map(ranking.map((r) => [r.featureId, r.rice])), seed, spread);
  const withRanges = ranking.map((r) => {
    const x = u.get(r.featureId);
    const e = evidence.get(r.featureId);
    return {
      ...r,
      riceLow: x?.riceLow ?? r.rice,
      riceHigh: x?.riceHigh ?? r.rice,
      rankLow: x?.rankLow,
      rankHigh: x?.rankHigh,
      pTop: x?.pTop,
      leadLow: e?.low ?? null,
      leadHigh: e?.high ?? null,
      estimateRice: spread.rice.get(r.featureId),
    };
  });
  withRanges.sort((a, b) => b.riceLow - a.riceLow || b.rice - a.rice);
  const quarters = planQuarters(
    withRanges.filter((r) => r.track !== "park").map((r) => ({ id: r.featureId, effort: r.effort })),
    capacity,
  );
  return withRanges.map((r, i) => ({ ...r, rank: i + 1, quarter: quarters.get(r.featureId) ?? null }));
}
