const LABEL: Record<string, string> = { running: "Running", completed: "Completed", failed: "Failed", cancelled: "Cancelled" };

/** Run status as a dot plus a word, so the state never depends on colour alone. */
export function StatusBadge({ status }: { status: string }) {
  const color = status === "completed" ? "text-good" : status === "failed" ? "text-bad" : status === "cancelled" ? "text-warn" : "text-accent";
  return (
    <span className="badge">
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full bg-current ${color} ${status === "running" ? "live-dot" : ""}`} />
      {LABEL[status] ?? status}
    </span>
  );
}
