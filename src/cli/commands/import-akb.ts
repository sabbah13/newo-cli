/**
 * Import AKB command handler
 */
import path from 'path';
import { makeClient, importAkbArticle } from '../../api.js';
import { parseAkbFile, prepareArticlesForImport } from '../../akb.js';
import { getValidAccessToken } from '../../auth.js';
import { requireSingleCustomer } from '../customer-selection.js';
import type { MultiCustomerConfig, CliArgs, NewoApiError } from '../../types.js';

export async function handleImportAkbCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean
): Promise<void> {
  const selectedCustomer = requireSingleCustomer(customerConfig, args.customer as string | undefined);

  const akbFile = args._[1];
  const personaId = args._[2];

  if (!akbFile || !personaId) {
    console.error('Usage: newo import-akb <file> <persona_id>');
    console.error('Example: newo import-akb akb.txt da4550db-2b95-4500-91ff-fb4b60fe7be9');
    process.exit(1);
  }

  const filePath = path.resolve(akbFile as string);
  const accessToken = await getValidAccessToken(selectedCustomer);
  const client = await makeClient(verbose, accessToken);

  try {
    if (verbose) console.log(`📖 Parsing AKB file: ${filePath}`);
    const articles = await parseAkbFile(filePath);
    console.log(`✓ Parsed ${articles.length} articles from ${akbFile}`);

    if (verbose) console.log(`🔧 Preparing articles for persona: ${personaId}`);
    const preparedArticles = prepareArticlesForImport(articles, personaId as string);

    let successCount = 0;
    let errorCount = 0;

    console.log(`📤 Importing ${preparedArticles.length} articles...`);

    for (const [index, article] of preparedArticles.entries()) {
      try {
        if (verbose) {
          console.log(`  [${index + 1}/${preparedArticles.length}] Importing ${article.topic_name}...`);
        }
        await importAkbArticle(client, article);
        successCount++;
        if (!verbose) process.stdout.write('.');
      } catch (error: unknown) {
        errorCount++;
        const errorMessage = error instanceof Error && 'response' in error
          ? (error as NewoApiError)?.response?.data
          : error instanceof Error
          ? error.message
          : String(error);
        console.error(`\n❌ Failed to import ${article.topic_name}:`, errorMessage);
      }
    }

    if (!verbose) console.log(''); // new line after dots
    console.log(`✅ Import complete: ${successCount} successful, ${errorCount} failed`);

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('❌ AKB import failed:', message);
    process.exit(1);
  }
}