# Accuracy study

RepoPilot's rules are deterministic, but deterministic doesn't mean correct. This study measures how often its findings are right on real, well-known repositories, using sources that are **independent of RepoPilot**, and records every false positive found and what was changed.

Everything here is reproducible:

```bash
node scripts/validation/collect.mjs            # scans the 26 repos via the live API (≈28 min, paced)
node scripts/validation/fill-community.mjs     # optional: refetch community profiles via `gh`
node scripts/validation/analyze.mjs docs/validation/results-v0.3.1.json
```

Raw data: [`results-v0.2.0.json`](validation/results-v0.2.0.json), [`results-v0.3.0.json`](validation/results-v0.3.0.json), [`results-v0.3.1.json`](validation/results-v0.3.1.json).

## Method

**Sample.** 26 popular public repositories across 9 languages, chosen before looking at any results: JavaScript/TypeScript (express, ky, axios, swr, chalk), Python (flask, requests, nanoGPT, fastapi, httpie), Go (cobra, gin, fzf), Rust (ripgrep, bat, serde), Java/Kotlin (gson, okhttp), Ruby (sinatra, rubocop), PHP (laravel, guzzle), C/C++ (redis, nlohmann/json), and documentation/notebook repos (public-apis, PythonDataScienceHandbook).

**Independent sources.**

1. **GitHub's community profile API**: GitHub's own detection of README, LICENSE and CONTRIBUTING files (including organization defaults).
2. **OpenSSF Scorecard** (api.securityscorecards.dev): its License, Security-Policy, Dangerous-Workflow and Dependency-Update-Tool checks. Scorecard data can be up to a few weeks older than the commit RepoPilot scanned.
3. **Manual review** for heuristic rules that neither source covers (tests, CI test commands, linters, formatters, file sizes, committed keys): each finding was checked against the repository's actual files and workflows via the GitHub API.

**Classification of findings.**

- _Correct_: the finding states something true about the repository, at an appropriate severity.
- _False positive_: the finding is wrong, or penalizes something that isn't a real gap.
- _Debatable_: true but arguably not a problem, e.g. "no `build` script" for a library. These are excluded from precision.

Precision = correct ÷ (correct + false positives).

## Results

### Agreement with independent sources

| Check                               | Source                   | Repos compared |      v0.2.0 |   v0.3.0 |   v0.3.1 |
| ----------------------------------- | ------------------------ | -------------: | ----------: | -------: | -------: |
| README present (DOC001)             | GitHub community profile |             26 |        100% |     100% |     100% |
| License declared (DOC003)           | GitHub community profile |             26 |        100% |     100% |     100% |
| License declared (DOC003)           | OpenSSF Scorecard        |             23 |        100% |     100% |     100% |
| Contribution guide (DOC004)         | GitHub community profile |             26 | 73% (19/26) | **100%** | **100%** |
| Security policy (SEC004)            | OpenSSF Scorecard        |             23 | 70% (16/23) | **100%** | **100%** |
| Dangerous workflows (SEC005+SEC006) | OpenSSF Scorecard        |             19 | 84% (16/19) | **100%** | **100%** |
| Dependency update tool (DEP004)     | OpenSSF Scorecard        |              3 |        100% |     100% |     100% |

Scorecard had no data for 3 repositories and reported "inconclusive" for some checks; those pairs are excluded.

### Precision of all findings

| Engine                     | Findings | Correct | False positives | Debatable |                 Precision |
| -------------------------- | -------: | ------: | --------------: | --------: | ------------------------: |
| v0.2.0 (first measurement) |      114 |      69 |              36 |         9 |                 **65.7%** |
| v0.3.0 (after fixes)       |       88 |      73 |               7 |         8 |                 **91.3%** |
| v0.3.1                     |       81 |      73 |               0 |         8 | **100%** (on this sample) |

v0.3.1 was measured in a third full run. Compared with v0.3.0, exactly the 7 known false positives disappeared and **no new findings appeared**; scores changed only for swr, laravel, redis and nlohmann/json.

**How to read the 100%.** It means no known false positives remain _on the same 26 repositories that were used to find and fix them_. That is a training-set result, not a general accuracy claim. The honest estimate for unseen repositories is somewhere below it. The v0.2.0 → v0.3.0 jump shows how much a new sample can reveal, and an evaluation on a fresh set of repositories is the next step.

## False positives found and fixed

| Rule                            |                            v0.2.0 false positives | Root cause                                                                                                                                           | Fix                                                                                                                                                                          |
| ------------------------------- | ------------------------------------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TST004 CI runs tests            | 5 of 5 (requests, cobra, ripgrep, laravel, redis) | Only a fixed list of test commands was recognized; real CI used `./runtest`, `${{ env.CARGO }} test`, `php artisan test`, or steps named "Run tests" | Also recognizes test-named steps and jobs, custom runners and variable toolchains; excludes publishing steps (v0.3.0)                                                        |
| DOC004 Contribution guide       |                                                 7 | 6 repos use organization-wide defaults in `{owner}/.github`; flask uses `docs/contributing.rst`                                                      | Checks the owner's `.github` repo (via raw.githubusercontent.com, no API quota) and accepts any doc extension (v0.3.0)                                                       |
| SEC004 Security policy          |                                                 7 | All 7 use an organization-wide `SECURITY.md`                                                                                                         | Same organization-default lookup (v0.3.0)                                                                                                                                    |
| SEC005 pull_request_target      |                                                 5 | Labeler/triage workflows that never check out PR code were warned about                                                                              | Only an explicit PR-head checkout is scored; other uses are informational, matching Scorecard and GitHub's guidance (v0.3.0)                                                 |
| DX001 / DX002 Linter, formatter |                                                 9 | `xo` not counted as a formatter; Laravel Pint in `composer.json` not detected; C projects judged on small Python helpers                             | `xo`/`standard`, PHP linters from `composer.json`, 20% language threshold (v0.3.0); tools invoked from npm scripts such as `oxfmt` (swr), root-level manifests only (v0.3.1) |
| TST002 Test framework           |                                 1 (nlohmann/json) | CTest/doctest via CMake not recognized                                                                                                               | `CMakeLists.txt` is read for CTest, doctest, Catch2, GoogleTest (v0.3.0)                                                                                                     |
| TST003 / DX004 npm scripts      |                                       2 (laravel) | A PHP app's frontend `package.json` was judged as a JS project                                                                                       | Not applicable when another ecosystem's manifest is at the root and JS isn't the primary language (v0.3.0)                                                                   |

Smaller adjustments: `"latest"` versions only in `examples/` or test manifests are now low severity (axios, swr), and generated single-header files such as `single_include/json.hpp` are excluded from the size check.

Every fix has a regression test reproducing the real-world pattern: [`tests/validation-regressions.test.ts`](../tests/validation-regressions.test.ts).

## What was confirmed correct

- **No CI** (nanoGPT, PythonDataScienceHandbook): no workflow or other CI files exist.
- **No dependency update tool** (10 repos): no Dependabot or Renovate configuration in the repository or `package.json`.
- **Committed key and `.env` files** (6 repos): all are test fixtures, which RepoPilot correctly marked low severity and low confidence.
- **Unpinned third-party actions** (13 repos), **no tests** (2), **large files**: factual observations verified against the files.

## Limitations of this study

- **Sample size.** 26 repositories, mostly popular and well-maintained. Precision on small or unusual projects may differ.
- **Reviewer.** Manual classification was performed by an AI coding assistant against evidence fetched from each repository (files, workflows, manifests), and has not yet been independently reviewed by a human. The per-finding evidence is in the raw data files so anyone can check it.
- **Recall not measured.** The study measures how often findings are right, not how many real issues are missed. Missed issues (false negatives) would need a labelled dataset.
- **Overfitting risk.** Fixes were driven by this sample. They target general patterns (organization defaults, custom test runners, script-invoked tools) rather than specific repositories, and each is tested in isolation, but a fresh sample is the real test.
- **Source timing.** Scorecard results can lag the scanned commit by days or weeks.
