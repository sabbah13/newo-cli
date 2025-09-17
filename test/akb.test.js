/**
 * Unit tests for AKB import functions
 */
import assert from 'assert';
import { expect } from 'chai';
import fs from 'fs-extra';
import path from 'path';
import { parseAkbFile, prepareArticlesForImport } from '../dist/akb.js';
import { TestEnvironment } from './test-utils.js';

describe('AKB Import Functions', function() {
  let testEnv;
  
  beforeEach(function() {
    testEnv = new TestEnvironment();
  });
  
  afterEach(async function() {
    await testEnv.cleanup();
  });

  describe('Article File Parsing', function() {
    let tempDir;
    
    beforeEach(async function() {
      tempDir = await testEnv.createTempDir();
    });

    it('should parse well-formatted AKB file', async function() {
      const akbContent = `
# r001
## Category / Subcategory / Description
## Summary of the article
## Keywords: keyword1, keyword2, keyword3

<Category type="article">
This is the detailed content of the article.
It includes pricing information and other details.

Price: $99.99
Features: Feature A, Feature B, Feature C
</Category>

---

# r002
## Technology / Software / Development Tools
## Overview of development best practices
## Keywords: development, coding, best-practices

<Category type="guide">
Comprehensive guide to software development.
Includes coding standards and project management.

Standards: Clean Code, SOLID Principles
Tools: IDE, Version Control, Testing Frameworks
</Category>
`;
      
      const filePath = path.join(tempDir, 'test-akb.txt');
      await fs.writeFile(filePath, akbContent, 'utf8');
      
      const articles = await parseAkbFile(filePath);
      
      assert.strictEqual(articles.length, 2, 'Should parse two articles');
      
      // Verify first article
      const article1 = articles[0];
      assert.strictEqual(article1.topic_name, 'Category / Subcategory / Description', 'Should extract topic name');
      assert.strictEqual(article1.source, 'r001', 'Should extract source ID');
      assert(article1.topic_summary.includes('This is the detailed content'), 'Should extract topic summary');
      assert(article1.topic_summary.includes('Price: $99.99'), 'Should include pricing info');
      assert.deepStrictEqual(article1.topic_facts.length, 3, 'Should have 3 topic facts');
      assert(article1.topic_facts[0].includes('Category'), 'First fact should be category');
      assert(article1.topic_facts[1].includes('Summary'), 'Second fact should be summary');
      assert(article1.topic_facts[2].includes('Keywords'), 'Third fact should be keywords');
      assert.strictEqual(article1.confidence, 100, 'Should have confidence 100');
      assert.deepStrictEqual(article1.labels, ['rag_context'], 'Should have rag_context label');
      
      // Verify second article
      const article2 = articles[1];
      assert.strictEqual(article2.topic_name, 'Technology / Software / Development Tools', 'Should extract second topic name');
      assert.strictEqual(article2.source, 'r002', 'Should extract second source ID');
      assert(article2.topic_summary.includes('Comprehensive guide'), 'Should extract second topic summary');
    });

    it('should handle missing sections gracefully', async function() {
      const incompleteContent = `
# r003
## Incomplete / Article / Missing Parts

<Category type="partial">
This article has missing sections.
</Category>
`;
      
      const filePath = path.join(tempDir, 'incomplete-akb.txt');
      await fs.writeFile(filePath, incompleteContent, 'utf8');
      
      const articles = await parseAkbFile(filePath);
      
      assert.strictEqual(articles.length, 1, 'Should still parse incomplete article');
      
      const article = articles[0];
      assert.strictEqual(article.topic_name, 'Incomplete / Article / Missing Parts');
      assert.strictEqual(article.source, 'r003');
      assert(article.topic_summary.includes('This article has missing'));
      
      // Should handle missing summary and keywords
      assert(article.topic_facts.length >= 1, 'Should have at least category in facts');
    });

    it('should skip sections without topic line', async function() {
      const invalidContent = `
Invalid section without topic line.
This should be skipped.

---

# r004
## Valid / Article / After Invalid
## This article should be parsed
## Keywords: valid, parsing

<Category type="valid">
This is a valid article after an invalid one.
</Category>
`;
      
      const filePath = path.join(tempDir, 'mixed-akb.txt');
      await fs.writeFile(filePath, invalidContent, 'utf8');
      
      // Should log warning but not throw
      const articles = await parseAkbFile(filePath);
      
      assert.strictEqual(articles.length, 1, 'Should skip invalid section and parse valid one');
      assert.strictEqual(articles[0].source, 'r004', 'Should parse the valid article');
    });

    it('should handle different article ID formats', async function() {
      const multiFormatContent = `
# r001
## Standard / Format / Article
<Category type="standard">Standard format</Category>

---

# r999
## High / Number / Article  
<Category type="high">High number format</Category>

---

# r042
## Leading / Zero / Article
<Category type="zero">Leading zero format</Category>
`;
      
      const filePath = path.join(tempDir, 'multi-format-akb.txt');
      await fs.writeFile(filePath, multiFormatContent, 'utf8');
      
      const articles = await parseAkbFile(filePath);
      
      assert.strictEqual(articles.length, 3, 'Should parse all article formats');
      
      const sources = articles.map(a => a.source);
      assert(sources.includes('r001'), 'Should handle r001');
      assert(sources.includes('r999'), 'Should handle r999');  
      assert(sources.includes('r042'), 'Should handle r042');
    });

    it('should handle Unicode content', async function() {
      const unicodeContent = `
# r005
## Technology / AI / 人工知能システム
## AIシステムの概要とベストプラクティス
## Keywords: AI, 人工知能, machine learning

<Category type="multilingual">
This article contains Unicode characters: 🤖 AI システム
Français: système d'intelligence artificielle
Español: sistema de inteligencia artificial
中文：人工智能系统
</Category>
`;
      
      const filePath = path.join(tempDir, 'unicode-akb.txt');
      await fs.writeFile(filePath, unicodeContent, 'utf8');
      
      const articles = await parseAkbFile(filePath);
      
      assert.strictEqual(articles.length, 1, 'Should parse Unicode content');
      
      const article = articles[0];
      assert(article.topic_name.includes('人工知能'), 'Should preserve Japanese characters');
      assert(article.topic_summary.includes('🤖'), 'Should preserve emoji');
      assert(article.topic_summary.includes('中文'), 'Should preserve Chinese characters');
    });

    it('should handle empty or whitespace-only file', async function() {
      const emptyFilePath = path.join(tempDir, 'empty-akb.txt');
      await fs.writeFile(emptyFilePath, '', 'utf8');
      
      const articles1 = await parseAkbFile(emptyFilePath);
      assert.strictEqual(articles1.length, 0, 'Should return empty array for empty file');
      
      const whitespaceFilePath = path.join(tempDir, 'whitespace-akb.txt');
      await fs.writeFile(whitespaceFilePath, '   \n\n\t\t\n   ', 'utf8');
      
      const articles2 = await parseAkbFile(whitespaceFilePath);
      assert.strictEqual(articles2.length, 0, 'Should return empty array for whitespace file');
    });

    it('should handle file read errors', async function() {
      const nonExistentPath = path.join(tempDir, 'does-not-exist.txt');
      
      try {
        await parseAkbFile(nonExistentPath);
        assert.fail('Should have thrown error for non-existent file');
      } catch (error) {
        assert(error.code === 'ENOENT', 'Should throw file not found error');
      }
    });

    it('should handle complex category content', async function() {
      const complexContent = `
# r006
## E-commerce / Pricing / Dynamic Pricing Strategy
## Comprehensive pricing model for online retail
## Keywords: pricing, e-commerce, strategy, dynamic

<Category type="strategy">
# Dynamic Pricing Strategy

## Overview
Dynamic pricing allows real-time price adjustments based on:
- Market demand
- Competitor pricing  
- Inventory levels
- Customer segments

## Pricing Tiers
- Basic: $29/month
- Professional: $99/month
- Enterprise: $299/month

## Implementation Steps
1. Market analysis
2. Algorithm development
3. Testing phase
4. Full deployment

## ROI Expectations
- 15-25% revenue increase
- 10-20% margin improvement
- 30-40% faster inventory turnover
</Category>
`;
      
      const filePath = path.join(tempDir, 'complex-akb.txt');
      await fs.writeFile(filePath, complexContent, 'utf8');
      
      const articles = await parseAkbFile(filePath);
      
      assert.strictEqual(articles.length, 1, 'Should parse complex article');
      
      const article = articles[0];
      assert(article.topic_summary.includes('Dynamic Pricing Strategy'), 'Should include header');
      assert(article.topic_summary.includes('$29/month'), 'Should include pricing info');
      assert(article.topic_summary.includes('Implementation Steps'), 'Should include sections');
      assert(article.topic_summary.includes('15-25% revenue increase'), 'Should include metrics');
    });
  });

  describe('Article Preparation for Import', function() {
    it('should prepare articles with persona ID', function() {
      const parsedArticles = [
        {
          topic_name: 'Test Article 1',
          persona_id: null,
          topic_summary: 'Summary 1',
          topic_facts: ['Fact 1', 'Fact 2'],
          confidence: 100,
          source: 'r001',
          labels: ['rag_context']
        },
        {
          topic_name: 'Test Article 2', 
          persona_id: null,
          topic_summary: 'Summary 2',
          topic_facts: ['Fact 3', 'Fact 4'],
          confidence: 100,
          source: 'r002',
          labels: ['rag_context']
        }
      ];
      
      const personaId = 'test-persona-12345';
      const prepared = prepareArticlesForImport(parsedArticles, personaId);
      
      assert.strictEqual(prepared.length, 2, 'Should return same number of articles');
      
      prepared.forEach((article, index) => {
        assert.strictEqual(article.persona_id, personaId, `Article ${index} should have persona ID`);
        assert.strictEqual(article.topic_name, parsedArticles[index].topic_name, `Article ${index} should preserve topic name`);
        assert.strictEqual(article.topic_summary, parsedArticles[index].topic_summary, `Article ${index} should preserve summary`);
        assert.deepStrictEqual(article.topic_facts, parsedArticles[index].topic_facts, `Article ${index} should preserve facts`);
        assert.strictEqual(article.source, parsedArticles[index].source, `Article ${index} should preserve source`);
      });
    });

    it('should handle empty article array', function() {
      const prepared = prepareArticlesForImport([], 'test-persona');
      assert.strictEqual(prepared.length, 0, 'Should return empty array');
    });

    it('should preserve all article properties', function() {
      const article = {
        topic_name: 'Complex Article',
        persona_id: null,
        topic_summary: 'Complex summary with multiple lines\nand special characters: @#$%',
        topic_facts: ['Category / Sub / Description', 'Summary line', 'Keywords: a, b, c'],
        confidence: 100,
        source: 'r999',
        labels: ['rag_context']
      };
      
      const prepared = prepareArticlesForImport([article], 'persona-uuid-123');
      
      assert.strictEqual(prepared.length, 1);
      
      const result = prepared[0];
      assert.strictEqual(result.persona_id, 'persona-uuid-123');
      assert.strictEqual(result.topic_name, article.topic_name);
      assert.strictEqual(result.topic_summary, article.topic_summary);
      assert.deepStrictEqual(result.topic_facts, article.topic_facts);
      assert.strictEqual(result.confidence, article.confidence);
      assert.strictEqual(result.source, article.source);
      assert.deepStrictEqual(result.labels, article.labels);
    });
  });

  describe('End-to-End Article Processing', function() {
    let tempDir;
    
    beforeEach(async function() {
      tempDir = await testEnv.createTempDir();
    });

    it('should process complete workflow from file to import format', async function() {
      const akbContent = `
# r100
## Business / Strategy / Market Analysis
## Comprehensive market analysis methodology
## Keywords: market-analysis, business-intelligence, competitive-research

<Category type="methodology">
# Market Analysis Framework

## Phase 1: Data Collection
- Competitor analysis
- Customer surveys
- Market size estimation

## Phase 2: Analysis
- SWOT analysis
- Porter's Five Forces
- Market segmentation

## Phase 3: Strategic Recommendations
- Market entry strategy
- Pricing recommendations
- Competitive positioning

## Key Metrics
- Market share: 15-20% target
- Revenue growth: 25% annually
- Customer acquisition: 1000+ new customers/month

## Investment Required
- Research team: $200K annually
- Tools and software: $50K annually
- External consultants: $100K project-based
</Category>

---

# r101
## Technology / Development / API Design
## Best practices for RESTful API development
## Keywords: api-design, rest, development, web-services

<Category type="best-practices">
# RESTful API Design Guidelines

## HTTP Methods
- GET: Retrieve resources
- POST: Create new resources
- PUT: Update existing resources  
- DELETE: Remove resources

## Status Codes
- 200: Success
- 201: Created
- 400: Bad Request
- 401: Unauthorized
- 404: Not Found
- 500: Server Error

## Authentication
- JWT tokens recommended
- OAuth 2.0 for third-party access
- API key fallback for simple cases

## Rate Limiting
- 1000 requests/hour for free tier
- 10000 requests/hour for premium
- 50000 requests/hour for enterprise

## Documentation
- OpenAPI/Swagger specification
- Interactive API explorer
- Code examples in multiple languages
</Category>
`;
      
      const filePath = path.join(tempDir, 'complete-akb.txt');
      await fs.writeFile(filePath, akbContent, 'utf8');
      
      // Parse articles from file
      const articles = await parseAkbFile(filePath);
      assert.strictEqual(articles.length, 2, 'Should parse both articles');
      
      // Prepare for import
      const personaId = 'business-analyst-persona-123';
      const importReady = prepareArticlesForImport(articles, personaId);
      
      assert.strictEqual(importReady.length, 2, 'Should prepare both articles');
      
      // Verify first article (Business Strategy)
      const businessArticle = importReady[0];
      assert.strictEqual(businessArticle.persona_id, personaId);
      assert.strictEqual(businessArticle.source, 'r100');
      assert(businessArticle.topic_name.includes('Market Analysis'));
      assert(businessArticle.topic_summary.includes('Market Analysis Framework'));
      assert(businessArticle.topic_summary.includes('$200K annually'));
      assert(businessArticle.topic_facts.some(fact => fact.includes('market-analysis')));
      
      // Verify second article (API Design)
      const techArticle = importReady[1];
      assert.strictEqual(techArticle.persona_id, personaId);
      assert.strictEqual(techArticle.source, 'r101');
      assert(techArticle.topic_name.includes('API Design'));
      assert(techArticle.topic_summary.includes('RESTful API Design Guidelines'));
      assert(techArticle.topic_summary.includes('1000 requests/hour'));
      assert(techArticle.topic_facts.some(fact => fact.includes('api-design')));
      
      // Verify all articles have required fields for import
      importReady.forEach((article, index) => {
        assert(typeof article.topic_name === 'string' && article.topic_name.length > 0, 
               `Article ${index} should have non-empty topic_name`);
        assert(typeof article.persona_id === 'string' && article.persona_id.length > 0,
               `Article ${index} should have non-empty persona_id`);
        assert(typeof article.topic_summary === 'string' && article.topic_summary.length > 0,
               `Article ${index} should have non-empty topic_summary`);
        assert(Array.isArray(article.topic_facts) && article.topic_facts.length > 0,
               `Article ${index} should have non-empty topic_facts array`);
        assert(typeof article.confidence === 'number',
               `Article ${index} should have numeric confidence`);
        assert(typeof article.source === 'string' && article.source.length > 0,
               `Article ${index} should have non-empty source`);
        assert(Array.isArray(article.labels) && article.labels.includes('rag_context'),
               `Article ${index} should have labels array with rag_context`);
      });
    });
  });
});