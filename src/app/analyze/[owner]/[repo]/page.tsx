import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { AnalysisProgress } from "@/components/analysis-progress";
import { AnalysisView } from "@/components/analysis-view";
import { parseGitHubRepoUrl } from "@/lib/github/parse-url";

export async function generateMetadata({ params }: PageProps<"/analyze/[owner]/[repo]">): Promise<Metadata> {
  const { owner, repo } = await params;
  const parsed = parseGitHubRepoUrl(`${decodeURIComponent(owner)}/${decodeURIComponent(repo)}`);
  if (!parsed.ok) return { title: "Repository analysis", robots: { index: false } };
  const name = `${parsed.value.owner}/${parsed.value.repo}`;
  const description = `Health score, evidence-backed findings and ready-to-commit fixes for ${name}.`;
  return {
    title: `${name} health report`,
    description,
    openGraph: { title: `${name} — RepoPilot health report`, description },
    twitter: { card: "summary_large_image", title: `${name} — RepoPilot health report`, description },
    robots: { index: false },
  };
}

// Marks the page as intentionally request-time so per-repository metadata (title, preview
// image) can read URL params, while the static shell still prerenders. See Next.js docs:
// "generateMetadata with Cache Components".
async function Connection() {
  await connection();
  return null;
}

export default function AnalyzePage() {
  return (
    <>
      <Suspense fallback={<AnalysisProgress repo="…" events={[]} />}>
        <AnalysisView />
      </Suspense>
      <Suspense>
        <Connection />
      </Suspense>
    </>
  );
}
