import { z } from "zod";
import { AgentSkills, runAgent } from "./engine";
import {
  BRIEF_SKILLS,
  BRIEF_SYSTEM,
  briefPrompt,
  DEVELOPER_SKILLS,
  DEVELOPER_SYSTEM,
  leadPrompt,
  leadSystem,
  rankingPrompt,
  rebuttalPrompt,
  researchPrompt,
  revisionPrompt,
} from "./prompts";
import { getRun, newId, saveRun } from "./store";
import { builtInRice, EFFORT_MONTHS, runToolkit, ToolkitFeature, ToolkitResult } from "./toolkit";
import {
  Feature,
  finalScores,
  Lead,
  LeadFeedback,
  LeadFeedbackOutputSchema,
  PersonaBriefSchema,
  Project,
  RankedFeature,
  RankingOutput,
  RankingOutputSchema,
  RebuttalOutputSchema,
  ResearchOutputSchema,
  RevisionOutputSchema,
  Run,
  RunEvent,
  RunInsights,
  RunRound,
  Settings,
} from "./types";

// Run flow:
//   persona briefs (optional) -> developer researches
//   -> [leads give positions -> leads react to each other (optional) -> developer revises] x rounds
//   -> feedback text analysis + developer gives RICE inputs -> script scores and lays out the roadmap.
// Runs execute in this Node process and are persisted to data/runs after every step; the UI polls.

const g = globalThis as unknown as { __frpActive?: Map<string, AbortController> };
const active = (g.__frpActive ??= new Map());

export const isActive = (id: string) => active.has(id);

export function cancelRun(id: string) {
  active.get(id)?.abort();
}

/** Marks a run that was left "running" by a server restart as failed. */
export async function reconcile(run: Run): Promise<Run> {
  if (run.status === "running" && !isActive(run.id)) {
    run.status = "failed";
    run.error = "The server restarted while this run was in progress.";
    run.finishedAt = new Date().toISOString();
    await saveRun(run);
  }
  return run;
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

export async function startRun(project: Project, settings: Settings): Promise<Run> {
  const run: Run = {
    id: newId(),
    projectId: project.id,
    status: "running",
    phase: "Starting",
    settings,
    createdAt: new Date().toISOString(),
    rounds: [],
    costUsd: 0,
    events: [],
  };
  await saveRun(run);
  const controller = new AbortController();
  active.set(run.id, controller);
  void execute(run, project, controller.signal).finally(() => active.delete(run.id));
  return run;
}

const DEV_SKILLS: AgentSkills = { plugin: "product-management", names: DEVELOPER_SKILLS };
const SALES_SKILLS: AgentSkills = { plugin: "sales", names: BRIEF_SKILLS };
const leadLabel = (l: Lead) => l.name || l.title || "Lead";

async function execute(run: Run, project: Project, signal: AbortSignal) {
  const s = run.settings;
  const save = () => saveRun(run);
  const log = (agent: string, kind: RunEvent["kind"], text: string) => {
    run.events.push({ ts: new Date().toISOString(), agent, kind, text });
    void save();
  };
  const phase = (text: string) => {
    run.phase = text;
    log("system", "status", text);
  };
  const call = async <T,>(opts: {
    agent: string;
    system: string;
    prompt: string;
    schema: z.ZodType<T>;
    model: string;
    web?: boolean;
    skills?: AgentSkills;
  }) => {
    const r = await runAgent<T>({
      ...opts,
      authMode: s.authMode,
      signal,
      onActivity: (t) => log(opts.agent, "activity", t),
    });
    run.costUsd += r.costUsd;
    return r.data;
  };
  const developer = <T,>(prompt: string, schema: z.ZodType<T>, web = false) =>
    call({ agent: "developer", system: DEVELOPER_SYSTEM, prompt, schema, model: s.developerModel, web, skills: DEV_SKILLS });

  /** Runs one step for every lead in parallel; a single lead failing does not sink the step. */
  const eachLead = (leads: Lead[], what: string, fn: (lead: Lead) => Promise<void>) =>
    mapLimit(leads, s.concurrency, async (lead) => {
      try {
        await fn(lead);
      } catch (e) {
        if (signal.aborted) throw e;
        log(leadLabel(lead), "error", `${what} failed: ${(e as Error).message}`);
      }
      await save();
    });

  try {
    // 0. Persona briefs
    run.briefs = {};
    if (s.personaBriefs) {
      phase(`Researching ${project.leads.length} leads to build persona briefs`);
      await eachLead(project.leads, "Persona brief", async (lead) => {
        run.briefs![lead.id] = await call({
          agent: `${leadLabel(lead)} (brief)`,
          system: BRIEF_SYSTEM,
          prompt: briefPrompt(project, lead, s.webResearch),
          schema: PersonaBriefSchema,
          model: s.developerModel,
          web: s.webResearch,
          skills: SALES_SKILLS,
        });
        log(leadLabel(lead), "status", `Persona brief ready (${run.briefs![lead.id].buyingRole}, ${run.briefs![lead.id].fit} fit)`);
      });
    }

    // 1. Research
    phase(`Developer agent is researching${s.webResearch ? " (with web search)" : ""}`);
    const research = await developer(researchPrompt(project, s.webResearch, run.briefs), ResearchOutputSchema, s.webResearch);
    run.research = research.researchSummary;
    let features: Feature[] = research.features;
    let noteToLeads: string | undefined;
    let changelog: string | undefined;
    log("developer", "status", `Proposed ${features.length} candidate features`);

    // 2. Feedback rounds
    for (let r = 1; r <= s.rounds; r++) {
      const round: RunRound = { round: r, features, noteToLeads, changelog, feedback: [] };
      run.rounds.push(round);
      const previousRound = run.rounds[r - 2];
      const known = new Set(features.map((f) => f.id));
      const leadCall = <T,>(lead: Lead, prompt: string, schema: z.ZodType<T>) =>
        call({ agent: leadLabel(lead), system: leadSystem(project, lead, run.briefs?.[lead.id]), prompt, schema, model: s.leadModel });

      // 2a. Positions: each lead reacts on their own.
      phase(`Round ${r} of ${s.rounds}: ${project.leads.length} lead agents are reviewing the features`);
      await mapLimit(project.leads, s.concurrency, async (lead) => {
        let fb: LeadFeedback;
        try {
          const data = await leadCall(
            lead,
            leadPrompt(round, previousRound?.feedback.find((f) => f.leadId === lead.id && !f.error)),
            LeadFeedbackOutputSchema,
          );
          fb = { ...data, items: data.items.filter((i) => known.has(i.featureId)), leadId: lead.id };
          log(leadLabel(lead), "status", `Gave feedback on ${fb.items.length} features, top pick ${fb.topPick}`);
        } catch (e) {
          if (signal.aborted) throw e;
          fb = { leadId: lead.id, items: [], missing: [], overall: "", topPick: "", adoptionLikelihood: 1, quote: "", error: (e as Error).message };
          log(leadLabel(lead), "error", `Feedback failed: ${fb.error}`);
        }
        round.feedback.push(fb);
        await save();
      });
      const responded = round.feedback.filter((f) => !f.error);
      if (responded.length === 0) throw new Error("Every lead agent failed in this round; see the activity log.");

      // 2b. Rebuttal: each lead sees the others' positions and may revise.
      if (s.debate && responded.length > 1) {
        phase(`Round ${r} of ${s.rounds}: leads are reacting to each other's feedback`);
        const positions: RunRound = { ...round, feedback: responded.map((f) => ({ ...f })) }; // snapshot, so every lead sees first positions
        await eachLead(
          project.leads.filter((l) => responded.some((f) => f.leadId === l.id)),
          "Rebuttal",
          async (lead) => {
            const own = round.feedback.find((f) => f.leadId === lead.id)!;
            const data = await leadCall(lead, rebuttalPrompt(positions, own, project.leads), RebuttalOutputSchema);
            own.rebuttal = { ...data, revised: data.revised.filter((x) => known.has(x.featureId)) };
            const n = own.rebuttal.revised.length;
            log(leadLabel(lead), "status", n ? `Revised or pushed back on ${n} feature${n > 1 ? "s" : ""}` : "Held their position");
          },
        );
      }

      // 2c. Revision
      if (r < s.rounds) {
        phase(`Developer agent is revising the features after round ${r}`);
        const rev = await developer(revisionPrompt(project, round), RevisionOutputSchema);
        features = rev.features;
        noteToLeads = rev.noteToLeads;
        changelog = rev.changelog;
        log("developer", "status", `Revised the list to ${features.length} features`);
      }
    }

    // 3. Ranking
    const last = run.rounds[run.rounds.length - 1];
    phase("Analysing the feedback text");
    const interviews = last.feedback
      .filter((f) => !f.error)
      .map((f) => ({
        id: f.leadId,
        text: [f.overall, f.quote, ...f.items.map((i) => i.comment), ...f.missing, f.rebuttal?.closing ?? "", ...(f.rebuttal?.revised.map((x) => x.comment) ?? [])].join(". "),
      }));
    const textAnalysis = await runToolkit({ features: [], capacity: s.teamCapacity, interviews });
    if (!textAnalysis.result) log("system", "status", `Feedback text analysis skipped: ${textAnalysis.reason}`);
    const insights = textInsights(textAnalysis.result);

    phase("Developer agent is ranking the features");
    const ranking = await developer(rankingPrompt(project, run.rounds, insights, s.teamCapacity), RankingOutputSchema);
    const scored = await scoreRanking(ranking.ranked, last, s.teamCapacity);
    if (scored.note) log("system", "status", scored.note);
    run.ranking = scored.ranking;
    const adoption = last.feedback.filter((f) => !f.error).map((f) => f.adoptionLikelihood);
    run.insights = {
      ...insights,
      ...scored.portfolio,
      meanAdoption: adoption.length ? Math.round((adoption.reduce((a, b) => a + b, 0) / adoption.length) * 10) / 10 : null,
    };
    run.summary = ranking.summary;
    run.status = "completed";
    phase("Completed");
  } catch (e) {
    if (signal.aborted) {
      run.status = "cancelled";
      run.phase = "Cancelled";
      log("system", "status", "Run cancelled");
    } else {
      run.status = "failed";
      run.error = (e as Error).message;
      run.phase = "Failed";
      log("system", "error", run.error);
    }
  } finally {
    run.finishedAt = new Date().toISOString();
    await save();
  }
}

const FILLER = new Set(["would", "could", "should", "there", "their", "these", "those", "which", "while", "about", "without", "where", "still", "being", "because", "already", "every", "other", "after", "before"]);

function textInsights(result: ToolkitResult | null): Pick<RunInsights, "themes" | "sentiment" | "painPoints" | "requests"> {
  const agg = result?.interviews?.aggregate;
  const flat = (o?: Record<string, string[]>) => [...new Set(Object.values(o ?? {}).flat())].slice(0, 10);
  return {
    // The script counts frequent words; drop the ones that carry no meaning on their own.
    themes: Object.entries(agg?.top_themes ?? {})
      .filter(([name]) => name.length > 4 && !FILLER.has(name))
      .map(([name, count]) => ({ name, count })),
    sentiment: agg?.overall_sentiment ?? null,
    painPoints: flat(agg?.common_pain_points),
    requests: flat(agg?.common_requests),
  };
}

/** Scores the developer agent's RICE inputs with rice_prioritizer.py, or the built-in equivalent without Python. */
async function scoreRanking(ranked: RankingOutput["ranked"], last: RunRound, capacity: number) {
  const rows = ranked.filter((r) => last.features.some((f) => f.id === r.featureId));
  const inputs: ToolkitFeature[] = rows.map((r) => ({
    id: r.featureId,
    name: last.features.find((f) => f.id === r.featureId)!.title,
    reach: r.reach,
    impact: r.impact,
    confidence: r.confidence,
    effort: r.effort,
  }));
  const { result, reason } = await runToolkit({ features: inputs, capacity, interviews: [] });
  const rice = new Map<string, number>();
  const quarter = new Map<string, number>();
  let order: string[];
  let portfolio: Pick<RunInsights, "scoredBy" | "quickWins" | "bigBets" | "totalEffortMonths">;

  if (result?.rice) {
    order = result.rice.features.map((f) => f.id);
    result.rice.features.forEach((f) => rice.set(f.id, f.rice_score));
    result.rice.roadmap.forEach((q) => q.features.forEach((f) => quarter.set(f.id, q.quarter)));
    portfolio = {
      scoredBy: "rice_prioritizer.py",
      quickWins: (result.rice.analysis.quick_wins_list ?? []).map((f) => f.id),
      bigBets: (result.rice.analysis.big_bets_list ?? []).map((f) => f.id),
      totalEffortMonths: result.rice.analysis.total_effort_months ?? 0,
    };
  } else {
    inputs.forEach((f) => rice.set(f.id, builtInRice(f)));
    order = [...inputs].sort((a, b) => rice.get(b.id)! - rice.get(a.id)!).map((f) => f.id);
    const strong = (f: ToolkitFeature) => f.impact === "massive" || f.impact === "high";
    portfolio = {
      scoredBy: "built-in",
      quickWins: inputs.filter((f) => strong(f) && (f.effort === "xs" || f.effort === "s")).map((f) => f.id),
      bigBets: inputs.filter((f) => strong(f) && (f.effort === "l" || f.effort === "xl")).map((f) => f.id),
      totalEffortMonths: inputs.reduce((a, f) => a + (EFFORT_MONTHS[f.effort] ?? 5), 0),
    };
  }

  const responded = last.feedback.filter((f) => !f.error);
  const ranking: RankedFeature[] = order.map((id, i) => {
    const row = rows.find((r) => r.featureId === id)!;
    const scores = responded.map((f) => finalScores(f).get(id)).filter((x): x is number => x !== undefined);
    return {
      ...row,
      rank: i + 1,
      title: inputs.find((f) => f.id === id)!.name,
      rice: rice.get(id) ?? 0,
      avgLeadScore: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
      firstChoiceShare: responded.length ? responded.filter((f) => f.topPick === id).length / responded.length : 0,
      quarter: quarter.get(id) ?? null,
    };
  });
  return { ranking, portfolio, note: result?.rice ? undefined : `Scored with the built-in RICE formula: ${reason}` };
}

export async function loadRun(id: string) {
  const run = await getRun(id);
  return run ? reconcile(run) : null;
}
