import { Critique, Feature, finalPoints, finalScores, Lead, LeadFeedback, PersonaBrief, POINT_BUDGET, Project, RunInsights, RunRound } from "./types";

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

function briefText(b: PersonaBrief) {
  return (
    `Company context: ${b.companyContext}\n` +
    `Role priorities: ${b.rolePriorities.join("; ")}\n` +
    `Likely objections: ${b.likelyObjections.join("; ")}\n` +
    `Buying role: ${b.buyingRole}. Fit: ${b.fit} (${b.fitReason})`
  );
}

function leadsBlock(p: Project, briefs: Record<string, PersonaBrief>) {
  return p.leads
    .map((l) => `<lead>\n${leadLine(l)}${briefs[l.id] ? `\n${briefText(briefs[l.id])}` : ""}\n</lead>`)
    .join("\n");
}

export function featureList(features: Feature[]) {
  return features
    .map(
      (f) =>
        `<feature id="${f.id}">\nTitle: ${f.title}\nDescription: ${f.description}\nProblem solved: ${f.problem}\nTarget users: ${f.targetUsers}\nEffort: ${f.effort}\n</feature>`,
    )
    .join("\n");
}

/** One lead's feedback for a round, with scores as they stand after any rebuttal. */
function feedbackEntry(f: LeadFeedback, leads: Lead[]) {
  const lead = leads.find((l) => l.id === f.leadId);
  const scores = finalScores(f);
  const points = finalPoints(f);
  const items = f.items
    .map((i) => {
      const final = scores.get(i.featureId) ?? i.score;
      const changed = final !== i.score ? ` (first said ${i.score}/5)` : "";
      const spent = points.size ? `, ${Math.round((points.get(i.featureId) ?? 0) * 10) / 10} of ${POINT_BUDGET} budget points` : "";
      return `  - ${i.featureId}: ${final}/5${changed}${spent}, ${i.wouldUse ? "would use" : "would not use"}. ${i.comment}`;
    })
    .join("\n");
  const rebuttal = f.rebuttal
    ? `\n  After hearing the others: ${f.rebuttal.revised.map((r) => `${r.featureId}: ${r.comment}`).join(" ")} ${f.rebuttal.closing}`
    : "";
  const missing = f.missing.length ? `\n  Missing for them: ${f.missing.join("; ")}` : "";
  return `<lead_feedback lead="${lead?.name ?? f.leadId}" title="${lead?.title ?? ""}" company="${lead?.company ?? ""}">\n${items}${missing}\n  Top pick: ${f.topPick}. Likelihood to buy if it shipped: ${f.adoptionLikelihood}/5\n  Overall: ${f.overall}${rebuttal}\n</lead_feedback>`;
}

const feedbackDigest = (feedback: LeadFeedback[], leads: Lead[]) =>
  feedback
    .filter((f) => !f.error)
    .map((f) => feedbackEntry(f, leads))
    .join("\n");

const UNATTENDED = `You are running unattended inside an automated pipeline, so there is nobody to answer questions. When a skill tells you to ask the user something, decide it yourself from the information you were given. When a skill mentions a connector or tool you do not have (a CRM, chat, a knowledge base), skip that part.`;

// ---------- Persona brief agents (sales plugin skills) ----------

export const BRIEF_SKILLS = ["account-research", "lead-triage", "stakeholder-map"];

export const BRIEF_SYSTEM = `You are a sales researcher preparing a short brief on one lead, so that a simulated version of that lead can give realistic product feedback.

You have three skills: account-research for understanding the lead's company, lead-triage for judging how well the lead fits the business's ideal customer, and stakeholder-map for working out the lead's role in a buying decision. Use the parts of them that help; their full output formats are not needed here, only the brief you return.

${UNATTENDED}

Research the company and what the role typically involves. Do not research the individual: no searching for the person by name, no personal or social-media details. If the company cannot be found or looks fictional, reason from its industry and size and say so in the company context.`;

export function briefPrompt(p: Project, lead: Lead, web: boolean) {
  return `${businessBrief(p)}
<lead>
${leadLine(lead)}
</lead>

Write the brief for this lead as a prospective customer of the business above. ${
    web
      ? "A few web searches about the company and its market are enough."
      : "Web access is off for this run, so work from the profile and your own knowledge."
  }`;
}

// ---------- Developer agent (product-management plugin skills) ----------

export const DEVELOPER_SKILLS = ["competitive-brief", "product-brainstorming", "synthesize-research", "roadmap-update"];

export const DEVELOPER_SYSTEM = `You are the product developer agent for a business. Your job is to work out which product features the business should build next, and to refine that list against feedback from its sales leads.

You think like an experienced product lead: you look for real customer problems, you check what competitors already offer, you prefer a few well-argued features over a long wish list, and you are honest about effort and uncertainty. The leads you hear from are simulated from CRM data, so treat their feedback as a strong signal about fit, not as verified interview data.

You have four skills from a product-management toolkit: competitive-brief, product-brainstorming, synthesize-research and roadmap-update. Each task says which ones apply. Use their methods and frameworks to do the thinking; the final answer is always the structured result the task asks for, not the document format the skill describes.

${UNATTENDED}`;

export function researchPrompt(p: Project, web: boolean, briefs: Record<string, PersonaBrief>) {
  return `${businessBrief(p)}
<leads>
${leadsBlock(p, briefs)}
</leads>

Research what this business should develop next${p.focusArea.trim() ? ", concentrating on the focus area above" : ""}.

Use the competitive-brief skill to structure the competitor analysis and the product-brainstorming skill to generate and pressure-test ideas.

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

Here is their feedback. Scores are where each lead ended up after hearing the others:

${feedbackDigest(round.feedback, p.leads)}

Use the synthesize-research skill to pull the themes out of this feedback, then revise the feature list. Keep what resonated, sharpen or re-scope what got mixed reactions, drop what nobody wants, and add features the leads asked for when several of them would benefit. Keep the id of any feature that survives, even if reworded, and give new features new ids that have not been used before. Aim for 5 to 8 features.

Also write a short note to the leads saying what you changed because of their feedback and what you most want their view on in the next round.`;
}

export function rankingPrompt(
  p: Project,
  rounds: RunRound[],
  insights: Pick<RunInsights, "themes" | "painPoints" | "requests">,
  teamCapacity: number,
  challenge?: { critique: Critique; draft: string },
) {
  const last = rounds[rounds.length - 1];
  const history = rounds
    .slice(0, -1)
    .map((r) => `Round ${r.round} feedback:\n${feedbackDigest(r.feedback, p.leads)}`)
    .join("\n\n");
  const picks = new Map<string, number>();
  for (const f of last.feedback) if (!f.error) picks.set(f.topPick, (picks.get(f.topPick) ?? 0) + 1);
  const budget = budgetTotals(last);
  const analysis = [
    budget.length ? `Budget points spent by all leads together: ${budget.map(([id, n]) => `${id} ${n}`).join(", ")}` : "",
    picks.size ? `First-choice votes: ${[...picks].map(([id, n]) => `${id} x${n}`).join(", ")}` : "",
    insights.themes.length ? `Recurring themes in the feedback text: ${insights.themes.map((t) => `${t.name} (${t.count})`).join(", ")}` : "",
    insights.painPoints.length ? `Pain points quoted: ${insights.painPoints.slice(0, 8).join(" | ")}` : "",
    insights.requests.length ? `Requests quoted: ${insights.requests.slice(0, 8).join(" | ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `${businessBrief(p)}
The feedback rounds are finished. Final feature list:

${featureList(last.features)}

Final round feedback:

${feedbackDigest(last.feedback, p.leads)}

${history ? `Earlier rounds, for context:\n\n${history}\n` : ""}${analysis ? `Automated analysis of the feedback:\n${analysis}\n` : ""}
Produce the prioritisation, using the roadmap-update skill's prioritisation guidance. For every feature in the final list give RICE inputs:
- reach: your estimate of how many of this business's customers and prospects it affects per quarter, as a number.
- impact: massive, high, medium, low or minimal, per affected customer.
- confidence: high, medium or low. Use lower confidence when leads disagreed or the evidence is thin.
- effort: xs (about 1 person-month), s (3), m (5), l (8) or xl (13).

A script computes the score from your inputs as reach x impact x confidence / effort and lays the features out quarter by quarter against a team capacity of ${teamCapacity} person-months per quarter, so make the inputs reflect your actual judgement. Explain each feature briefly, name the leads who most wanted it, and state the main concern raised.

Finish with a short recommendation of what to build next and why, including anything you would validate with real customers first.${
    challenge
      ? `

This is your second pass. Your first ranking was:

${challenge.draft}

A sceptic reviewed it and raised these challenges:

${critiqueText(challenge.critique)}

Go through the challenges. Where the sceptic is right, change the inputs, usually by lowering confidence or reach, or by re-scoping the feature in your rationale. Where the sceptic is wrong, keep your input and say why. Then report which points you accepted and which you rejected.

Return inputs for every feature in the final list, under its existing id, including the ones you did not change. Do not drop, merge or renumber features at this stage; if a feature should be cut or re-scoped, say so in its rationale and lower its inputs.`
      : ""
  }`;
}

function budgetTotals(round: RunRound): [string, number][] {
  const totals = new Map<string, number>();
  for (const f of round.feedback) {
    if (f.error) continue;
    for (const [id, pts] of finalPoints(f)) totals.set(id, (totals.get(id) ?? 0) + pts);
  }
  return [...totals].map(([id, n]) => [id, Math.round(n * 10) / 10] as [string, number]).sort((a, b) => b[1] - a[1]);
}

function critiqueText(c: Critique) {
  return (
    c.challenges.map((x) => `- [${x.severity}] ${x.featureId}, ${x.kind}: ${x.issue} Suggestion: ${x.suggestion}`).join("\n") +
    (c.weakLeads.length ? `\nLeads to weigh less: ${c.weakLeads.map((w) => `${w.lead} (${w.reason})`).join("; ")}` : "") +
    `\nOverall: ${c.overall}`
  );
}

// ---------- Sceptic agent (no tools, no skills) ----------

export const SCEPTIC_SYSTEM = `You are a sceptical reviewer of a product prioritisation. A developer agent has ranked a list of features using feedback from sales leads, and your job is to find where that ranking is weaker than it looks before anyone acts on it.

The leads are simulated from CRM profiles, some from a single line of text and some marked hypothetical, so their feedback is evidence of varying strength. The developer agent's reach, impact, confidence and effort figures are its own estimates. Look for: features whose position rests on one enthusiastic lead; support that comes mainly from leads with thin or hypothetical profiles; reach or effort numbers that nothing in the material supports; high confidence where the leads disagreed; objections that were raised and then dropped; and features that scored well only because nobody would object to them.

Be specific and fair. Name the feature, say what the evidence actually is, and say what should change. A challenge that could be made of any feature is not useful. If part of the ranking is well supported, say so in the overall assessment; do not invent problems to fill space.`;

export function scepticPrompt(p: Project, rounds: RunRound[], briefs: Record<string, PersonaBrief>, draft: string) {
  const last = rounds[rounds.length - 1];
  const budget = budgetTotals(last);
  return `${businessBrief(p)}
The leads, with what is known about each. The profile text is all the lead agents were given, apart from the background research where shown:

${leadsBlock(p, briefs)}

Final feature list:

${featureList(last.features)}

Final round feedback (scores are where each lead ended after hearing the others):

${feedbackDigest(last.feedback, p.leads)}
${budget.length ? `\nBudget points spent by all leads together: ${budget.map(([id, n]) => `${id} ${n}`).join(", ")}\n` : ""}
The developer agent's draft ranking, with its RICE inputs and the computed score:

${draft}

Challenge this ranking.`;
}

// ---------- Lead agents (no tools, no skills: an isolated, in-character reaction) ----------

export function leadSystem(p: Project, lead: Lead, brief?: PersonaBrief) {
  return `You are role-playing a specific sales lead of a business, to give its product team realistic customer feedback.

You are: ${leadLine(lead)}
${brief ? `\nBackground research on your company and role:\n${briefText(brief)}\n` : ""}
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

Give your reaction to every feature, using its id: a score from 1 (no value to me) to 5 (I need this), whether you would actually use it, and a short comment. List anything you would want that is missing, and give your overall take.

You also have a budget of ${POINT_BUDGET} points to spend across the features, as if it were your own money deciding what gets built. Spend all ${POINT_BUDGET}, in whole points, and give 0 to anything you would not pay for. The scores say how much you like each feature on its own; the budget forces the trade-off, so concentrate points on what matters most to you instead of spreading them evenly.

Then answer three things a concept test would ask: which single feature you would pick if only one could be built, how likely you would be to buy or expand if that one shipped, and one sentence in your own voice that sums up your reaction.`;
}

export function rebuttalPrompt(round: RunRound, own: LeadFeedback, leads: Lead[]) {
  const others = round.feedback.filter((f) => !f.error && f.leadId !== own.leadId);
  return `You gave your reaction to the round ${round.round} features. Here is what you said:

${feedbackEntry(own, leads)}

The other leads the product team consulted said this:

${others.map((f) => feedbackEntry(f, leads)).join("\n")}

For reference, the features:

${featureList(round.features)}

Having heard them, has anything changed for you? Other customers sometimes raise a use or a risk you had not considered, and sometimes they want things that would make the product worse for you. List only the features where you now score differently, or where you disagree with another lead strongly enough to say so, with your score and reason. If your view stands, return no revisions. If you would now spend your ${POINT_BUDGET}-point budget differently, give your full new allocation across the features (still adding up to ${POINT_BUDGET}); otherwise leave the reallocation empty. End with a short closing statement. Hold your own position where it reflects your real needs; agreeing for the sake of agreement helps nobody.`;
}
