import { describe, expect, it } from "vitest";
import { redact, scanTextForSecrets, shannonEntropy } from "@/lib/analysis/secrets";

// Test credentials are assembled at runtime so this file never contains a contiguous
// token-shaped string (which would trip GitHub push protection and other scanners).
const GH_TOKEN = "ghp" + "_" + "aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3zA5";
const AWS_KEY = "AKIA" + "Z7XK2M4N6P8Q1R3S";
const STRIPE = "sk" + "_live_" + "4eC39HqLyjWDarjtT1zdp7dc12345";
const GOOGLE = "AIza" + "SyD3m9QzX8vK2pL5nR7tW1yB4cF6hJ8kM0q";
const SLACK = "xoxb" + "-123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx";
const NPM = "npm" + "_" + "Zx8Yw7Vu6Ts5Rq4Po3Nm2Lk1Jh0Gf9EdC8bA";
const PRIVATE_KEY_HEADER = "-----BEGIN " + "RSA PRIVATE KEY-----";

describe("scanTextForSecrets", () => {
  it.each([
    ["github-token", `const token = "${GH_TOKEN}";`],
    ["aws-access-key-id", `aws_access_key_id = ${AWS_KEY}`],
    ["stripe-live-key", `STRIPE_KEY=${STRIPE}`],
    ["google-api-key", `apiKey: "${GOOGLE}"`],
    ["slack-token", `SLACK=${SLACK}`],
    ["npm-token", `//registry.npmjs.org/:_authToken=${NPM}`],
    ["private-key", `${PRIVATE_KEY_HEADER}\nMIIEow...\n`],
  ])("detects %s", (id, text) => {
    const m = scanTextForSecrets("config/app.ts", text);
    expect(m.map((x) => x.patternId)).toContain(id);
  });

  it("reports correct 1-based line numbers", () => {
    const m = scanTextForSecrets("a.env", `A=1\nB=2\nTOKEN=${GH_TOKEN}\n`);
    expect(m[0].line).toBe(3);
  });

  it("never returns the full secret value", () => {
    const all = [GH_TOKEN, AWS_KEY, STRIPE, GOOGLE, SLACK, NPM];
    const text = all.map((s, i) => `k${i} = "${s}"`).join("\n");
    const matches = scanTextForSecrets("x.py", text);
    const serialized = JSON.stringify(matches);
    for (const s of all) {
      expect(serialized).not.toContain(s);
      expect(serialized).not.toContain(s.slice(4, 16));
    }
  });

  it("ignores documented placeholder values", () => {
    expect(scanTextForSecrets("README.md", "AWS key: AKIAIOSFODNN7EXAMPLE")).toHaveLength(0);
    expect(scanTextForSecrets("a.ts", `password = "your_password_here_123"`)).toHaveLength(0);
    expect(scanTextForSecrets("a.ts", `api_key: "\${API_KEY_FROM_ENVIRONMENT}"`)).toHaveLength(0);
    expect(scanTextForSecrets("a.ts", `secret = "aaaaaaaaaaaaaaaaaaaaaaaa"`)).toHaveLength(0);
  });

  it("flags high-entropy generic credential assignments with low confidence", () => {
    const value = "Qm9vbGVhbk" + "Zx8!rT4pL2wK";
    const m = scanTextForSecrets("settings.py", `DB_PASSWORD = "${value}"\nclient_secret: '${value}x'`);
    expect(m.length).toBeGreaterThanOrEqual(1);
    expect(m.every((x) => x.confidence === "low")).toBe(true);
    expect(JSON.stringify(m)).not.toContain(value);
  });

  it("does not flag ordinary code", () => {
    const code = `export function login(password: string) { return hash(password); }\nconst apiKey = process.env.API_KEY;\n`;
    expect(scanTextForSecrets("auth.ts", code)).toHaveLength(0);
  });

  it("caps matches per file", () => {
    const text = Array.from({ length: 50 }, () => `x=${AWS_KEY}`).join("\n");
    expect(scanTextForSecrets("big.txt", text).length).toBeLessThanOrEqual(20);
  });
});

describe("redact", () => {
  it("reveals at most 4 chars and never more than a quarter", () => {
    expect(redact("abcdefghijklmnop")).toBe("abcd…[redacted, 16 chars]");
    expect(redact("abcdefgh")).toBe("ab…[redacted, 8 chars]");
    expect(redact("abc")).toBe("…[redacted, 3 chars]");
  });

  it("does not reveal private key material", () => {
    expect(redact(PRIVATE_KEY_HEADER)).not.toMatch(/MII/);
  });
});

describe("shannonEntropy", () => {
  it("is 0 for empty and uniform strings and higher for random strings", () => {
    expect(shannonEntropy("")).toBe(0);
    expect(shannonEntropy("aaaa")).toBe(0);
    expect(shannonEntropy("aB3dE5fG7hJ9kL1m")).toBeGreaterThan(3.5);
  });
});
