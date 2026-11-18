import { spawn } from "node:child_process";
import path from "node:path";

// Runs the vendored product-manager-toolkit scripts (RICE scoring and feedback text analysis)
// through scripts/pm_toolkit_bridge.py. Python is optional: callers fall back when it is missing.

export type ToolkitFeature = {
  id: string;
  name: string;
  reach: number;
  impact: string;
  confidence: string;
  effort: string;
};

export type ToolkitResult = {
  rice?: {
    features: (ToolkitFeature & { rice_score: number })[];
    analysis: {
      total_effort_months?: number;
      quick_wins_list?: { id: string }[];
      big_bets_list?: { id: string }[];
    };
    roadmap: { quarter: number; features: { id: string }[] }[];
  };
  interviews?: {
    aggregate: {
      top_themes?: Record<string, number>;
      overall_sentiment?: { positive: number; neutral: number; negative: number };
      common_pain_points?: Record<string, string[]>;
      common_requests?: Record<string, string[]>;
    };
  };
};

const BRIDGE = path.join(process.cwd(), "scripts", "pm_toolkit_bridge.py");
const CANDIDATES: [string, string[]][] = process.env.PYTHON_PATH
  ? [[process.env.PYTHON_PATH, []]]
  : [
      ["python", []],
      ["py", ["-3"]],
      ["python3", []],
    ];

function runWith(cmd: string, args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [...args, BRIDGE], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill(), 30_000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(err.trim().split("\n").pop() || `exit code ${code}`));
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(input);
  });
}

/** Returns null (with a reason) when Python or the scripts are unavailable. */
export async function runToolkit(payload: {
  features: ToolkitFeature[];
  capacity: number;
  interviews: { id: string; text: string }[];
}): Promise<{ result: ToolkitResult | null; reason?: string }> {
  const input = JSON.stringify(payload);
  let reason = "Python was not found";
  for (const [cmd, args] of CANDIDATES) {
    try {
      return { result: JSON.parse(await runWith(cmd, args, input)) as ToolkitResult };
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") reason = err.message;
    }
  }
  return { result: null, reason };
}

// Same value tables as rice_prioritizer.py, used only when Python is unavailable.
const IMPACT: Record<string, number> = { massive: 3, high: 2, medium: 1, low: 0.5, minimal: 0.25 };
const CONFIDENCE: Record<string, number> = { high: 1, medium: 0.8, low: 0.5 };
export const EFFORT_MONTHS: Record<string, number> = { xl: 13, l: 8, m: 5, s: 3, xs: 1 };

export function builtInRice(f: ToolkitFeature) {
  return Math.round(((f.reach * (IMPACT[f.impact] ?? 1) * (CONFIDENCE[f.confidence] ?? 0.5)) / (EFFORT_MONTHS[f.effort] ?? 5)) * 100) / 100;
}
