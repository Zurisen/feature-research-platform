# Design skills used on this UI

The UI was revised with the help of a few agent skills. They are development-time guidance for a coding agent, not part of the app, and are kept in `.claude/skills/` (git-ignored, so they are not redistributed here). To set them up again, copy the listed paths from each source.

| Skill | Source | What to copy | Notes |
|---|---|---|---|
| Taste Skill (v1) | https://github.com/Leonxlnx/taste-skill-classics (MIT) | `skills/taste-skill-v1/` | The current main Taste Skill is a 39 MB package with a Stop hook that drives a browser and is aimed at building marketing sites; the classic v1 is plain guidance and fits restyling an existing app. |
| Vercel web-design-guidelines | https://github.com/vercel-labs/agent-skills | `skills/web-design-guidelines/SKILL.md` | The skill fetches its rules at use time from `vercel-labs/web-interface-guidelines` (`command.md`); a copy is saved next to it. |
| Motion | https://github.com/motiondivision/ai-kit | `plugins/motion/skills/motion/` | Only the best-practices part works offline; the rest expects Motion's hosted MCP server, which is not connected. |
| Playwright CLI | https://github.com/microsoft/playwright-cli (Apache-2.0) | `skills/playwright-cli/`, plus `npm i -D @playwright/cli` | Used for screenshots at 1440x900 and 390x844. Uses the installed Chrome. |
| dataviz | Built into Claude Code | – | Chart form, colour roles and the palette validator. |

## Decisions that came out of them

- **Palette:** one warm-neutral gray family, one accent (teal), ink-coloured primary buttons. The earlier indigo accent was dropped. No pure black, no glows, no gradients.
- **Type:** Geist and Geist Mono; numbers that are compared use tabular monospace figures; headings use balanced wrapping.
- **Status:** always a dot plus a word, never colour alone.
- **Chart colours:** the ranking chart's two hues and the lead colours in the 3D view come from the dataviz reference palette in its validated order, with separate light and dark steps. Both chart hues pass the validator on this app's surfaces. Text never takes a series colour.
- **Ranking chart:** two bar panels sharing the feature rows (RICE score, and share of the leads' budget points) instead of one chart with two axes; values at the bar tips, a hover and focus tooltip per row, and the table underneath as the table view.
- **Motion:** staggered entrance on the project list and spring-in bars, with transform animations switched off for people who ask for reduced motion.
- **Interaction and accessibility:** visible focus rings, a skip link, loading skeletons sized like the content, a composed empty state, pressed states on buttons, `theme-color` for both schemes, and a single-column layout on phones.
