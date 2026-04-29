/**
 * AttributeSyncStrategy - Handles synchronization of Customer and Project Attributes
 *
 * This strategy implements ISyncStrategy for the Attributes resource.
 *
 * Key responsibilities:
 * - Pull customer attributes from NEWO platform
 * - Pull project attributes for all projects
 * - Push changed attributes back to platform
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
import type { CustomerAttribute, CustomerAttributesResponse } from '../../../types.js';
import fs from 'fs-extra';
import yaml from 'js-yaml';
import path from 'path';
import {
  getCustomerAttributes,
  getProjectAttributes,
  updateCustomerAttribute,
  updateProjectAttribute,
  listProjects
} from '../../../api.js';
import {
  writeFileSafe,
  customerAttributesPath,
  customerAttributesMapPath
} from '../../../fsutil.js';
import { patchYamlToPyyaml } from '../../../format/yaml-patch.js';
import {
  isJsonValueType,
  normalizeJsonValueForStorage,
  jsonValuesEqual
} from '../../../sync/json-attr-utils.js';
import { sha256, saveHashes, loadHashes } from '../../../hash.js';

/**
 * Local attribute data for storage
 */
export interface LocalAttributeData {
  type: 'customer' | 'project';
  projectIdn?: string;
  attributes: CustomerAttribute[];
  idMapping: Record<string, string>;
}

/**
 * API client factory type
 */
export type ApiClientFactory = (customer: CustomerConfig, verbose: boolean) => Promise<AxiosInstance>;

/**
 * AttributeSyncStrategy - Handles attribute synchronization
 */
export class AttributeSyncStrategy implements ISyncStrategy<CustomerAttributesResponse, LocalAttributeData> {
  readonly resourceType = 'attributes';
  readonly displayName = 'Attributes';

  constructor(
    private apiClientFactory: ApiClientFactory,
    private logger: ILogger
  ) {}

  /**
   * Pull all attributes from NEWO platform
   */
  async pull(customer: CustomerConfig, options: PullOptions = {}): Promise<PullResult<LocalAttributeData>> {
    const client = await this.apiClientFactory(customer, options.verbose ?? false);
    const hashes: HashStore = {};
    const items: LocalAttributeData[] = [];

    this.logger.verbose(`🔍 Fetching attributes for ${customer.idn}...`);

    // Pull customer attributes
    const customerAttrs = await this.pullCustomerAttributes(client, customer, hashes, options);
    items.push(customerAttrs);

    // Pull project attributes
    const projects = await listProjects(client);
    this.logger.verbose(`📁 Pulling attributes for ${projects.length} projects`);

    for (const project of projects) {
      try {
        const projectAttrs = await this.pullProjectAttributes(
          client, customer, project.id, project.idn, hashes, options
        );
        if (projectAttrs) {
          items.push(projectAttrs);
        }
      } catch (error) {
        this.logger.warn(`Failed to pull attributes for project ${project.idn}`);
      }
    }

    // Save hashes
    const existingHashes = await loadHashes(customer.idn);
    await saveHashes({ ...existingHashes, ...hashes }, customer.idn);

    return {
      items,
      count: items.length,
      hashes
    };
  }

  /**
   * Pull customer attributes
   */
  private async pullCustomerAttributes(
    client: AxiosInstance,
    customer: CustomerConfig,
    hashes: HashStore,
    options: PullOptions
  ): Promise<LocalAttributeData> {
    this.logger.verbose(`  📦 Fetching customer attributes...`);

    const response = await getCustomerAttributes(client, true);
    const attributes = response.attributes || [];

    // Create ID mapping
    const idMapping: Record<string, string> = {};
    const cleanAttributes = attributes.map(attr => {
      if (attr.id) {
        idMapping[attr.idn] = attr.id;
      }
      return this.cleanAttribute(attr);
    });

    // Format as YAML
    const yamlContent = this.formatAttributesYaml(cleanAttributes);

    // Save files
    const attributesPath = customerAttributesPath(customer.idn);
    await writeFileSafe(attributesPath, yamlContent);
    await writeFileSafe(customerAttributesMapPath(customer.idn), JSON.stringify(idMapping, null, 2));

    hashes[attributesPath] = sha256(yamlContent);

    if (options.verbose) {
      this.logger.info(`  ✓ Saved ${cleanAttributes.length} customer attributes`);
    }

    return {
      type: 'customer',
      attributes: cleanAttributes,
      idMapping
    };
  }

  /**
   * Pull project attributes
   */
  private async pullProjectAttributes(
    client: AxiosInstance,
    customer: CustomerConfig,
    projectId: string,
    projectIdn: string,
    hashes: HashStore,
    options: PullOptions
  ): Promise<LocalAttributeData | null> {
    try {
      const response = await getProjectAttributes(client, projectId, true);
      const attributes = response.attributes || [];

      if (attributes.length === 0) {
        return null;
      }

      // Create ID mapping
      const idMapping: Record<string, string> = {};
      const cleanAttributes = attributes.map(attr => {
        if (attr.id) {
          idMapping[attr.idn] = attr.id;
        }
        return this.cleanAttribute(attr);
      });

      // Format as YAML
      const yamlContent = this.formatAttributesYaml(cleanAttributes);

      // Save files
      const customerDir = path.join(process.cwd(), 'newo_customers', customer.idn);
      const projectDir = path.join(customerDir, 'projects', projectIdn);
      await fs.ensureDir(projectDir);

      const attributesFile = path.join(projectDir, 'attributes.yaml');
      const mapFile = path.join(process.cwd(), '.newo', customer.idn, `project_${projectIdn}_attributes-map.json`);

      await writeFileSafe(attributesFile, yamlContent);
      await fs.ensureDir(path.dirname(mapFile));
      await writeFileSafe(mapFile, JSON.stringify(idMapping, null, 2));

      hashes[attributesFile] = sha256(yamlContent);

      if (options.verbose) {
        this.logger.verbose(`    ✓ Saved ${cleanAttributes.length} attributes for project ${projectIdn}`);
      }

      return {
        type: 'project',
        projectIdn,
        attributes: cleanAttributes,
        idMapping
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Clean an attribute for local storage
   */
  private cleanAttribute(attr: CustomerAttribute): CustomerAttribute {
    let processedValue = attr.value;

    // Coerce JSON-typed values to a STRING. The API may return parsed
    // objects for `value_type: json`; if we let yaml.dump turn them into
    // YAML structures, the next push sends an object and the Workflow
    // Builder canvas blanks out. See src/sync/json-attr-utils.ts.
    if (isJsonValueType(attr.value_type)) {
      processedValue = normalizeJsonValueForStorage(attr.value);
    } else if (typeof attr.value === 'string' && attr.value.startsWith('[{') && attr.value.endsWith('}]')) {
      // Legacy: reformat array-of-objects JSON strings for readability
      try {
        const parsed = JSON.parse(attr.value);
        processedValue = JSON.stringify(parsed, null, 0);
      } catch {
        processedValue = attr.value;
      }
    }

    return {
      idn: attr.idn,
      value: processedValue,
      title: attr.title || '',
      description: attr.description || '',
      group: attr.group || '',
      is_hidden: attr.is_hidden,
      possible_values: attr.possible_values || [],
      value_type: attr.value_type
    };
  }

  /**
   * Format attributes as YAML
   */
  private formatAttributesYaml(attributes: CustomerAttribute[]): string {
    // Add enum placeholders for value_type
    const attributesWithPlaceholders = attributes.map(attr => ({
      ...attr,
      value_type: `__ENUM_PLACEHOLDER_${attr.value_type}__`
    }));

    // Emit YAML without folding/wrapping; patchYamlToPyyaml handles long-line
    // wrapping and converts JSON-like double-quoted values to single-quoted
    // (so strings containing `"` stay valid YAML on reload).
    let yamlContent = yaml.dump({ attributes: attributesWithPlaceholders }, {
      indent: 2,
      quotingType: '"',
      forceQuotes: false,
      lineWidth: -1,
      noRefs: true,
      sortKeys: false,
      flowLevel: -1,
    });

    yamlContent = yamlContent.replace(/__ENUM_PLACEHOLDER_(\w+)__/g, '!enum "AttributeValueTypes.$1"');
    yamlContent = patchYamlToPyyaml(yamlContent);

    return yamlContent;
  }

  /**
   * Push changed attributes to NEWO platform
   */
  async push(customer: CustomerConfig, changes?: ChangeItem<LocalAttributeData>[]): Promise<PushResult> {
    const result: PushResult = { created: 0, updated: 0, deleted: 0, errors: [] };

    if (!changes) {
      changes = await this.getChanges(customer);
    }

    if (changes.length === 0) {
      return result;
    }

    const client = await this.apiClientFactory(customer, false);

    for (const change of changes) {
      try {
        if (change.item.type === 'customer') {
          const updateCount = await this.pushCustomerAttributes(client, customer, change.item);
          result.updated += updateCount;
        } else if (change.item.type === 'project' && change.item.projectIdn) {
          const updateCount = await this.pushProjectAttributes(
            client, customer, change.item.projectIdn, change.item
          );
          result.updated += updateCount;
        }
      } catch (error) {
        result.errors.push(`Failed to push ${change.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return result;
  }

  /**
   * Push customer attributes
   */
  private async pushCustomerAttributes(
    client: AxiosInstance,
    customer: CustomerConfig,
    _data: LocalAttributeData
  ): Promise<number> {
    // Load current attributes from file
    const attributesFile = customerAttributesPath(customer.idn);
    const mapFile = customerAttributesMapPath(customer.idn);

    if (!(await fs.pathExists(attributesFile)) || !(await fs.pathExists(mapFile))) {
      return 0;
    }

    let content = await fs.readFile(attributesFile, 'utf-8');
    content = content.replace(/!enum "AttributeValueTypes\.(\w+)"/g, '$1');

    const localData = yaml.load(content) as { attributes: CustomerAttribute[] };
    const idMapping = JSON.parse(await fs.readFile(mapFile, 'utf-8')) as Record<string, string>;

    // Get remote attributes
    const remoteResponse = await getCustomerAttributes(client, true);
    const remoteMap = new Map<string, CustomerAttribute>();
    remoteResponse.attributes.forEach(attr => remoteMap.set(attr.idn, attr));

    let updatedCount = 0;

    for (const localAttr of localData.attributes) {
      const attributeId = idMapping[localAttr.idn];
      if (!attributeId) continue;

      const remoteAttr = remoteMap.get(localAttr.idn);
      if (!remoteAttr) continue;

      // For JSON-typed attrs, compare canonical JSON (handles
      // pretty/compact and string/object differences). Always send the
      // value as a STRING so the platform stores the canvas the way the
      // Workflow Builder expects to read it back.
      const isJson = isJsonValueType(localAttr.value_type);
      const valuesAreEqual = isJson
        ? jsonValuesEqual(localAttr.value, remoteAttr.value)
        : String(localAttr.value) === String(remoteAttr.value);

      if (!valuesAreEqual) {
        const valueToSend = isJson
          ? normalizeJsonValueForStorage(localAttr.value)
          : localAttr.value;

        await updateCustomerAttribute(client, {
          ...localAttr,
          value: valueToSend,
          id: attributeId
        });
        updatedCount++;
        this.logger.info(`  ✓ Updated customer attribute: ${localAttr.idn}`);
      }
    }

    return updatedCount;
  }

  /**
   * Push project attributes
   */
  private async pushProjectAttributes(
    client: AxiosInstance,
    customer: CustomerConfig,
    projectIdn: string,
    _data: LocalAttributeData
  ): Promise<number> {
    const customerDir = path.join(process.cwd(), 'newo_customers', customer.idn);
    const attributesFile = path.join(customerDir, 'projects', projectIdn, 'attributes.yaml');
    const mapFile = path.join(process.cwd(), '.newo', customer.idn, `project_${projectIdn}_attributes-map.json`);

    if (!(await fs.pathExists(attributesFile)) || !(await fs.pathExists(mapFile))) {
      return 0;
    }

    let content = await fs.readFile(attributesFile, 'utf-8');
    content = content.replace(/!enum "AttributeValueTypes\.(\w+)"/g, '$1');

    const localData = yaml.load(content) as { attributes: CustomerAttribute[] };
    const idMapping = JSON.parse(await fs.readFile(mapFile, 'utf-8')) as Record<string, string>;

    // Get project ID from projects list
    const projects = await listProjects(client);
    const project = projects.find(p => p.idn === projectIdn);
    if (!project) {
      return 0;
    }

    // Get remote attributes
    const remoteResponse = await getProjectAttributes(client, project.id, true);
    const remoteMap = new Map<string, CustomerAttribute>();
    remoteResponse.attributes.forEach(attr => remoteMap.set(attr.idn, attr));

    let updatedCount = 0;

    for (const localAttr of localData.attributes) {
      const attributeId = idMapping[localAttr.idn];
      if (!attributeId) continue;

      const remoteAttr = remoteMap.get(localAttr.idn);
      if (!remoteAttr) continue;

      // Same canonical-JSON / always-string-on-push policy as customer
      // attributes (see pushCustomerAttributes for rationale).
      const isJson = isJsonValueType(localAttr.value_type);
      const valuesAreEqual = isJson
        ? jsonValuesEqual(localAttr.value, remoteAttr.value)
        : String(localAttr.value) === String(remoteAttr.value);

      if (!valuesAreEqual) {
        const valueToSend = isJson
          ? normalizeJsonValueForStorage(localAttr.value)
          : localAttr.value;

        await updateProjectAttribute(client, project.id, {
          ...localAttr,
          value: valueToSend,
          id: attributeId
        });
        updatedCount++;
        this.logger.info(`  ✓ Updated project attribute: ${projectIdn}/${localAttr.idn}`);
      }
    }

    return updatedCount;
  }

  /**
   * Detect changes in attribute files
   */
  async getChanges(customer: CustomerConfig): Promise<ChangeItem<LocalAttributeData>[]> {
    const changes: ChangeItem<LocalAttributeData>[] = [];
    const hashes = await loadHashes(customer.idn);

    // Check customer attributes
    const customerAttrsPath = customerAttributesPath(customer.idn);
    if (await fs.pathExists(customerAttrsPath)) {
      const content = await fs.readFile(customerAttrsPath, 'utf-8');
      const currentHash = sha256(content);
      const storedHash = hashes[customerAttrsPath];

      if (storedHash !== currentHash) {
        changes.push({
          item: { type: 'customer', attributes: [], idMapping: {} },
          operation: 'modified',
          path: customerAttrsPath
        });
      }
    }

    // Check project attributes
    const customerDir = path.join(process.cwd(), 'newo_customers', customer.idn, 'projects');
    if (await fs.pathExists(customerDir)) {
      const projectDirs = await fs.readdir(customerDir);

      for (const projectIdn of projectDirs) {
        const attributesFile = path.join(customerDir, projectIdn, 'attributes.yaml');

        if (await fs.pathExists(attributesFile)) {
          const content = await fs.readFile(attributesFile, 'utf-8');
          const currentHash = sha256(content);
          const storedHash = hashes[attributesFile];

          if (storedHash !== currentHash) {
            changes.push({
              item: { type: 'project', projectIdn, attributes: [], idMapping: {} },
              operation: 'modified',
              path: attributesFile
            });
          }
        }
      }
    }

    return changes;
  }

  /**
   * Validate attribute data
   */
  async validate(_customer: CustomerConfig, items: LocalAttributeData[]): Promise<ValidationResult> {
    const errors: ValidationError[] = [];

    for (const item of items) {
      for (const attr of item.attributes) {
        if (!attr.idn) {
          errors.push({
            field: 'idn',
            message: 'Attribute IDN is required'
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
 * Factory function for creating AttributeSyncStrategy
 */
export function createAttributeSyncStrategy(
  apiClientFactory: ApiClientFactory,
  logger: ILogger
): AttributeSyncStrategy {
  return new AttributeSyncStrategy(apiClientFactory, logger);
}
