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
npx newo push     # upload modified *.guidance/*.jinja back to NEWO
```

Files are stored as:
- `./project/<AgentIdn>/<FlowIdn>/<SkillIdn>.guidance` (AI guidance scripts)
- `./project/<AgentIdn>/<FlowIdn>/<SkillIdn>.jinja` (NSL/Jinja template scripts)

Hashes are tracked in `.newo/hashes.json` so only changed files are pushed.
Project structure is also exported to `flows.yaml` for reference.

## Features
- **Two-way sync**: Pull NEWO projects to local files, push local changes back
- **Change detection**: SHA256 hashing prevents unnecessary uploads
- **Multiple file types**: `.guidance` (AI prompts) and `.jinja` (NSL templates)
- **Project structure export**: Generates `flows.yaml` with complete project metadata
- **Robust authentication**: API key exchange with automatic token refresh
- **CI/CD ready**: GitHub Actions workflow included

## CI/CD (GitHub Actions)
Create `.github/workflows/deploy.yml`:
```yaml
name: Deploy NEWO Skills
on:
  push:
    branches: [ main ]
    paths:
      - 'project/**/*.guidance'
      - 'project/**/*.jinja'
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
          # Optional:
          # NEWO_REFRESH_URL: ${{ secrets.NEWO_REFRESH_URL }}
```

## API Endpoints
- `GET /api/v1/bff/agents/list?project_id=...` - List project agents
- `GET /api/v1/designer/flows/{flowId}/skills` - List skills in flow
- `GET /api/v1/designer/skills/{skillId}` - Get skill content
- `PUT /api/v1/designer/flows/skills/{skillId}` - Update skill content
- `GET /api/v1/designer/flows/{flowId}/events` - List flow events (for flows.yaml)
- `GET /api/v1/designer/flows/{flowId}/states` - List flow states (for flows.yaml)
- `POST /api/v1/auth/api-key/token` - Exchange API key for access tokens