/**
 * Integration and connector synchronization module
 * Handles pull/push of integrations and connectors to/from NEWO platform
 */

import path from 'path';
import fs from 'fs-extra';
import yaml from 'js-yaml';
import type { AxiosInstance } from 'axios';
import {
  listIntegrations,
  listConnectors,
  getIntegrationSettings,
  createConnector,
  updateConnector,
  deleteConnector,
  listOutgoingWebhooks,
  listIncomingWebhooks
} from '../api.js';
import type {
  Connector,
  IntegrationMetadata,
  ConnectorMetadata,
  IntegrationsYamlData,
  OutgoingWebhook,
  IncomingWebhook
} from '../types.js';

/**
 * Pull all integrations and connectors from NEWO platform
 */
export async function pullIntegrations(
  client: AxiosInstance,
  customerDir: string,
  verbose: boolean = false
): Promise<void> {
  if (verbose) console.log('\n📦 Pulling integrations from NEWO platform...\n');

  // Create integrations directory
  const integrationsDir = path.join(customerDir, 'integrations');
  await fs.ensureDir(integrationsDir);

  // Fetch all integrations
  const integrations = await listIntegrations(client);
  if (verbose) console.log(`✓ Found ${integrations.length} integrations`);

  const integrationsMetadata: IntegrationMetadata[] = [];

  // Process each integration
  for (const integration of integrations) {
    if (verbose) console.log(`\n  📦 Processing: ${integration.title} (${integration.idn})`);

    // Add to metadata list
    integrationsMetadata.push({
      id: integration.id,
      idn: integration.idn,
      title: integration.title,
      description: integration.description,
      channel: integration.channel,
      is_disabled: integration.is_disabled
    });

    // Create integration directory
    const integrationDir = path.join(integrationsDir, integration.idn);
    await fs.ensureDir(integrationDir);

    // Fetch integration settings
    let integrationSettings: any[] = [];
    try {
      integrationSettings = await getIntegrationSettings(client, integration.id);
    } catch (error: any) {
      // Settings endpoint may not be available for all integrations
      if (verbose && error.response?.status !== 404) {
        console.log(`     ⚠ Could not fetch settings: ${error.message}`);
      }
    }

    // Save combined integration file (metadata + settings)
    const integrationFile = path.join(integrationDir, `${integration.idn}.yaml`);
    const integrationData: any = {
      id: integration.id,
      idn: integration.idn,
      title: integration.title,
      description: integration.description,
      channel: integration.channel,
      is_disabled: integration.is_disabled
    };

    // Add settings array if any settings exist
    if (integrationSettings.length > 0) {
      integrationData.settings = integrationSettings;
    }

    await fs.writeFile(integrationFile, yaml.dump(integrationData, { lineWidth: -1 }));
    if (verbose) console.log(`     ✓ Saved integration → ${integration.idn}.yaml (${integrationSettings.length} settings)`);

    // Fetch and save connectors
    const connectors = await listConnectors(client, integration.id);
    if (verbose) console.log(`     Connectors: ${connectors.length} found`);

    if (connectors.length > 0) {
      const connectorsDir = path.join(integrationDir, 'connectors');
      await fs.ensureDir(connectorsDir);

      for (const connector of connectors) {
        const connectorMetadata: ConnectorMetadata = {
          id: connector.id,
          connector_idn: connector.connector_idn,
          title: connector.title,
          status: connector.status,
          integration_idn: integration.idn,
          settings: connector.settings
        };

        // Create subdirectory for this connector
        const connectorDir = path.join(connectorsDir, connector.connector_idn);
        await fs.ensureDir(connectorDir);

        // Save connector YAML file inside its subdirectory
        const connectorFile = path.join(connectorDir, `${connector.connector_idn}.yaml`);
        await fs.writeFile(connectorFile, yaml.dump(connectorMetadata, { lineWidth: -1 }));

        if (verbose) console.log(`     ✓ Saved: ${connector.title} → connectors/${connector.connector_idn}/${connector.connector_idn}.yaml`);
      }
    }
  }

  // Fetch and save webhooks (for API integration connectors only)
  if (verbose) console.log(`\n📡 Fetching webhooks...`);

  try {
    const outgoingWebhooks = await listOutgoingWebhooks(client);
    const incomingWebhooks = await listIncomingWebhooks(client);

    if (verbose) console.log(`✓ Found ${outgoingWebhooks.length} outgoing webhooks`);
    if (verbose) console.log(`✓ Found ${incomingWebhooks.length} incoming webhooks`);

    // Group webhooks by connector_idn
    const outgoingByConnector = new Map<string, OutgoingWebhook[]>();
    const incomingByConnector = new Map<string, IncomingWebhook[]>();

    outgoingWebhooks.forEach(webhook => {
      if (!outgoingByConnector.has(webhook.connector_idn)) {
        outgoingByConnector.set(webhook.connector_idn, []);
      }
      outgoingByConnector.get(webhook.connector_idn)!.push(webhook);
    });

    incomingWebhooks.forEach(webhook => {
      if (!incomingByConnector.has(webhook.connector_idn)) {
        incomingByConnector.set(webhook.connector_idn, []);
      }
      incomingByConnector.get(webhook.connector_idn)!.push(webhook);
    });

    // Save webhooks to appropriate connector directories
    for (const integration of integrations) {
      const integrationDir = path.join(integrationsDir, integration.idn);
      const connectorsDir = path.join(integrationDir, 'connectors');

      if (await fs.pathExists(connectorsDir)) {
        const connectors = await listConnectors(client, integration.id);

        for (const connector of connectors) {
          const connectorWebhooksDir = path.join(connectorsDir, connector.connector_idn, 'webhooks');

          const outgoing = outgoingByConnector.get(connector.connector_idn) || [];
          const incoming = incomingByConnector.get(connector.connector_idn) || [];

          if (outgoing.length > 0 || incoming.length > 0) {
            await fs.ensureDir(connectorWebhooksDir);

            if (outgoing.length > 0) {
              const outgoingFile = path.join(connectorWebhooksDir, 'outgoing.yaml');
              await fs.writeFile(outgoingFile, yaml.dump({ webhooks: outgoing }, { lineWidth: -1 }));
              if (verbose) console.log(`     ✓ Saved: ${outgoing.length} outgoing webhooks → ${connector.connector_idn}/webhooks/outgoing.yaml`);
            }

            if (incoming.length > 0) {
              const incomingFile = path.join(connectorWebhooksDir, 'incoming.yaml');
              await fs.writeFile(incomingFile, yaml.dump({ webhooks: incoming }, { lineWidth: -1 }));
              if (verbose) console.log(`     ✓ Saved: ${incoming.length} incoming webhooks → ${connector.connector_idn}/webhooks/incoming.yaml`);
            }
          }
        }
      }
    }
  } catch (error: any) {
    if (verbose) console.log(`⚠ Could not fetch webhooks: ${error.message}`);
  }

  // Save master integrations list
  const integrationsData: IntegrationsYamlData = { integrations: integrationsMetadata };
  const integrationsFile = path.join(integrationsDir, 'integrations.yaml');
  await fs.writeFile(integrationsFile, yaml.dump(integrationsData, { lineWidth: -1 }));

  if (verbose) console.log(`\n✅ Saved ${integrations.length} integrations to integrations/integrations.yaml\n`);
}

/**
 * Push integration changes from local files to NEWO platform
 */
export async function pushIntegrations(
  client: AxiosInstance,
  customerDir: string,
  verbose: boolean = false
): Promise<void> {
  if (verbose) console.log('\n📤 Pushing integration changes to NEWO platform...\n');

  const integrationsDir = path.join(customerDir, 'integrations');

  // Check if integrations directory exists
  if (!await fs.pathExists(integrationsDir)) {
    if (verbose) console.log('⚠ No integrations directory found. Run pull-integrations first.');
    return;
  }

  // Load remote integrations for ID mapping
  const remoteIntegrations = await listIntegrations(client);
  const integrationMap = new Map<string, string>(); // idn -> id
  remoteIntegrations.forEach(int => integrationMap.set(int.idn, int.id));

  let updatedCount = 0;
  let createdCount = 0;
  let deletedCount = 0;

  // Read integrations directory
  const integrationFolders = await fs.readdir(integrationsDir);

  for (const folder of integrationFolders) {
    if (folder === 'integrations.yaml') continue; // Skip master file

    const integrationDir = path.join(integrationsDir, folder);
    const stat = await fs.stat(integrationDir);
    if (!stat.isDirectory()) continue;

    const integrationIdn = folder;
    const integrationId = integrationMap.get(integrationIdn);

    if (!integrationId) {
      if (verbose) console.log(`⚠ Integration ${integrationIdn} not found on platform, skipping...`);
      continue;
    }

    if (verbose) console.log(`\n  📦 Processing: ${integrationIdn}`);

    // Process connectors
    const connectorsDir = path.join(integrationDir, 'connectors');
    if (await fs.pathExists(connectorsDir)) {
      // Load remote connectors for comparison
      const remoteConnectors = await listConnectors(client, integrationId);
      const remoteConnectorMap = new Map<string, Connector>();
      remoteConnectors.forEach(conn => remoteConnectorMap.set(conn.connector_idn, conn));

      // Read connector subdirectories
      const connectorDirs = await fs.readdir(connectorsDir);
      const localConnectorIdns = new Set<string>();

      for (const connectorDirName of connectorDirs) {
        const connectorPath = path.join(connectorsDir, connectorDirName);
        const stat = await fs.stat(connectorPath);
        if (!stat.isDirectory()) continue; // Skip non-directories

        // Read connector YAML file from within the subdirectory
        const connectorFile = path.join(connectorPath, `${connectorDirName}.yaml`);
        if (!await fs.pathExists(connectorFile)) {
          if (verbose) console.log(`     ⚠ No YAML file found in ${connectorDirName}/, skipping...`);
          continue;
        }

        const connectorData = yaml.load(await fs.readFile(connectorFile, 'utf-8')) as ConnectorMetadata;

        localConnectorIdns.add(connectorData.connector_idn);

        const remoteConnector = remoteConnectorMap.get(connectorData.connector_idn);

        if (!remoteConnector) {
          // Create new connector
          if (verbose) console.log(`     ➕ Creating connector: ${connectorData.title}`);
          try {
            await createConnector(client, integrationId, {
              title: connectorData.title,
              connector_idn: connectorData.connector_idn,
              integration_idn: integrationIdn,
              settings: connectorData.settings
            });
            createdCount++;
            if (verbose) console.log(`     ✅ Created: ${connectorData.title}`);
          } catch (error: any) {
            console.error(`     ❌ Failed to create connector: ${error.message}`);
          }
        } else {
          // Check if connector needs update
          const needsUpdate = hasConnectorChanged(remoteConnector, connectorData);

          if (needsUpdate) {
            if (verbose) console.log(`     🔄 Updating connector: ${connectorData.title}`);
            try {
              await updateConnector(client, remoteConnector.id, {
                title: connectorData.title,
                status: connectorData.status,
                settings: connectorData.settings
              });
              updatedCount++;
              if (verbose) console.log(`     ✅ Updated: ${connectorData.title}`);
            } catch (error: any) {
              console.error(`     ❌ Failed to update connector: ${error.message}`);
            }
          } else {
            if (verbose) console.log(`     ✓ No changes: ${connectorData.title}`);
          }
        }
      }

      // Delete connectors that exist remotely but not locally
      for (const [connectorIdn, remoteConnector] of remoteConnectorMap) {
        if (!localConnectorIdns.has(connectorIdn)) {
          if (verbose) console.log(`     🗑️ Deleting connector: ${remoteConnector.title}`);
          try {
            await deleteConnector(client, remoteConnector.id);
            deletedCount++;
            if (verbose) console.log(`     ✅ Deleted: ${remoteConnector.title}`);
          } catch (error: any) {
            console.error(`     ❌ Failed to delete connector: ${error.message}`);
          }
        }
      }
    }
  }

  // Always show summary if changes were made, not just in verbose mode
  if (createdCount > 0 || updatedCount > 0 || deletedCount > 0) {
    console.log(`\n✅ Integration push completed:`);
    console.log(`   Created: ${createdCount} connector(s)`);
    console.log(`   Updated: ${updatedCount} connector(s)`);
    console.log(`   Deleted: ${deletedCount} connector(s)`);
  } else {
    console.log(`\n✓ No connector changes to push`);
  }
}

/**
 * Check if connector has changed compared to remote version
 */
function hasConnectorChanged(remote: Connector, local: ConnectorMetadata): boolean {
  // Check title
  if (remote.title !== local.title) return true;

  // Check status
  if (remote.status !== local.status) return true;

  // Check settings
  if (remote.settings.length !== local.settings.length) return true;

  // Compare each setting
  const remoteSettingsMap = new Map<string, string>();
  remote.settings.forEach(s => remoteSettingsMap.set(s.idn, s.value));

  for (const localSetting of local.settings) {
    const remoteValue = remoteSettingsMap.get(localSetting.idn);
    if (remoteValue !== localSetting.value) return true;
  }

  return false;
}

/**
 * List all local integrations from file system
 */
export async function listLocalIntegrations(customerDir: string): Promise<IntegrationMetadata[]> {
  const integrationsFile = path.join(customerDir, 'integrations', 'integrations.yaml');

  if (!await fs.pathExists(integrationsFile)) {
    return [];
  }

  const data = yaml.load(await fs.readFile(integrationsFile, 'utf-8')) as IntegrationsYamlData;
  return data.integrations;
}

/**
 * Get connector details from local file
 */
export async function getLocalConnector(
  customerDir: string,
  integrationIdn: string,
  connectorIdn: string
): Promise<ConnectorMetadata | null> {
  const connectorFile = path.join(
    customerDir,
    'integrations',
    integrationIdn,
    'connectors',
    connectorIdn,
    `${connectorIdn}.yaml`
  );

  if (!await fs.pathExists(connectorFile)) {
    return null;
  }

  return yaml.load(await fs.readFile(connectorFile, 'utf-8')) as ConnectorMetadata;
}
