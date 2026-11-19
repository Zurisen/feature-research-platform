"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, fmtDate } from "@/lib/client";
import type { Project } from "@/lib/types";

const list = { show: { transition: { staggerChildren: 0.06 } } };
const item = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 220, damping: 26 } } };

export default function Home() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Project[]>("/api/projects").then(setProjects, (e) => setError(e.message));
  }, []);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-semibold sm:text-3xl">Projects</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">
            Describe a business and its leads. A developer agent researches what to build, an agent for each lead pushes back,
            and you get a ranked list of features with the evidence behind it.
          </p>
        </div>
        <Link href="/projects/new" className="btn btn-primary">
          New Project
        </Link>
      </div>

      {error && (
        <p className="text-sm text-bad" role="alert">
          {error} Check that the app server is running, then reload.
        </p>
      )}

      {!projects && !error && (
        <div className="grid gap-4 md:grid-cols-2" aria-busy="true" aria-label="Loading projects…">
          <div className="skeleton h-32" />
          <div className="skeleton h-32" />
        </div>
      )}

      {projects && projects.length === 0 && (
        <div className="grid items-center gap-6 rounded-[14px] border border-dashed border-border-strong p-8 md:grid-cols-[1.4fr_1fr]">
          <div>
            <h2 className="text-lg font-semibold">No projects yet</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              Start from your own business and at least 5 leads, or load the fictional sample to see a full run first.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 md:justify-end">
            <button
              className="btn"
              onClick={() => api<Project>("/api/projects/sample", { method: "POST" }).then((p) => setProjects([p]), (e) => setError(e.message))}
            >
              Load the Sample Project
            </button>
            <Link href="/projects/new" className="btn btn-primary">
              New Project
            </Link>
          </div>
        </div>
      )}

      {projects && projects.length > 0 && (
        <motion.ul variants={list} initial="hidden" animate="show" className="grid gap-4 md:grid-cols-2">
          {projects.map((p) => (
            <motion.li key={p.id} variants={item}>
              <Link href={`/projects/${p.id}`} className="card block h-full">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="min-w-0 text-[17px] font-semibold leading-snug">{p.name}</h2>
                  <span className="badge">{p.source === "apollo" ? "Apollo" : "Manual"}</span>
                </div>
                <p className="mt-1 text-sm text-muted">{p.business.name}</p>
                {p.focusArea && <p className="mt-3 line-clamp-2 text-sm leading-relaxed">{p.focusArea}</p>}
                <dl className="mt-4 flex gap-6 border-t border-border pt-3 text-sm">
                  <div>
                    <dt className="hint">Leads</dt>
                    <dd className="num font-medium">{p.leads.length}</dd>
                  </div>
                  <div>
                    <dt className="hint">Created</dt>
                    <dd className="font-medium">{fmtDate(p.createdAt)}</dd>
                  </div>
                </dl>
              </Link>
            </motion.li>
          ))}
        </motion.ul>
      )}
    </div>
  );
}
