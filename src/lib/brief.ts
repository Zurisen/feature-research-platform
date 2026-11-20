import { finalPoints, finalScores, type Feature, type Project, type RankedFeature, type Run } from "./types";

/**
 * Builds a self-contained Markdown brief for one ranked feature, meant to be pasted into a Claude Code
 * session opened in the repository where the feature will be built.
 */

const EFFORT_MONTHS: Record<string, number> = { xs: 1, s: 3, m: 5, l: 8, xl: 13 };

function latestFeature(run: Run, featureId: string): Feature | undefined {
  for (let i = run.rounds.length - 1; i >= 0; i--) {
    const f = run.rounds[i].features.find((x) => x.id === featureId);
    if (f) return f;
  }
}

/** The last round that included the feature, so the lead feedback matches the version that was ranked. */
function latestRound(run: Run, featureId: string) {
  for (let i = run.rounds.length - 1; i >= 0; i--) {
    if (run.rounds[i].features.some((x) => x.id === featureId)) return run.rounds[i];
  }
}

const pct = (x: number | null | undefined) => (x == null ? "n/a" : `${Math.round(x * 100)}%`);
const quote = (s: string) => s.trim().split(/\r?\n/).map((l) => `> ${l}`).join("\n");

export function featureBrief(run: Run, project: Project | null, featureId: string, opts: { projectContext?: boolean } = {}): string {
  const withContext = opts.projectContext ?? true;
  const r = run.ranking?.find((x) => x.featureId === featureId);
  const f = latestFeature(run, featureId);
  const round = latestRound(run, featureId);
  const title = r?.title ?? f?.title ?? featureId;
  const leads = project?.leads ?? [];
  const leadName = (id: string) => {
    const l = leads.find((x) => x.id === id);
    if (!l) return "A lead";
    const who = l.name || l.title || "Lead";
    // Skip parts the name already contains, since lead names are often descriptive labels.
    const has = (s: string) => who.toLowerCase().includes(s.toLowerCase());
    const where = [l.name && l.title && !has(l.title) ? l.title : "", l.company && !has(l.company) ? l.company : ""].filter(Boolean).join(", ");
    return where ? `${who} (${where})` : who;
  };
  const out: string[] = [];

  out.push(`# Feature brief: ${title}`);
  out.push(
    `Exported from Feature Research Platform${project ? `, project "${project.name}"` : ""}, run ${run.id} (${new Date(run.finishedAt ?? run.createdAt).toISOString().slice(0, 10)}). ` +
      "The lead feedback below comes from AI agents simulating prospects from their profiles, not from interviews, so treat it as a hypothesis to validate.",
  );

  out.push("## How to use this brief");
  out.push(
    [
      "You are working in the repository where this feature will be built.",
      "1. Read this brief, then explore the codebase to find where the feature fits and what already exists that it can reuse.",
      "2. Before writing code, propose an implementation plan: the components you would change or add, the data it needs, and how you would test it.",
      "3. Draft acceptance criteria from the problem, the lead feedback and the concerns below, and list the open questions this brief does not settle. Confirm them with me before you start.",
      "4. Keep the first version to the smallest scope that solves the problem for the target users; note anything you deliberately left out.",
    ].join("\n"),
  );

  out.push("## The feature");
  if (f) {
    out.push(f.description);
    out.push(`- **Problem it solves:** ${f.problem}`);
    out.push(`- **For:** ${f.targetUsers}`);
    out.push(`- **Rough size (developer agent's guess):** ${f.effort}${r?.effort ? `, about ${EFFORT_MONTHS[r.effort] ?? "?"} person-months in the RICE estimate` : ""}`);
  } else {
    out.push("_The feature's description was not found in the run._");
  }

  if (r) {
    out.push("## Why it is prioritised");
    const total = run.ranking?.length ?? 0;
    out.push(
      [
        `- **Rank:** ${r.rank} of ${total}${r.draftRank != null && r.draftRank !== r.rank ? ` (was ${r.draftRank} before the sceptic's review)` : ""}${r.quarter ? `, planned for quarter ${r.quarter}` : ""}`,
        `- **RICE score:** ${r.rice} (reach ${r.reach}, impact ${r.impact}, confidence ${r.confidence}, effort ${r.effort})`,
        `- **Lead support:** average score ${r.avgLeadScore != null ? `${r.avgLeadScore}/5` : "n/a"}, ${pct(r.pointsShare)} of the leads' budget points, top pick for ${pct(r.firstChoiceShare)} of leads`,
        r.champions.length ? `- **Wanted most by:** ${r.champions.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    if (r.rationale.trim()) out.push(r.rationale.trim());
  }

  const reactions = (round?.feedback ?? [])
    .filter((fb) => !fb.error)
    .map((fb) => {
      const item = fb.items.find((i) => i.featureId === featureId);
      if (!item) return null;
      return {
        lead: leadName(fb.leadId),
        first: item.score,
        score: finalScores(fb).get(featureId) ?? item.score,
        points: finalPoints(fb).get(featureId),
        wouldUse: item.wouldUse,
        comment: item.comment,
        later: fb.rebuttal?.revised.find((x) => x.featureId === featureId)?.comment,
        topPick: fb.topPick === featureId,
      };
    })
    .filter((x) => x !== null)
    .sort((a, b) => b.score - a.score);

  if (reactions.length) {
    out.push(`## What the leads said${round && run.rounds.length > 1 ? ` (round ${round.round})` : ""}`);
    out.push(
      reactions
        .map((x) => {
          const head = [
            x.first !== x.score ? `${x.first}→${x.score}/5` : `${x.score}/5`,
            x.points != null ? `${Math.round(x.points * 10) / 10} of 10 points` : "",
            x.wouldUse ? "would use it" : "would not use it",
            x.topPick ? "**top pick**" : "",
          ]
            .filter(Boolean)
            .join(", ");
          return `- **${x.lead}** (${head}): ${x.comment}${x.later ? `\n  - After hearing the others: ${x.later}` : ""}`;
        })
        .join("\n"),
    );
  }

  const challenges = run.critique?.challenges.filter((c) => c.featureId === featureId) ?? [];
  if (r?.concerns?.trim() || challenges.length) {
    out.push("## Risks and open questions");
    const lines: string[] = [];
    if (r?.concerns?.trim()) lines.push(`- **Concerns raised:** ${r.concerns.trim()}`);
    for (const c of challenges) lines.push(`- **Sceptic (${c.kind}, ${c.severity}):** ${c.issue} _Suggested:_ ${c.suggestion}`);
    out.push(lines.join("\n"));
  }

  const guidance = (run.notes ?? []).filter((n) => n.status === "ready" && n.brief?.forDeveloper.trim());
  if (guidance.length) {
    out.push("## Guidance from the product owner during the run");
    out.push(guidance.map((n) => `- ${n.brief!.forDeveloper.trim()}`).join("\n"));
  }

  if (withContext && project) {
    out.push("## Product context");
    const b = project.business;
    out.push(`**${b.name}**${b.website ? ` (${b.website})` : ""}${b.industry ? `, ${b.industry}` : ""}`);
    out.push(b.description.trim());
    if (project.focusArea.trim()) out.push(`**Area being developed:** ${project.focusArea.trim()}`);
    if (project.extraContext.trim()) {
      out.push("**Background notes from the product owner:**");
      out.push(quote(project.extraContext));
    }
  }

  return out.join("\n\n") + "\n";
}

/** All ranked features in rank order, as one document, with the product context once at the end. */
export function allBriefs(run: Run, project: Project | null): string {
  const ranking: RankedFeature[] = run.ranking ?? [];
  const parts = ranking.map((r) => featureBrief(run, project, r.featureId, { projectContext: false }).replace(/^# /, "# " + `${r.rank}. `));
  if (project) {
    const ctx = featureBrief(run, project, ranking[0]?.featureId ?? "", { projectContext: true });
    const i = ctx.indexOf("## Product context");
    if (i >= 0) parts.push("# Product context (applies to every feature above)\n\n" + ctx.slice(i + "## Product context".length).trimStart());
  }
  return parts.join("\n---\n\n");
}

export function briefFileName(project: Project | null, title: string) {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return `${project ? slug(project.name) + "-" : ""}${slug(title) || "feature"}.md`;
}
