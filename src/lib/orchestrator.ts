import { z } from "zod";
import { AgentSkills, runAgent } from "./engine";
import {
  BRIEF_SKILLS,
  BRIEF_SYSTEM,
  briefPrompt,
  DEVELOPER_SKILLS,
  DEVELOPER_SYSTEM,
  guidanceBlock,
  leadPrompt,
  LIAISON_SYSTEM,
  liaisonPrompt,
  leadSystem,
  rankingPrompt,
  rebuttalPrompt,
  researchPrompt,
  revisionPrompt,
  SCEPTIC_SYSTEM,
  scepticPrompt,
} from "./prompts";
import { getProject, getRun, getSavedBriefs, newId, saveBrief, saveRun } from "./store";
import { builtInRice, EFFORT_MONTHS, runToolkit, ToolkitFeature, ToolkitResult } from "./toolkit";
import {
  CritiqueSchema,
  FinalRankingOutputSchema,
  finalPoints,
  finalScores,
  Lead,
  LeadFeedback,
  LeadFeedbackOutputSchema,
  NoteBriefSchema,
  PersonaBriefSchema,
  POINT_BUDGET,
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
  RunNote,
  RunRound,
  Settings,
  SettingsSchema,
} from "./types";

// Run flow:
//   persona briefs (optional, reused from earlier runs) -> developer researches
//   -> [leads give positions -> leads react to each other (optional) -> developer revises] x rounds
//   -> developer drafts the ranking -> sceptic challenges it (optional) -> developer finalises
//   -> script scores the inputs and lays out the roadmap.
//
// Every step is saved to data/runs as it finishes, and execute() only does the steps the saved run
// is still missing. That is what lets a failed or interrupted run resume, and a finished run take
// another round. Runs execute in this Node process; the UI polls.

const g = globalThis as unknown as { __frpActive?: Map<string, AbortController>; __frpLive?: Map<string, Run> };
const active = (g.__frpActive ??= new Map());
// The in-memory object of each run in progress. Anything that changes a running run (notes) must
// change this object, because the run loop saves it over the file after every step.
const live = (g.__frpLive ??= new Map());

export const isActive = (id: string) => active.has(id);

export function cancelRun(id: string) {
  active.get(id)?.abort();
}

/** A run left "running" by a server restart is marked failed; it can be resumed from its last saved step. */
export async function reconcile(run: Run): Promise<Run> {
  if (run.status === "running" && !isActive(run.id)) {
    run.status = "failed";
    run.error = "The server restarted while this run was in progress. Resume it to continue from the last completed step.";
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

function launch(run: Run, project: Project) {
  const controller = new AbortController();
  active.set(run.id, controller);
  live.set(run.id, run);
  void execute(run, project, controller.signal).finally(() => {
    active.delete(run.id);
    live.delete(run.id);
  });
}

async function mutateRun(id: string, fn: (run: Run) => void) {
  const run = live.get(id) ?? (await getRun(id));
  if (!run) return;
  fn(run);
  await saveRun(run);
}

/**
 * A note from the person watching the run. A liaison agent restates it with the run's context and
 * splits it by audience; the run loop then hands it to every later developer and lead step.
 */
export async function addNote(id: string, text: string): Promise<{ error?: string; note?: RunNote }> {
  const run = live.get(id) ?? (await getRun(id));
  if (!run) return { error: "Run not found." };
  const project = await getProject(run.projectId);
  if (!project) return { error: "The project for this run no longer exists." };
  const note: RunNote = { id: newId(), ts: new Date().toISOString(), text, status: "processing", usedIn: [] };
  const earlier = [...(run.notes ?? [])];
  (run.notes ??= []).push(note);
  run.events.push({ ts: note.ts, agent: "you", kind: "status", text: `Note: ${text.length > 140 ? `${text.slice(0, 140)}…` : text}` });
  await saveRun(run);

  void (async () => {
    try {
      const settings = SettingsSchema.parse(run.settings);
      const r = await runAgent({
        system: LIAISON_SYSTEM,
        prompt: liaisonPrompt(project, run, text, earlier),
        schema: NoteBriefSchema,
        model: settings.developerModel,
        authMode: settings.authMode,
        signal: new AbortController().signal,
      });
      await mutateRun(id, (cur) => {
        const n = cur.notes?.find((x) => x.id === note.id);
        if (!n) return;
        n.status = "ready";
        n.brief = r.data;
        cur.costUsd += r.costUsd;
        cur.events.push({ ts: new Date().toISOString(), agent: "liaison", kind: "status", text: `Passed on: ${r.data.interpretation}` });
      });
    } catch (e) {
      await mutateRun(id, (cur) => {
        const n = cur.notes?.find((x) => x.id === note.id);
        if (!n) return;
        n.status = "failed";
        n.error = (e as Error).message;
        cur.events.push({ ts: new Date().toISOString(), agent: "liaison", kind: "error", text: `Could not process the note: ${n.error}` });
      });
    }
  })();
  return { note };
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
  launch(run, project);
  return run;
}

/** Continues a failed or cancelled run from its last saved step, or adds one more feedback round to a finished run. */
export async function resumeRun(id: string, opts: { addRound?: boolean }): Promise<{ error?: string }> {
  if (isActive(id)) return { error: "This run is already in progress." };
  const run = await getRun(id);
  if (!run) return { error: "Run not found." };
  const project = await getProject(run.projectId);
  if (!project) return { error: "The project for this run no longer exists." };
  run.settings = SettingsSchema.parse(run.settings); // runs saved by older versions lack newer settings

  if (opts.addRound) {
    if (run.status !== "completed") return { error: "Only a completed run can take another round." };
    if (run.settings.rounds >= 5) return { error: "This run already has the maximum of 5 rounds." };
    run.settings.rounds += 1;
    // The ranking is redone after the extra round.
    delete run.ranking;
    delete run.draftRanking;
    delete run.critique;
    delete run.critiqueResponse;
    delete run.insights;
    delete run.summary;
  } else if (run.status !== "failed" && run.status !== "cancelled") {
    return { error: "Only a failed or cancelled run can be resumed." };
  }

  for (const round of run.rounds) round.feedback = round.feedback.filter((f) => !f.error); // failed leads get another try
  run.status = "running";
  delete run.error;
  delete run.finishedAt;
  run.events.push({
    ts: new Date().toISOString(),
    agent: "system",
    kind: "status",
    text: opts.addRound ? `Adding round ${run.settings.rounds}` : "Resuming from the last completed step",
  });
  await saveRun(run);
  launch(run, project);
  return {};
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
  /** The owner's notes that are ready for this audience, recorded as used by this step. */
  const guidance = (audience: "developer" | "leads", step: string) => {
    const ready = (run.notes ?? []).filter((n) => n.status === "ready" && n.brief);
    const block = guidanceBlock(ready, audience);
    if (block) {
      for (const n of ready) {
        const part = audience === "developer" ? n.brief!.forDeveloper : n.brief!.forLeads;
        if (part.trim() && !n.usedIn.includes(step)) n.usedIn.push(step);
      }
    }
    return block;
  };
  const developer = <T,>(step: string, prompt: string, schema: z.ZodType<T>, web = false) =>
    call({ agent: "developer", system: DEVELOPER_SYSTEM, prompt: prompt + guidance("developer", step), schema, model: s.developerModel, web, skills: DEV_SKILLS });

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
    const briefs = (run.briefs ??= {});
    if (s.personaBriefs) {
      if (s.reuseBriefs && project.leads.some((l) => !briefs[l.id])) {
        const saved = await getSavedBriefs(project);
        const reused = project.leads.filter((l) => !briefs[l.id] && saved[l.id]);
        reused.forEach((l) => (briefs[l.id] = saved[l.id]));
        if (reused.length) log("system", "status", `Reused ${reused.length} saved persona brief${reused.length > 1 ? "s" : ""} from earlier runs`);
      }
      const missing = project.leads.filter((l) => !briefs[l.id]);
      if (missing.length) {
        phase(`Researching ${missing.length} lead${missing.length > 1 ? "s" : ""} to build persona briefs`);
        await eachLead(missing, "Persona brief", async (lead) => {
          const brief = await call({
            agent: `${leadLabel(lead)} (brief)`,
            system: BRIEF_SYSTEM,
            prompt: briefPrompt(project, lead, s.webResearch),
            schema: PersonaBriefSchema,
            model: s.developerModel,
            web: s.webResearch,
            skills: SALES_SKILLS,
          });
          briefs[lead.id] = brief;
          await saveBrief(project, lead, brief);
          log(leadLabel(lead), "status", `Persona brief ready (${brief.buyingRole}, ${brief.fit} fit)`);
        });
      }
    }

    // 1. Research (done once the first round exists)
    if (run.rounds.length === 0) {
      phase(`Developer agent is researching${s.webResearch ? " (with web search)" : ""}`);
      const research = await developer("research", researchPrompt(project, s.webResearch, briefs), ResearchOutputSchema, s.webResearch);
      run.research = research.researchSummary;
      run.rounds.push({ round: 1, features: research.features, feedback: [] });
      log("developer", "status", `Proposed ${research.features.length} candidate features`);
    }

    // 2. Feedback rounds
    for (let r = 1; r <= s.rounds; r++) {
      const round = run.rounds[r - 1];
      if (!round) throw new Error(`Round ${r} was never prepared; this run cannot be continued.`);
      const previousRound = run.rounds[r - 2];
      const known = new Set(round.features.map((f) => f.id));
      const leadCall = <T,>(lead: Lead, prompt: string, schema: z.ZodType<T>) =>
        call({ agent: leadLabel(lead), system: leadSystem(project, lead, briefs[lead.id]), prompt: prompt + guidance("leads", `round ${r} leads`), schema, model: s.leadModel });

      // 2a. Positions: each lead reacts on their own.
      const waiting = project.leads.filter((l) => !round.feedback.some((f) => f.leadId === l.id));
      if (waiting.length) {
        phase(`Round ${r} of ${s.rounds}: ${waiting.length} lead agents are reviewing the features`);
        await mapLimit(waiting, s.concurrency, async (lead) => {
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
      }
      const responded = round.feedback.filter((f) => !f.error);
      if (responded.length === 0) throw new Error("Every lead agent failed in this round; see the activity log.");

      // 2b. Rebuttal: each lead sees the others' first positions and may revise.
      const toReact = s.debate && responded.length > 1 ? project.leads.filter((l) => responded.some((f) => f.leadId === l.id && !f.rebuttal)) : [];
      if (toReact.length) {
        phase(`Round ${r} of ${s.rounds}: leads are reacting to each other's feedback`);
        const positions: RunRound = { ...round, feedback: responded.map((f) => ({ ...f, rebuttal: undefined })) };
        await eachLead(toReact, "Rebuttal", async (lead) => {
          const own = round.feedback.find((f) => f.leadId === lead.id)!;
          const data = await leadCall(lead, rebuttalPrompt(positions, positions.feedback.find((f) => f.leadId === lead.id)!, project.leads), RebuttalOutputSchema);
          own.rebuttal = {
            ...data,
            revised: data.revised.filter((x) => known.has(x.featureId)),
            reallocation: data.reallocation.filter((x) => known.has(x.featureId)),
          };
          const n = own.rebuttal.revised.length;
          log(leadLabel(lead), "status", n ? `Revised or pushed back on ${n} feature${n > 1 ? "s" : ""}` : "Held their position");
        });
      }

      // 2c. Revision (done once the next round exists)
      if (r < s.rounds && !run.rounds[r]) {
        phase(`Developer agent is revising the features after round ${r}`);
        const rev = await developer(`revision after round ${r}`, revisionPrompt(project, round), RevisionOutputSchema);
        run.rounds.push({ round: r + 1, features: rev.features, noteToLeads: rev.noteToLeads, changelog: rev.changelog, feedback: [] });
        log("developer", "status", `Revised the list to ${rev.features.length} features`);
      }
    }

    // 3. Ranking
    if (!run.ranking) {
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

      // 3a. Draft
      if (!run.draftRanking) {
        phase("Developer agent is ranking the features");
        const draft = await developer("draft ranking", rankingPrompt(project, run.rounds, insights, s.teamCapacity), RankingOutputSchema);
        run.draftRanking = draft.ranked;
        run.summary = draft.summary;
        await save();
      }
      const draftScored = await scoreRanking(run.draftRanking, last, s.teamCapacity);
      let scored = draftScored;

      // 3b. Sceptic challenge, then the developer's final answer
      if (s.sceptic) {
        const draftText = draftScored.ranking
          .map((x) => `${x.rank}. ${x.featureId} ${x.title}: score ${x.rice} (reach ${x.reach}, impact ${x.impact}, confidence ${x.confidence}, effort ${x.effort}). ${x.rationale}`)
          .join("\n");
        if (!run.critique) {
          phase("Sceptic agent is challenging the developer's estimates");
          const critique = await call({
            agent: "sceptic",
            system: SCEPTIC_SYSTEM,
            prompt: scepticPrompt(project, run.rounds, briefs, draftText) + guidance("developer", "sceptic's challenge"),
            schema: CritiqueSchema,
            model: s.developerModel,
          });
          const known = new Set(last.features.map((f) => f.id));
          run.critique = { ...critique, challenges: critique.challenges.filter((c) => known.has(c.featureId)) };
          log("sceptic", "status", `Raised ${run.critique.challenges.length} challenges`);
        }
        phase("Developer agent is answering the sceptic and finalising the ranking");
        const fin = await developer(
          "final ranking",
          rankingPrompt(project, run.rounds, insights, s.teamCapacity, { critique: run.critique, draft: draftText }),
          FinalRankingOutputSchema,
        );
        run.summary = fin.summary;
        run.critiqueResponse = fin.responseToCritique;
        // The final pass must still rank every feature; any it left out keep their draft inputs.
        const answered = new Set(fin.ranked.map((x) => x.featureId));
        const kept = run.draftRanking.filter((x) => !answered.has(x.featureId));
        if (kept.length) log("system", "status", `${kept.length} feature${kept.length > 1 ? "s" : ""} missing from the final answer kept their draft inputs`);
        scored = await scoreRanking([...fin.ranked, ...kept], last, s.teamCapacity);
        const draftRank = new Map(draftScored.ranking.map((x) => [x.featureId, x.rank]));
        scored.ranking.forEach((x) => (x.draftRank = draftRank.get(x.featureId) ?? null));
        log("developer", "status", "Answered the sceptic and finalised the ranking");
      }

      if (scored.note) log("system", "status", scored.note);
      const adoption = last.feedback.filter((f) => !f.error).map((f) => f.adoptionLikelihood);
      run.insights = {
        ...insights,
        ...scored.portfolio,
        meanAdoption: adoption.length ? Math.round((adoption.reduce((a, b) => a + b, 0) / adoption.length) * 10) / 10 : null,
      };
      run.ranking = scored.ranking;
    }
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
  const rows = ranked.filter((r, i) => last.features.some((f) => f.id === r.featureId) && ranked.findIndex((x) => x.featureId === r.featureId) === i);
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
  const budgets = responded.map(finalPoints).filter((m) => m.size > 0);
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
      pointsShare: budgets.length ? budgets.reduce((a, m) => a + (m.get(id) ?? 0), 0) / (budgets.length * POINT_BUDGET) : null,
      quarter: quarter.get(id) ?? null,
      draftRank: null,
    };
  });
  return { ranking, portfolio, note: result?.rice ? undefined : `Scored with the built-in RICE formula: ${reason}` };
}

export async function loadRun(id: string) {
  const run = await getRun(id);
  return run ? reconcile(run) : null;
}
