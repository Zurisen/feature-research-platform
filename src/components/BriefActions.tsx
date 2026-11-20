"use client";

import { useState } from "react";
import { allBriefs, briefFileName, featureBrief } from "@/lib/brief";
import type { Project, Run } from "@/lib/types";

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for browsers that block the async clipboard API.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function useCopied() {
  const [copied, setCopied] = useState(false);
  return {
    copied,
    async copy(text: string) {
      await copyText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    },
  };
}

/** Copy or download one feature as a brief to paste into a Claude Code session in the target repository. */
export function FeatureBriefActions({ run, project, featureId, title }: { run: Run; project: Project | null; featureId: string; title: string }) {
  const { copied, copy } = useCopied();
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => copy(featureBrief(run, project, featureId))}
        title="Copies a Markdown brief with the feature, the lead feedback, the risks and the product context, ready to paste into Claude Code"
      >
        {copied ? "Copied" : "Copy brief"}
      </button>
      <button type="button" className="btn btn-sm" onClick={() => download(briefFileName(project, title), featureBrief(run, project, featureId))}>
        Download .md
      </button>
      <span className="sr-only" aria-live="polite">{copied ? `Brief for ${title} copied` : ""}</span>
    </div>
  );
}

/** Every ranked feature as one Markdown document. */
export function AllBriefsActions({ run, project }: { run: Run; project: Project | null }) {
  const { copied, copy } = useCopied();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn btn-sm" onClick={() => copy(allBriefs(run, project))}>
        {copied ? "Copied" : "Copy all briefs"}
      </button>
      <button type="button" className="btn btn-sm" onClick={() => download(briefFileName(project, "feature-briefs"), allBriefs(run, project))}>
        Download all (.md)
      </button>
    </div>
  );
}
