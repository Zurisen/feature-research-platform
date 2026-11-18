import { runAgent } from "./engine";
import {
  DEVELOPER_SYSTEM,
  leadPrompt,
  leadSystem,
  rankingPrompt,
  researchPrompt,
  revisionPrompt,
} from "./prompts";
import { getRun, newId, saveRun } from "./store";
import {
  Feature,
  LeadFeedback,
  LeadFeedbackOutputSchema,
  Project,
  RankedFeature,
  RankingOutputSchema,
  ResearchOutputSchema,
  RevisionOutputSchema,
  Run,
  RunEvent,
  RunRound,
  Settings,
} from "./types";

// Run flow:
//   developer researches -> [leads give feedback -> developer revises] x rounds -> developer ranks.
// Runs execute in this Node process and are persisted to data/runs after every step; the UI polls.

const g = globalThis as unknown as { __leadloopActive?: Map<string, AbortController> };
const active = (g.__leadloopActive ??= new Map());

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

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
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
  const developer = <T,>(prompt: string, schema: Parameters<typeof runAgent<T>>[0]["schema"], web = false) =>
    runAgent<T>({
      system: DEVELOPER_SYSTEM,
      prompt,
      schema,
      model: s.developerModel,
      web,
      authMode: s.authMode,
      signal,
      onActivity: (t) => log("developer", "activity", t),
    }).then((r) => {
      run.costUsd += r.costUsd;
      return r.data;
    });

  try {
    // 1. Research
    phase(`Developer agent is researching${s.webResearch ? " (with web search)" : ""}`);
    const research = await developer(researchPrompt(project, s.webResearch), ResearchOutputSchema, s.webResearch);
    run.research = research.researchSummary;
    let features: Feature[] = research.features;
    let noteToLeads: string | undefined;
    let changelog: string | undefined;
    log("developer", "status", `Proposed ${features.length} candidate features`);

    // 2. Feedback rounds
    for (let r = 1; r <= s.rounds; r++) {
      const round: RunRound = { round: r, features, noteToLeads, changelog, feedback: [] };
      run.rounds.push(round);
      phase(`Round ${r} of ${s.rounds}: ${project.leads.length} lead agents are reviewing the features`);
      const previousRound = run.rounds[r - 2];

      await mapLimit(project.leads, s.concurrency, async (lead) => {
        const label = lead.name || lead.title || "Lead";
        let fb: LeadFeedback;
        try {
          const res = await runAgent({
            system: leadSystem(project, lead),
            prompt: leadPrompt(round, previousRound?.feedback.find((f) => f.leadId === lead.id && !f.error)),
            schema: LeadFeedbackOutputSchema,
            model: s.leadModel,
            authMode: s.authMode,
            signal,
          });
          run.costUsd += res.costUsd;
          const known = new Set(features.map((f) => f.id));
          fb = { ...res.data, items: res.data.items.filter((i) => known.has(i.featureId)), leadId: lead.id };
          log(label, "status", `Gave feedback on ${fb.items.length} features`);
        } catch (e) {
          if (signal.aborted) throw e;
          // One lead failing should not sink the round.
          fb = { leadId: lead.id, items: [], missing: [], overall: "", error: (e as Error).message };
          log(label, "error", `Feedback failed: ${fb.error}`);
        }
        round.feedback.push(fb);
        await save();
      });

      if (round.feedback.every((f) => f.error)) throw new Error("Every lead agent failed in this round; see the activity log.");

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
    phase("Developer agent is ranking the features");
    const ranking = await developer(rankingPrompt(project, run.rounds), RankingOutputSchema);
    run.ranking = buildRanking(ranking.ranked, run.rounds[run.rounds.length - 1]);
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

function buildRanking(ranked: RankingOutputSchemaItem[], last: RunRound): RankedFeature[] {
  const out = ranked
    .map((r) => {
      const feature = last.features.find((f) => f.id === r.featureId);
      if (!feature) return null;
      const scores = last.feedback.flatMap((f) => f.items.filter((i) => i.featureId === r.featureId).map((i) => i.score));
      return {
        ...r,
        title: feature.title,
        rank: 0,
        rice: Math.round(((r.reach * r.impact * (r.confidence / 100)) / r.effortWeeks) * 100) / 100,
        avgLeadScore: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
      };
    })
    .filter((x): x is RankedFeature => x !== null)
    .sort((a, b) => b.rice - a.rice);
  out.forEach((r, i) => (r.rank = i + 1));
  return out;
}

type RankingOutputSchemaItem = import("./types").RankingOutput["ranked"][number];

export async function loadRun(id: string) {
  const run = await getRun(id);
  return run ? reconcile(run) : null;
}
