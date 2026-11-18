"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApolloStatus } from "@/lib/client";
import { Business, Lead, MIN_MANUAL_LEADS, Project } from "@/lib/types";

const uid = () => Math.random().toString(36).slice(2, 10);
const emptyLead = (): Lead => ({ id: uid(), name: "", title: "", company: "", industry: "", companySize: "", location: "", notes: "" });
const emptyBusiness: Business = { name: "", website: "", industry: "", employees: "", description: "" };

/** Create form, or edit form when `initial` is given. */
export default function ProjectForm({ initial }: { initial?: Project }) {
  const router = useRouter();
  const [apollo, setApollo] = useState<ApolloStatus | null>(null);
  const [source, setSource] = useState<"apollo" | "manual">(initial?.source ?? "manual");
  const [name, setName] = useState(initial?.name ?? "");
  const [business, setBusiness] = useState<Business>(initial?.business ?? emptyBusiness);
  const [focusArea, setFocusArea] = useState(initial?.focusArea ?? "");
  const [extraContext, setExtraContext] = useState(initial?.extraContext ?? "");
  const [leads, setLeads] = useState<Lead[]>(() => initial?.leads ?? Array.from({ length: MIN_MANUAL_LEADS }, emptyLead));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Apollo import state
  const [domain, setDomain] = useState("");
  const [keywords, setKeywords] = useState("");
  const [found, setFound] = useState<Lead[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"" | "business" | "leads">("");
  const [apolloError, setApolloError] = useState("");

  useEffect(() => {
    api<ApolloStatus>("/api/apollo/status").then(setApollo, () => setApollo(null));
  }, []);

  const chooseSource = (s: "apollo" | "manual") => {
    setSource(s);
    // Apollo projects start with an empty lead list that is filled from the import.
    setLeads((cur) => {
      const filled = cur.filter((l) => l.name || l.title || l.notes || l.company);
      if (s === "apollo") return filled;
      return filled.length >= MIN_MANUAL_LEADS
        ? filled
        : [...filled, ...Array.from({ length: MIN_MANUAL_LEADS - filled.length }, emptyLead)];
    });
  };

  const setB = (k: keyof Business) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setBusiness({ ...business, [k]: e.target.value });
  const setLead = (id: string, k: keyof Lead, v: string) =>
    setLeads((cur) => cur.map((l) => (l.id === id ? { ...l, [k]: v } : l)));

  async function importBusiness() {
    setBusy("business");
    setApolloError("");
    try {
      const r = await api<{ business: Business }>("/api/apollo/import", { json: { kind: "business", domain } });
      setBusiness(r.business);
      if (!name) setName(`${r.business.name} roadmap`);
    } catch (e) {
      setApolloError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function searchLeads() {
    setBusy("leads");
    setApolloError("");
    try {
      const r = await api<{ leads: Lead[] }>("/api/apollo/import", { json: { kind: "leads", keywords } });
      setFound(r.leads);
      setPicked(new Set());
    } catch (e) {
      setApolloError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  function addPicked() {
    const have = new Set(leads.map((l) => l.id));
    setLeads([...leads, ...(found ?? []).filter((l) => picked.has(l.id) && !have.has(l.id))]);
    setPicked(new Set());
  }

  const minLeads = source === "manual" ? MIN_MANUAL_LEADS : 1;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const p = await api<Project>(initial ? `/api/projects/${initial.id}` : "/api/projects", {
        method: initial ? "PUT" : "POST",
        json: { name: name || `${business.name} roadmap`, source, business, focusArea, extraContext, leads },
      });
      router.push(`/projects/${p.id}`);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <h1 className="text-2xl font-semibold">{initial ? "Edit project" : "New project"}</h1>

      <section className="card">
        <label className="label" htmlFor="pname">Project name</label>
        <input id="pname" className="input max-w-md" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mobile app roadmap" />
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Where does the data come from?</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {(["apollo", "manual"] as const).map((s) => (
            <label
              key={s}
              className={`cursor-pointer rounded-lg border p-3 ${source === s ? "border-accent bg-accent-soft" : "border-border"} ${s === "apollo" && !apollo?.usable ? "opacity-60" : ""}`}
            >
              <input
                type="radio"
                name="source"
                className="mr-2"
                checked={source === s}
                disabled={s === "apollo" && !apollo?.usable}
                onChange={() => chooseSource(s)}
              />
              <span className="font-medium">{s === "apollo" ? "Apollo.io" : "Type it in"}</span>
              <p className="hint mt-1">
                {s === "apollo"
                  ? "Import your business profile and saved contacts from Apollo."
                  : `Describe the business and at least ${MIN_MANUAL_LEADS} leads yourself.`}
              </p>
            </label>
          ))}
        </div>
        {apollo && !apollo.usable && (
          <p className="hint">
            Apollo is not connected yet. Set it up in <Link href="/settings" className="text-accent underline">Settings</Link>.
          </p>
        )}
      </section>

      <section className="card space-y-4">
        <h2 className="font-semibold">Business</h2>
        {source === "apollo" && (
          <div className="rounded-lg border border-border p-3">
            <label className="label" htmlFor="domain">Import from Apollo</label>
            <div className="flex flex-wrap gap-2">
              <input id="domain" className="input max-w-xs" placeholder="Company domain (blank = my account's)" value={domain} onChange={(e) => setDomain(e.target.value)} />
              <button type="button" className="btn" onClick={importBusiness} disabled={busy !== ""}>
                {busy === "business" ? "Importing…" : "Import business profile"}
              </button>
            </div>
            <p className="hint mt-1">Uses 1 Apollo credit per import. You can edit everything afterwards.</p>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="bname">Company name</label>
            <input id="bname" className="input" required value={business.name} onChange={setB("name")} />
          </div>
          <div>
            <label className="label" htmlFor="bweb">Website</label>
            <input id="bweb" className="input" value={business.website} onChange={setB("website")} />
          </div>
          <div>
            <label className="label" htmlFor="bind">Industry</label>
            <input id="bind" className="input" value={business.industry} onChange={setB("industry")} />
          </div>
          <div>
            <label className="label" htmlFor="bemp">Employees</label>
            <input id="bemp" className="input" value={business.employees} onChange={setB("employees")} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="bdesc">What the business does</label>
          <textarea id="bdesc" className="input" rows={4} required value={business.description} onChange={setB("description")} placeholder="Product, customers, business model, what makes it different." />
        </div>
        <div>
          <label className="label" htmlFor="focus">Area to develop <span className="hint font-normal">(optional)</span></label>
          <textarea id="focus" className="input" rows={2} value={focusArea} onChange={(e) => setFocusArea(e.target.value)} placeholder="e.g. the mobile app onboarding, reporting for enterprise customers" />
        </div>
        <div>
          <label className="label" htmlFor="extra">Extra context for the research <span className="hint font-normal">(optional)</span></label>
          <textarea id="extra" className="input" rows={3} value={extraContext} onChange={(e) => setExtraContext(e.target.value)} placeholder="Constraints, known competitors, things already tried, roadmap commitments." />
        </div>
      </section>

      <section className="card space-y-4">
        <div>
          <h2 className="font-semibold">Leads</h2>
          <p className="hint">
            Each lead becomes its own agent that reviews the proposed features. At least {minLeads} needed; a job title or a
            description is the minimum for each.{initial ? " Changes apply to new runs; earlier runs keep their results." : ""}
          </p>
        </div>

        {source === "apollo" && (
          <div className="rounded-lg border border-border p-3 space-y-3">
            <div className="flex flex-wrap gap-2">
              <input className="input max-w-xs" placeholder="Filter by keyword (optional)" aria-label="Contact keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
              <button type="button" className="btn" onClick={searchLeads} disabled={busy !== ""}>
                {busy === "leads" ? "Searching…" : "Load contacts from Apollo"}
              </button>
              {found && picked.size > 0 && (
                <button type="button" className="btn btn-primary" onClick={addPicked}>Add {picked.size} selected</button>
              )}
            </div>
            {found && found.length === 0 && <p className="hint">No saved contacts matched.</p>}
            {found && found.length > 0 && (
              <ul className="max-h-64 divide-y divide-border overflow-auto rounded-lg border border-border">
                {found.map((l) => (
                  <li key={l.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={picked.has(l.id)}
                        onChange={(e) => {
                          const next = new Set(picked);
                          if (e.target.checked) next.add(l.id);
                          else next.delete(l.id);
                          setPicked(next);
                        }}
                      />
                      <span className="font-medium">{l.name || "Unnamed"}</span>
                      <span className="text-muted">{[l.title, l.company].filter(Boolean).join(" · ")}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <p className="hint">Emails and phone numbers are not imported.</p>
          </div>
        )}
        {apolloError && <p className="text-sm text-bad">{apolloError}</p>}

        <div className="space-y-3">
          {leads.map((l, i) => (
            <div key={l.id} className="rounded-lg border border-border p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">Lead {i + 1}</span>
                <button type="button" className="btn btn-danger" onClick={() => setLeads(leads.filter((x) => x.id !== l.id))} disabled={leads.length <= minLeads && source === "manual"}>
                  Remove
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <input className="input" placeholder="Name" aria-label={`Lead ${i + 1} name`} value={l.name} onChange={(e) => setLead(l.id, "name", e.target.value)} />
                <input className="input" placeholder="Job title" aria-label={`Lead ${i + 1} job title`} value={l.title} onChange={(e) => setLead(l.id, "title", e.target.value)} />
                <input className="input" placeholder="Company" aria-label={`Lead ${i + 1} company`} value={l.company} onChange={(e) => setLead(l.id, "company", e.target.value)} />
                <input className="input" placeholder="Industry" aria-label={`Lead ${i + 1} industry`} value={l.industry} onChange={(e) => setLead(l.id, "industry", e.target.value)} />
                <input className="input" placeholder="Company size" aria-label={`Lead ${i + 1} company size`} value={l.companySize} onChange={(e) => setLead(l.id, "companySize", e.target.value)} />
                <input className="input" placeholder="Location" aria-label={`Lead ${i + 1} location`} value={l.location} onChange={(e) => setLead(l.id, "location", e.target.value)} />
              </div>
              <textarea className="input mt-2" rows={2} placeholder="Description: what they do, what they care about, where they are in the deal" aria-label={`Lead ${i + 1} description`} value={l.notes} onChange={(e) => setLead(l.id, "notes", e.target.value)} />
            </div>
          ))}
        </div>
        <button type="button" className="btn" onClick={() => setLeads([...leads, emptyLead()])}>Add lead</button>
      </section>

      {error && <p className="text-sm text-bad" role="alert">{error}</p>}
      <div className="flex gap-3">
        <button className="btn btn-primary" disabled={saving}>
          {saving ? "Saving…" : initial ? "Save changes" : "Create project"}
        </button>
        <Link href={initial ? `/projects/${initial.id}` : "/"} className="btn">Cancel</Link>
      </div>
    </form>
  );
}
