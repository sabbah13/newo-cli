/**
 * Customer attributes synchronization module
 */
import { getCustomerAttributes } from '../api.js';
import {
  writeFileSafe,
  customerAttributesPath,
  customerAttributesMapPath,
  customerAttributesBackupPath
} from '../fsutil.js';
import yaml from 'js-yaml';
import type { AxiosInstance } from 'axios';
import type { CustomerConfig } from '../types.js';

/**
 * Save customer attributes to YAML format
 */
export async function saveCustomerAttributes(
  client: AxiosInstance,
  customer: CustomerConfig,
  verbose: boolean = false
): Promise<void> {
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
  } catch (error) {
    console.error(`❌ Failed to save customer attributes for ${customer.idn}:`, error);
    throw error;
  }
}