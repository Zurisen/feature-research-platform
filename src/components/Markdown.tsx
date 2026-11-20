import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/** Inline mode: unwrap paragraphs so short agent text can sit inside a sentence or table cell. */
const inlineComponents: Components = {
  p: ({ children }) => <>{children}</>,
};

const linkComponents: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
};

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);

/**
 * Agents often open with their own heading ("## Recommendation") that repeats the section title the page
 * already shows. Drop that first heading when it matches the title.
 */
export function stripTitle(text: string, title?: string) {
  if (!title) return text;
  const m = text.match(/^\s*(?:#{1,6}\s+(.+?)\s*#*|\*\*(.+?)\*\*)\s*(?:\r?\n|$)/);
  if (!m) return text;
  const a = words(m[1] ?? m[2]).join(" ");
  const b = words(title).join(" ");
  const same = a === b || a.startsWith(b) || b.startsWith(a) || (a.split(" ").slice(0, 3).join(" ") === b.split(" ").slice(0, 3).join(" ") && a.split(" ").length >= 3);
  return same ? text.slice(m[0].length).replace(/^\s+/, "") : text;
}

/** Renders the Markdown that agents write (headings, lists, bold, tables, links) with the app's styles. */
export default function Markdown({
  children,
  inline = false,
  className = "",
  title,
}: {
  children?: string | null;
  inline?: boolean;
  className?: string;
  /** The heading the page shows above this text; a matching first heading in the text is dropped. */
  title?: string;
}) {
  if (!children) return null;
  children = stripTitle(children, title);
  const components = inline ? { ...linkComponents, ...inlineComponents } : linkComponents;
  const body = (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </ReactMarkdown>
  );
  return inline ? <span className={`md md-inline ${className}`}>{body}</span> : <div className={`md ${className}`}>{body}</div>;
}
