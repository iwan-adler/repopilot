import Link from "next/link";
import { Logo } from "./logo";

const NAV = [
  { href: "/#checks", label: "Checks" },
  { href: "/methodology", label: "Methodology" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#privacy", label: "Privacy" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line/80 bg-ink-950/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight text-fg" aria-label="RepoPilot home">
          <Logo />
          <span>RepoPilot</span>
        </Link>
        <nav aria-label="Main">
          <ul className="flex items-center gap-1 text-sm text-fg-muted sm:gap-2">
            {NAV.map((item) => (
              <li key={item.href} className={item.label === "Privacy" ? "hidden sm:block" : undefined}>
                <Link href={item.href} className="rounded-md px-2 py-1.5 transition-colors hover:bg-ink-800 hover:text-fg">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}
