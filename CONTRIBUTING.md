# Contributing

1. Fork and clone the repository, then run `npm install`.
2. Run `npm run dev` to start the app at http://localhost:3000.
3. Before opening a pull request, run:

   ```powershell
   npm run lint
   npm run typecheck
   npm test
   npm run build
   ```

## Adding a rule

1. Add a `Rule` to `RULES` in `src/lib/analysis/rules.ts` with a new stable ID (`ABC123`), a rationale, a category, a score category and a weight.
2. Keep `evaluate` pure: use only the `AnalysisContext`. Return `not_applicable` when the rule doesn't fit the project, rather than failing it.
3. Add pass **and** non-pass tests in `tests/rules.test.ts`.
4. Never put raw file contents or unredacted secrets in evidence.
