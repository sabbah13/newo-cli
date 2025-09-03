# Repository Guidelines

## Project Structure & Modules
- `src/`: Core CLI — `cli.js` (entry), `sync.js` (pull/push/status), `api.js` (typed client + retries), `auth.js` (token lifecycle), `config.js` (env + validation), `logger.js`, `security.js` (secure storage, rate limits), `validation.js`, `performance.js`, `akb.js`.
- `test/`: Mocha tests (`*.test.js`) including integration (`integration.*.test.js`) and helpers (`test-utils.js`).
- `projects/`: NEWO mirror created by `pull`. Layout: `projects/<projectIdn>/<agentIdn>/<flowIdn>/<skillIdn>.(guidance|jinja)` plus `metadata.json`, `flows.yaml`, and per‑project `.newo/map.json` and `hashes.json`.
- Root `.newo/`: CLI state (logs, cache, temp, secure tokens). Do not edit.

## Build, Test, Run
- `npm run dev`: Run locally (`node src/cli.js`). Example: `npm run dev -- pull -v`.
- `npm run pull|push|status`: Invoke core commands. Also available via `npx newo` or global `newo`.
- `npm test`: All tests. `npm run test:unit`, `npm run test:integration`, `npm run test:coverage` for focus/coverage.
- `npm run lint` / `npm run lint:fix`: ESLint check/fix. `npm run validate`: lint + smoke.

## Coding Style
- Node 18+, ES modules. ESLint rules: 2‑space indent, single quotes, semicolons, `prefer-const`, `no-var`, arrow spacing, `no-unused-vars` (allow `_` args). Unix line endings.
- Names: files lowercase with hyphens only if needed; code `camelCase`; classes `PascalCase`; tests end with `.test.js`.

## Testing
- Stack: Mocha + Chai + Sinon; coverage via NYC. Prefer unit tests for modules you touch; add integration if you change CLI flows or sync behavior.
- Conventions: mirror file names (`src/sync.js` → `test/sync.test.js`). Run `npm run test:watch` while iterating.

## Commits & PRs
- Conventional Commits. Examples: `feat: add multi-project support`, `fix: refresh token on 401`, `docs: update README`, `chore(pkg): bump version`.
- PRs include: clear description, linked issue, test updates, screenshots/logs for CLI output when relevant. CI must pass `npm run validate` and tests.

## Security & Config
- Never commit secrets; start from `.env.example`. Auth requires `NEWO_API_KEY` or `NEWO_ACCESS_TOKEN` + `NEWO_REFRESH_TOKEN`. Optional: `NEWO_PROJECT_ID`, `NEWO_REFRESH_URL`.
- Tokens are stored encrypted in `.newo/tokens.secure`; logs in `.newo/logs`. Avoid touching `.newo/*` and per‑project `.newo/*`.
- Throughput tuning: `NEWO_CONCURRENT_REQUESTS`, `NEWO_RATE_LIMIT_*`, `NEWO_RETRY_*`, `NEWO_API_TIMEOUT` (see `constants.js`).

## Architecture Notes
- Two‑way sync: API → `projects/` (pull) and file diffs via SHA‑256 hashes for precise push. `flows.yaml` captures flow events/states for tooling.
