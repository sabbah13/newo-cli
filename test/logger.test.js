/**
 * Comprehensive tests for logging framework
 */
import { expect } from 'chai';
import fs from 'fs-extra';
import path from 'path';
import { Logger, ProgressLogger, LOG_LEVELS } from '../src/logger.js';
import { TestEnvironment, MockFileSystem } from './test-utils.js';

describe('Logging Framework', () => {
  let testEnv;
  let tempDir;
  let mockFs;

  beforeEach(async () => {
    testEnv = new TestEnvironment();
    tempDir = await testEnv.createTempDir();
    mockFs = new MockFileSystem();
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  describe('Logger Basic Functionality', () => {
    it('should create logger with default options', async () => {
      const logger = new Logger({
        enableFile: false, // Disable file logging for testing
        enableConsole: false
      });

      expect(logger.level).to.equal('DEBUG');
      expect(logger.enableConsole).to.be.false;
      expect(logger.enableFile).to.be.false;
    });

    it('should create logger with custom options', async () => {
      const logger = new Logger({
        level: 'ERROR',
        enableConsole: true,
        enableFile: true,
        enableColors: false
      });

      expect(logger.level).to.equal('ERROR');
      expect(logger.enableConsole).to.be.true;
      expect(logger.enableFile).to.be.true;
      expect(logger.enableColors).to.be.false;
    });

    it('should set and get log levels correctly', () => {
      const logger = new Logger({ enableFile: false, enableConsole: false });
      
      logger.setLevel('WARN');
      expect(logger.getLevel()).to.equal('WARN');
      
      logger.setLevel('TRACE');
      expect(logger.getLevel()).to.equal('TRACE');
    });

    it('should validate log levels', () => {
      const logger = new Logger({ enableFile: false, enableConsole: false });
      
      expect(() => logger.setLevel('INVALID')).to.throw('Invalid log level');
    });

    it('should check if levels are enabled correctly', () => {
      const logger = new Logger({ level: 'WARN', enableFile: false, enableConsole: false });
      
      expect(logger.isEnabled('ERROR')).to.be.true;
      expect(logger.isEnabled('WARN')).to.be.true;
      expect(logger.isEnabled('INFO')).to.be.false;
      expect(logger.isEnabled('DEBUG')).to.be.false;
      expect(logger.isEnabled('TRACE')).to.be.false;
    });
  });

  describe('Log Level Filtering', () => {
    let logger;
    let loggedMessages;

    beforeEach(() => {
      loggedMessages = [];
      
      // Mock console methods to capture logs
      testEnv.createStub(console, 'log', (message) => loggedMessages.push({ level: 'log', message }));
      testEnv.createStub(console, 'warn', (message) => loggedMessages.push({ level: 'warn', message }));
      testEnv.createStub(console, 'error', (message) => loggedMessages.push({ level: 'error', message }));
      
      logger = new Logger({
        level: 'WARN',
        enableFile: false,
        enableConsole: true,
        enableColors: false
      });
    });

    it('should only log messages at or above the set level', async () => {
      await logger.error('Error message');
      await logger.warn('Warning message');
      await logger.info('Info message');
      await logger.debug('Debug message');
      await logger.trace('Trace message');

      expect(loggedMessages).to.have.length(2);
      expect(loggedMessages[0].message).to.include('Error message');
      expect(loggedMessages[1].message).to.include('Warning message');
    });

    it('should log all messages when level is TRACE', async () => {
      logger.setLevel('TRACE');
      
      await logger.error('Error message');
      await logger.warn('Warning message');
      await logger.info('Info message');
      await logger.debug('Debug message');
      await logger.trace('Trace message');

      expect(loggedMessages).to.have.length(5);
    });

    it('should log no messages when level is above ERROR', async () => {
      logger.setLevel('ERROR');
      
      await logger.warn('Warning message');
      await logger.info('Info message');
      await logger.debug('Debug message');
      await logger.trace('Trace message');

      expect(loggedMessages).to.have.length(0);
    });
  });

  describe('Message Formatting', () => {
    let logger;
    let consoleOutput;

    beforeEach(() => {
      consoleOutput = [];
      testEnv.createStub(console, 'log', (message) => consoleOutput.push(message));
      testEnv.createStub(console, 'warn', (message) => consoleOutput.push(message));
      testEnv.createStub(console, 'error', (message) => consoleOutput.push(message));
      
      logger = new Logger({
        enableFile: false,
        enableConsole: true,
        enableColors: false
      });
    });

    it('should format messages with timestamp and level', async () => {
      await logger.info('Test message');
      
      expect(consoleOutput).to.have.length(1);
      const output = consoleOutput[0];
      expect(output).to.include('ℹ️');
      expect(output).to.include('Test message');
      expect(output).to.match(/\d{2}:\d{2}:\d{2}/); // Time format
    });

    it('should format messages with metadata', async () => {
      await logger.info('Test message', { key: 'value', number: 42 });
      
      expect(consoleOutput).to.have.length(1);
      const output = consoleOutput[0];
      expect(output).to.include('Test message');
      expect(output).to.include('key');
      expect(output).to.include('value');
      expect(output).to.include('42');
    });

    it('should handle object messages', async () => {
      await logger.info({ message: 'Object message', data: [1, 2, 3] });
      
      expect(consoleOutput).to.have.length(1);
      const output = consoleOutput[0];
      expect(output).to.include('Object message');
      expect(output).to.include('[1,2,3]');
    });

    it('should use appropriate emojis for different levels', async () => {
      await logger.error('Error');
      await logger.warn('Warning');
      await logger.info('Info');
      await logger.debug('Debug');
      await logger.trace('Trace');

      expect(consoleOutput[0]).to.include('❌');
      expect(consoleOutput[1]).to.include('⚠️');
      expect(consoleOutput[2]).to.include('ℹ️');
      expect(consoleOutput[3]).to.include('🐛');
      expect(consoleOutput[4]).to.include('🔍');
    });
  });

  describe('Specialized Logging Methods', () => {
    let logger;
    let loggedMessages;

    beforeEach(() => {
      loggedMessages = [];
      testEnv.createStub(console, 'log', (message) => loggedMessages.push(message));
      testEnv.createStub(console, 'warn', (message) => loggedMessages.push(message));
      testEnv.createStub(console, 'error', (message) => loggedMessages.push(message));
      
      logger = new Logger({
        enableFile: false,
        enableConsole: true,
        enableColors: false
      });
    });

    it('should log API calls correctly', async () => {
      await logger.logApiCall('GET', '/api/test', 200, 150);
      
      expect(loggedMessages).to.have.length(1);
      const message = loggedMessages[0];
      expect(message).to.include('API Call: GET /api/test');
      expect(message).to.include('200');
      expect(message).to.include('150ms');
    });

    it('should log API errors correctly', async () => {
      const error = new Error('API failed');
      await logger.logApiCall('POST', '/api/test', 500, 1000, error);
      
      expect(loggedMessages).to.have.length(1);
      const message = loggedMessages[0];
      expect(message).to.include('API Error: POST /api/test');
      expect(message).to.include('500');
      expect(message).to.include('1000ms');
    });

    it('should log file operations correctly', async () => {
      await logger.logFileOperation('read', '/path/to/file.txt', true);
      
      expect(loggedMessages).to.have.length(1);
      const message = loggedMessages[0];
      expect(message).to.include('File Operation: read');
      expect(message).to.include('/path/to/file.txt');
    });

    it('should log file operation errors correctly', async () => {
      const error = new Error('File not found');
      await logger.logFileOperation('write', '/path/to/file.txt', false, error);
      
      expect(loggedMessages).to.have.length(1);
      const message = loggedMessages[0];
      expect(message).to.include('File Operation Failed: write');
      expect(message).to.include('/path/to/file.txt');
    });
  });

  describe('Child Logger', () => {
    let parentLogger;
    let loggedMessages;

    beforeEach(() => {
      loggedMessages = [];
      testEnv.createStub(console, 'log', (message) => loggedMessages.push(message));
      
      parentLogger = new Logger({
        enableFile: false,
        enableConsole: true,
        enableColors: false
      });
    });

    it('should create child logger with additional context', async () => {
      const childLogger = parentLogger.child({ component: 'TestComponent', requestId: '123' });
      
      await childLogger.info('Child message');
      
      expect(loggedMessages).to.have.length(1);
      const message = loggedMessages[0];
      expect(message).to.include('Child message');
      expect(message).to.include('TestComponent');
      expect(message).to.include('123');
    });

    it('should inherit parent logger settings', () => {
      const childLogger = parentLogger.child({ component: 'TestComponent' });
      
      expect(childLogger.level).to.equal(parentLogger.level);
      expect(childLogger.enableConsole).to.equal(parentLogger.enableConsole);
      expect(childLogger.enableFile).to.equal(parentLogger.enableFile);
    });

    it('should combine parent and child context', async () => {
      const childLogger = parentLogger.child({ component: 'Parent' });
      const grandChildLogger = childLogger.child({ subComponent: 'Child' });
      
      await grandChildLogger.info('Nested message');
      
      expect(loggedMessages).to.have.length(1);
      const message = loggedMessages[0];
      expect(message).to.include('component');
      expect(message).to.include('Parent');
      expect(message).to.include('subComponent');
      expect(message).to.include('Child');
    });
  });

  describe('File Logging', () => {
    let logger;
    let logDir;

    beforeEach(async () => {
      logDir = path.join(tempDir, 'logs');
      await fs.ensureDir(logDir);
      
      // Mock getDirectories to return our temp directory
      const mockGetDirectories = testEnv.createStub(
        await import('../src/config.js'),
        'getDirectories',
        () => ({ logs: logDir })
      );
      
      logger = new Logger({
        enableFile: true,
        enableConsole: false
      });
      
      // Wait for initialization
      await logger._ensureInitialized();
    });

    it('should create log file with correct naming', async () => {
      await logger.info('Test file log');
      
      const files = await fs.readdir(logDir);
      expect(files).to.have.length(1);
      
      const logFile = files[0];
      expect(logFile).to.match(/newo-cli-\d{4}-\d{2}-\d{2}\.log/);
    });

    it('should write structured log entries to file', async () => {
      await logger.info('Test message', { key: 'value' });
      
      const files = await fs.readdir(logDir);
      const logFile = path.join(logDir, files[0]);
      const content = await fs.readFile(logFile, 'utf8');
      
      expect(content).to.include('Test message');
      expect(content).to.include('[INFO ]');
      expect(content).to.include('{"key":"value"}');
      expect(content).to.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/); // ISO timestamp
    });

    it('should append multiple log entries to same file', async () => {
      await logger.info('First message');
      await logger.warn('Second message');
      await logger.error('Third message');
      
      const files = await fs.readdir(logDir);
      expect(files).to.have.length(1);
      
      const logFile = path.join(logDir, files[0]);
      const content = await fs.readFile(logFile, 'utf8');
      const lines = content.trim().split('\n');
      
      expect(lines).to.have.length(3);
      expect(lines[0]).to.include('First message');
      expect(lines[1]).to.include('Second message');
      expect(lines[2]).to.include('Third message');
    });

    it('should handle file write errors gracefully', async () => {
      // Mock fs.appendFile to throw error
      const appendFileStub = testEnv.createStub(fs, 'appendFile');
      appendFileStub.rejects(new Error('Disk full'));
      
      // Should not throw error, but log to console instead
      expect(async () => {
        await logger.info('This should fail to write to file');
      }).to.not.throw();
    });
  });

  describe('Progress Logger', () => {
    let logger;
    let consoleOutput;

    beforeEach(() => {
      consoleOutput = [];
      testEnv.createStub(console, 'log', (message) => consoleOutput.push(message));
      
      logger = new Logger({
        enableFile: false,
        enableConsole: true,
        enableColors: false
      });
    });

    it('should create progress logger with correct parameters', () => {
      const progressLogger = new ProgressLogger(logger, 100, 'Processing items');
      
      expect(progressLogger.total).to.equal(100);
      expect(progressLogger.current).to.equal(0);
      expect(progressLogger.message).to.equal('Processing items');
    });

    it('should update progress and log periodically', async () => {
      const progressLogger = new ProgressLogger(logger, 10, 'Test progress');
      
      // Update progress multiple times
      await progressLogger.update(3);
      await progressLogger.update(2);
      await progressLogger.update(5);
      
      // Should have logged progress updates
      expect(consoleOutput.length).to.be.at.least(1);
      
      const lastMessage = consoleOutput[consoleOutput.length - 1];
      expect(lastMessage).to.include('Test progress');
      expect(lastMessage).to.include('[10/10]');
      expect(lastMessage).to.include('100%');
    });

    it('should log completion message', async () => {
      const progressLogger = new ProgressLogger(logger, 5, 'Quick task');
      
      await progressLogger.update(5);
      await progressLogger.complete('Task finished successfully');
      
      const completionMessage = consoleOutput[consoleOutput.length - 1];
      expect(completionMessage).to.include('Task finished successfully');
      expect(completionMessage).to.include('completed');
    });

    it('should calculate estimated time remaining', async () => {
      const progressLogger = new ProgressLogger(logger, 100, 'Long task');
      
      // Simulate some progress
      await progressLogger.update(25);
      
      const progressMessage = consoleOutput[consoleOutput.length - 1];
      expect(progressMessage).to.include('remaining');
      expect(progressMessage).to.match(/\d+s remaining/);
    });
  });

  describe('Logger Cleanup and Resource Management', () => {
    it('should flush pending writes', async () => {
      const logger = new Logger({
        enableFile: false,
        enableConsole: false
      });
      
      // Should not throw
      await expect(logger.flush()).to.not.be.rejected;
    });

    it('should close logger and cleanup resources', async () => {
      const logger = new Logger({
        enableFile: false,
        enableConsole: false
      });
      
      // Should not throw
      await expect(logger.close()).to.not.be.rejected;
    });

    it('should handle multiple close calls gracefully', async () => {
      const logger = new Logger({
        enableFile: false,
        enableConsole: false
      });
      
      await logger.close();
      await logger.close(); // Should not throw
      
      expect(true).to.be.true; // Test passes if no exception thrown
    });
  });

  describe('LOG_LEVELS Constants', () => {
    it('should have correct log level values', () => {
      expect(LOG_LEVELS.ERROR).to.equal(0);
      expect(LOG_LEVELS.WARN).to.equal(1);
      expect(LOG_LEVELS.INFO).to.equal(2);
      expect(LOG_LEVELS.DEBUG).to.equal(3);
      expect(LOG_LEVELS.TRACE).to.equal(4);
    });

    it('should have all required log levels', () => {
      const requiredLevels = ['ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'];
      
      for (const level of requiredLevels) {
        expect(LOG_LEVELS).to.have.property(level);
        expect(typeof LOG_LEVELS[level]).to.equal('number');
      }
    });

    it('should have log levels in correct order', () => {
      expect(LOG_LEVELS.ERROR).to.be.lessThan(LOG_LEVELS.WARN);
      expect(LOG_LEVELS.WARN).to.be.lessThan(LOG_LEVELS.INFO);
      expect(LOG_LEVELS.INFO).to.be.lessThan(LOG_LEVELS.DEBUG);
      expect(LOG_LEVELS.DEBUG).to.be.lessThan(LOG_LEVELS.TRACE);
    });
  });
});