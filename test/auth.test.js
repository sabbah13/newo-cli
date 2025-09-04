/**
 * Unit tests for authentication functions
 */
import assert from 'assert';
import { expect } from 'chai';
import sinon from 'sinon';
import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import { 
  exchangeApiKeyForToken, 
  refreshWithEndpoint, 
  getValidAccessToken, 
  forceReauth 
} from '../src/auth.js';
import { ENV } from '../src/env.js';
import { TestEnvironment } from './test-utils.js';

describe('Auth Functions', function() {
  let testEnv;
  let mockTokens;
  
  beforeEach(function() {
    testEnv = new TestEnvironment();
    
    // Mock successful token responses
    mockTokens = {
      access_token: 'mock-access-token-12345',
      refresh_token: 'mock-refresh-token-67890',
      expires_in: 3600
    };
  });
  
  afterEach(async function() {
    await testEnv.cleanup();
  });

  describe('API Key Exchange', function() {
    it('should exchange API key for tokens successfully', async function() {
      // Setup
      testEnv.setEnv('NEWO_API_KEY', 'test-api-key');
      testEnv.setEnv('NEWO_BASE_URL', 'https://test.newo.ai');
      
      const axiosStub = testEnv.createStub(axios, 'post');
      axiosStub.resolves({ data: mockTokens });
      
      // Execute
      const result = await exchangeApiKeyForToken();
      
      // Verify
      assert(result.access_token === mockTokens.access_token, 'Should return access token');
      assert(result.refresh_token === mockTokens.refresh_token, 'Should return refresh token');
      assert(result.expires_at > Date.now(), 'Should set future expiry time');
      
      // Verify API call
      assert(axiosStub.calledOnce, 'Should call axios once');
      const callArgs = axiosStub.firstCall.args;
      assert(callArgs[0] === 'https://test.newo.ai/api/v1/auth/api-key/token', 'Should call correct URL');
      assert(callArgs[2].headers['x-api-key'] === 'test-api-key', 'Should send API key header');
    });

    it('should handle customer-specific API keys', async function() {
      testEnv.setEnv('NEWO_BASE_URL', 'https://test.newo.ai');
      
      const customer = {
        idn: 'acme',
        apiKey: 'acme-api-key-123',
        projectId: null
      };
      
      const axiosStub = testEnv.createStub(axios, 'post');
      axiosStub.resolves({ data: mockTokens });
      
      // Execute
      const result = await exchangeApiKeyForToken(customer);
      
      // Verify
      assert(result.access_token === mockTokens.access_token);
      const callArgs = axiosStub.firstCall.args;
      assert(callArgs[2].headers['x-api-key'] === 'acme-api-key-123', 'Should use customer API key');
    });

    it('should handle missing API key error', async function() {
      testEnv.setEnv('NEWO_API_KEY', '');
      
      try {
        await exchangeApiKeyForToken();
        assert.fail('Should have thrown error');
      } catch (error) {
        assert(error.message.includes('NEWO_API_KEY not set'), 'Should indicate missing API key');
      }
    });

    it('should handle network errors gracefully', async function() {
      testEnv.setEnv('NEWO_API_KEY', 'test-key');
      testEnv.setEnv('NEWO_BASE_URL', 'https://test.newo.ai');
      
      const axiosStub = testEnv.createStub(axios, 'post');
      axiosStub.rejects(new Error('Network error'));
      
      try {
        await exchangeApiKeyForToken();
        assert.fail('Should have thrown error');
      } catch (error) {
        assert(error.message.includes('Failed to exchange API key'), 'Should wrap network error');
        assert(error.message.includes('Network error'), 'Should include original error');
      }
    });

    it('should handle different token response formats', async function() {
      testEnv.setEnv('NEWO_API_KEY', 'test-key');
      testEnv.setEnv('NEWO_BASE_URL', 'https://test.newo.ai');
      
      // Test alternative response format
      const altTokens = {
        token: 'alt-access-token', // Different field name
        refreshToken: 'alt-refresh-token', // Different field name
        expiresIn: 7200 // Different field name
      };
      
      const axiosStub = testEnv.createStub(axios, 'post');
      axiosStub.resolves({ data: altTokens });
      
      const result = await exchangeApiKeyForToken();
      
      assert(result.access_token === 'alt-access-token', 'Should handle alternative field names');
      assert(result.refresh_token === 'alt-refresh-token', 'Should handle alternative refresh field');
      
      // Check expiry time calculation
      const expectedExpiry = Date.now() + 7200 * 1000;
      assert(Math.abs(result.expires_at - expectedExpiry) < 1000, 'Should calculate expiry correctly');
    });
  });

  describe('Token Refresh', function() {
    it('should refresh tokens successfully', async function() {
      testEnv.setEnv('NEWO_REFRESH_URL', 'https://test.newo.ai/refresh');
      
      const refreshResponse = {
        access_token: 'new-access-token',
        expires_in: 3600
      };
      
      const axiosStub = testEnv.createStub(axios, 'post');
      axiosStub.resolves({ data: refreshResponse });
      
      const result = await refreshWithEndpoint('old-refresh-token');
      
      assert(result.access_token === 'new-access-token', 'Should return new access token');
      assert(result.refresh_token === 'old-refresh-token', 'Should preserve refresh token if not provided');
      
      // Verify API call
      const callArgs = axiosStub.firstCall.args;
      assert(callArgs[0] === 'https://test.newo.ai/refresh', 'Should call refresh URL');
      assert(callArgs[1].refresh_token === 'old-refresh-token', 'Should send refresh token');
    });

    it('should handle missing refresh URL', async function() {
      testEnv.setEnv('NEWO_REFRESH_URL', '');
      
      try {
        await refreshWithEndpoint('refresh-token');
        assert.fail('Should have thrown error');
      } catch (error) {
        assert(error.message.includes('NEWO_REFRESH_URL not set'), 'Should indicate missing URL');
      }
    });

    it('should handle refresh failures', async function() {
      testEnv.setEnv('NEWO_REFRESH_URL', 'https://test.newo.ai/refresh');
      
      const axiosStub = testEnv.createStub(axios, 'post');
      axiosStub.rejects(new Error('Invalid refresh token'));
      
      try {
        await refreshWithEndpoint('invalid-token');
        assert.fail('Should have thrown error');
      } catch (error) {
        assert(error.message.includes('Failed to refresh token'), 'Should wrap refresh error');
      }
    });
  });

  describe('Token Management', function() {
    let tempDir;
    
    beforeEach(async function() {
      tempDir = await testEnv.createTempDir();
      // Mock process.cwd() to use temp directory
      testEnv.createStub(process, 'cwd').returns(tempDir);
    });

    it('should get valid access token from file', async function() {
      // Setup valid tokens file
      const tokensFile = path.join(tempDir, '.newo', 'tokens.json');
      const validTokens = {
        access_token: 'file-access-token',
        refresh_token: 'file-refresh-token',
        expires_at: Date.now() + 3600000 // 1 hour in future
      };
      
      await fs.ensureDir(path.dirname(tokensFile));
      await fs.writeJson(tokensFile, validTokens);
      
      const result = await getValidAccessToken();
      
      assert(result === 'file-access-token', 'Should return token from file');
    });

    it('should refresh expired tokens', async function() {
      testEnv.setEnv('NEWO_REFRESH_URL', 'https://test.newo.ai/refresh');
      
      // Setup expired tokens
      const tokensFile = path.join(tempDir, '.newo', 'tokens.json');
      const expiredTokens = {
        access_token: 'expired-token',
        refresh_token: 'valid-refresh-token',
        expires_at: Date.now() - 1000 // Expired
      };
      
      await fs.ensureDir(path.dirname(tokensFile));
      await fs.writeJson(tokensFile, expiredTokens);
      
      // Mock refresh response
      const axiosStub = testEnv.createStub(axios, 'post');
      axiosStub.resolves({ 
        data: {
          access_token: 'refreshed-access-token',
          expires_in: 3600
        }
      });
      
      const result = await getValidAccessToken();
      
      assert(result === 'refreshed-access-token', 'Should return refreshed token');
    });

    it('should fall back to API key exchange when refresh fails', async function() {
      testEnv.setEnv('NEWO_API_KEY', 'fallback-api-key');
      testEnv.setEnv('NEWO_BASE_URL', 'https://test.newo.ai');
      testEnv.setEnv('NEWO_REFRESH_URL', 'https://test.newo.ai/refresh');
      
      // Setup expired tokens
      const tokensFile = path.join(tempDir, '.newo', 'tokens.json');
      const expiredTokens = {
        access_token: 'expired-token',
        refresh_token: 'invalid-refresh-token',
        expires_at: Date.now() - 1000
      };
      
      await fs.ensureDir(path.dirname(tokensFile));
      await fs.writeJson(tokensFile, expiredTokens);
      
      const axiosStub = testEnv.createStub(axios, 'post');
      
      // First call (refresh) fails
      axiosStub.onCall(0).rejects(new Error('Invalid refresh token'));
      
      // Second call (API key exchange) succeeds
      axiosStub.onCall(1).resolves({
        data: {
          access_token: 'new-api-key-token',
          expires_in: 3600
        }
      });
      
      const result = await getValidAccessToken();
      
      assert(result === 'new-api-key-token', 'Should fall back to API key exchange');
      assert(axiosStub.calledTwice, 'Should make two API calls');
    });

    it('should exchange API key when no tokens exist', async function() {
      testEnv.setEnv('NEWO_API_KEY', 'first-time-key');
      testEnv.setEnv('NEWO_BASE_URL', 'https://test.newo.ai');
      
      const axiosStub = testEnv.createStub(axios, 'post');
      axiosStub.resolves({
        data: {
          access_token: 'first-time-token',
          expires_in: 3600
        }
      });
      
      const result = await getValidAccessToken();
      
      assert(result === 'first-time-token', 'Should get token via API key exchange');
    });
  });

  describe('Multi-Customer Support', function() {
    let tempDir;
    
    beforeEach(async function() {
      tempDir = await testEnv.createTempDir();
      testEnv.createStub(process, 'cwd').returns(tempDir);
    });

    it('should handle customer-specific token storage', async function() {
      const customer = {
        idn: 'acme',
        apiKey: 'acme-api-key',
        projectId: null
      };
      
      testEnv.setEnv('NEWO_BASE_URL', 'https://test.newo.ai');
      
      const axiosStub = testEnv.createStub(axios, 'post');
      axiosStub.resolves({
        data: {
          access_token: 'acme-access-token',
          expires_in: 3600
        }
      });
      
      const result = await getValidAccessToken(customer);
      
      // Verify token returned
      assert(result === 'acme-access-token');
      
      // Verify tokens saved to customer-specific path
      const customerTokensPath = path.join(tempDir, 'newo_customers', 'acme', '.newo', 'tokens.json');
      const savedTokens = await fs.readJson(customerTokensPath);
      assert(savedTokens.access_token === 'acme-access-token');
    });

    it('should force re-authentication', async function() {
      testEnv.setEnv('NEWO_API_KEY', 'force-reauth-key');
      testEnv.setEnv('NEWO_BASE_URL', 'https://test.newo.ai');
      
      const axiosStub = testEnv.createStub(axios, 'post');
      axiosStub.resolves({
        data: {
          access_token: 'force-reauth-token',
          expires_in: 3600
        }
      });
      
      const result = await forceReauth();
      
      assert(result === 'force-reauth-token', 'Should return new token');
    });
  });

  describe('Error Handling', function() {
    it('should handle invalid token responses', async function() {
      testEnv.setEnv('NEWO_API_KEY', 'test-key');
      testEnv.setEnv('NEWO_BASE_URL', 'https://test.newo.ai');
      
      // Mock response without access token
      const axiosStub = testEnv.createStub(axios, 'post');
      axiosStub.resolves({ data: { expires_in: 3600 } });
      
      try {
        await exchangeApiKeyForToken();
        assert.fail('Should have thrown error');
      } catch (error) {
        assert(error.message.includes('missing access token'), 'Should indicate missing access token');
      }
    });

    it('should handle file system errors gracefully', async function() {
      const tempDir = await testEnv.createTempDir();
      testEnv.createStub(process, 'cwd').returns(tempDir);
      
      // Create read-only directory to cause write error
      const newoDir = path.join(tempDir, '.newo');
      await fs.ensureDir(newoDir);
      await fs.chmod(newoDir, 0o444); // Read-only
      
      testEnv.setEnv('NEWO_API_KEY', 'test-key');
      testEnv.setEnv('NEWO_BASE_URL', 'https://test.newo.ai');
      
      const axiosStub = testEnv.createStub(axios, 'post');
      axiosStub.resolves({
        data: {
          access_token: 'test-token',
          expires_in: 3600
        }
      });
      
      try {
        await exchangeApiKeyForToken();
        // Should still work despite file save error
        assert(axiosStub.calledOnce, 'Should still make API call');
      } catch (error) {
        // File system error is acceptable here
        assert(error.message.includes('EACCES') || error.message.includes('permission'), 
               'Should be file permission error');
      } finally {
        // Restore permissions for cleanup
        await fs.chmod(newoDir, 0o755);
      }
    });
  });
});