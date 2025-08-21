import fs from 'fs-extra';

/**
 * Parse AKB file and extract articles
 * @param {string} filePath - Path to AKB file
 * @returns {Array} Array of parsed articles
 */
function parseAkbFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const articles = [];
  
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
 * @param {Array} lines - Lines of the article section
 * @returns {Object|null} Parsed article object
 */
function parseArticleSection(lines) {
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
    if (nextLine.startsWith('## ') && !nextLine.includes(' / ')) {
      summary = nextLine.replace(/^##\s+/, '').trim();
    }
  }
  
  // Extract keywords (third ## line)
  const keywordsLineIndex = lines.findIndex((line, index) => 
    index > summaryLineIndex + 1 && line.startsWith('## ') && !line.includes(' / ')
  );
  if (keywordsLineIndex >= 0) {
    keywords = lines[keywordsLineIndex].replace(/^##\s+/, '').trim();
  }
  
  // Extract category content
  const categoryStartIndex = lines.findIndex(line => line.includes('<Category type='));
  const categoryEndIndex = lines.findIndex(line => line.includes('</Category>'));
  
  if (categoryStartIndex >= 0 && categoryEndIndex >= 0) {
    const categoryLines = lines.slice(categoryStartIndex, categoryEndIndex + 1);
    topicSummary = categoryLines.join('\n');
  }
  
  // Create topic_facts array
  const topicFacts = [
    category,
    summary,
    keywords
  ].filter(fact => fact.trim() !== '');
  
  return {
    topic_name: category, // Use the descriptive title as topic_name
    persona_id: null, // Will be set when importing
    topic_summary: topicSummary,
    topic_facts: topicFacts,
    confidence: 100,
    source: topicName, // Use the ID (r001) as source
    labels: ["rag_context"]
  };
}

/**
 * Convert parsed articles to API format for bulk import
 * @param {Array} articles - Parsed articles
 * @param {string} personaId - Target persona ID
 * @returns {Array} Array of articles ready for API import
 */
function prepareArticlesForImport(articles, personaId) {
  return articles.map(article => ({
    ...article,
    persona_id: personaId
  }));
}

export {
  parseAkbFile,
  prepareArticlesForImport
};