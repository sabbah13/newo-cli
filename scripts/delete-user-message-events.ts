#!/usr/bin/env tsx
/**
 * Delete user_message events from all flows except comprehensive_weather
 */
import dotenv from 'dotenv';
import fs from 'fs-extra';
import path from 'path';
import yaml from 'js-yaml';
import { initializeEnvironment } from '../src/env.js';
import { getValidAccessToken } from '../src/auth.js';
import { makeClient, deleteFlowEvent } from '../src/api.js';
import type { CustomerConfig } from '../src/types.js';

// Initialize environment
dotenv.config();
initializeEnvironment();

interface FlowMetadata {
  id: string;
  idn: string;
  title: string;
  events: Array<{
    id: string;
    idn: string;
    description: string;
    skill_idn?: string;
  }>;
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
  console.log('🔍 Scanning for user_message events to delete...\n');

  // Find all flow metadata files except in comprehensive_weather
  const baseDir = '/Users/sabbah/Documents/VisualStudio/Projects/newo-cli/newo_customers/NEYFZjXP4S/projects';
  const allMetadataFiles = await findFlowMetadataFiles(baseDir);
  const metadataFiles = allMetadataFiles.filter(f => !f.includes('comprehensive_weather'));

  const eventsToDelete: Array<{ eventId: string; flowIdn: string; description: string }> = [];

  for (const filePath of metadataFiles) {
    // Skip comprehensive_weather project
    if (filePath.includes('comprehensive_weather')) {
      continue;
    }

    const content = await fs.readFile(filePath, 'utf8');
    const metadata = yaml.load(content) as FlowMetadata;

    if (metadata.events && Array.isArray(metadata.events)) {
      for (const event of metadata.events) {
        if (event.idn === 'user_message') {
          eventsToDelete.push({
            eventId: event.id,
            flowIdn: metadata.idn,
            description: event.description || 'No description'
          });
          console.log(`📋 Found: ${metadata.idn} → ${event.description} (${event.id})`);
        }
      }
    }
  }

  if (eventsToDelete.length === 0) {
    console.log('\n✅ No user_message events found to delete.');
    return;
  }

  console.log(`\n🗑️  Deleting ${eventsToDelete.length} user_message event(s)...\n`);

  // Get authenticated client
  const customerConfig: CustomerConfig = {
    idn: 'NEYFZjXP4S',
    name: 'NEWO Customer'
  };

  const accessToken = await getValidAccessToken(customerConfig);
  const client = await makeClient(false, accessToken);

  let successCount = 0;
  let failCount = 0;

  for (const event of eventsToDelete) {
    try {
      await deleteFlowEvent(client, event.eventId);
      console.log(`✅ Deleted: ${event.flowIdn} → ${event.description}`);
      successCount++;
    } catch (error: any) {
      console.error(`❌ Failed to delete event ${event.eventId}: ${error.message}`);
      failCount++;
    }
  }

  console.log(`\n📊 Summary: ${successCount} deleted, ${failCount} failed`);
}

main().catch(console.error);