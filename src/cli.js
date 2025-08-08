#!/usr/bin/env node
import minimist from 'minimist';
import dotenv from 'dotenv';
import { makeClient, getProjectMeta } from './api.js';
import { pullAll, pushChanged, status } from './sync.js';

dotenv.config();
const { NEWO_PROJECT_ID } = process.env;

async function main() {
  const args = minimist(process.argv.slice(2));
  const cmd = args._[0];

  if (!cmd || ['help', '-h', '--help'].includes(cmd)) {
    console.log(`NEWO CLI
Usage:
  newo pull           # download project -> ./project
  newo push           # upload modified *.gdn back to NEWO
  newo status         # show modified files
Env:
  NEWO_BASE_URL, NEWO_PROJECT_ID, NEWO_API_KEY, NEWO_REFRESH_URL (optional)
`);
    return;
  }

  const client = await makeClient();

  if (cmd === 'pull') {
    if (!NEWO_PROJECT_ID) throw new Error('NEWO_PROJECT_ID is not set in env');
    await pullAll(client, NEWO_PROJECT_ID);
  } else if (cmd === 'push') {
    await pushChanged(client);
  } else if (cmd === 'status') {
    await status();
  } else if (cmd === 'meta') {
    if (!NEWO_PROJECT_ID) throw new Error('NEWO_PROJECT_ID is not set in env');
    const meta = await getProjectMeta(client, NEWO_PROJECT_ID);
    console.log(JSON.stringify(meta, null, 2));
  } else {
    console.error('Unknown command:', cmd);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e?.response?.data || e);
  process.exit(1);
});
