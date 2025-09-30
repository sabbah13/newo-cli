#!/usr/bin/env tsx
/**
 * Delete all flows except those in comprehensive_weather project
 */
import dotenv from 'dotenv';
import fs from 'fs-extra';
import path from 'path';
import yaml from 'js-yaml';
import { initializeEnvironment } from '../src/env.js';
import { getValidAccessToken } from '../src/auth.js';
import { makeClient, deleteFlow } from '../src/api.js';
import type { CustomerConfig } from '../src/types.js';

// Initialize environment
dotenv.config();
initializeEnvironment();

interface FlowMetadata {
  id: string;
  idn: string;
  title: string;
}

async function findFlowMetadataFiles(baseDir: string): Promise<string[]> {
  const files: string[] = [];

  async function scan(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await scan(fullPath);
      } else if (entry.name === 'metadata.yaml' && fullPath.includes('Flow/')) {
        files.push(fullPath);
      }
    }
  }

  await scan(baseDir);
  return files;
}

async function main() {
  console.log('🔍 Scanning for flows to delete (except comprehensive_weather)...\n');

  // Find all flow metadata files except in comprehensive_weather
  const baseDir = '/Users/sabbah/Documents/VisualStudio/Projects/newo-cli/newo_customers/NEYFZjXP4S/projects';
  const allMetadataFiles = await findFlowMetadataFiles(baseDir);
  const metadataFiles = allMetadataFiles.filter(f => !f.includes('comprehensive_weather'));

  const flowsToDelete: Array<{ flowId: string; flowIdn: string; projectPath: string }> = [];

  for (const filePath of metadataFiles) {
    const content = await fs.readFile(filePath, 'utf8');
    const metadata = yaml.load(content) as FlowMetadata;

    if (metadata.id) {
      const projectPath = filePath.split('/projects/')[1];
      flowsToDelete.push({
        flowId: metadata.id,
        flowIdn: metadata.idn,
        projectPath
      });
      console.log(`📋 Found: ${metadata.idn} (${metadata.id}) - ${projectPath}`);
    }
  }

  if (flowsToDelete.length === 0) {
    console.log('\n✅ No flows found to delete.');
    return;
  }

  console.log(`\n🗑️  Deleting ${flowsToDelete.length} flow(s)...\n`);

  // Get authenticated client
  const customerConfig: CustomerConfig = {
    idn: 'NEYFZjXP4S',
    name: 'NEWO Customer'
  };

  const accessToken = await getValidAccessToken(customerConfig);
  const client = await makeClient(false, accessToken);

  let successCount = 0;
  let failCount = 0;

  for (const flow of flowsToDelete) {
    try {
      await deleteFlow(client, flow.flowId);
      console.log(`✅ Deleted: ${flow.flowIdn} (${flow.flowId})`);
      successCount++;
    } catch (error: any) {
      console.error(`❌ Failed to delete flow ${flow.flowIdn}: ${error.response?.data?.message || error.message}`);
      failCount++;
    }
  }

  console.log(`\n📊 Summary: ${successCount} deleted, ${failCount} failed`);
}

main().catch(console.error);