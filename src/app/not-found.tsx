import Link from "next/link";
import { RepositoryForm } from "@/components/repository-form";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-20 text-center sm:px-6">
      <p className="font-mono text-sm text-accent">404</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">This page doesn&apos;t exist</h1>
      <p className="mt-3 text-fg-muted">
        To analyze a repository, use an address like <span className="font-mono text-fg">/analyze/owner/repo</span> or paste a GitHub URL
        below.
      </p>
      <div className="mx-auto mt-8 max-w-xl text-left">
        <RepositoryForm compact />
      </div>
      <Link href="/" className="mt-6 inline-block text-sm text-accent hover:underline">
        ← Back to home
      </Link>
    </div>
  );
}
