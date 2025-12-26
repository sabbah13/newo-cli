/**
 * IntegrationSyncStrategy - Handles synchronization of Integrations, Connectors, and Webhooks
 *
 * This strategy implements ISyncStrategy for the Integrations resource.
 *
 * Key responsibilities:
 * - Pull integrations from NEWO platform
 * - Pull connectors for each integration
 * - Pull webhooks (outgoing and incoming)
 * - Push connector changes back to platform
 * - Detect changes using stored hashes
 */

import type {
  ISyncStrategy,
  PullOptions,
  PullResult,
  PushResult,
  ChangeItem,
  ValidationResult,
  ValidationError,
  StatusSummary
} from './ISyncStrategy.js';
import type { CustomerConfig, ILogger, HashStore } from '../../resources/common/types.js';
import type { AxiosInstance } from 'axios';
import type {
  Integration,
  Connector,
  IntegrationMetadata,
  ConnectorMetadata,
  OutgoingWebhook,
  IncomingWebhook
} from '../../../types.js';
import fs from 'fs-extra';
import yaml from 'js-yaml';
import path from 'path';
import {
  listIntegrations,
  listConnectors,
  getIntegrationSettings,
  createConnector,
  updateConnector,
  deleteConnector,
  listOutgoingWebhooks,
  listIncomingWebhooks
} from '../../../api.js';
import { sha256, saveHashes, loadHashes } from '../../../hash.js';

/**
 * Local integration data for storage
 */
export interface LocalIntegrationData {
  integration: IntegrationMetadata;
  connectors: ConnectorMetadata[];
  outgoingWebhooks: OutgoingWebhook[];
  incomingWebhooks: IncomingWebhook[];
}

/**
 * API client factory type
 */
export type ApiClientFactory = (customer: CustomerConfig, verbose: boolean) => Promise<AxiosInstance>;

/**
 * IntegrationSyncStrategy - Handles integration synchronization
 */
export class IntegrationSyncStrategy implements ISyncStrategy<Integration, LocalIntegrationData> {
  readonly resourceType = 'integrations';
  readonly displayName = 'Integrations';

  constructor(
    private apiClientFactory: ApiClientFactory,
    private logger: ILogger
  ) {}

  /**
   * Pull all integrations from NEWO platform
   */
  async pull(customer: CustomerConfig, options: PullOptions = {}): Promise<PullResult<LocalIntegrationData>> {
    const client = await this.apiClientFactory(customer, options.verbose ?? false);
    const hashes: HashStore = {};
    const items: LocalIntegrationData[] = [];

    this.logger.verbose(`🔍 Fetching integrations for ${customer.idn}...`);

    const customerDir = path.join(process.cwd(), 'newo_customers', customer.idn);
    const integrationsDir = path.join(customerDir, 'integrations');
    await fs.ensureDir(integrationsDir);

    // Fetch all integrations
    const integrations = await listIntegrations(client);
    this.logger.verbose(`📦 Found ${integrations.length} integrations`);

    const integrationsMetadata: IntegrationMetadata[] = [];

    // Fetch webhooks once for all integrations
    let allOutgoingWebhooks: OutgoingWebhook[] = [];
    let allIncomingWebhooks: IncomingWebhook[] = [];

    try {
      allOutgoingWebhooks = await listOutgoingWebhooks(client);
      allIncomingWebhooks = await listIncomingWebhooks(client);
      this.logger.verbose(`📡 Found ${allOutgoingWebhooks.length} outgoing, ${allIncomingWebhooks.length} incoming webhooks`);
    } catch (error) {
      this.logger.warn('Could not fetch webhooks');
    }

    // Group webhooks by connector_idn
    const outgoingByConnector = new Map<string, OutgoingWebhook[]>();
    const incomingByConnector = new Map<string, IncomingWebhook[]>();

    allOutgoingWebhooks.forEach(webhook => {
      if (!outgoingByConnector.has(webhook.connector_idn)) {
        outgoingByConnector.set(webhook.connector_idn, []);
      }
      outgoingByConnector.get(webhook.connector_idn)!.push(webhook);
    });

    allIncomingWebhooks.forEach(webhook => {
      if (!incomingByConnector.has(webhook.connector_idn)) {
        incomingByConnector.set(webhook.connector_idn, []);
      }
      incomingByConnector.get(webhook.connector_idn)!.push(webhook);
    });

    // Process each integration
    for (const integration of integrations) {
      this.logger.verbose(`  📦 Processing: ${integration.title} (${integration.idn})`);

      const metadata: IntegrationMetadata = {
        id: integration.id,
        idn: integration.idn,
        title: integration.title,
        description: integration.description,
        channel: integration.channel,
        is_disabled: integration.is_disabled
      };
      integrationsMetadata.push(metadata);

      // Create integration directory
      const integrationDir = path.join(integrationsDir, integration.idn);
      await fs.ensureDir(integrationDir);

      // Fetch integration settings
      let integrationSettings: unknown[] = [];
      try {
        integrationSettings = await getIntegrationSettings(client, integration.id);
      } catch (_error) {
        // Settings endpoint may not be available for all integrations
      }

      // Save combined integration file (metadata + settings)
      const integrationData: Record<string, unknown> = {
        id: integration.id,
        idn: integration.idn,
        title: integration.title,
        description: integration.description,
        channel: integration.channel,
        is_disabled: integration.is_disabled
      };

      if (integrationSettings.length > 0) {
        integrationData.settings = integrationSettings;
      }

      const integrationFile = path.join(integrationDir, `${integration.idn}.yaml`);
      const integrationYaml = yaml.dump(integrationData, { lineWidth: -1 });
      await fs.writeFile(integrationFile, integrationYaml);
      hashes[integrationFile] = sha256(integrationYaml);

      // Fetch and save connectors
      const connectors = await listConnectors(client, integration.id);
      const connectorMetadatas: ConnectorMetadata[] = [];

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
          connectorMetadatas.push(connectorMetadata);

          // Create subdirectory for this connector
          const connectorDir = path.join(connectorsDir, connector.connector_idn);
          await fs.ensureDir(connectorDir);

          // Save connector YAML file
          const connectorFile = path.join(connectorDir, `${connector.connector_idn}.yaml`);
          const connectorYaml = yaml.dump(connectorMetadata, { lineWidth: -1 });
          await fs.writeFile(connectorFile, connectorYaml);
          hashes[connectorFile] = sha256(connectorYaml);

          // Save webhooks if any
          const outgoing = outgoingByConnector.get(connector.connector_idn) || [];
          const incoming = incomingByConnector.get(connector.connector_idn) || [];

          if (outgoing.length > 0 || incoming.length > 0) {
            const webhooksDir = path.join(connectorDir, 'webhooks');
            await fs.ensureDir(webhooksDir);

            if (outgoing.length > 0) {
              const outgoingFile = path.join(webhooksDir, 'outgoing.yaml');
              const outgoingYaml = yaml.dump({ webhooks: outgoing }, { lineWidth: -1 });
              await fs.writeFile(outgoingFile, outgoingYaml);
              hashes[outgoingFile] = sha256(outgoingYaml);
            }

            if (incoming.length > 0) {
              const incomingFile = path.join(webhooksDir, 'incoming.yaml');
              const incomingYaml = yaml.dump({ webhooks: incoming }, { lineWidth: -1 });
              await fs.writeFile(incomingFile, incomingYaml);
              hashes[incomingFile] = sha256(incomingYaml);
            }
          }

          this.logger.verbose(`    ✓ Saved: ${connector.title}`);
        }
      }

      items.push({
        integration: metadata,
        connectors: connectorMetadatas,
        outgoingWebhooks: allOutgoingWebhooks.filter(w =>
          connectorMetadatas.some(c => c.connector_idn === w.connector_idn)
        ),
        incomingWebhooks: allIncomingWebhooks.filter(w =>
          connectorMetadatas.some(c => c.connector_idn === w.connector_idn)
        )
      });
    }

    // Save master integrations list
    const integrationsFile = path.join(integrationsDir, 'integrations.yaml');
    const integrationsYaml = yaml.dump({ integrations: integrationsMetadata }, { lineWidth: -1 });
    await fs.writeFile(integrationsFile, integrationsYaml);
    hashes[integrationsFile] = sha256(integrationsYaml);

    // Save hashes
    const existingHashes = await loadHashes(customer.idn);
    await saveHashes({ ...existingHashes, ...hashes }, customer.idn);

    this.logger.info(`✅ Saved ${integrations.length} integrations`);

    return {
      items,
      count: items.length,
      hashes
    };
  }

  /**
   * Push changed connectors to NEWO platform
   */
  async push(customer: CustomerConfig, changes?: ChangeItem<LocalIntegrationData>[]): Promise<PushResult> {
    const result: PushResult = { created: 0, updated: 0, deleted: 0, errors: [] };

    if (!changes) {
      changes = await this.getChanges(customer);
    }

    if (changes.length === 0) {
      return result;
    }

    const client = await this.apiClientFactory(customer, false);
    const customerDir = path.join(process.cwd(), 'newo_customers', customer.idn);
    const integrationsDir = path.join(customerDir, 'integrations');

    // Load remote integrations for ID mapping
    const remoteIntegrations = await listIntegrations(client);
    const integrationMap = new Map<string, string>(); // idn -> id
    remoteIntegrations.forEach(int => integrationMap.set(int.idn, int.id));

    // Read integration folders
    const integrationFolders = await fs.readdir(integrationsDir);

    for (const folder of integrationFolders) {
      if (folder === 'integrations.yaml') continue;

      const integrationDir = path.join(integrationsDir, folder);
      const stat = await fs.stat(integrationDir);
      if (!stat.isDirectory()) continue;

      const integrationIdn = folder;
      const integrationId = integrationMap.get(integrationIdn);

      if (!integrationId) {
        this.logger.warn(`Integration ${integrationIdn} not found on platform, skipping...`);
        continue;
      }

      // Process connectors
      const connectorsDir = path.join(integrationDir, 'connectors');
      if (await fs.pathExists(connectorsDir)) {
        const remoteConnectors = await listConnectors(client, integrationId);
        const remoteConnectorMap = new Map<string, Connector>();
        remoteConnectors.forEach(conn => remoteConnectorMap.set(conn.connector_idn, conn));

        const connectorDirs = await fs.readdir(connectorsDir);
        const localConnectorIdns = new Set<string>();

        for (const connectorDirName of connectorDirs) {
          const connectorPath = path.join(connectorsDir, connectorDirName);
          const stat = await fs.stat(connectorPath);
          if (!stat.isDirectory()) continue;

          const connectorFile = path.join(connectorPath, `${connectorDirName}.yaml`);
          if (!await fs.pathExists(connectorFile)) continue;

          const connectorData = yaml.load(await fs.readFile(connectorFile, 'utf-8')) as ConnectorMetadata;
          localConnectorIdns.add(connectorData.connector_idn);

          const remoteConnector = remoteConnectorMap.get(connectorData.connector_idn);

          if (!remoteConnector) {
            // Create new connector
            try {
              await createConnector(client, integrationId, {
                title: connectorData.title,
                connector_idn: connectorData.connector_idn,
                integration_idn: integrationIdn,
                settings: connectorData.settings
              });
              result.created++;
              this.logger.info(`  ✓ Created connector: ${connectorData.title}`);
            } catch (error) {
              result.errors.push(`Failed to create connector ${connectorData.connector_idn}: ${error instanceof Error ? error.message : String(error)}`);
            }
          } else if (this.hasConnectorChanged(remoteConnector, connectorData)) {
            // Update connector
            try {
              await updateConnector(client, remoteConnector.id, {
                title: connectorData.title,
                status: connectorData.status,
                settings: connectorData.settings
              });
              result.updated++;
              this.logger.info(`  ✓ Updated connector: ${connectorData.title}`);
            } catch (error) {
              result.errors.push(`Failed to update connector ${connectorData.connector_idn}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        }

        // Delete connectors that exist remotely but not locally
        for (const [connectorIdn, remoteConnector] of remoteConnectorMap) {
          if (!localConnectorIdns.has(connectorIdn)) {
            try {
              await deleteConnector(client, remoteConnector.id);
              result.deleted++;
              this.logger.info(`  ✓ Deleted connector: ${remoteConnector.title}`);
            } catch (error) {
              result.errors.push(`Failed to delete connector ${connectorIdn}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        }
      }
    }

    return result;
  }

  /**
   * Check if connector has changed compared to remote version
   */
  private hasConnectorChanged(remote: Connector, local: ConnectorMetadata): boolean {
    if (remote.title !== local.title) return true;
    if (remote.status !== local.status) return true;
    if (remote.settings.length !== local.settings.length) return true;

    const remoteSettingsMap = new Map<string, string>();
    remote.settings.forEach(s => remoteSettingsMap.set(s.idn, s.value));

    for (const localSetting of local.settings) {
      const remoteValue = remoteSettingsMap.get(localSetting.idn);
      if (remoteValue !== localSetting.value) return true;
    }

    return false;
  }

  /**
   * Detect changes in integration files
   */
  async getChanges(customer: CustomerConfig): Promise<ChangeItem<LocalIntegrationData>[]> {
    const changes: ChangeItem<LocalIntegrationData>[] = [];
    const hashes = await loadHashes(customer.idn);

    const customerDir = path.join(process.cwd(), 'newo_customers', customer.idn);
    const integrationsDir = path.join(customerDir, 'integrations');

    if (!await fs.pathExists(integrationsDir)) {
      return changes;
    }

    const integrationFolders = await fs.readdir(integrationsDir);

    for (const folder of integrationFolders) {
      if (folder === 'integrations.yaml') continue;

      const integrationDir = path.join(integrationsDir, folder);
      const stat = await fs.stat(integrationDir);
      if (!stat.isDirectory()) continue;

      // Check integration file
      const integrationFile = path.join(integrationDir, `${folder}.yaml`);
      if (await fs.pathExists(integrationFile)) {
        const content = await fs.readFile(integrationFile, 'utf-8');
        const currentHash = sha256(content);
        const storedHash = hashes[integrationFile];

        if (storedHash !== currentHash) {
          changes.push({
            item: {
              integration: yaml.load(content) as IntegrationMetadata,
              connectors: [],
              outgoingWebhooks: [],
              incomingWebhooks: []
            },
            operation: storedHash ? 'modified' : 'created',
            path: integrationFile
          });
        }
      }

      // Check connector files
      const connectorsDir = path.join(integrationDir, 'connectors');
      if (await fs.pathExists(connectorsDir)) {
        const connectorDirs = await fs.readdir(connectorsDir);

        for (const connectorDirName of connectorDirs) {
          const connectorPath = path.join(connectorsDir, connectorDirName);
          const stat = await fs.stat(connectorPath);
          if (!stat.isDirectory()) continue;

          const connectorFile = path.join(connectorPath, `${connectorDirName}.yaml`);
          if (await fs.pathExists(connectorFile)) {
            const content = await fs.readFile(connectorFile, 'utf-8');
            const currentHash = sha256(content);
            const storedHash = hashes[connectorFile];

            if (storedHash !== currentHash) {
              changes.push({
                item: {
                  integration: { id: '', idn: folder, title: '', description: '', channel: '', is_disabled: false },
                  connectors: [yaml.load(content) as ConnectorMetadata],
                  outgoingWebhooks: [],
                  incomingWebhooks: []
                },
                operation: storedHash ? 'modified' : 'created',
                path: connectorFile
              });
            }
          }
        }
      }
    }

    return changes;
  }

  /**
   * Validate integration data
   */
  async validate(_customer: CustomerConfig, items: LocalIntegrationData[]): Promise<ValidationResult> {
    const errors: ValidationError[] = [];

    for (const item of items) {
      if (!item.integration.idn) {
        errors.push({
          field: 'idn',
          message: 'Integration IDN is required'
        });
      }

      for (const connector of item.connectors) {
        if (!connector.connector_idn) {
          errors.push({
            field: 'connector_idn',
            message: 'Connector IDN is required'
          });
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Get status summary
   */
  async getStatus(customer: CustomerConfig): Promise<StatusSummary> {
    const changes = await this.getChanges(customer);

    return {
      resourceType: this.resourceType,
      displayName: this.displayName,
      changedCount: changes.length,
      changes: changes.map(c => ({
        path: c.path,
        operation: c.operation
      }))
    };
  }
}

/**
 * Factory function for creating IntegrationSyncStrategy
 */
export function createIntegrationSyncStrategy(
  apiClientFactory: ApiClientFactory,
  logger: ILogger
): IntegrationSyncStrategy {
  return new IntegrationSyncStrategy(apiClientFactory, logger);
}
