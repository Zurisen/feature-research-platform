"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import ProjectForm from "@/components/ProjectForm";
import { api } from "@/lib/client";
import type { Project } from "@/lib/types";

export default function EditProjectPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ project: Project }>(`/api/projects/${id}`).then((r) => setProject(r.project), (e) => setError(e.message));
  }, [id]);

  if (error) return <p className="text-sm text-bad">{error}</p>;
  if (!project) return <p className="hint">Loading…</p>;
  return <ProjectForm initial={project} />;
}
