/**
 * Enhanced error handling utilities for NEWO CLI
 */
import { EnvValidationError } from '../env.js';

/**
 * Enhanced error logging for CLI
 */
export function logCliError(level: 'error' | 'warn' | 'info', message: string, meta?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    module: 'cli',
    message,
    ...meta
  };

  // Only log JSON format in verbose mode, otherwise use clean user messages
  const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');

  if (verbose) {
    if (level === 'error') {
      console.error(JSON.stringify(logEntry));
    } else if (level === 'warn') {
      console.warn(JSON.stringify(logEntry));
    } else {
      console.log(JSON.stringify(logEntry));
    }
  } else {
    // Clean user-facing messages
    if (level === 'error') {
      console.error(`❌ ${message}`);
    } else if (level === 'warn') {
      console.warn(`⚠️  ${message}`);
    } else {
      console.log(`ℹ️  ${message}`);
    }
  }
}

/**
 * Enhanced error handling with user-friendly messages
 */
export function handleCliError(error: unknown, operation: string = 'operation'): never {
  const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');

  if (error instanceof Error) {
    // Authentication errors
    if (error.message.includes('API key') || error.message.includes('Authentication failed')) {
      logCliError('error', 'Authentication failed. Please check your API key configuration.');
      if (!verbose) {
        console.error('\n💡 Troubleshooting tips:');
        console.error('  • Verify your API key is correct in .env file');
        console.error('  • For multi-customer setup, check NEWO_CUSTOMER_<IDN>_API_KEY');
        console.error('  • Run with --verbose for detailed error information');
      }
    }
    // Network errors
    else if (error.message.includes('Network timeout') || error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
      logCliError('error', 'Network connection failed. Please check your internet connection.');
      if (!verbose) {
        console.error('\n💡 Troubleshooting tips:');
        console.error('  • Check your internet connection');
        console.error('  • Verify NEWO_BASE_URL is correct');
        console.error('  • Try again in a few moments');
      }
    }
    // Environment configuration errors
    else if (error instanceof EnvValidationError || error.message.includes('not set')) {
      logCliError('error', 'Configuration error. Please check your environment setup.');
      if (!verbose) {
        console.error('\n💡 Setup help:');
        console.error('  • Copy .env.example to .env and configure your settings');
        console.error('  • Run "newo --help" to see configuration examples');
        console.error('  • Check the README for detailed setup instructions');
      }
    }
    // File system errors
    else if (error.message.includes('ENOENT') || error.message.includes('EACCES')) {
      logCliError('error', 'File system error. Please check file permissions and paths.');
    }
    // Rate limiting
    else if (error.message.includes('Rate limit exceeded')) {
      logCliError('error', 'Rate limit exceeded. Please wait before trying again.');
    }
    // General API errors
    else if (error.message.includes('response') || error.message.includes('status')) {
      logCliError('error', `API error during ${operation}. Please try again or contact support.`);
    }
    // Unknown errors
    else {
      logCliError('error', `Unexpected error during ${operation}: ${error.message}`);
      if (!verbose) {
        console.error('\n💡 For more details, run the command with --verbose flag');
      }
    }

    if (verbose) {
      logCliError('error', 'Full error details', {
        operation,
        errorType: error.constructor.name,
        stack: error.stack?.split('\n').slice(0, 5).join('\n') // First 5 lines of stack
      });
    }
  } else {
    logCliError('error', `Unknown error during ${operation}: ${String(error)}`);
  }

  process.exit(1);
}