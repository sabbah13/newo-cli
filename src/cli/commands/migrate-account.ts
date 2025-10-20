/**
 * Account migration command handler
 */
import { makeClient } from '../../api.js';
import { migrateAccount } from '../../sync/migrate.js';
import { getValidAccessToken } from '../../auth.js';
import { getCustomer } from '../../customer.js';
import type { MultiCustomerConfig, CliArgs } from '../../types.js';

export async function handleMigrateAccountCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean
): Promise<void> {
  // Get source and destination customer IDNs
  const sourceIdn = args.source as string | undefined;
  const destIdn = args.dest as string | undefined;

  if (!sourceIdn || !destIdn) {
    console.error('❌ Usage: newo migrate-account --source <sourceIdn> --dest <destIdn>');
    console.error('Example: newo migrate-account --source NEWO_bb5lmJjg --dest NEq9OCwSXw');
    process.exit(1);
  }

  const sourceCustomer = getCustomer(customerConfig, sourceIdn);
  const destCustomer = getCustomer(customerConfig, destIdn);

  if (!sourceCustomer) {
    console.error(`❌ Source customer ${sourceIdn} not found in configuration`);
    process.exit(1);
  }

  if (!destCustomer) {
    console.error(`❌ Destination customer ${destIdn} not found in configuration`);
    process.exit(1);
  }

  console.log('\n🔄 Account Migration');
  console.log(`Source: ${sourceIdn}`);
  console.log(`Destination: ${destIdn}`);
  console.log('\n⚠️  This will copy ALL data from source to destination');
  console.log('⚠️  Source account will NOT be modified (read-only)');

  // Confirm migration
  if (!args.yes && !args.y) {
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const answer = await new Promise<string>((resolve) => {
      rl.question('\nProceed with migration? (yes/NO): ', resolve);
    });
    rl.close();

    if (answer.toLowerCase() !== 'yes') {
      console.log('❌ Migration cancelled');
      return;
    }
  }

  // Authenticate
  const sourceToken = await getValidAccessToken(sourceCustomer);
  const destToken = await getValidAccessToken(destCustomer);

  const sourceClient = await makeClient(verbose, sourceToken);
  const destClient = await makeClient(verbose, destToken);

  // Run migration
  const result = await migrateAccount({
    sourceCustomer,
    destCustomer,
    sourceClient,
    destClient,
    verbose
  });

  // Print summary
  console.log('\n📊 MIGRATION SUMMARY\n');
  console.log(`Projects created: ${result.projectsCreated}`);
  console.log(`Agents created: ${result.agentsCreated}`);
  console.log(`Flows created: ${result.flowsCreated}`);
  console.log(`Skills created: ${result.skillsCreated}`);
  console.log(`Attributes migrated: ${result.attributesMigrated}`);
  console.log(`Personas created: ${result.personasCreated}`);
  console.log(`AKB articles imported: ${result.articlesImported}`);
  console.log(`Connectors created: ${result.connectorsCreated}`);
  console.log(`Webhooks created: ${result.webhooksCreated}`);

  if (result.errors.length > 0) {
    console.log(`\n⚠️  Errors: ${result.errors.length}`);
    result.errors.forEach(err => console.error(`   - ${err}`));
  }

  console.log(`\n${result.success ? '✅ Migration completed successfully!' : '❌ Migration completed with errors'}\n`);

  if (result.success) {
    console.log('📋 Next steps:');
    console.log(`   1. Push skill content: npx newo push --customer ${destIdn}`);
    console.log(`   2. Verify migration: npx newo verify --source ${sourceIdn} --dest ${destIdn}`);
    console.log(`   3. Test agent: npx newo sandbox "test message" --customer ${destIdn}\n`);
  }
}
