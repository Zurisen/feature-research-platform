import { promises as fs } from "node:fs";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { DATA_DIR } from "./store";
import { Settings } from "./types";

// One agent turn = one headless Claude Code session driven through the Agent SDK.
// authMode "local" reuses the Claude Code login on this machine; "apiKey" uses ANTHROPIC_API_KEY.
// Agents get no file or shell tools: only web search/fetch when `web` is set, and the Skill tool when
// a vendored plugin is attached (see vendor/README.md).

const PLUGIN_DIR = path.join(process.cwd(), "vendor", "knowledge-work-plugins");

export type AgentSkills = { plugin: "product-management" | "sales"; names: string[] };

export type AgentCall<T> = {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  model: string;
  web?: boolean;
  skills?: AgentSkills;
  authMode: Settings["authMode"];
  signal: AbortSignal;
  onActivity?: (text: string) => void;
};

function agentEnv(authMode: Settings["authMode"]): Record<string, string | undefined> {
  // Drop variables that would make the child think it is nested inside another Claude Code session.
  const { ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, CLAUDECODE, CLAUDE_CODE_ENTRYPOINT, ...rest } = process.env;
  void CLAUDECODE;
  void CLAUDE_CODE_ENTRYPOINT;
  if (authMode === "apiKey") {
    if (!ANTHROPIC_API_KEY) throw new Error("Auth mode is API key, but ANTHROPIC_API_KEY is not set in .env.local.");
    return { ...rest, ANTHROPIC_API_KEY };
  }
  // In headless mode a present API key always wins, so it is removed to force the local login.
  void ANTHROPIC_AUTH_TOKEN;
  return rest;
}

export async function runAgent<T>(call: AgentCall<T>): Promise<{ data: T; costUsd: number }> {
  const cwd = path.join(DATA_DIR, "agent-cwd");
  await fs.mkdir(cwd, { recursive: true });

  const abortController = new AbortController();
  const onAbort = () => abortController.abort();
  if (call.signal.aborted) throw new Error("Cancelled");
  call.signal.addEventListener("abort", onAbort, { once: true });

  const tools = [...(call.web ? ["WebSearch", "WebFetch"] : []), ...(call.skills ? ["Skill"] : [])];
  const pluginOptions = call.skills
    ? {
        plugins: [{ type: "local" as const, path: path.join(PLUGIN_DIR, call.skills.plugin) }],
        // Only the listed skills are visible to the agent; names are namespaced by plugin.
        skills: call.skills.names.map((n) => `${call.skills!.plugin}:${n}`),
      }
    : {};
  try {
    const stream = query({
      prompt: call.prompt,
      options: {
        systemPrompt: call.system,
        model: call.model,
        tools,
        allowedTools: tools,
        permissionMode: "dontAsk",
        settingSources: [], // do not load the user's CLAUDE.md, skills, hooks or MCP servers
        maxTurns: call.web ? 50 : call.skills ? 16 : 6,
        ...pluginOptions,
        cwd,
        env: agentEnv(call.authMode),
        abortController,
        outputFormat: {
          type: "json_schema",
          schema: z.toJSONSchema(call.schema, { target: "draft-7" }) as Record<string, unknown>,
        },
        ...(process.env.CLAUDE_CODE_PATH ? { pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_PATH } : {}),
      },
    });

    for await (const m of stream) {
      if (m.type === "assistant" && call.onActivity) {
        for (const block of m.message.content) {
          if (block.type !== "tool_use") continue;
          const input = block.input as { query?: string; url?: string; skill?: string };
          if (block.name === "Skill" && input.skill) call.onActivity(`Using skill ${input.skill.split(":").pop()}`);
          if (block.name === "WebSearch" && input.query) call.onActivity(`Searching the web: ${input.query}`);
          else if (block.name === "WebFetch" && input.url) call.onActivity(`Reading ${input.url}`);
        }
      }
      if (m.type === "result") {
        if (m.subtype !== "success" || m.is_error) {
          const detail = m.subtype === "success" ? m.result : (m.errors ?? []).join("; ");
          throw new Error(`Agent run failed (${m.subtype})${detail ? `: ${detail}` : ""}`);
        }
        const parsed = call.schema.safeParse(m.structured_output);
        if (!parsed.success) {
          throw new Error(`Agent returned output that does not match the schema: ${parsed.error.issues[0]?.message ?? ""}`);
        }
        return { data: parsed.data, costUsd: m.total_cost_usd ?? 0 };
      }
    }
    throw new Error(call.signal.aborted ? "Cancelled" : "Agent ended without a result.");
  } finally {
    call.signal.removeEventListener("abort", onAbort);
  }
}
