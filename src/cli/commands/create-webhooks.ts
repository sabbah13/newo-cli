/**
 * Webhook creation command handler
 */
import { makeClient } from '../../api.js';
import { getValidAccessToken } from '../../auth.js';
import { selectSingleCustomer } from '../customer-selection.js';
import { customerDir } from '../../fsutil.js';
import fs from 'fs-extra';
import yaml from 'js-yaml';
import path from 'path';
import type { MultiCustomerConfig, CliArgs } from '../../types.js';

export async function handleCreateWebhooksCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean
): Promise<void> {
  const { selectedCustomer } = selectSingleCustomer(
    customerConfig,
    args.customer as string | undefined
  );

  if (!selectedCustomer) {
    console.error('❌ No customer selected');
    process.exit(1);
  }

  const accessToken = await getValidAccessToken(selectedCustomer);
  const client = await makeClient(verbose, accessToken);

  console.log(`\n📡 Creating webhooks for ${selectedCustomer.idn}...\n`);

  const custDir = customerDir(selectedCustomer.idn);
  let outgoingCreated = 0;
  let incomingCreated = 0;

  // Create outgoing webhooks
  const outgoingFile = path.join(custDir, 'integrations/api/connectors/webhook/webhooks/outgoing.yaml');
  if (await fs.pathExists(outgoingFile)) {
    const outgoingData = yaml.load(await fs.readFile(outgoingFile, 'utf8')) as any;
    const webhooks = outgoingData.webhooks || [];

    console.log(`Found ${webhooks.length} outgoing webhooks in YAML file`);

    for (const webhook of webhooks) {
      try {
        await client.post('/api/v1/webhooks', {
          idn: webhook.idn,
          description: webhook.description || '',
          connector_idn: webhook.connector_idn,
          url: webhook.url,
          command_idns: webhook.command_idns || []
        });
        outgoingCreated++;
        console.log(`   ✅ Created outgoing: ${webhook.idn}`);
      } catch (error: any) {
        const status = error.response?.status;

        if (status === 409) {
          console.log(`   ℹ️  Already exists: ${webhook.idn}`);
        } else {
          console.error(`   ❌ Failed: ${webhook.idn} - ${error.response?.data?.reason || error.message}`);
        }
      }
    }
  }

  // Create incoming webhooks
  const incomingFile = path.join(custDir, 'integrations/api/connectors/webhook/webhooks/incoming.yaml');
  if (await fs.pathExists(incomingFile)) {
    const incomingData = yaml.load(await fs.readFile(incomingFile, 'utf8')) as any;
    const webhooks = incomingData.webhooks || [];

    console.log(`\nFound ${webhooks.length} incoming webhooks in YAML file`);

    for (const webhook of webhooks) {
      try {
        await client.post('/api/v1/webhooks/incoming', {
          idn: webhook.idn,
          description: webhook.description || '',
          connector_idn: webhook.connector_idn,
          event_idns: webhook.event_idns || [],
          allowed_ips: webhook.allowed_ips || []
        });
        incomingCreated++;
        console.log(`   ✅ Created incoming: ${webhook.idn}`);
      } catch (error: any) {
        const status = error.response?.status;

        if (status === 409) {
          console.log(`   ℹ️  Already exists: ${webhook.idn}`);
        } else {
          console.error(`   ❌ Failed: ${webhook.idn} - ${error.response?.data?.reason || error.message}`);
        }
      }
    }
  }

  console.log(`\n✅ Created ${outgoingCreated} outgoing and ${incomingCreated} incoming webhooks\n`);
}
