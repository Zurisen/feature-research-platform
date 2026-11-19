"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import type { Run } from "@/lib/types";

/** Lets the person watching a run send notes to the agents, and shows how each note was passed on. */
export default function NotesPanel({ run, onSent }: { run: Run; onSent: () => void }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const notes = run.notes ?? [];
  const running = run.status === "running";

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    setError("");
    try {
      await api(`/api/runs/${run.id}/notes`, { json: { text } });
      setText("");
      onSent();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="card space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Your Notes to the Agents</h2>
        <p className="hint mt-1 max-w-[70ch]">
          Add a correction, a constraint, an idea or a doubt at any point. A liaison agent restates it with the run&apos;s context and passes
          it to the developer agent, and to the leads when you want something asked of them.{" "}
          {running
            ? "It reaches every step that starts after it is processed; a step already in progress is not interrupted."
            : "This run is not in progress, so notes take effect when you resume it or add another round."}
        </p>
      </div>

      <form onSubmit={send} className="space-y-2">
        <label className="label" htmlFor="note">
          New note
        </label>
        <textarea
          id="note"
          name="note"
          className="input"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Drop anything that needs new hardware, and ask the leads what they would pay for heatmaps…"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) e.currentTarget.form?.requestSubmit();
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn btn-primary" disabled={sending || !text.trim()}>
            {sending ? "Sending…" : "Send Note"}
          </button>
          <span className="hint">Ctrl + Enter to send</span>
          {error && (
            <span className="text-sm text-bad" role="alert">
              {error}
            </span>
          )}
        </div>
      </form>

      {notes.length > 0 && (
        <ol className="divide-y divide-border border-t border-border" aria-live="polite">
          {[...notes].reverse().map((n) => (
            <li key={n.id} className="space-y-2 py-4 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 break-words font-medium">{n.text}</p>
                <span className="hint shrink-0">{new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date(n.ts))}</span>
              </div>
              {n.status === "processing" && (
                <p className="hint flex items-center gap-2">
                  <span aria-hidden="true" className="live-dot h-1.5 w-1.5 rounded-full bg-accent" />
                  The liaison agent is working out how to pass this on…
                </p>
              )}
              {n.status === "failed" && <p className="text-bad">Could not be processed: {n.error} Send it again to retry.</p>}
              {n.status === "ready" && n.brief && (
                <dl className="space-y-2 rounded-lg bg-surface-2 p-3">
                  <div>
                    <dt className="hint">Understood as</dt>
                    <dd>{n.brief.interpretation}</dd>
                  </div>
                  {n.brief.forDeveloper.trim() && (
                    <div>
                      <dt className="hint">Told the developer agent</dt>
                      <dd>{n.brief.forDeveloper}</dd>
                    </div>
                  )}
                  {n.brief.forLeads.trim() && (
                    <div>
                      <dt className="hint">Put to the leads</dt>
                      <dd>{n.brief.forLeads}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="hint">Used in</dt>
                    <dd>{n.usedIn.length ? n.usedIn.join(", ") : running ? "Waiting for the next step to start" : "Not used yet"}</dd>
                  </div>
                </dl>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
