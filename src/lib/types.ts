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
  // Research each lead's company and role before the feedback rounds (sales plugin skills).
  personaBriefs: z.boolean().default(true),
  // After giving their own view, leads see each other's positions and may revise.
  debate: z.boolean().default(true),
  // Person-months the team can spend per quarter; used to lay the ranking out as a roadmap.
  teamCapacity: z.number().int().min(1).max(200).default(10),
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

export const PersonaBriefSchema = z.object({
  companyContext: z.string().describe("What the lead's company does and what is going on in its market, 2-4 sentences."),
  rolePriorities: z.array(z.string()).describe("What someone in this role is measured on and cares about."),
  likelyObjections: z.array(z.string()).describe("Objections this lead would plausibly raise to buying or adopting."),
  buyingRole: z.enum(["economic buyer", "champion", "user", "influencer", "blocker", "unknown"]),
  fit: z.enum(["strong", "medium", "weak"]).describe("How well this lead fits the business's ideal customer."),
  fitReason: z.string(),
});
export type PersonaBrief = z.infer<typeof PersonaBriefSchema>;

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
  topPick: z.string().describe("The id of the single feature I would choose if only one could be built."),
  adoptionLikelihood: z
    .number()
    .int()
    .min(1)
    .max(5)
    .describe("If my top pick shipped, how likely I would be to buy or expand: 1 = very unlikely, 5 = very likely."),
  quote: z.string().describe("One sentence, in my own voice, that sums up my reaction."),
});
export type LeadFeedbackOutput = z.infer<typeof LeadFeedbackOutputSchema>;

export const RebuttalOutputSchema = z.object({
  revised: z
    .array(
      z.object({
        featureId: z.string(),
        score: z.number().int().min(1).max(5),
        comment: z.string().describe("Why I changed my score, or why I disagree with another lead on this feature."),
      }),
    )
    .describe("Only the features where I changed my mind or want to push back. Empty if my view stands."),
  closing: z.string().describe("First-person closing statement after hearing the others, 1-3 sentences."),
});
export type RebuttalOutput = z.infer<typeof RebuttalOutputSchema>;

export type LeadFeedback = LeadFeedbackOutput & { leadId: string; error?: string; rebuttal?: RebuttalOutput };

/** A lead's score per feature for a round, after any revision made in the rebuttal step. */
export function finalScores(fb: LeadFeedback): Map<string, number> {
  const scores = new Map(fb.items.map((i) => [i.featureId, i.score]));
  for (const r of fb.rebuttal?.revised ?? []) if (scores.has(r.featureId)) scores.set(r.featureId, r.score);
  return scores;
}

export const RevisionOutputSchema = z.object({
  features: z.array(FeatureSchema).min(3).max(10),
  changelog: z.string().describe("What changed versus the previous list and why, as short markdown bullets."),
  noteToLeads: z
    .string()
    .describe("Short message to the leads: what you changed based on their feedback and what you want them to weigh in on next."),
});
export type RevisionOutput = z.infer<typeof RevisionOutputSchema>;

// RICE inputs use the categories that vendor/claude-skills rice_prioritizer.py expects.
export const RankingOutputSchema = z.object({
  ranked: z.array(
    z.object({
      featureId: z.string(),
      reach: z.number().int().min(0).describe("Estimated customers or prospects of this business affected per quarter."),
      impact: z.enum(["massive", "high", "medium", "low", "minimal"]).describe("Impact per affected customer."),
      confidence: z.enum(["high", "medium", "low"]).describe("Confidence in the estimates; lower when leads disagreed."),
      effort: z.enum(["xs", "s", "m", "l", "xl"]).describe("xs = about 1 person-month, s = 3, m = 5, l = 8, xl = 13."),
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
  firstChoiceShare: number; // 0-1, share of leads who picked it as their single top feature
  quarter: number | null; // quarter it lands in given team capacity
};

export type RunInsights = {
  scoredBy: "rice_prioritizer.py" | "built-in";
  quickWins: string[]; // feature ids
  bigBets: string[];
  totalEffortMonths: number;
  meanAdoption: number | null;
  themes: { name: string; count: number }[];
  sentiment: { positive: number; neutral: number; negative: number } | null;
  painPoints: string[];
  requests: string[];
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
  briefs?: Record<string, PersonaBrief>; // by lead id
  rounds: RunRound[];
  insights?: RunInsights;
  ranking?: RankedFeature[];
  summary?: string;
  costUsd: number;
  error?: string;
  events: RunEvent[];
};
