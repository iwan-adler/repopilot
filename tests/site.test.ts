import { describe, expect, it } from "vitest";
import { feedbackUrl, REPO_URL } from "@/lib/site";

describe("feedbackUrl", () => {
  it("opens the scan-feedback issue form", () => {
    const url = new URL(feedbackUrl());
    expect(`${url.origin}${url.pathname}`).toBe(`${REPO_URL}/issues/new`);
    expect(url.searchParams.get("template")).toBe("scan-feedback.yml");
  });

  it("pre-fills the scanned repository, safely encoded", () => {
    const url = new URL(feedbackUrl({ fullName: "acme/wid&get", url: "https://github.com/acme/wid&get" }));
    expect(url.searchParams.get("title")).toBe("Scan feedback: acme/wid&get");
    expect(url.searchParams.get("repository")).toBe("https://github.com/acme/wid&get");
  });
});
