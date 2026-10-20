import type { Confidence, Severity } from "@/lib/reports/schema";

/**
 * Heuristic credential-pattern detection over bounded text content.
 *
 * Matched values are redacted inside this module: callers only ever receive
 * `redacted` strings, never the raw match. This is a pattern scan, not a security audit.
 */

export type SecretPattern = {
  id: string;
  label: string;
  regex: RegExp;
  /** Index of the capture group containing the secret value (0 = whole match). */
  valueGroup: number;
  severity: Severity;
  confidence: Confidence;
  /** Optional extra validation of the captured value. */
  validate?: (value: string) => boolean;
};

export type SecretMatch = {
  patternId: string;
  label: string;
  path: string;
  line: number;
  redacted: string;
  severity: Severity;
  confidence: Confidence;
};

const PLACEHOLDER_RE =
  /(example|sample|dummy|placeholder|changeme|change_me|your[_-]?|redacted|xxxx|\*\*\*|<[^>]*>|\$\{|\{\{|process\.env|os\.environ|getenv|env\(|todo|fake|test|mock|null|undefined|password123|secret123)/i;

/** Shannon entropy in bits per character. */
export function shannonEntropy(value: string): number {
  if (value.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const ch of value) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / value.length;
    h -= p * Math.log2(p);
  }
  return h;
}

function notPlaceholder(value: string): boolean {
  return !PLACEHOLDER_RE.test(value);
}

export const SECRET_PATTERNS: SecretPattern[] = [
  {
    id: "private-key",
    label: "Private key block",
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g,
    valueGroup: 0,
    severity: "critical",
    confidence: "high",
  },
  {
    id: "aws-access-key-id",
    label: "AWS access key ID",
    regex: /\b((?:AKIA|ASIA)[0-9A-Z]{16})\b/g,
    valueGroup: 1,
    severity: "high",
    confidence: "high",
    validate: (v) => !/EXAMPLE/.test(v),
  },
  {
    id: "github-token",
    label: "GitHub token",
    regex: /\b((?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36})\b/g,
    valueGroup: 1,
    severity: "critical",
    confidence: "high",
    validate: (v) => shannonEntropy(v) > 3.5,
  },
  {
    id: "github-fine-grained-token",
    label: "GitHub fine-grained token",
    regex: /\b(github_pat_[A-Za-z0-9_]{82})\b/g,
    valueGroup: 1,
    severity: "critical",
    confidence: "high",
  },
  {
    id: "slack-token",
    label: "Slack token",
    regex: /\b(xox[baprs]-[A-Za-z0-9-]{10,72})\b/g,
    valueGroup: 1,
    severity: "high",
    confidence: "high",
    validate: notPlaceholder,
  },
  {
    id: "slack-webhook",
    label: "Slack incoming webhook URL",
    regex: /(https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]{6,}\/B[A-Z0-9]{6,}\/[A-Za-z0-9]{20,})/g,
    valueGroup: 1,
    severity: "medium",
    confidence: "high",
  },
  {
    id: "stripe-live-key",
    label: "Stripe live secret key",
    regex: /\b((?:sk|rk)_live_[A-Za-z0-9]{20,99})\b/g,
    valueGroup: 1,
    severity: "critical",
    confidence: "high",
  },
  {
    id: "google-api-key",
    label: "Google API key",
    regex: /\b(AIza[0-9A-Za-z_-]{35})\b/g,
    valueGroup: 1,
    // Browser-restricted Google keys are often intentionally public.
    severity: "medium",
    confidence: "medium",
  },
  {
    id: "openai-api-key",
    label: "OpenAI API key",
    regex: /\b(sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,})\b/g,
    valueGroup: 1,
    severity: "critical",
    confidence: "high",
  },
  {
    id: "anthropic-api-key",
    label: "Anthropic API key",
    regex: /\b(sk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{80,})\b/g,
    valueGroup: 1,
    severity: "critical",
    confidence: "high",
  },
  {
    id: "npm-token",
    label: "npm access token",
    regex: /\b(npm_[A-Za-z0-9]{36})\b/g,
    valueGroup: 1,
    severity: "high",
    confidence: "high",
    validate: (v) => shannonEntropy(v) > 3.5,
  },
  {
    id: "generic-credential-assignment",
    label: "Hard-coded credential-like assignment",
    regex:
      /\b[\w.-]*?(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key)[\w-]*["']?\s*[:=]\s*["']([^"'\s]{16,200})["']/gi,
    valueGroup: 1,
    severity: "medium",
    confidence: "low",
    validate: (v) => notPlaceholder(v) && shannonEntropy(v) >= 3.5 && !/^(.)\1+$/.test(v),
  },
];

/**
 * Redacts a secret so that at most 4 leading characters (and never more than a quarter
 * of the value) are revealed, followed by its length.
 */
export function redact(value: string): string {
  if (value.startsWith("-----BEGIN")) return "-----BEGIN … PRIVATE KEY----- [key material not shown]";
  const visible = Math.min(4, Math.floor(value.length / 4));
  return `${value.slice(0, visible)}…[redacted, ${value.length} chars]`;
}

function lineNumberAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

const MAX_MATCHES_PER_FILE = 20;

export function scanTextForSecrets(path: string, text: string, patterns: SecretPattern[] = SECRET_PATTERNS): SecretMatch[] {
  const matches: SecretMatch[] = [];
  const seen = new Set<string>();
  for (const pattern of patterns) {
    const re = new RegExp(pattern.regex.source, pattern.regex.flags.includes("g") ? pattern.regex.flags : pattern.regex.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      const value = m[pattern.valueGroup] ?? m[0];
      if (pattern.validate && !pattern.validate(value)) continue;
      const line = lineNumberAt(text, m.index);
      const key = `${line}:${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({
        patternId: pattern.id,
        label: pattern.label,
        path,
        line,
        redacted: redact(value),
        severity: pattern.severity,
        confidence: pattern.confidence,
      });
      if (matches.length >= MAX_MATCHES_PER_FILE) return matches;
    }
  }
  return matches;
}
