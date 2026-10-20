import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-ink-950">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-fg-subtle sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          RepoPilot is static, heuristic analysis of public repositories. It is not a security audit and does not certify production
          readiness.
        </p>
        <nav aria-label="Footer" className="flex shrink-0 gap-4">
          <Link href="/methodology" className="hover:text-fg">
            Methodology
          </Link>
          <Link href="/#privacy" className="hover:text-fg">
            Privacy &amp; limits
          </Link>
        </nav>
      </div>
    </footer>
  );
}
