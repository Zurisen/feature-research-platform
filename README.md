# Feature Research Platform

Decide what to build next. A team of developer agents explores feature ideas for a business from several angles, one agent per sales lead reacts to them over several rounds, a sceptic agent challenges the result, and you get a ranked roadmap with honest uncertainty ranges: what to build, what to test with real customers first, and what to park. Each feature exports as a brief you can hand straight to a coding agent.

![Agents researching features for the sample project](docs-assets/agents-run.gif)

<sub>A run on the fictional sample project, sped up: the developer team in the glass sphere (lead developer, explorers and estimators), the lead agents around it, the sceptic, and messages travelling between them. It ends on the build / validate / park portfolio and the ranking with likely ranges.</sub>

It runs locally on your machine and uses your Claude Code login, so there is nothing to host and no API key to set up. Data stays in JSON files under `data/`.

## Run it

You need Node.js 20.9 or later and [Claude Code](https://claude.com/claude-code) installed and logged in on this machine. Python 3 is optional (see below).

```bash
npm install
npm run dev
```

Open http://localhost:3000 and load the sample project from the home page, or create your own.

Agents run through the [Claude Agent SDK](https://docs.claude.com/en/docs/agent-sdk/overview), which uses the Claude Code login on this machine by default. To use an Anthropic API key instead, copy `.env.example` to `.env.local`, set `ANTHROPIC_API_KEY`, and switch the mode in Settings.

The run page shows the estimated cost as it goes. A two-round run on the sample project costs about $0.25 with Claude Haiku; with the larger models and web research a run can cost a few dollars. Settings lets you pick the models and turn each extra step on or off: persona briefs, exploration, the leads' debate, the sceptic, the number of wildcards per round and the number of independent estimates.

## How a run works

1. **Persona briefs** (optional). One agent per lead researches the lead's company and role, using the `account-research`, `lead-triage` and `stakeholder-map` skills from Anthropic's sales plugin. Briefs are saved and reused in later runs while the lead is unchanged.
2. **Explore, then shortlist.** Four explorer agents each generate ideas from a different angle: customer jobs, competitive gaps, what the business's technology makes newly possible, and contrarian or adjacent bets. The developer agent merges them, researches the market (optionally with web search) and shortlists a varied set of candidate features, parking the rest. It uses the `competitive-brief` and `product-brainstorming` skills from Anthropic's product-management plugin. Without exploration, the developer agent researches on its own.
3. **Feedback rounds.** Each lead agent scores every feature from 1 to 5, spends a 10-point budget across them, names its single top pick and says how likely it would be to buy. Then (optional) every lead reads the others' positions and may revise or push back. The developer agent revises the list with the `synthesize-research` skill, drops what nobody wants and adds a **wildcard**: an untested idea from the parked pool or from what the leads said is missing, so the list keeps exploring. Early rounds may restructure boldly; the last revision only sharpens. This repeats for the chosen number of rounds.
4. **Draft ranking.** The developer agent gives RICE inputs for the final list (`roadmap-update` skill) three times independently, and the median is kept for each feature. `rice_prioritizer.py` computes the scores.
5. **Sceptic review** (optional). A sceptic agent looks for rankings that rest on one lead, guessed estimates and ignored objections. The developer agent answers each point and produces the final ranking, and the page shows what moved. The answer can lower a feature's score but not raise it above every independent estimate.
6. **Ranges and portfolio.** Resampling the leads and the independent estimates gives each feature a likely score and rank range. The ranking is ordered by the low end of that range, so a feature only ranks high if it holds up when the least enthusiastic leads and the most cautious estimate count. Every feature lands on a track: **build**, **validate first** (with a cheap test to run with real customers) or **park**, and the build and validate features are laid out quarter by quarter against the team capacity.

Why the ranges matter: re-scoring the same feature list three times gave nearly identical lead scores but RICE estimates up to 16 times apart for the same feature, so a single estimate is mostly noise. With the median of three and conservative ordering, the top of the ranking became stable across reruns.

While a run is in progress you can:

- **Watch it** in a live 3D view: the developer team is a glass sphere with its agents (lead developer, explorers, estimators) moving inside, surrounded by the lead agents and the sceptic, each with its current state and activity.
- **Send notes** to the agents. A liaison agent restates your note with the run's context and passes it to the developer agent, and to the leads when you want something asked of them.
- **Cancel, resume or extend it.** Finished steps are never repeated, so a failed run resumes where it stopped, and a finished one can get another round.

## From ranking to code

Each ranked feature has **Copy brief** and **Download .md** buttons. The brief holds the feature, why it ranks where it does, what each lead said, the risks and the sceptic's challenges, your notes and the product context, plus instructions for a coding agent. Paste it into a Claude Code session opened in the repository where the feature will be built: it explores the code, proposes a plan and acceptance criteria, and checks them with you before writing code.

Lead agents are simulated from profile data. Treat the ranking as a way to focus real customer conversations, not as a replacement for them.

## Data sources

- **Manual**: describe the business and at least 5 leads.
- **Sample**: the home page offers to load the fictional project in `samples/traillog.json`.
- **Apollo.io**: OAuth connection (see Settings for the registration steps and `.env.example` for the variables). Apollo must approve the OAuth app and requires an https redirect URL, so `APOLLO_API_KEY` is supported as a development fallback. Importing the business profile costs 1 Apollo credit; loading saved contacts is free but needs a paid Apollo plan. Emails and phone numbers are not imported. This integration has not yet been tested against a live Apollo account.

## Third-party skills and scripts

The skills and scripts above are vendored under `vendor/` with their licences; see `vendor/README.md` for sources and commits. The plugins' connector configuration is left out, so agents never connect to a CRM, chat or email. Lead agents get no skills or tools at all.

The two Python scripts need Python 3 on the PATH (or `PYTHON_PATH` in `.env.local`). Without Python, scores come from a built-in copy of the same formula and the text analysis is skipped.

## Layout

- `src/lib/engine.ts`: runs one agent turn through the Agent SDK (local login or API key), with structured output.
- `src/lib/orchestrator.ts`: the run pipeline (briefs, exploration, research, feedback, revision, ranking, sceptic, notes); every step is checkpointed so runs can resume.
- `src/lib/prompts.ts`: prompts for the explorer, developer, lead, sceptic and liaison agents.
- `src/lib/brief.ts`: builds the per-feature briefs.
- `src/lib/uncertainty.ts`: resampling, likely ranges, conservative ordering and the quarter plan.
- `src/lib/apollo.ts`: Apollo OAuth and API calls.
- `src/lib/toolkit.ts` and `scripts/pm_toolkit_bridge.py`: run the vendored Python scripts.
- `src/lib/scene.ts` and `src/components/AgentScene.tsx`: the live 3D agent view (three.js, react-three-fiber).
- `src/lib/store.ts`: JSON-file persistence.
- `src/app`: pages and API routes.

## License

Apache License 2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE). The third-party skills and scripts under `vendor/` keep their own licences (Apache 2.0 and MIT).

## Support

If this saves you time, you can buy me a coffee:

<a href="https://buymeacoffee.com/zurisen"><img src="https://img.shields.io/badge/Buy%20me%20a%20coffee-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=000000" alt="Buy me a coffee" height="36"></a>
