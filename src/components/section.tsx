import type { ReactNode } from "react";

/** Two-column documentation section: title and short intro on the left, content on the right. */
export function Section({ id, title, intro, children }: { id: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-16 border-t border-line">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:px-6 lg:grid-cols-[15rem_1fr] lg:gap-12">
        <div>
          <h2 id={`${id}-heading`} className="text-lg font-semibold">
            {title}
          </h2>
          {intro && <div className="mt-2 text-sm leading-relaxed text-fg-muted">{intro}</div>}
        </div>
        <div className="min-w-0">{children}</div>
      </div>
    </section>
  );
}
