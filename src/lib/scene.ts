import type { Project, Run, RunEvent } from "./types";

// Turns a run's persisted state into what the 3D view shows: one entity per agent with a live state,
// and "pulses" (messages travelling between agents) for newly arrived events.

export type AgentState = "idle" | "working" | "done" | "error";

export type SceneAgent = {
  id: string; // "developer" or a lead id
  name: string;
  subtitle: string;
  role: "developer" | "lead" | "sceptic";
  state: AgentState;
  text: string;
  color: string;
};

export const DEVELOPER_ID = "developer";
export const SCEPTIC_ID = "sceptic";
// Lead colours are the data-viz categorical palette in its validated order (identity, never rank),
// stepped separately for light and dark surfaces. Leads beyond the eighth share a neutral gray.
const PALETTE = {
  light: { developer: "#1a1a18", sceptic: "#8a8880", overflow: "#a09e96", leads: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"] },
  dark: { developer: "#edece7", sceptic: "#8a8880", overflow: "#6f6e68", leads: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#0ca30c", "#9085e9", "#e66767"] },
};

type Step = "briefs" | "research" | "positions" | "rebuttal" | "revise" | "rank" | "sceptic" | "other";

function step(phase: string): Step {
  if (phase.startsWith("Sceptic agent")) return "sceptic";
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

export function deriveAgents(run: Run, project: Project | null, dark = false): SceneAgent[] {
  const colors = dark ? PALETTE.dark : PALETTE.light;
  const DEVELOPER_COLOR = colors.developer;
  const SCEPTIC_COLOR = colors.sceptic;
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
    return { id: l.id, name: label, subtitle: [l.title !== label ? l.title : "", l.company].filter(Boolean).join(" · "), role: "lead", state, text, color: colors.leads[i] ?? colors.overflow };
  });

  const others: SceneAgent[] = [];
  if (run.settings.sceptic ?? false) {
    const challenging = running && now === "sceptic";
    others.push({
      id: SCEPTIC_ID,
      name: "Sceptic agent",
      subtitle: "Challenges the ranking",
      role: "sceptic",
      color: SCEPTIC_COLOR,
      state: challenging ? "working" : run.critique ? "done" : running ? "idle" : finished,
      text: challenging ? "Looking for weak evidence" : (lastEvent(run.events, [SCEPTIC_ID], ["status"])?.text ?? (running ? "Waiting for the draft ranking" : "")),
    });
  }
  return [developer, ...others, ...leads];
}

export type PulseSpec = { from: string; to: string; color: string };

/** Messages to animate for one newly arrived event. */
export function pulsesFor(event: RunEvent, agents: SceneAgent[]): PulseSpec[] {
  if (event.kind !== "status") return [];
  const leads = agents.filter((a) => a.role === "lead");
  const lead = leads.find((a) => a.name === event.agent);
  const colorOf = (id: string) => agents.find((a) => a.id === id)?.color ?? "#888";
  if (event.agent === SCEPTIC_ID) return [{ from: SCEPTIC_ID, to: DEVELOPER_ID, color: colorOf(SCEPTIC_ID) }];
  if (event.agent === DEVELOPER_ID && /^Answered the sceptic/.test(event.text)) return [{ from: DEVELOPER_ID, to: SCEPTIC_ID, color: colorOf(DEVELOPER_ID) }];
  if (event.agent === DEVELOPER_ID && /^(Proposed|Revised)/.test(event.text)) {
    return leads.map((l) => ({ from: DEVELOPER_ID, to: l.id, color: colorOf(DEVELOPER_ID) }));
  }
  if (!lead) return [];
  if (/^(Gave feedback|Persona brief ready)/.test(event.text)) return [{ from: lead.id, to: DEVELOPER_ID, color: lead.color }];
  if (/^Revised or pushed back/.test(event.text)) {
    return leads.filter((l) => l.id !== lead.id).map((l) => ({ from: lead.id, to: l.id, color: lead.color }));
  }
  return [];
}
