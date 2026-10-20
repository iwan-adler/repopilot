# Scoring algorithm

Implementation: [`src/lib/analysis/scoring.ts`](../src/lib/analysis/scoring.ts). Tests: [`tests/scoring.test.ts`](../tests/scoring.test.ts).

## 1. Check results

Every rule produces exactly one check result:

| Status | Credit | Meaning |
| --- | --- | --- |
| `pass` | 1.0 | Good signal detected |
| `warn` | 0.5 | Partial or lower-confidence issue |
| `fail` | 0.0 | Issue detected |
| `not_applicable` | excluded | The check doesn't apply (e.g. npm checks in a Go repo) |
| `unavailable` | excluded | Data needed for the check couldn't be retrieved |

Each rule has a **weight** (0–4) inside exactly one **score category**. Weight 0 marks informational rules (e.g. `REPO001` archived), which never affect the score.

## 2. Category score

```
categoryScore = 100 × Σ(weight × credit) / Σ(weight)      over scored checks in the category
```

If a category has no scored checks (all N/A or unavailable), its score is `null` and it's reported as unavailable, with an explanation and a limitation entry.

## 3. Overall score

Configured weights (product decisions, not empirical benchmarks):

| Category | Weight | Rules |
| --- | --- | --- |
| Maintainability | 30% | DX001–DX004, MNT001–MNT003 |
| Testing | 25% | TST001–TST004 |
| Security signals | 25% | SEC001–SEC007 |
| Project hygiene | 20% | STR001–STR002, DOC001–DOC004, DEP001–DEP005 |

```
overall = Σ(categoryWeight × categoryScore) / Σ(categoryWeight)     over available categories
```

Weights of unavailable categories are therefore redistributed proportionally. Each category reports both its configured and its *effective* weight, so the overall number can be recomputed by hand from the report.

Bands: **A** ≥ 90, **B** ≥ 75, **C** ≥ 60, **D** ≥ 40, **F** < 40. If no category is available, the overall score is `null`.

## 4. Avoiding double counting

- Each rule is evaluated once and belongs to one category.
- Rules that depend on each other are scoped so they don't penalize the same gap twice. For example `DOC002` (README completeness) is *not applicable* when there's no README, because `DOC001` already failed; `TST004` (CI runs tests) is *not applicable* when there's no CI, because `DX003` covers it.
- `SEC001` produces one check regardless of how many secrets are matched (the findings list every match, redacted).

## 5. Worked example

Testing: TST001 pass (w3), TST002 pass (w2), TST003 fail (w1), TST004 warn (w2)
→ (3 + 2 + 0 + 1) / 8 = **75.0**

If Security = 100, Maintainability = 80, Hygiene = 90:
→ 0.30×80 + 0.25×75 + 0.25×100 + 0.20×90 = **85.75 → 85.8 (band B)**

## 6. What the score is not

The score summarizes signals RepoPilot detected statically. It is not a security audit, a code-quality measurement, or a certification of production readiness. A repository can score highly and still contain serious bugs or vulnerabilities.
