/**
 * Create Customer Command Handler - Creates a new NEWO customer account
 *
 * This command creates an empty NEWO customer using the v3 API.
 * It requires the api_secret attribute from the source customer account.
 */
import { makeClient, createNewoCustomer, getCustomerAttributes } from '../../api.js';
import { getValidAccessToken } from '../../auth.js';
import { requireSingleCustomer } from '../customer-selection.js';
import type {
  MultiCustomerConfig,
  CliArgs,
  CreateNewoCustomerRequest,
  CustomerMember,
  CustomerProjectInput
} from '../../types.js';

export async function handleCreateCustomerCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean = false
): Promise<void> {
  try {
    const selectedCustomer = requireSingleCustomer(customerConfig, args.customer as string | undefined);

    // Parse arguments
    const organizationName = args._[1] as string;
    const email = args.email as string;
    const tenant = (args.tenant as string) || 'newo';
    const phone = (args.phone as string) || '';
    const comment = (args.comment as string) || '';
    const status = (args.status as string) || 'temporal';
    const projectIdn = args.project as string | undefined;
    const externalId = args['external-id'] as string | undefined;

    // Validate required parameters
    if (!organizationName) {
      console.error('Error: Organization name is required');
      console.error('Usage: newo create-customer <organization_name> --email <email> [options]');
      console.error('');
      console.error('Options:');
      console.error('  --email <email>         Owner email (required)');
      console.error('  --tenant <tenant>       Tenant name (default: newo)');
      console.error('  --phone <phone>         Contact phone number');
      console.error('  --comment <comment>     Comment or notes');
      console.error('  --status <status>       temporal or permanent (default: temporal)');
      console.error('  --project <idn>         Project IDN to install (e.g., naf)');
      console.error('  --external-id <id>      External customer ID for tracking');
      console.error('');
      console.error('Example:');
      console.error('  newo create-customer "Acme Corp" --email owner@acme.com --project naf');
      process.exit(1);
    }

    if (!email) {
      console.error('Error: Owner email is required (--email <email>)');
      process.exit(1);
    }

    if (verbose) {
      console.log(`📝 Creating new NEWO customer...`);
      console.log(`   Organization: ${organizationName}`);
      console.log(`   Owner Email: ${email}`);
      console.log(`   Tenant: ${tenant}`);
      console.log(`   Status: ${status}`);
      if (phone) console.log(`   Phone: ${phone}`);
      if (comment) console.log(`   Comment: ${comment}`);
      if (projectIdn) console.log(`   Project: ${projectIdn}`);
      if (externalId) console.log(`   External ID: ${externalId}`);
    }

    // Get access token and create client
    const accessToken = await getValidAccessToken(selectedCustomer);
    const client = await makeClient(verbose, accessToken);

    // Get api_secret from customer attributes
    console.log('🔑 Fetching API secret from customer attributes...');
    const attributesResponse = await getCustomerAttributes(client, true);
    const apiSecretAttr = attributesResponse.attributes.find(attr => attr.idn === 'api_secret');

    if (!apiSecretAttr || !apiSecretAttr.value) {
      console.error('Error: api_secret attribute not found in customer account');
      console.error('This command requires the api_secret attribute to create new customers.');
      process.exit(1);
    }

    const apiSecret = typeof apiSecretAttr.value === 'string' ? apiSecretAttr.value : String(apiSecretAttr.value);

    if (verbose) {
      console.log(`✅ API secret found (${apiSecret.substring(0, 6)}...)`);
    }

    // Build members array
    const members: CustomerMember[] = [
      {
        email: email,
        role: 'owner',
        tenants: [tenant]
      }
    ];

    // Build projects array if project specified
    const projects: CustomerProjectInput[] = [];
    if (projectIdn) {
      projects.push({
        idn: projectIdn
      });
    }

    // Build customer object - only include optional fields if they have values
    const customerData: CreateNewoCustomerRequest['customer'] = {
      organization_name: organizationName,
      tenant: tenant,
      members: members,
      contact_email: email,
      organization_type: 'customer',
      organization_status: status as 'temporal' | 'permanent',
      attributes: [
        {
          idn: 'empty',
          value: 'True'
        }
      ]
    };

    // Add optional fields only if they have values
    if (comment) {
      customerData.comment = comment;
    }
    if (phone) {
      customerData.contact_phone = phone;
    }
    if (externalId) {
      customerData.external_customer_id = externalId;
    }

    // Build customer creation request
    const createRequest: CreateNewoCustomerRequest = {
      secret: apiSecret,
      customer: customerData
    };

    // Add projects only if specified
    if (projects.length > 0) {
      createRequest.projects = projects;
    }

    if (verbose) {
      console.log('📤 Creating customer with request:');
      console.log(JSON.stringify(createRequest, null, 2));
    }

    // Create the customer
    console.log('🚀 Creating customer...');
    const response = await createNewoCustomer(client, createRequest);

    console.log('');
    console.log('✅ Customer created successfully!');
    console.log(`   Customer IDN: ${response.idn}`);
    console.log(`   Customer ID: ${response.id}`);
    console.log(`   Organization: ${organizationName}`);
    console.log(`   Owner: ${email}`);
    if (projectIdn) {
      console.log(`   Project: ${projectIdn}`);
    }
    console.log('');
    console.log('📝 Next steps:');
    console.log(`   1. Add the new customer to your .env file:`);
    console.log(`      NEWO_${response.idn}_API_KEY=<api_key>`);
    console.log(`   2. Or use the customer_intercom integration to manage the new customer`);

  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Failed to create customer:', errMessage);

    // Provide more detailed error info if available
    if (error && typeof error === 'object' && 'response' in error) {
      const axiosError = error as any;
      if (axiosError.response?.data) {
        console.error('   API Error:', JSON.stringify(axiosError.response.data, null, 2));
      }
    }
    process.exit(1);
  }
}
