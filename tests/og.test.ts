import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { ImageResponse } from "next/og";
import { OG_SIZE, RepoOgCard, SiteOgCard } from "@/lib/og/og-card";
import { HEALTHY_PROJECT, report } from "./helpers";

async function pngBytes(el: ReturnType<typeof createElement>) {
  const buf = new Uint8Array(await new ImageResponse(el, OG_SIZE).arrayBuffer());
  // PNG signature
  expect([...buf.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  return buf.byteLength;
}

// Satori (used by next/og) only fails at render time, so these render real PNGs.
describe("Open Graph cards", () => {
  it("renders the site card", async () => {
    expect(await pngBytes(createElement(SiteOgCard))).toBeGreaterThan(10_000);
  });

  it("renders a repo card with a score and a Fix next item", async () => {
    const r = report({ "src/a.py": "x" });
    expect(r.plan.length).toBeGreaterThan(0);
    expect(await pngBytes(createElement(RepoOgCard, { fullName: "acme/widget", report: r }))).toBeGreaterThan(10_000);
  });

  it("renders a repo card for a fully passing report and without a report", async () => {
    expect(await pngBytes(createElement(RepoOgCard, { fullName: "acme/widget", report: report(HEALTHY_PROJECT) }))).toBeGreaterThan(10_000);
    expect(
      await pngBytes(createElement(RepoOgCard, { fullName: "a-very-long-owner-name/an-even-longer-repository-name", report: null })),
    ).toBeGreaterThan(10_000);
  });
});
