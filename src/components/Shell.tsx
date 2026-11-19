"use client";

import { MotionConfig } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Projects", match: (p: string) => p === "/" || p.startsWith("/projects") || p.startsWith("/runs") },
  { href: "/settings", label: "Settings", match: (p: string) => p.startsWith("/settings") },
];

/** App chrome: sticky header with the current section marked, and motion settings for the whole tree. */
export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    // Transform animations are dropped for people who ask for reduced motion; opacity is kept.
    <MotionConfig reducedMotion="user">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur-md">
        <nav className="mx-auto flex h-14 max-w-6xl items-center gap-1 px-4" aria-label="Main">
          <Link href="/" className="mr-4 flex items-center gap-2 text-[15px] font-semibold tracking-tight" translate="no">
            <span aria-hidden="true" className="grid h-6 w-6 place-items-center rounded-md bg-text text-[11px] font-bold text-bg">
              FR
            </span>
            <span className="hidden sm:inline">Feature Research Platform</span>
          </Link>
          {NAV.map((item) => {
            const current = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${current ? "bg-surface-2 font-medium text-text" : "text-muted hover:text-text"}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:py-10">
        {children}
      </main>
    </MotionConfig>
  );
}
