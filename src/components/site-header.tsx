import Link from "next/link";
import { REPO_URL } from "@/lib/site";
import { Logo } from "./logo";

const NAV = [
  { href: "/#checks", label: "Checks", wide: false },
  { href: "/#accuracy", label: "Accuracy", wide: true },
  { href: "/methodology", label: "Methodology", wide: false },
  { href: "/#pricing", label: "Pricing", wide: true },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ink-950/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight text-fg" aria-label="RepoPilot home">
          <Logo />
          <span>RepoPilot</span>
        </Link>
        <nav aria-label="Main">
          <ul className="flex items-center gap-1 text-sm text-fg-muted">
            {NAV.map((item) => (
              <li key={item.href} className={item.wide ? "hidden sm:block" : undefined}>
                <Link href={item.href} className="rounded px-2 py-1.5 transition-colors hover:text-fg">
                  {item.label}
                </Link>
              </li>
            ))}
            <li>
              <a
                href={REPO_URL}
                className="rounded px-2 py-1.5 transition-colors hover:text-fg"
                aria-label="RepoPilot source code on GitHub"
              >
                GitHub
              </a>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
