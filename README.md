# NEWO CLI

Mirror NEWO "Project → Agent → Flow → Skills" to local files and back, Git-first.

## Install
```bash
npm install
```

## Configure
```bash
cp .env.example .env
# Edit .env with your values
```
Required:
- `NEWO_BASE_URL` (default `https://app.newo.ai`)
- `NEWO_PROJECT_ID`
- One of:
  - `NEWO_API_KEY` to exchange for tokens (recommended), or
  - `NEWO_ACCESS_TOKEN` (+ optional `NEWO_REFRESH_TOKEN` and `NEWO_REFRESH_URL`)

## Commands
```bash
npx newo pull     # download project -> ./project
npx newo status   # list modified files
npx newo push     # upload modified *.gdn back to NEWO
```

Files are stored under `./project/<AgentIdn>/<FlowIdn>/<SkillIdn>.gdn`.
Hashes are tracked in `.newo/hashes.json` so only changed files are pushed.

## CI/CD (GitHub Actions)
Create `.github/workflows/deploy.yml`:
```yaml
name: Deploy NEWO Skills
on:
  push:
    branches: [ main ]
    paths:
      - 'project/**/*.gdn'
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: node ./src/cli.js push
        env:
          NEWO_BASE_URL: https://app.newo.ai
          NEWO_PROJECT_ID: b78188ba-0df0-46a8-8713-f0d7cff0a06e
          NEWO_API_KEY: ${{ secrets.NEWO_API_KEY }}
          # Optional refresh URL if your server supports it:
          # NEWO_REFRESH_URL: ${{ secrets.NEWO_REFRESH_URL }}
```

## Endpoints used
- `GET /api/v1/bff/agents/list?project_id=...`
- `GET /api/v1/designer/flows/{flowId}/skills`
- `GET /api/v1/bff/skills/{skillId}` (fallback to `/api/v1/designer/skills/{skillId}`)
- `PUT /api/v1/designer/skills/{skillId}` (fallback to `/api/v1/bff/skills/{skillId}`)
- `POST /api/v1/auth/api-key/token` to acquire access tokens from API key.
