import type { Project, Run, RunEvent } from "./types";

// Turns a run's persisted state into what the 3D view shows: one entity per agent with a live state,
// and "pulses" (messages travelling between agents) for newly arrived events.

export type AgentState = "idle" | "working" | "done" | "error";

export type SceneAgent = {
  id: string; // "developer" or a lead id
  name: string;
  subtitle: string;
  role: "developer" | "lead";
  state: AgentState;
  text: string;
  color: string;
};

export const DEVELOPER_ID = "developer";
export const DEVELOPER_COLOR = "#5b7cfa";
// Distinct hues that hold up on both light and dark surfaces.
const LEAD_COLORS = ["#f08c00", "#12b886", "#e64980", "#7950f2", "#15aabf", "#82c91e", "#fa5252", "#fab005", "#4c6ef5", "#be4bdb"];

type Step = "briefs" | "research" | "positions" | "rebuttal" | "revise" | "rank" | "other";

function step(phase: string): Step {
  if (phase.includes("persona briefs")) return "briefs";
  if (phase.includes("is researching")) return "research";
  if (phase.includes("reviewing the features")) return "positions";
  if (phase.includes("reacting to each other")) return "rebuttal";
  if (phase.includes("revising")) return "revise";
  if (phase.includes("ranking") || phase.includes("Analysing")) return "rank";
  return "other";
}

const leadLabel = (l: { name: string; title: string }) => l.name || l.title || "Lead";

function lastEvent(events: RunEvent[], names: string[], kinds?: RunEvent["kind"][]) {
  for (let i = events.length - 1; i >= 0; i--) {
    if (names.includes(events[i].agent) && (!kinds || kinds.includes(events[i].kind))) return events[i];
  }
  return undefined;
}

export function deriveAgents(run: Run, project: Project | null): SceneAgent[] {
  const running = run.status === "running";
  const now = step(run.phase);
  const round = run.rounds[run.rounds.length - 1];
  const finished: AgentState = run.status === "completed" ? "done" : "idle";

  const devWorking = running && (now === "research" || now === "revise" || now === "rank");
  const devGeneric = now === "research" ? "Researching the market" : now === "revise" ? "Revising the feature list" : "Ranking the features";
  const developer: SceneAgent = {
    id: DEVELOPER_ID,
    name: "Developer agent",
    subtitle: "Product research and ranking",
    role: "developer",
    color: DEVELOPER_COLOR,
    state: run.status === "failed" ? "error" : devWorking ? "working" : running ? "idle" : finished,
    text: devWorking
      ? (lastEvent(run.events.slice(-12), [DEVELOPER_ID], ["activity"])?.text ?? devGeneric)
      : (lastEvent(run.events, [DEVELOPER_ID], ["status"])?.text ?? (running ? "Waiting for the leads" : "")),
  };

  const leads: SceneAgent[] = (project?.leads ?? []).map((l, i) => {
    const label = leadLabel(l);
    const names = [label, `${label} (brief)`];
    const fb = round?.feedback.find((f) => f.leadId === l.id);
    const last = lastEvent(run.events, names);
    let state: AgentState = running ? "idle" : finished;
    let text = lastEvent(run.events, names, ["status"])?.text ?? (running ? "Waiting" : "");

    if (running && now === "briefs") {
      if (run.briefs?.[l.id]) state = "done";
      else {
        state = "working";
        text = last?.kind === "activity" ? last.text : "Being researched";
      }
    } else if (running && now === "positions") {
      if (fb) state = fb.error ? "error" : "done";
      else {
        state = "working";
        text = "Reviewing the features";
      }
    } else if (running && now === "rebuttal") {
      if (!fb || fb.error) state = "error";
      else if (fb.rebuttal) state = "done";
      else {
        state = "working";
        text = "Reading what the other leads said";
      }
    }
    if (last?.kind === "error" && state !== "working") {
      state = "error";
      text = last.text;
    }
    return { id: l.id, name: label, subtitle: [l.title !== label ? l.title : "", l.company].filter(Boolean).join(" · "), role: "lead", state, text, color: LEAD_COLORS[i % LEAD_COLORS.length] };
  });

  return [developer, ...leads];
}

export type PulseSpec = { from: string; to: string; color: string };

/** Messages to animate for one newly arrived event. */
export function pulsesFor(event: RunEvent, agents: SceneAgent[]): PulseSpec[] {
  if (event.kind !== "status") return [];
  const leads = agents.filter((a) => a.role === "lead");
  const lead = leads.find((a) => a.name === event.agent);
  if (event.agent === DEVELOPER_ID && /^(Proposed|Revised)/.test(event.text)) {
    return leads.map((l) => ({ from: DEVELOPER_ID, to: l.id, color: DEVELOPER_COLOR }));
  }
  if (!lead) return [];
  if (/^(Gave feedback|Persona brief ready)/.test(event.text)) return [{ from: lead.id, to: DEVELOPER_ID, color: lead.color }];
  if (/^Revised or pushed back/.test(event.text)) {
    return leads.filter((l) => l.id !== lead.id).map((l) => ({ from: lead.id, to: l.id, color: lead.color }));
  }
  return [];
}
