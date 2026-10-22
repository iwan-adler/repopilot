/** Public project links used across the UI. */
export const REPO_URL = "https://github.com/iwan-adler/repopilot";

/** Opens the "Scan feedback" issue form, pre-filled with the scanned repository when known. */
export function feedbackUrl(scanned?: { fullName: string; url: string }): string {
  const params = new URLSearchParams({ template: "scan-feedback.yml" });
  if (scanned) {
    params.set("title", `Scan feedback: ${scanned.fullName}`);
    params.set("repository", scanned.url);
  }
  return `${REPO_URL}/issues/new?${params.toString()}`;
}
