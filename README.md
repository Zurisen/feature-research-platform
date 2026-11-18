# Feature Research Platform

Decide what to build next. A developer agent researches feature ideas for a business, one agent per sales lead reacts to them over several rounds, and the developer agent produces a ranked list.

This is the first, local iteration: single user, no login, data in JSON files under `data/`.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. Agents run through the Claude Agent SDK, which uses the Claude Code login on this machine by default, so no API key is needed. To use an Anthropic API key instead, copy `.env.example` to `.env.local`, set `ANTHROPIC_API_KEY`, and switch the mode in Settings.

## How a run works

1. **Persona briefs** (optional). One agent per lead researches the lead's company and role, using the `account-research`, `lead-triage` and `stakeholder-map` skills from Anthropic's sales plugin. It researches the company and the role, not the individual.
2. **Research.** The developer agent researches the business (optionally with web search) and proposes candidate features, using the `competitive-brief` and `product-brainstorming` skills from Anthropic's product-management plugin.
3. **Feedback rounds.** Each lead agent scores and comments on every feature, names its single top pick and how likely it would be to buy. Then (optional) every lead reads the others' positions and may revise or push back. The developer agent revises the list with the `synthesize-research` skill and sends a note back. This repeats for the chosen number of rounds.
4. **Ranking.** The developer agent gives RICE inputs for the final list (`roadmap-update` skill). `rice_prioritizer.py` computes the scores, flags quick wins and big bets, and lays the features out quarter by quarter against the team capacity. `customer_interview_analyzer.py` pulls recurring words, pain points and requests out of the feedback text.

While a run is in progress, the run page shows a live 3D view of the agents: the developer agent in the centre, the leads around it, each with its current state and activity, and messages travelling between them.

Lead agents are simulated from profile data. Treat the ranking as a way to focus real customer conversations, not as a replacement for them.

## Third-party skills and scripts

The skills and scripts above are vendored under `vendor/` with their licences; see `vendor/README.md` for sources and commits. The plugins' connector configuration is left out, so agents never connect to a CRM, chat or email. Lead agents get no skills or tools at all.

The two Python scripts need Python 3 on the PATH (or `PYTHON_PATH` in `.env.local`). Without Python, scores come from a built-in copy of the same formula and the text analysis is skipped.

## Data sources

- **Manual**: describe the business and at least 5 leads.
- **Sample**: with no projects yet, the home page offers to load the fictional project in `samples/traillog.json`.
- **Apollo.io**: OAuth connection (see Settings for the registration steps and `.env.example` for the variables). Apollo must approve the OAuth app and requires an https redirect URL, so `APOLLO_API_KEY` is supported as a development fallback. Importing the business profile costs 1 Apollo credit; loading saved contacts is free but needs a paid Apollo plan. Emails and phone numbers are not imported.

## Layout

- `src/lib/engine.ts`: runs one agent turn through the Agent SDK (local login or API key), with structured output.
- `src/lib/orchestrator.ts`: the research, feedback, revision and ranking loop.
- `src/lib/prompts.ts`: prompts for the developer and lead agents.
- `src/lib/apollo.ts`: Apollo OAuth and API calls.
- `src/lib/toolkit.ts` and `scripts/pm_toolkit_bridge.py`: run the vendored Python scripts.
- `src/lib/scene.ts` and `src/components/AgentScene.tsx`: the live 3D agent view (three.js, react-three-fiber).
- `src/lib/store.ts`: JSON-file persistence.
- `src/app`: pages and API routes.
