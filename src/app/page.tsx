"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, fmtDate } from "@/lib/client";
import type { Project } from "@/lib/types";

export default function Home() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Project[]>("/api/projects").then(setProjects, (e) => setError(e.message));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="hint mt-1 max-w-2xl">
            Describe a business and its leads. A developer agent researches what to build, an agent for each lead
            reacts to the ideas, and you get a ranked list of features.
          </p>
        </div>
        <Link href="/projects/new" className="btn btn-primary">
          New project
        </Link>
      </div>

      {error && <p className="text-sm text-bad">{error}</p>}
      {projects && projects.length === 0 && (
        <div className="card text-center">
          <p className="font-medium">No projects yet</p>
          <p className="hint mt-1">Create one from Apollo.io data, or type the business and five leads by hand.</p>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {projects?.map((p) => (
          <Link key={p.id} href={`/projects/${p.id}`} className="card block hover:border-muted">
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-semibold">{p.name}</h2>
              <span className="badge">{p.source === "apollo" ? "Apollo" : "Manual"}</span>
            </div>
            <p className="hint mt-1">
              {p.business.name} · {p.leads.length} leads · {fmtDate(p.createdAt)}
            </p>
            {p.focusArea && <p className="mt-2 line-clamp-2 text-sm">{p.focusArea}</p>}
          </Link>
        ))}
      </div>
    </div>
  );
}
