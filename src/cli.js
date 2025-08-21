#!/usr/bin/env node
import minimist from 'minimist';
import dotenv from 'dotenv';
import { makeClient, getProjectMeta, importAkbArticle } from './api.js';
import { pullAll, pushChanged, status } from './sync.js';
import { parseAkbFile, prepareArticlesForImport } from './akb.js';
import path from 'path';

dotenv.config();
const { NEWO_PROJECT_ID } = process.env;

async function main() {
  const args = minimist(process.argv.slice(2));
  const cmd = args._[0];
  const verbose = args.verbose || args.v;

  if (!cmd || ['help', '-h', '--help'].includes(cmd)) {
    console.log(`NEWO CLI
Usage:
  newo pull                    # download all projects -> ./projects/ OR specific project if NEWO_PROJECT_ID set
  newo push                    # upload modified *.guidance/*.jinja back to NEWO
  newo status                  # show modified files
  newo meta                    # get project metadata (debug, requires NEWO_PROJECT_ID)
  newo import-akb <file> <persona_id>  # import AKB articles from file
  
Flags:
  --verbose, -v                # enable detailed logging
  
Env:
  NEWO_BASE_URL, NEWO_PROJECT_ID (optional), NEWO_API_KEY, NEWO_REFRESH_URL (optional)
  
Notes:
  - multi-project support: pull downloads all accessible projects or single project based on NEWO_PROJECT_ID
  - If NEWO_PROJECT_ID is set, pull downloads only that project
  - If NEWO_PROJECT_ID is not set, pull downloads all projects accessible with your API key
  - Projects are stored in ./projects/{project-idn}/ folders
  - Each project folder contains metadata.json and flows.yaml
`);
    return;
  }

  const client = await makeClient(verbose);

  if (cmd === 'pull') {
    // If PROJECT_ID is set, pull single project; otherwise pull all projects
    await pullAll(client, NEWO_PROJECT_ID || null, verbose);
  } else if (cmd === 'push') {
    await pushChanged(client, verbose);
  } else if (cmd === 'status') {
    await status(verbose);
  } else if (cmd === 'meta') {
    if (!NEWO_PROJECT_ID) throw new Error('NEWO_PROJECT_ID is not set in env');
    const meta = await getProjectMeta(client, NEWO_PROJECT_ID);
    console.log(JSON.stringify(meta, null, 2));
  } else if (cmd === 'import-akb') {
    const akbFile = args._[1];
    const personaId = args._[2];
    
    if (!akbFile || !personaId) {
      console.error('Usage: newo import-akb <file> <persona_id>');
      console.error('Example: newo import-akb akb.txt da4550db-2b95-4500-91ff-fb4b60fe7be9');
      process.exit(1);
    }
    
    const filePath = path.resolve(akbFile);
    
    try {
      if (verbose) console.log(`📖 Parsing AKB file: ${filePath}`);
      const articles = parseAkbFile(filePath);
      console.log(`✓ Parsed ${articles.length} articles from ${akbFile}`);
      
      if (verbose) console.log(`🔧 Preparing articles for persona: ${personaId}`);
      const preparedArticles = prepareArticlesForImport(articles, personaId);
      
      let successCount = 0;
      let errorCount = 0;
      
      console.log(`📤 Importing ${preparedArticles.length} articles...`);
      
      for (const [index, article] of preparedArticles.entries()) {
        try {
          if (verbose) console.log(`  [${index + 1}/${preparedArticles.length}] Importing ${article.topic_name}...`);
          await importAkbArticle(client, article);
          successCount++;
          if (!verbose) process.stdout.write('.');
        } catch (error) {
          errorCount++;
          console.error(`\n❌ Failed to import ${article.topic_name}:`, error?.response?.data || error.message);
        }
      }
      
      if (!verbose) console.log(''); // new line after dots
      console.log(`✅ Import complete: ${successCount} successful, ${errorCount} failed`);
      
    } catch (error) {
      console.error('❌ AKB import failed:', error.message);
      process.exit(1);
    }
  } else {
    console.error('Unknown command:', cmd);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e?.response?.data || e);
  process.exit(1);
});