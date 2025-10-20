/**
 * Migration verification command handler
 */
import { makeClient, listProjects, listAgents, listFlowSkills } from '../../api.js';
import { getValidAccessToken } from '../../auth.js';
import { getCustomer } from '../../customer.js';
import type { MultiCustomerConfig, CliArgs } from '../../types.js';

export async function handleVerifyMigrationCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean
): Promise<void> {
  const sourceIdn = args.source as string | undefined;
  const destIdn = args.dest as string | undefined;

  if (!sourceIdn || !destIdn) {
    console.error('❌ Usage: newo verify --source <sourceIdn> --dest <destIdn>');
    console.error('Example: newo verify --source NEWO_bb5lmJjg --dest NEq9OCwSXw');
    process.exit(1);
  }

  const sourceCustomer = getCustomer(customerConfig, sourceIdn);
  const destCustomer = getCustomer(customerConfig, destIdn);

  if (!sourceCustomer || !destCustomer) {
    console.error('❌ Customer not found in configuration');
    process.exit(1);
  }

  console.log('\n🔍 Migration Verification');
  console.log(`Source: ${sourceIdn}`);
  console.log(`Destination: ${destIdn}\n`);

  const sourceToken = await getValidAccessToken(sourceCustomer);
  const destToken = await getValidAccessToken(destCustomer);

  const sourceClient = await makeClient(verbose, sourceToken);
  const destClient = await makeClient(verbose, destToken);

  // Count entities
  const sourceProjects = await listProjects(sourceClient);
  const destProjects = await listProjects(destClient);

  let srcAgents = 0, srcFlows = 0, srcSkills = 0;
  let dstAgents = 0, dstFlows = 0, dstSkills = 0;

  for (const proj of sourceProjects) {
    const agents = await listAgents(sourceClient, proj.id);
    srcAgents += agents.length;

    for (const agent of agents) {
      srcFlows += (agent.flows || []).length;

      for (const flow of agent.flows || []) {
        const skills = await listFlowSkills(sourceClient, flow.id);
        srcSkills += skills.length;
      }
    }
  }

  for (const proj of destProjects.filter(p => p.idn !== 'test')) {
    const agents = await listAgents(destClient, proj.id);
    dstAgents += agents.length;

    for (const agent of agents) {
      dstFlows += (agent.flows || []).length;

      for (const flow of agent.flows || []) {
        const skills = await listFlowSkills(destClient, flow.id);
        dstSkills += skills.length;
      }
    }
  }

  console.log('📊 Entity Counts:\n');
  console.log(`Projects:  ${sourceProjects.length} → ${destProjects.filter(p => p.idn !== 'test').length} ${sourceProjects.length === destProjects.filter(p => p.idn !== 'test').length ? '✅' : '❌'}`);
  console.log(`Agents:    ${srcAgents} → ${dstAgents} ${srcAgents === dstAgents ? '✅' : '❌'}`);
  console.log(`Flows:     ${srcFlows} → ${dstFlows} ${srcFlows === dstFlows ? '✅' : '❌'}`);
  console.log(`Skills:    ${srcSkills} → ${dstSkills} ${srcSkills === dstSkills ? '✅' : '❌'}\n`);

  if (srcAgents === dstAgents && srcFlows === dstFlows && srcSkills === dstSkills) {
    console.log('✅ All entity counts match - Migration successful!\n');
  } else {
    console.log('⚠️  Entity counts differ - Migration may be incomplete\n');
    process.exit(1);
  }
}
