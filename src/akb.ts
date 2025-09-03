import fs from 'fs-extra';
import type { ParsedArticle, AkbImportArticle } from './types.js';

/**
 * Parse AKB file and extract articles
 */
export function parseAkbFile(filePath: string): ParsedArticle[] {
  const content = fs.readFileSync(filePath, 'utf8');
  const articles: ParsedArticle[] = [];
  
  // Split by article separators (---)
  const sections = content.split(/^---\s*$/gm).filter(section => section.trim());
  
  for (const section of sections) {
    const lines = section.split('\n').filter(line => line.trim());
    if (lines.length === 0) continue;
    
    const article = parseArticleSection(lines);
    if (article) {
      articles.push(article);
    }
  }
  
  return articles;
}

/**
 * Parse individual article section
 */
function parseArticleSection(lines: string[]): ParsedArticle | null {
  let topicName = '';
  let category = '';
  let summary = '';
  let keywords = '';
  let topicSummary = '';
  
  // Find topic name (# r001)
  const topicLine = lines.find(line => line.match(/^#\s+r\d+/));
  if (!topicLine) return null;
  
  topicName = topicLine.replace(/^#\s+/, '').trim();
  
  // Extract category/subcategory/description (first ## line)
  const categoryLine = lines.find(line => line.startsWith('## ') && line.includes(' / '));
  if (categoryLine) {
    category = categoryLine.replace(/^##\s+/, '').trim();
  }
  
  // Extract summary (second ## line)
  const summaryLineIndex = lines.findIndex(line => line.startsWith('## ') && line.includes(' / '));
  if (summaryLineIndex >= 0 && summaryLineIndex + 1 < lines.length) {
    const nextLine = lines[summaryLineIndex + 1];
    if (nextLine && nextLine.startsWith('## ') && !nextLine.includes(' / ')) {
      summary = nextLine.replace(/^##\s+/, '').trim();
    }
  }
  
  // Extract keywords (third ## line)
  const keywordsLineIndex = lines.findIndex((line, index) => 
    index > summaryLineIndex + 1 && line.startsWith('## ') && !line.includes(' / ')
  );
  if (keywordsLineIndex >= 0) {
    const keywordsLine = lines[keywordsLineIndex];
    if (keywordsLine) {
      keywords = keywordsLine.replace(/^##\s+/, '').trim();
    }
  }
  
  // Extract category content
  const categoryStartIndex = lines.findIndex(line => line.includes('<Category type='));
  const categoryEndIndex = lines.findIndex(line => line.includes('</Category>'));
  
  if (categoryStartIndex >= 0 && categoryEndIndex >= 0) {
    const categoryLines = lines.slice(categoryStartIndex, categoryEndIndex + 1);
    topicSummary = categoryLines.join('\n');
  }
  
  // Create topic_facts array
  const topicFacts = [category, summary, keywords].filter(fact => fact.trim() !== '');
  
  return {
    topic_name: category, // Use the descriptive title as topic_name
    persona_id: null, // Will be set when importing
    topic_summary: topicSummary,
    topic_facts: topicFacts,
    confidence: 100,
    source: topicName, // Use the ID (r001) as source
    labels: ['rag_context']
  };
}

/**
 * Convert parsed articles to API format for bulk import
 */
export function prepareArticlesForImport(
  articles: ParsedArticle[], 
  personaId: string
): AkbImportArticle[] {
  return articles.map(article => ({
    ...article,
    persona_id: personaId
  }));
}