# Vendored third-party skills and scripts

These files are copied unmodified from their upstream repositories so the app works after a plain clone. Each folder keeps its upstream licence.

| Folder | Upstream | Commit | Licence | Used by |
|---|---|---|---|---|
| `knowledge-work-plugins/product-management` | https://github.com/anthropics/knowledge-work-plugins | `e91a134` | Apache-2.0 | Developer agent |
| `knowledge-work-plugins/sales` | https://github.com/anthropics/knowledge-work-plugins | `e91a134` | Apache-2.0 | Persona brief agents |
| `claude-skills/product-manager-toolkit` | https://github.com/alirezarezvani/claude-skills | `f8593c4` | MIT | Ranking step (via `scripts/pm_toolkit_bridge.py`) |

Only a subset of each plugin is included:

- product-management: the `competitive-brief`, `product-brainstorming`, `synthesize-research` and `roadmap-update` skills.
- sales: the `account-research`, `lead-triage` and `stakeholder-map` skills.
- product-manager-toolkit: `rice_prioritizer.py` and `customer_interview_analyzer.py`.

The plugins' `.mcp.json` files are deliberately left out, so loading a plugin does not connect the agents to any external service (CRM, chat, email). The skills mention those connectors as optional; the agents run without them.

To update, copy the same paths from a newer upstream commit and change the commit column above.
