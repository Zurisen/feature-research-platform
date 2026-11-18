import { Feature, Lead, LeadFeedback, Project, RunRound } from "./types";

const line = (label: string, v: string) => (v.trim() ? `${label}: ${v.trim()}\n` : "");

export function businessBrief(p: Project) {
  const b = p.business;
  return (
    `<business>\n` +
    line("Name", b.name) +
    line("Website", b.website) +
    line("Industry", b.industry) +
    line("Employees", b.employees) +
    `Description: ${b.description.trim()}\n` +
    `</business>\n` +
    (p.focusArea.trim() ? `<focus_area>\n${p.focusArea.trim()}\n</focus_area>\n` : "") +
    (p.extraContext.trim() ? `<extra_context>\n${p.extraContext.trim()}\n</extra_context>\n` : "")
  );
}

function leadLine(l: Lead) {
  return [
    l.name || "Unnamed lead",
    l.title && `title: ${l.title}`,
    l.company && `company: ${l.company}`,
    l.industry && `industry: ${l.industry}`,
    l.companySize && `company size: ${l.companySize}`,
    l.location && `location: ${l.location}`,
    l.notes && `notes: ${l.notes}`,
  ]
    .filter(Boolean)
    .join(" | ");
}

export function featureList(features: Feature[]) {
  return features
    .map(
      (f) =>
        `<feature id="${f.id}">\nTitle: ${f.title}\nDescription: ${f.description}\nProblem solved: ${f.problem}\nTarget users: ${f.targetUsers}\nEffort: ${f.effort}\n</feature>`,
    )
    .join("\n");
}

function feedbackDigest(feedback: LeadFeedback[], leads: Lead[]) {
  return feedback
    .filter((f) => !f.error)
    .map((f) => {
      const lead = leads.find((l) => l.id === f.leadId);
      const items = f.items
        .map((i) => `  - ${i.featureId}: ${i.score}/5, ${i.wouldUse ? "would use" : "would not use"}. ${i.comment}`)
        .join("\n");
      const missing = f.missing.length ? `\n  Missing for them: ${f.missing.join("; ")}` : "";
      return `<lead_feedback lead="${lead?.name ?? f.leadId}" title="${lead?.title ?? ""}" company="${lead?.company ?? ""}">\n${items}${missing}\n  Overall: ${f.overall}\n</lead_feedback>`;
    })
    .join("\n");
}

// ---------- Developer agent ----------

export const DEVELOPER_SYSTEM = `You are the product developer agent for a business. Your job is to work out which product features the business should build next, and to refine that list against feedback from its sales leads.

You think like an experienced product lead: you look for real customer problems, you check what competitors already offer, you prefer a few well-argued features over a long wish list, and you are honest about effort and uncertainty. The leads you hear from are simulated from CRM data, so treat their feedback as a strong signal about fit, not as verified interview data.`;

export function researchPrompt(p: Project, web: boolean) {
  return `${businessBrief(p)}
<leads>
${p.leads.map(leadLine).join("\n")}
</leads>

Research what this business should develop next${p.focusArea.trim() ? ", concentrating on the focus area above" : ""}.

${
  web
    ? "Use web search to understand the business's product, its competitors and what customers in this market ask for. Keep it proportionate: roughly 5 to 12 searches, reading the pages that matter."
    : "Web access is off for this run, so rely on the information above and your own knowledge, and say where you are unsure."
}

Then propose 6 to 8 candidate features. Each should be concrete enough that a customer could say whether they would use it, and distinct from the others. Give the features ids F1, F2, and so on. In the research summary, cover the market context, what competitors do, the gaps you see, and the sources you relied on.`;
}

export function revisionPrompt(p: Project, round: RunRound) {
  return `${businessBrief(p)}
Here is the feature list the leads just reviewed (round ${round.round}):

${featureList(round.features)}

Here is their feedback:

${feedbackDigest(round.feedback, p.leads)}

Revise the feature list. Keep what resonated, sharpen or re-scope what got mixed reactions, drop what nobody wants, and add features the leads asked for when several of them would benefit. Keep the id of any feature that survives, even if reworded, and give new features new ids that have not been used before. Aim for 5 to 8 features.

Also write a short note to the leads saying what you changed because of their feedback and what you most want their view on in the next round.`;
}

export function rankingPrompt(p: Project, rounds: RunRound[]) {
  const last = rounds[rounds.length - 1];
  const history = rounds
    .slice(0, -1)
    .map((r) => `Round ${r.round} feedback:\n${feedbackDigest(r.feedback, p.leads)}`)
    .join("\n\n");
  return `${businessBrief(p)}
The feedback rounds are finished. Final feature list:

${featureList(last.features)}

Final round feedback:

${feedbackDigest(last.feedback, p.leads)}

${history ? `Earlier rounds, for context:\n\n${history}\n` : ""}
Produce the prioritisation. For every feature in the final list give RICE inputs: reach (1-10, the share of this business's target customers it affects), impact (1-5, per customer), confidence (0-100 percent, lower when leads disagreed or evidence is thin) and effort in person-weeks. Explain each briefly, name the leads who most wanted it, and state the main concern raised. The score is computed from your inputs as reach x impact x confidence / effort, so make the inputs reflect your actual judgement.

Finish with a short recommendation of what to build next and why, including anything you would validate with real customers first.`;
}

// ---------- Lead agents ----------

export function leadSystem(p: Project, lead: Lead) {
  return `You are role-playing a specific sales lead of a business, to give its product team realistic customer feedback.

You are: ${leadLine(lead)}

The business asking for your feedback:
${businessBrief(p)}
Stay in character and answer in the first person. Reason from what someone with your role, at a company like yours, actually cares about: your goals, your budget and time pressures, the tools you already use, and what you would have to justify internally. Be candid. Low scores are as useful as high ones, and a feature that is irrelevant to you should be scored as irrelevant, since the team needs to know where demand is weak. Where the profile gives you little to go on, make the most plausible assumption for that role and industry rather than inventing specific facts about the real person.`;
}

export function leadPrompt(round: RunRound, previous?: LeadFeedback) {
  const prior = previous
    ? `Last round you said overall: "${previous.overall}"${previous.missing.length ? ` and asked for: ${previous.missing.join("; ")}` : ""}.\n\n`
    : "";
  const note = round.noteToLeads ? `Note from the product team:\n${round.noteToLeads}\n\n` : "";
  return `${note}${prior}The product team is considering these features (round ${round.round}):

${featureList(round.features)}

Give your reaction to every feature, using its id: a score from 1 (no value to me) to 5 (I need this), whether you would actually use it, and a short comment. Then list anything you would want that is missing, and give your overall take.`;
}
