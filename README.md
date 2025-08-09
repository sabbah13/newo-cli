# NEWO CLI

Mirror NEWO "Project → Agent → Flow → Skills" to local files and back, Git-first.

## Install

### Option 1: Global Installation (Recommended)
```bash
npm install -g newo
```
After global installation, use the CLI anywhere:
```bash
newo pull
newo push
newo status
```

### Option 2: Local Installation
```bash
# In your project directory
npm install newo
```
Use with npx:
```bash
npx newo pull
npx newo push  
npx newo status
```

### Option 3: Development Installation
```bash
# Clone the repository
git clone https://github.com/sabbah13/newo-cli.git
cd newo-cli
npm install
```

## Configure

### Step 1: Get Your NEWO API Key
1. **Login** to your [app.newo.ai](https://app.newo.ai) account
2. **Navigate** to the **Integrations** page
3. **Find** the **API Integration** in the list
4. **Create** a new **Connector** for this Integration
5. **Copy** your API key (it will look like: `458663bd41f2d1...`)

![How to get your NEWO API Key](assets/newo-api-key.png)

### Step 2: Setup Environment
```bash
cp .env.example .env
# Edit .env with your values
```

Required environment variables:
- `NEWO_BASE_URL` (default `https://app.newo.ai`)
- `NEWO_PROJECT_ID` (your project UUID from NEWO)
- `NEWO_API_KEY` (your API key from Step 1)

Optional (advanced):
- `NEWO_ACCESS_TOKEN` (direct access token)
- `NEWO_REFRESH_TOKEN` (refresh token)
- `NEWO_REFRESH_URL` (custom refresh endpoint)

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
          NEWO_PROJECT_ID: ${{ secrets.NEWO_PROJECT_ID }}
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