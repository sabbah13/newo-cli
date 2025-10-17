/**
 * Profile command handler
 * Displays customer profile information
 */
import { makeClient, getCustomerProfile } from '../../api.js';
import { getValidAccessToken } from '../../auth.js';
import { requireSingleCustomer } from '../customer-selection.js';
import type { MultiCustomerConfig, CliArgs } from '../../types.js';

export async function handleProfileCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean
): Promise<void> {
  const selectedCustomer = requireSingleCustomer(customerConfig, args.customer as string | undefined);

  const accessToken = await getValidAccessToken(selectedCustomer);
  const client = await makeClient(verbose, accessToken);

  console.log(`👤 Fetching customer profile for ${selectedCustomer.idn}...\n`);
  const profile = await getCustomerProfile(client);

  // Display formatted profile information
  console.log(`Organization: ${profile.organization_name || 'N/A'}`);
  console.log(`Customer IDN: ${profile.idn}`);
  console.log(`Email: ${profile.email || 'N/A'}`);
  console.log(`Status: ${profile.status || 'N/A'} ${profile.is_active ? '(active)' : '(inactive)'}`);

  if (profile.phone_number) {
    console.log(`Phone: ${profile.phone_number}`);
  }

  if (profile.website) {
    console.log(`Website: ${profile.website}`);
  }

  if (profile.referral_code) {
    console.log(`Referral Code: ${profile.referral_code}`);
  }

  // Platform links
  if (profile.platform_links) {
    console.log(`\nPlatform Links:`);
    if (profile.platform_links.portal) {
      console.log(`  Portal: ${profile.platform_links.portal}`);
    }
    if (profile.platform_links.builder) {
      console.log(`  Builder: ${profile.platform_links.builder}`);
    }
    if (profile.platform_links.creator) {
      console.log(`  Creator: ${profile.platform_links.creator}`);
    }
    if (profile.platform_links.chat_widget) {
      console.log(`  Chat Widget: ${profile.platform_links.chat_widget}`);
    }
  }

  // Show additional fields if verbose
  if (verbose) {
    console.log(`\nAdditional Information:`);
    console.log(`  Customer ID: ${profile.id}`);
    console.log(`  Tenant: ${profile.tenant || 'N/A'}`);
    console.log(`  Organization Type: ${profile.organization_type || 'N/A'}`);
    console.log(`  External Customer ID: ${profile.external_customer_id || 'N/A'}`);

    if (profile.industry && profile.industry.length > 0) {
      console.log(`  Industry: ${profile.industry.join(', ')}`);
    }

    if (profile.billing_email) {
      console.log(`  Billing Email: ${profile.billing_email}`);
    }

    console.log(`  BAA Signed: ${profile.is_baa_signed ? 'Yes' : 'No'}`);
    console.log(`  Marked for Deletion: ${profile.is_marked_for_deletion ? 'Yes' : 'No'}`);
  }

  console.log();
}
