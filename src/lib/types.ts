import { z } from "zod";

// ---------- Project inputs ----------

export const BusinessSchema = z.object({
  name: z.string().min(1),
  website: z.string().default(""),
  industry: z.string().default(""),
  employees: z.string().default(""),
  description: z.string().min(1),
});
export type Business = z.infer<typeof BusinessSchema>;

export const LeadSchema = z.object({
  id: z.string(),
  name: z.string().default(""),
  title: z.string().default(""),
  company: z.string().default(""),
  industry: z.string().default(""),
  companySize: z.string().default(""),
  location: z.string().default(""),
  notes: z.string().default(""),
});
export type Lead = z.infer<typeof LeadSchema>;

export const MIN_MANUAL_LEADS = 5;

export const ProjectInputSchema = z.object({
  name: z.string().min(1),
  source: z.enum(["apollo", "manual"]),
  business: BusinessSchema,
  focusArea: z.string().default(""),
  extraContext: z.string().default(""),
  leads: z.array(LeadSchema),
});
export type ProjectInput = z.infer<typeof ProjectInputSchema>;

export type Project = ProjectInput & { id: string; createdAt: string };

// ---------- Settings ----------

export const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { id: "claude-fable-5-2", label: "Claude Fable 5.2" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
] as const;

export const SettingsSchema = z.object({
  // "local": use the Claude Code login on this machine. "apiKey": use ANTHROPIC_API_KEY from .env.local.
  authMode: z.enum(["local", "apiKey"]).default("local"),
  developerModel: z.string().default("claude-opus-5-5"),
  leadModel: z.string().default("claude-opus-5-5"),
  rounds: z.number().int().min(1).max(5).default(2),
  concurrency: z.number().int().min(1).max(8).default(3),
  webResearch: z.boolean().default(true),
});
export type Settings = z.infer<typeof SettingsSchema>;

// ---------- Agent outputs (also used as structured-output schemas) ----------

export const FeatureSchema = z.object({
  id: z.string().describe("Short stable id such as F1, F2. Keep the id when a feature survives a revision."),
  title: z.string(),
  description: z.string().describe("What the feature does, 2-4 sentences."),
  problem: z.string().describe("The customer problem it solves."),
  targetUsers: z.string(),
  effort: z.enum(["S", "M", "L", "XL"]),
});
export type Feature = z.infer<typeof FeatureSchema>;

export const ResearchOutputSchema = z.object({
  researchSummary: z
    .string()
    .describe("Markdown summary of the research: market, competitors, gaps, sources consulted."),
  features: z.array(FeatureSchema).min(4).max(10),
});
export type ResearchOutput = z.infer<typeof ResearchOutputSchema>;

export const LeadFeedbackOutputSchema = z.object({
  items: z.array(
    z.object({
      featureId: z.string(),
      score: z.number().int().min(1).max(5).describe("1 = no value to me, 5 = I need this"),
      wouldUse: z.boolean(),
      comment: z.string().describe("First-person reaction, 1-3 sentences."),
    }),
  ),
  missing: z.array(z.string()).describe("Things I would want that are not on the list."),
  overall: z.string().describe("First-person overall take, 2-4 sentences."),
});
export type LeadFeedbackOutput = z.infer<typeof LeadFeedbackOutputSchema>;

export type LeadFeedback = LeadFeedbackOutput & { leadId: string; error?: string };

export const RevisionOutputSchema = z.object({
  features: z.array(FeatureSchema).min(3).max(10),
  changelog: z.string().describe("What changed versus the previous list and why, as short markdown bullets."),
  noteToLeads: z
    .string()
    .describe("Short message to the leads: what you changed based on their feedback and what you want them to weigh in on next."),
});
export type RevisionOutput = z.infer<typeof RevisionOutputSchema>;

export const RankingOutputSchema = z.object({
  ranked: z.array(
    z.object({
      featureId: z.string(),
      reach: z.number().min(1).max(10).describe("Share of target customers affected, 1-10."),
      impact: z.number().min(1).max(5).describe("Impact per customer, 1-5."),
      confidence: z.number().min(0).max(100).describe("Confidence in the estimates, percent."),
      effortWeeks: z.number().min(0.5).describe("Estimated effort in person-weeks."),
      rationale: z.string(),
      champions: z.array(z.string()).describe("Names of leads who most wanted it."),
      concerns: z.string().describe("Main objections or risks raised. Empty string if none."),
    }),
  ),
  summary: z.string().describe("Markdown recommendation: what to build next and why."),
});
export type RankingOutput = z.infer<typeof RankingOutputSchema>;

export type RankedFeature = RankingOutput["ranked"][number] & {
  rank: number;
  title: string;
  rice: number;
  avgLeadScore: number | null;
};

// ---------- Runs ----------

export type RunEvent = {
  ts: string;
  agent: string; // "developer", a lead name, or "system"
  kind: "status" | "activity" | "error";
  text: string;
};

export type RunRound = {
  round: number;
  features: Feature[];
  noteToLeads?: string;
  changelog?: string;
  feedback: LeadFeedback[];
};

export type Run = {
  id: string;
  projectId: string;
  status: "running" | "completed" | "failed" | "cancelled";
  phase: string;
  settings: Settings;
  createdAt: string;
  finishedAt?: string;
  research?: string;
  rounds: RunRound[];
  ranking?: RankedFeature[];
  summary?: string;
  costUsd: number;
  error?: string;
  events: RunEvent[];
};
