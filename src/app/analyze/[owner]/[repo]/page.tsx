import type { Metadata } from "next";
import { Suspense } from "react";
import { AnalysisProgress } from "@/components/analysis-progress";
import { AnalysisView } from "@/components/analysis-view";

export const metadata: Metadata = {
  title: "Repository analysis",
  robots: { index: false },
};

export default function AnalyzePage() {
  return (
    <Suspense fallback={<AnalysisProgress repo="…" events={[]} />}>
      <AnalysisView />
    </Suspense>
  );
}
