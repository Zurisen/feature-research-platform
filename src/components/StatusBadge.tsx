export function StatusBadge({ status }: { status: string }) {
  const color =
    status === "completed" ? "text-good" : status === "failed" ? "text-bad" : status === "cancelled" ? "text-warn" : "text-accent";
  return <span className={`badge ${color}`}>{status}</span>;
}
