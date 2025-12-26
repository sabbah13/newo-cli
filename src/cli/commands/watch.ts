/**
 * Watch command handler
 *
 * Watches for file changes and automatically pushes when changes are detected.
 * Supports selective resource watching with --only and --exclude flags.
 *
 * Usage:
 *   newo watch                     # Watch and push all changes
 *   newo watch --only projects     # Watch only project files
 *   newo watch --debounce 2000     # Custom debounce delay (ms)
 */
import { selectSingleCustomer } from '../customer-selection.js';
import { setupCli } from '../../cli-new/bootstrap.js';
import { PUSHABLE_RESOURCE_TYPES } from '../../cli-new/di/tokens.js';
import type { MultiCustomerConfig, CliArgs, CustomerConfig } from '../../types.js';
import chokidar from 'chokidar';
import path from 'path';

// Default debounce delay in milliseconds
const DEFAULT_DEBOUNCE_MS = 1000;

/**
 * Parse resource list from comma-separated string
 */
function parseResourceList(input: string | undefined): string[] {
  if (!input) return [];
  return input.split(',').map(r => r.trim().toLowerCase()).filter(Boolean);
}

/**
 * Get file patterns to watch based on resource types
 */
function getWatchPatterns(customerDir: string, resources: string[]): string[] {
  const patterns: string[] = [];

  for (const resource of resources) {
    switch (resource) {
      case 'projects':
        // Watch .guidance and .jinja files in projects
        patterns.push(path.join(customerDir, 'projects', '**', '*.guidance'));
        patterns.push(path.join(customerDir, 'projects', '**', '*.jinja'));
        patterns.push(path.join(customerDir, 'projects', '**', 'metadata.yaml'));
        break;
      case 'attributes':
        // Watch attributes.yaml files
        patterns.push(path.join(customerDir, 'attributes.yaml'));
        patterns.push(path.join(customerDir, 'projects', '*', 'attributes.yaml'));
        break;
      case 'integrations':
        // Watch integration files
        patterns.push(path.join(customerDir, 'integrations', '**', '*.yaml'));
        break;
      case 'akb':
        // Watch AKB files
        patterns.push(path.join(customerDir, 'akb', '**', '*.yaml'));
        break;
    }
  }

  return patterns;
}

/**
 * Push with V2 engine for selective resources
 */
async function pushWithV2Engine(
  customerConfig: MultiCustomerConfig,
  customer: CustomerConfig,
  resources: string[],
  verbose: boolean
): Promise<void> {
  const { syncEngine, logger } = setupCli(customerConfig, verbose);

  const result = await syncEngine.pushSelected(customer, resources);
  if (result.totalCreated > 0 || result.totalUpdated > 0 || result.totalDeleted > 0) {
    logger.info(`✅ Pushed: ${result.totalCreated} created, ${result.totalUpdated} updated, ${result.totalDeleted} deleted`);
  }
  if (result.errors.length > 0) {
    logger.warn(`⚠️  ${result.errors.length} error(s) occurred`);
    result.errors.forEach(e => logger.error(`   ${e}`));
  }
}

/**
 * Main watch command handler
 */
export async function handleWatchCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean
): Promise<void> {
  const { selectedCustomer } = selectSingleCustomer(
    customerConfig,
    args.customer as string | undefined
  );

  if (!selectedCustomer) {
    console.error('❌ Please specify a customer with --customer <idn> or set a default');
    process.exit(1);
  }

  // Parse options
  const onlyResources = parseResourceList(args.only as string | undefined);
  const excludeResources = parseResourceList(args.exclude as string | undefined);
  const debounceMs = typeof args.debounce === 'number'
    ? args.debounce
    : (typeof args.debounce === 'string' ? parseInt(args.debounce, 10) : DEFAULT_DEBOUNCE_MS);

  // Determine resources to watch
  let resourcesToWatch: string[];
  if (onlyResources.length > 0) {
    resourcesToWatch = onlyResources.filter(r => PUSHABLE_RESOURCE_TYPES.includes(r as typeof PUSHABLE_RESOURCE_TYPES[number]));
  } else if (excludeResources.length > 0) {
    resourcesToWatch = PUSHABLE_RESOURCE_TYPES.filter(r => !excludeResources.includes(r));
  } else {
    resourcesToWatch = [...PUSHABLE_RESOURCE_TYPES];
  }

  if (resourcesToWatch.length === 0) {
    console.error('❌ No valid resources to watch');
    console.error(`   Available: ${PUSHABLE_RESOURCE_TYPES.join(', ')}`);
    process.exit(1);
  }

  const customerDir = path.join(process.cwd(), 'newo_customers', selectedCustomer.idn);
  const watchPatterns = getWatchPatterns(customerDir, resourcesToWatch);

  console.log(`👀 Watching for changes in: ${resourcesToWatch.join(', ')}`);
  console.log(`📁 Customer: ${selectedCustomer.idn}`);
  console.log(`⏱️  Debounce: ${debounceMs}ms`);
  console.log('');
  console.log('Press Ctrl+C to stop watching.');
  console.log('');

  // Debounce state
  let debounceTimer: NodeJS.Timeout | null = null;
  let pendingChanges: Set<string> = new Set();
  let isPushing = false;

  // Push function with debouncing
  const debouncedPush = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(async () => {
      if (isPushing) {
        // If already pushing, wait and try again
        debouncedPush();
        return;
      }

      if (pendingChanges.size === 0) {
        return;
      }

      const changedFiles = Array.from(pendingChanges);
      pendingChanges.clear();

      isPushing = true;
      console.log(`\n🔄 Changes detected in ${changedFiles.length} file(s):`);
      changedFiles.slice(0, 5).forEach(f => console.log(`   ${path.relative(process.cwd(), f)}`));
      if (changedFiles.length > 5) {
        console.log(`   ... and ${changedFiles.length - 5} more`);
      }

      try {
        // Use V2 engine for selective push
        await pushWithV2Engine(customerConfig, selectedCustomer, resourcesToWatch, verbose);
        console.log('✅ Push completed');
      } catch (error) {
        console.error('❌ Push failed:', error instanceof Error ? error.message : String(error));
      } finally {
        isPushing = false;
      }
    }, debounceMs);
  };

  // Set up file watcher
  const watcher = chokidar.watch(watchPatterns, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100
    }
  });

  watcher
    .on('change', (filePath) => {
      pendingChanges.add(filePath);
      if (verbose) {
        console.log(`📝 Changed: ${path.relative(process.cwd(), filePath)}`);
      }
      debouncedPush();
    })
    .on('add', (filePath) => {
      pendingChanges.add(filePath);
      if (verbose) {
        console.log(`➕ Added: ${path.relative(process.cwd(), filePath)}`);
      }
      debouncedPush();
    })
    .on('unlink', (filePath) => {
      pendingChanges.add(filePath);
      if (verbose) {
        console.log(`➖ Removed: ${path.relative(process.cwd(), filePath)}`);
      }
      debouncedPush();
    })
    .on('error', (error) => {
      console.error('❌ Watcher error:', error);
    });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\n👋 Stopping watch...');
    watcher.close();
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    process.exit(0);
  });

  // Keep the process running
  await new Promise(() => {}); // Never resolves - keeps process alive
}
