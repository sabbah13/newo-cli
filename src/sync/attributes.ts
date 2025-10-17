/**
 * Customer and project attributes synchronization module
 */
import { getCustomerAttributes, getProjectAttributes, listProjects, updateProjectAttribute } from '../api.js';
import {
  writeFileSafe,
  customerAttributesPath,
  customerAttributesMapPath,
  customerAttributesBackupPath
} from '../fsutil.js';
import path from 'path';
import fs from 'fs-extra';
import yaml from 'js-yaml';
import type { AxiosInstance } from 'axios';
import type { CustomerConfig } from '../types.js';

/**
 * Save customer attributes to YAML format and return content for hashing
 */
export async function saveCustomerAttributes(
  client: AxiosInstance,
  customer: CustomerConfig,
  verbose: boolean = false
): Promise<string> {
  if (verbose) console.log(`🔍 Fetching customer attributes for ${customer.idn}...`);

  try {
    const response = await getCustomerAttributes(client, true); // Include hidden attributes

    // API returns { groups: [...], attributes: [...] }
    // We only want the attributes array in the expected format
    const attributes = response.attributes || response;
    if (verbose) console.log(`📦 Found ${Array.isArray(attributes) ? attributes.length : 'invalid'} attributes`);

    // Create ID mapping for push operations (separate from YAML)
    const idMapping: Record<string, string> = {};

    // Transform attributes to match reference format exactly (no ID fields)
    const cleanAttributes = Array.isArray(attributes) ? attributes.map(attr => {
      // Store ID mapping for push operations
      if (attr.id) {
        idMapping[attr.idn] = attr.id;
      }

      // Special handling for complex JSON string values
      let processedValue = attr.value;
      if (typeof attr.value === 'string' && attr.value.startsWith('[{') && attr.value.endsWith('}]')) {
        try {
          // Parse and reformat JSON for better readability
          const parsed = JSON.parse(attr.value);
          processedValue = JSON.stringify(parsed, null, 0); // No extra spacing, but valid JSON
        } catch (e) {
          // Keep original if parsing fails
          processedValue = attr.value;
        }
      }

      const cleanAttr: any = {
        idn: attr.idn,
        value: processedValue,
        title: attr.title || "",
        description: attr.description || "",
        group: attr.group || "",
        is_hidden: attr.is_hidden,
        possible_values: attr.possible_values || [],
        value_type: `__ENUM_PLACEHOLDER_${attr.value_type}__`
      };
      return cleanAttr;
    }) : [];

    const attributesYaml = {
      attributes: cleanAttributes
    };

    // Configure YAML output to match reference format exactly
    let yamlContent = yaml.dump(attributesYaml, {
      indent: 2,
      quotingType: '"',
      forceQuotes: false,
      lineWidth: 80, // Wrap long lines to match reference format
      noRefs: true,
      sortKeys: false,
      flowLevel: -1, // Never use flow syntax
      styles: {
        '!!str': 'folded' // Use folded style for better line wrapping of long strings
      }
    });

    // Post-process to fix enum format and improve JSON string formatting
    yamlContent = yamlContent.replace(/__ENUM_PLACEHOLDER_(\w+)__/g, '!enum "AttributeValueTypes.$1"');

    // Fix JSON string formatting to match reference (remove escape characters)
    yamlContent = yamlContent.replace(/\\"/g, '"');

    // Save all files: attributes.yaml, ID mapping, and backup for diff tracking
    await writeFileSafe(customerAttributesPath(customer.idn), yamlContent);
    await writeFileSafe(customerAttributesMapPath(customer.idn), JSON.stringify(idMapping, null, 2));
    await writeFileSafe(customerAttributesBackupPath(customer.idn), yamlContent);

    if (verbose) {
      console.log(`✓ Saved customer attributes to ${customerAttributesPath(customer.idn)}`);
      console.log(`✓ Saved attribute ID mapping to ${customerAttributesMapPath(customer.idn)}`);
      console.log(`✓ Created attributes backup for diff tracking`);
    }

    // Return content for hash calculation
    return yamlContent;
  } catch (error) {
    console.error(`❌ Failed to save customer attributes for ${customer.idn}:`, error);
    throw error;
  }
}

/**
 * Save project attributes to YAML format in project directory
 */
export async function saveProjectAttributes(
  client: AxiosInstance,
  customer: CustomerConfig,
  projectId: string,
  projectIdn: string,
  verbose: boolean = false
): Promise<void> {
  if (verbose) console.log(`   🔍 Fetching project attributes for ${projectIdn}...`);

  try {
    const response = await getProjectAttributes(client, projectId, true); // Include hidden attributes

    // API returns { groups: [...], attributes: [...] }
    const attributes = response.attributes || response;
    if (verbose) console.log(`   📦 Found ${Array.isArray(attributes) ? attributes.length : 0} project attributes`);

    if (!Array.isArray(attributes) || attributes.length === 0) {
      if (verbose) console.log(`   ℹ No project attributes found for ${projectIdn}`);
      return;
    }

    // Create ID mapping for push operations
    const idMapping: Record<string, string> = {};

    // Transform attributes to match format (no ID fields)
    const cleanAttributes = attributes.map(attr => {
      // Store ID mapping
      if (attr.id) {
        idMapping[attr.idn] = attr.id;
      }

      // Special handling for complex JSON string values
      let processedValue = attr.value;
      if (typeof attr.value === 'string' && attr.value.startsWith('[{') && attr.value.endsWith('}]')) {
        try {
          const parsed = JSON.parse(attr.value);
          processedValue = JSON.stringify(parsed, null, 0);
        } catch (e) {
          processedValue = attr.value;
        }
      }

      return {
        idn: attr.idn,
        value: processedValue,
        title: attr.title || "",
        description: attr.description || "",
        group: attr.group || "",
        is_hidden: attr.is_hidden,
        possible_values: attr.possible_values || [],
        value_type: `__ENUM_PLACEHOLDER_${attr.value_type}__`
      };
    });

    const attributesYaml = {
      attributes: cleanAttributes
    };

    // Configure YAML output
    let yamlContent = yaml.dump(attributesYaml, {
      indent: 2,
      quotingType: '"',
      forceQuotes: false,
      lineWidth: 80,
      noRefs: true,
      sortKeys: false,
      flowLevel: -1
    });

    // Post-process to fix enum format
    yamlContent = yamlContent.replace(/__ENUM_PLACEHOLDER_(\w+)__/g, '!enum "AttributeValueTypes.$1"');
    yamlContent = yamlContent.replace(/\\"/g, '"');

    // Save to project directory
    const customerDir = path.join(process.cwd(), 'newo_customers', customer.idn);
    const projectDir = path.join(customerDir, 'projects', projectIdn);
    await fs.ensureDir(projectDir);

    const attributesFile = path.join(projectDir, 'attributes.yaml');
    const attributesMapFile = path.join(customerDir, '.newo', customer.idn, `project_${projectIdn}_attributes-map.json`);

    await writeFileSafe(attributesFile, yamlContent);
    await fs.ensureDir(path.dirname(attributesMapFile));
    await writeFileSafe(attributesMapFile, JSON.stringify(idMapping, null, 2));

    if (verbose) {
      console.log(`   ✓ Saved project attributes to projects/${projectIdn}/attributes.yaml`);
      console.log(`   ✓ Saved attribute ID mapping`);
    }
  } catch (error: any) {
    if (verbose) console.error(`   ❌ Failed to fetch project attributes for ${projectIdn}:`, error.message);
  }
}

/**
 * Pull all project attributes for a customer
 */
export async function pullAllProjectAttributes(
  client: AxiosInstance,
  customer: CustomerConfig,
  verbose: boolean = false
): Promise<void> {
  if (verbose) console.log(`\n📋 Fetching project attributes...`);

  try {
    // Get all projects for this customer
    const projects = await listProjects(client);
    if (verbose) console.log(`✓ Found ${projects.length} projects\n`);

    for (const project of projects) {
      await saveProjectAttributes(client, customer, project.id, project.idn, verbose);
    }

    if (verbose) console.log(`\n✅ Completed project attributes sync for ${projects.length} projects\n`);
  } catch (error) {
    console.error(`❌ Failed to pull project attributes:`, error);
    throw error;
  }
}

/**
 * Push modified project attributes for a specific project
 */
export async function pushProjectAttributes(
  client: AxiosInstance,
  customer: CustomerConfig,
  projectId: string,
  projectIdn: string,
  verbose: boolean = false
): Promise<number> {
  const customerDir = path.join(process.cwd(), 'newo_customers', customer.idn);
  const attributesFile = path.join(customerDir, 'projects', projectIdn, 'attributes.yaml');
  const attributesMapFile = path.join(customerDir, '.newo', customer.idn, `project_${projectIdn}_attributes-map.json`);

  // Check if attributes file exists
  if (!await fs.pathExists(attributesFile)) {
    if (verbose) console.log(`   ℹ No project attributes file for ${projectIdn}`);
    return 0;
  }

  // Load local attributes
  // Read as text and replace the custom !enum tags before parsing
  let attributesContent = await fs.readFile(attributesFile, 'utf-8');
  // Replace custom enum tags with the actual value
  attributesContent = attributesContent.replace(/!enum "AttributeValueTypes\.(\w+)"/g, '$1');

  const localData = yaml.load(attributesContent) as { attributes: any[] };
  const localAttributes = localData.attributes || [];

  // Load ID mapping
  if (!await fs.pathExists(attributesMapFile)) {
    if (verbose) console.log(`   ⚠ No ID mapping found for project ${projectIdn}, skipping push`);
    return 0;
  }

  const idMapping = JSON.parse(await fs.readFile(attributesMapFile, 'utf-8')) as Record<string, string>;

  // Fetch current remote attributes for comparison
  const remoteResponse = await getProjectAttributes(client, projectId, true);
  const remoteAttributes = remoteResponse.attributes || [];

  // Create map of remote attributes by IDN
  const remoteMap = new Map<string, any>();
  remoteAttributes.forEach(attr => remoteMap.set(attr.idn, attr));

  let updatedCount = 0;

  // Check each local attribute for changes
  for (const localAttr of localAttributes) {
    const attributeId = idMapping[localAttr.idn];
    if (!attributeId) {
      if (verbose) console.log(`   ⚠ No ID mapping for attribute ${localAttr.idn}, skipping`);
      continue;
    }

    const remoteAttr = remoteMap.get(localAttr.idn);
    if (!remoteAttr) {
      if (verbose) console.log(`   ⚠ Attribute ${localAttr.idn} not found remotely, skipping`);
      continue;
    }

    // Value type is already parsed (we removed !enum tags above)
    const valueType = localAttr.value_type;

    // Check if value changed
    const localValue = String(localAttr.value || '');
    const remoteValue = String(remoteAttr.value || '');

    if (localValue !== remoteValue) {
      if (verbose) console.log(`   🔄 Updating project attribute: ${localAttr.idn}`);

      try {
        const attributeToUpdate = {
          id: attributeId,
          idn: localAttr.idn,
          value: localAttr.value,
          title: localAttr.title,
          description: localAttr.description,
          group: localAttr.group,
          is_hidden: localAttr.is_hidden,
          possible_values: localAttr.possible_values,
          value_type: valueType
        };

        await updateProjectAttribute(client, projectId, attributeToUpdate);
        if (verbose) console.log(`   ✅ Updated: ${localAttr.idn} (${localAttr.title})`);
        updatedCount++;
      } catch (error: any) {
        const errorDetail = error.response?.data || error.message;
        console.error(`   ❌ Failed to update ${localAttr.idn}: ${JSON.stringify(errorDetail)}`);
        if (verbose) {
          console.error(`      API response:`, error.response?.status, error.response?.statusText);
          console.error(`      Endpoint tried: PUT /api/v1/project/attributes/${attributeId}`);
        }
      }
    } else if (verbose) {
      console.log(`   ✓ No changes: ${localAttr.idn}`);
    }
  }

  return updatedCount;
}

/**
 * Push all modified project attributes for all projects
 */
export async function pushAllProjectAttributes(
  client: AxiosInstance,
  customer: CustomerConfig,
  projectsMap: Record<string, { projectId: string; projectIdn: string }>,
  verbose: boolean = false
): Promise<number> {
  if (verbose) console.log(`\n📋 Checking project attributes for changes...`);

  let totalUpdated = 0;

  for (const [projectIdn, projectInfo] of Object.entries(projectsMap)) {
    if (!projectIdn) continue; // Skip empty project idn (legacy format)

    if (verbose) console.log(`\n  📁 Project: ${projectIdn}`);

    const updated = await pushProjectAttributes(
      client,
      customer,
      projectInfo.projectId,
      projectInfo.projectIdn || projectIdn,
      verbose
    );

    totalUpdated += updated;
  }

  // Always show summary if changes were made
  if (totalUpdated > 0) {
    console.log(`\n✅ Updated ${totalUpdated} project attribute(s)`);
  } else {
    if (verbose) console.log(`\n✓ No project attribute changes to push`);
  }

  return totalUpdated;
}