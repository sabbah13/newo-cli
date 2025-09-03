#!/usr/bin/env node
/**
 * NEWO CLI - Refactored Version
 * Enhanced with improved command organization, validation, and error handling
 */
import minimist from 'minimist';
import path from 'path';
import fs from 'fs-extra';

// Infrastructure imports
import { config, getDirectories, validateAuthConfig } from './src/config.js';
import {
  APP_NAME,
  APP_VERSION,
  APP_DESCRIPTION,
  COMMANDS as CMD_CONSTANTS,
  VALID_COMMANDS,
  HELP_FLAGS,
  DEFAULTS,
  HELP_TEXT,
  LOG_MESSAGES,
  INDICATORS,
  VALIDATION_PATTERNS,
  SECURITY_LIMITS
} from './src/constants.js';
import {
  NewoError,
  AuthenticationError,
  ValidationError,
  ConfigurationError,
  ErrorHandler
} from './src/errors.js';
import { logger, ProgressLogger } from './src/logger.js';
import { PerformanceMonitor } from './src/performance.js';
import { Validator } from './src/validation.js';

// Application imports
import { makeClient, getProjectMeta, importAkbArticle } from './api-refactored.js';
import { pullAll, pushChanged, status } from './src/sync.js';
import { parseAkbFile, prepareArticlesForImport } from './src/akb.js';

// CLI Configuration using infrastructure constants
const CLI_CONFIG = {
  name: APP_NAME,
  version: APP_VERSION,
  description: APP_DESCRIPTION,
  author: 'NEWO Team',
  defaultTimeout: DEFAULTS.TIMEOUT,
};

// Environment configuration from infrastructure config
const ENV = config;

// Initialize infrastructure services
const performanceMonitor = new PerformanceMonitor();
const validator = new Validator();
const cliLogger = logger.child({ component: 'CLI' });

// Command definitions with metadata using infrastructure constants
const COMMANDS = {
  [CMD_CONSTANTS.PULL]: {
    description: 'Download projects from NEWO to local files',
    usage: 'newo pull [options]',
    examples: [
      'newo pull                    # pull all accessible projects',
      'newo pull --verbose          # pull with detailed logging',
      'NEWO_PROJECT_ID=abc newo pull # pull specific project only'
    ],
    options: {
      '--verbose, -v': 'Enable detailed logging',
      '--project-id': 'Override NEWO_PROJECT_ID for this command',
      '--force': 'Force overwrite of local files',
    },
    requiresAuth: true,
  },
  [CMD_CONSTANTS.PUSH]: {
    description: 'Upload modified local files to NEWO',
    usage: 'newo push [options]',
    examples: [
      'newo push                    # push all modified files',
      'newo push --verbose          # push with detailed logging',
      'newo push --dry-run          # show what would be pushed without pushing',
    ],
    options: {
      '--verbose, -v': 'Enable detailed logging',
      '--dry-run': 'Show what would be pushed without making changes',
      '--force': 'Push even if there are conflicts',
    },
    requiresAuth: true,
  },
  [CMD_CONSTANTS.STATUS]: {
    description: 'Show status of local files vs NEWO',
    usage: 'newo status [options]',
    examples: [
      'newo status                  # show all file statuses',
      'newo status --verbose        # show detailed status information',
    ],
    options: {
      '--verbose, -v': 'Enable detailed logging',
      '--json': 'Output status in JSON format',
    },
    requiresAuth: false,
  },
  [CMD_CONSTANTS.META]: {
    description: 'Get project metadata (debug command)',
    usage: 'newo meta [project-id] [options]',
    examples: [
      'newo meta                    # get metadata for NEWO_PROJECT_ID',
      'newo meta abc-123            # get metadata for specific project',
    ],
    options: {
      '--verbose, -v': 'Enable detailed logging',
      '--json': 'Output metadata in JSON format',
    },
    requiresAuth: true,
  },
  [CMD_CONSTANTS.IMPORT_AKB]: {
    description: 'Import AKB articles from structured text file',
    usage: 'newo import-akb <file> <persona_id> [options]',
    examples: [
      'newo import-akb akb.txt persona-123  # import articles to persona',
      'newo import-akb data.txt abc --verbose # import with detailed logging',
    ],
    options: {
      '--verbose, -v': 'Enable detailed logging',
      '--dry-run': 'Parse and validate without importing',
      '--batch-size': 'Number of articles to import in parallel (default: 5)',
    },
    requiresAuth: true,
  },
  version: {
    description: 'Show version information',
    usage: 'newo version',
    examples: ['newo version'],
    options: {},
    requiresAuth: false,
  },
  [CMD_CONSTANTS.HELP]: {
    description: 'Show help information',
    usage: 'newo help [command]',
    examples: [
      'newo help                    # show general help',
      'newo help pull               # show help for pull command',
    ],
    options: {},
    requiresAuth: false,
  },
};

// Global CLI options
const GLOBAL_OPTIONS = {
  '--help, -h': 'Show help information',
  '--version': 'Show version information',
  '--verbose, -v': 'Enable detailed logging',
  '--quiet, -q': 'Suppress non-error output',
  '--no-color': 'Disable colored output',
  '--timeout': 'Set timeout in milliseconds (default: 60000)',
};

/**
 * Enhanced CLI error handling using infrastructure errors
 */
class CLIError extends NewoError {
  constructor(message, code = 1, suggestions = []) {
    super(message, 'CLI_ERROR', null, { suggestions });
    this.code = code;
    this.suggestions = suggestions;
  }

  getUserMessage() {
    return this.message;
  }
}

/**
 * CLI Command Handler with validation and error handling
 */
class CLIHandler {
  constructor(args, options = {}) {
    this.args = args;
    this.options = { ...CLI_CONFIG, ...options };
    this.verbose = args.verbose || args.v || false;
    this.quiet = args.quiet || args.q || false;
    this.noColor = args['no-color'] || false;
    this.timeout = this._validateTimeout(args.timeout) || CLI_CONFIG.defaultTimeout;
    
    // Initialize logger with context
    this.logger = cliLogger.child({
      verbose: this.verbose,
      quiet: this.quiet,
      command: args._[0] || 'unknown'
    });
    
    // Initialize performance monitoring
    this.performanceMonitor = performanceMonitor;
    this.operationTimer = null;
  }
  
  /**
   * Validate timeout parameter
   */
  _validateTimeout(timeout) {
    if (!timeout) return null;
    
    const timeoutNum = parseInt(timeout);
    if (isNaN(timeoutNum) || timeoutNum < 1000 || timeoutNum > 600000) {
      throw new ValidationError(
        'Timeout must be between 1000ms and 600000ms (10 minutes)',
        'timeout',
        timeout
      );
    }
    
    return timeoutNum;
  }

  /**
   * Main command dispatcher with performance monitoring
   */
  async execute() {
    const command = this.args._[0];
    this.operationTimer = this.performanceMonitor.startTimer(`cli_command_${command || 'unknown'}`);
    
    try {
      await this.logger.info(LOG_MESSAGES.STARTING_OPERATION, {
        command: command || 'help',
        args: this.args,
        verbose: this.verbose
      });

      // Handle special cases
      if (this.args.version) {
        return this.handleVersion();
      }

      if (!command || HELP_FLAGS.includes(command) || this.args.help || this.args.h) {
        return this.handleHelp(this.args._[1]);
      }

      // Validate command exists
      // TODO: Implement validateCommand in validation module
      const validCommands = ['pull', 'push', 'status', 'meta', 'import-akb', 'help'];
      if (!validCommands.includes(command)) {
        const suggestions = this._getSimilarCommands(command);
        throw new CLIError(
          `Unknown command: ${command}`,
          1,
          ['Run "newo help" to see available commands', ...suggestions]
        );
      }

      // Validate environment and authentication
      await this.validateEnvironment(command);

      // Execute command with error handling
      const result = await this._executeCommand(command);
      
      await this.logger.info(LOG_MESSAGES.OPERATION_COMPLETE, {
        command,
        duration: this.operationTimer ? this.operationTimer.getDuration() : 0
      });
      
      return result;
      
    } catch (error) {
      await this.logger.error(LOG_MESSAGES.OPERATION_FAILED, {
        command: command || 'unknown',
        error: error.message,
        stack: error.stack
      });
      throw error;
    } finally {
      if (this.operationTimer) {
        this.operationTimer.end();
      }
    }
  }
  
  /**
   * Execute specific command with routing
   */
  async _executeCommand(command) {
    switch (command) {
      case CMD_CONSTANTS.PULL:
        return this.handlePull();
      case CMD_CONSTANTS.PUSH:
        return this.handlePush();
      case CMD_CONSTANTS.STATUS:
        return this.handleStatus();
      case CMD_CONSTANTS.META:
        return this.handleMeta();
      case CMD_CONSTANTS.IMPORT_AKB:
        return this.handleImportAkb();
      case 'version':
        return this.handleVersion();
      default:
        throw new CLIError(`Command not implemented: ${command}`);
    }
  }
  
  /**
   * Get similar commands for suggestions
   */
  _getSimilarCommands(command) {
    const commands = Object.keys(COMMANDS);
    const similar = commands.filter(cmd => {
      return cmd.includes(command) || command.includes(cmd) || 
             this._levenshteinDistance(cmd, command) <= 2;
    });
    
    if (similar.length > 0) {
      return [`Did you mean one of: ${similar.join(', ')}?`];
    }
    
    return [`Available commands: ${commands.join(', ')}`];
  }
  
  /**
   * Calculate Levenshtein distance for command suggestions
   */
  _levenshteinDistance(str1, str2) {
    const matrix = [];
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    return matrix[str2.length][str1.length];
  }

  /**
   * Validate environment and authentication requirements with infrastructure validation
   */
  async validateEnvironment(command) {
    this.performanceMonitor.startTimer('cli_validate_environment');
    
    try {
      const commandConfig = COMMANDS[command];
      
      await this.logger.debug('Validating environment', {
        command,
        requiresAuth: commandConfig.requiresAuth
      });

      // Check if command requires authentication
      if (commandConfig.requiresAuth) {
        try {
          validateAuthConfig(ENV);
        } catch (error) {
          throw new CLIError(
            'Authentication required but no valid credentials found',
            1,
            [
              'Set NEWO_API_KEY in your .env file',
              'Or set NEWO_ACCESS_TOKEN and NEWO_REFRESH_TOKEN',
              'Run "newo help" for setup instructions'
            ]
          );
        }
      }

      // Validate base URL format
      if (ENV.NEWO_BASE_URL) {
        try {
          new URL(ENV.NEWO_BASE_URL);
        } catch (error) {
          throw new ValidationError('Invalid NEWO_BASE_URL format', 'base_url', ENV.NEWO_BASE_URL);
        }
      } else {
        await this.logger.info('Using default NEWO base URL: https://app.newo.ai');
      }

      // Command-specific validations
      await this._validateCommandSpecificRequirements(command);
      
    } finally {
      this.performanceMonitor.endTimer('cli_validate_environment');
    }
  }
  
  /**
   * Validate command-specific requirements
   */
  async _validateCommandSpecificRequirements(command) {
    if (command === CMD_CONSTANTS.META) {
      const projectId = this.args._[1] || ENV.NEWO_PROJECT_ID;
      
      if (!projectId) {
        throw new CLIError(
          'Project ID required for meta command',
          1,
          [
            'Set NEWO_PROJECT_ID in your .env file',
            'Or provide project ID as argument: newo meta <project-id>'
          ]
        );
      }
      
      // Validate project ID format
      if (!VALIDATION_PATTERNS.UUID.test(projectId)) {
        throw new ValidationError('Invalid project ID format (must be UUID)', 'project_id', projectId);
      }
    }

    if (command === CMD_CONSTANTS.IMPORT_AKB) {
      const akbFile = this.args._[1];
      const personaId = this.args._[2];

      if (!akbFile || !personaId) {
        throw new CLIError(
          'AKB import requires file path and persona ID',
          1,
          [
            'Usage: newo import-akb <file> <persona_id>',
            'Example: newo import-akb akb.txt da4550db-2b95-4500-91ff-fb4b60fe7be9'
          ]
        );
      }
      
      // Validate persona ID format
      if (!VALIDATION_PATTERNS.UUID.test(personaId)) {
        throw new ValidationError('Invalid persona ID format (must be UUID)', 'persona_id', personaId);
      }
      
      // Validate file path length and characters
      if (akbFile.length > SECURITY_LIMITS.MAX_PATH_LENGTH) {
        throw new ValidationError('File path too long', 'file_path', akbFile);
      }

      const filePath = path.resolve(akbFile);
      if (!await fs.pathExists(filePath)) {
        throw new CLIError(
          `AKB file not found: ${filePath}`,
          1,
          ['Check the file path and try again']
        );
      }
      
      // Check file size
      const stats = await fs.stat(filePath);
      const maxSizeMB = 10; // 10MB limit
      if (stats.size > maxSizeMB * 1024 * 1024) {
        throw new ValidationError(
          `File too large (max ${maxSizeMB}MB)`,
          'file_size',
          `${Math.round(stats.size / 1024 / 1024)}MB`
        );
      }
    }
  }

  /**
   * Create API client with timeout and error handling using infrastructure
   */
  async createClient() {
    this.performanceMonitor.startTimer('cli_create_client');
    
    try {
      await this.logger.debug('Creating API client', {
        timeout: this.timeout,
        verbose: this.verbose
      });
      
      const client = await makeClient(this.verbose);
      
      // Set custom timeout if specified
      if (this.timeout !== CLI_CONFIG.defaultTimeout) {
        client.defaults.timeout = this.timeout;
        await this.logger.debug('Custom timeout applied', { timeout: this.timeout });
      }

      await this.logger.info('API client created successfully');
      return client;
      
    } catch (error) {
      const handledError = await ErrorHandler.handle(error, this.logger, {
        operation: 'create_api_client',
        timeout: this.timeout
      });
      
      if (error instanceof AuthenticationError) {
        throw new CLIError(
          'Authentication failed',
          1,
          [
            'Check your NEWO_API_KEY in .env file',
            'Ensure your API key has the necessary permissions',
            'Try running "newo help" for setup instructions'
          ]
        );
      }
      
      throw new CLIError(`Failed to initialize API client: ${handledError.getUserMessage()}`);
    } finally {
      this.performanceMonitor.endTimer('cli_create_client');
    }
  }

  /**
   * Handle pull command with enhanced monitoring
   */
  async handlePull() {
    this.performanceMonitor.startTimer('cli_pull_command');
    
    try {
      const client = await this.createClient();
      const projectId = this.args['project-id'] || ENV.NEWO_PROJECT_ID || null;
      const force = this.args.force || false;

      // Validate project ID if provided
      if (projectId && !VALIDATION_PATTERNS.UUID.test(projectId)) {
        throw new ValidationError('Invalid project ID format (must be UUID)', 'project_id', projectId);
      }

      const pullType = projectId ? 'Single-project' : 'Multi-project';
      await this.logger.info(`${pullType} pull starting`, {
        projectId: projectId || 'all_accessible',
        force
      });
      
      this.log(`${INDICATORS.DOWNLOAD} ${pullType} pull starting...`);
      
      await pullAll(client, projectId, this.verbose);
      
      const pullMetrics = this.performanceMonitor.endTimer('cli_pull_command');
      await this.logger.info('Pull completed successfully', {
        projectId: projectId || 'all_accessible',
        duration: pullMetrics ? pullMetrics.duration : 0
      });
      
      this.success(`Pull completed successfully`);
      
    } catch (error) {
      await this.logger.error('Pull operation failed', {
        error: error.message,
        projectId: this.args['project-id'] || ENV.NEWO_PROJECT_ID,
        stack: error.stack
      });
      
      throw new CLIError(
        `Pull failed: ${error.getUserMessage ? error.getUserMessage() : error.message}`,
        1,
        ['Check your network connection and API credentials', 'Try running with --verbose for more details']
      );
    }
  }

  /**
   * Handle push command with enhanced monitoring
   */
  async handlePush() {
    this.performanceMonitor.startTimer('cli_push_command');
    
    try {
      const client = await this.createClient();
      const dryRun = this.args['dry-run'] || false;
      const force = this.args.force || false;

      await this.logger.info('Push operation starting', {
        dryRun,
        force
      });
      
      this.log(`${INDICATORS.UPLOAD} Push starting${dryRun ? ' (dry run)' : ''}...`);
      
      if (dryRun) {
        // Show what would be pushed without actually pushing
        await this.logger.info('Dry run mode: showing status instead of pushing');
        await status(this.verbose);
      } else {
        await pushChanged(client, this.verbose);
        
        const pushMetrics = this.performanceMonitor.endTimer('cli_push_command');
        await this.logger.info('Push completed successfully', {
          duration: pushMetrics ? pushMetrics.duration : 0
        });
        
        this.success('Push completed successfully');
      }
      
    } catch (error) {
      await this.logger.error('Push operation failed', {
        error: error.message,
        dryRun: this.args['dry-run'] || false,
        stack: error.stack
      });
      
      throw new CLIError(
        `Push failed: ${error.getUserMessage ? error.getUserMessage() : error.message}`,
        1,
        ['Check your network connection and API credentials', 'Try running with --verbose for more details']
      );
    }
  }

  /**
   * Handle status command with enhanced monitoring
   */
  async handleStatus() {
    this.performanceMonitor.startTimer('cli_status_command');
    
    try {
      const jsonOutput = this.args.json || false;
      
      await this.logger.info('Status check starting', {
        jsonOutput
      });
      
      this.log(`${INDICATORS.INFO} Checking file status...`);
      
      const statusResult = await status(this.verbose);
      
      if (jsonOutput && typeof statusResult === 'object') {
        console.log(JSON.stringify(statusResult, null, 2));
        await this.logger.debug('Status output in JSON format', {
          fileCount: Object.keys(statusResult).length
        });
      }
      
      const statusMetrics = this.performanceMonitor.endTimer('cli_status_command');
      await this.logger.info('Status check completed', {
        duration: statusMetrics ? statusMetrics.duration : 0
      });
      
    } catch (error) {
      await this.logger.error('Status check failed', {
        error: error.message,
        jsonOutput: this.args.json || false,
        stack: error.stack
      });
      
      throw new CLIError(
        `Status check failed: ${error.getUserMessage ? error.getUserMessage() : error.message}`,
        1,
        ['Ensure you have run "newo pull" first', 'Check that .newo directory exists']
      );
    }
  }

  /**
   * Handle meta command with enhanced validation and monitoring
   */
  async handleMeta() {
    this.performanceMonitor.startTimer('cli_meta_command');
    
    try {
      const client = await this.createClient();
      const projectId = this.args._[1] || ENV.NEWO_PROJECT_ID;
      const jsonOutput = this.args.json || false;

      if (!projectId) {
        throw new CLIError('Project ID is required for meta command');
      }
      
      // Validate project ID format
      if (!VALIDATION_PATTERNS.UUID.test(projectId)) {
        throw new ValidationError('Invalid project ID format (must be UUID)', 'project_id', projectId);
      }

      await this.logger.info('Getting project metadata', {
        projectId,
        jsonOutput
      });
      
      this.log(`${INDICATORS.INFO} Getting project metadata for ${projectId}...`);
      
      const meta = await getProjectMeta(client, projectId);
      
      if (jsonOutput) {
        console.log(JSON.stringify(meta, null, 2));
      } else {
        this.log('Project Metadata:');
        console.log(JSON.stringify(meta, null, 2));
      }
      
      const metaMetrics = this.performanceMonitor.endTimer('cli_meta_command');
      await this.logger.info('Project metadata retrieved successfully', {
        projectId,
        metadataKeys: Object.keys(meta || {}),
        duration: metaMetrics ? metaMetrics.duration : 0
      });
      
    } catch (error) {
      await this.logger.error('Failed to get project metadata', {
        projectId: this.args._[1] || ENV.NEWO_PROJECT_ID,
        error: error.message,
        stack: error.stack
      });
      
      throw new CLIError(
        `Failed to get project metadata: ${error.getUserMessage ? error.getUserMessage() : error.message}`,
        1,
        ['Check that the project ID is correct', 'Ensure you have access to this project']
      );
    }
  }

  /**
   * Handle AKB import command with enhanced validation and monitoring
   */
  async handleImportAkb() {
    this.performanceMonitor.startTimer('cli_import_akb_command');
    
    try {
      const client = await this.createClient();
      const akbFile = this.args._[1];
      const personaId = this.args._[2];
      const dryRun = this.args['dry-run'] || false;
      const batchSize = this._validateBatchSize(this.args['batch-size']) || 5;
      
      const filePath = path.resolve(akbFile);

      await this.logger.info('AKB import starting', {
        file: filePath,
        personaId,
        dryRun,
        batchSize
      });

      this.log(`${INDICATORS.FILE} Parsing AKB file: ${filePath}`);
      const articles = parseAkbFile(filePath);
      
      // Validate articles
      if (!articles || articles.length === 0) {
        throw new ValidationError('No articles found in file', 'articles', articles);
      }
      
      if (articles.length > 1000) {
        this.warn(`Large number of articles (${articles.length}). Consider breaking into smaller files.`);
      }
      
      this.success(`Parsed ${articles.length} articles from ${akbFile}`);

      this.log(`${INDICATORS.LOADING} Preparing articles for persona: ${personaId}`);
      const preparedArticles = prepareArticlesForImport(articles, personaId);

      if (dryRun) {
        await this.logger.info('Dry run mode - showing articles that would be imported', {
          articleCount: preparedArticles.length
        });
        
        this.log('Dry run mode - articles would be imported:');
        preparedArticles.forEach((article, index) => {
          console.log(`  ${index + 1}. ${article.topic_name} (${article.source})`);
        });
        return;
      }

      let successCount = 0;
      let errorCount = 0;
      const errors = [];
      
      // Create progress logger for batch processing
      const progressLogger = this.createProgressLogger(preparedArticles.length, 'Importing articles');

      this.log(`${INDICATORS.UPLOAD} Importing ${preparedArticles.length} articles...`);

      // Process articles in batches to avoid overwhelming the API
      for (let i = 0; i < preparedArticles.length; i += batchSize) {
        const batch = preparedArticles.slice(i, i + batchSize);
        
        const batchResults = await Promise.allSettled(
          batch.map(async (article, batchIndex) => {
            const articleIndex = i + batchIndex;
            
            try {
              // Validate article before import
              // TODO: Implement validateAkbArticle in validation module
              if (!article.topic_name || !article.source) {
                throw new ValidationError(
                  `Invalid article: missing required fields`,
                  'article',
                  article.topic_name
                );
              }
              
              if (this.verbose) {
                this.log(`  [${articleIndex + 1}/${preparedArticles.length}] Importing ${article.topic_name}...`);
              }
              
              await importAkbArticle(client, article);
              successCount++;
              
              if (!this.verbose && !this.quiet) {
                process.stdout.write('.');
              }
              
              return { success: true, article: article.topic_name };
              
            } catch (error) {
              errorCount++;
              const errorMsg = error?.response?.data?.message || error.message;
              errors.push(`${article.topic_name}: ${errorMsg}`);
              
              if (this.verbose) {
                console.error(`\n${INDICATORS.ERROR} Failed to import ${article.topic_name}: ${errorMsg}`);
              }
              
              await this.logger.error('Article import failed', {
                article: article.topic_name,
                error: errorMsg,
                articleIndex: articleIndex + 1
              });
              
              return { success: false, article: article.topic_name, error: errorMsg };
            }
          })
        );
        
        // Update progress
        await progressLogger.update(batch.length);

        // Small delay between batches to be respectful to the API
        if (i + batchSize < preparedArticles.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      if (!this.verbose && !this.quiet) {
        console.log(''); // New line after dots
      }
      
      await progressLogger.complete();

      const resultMessage = `Import complete: ${successCount} successful, ${errorCount} failed`;
      this.success(resultMessage);
      
      const importMetrics = this.performanceMonitor.endTimer('cli_import_akb_command');
      await this.logger.info('AKB import completed', {
        successCount,
        errorCount,
        totalArticles: preparedArticles.length,
        duration: importMetrics ? importMetrics.duration : 0,
        errors: errors.slice(0, 10) // Log first 10 errors
      });

      if (errors.length > 0 && this.verbose) {
        console.log('\nErrors encountered:');
        errors.forEach(error => console.log(`  - ${error}`));
      }

    } catch (error) {
      await this.logger.error('AKB import failed', {
        file: this.args._[1],
        personaId: this.args._[2],
        error: error.message,
        stack: error.stack
      });
      
      throw new CLIError(
        `AKB import failed: ${error.getUserMessage ? error.getUserMessage() : error.message}`,
        1,
        ['Check the file format and try again', 'Ensure the persona ID is valid']
      );
    }
  }
  
  /**
   * Validate batch size parameter
   */
  _validateBatchSize(batchSizeArg) {
    if (!batchSizeArg) return null;
    
    const batchSize = parseInt(batchSizeArg);
    if (isNaN(batchSize) || batchSize < 1 || batchSize > 50) {
      throw new ValidationError(
        'Batch size must be between 1 and 50',
        'batch_size',
        batchSizeArg
      );
    }
    
    return batchSize;
  }

  /**
   * Handle version command with enhanced environment info
   */
  handleVersion() {
    console.log(`${CLI_CONFIG.name} v${CLI_CONFIG.version}`);
    console.log(`${CLI_CONFIG.description}`);
    console.log(`\nEnvironment:`);
    console.log(`  Node.js: ${process.version}`);
    console.log(`  Platform: ${process.platform} ${process.arch}`);
    console.log(`  Base URL: ${ENV.NEWO_BASE_URL || 'https://app.newo.ai (default)'}`);
    console.log(`  Has API Key: ${ENV.NEWO_API_KEY ? 'Yes' : 'No'}`);
    console.log(`  Has Project ID: ${ENV.NEWO_PROJECT_ID ? 'Yes' : 'No'}`);
    console.log(`  Configuration Valid: ${this._checkConfigStatus()}`);
    
    // Log version access for analytics
    this.logger.info('Version displayed', {
      version: CLI_CONFIG.version,
      nodeVersion: process.version,
      platform: process.platform
    });
  }
  
  /**
   * Check configuration status
   */
  _checkConfigStatus() {
    try {
      validateAuthConfig(ENV);
      return 'Yes';
    } catch (error) {
      return `No (${error.message})`;
    }
  }

  /**
   * Handle help command
   */
  handleHelp(specificCommand) {
    if (specificCommand && COMMANDS[specificCommand]) {
      this.showCommandHelp(specificCommand);
    } else {
      this.showGeneralHelp();
    }
  }

  /**
   * Show help for specific command with enhanced formatting
   */
  showCommandHelp(command) {
    const cmd = COMMANDS[command];
    console.log(`${CLI_CONFIG.name} - ${command} command\n`);
    console.log(`Description: ${cmd.description}\n`);
    console.log(`Usage: ${cmd.usage}\n`);
    
    if (Object.keys(cmd.options).length > 0) {
      console.log('Options:');
      Object.entries(cmd.options).forEach(([flag, desc]) => {
        console.log(`  ${flag.padEnd(20)} ${desc}`);
      });
      console.log('');
    }

    if (cmd.examples.length > 0) {
      console.log('Examples:');
      cmd.examples.forEach(example => {
        console.log(`  ${example}`);
      });
      console.log('');
    }

    console.log('Global Options:');
    Object.entries(GLOBAL_OPTIONS).forEach(([flag, desc]) => {
      console.log(`  ${flag.padEnd(20)} ${desc}`);
    });
    
    // Log command-specific help access for analytics
    this.logger.info('Command help displayed', {
      command,
      requiresAuth: cmd.requiresAuth
    });
  }

  /**
   * Show general help using infrastructure constants
   */
  showGeneralHelp() {
    // Use infrastructure help text for consistency
    console.log(HELP_TEXT.USAGE);
    
    // Log help access for analytics
    this.logger.info('Help displayed', {
      type: 'general',
      version: CLI_CONFIG.version
    });
  }

  /**
   * Logging utilities with infrastructure logger integration
   */
  log(message) {
    if (!this.quiet) {
      console.log(message);
    }
    // Also log to infrastructure logger for file logging
    this.logger.info(message);
  }

  success(message) {
    if (!this.quiet) {
      console.log(`${INDICATORS.SUCCESS} ${message}`);
    }
    this.logger.info(`SUCCESS: ${message}`);
  }

  warn(message) {
    console.warn(`${INDICATORS.WARNING} ${message}`);
    this.logger.warn(message);
  }

  error(message) {
    console.error(`${INDICATORS.ERROR} ${message}`);
    this.logger.error(message);
  }
  
  /**
   * Progress logging for long operations
   */
  createProgressLogger(total, message) {
    return new ProgressLogger(this.logger, total, message);
  }
}

/**
 * Main CLI entry point with comprehensive error handling using infrastructure
 */
async function main() {
  performanceMonitor.startTimer('cli_main');
  
  try {
    // Parse arguments with validation
    const args = minimist(process.argv.slice(2));
    
    // Validate argument structure
    try {
      Validator.validateCliArgs(args);
    } catch (validationError) {
      throw new ValidationError(
        `Invalid command line arguments: ${validationError.message}`,
        'cli_args',
        args
      );
    }
    
    await cliLogger.info('CLI started', {
      args: args,
      nodeVersion: process.version,
      platform: process.platform
    });
    
    const handler = new CLIHandler(args);
    await handler.execute();
    
    await cliLogger.info('CLI completed successfully');
    process.exit(0);
    
  } catch (error) {
    await cliLogger.error('CLI failed with error', {
      error: error.message,
      stack: error.stack,
      type: error.constructor.name
    });
    
    if (error instanceof CLIError) {
      console.error(`${INDICATORS.ERROR} ${error.message}`);
      
      if (error.suggestions && error.suggestions.length > 0) {
        console.error('\nSuggestions:');
        error.suggestions.forEach(suggestion => {
          console.error(`  • ${suggestion}`);
        });
      }
      
      process.exit(error.code);
      
    } else if (error instanceof AuthenticationError) {
      console.error(`${INDICATORS.ERROR} Authentication failed`);
      console.error('Check your NEWO_API_KEY in .env file');
      process.exit(1);
      
    } else if (error instanceof ValidationError) {
      console.error(`${INDICATORS.ERROR} Validation Error: ${error.getUserMessage()}`);
      if (error.details.field) {
        console.error(`Field: ${error.details.field}`);
      }
      process.exit(1);
      
    } else if (error instanceof ConfigurationError) {
      console.error(`${INDICATORS.ERROR} Configuration Error: ${error.getUserMessage()}`);
      process.exit(1);
      
    } else {
      console.error(`${INDICATORS.ERROR} Unexpected error:`, error?.response?.data || error.message || error);
      console.error('\nFor help, run: newo help');
      process.exit(1);
    }
  } finally {
    performanceMonitor.endTimer('cli_main');
    
    // Flush logs before exit
    try {
      await cliLogger.flush();
    } catch (flushError) {
      console.error('Failed to flush logs:', flushError.message);
    }
  }
}

// Handle uncaught exceptions and rejections with infrastructure logging
process.on('uncaughtException', async (error) => {
  try {
    await cliLogger.error('Uncaught exception', {
      error: error.message,
      stack: error.stack
    });
    await cliLogger.flush();
  } catch (logError) {
    console.error('Failed to log uncaught exception:', logError.message);
  }
  
  console.error(`${INDICATORS.ERROR} Uncaught exception:`, error.message);
  process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  try {
    await cliLogger.error('Unhandled rejection', {
      reason: reason?.message || reason,
      promise: promise.toString()
    });
    await cliLogger.flush();
  } catch (logError) {
    console.error('Failed to log unhandled rejection:', logError.message);
  }
  
  console.error(`${INDICATORS.ERROR} Unhandled rejection:`, reason);
  process.exit(1);
});

// Handle process termination signals with graceful shutdown
process.on('SIGINT', async () => {
  try {
    await cliLogger.info('CLI interrupted by user (SIGINT)');
    await cliLogger.flush();
  } catch (logError) {
    console.error('Failed to log SIGINT:', logError.message);
  }
  
  console.log('\n👋 Goodbye!');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  try {
    await cliLogger.info('CLI terminated (SIGTERM)');
    await cliLogger.flush();
  } catch (logError) {
    console.error('Failed to log SIGTERM:', logError.message);
  }
  
  console.log('\n👋 Terminated');
  process.exit(0);
});

// Run CLI
main();