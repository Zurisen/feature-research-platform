# LeadLoop

Decide what to build next. A developer agent researches feature ideas for a business, one agent per sales lead reacts to them over several rounds, and the developer agent produces a ranked list.

This is the first, local iteration: single user, no login, data in JSON files under `data/`.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. Agents run through the Claude Agent SDK, which uses the Claude Code login on this machine by default, so no API key is needed. To use an Anthropic API key instead, copy `.env.example` to `.env.local`, set `ANTHROPIC_API_KEY`, and switch the mode in Settings.

## How a run works

1. The developer agent researches the business (optionally with web search) and proposes candidate features.
2. Each lead agent, built from that lead's profile, scores and comments on every feature.
3. The developer agent revises the list from the feedback and sends a note back to the leads. Steps 2 and 3 repeat for the chosen number of rounds.
4. The developer agent gives RICE inputs for the final list. The app computes the score (reach x impact x confidence / effort) and shows it next to the average lead score.

Lead agents are simulated from profile data. Treat the ranking as a way to focus real customer conversations, not as a replacement for them.

## Data sources

- **Manual**: describe the business and at least 5 leads.
- **Apollo.io**: OAuth connection (see Settings for the registration steps and `.env.example` for the variables). Apollo must approve the OAuth app and requires an https redirect URL, so `APOLLO_API_KEY` is supported as a development fallback. Importing the business profile costs 1 Apollo credit; loading saved contacts is free but needs a paid Apollo plan. Emails and phone numbers are not imported.

## Layout

- `src/lib/engine.ts`: runs one agent turn through the Agent SDK (local login or API key), with structured output.
- `src/lib/orchestrator.ts`: the research, feedback, revision and ranking loop.
- `src/lib/prompts.ts`: prompts for the developer and lead agents.
- `src/lib/apollo.ts`: Apollo OAuth and API calls.
- `src/lib/store.ts`: JSON-file persistence.
- `src/app`: pages and API routes.
