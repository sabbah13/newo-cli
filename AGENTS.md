# Repository Guidelines

## Project Structure & Module Organization
NEWO CLI is TypeScript-first, with source files in `src/`. Command routing lives in `src/cli/`, shared orchestration logic sits in `src/core/`, and customer-specific flows are under `src/sync/` and `src/customer*.ts`. Utility layers (`src/fsutil.ts`, `src/hash.ts`, `src/api.ts`) are designed for reuse, so group new helpers beside the module they support. Tests mirror this layout in `test/`, using `.test.js` files and shared helpers in `test/test-utils.js`. Generated JavaScript lands in `dist/`; keep it out of reviews. Customer fixtures and templates reside in `newo_customers/` and `assets/`.

## Build, Test & Development Commands
- `npm run build`: transpile TypeScript to `dist/`.
- `npm run dev`: rebuild then run the CLI once; pass arguments normally (e.g., `npm run dev -- pull`).
- `npm run typecheck` / `npm run lint`: strict TypeScript compilation without emit.
- `npm test`: Node.js test runner across `test/*.test.js`.
- `npm run test:coverage`: run tests with `c8` HTML/text reports in `coverage/`.
- `make setup`: install dependencies and scaffold `.env` from `.env.example`.

## Coding Style & Naming Conventions
Use two-space indentation, trailing semicolons, and `import`/`export` syntax that aligns with ECMAScript modules declared in `package.json`. Prefer descriptive file names (`customerInit.ts`, `handle-status.ts`) and keep CLI subcommands under `src/cli/commands/`. Favour pure functions where possible; side effects should stay in CLI handlers. Run `npm run lint` before pushing to catch typing or style regressions.

## Testing Guidelines
Add or update tests in the parallel file under `test/`. Name new suites `<feature>.test.js` and pull shared mocks into `test/test-utils.js`. Execute `npm run test:unit` before opening a PR; extend to `npm run test:integration` when touching cross-module workflows. For significant changes, supply a coverage snapshot via `npm run test:coverage` and ensure new logic is exercised.

## Commit & Pull Request Guidelines
Follow the conventional commit style seen in history (`feat:`, `fix:`, `enhance:`). Keep commits scoped to one concern and include context for customer-specific updates (e.g., `feat(sync): add delta upload fallback`). PRs should link issues when applicable, summarize intent, call out config or schema changes, and include manual verification steps (CLI commands run, fixtures added). Attach screenshots or logs when altering visible CLI output.

## Environment & Secrets
Node.js ≥18 is required; verify with `make env-check` when onboarding. Local credentials belong in `.env`, derived from `.env.example`. Customer directories in `newo_customers/` may contain sensitive data—avoid committing real secrets and scrub logs before attaching them to issues.
