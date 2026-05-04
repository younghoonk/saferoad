const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.resolve(process.cwd(), '.env.rag.local') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ASSETS_DIR = path.resolve(process.cwd(), 'rag_assets');

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.rag.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const DATE_COLUMNS = {
  court_precedents: ['decision_date'],
  terms_source_documents: ['effective_from', 'effective_to', 'collected_at'],
  terms_raw_chunks: ['effective_from', 'effective_to'],
  fss_dispute_cases: ['decision_date'],
  medical_source_documents: ['last_checked_at'],
  medical_knowledge_records: ['last_reviewed_at'],
  medical_kcd_priority_codes: ['last_reviewed_at'],
  legal_source_documents: ['effective_date'],
  legal_articles: ['effective_date'],
  rag_master_chunks: ['effective_from', 'effective_to'],
};

const TABLES = [
  'court_precedents',
  'terms_source_documents',
  'terms_raw_chunks',
  'fss_dispute_cases',
  'medical_source_documents',
  'medical_knowledge_records',
  'medical_kcd_priority_codes',
  'legal_source_documents',
  'legal_articles',
  'legal_article_targets',
  'rag_master_chunks',
];

async function getCount(table) {
  const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return count || 0;
}

function readJson(relativePath) {
  const filePath = path.join(ASSETS_DIR, relativePath);
  try {
    const parsed = require(filePath);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.data)) return parsed.data;
    if (Array.isArray(parsed.rows)) return parsed.rows;
  } catch (error) {
    console.warn(`[warn] cannot read ${relativePath}: ${error.message}`);
  }
  return [];
}

async function getEqCount(table, column, value) {
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq(column, value);

  if (error) throw new Error(`${table}.${column}=${value}: ${error.message}`);
  return count || 0;
}

async function getOrCount(table, filter) {
  const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true }).or(filter);
  if (error) throw new Error(`${table}: ${error.message}`);
  return count || 0;
}

async function getGroupedCounts(column) {
  const rows = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('rag_master_chunks')
      .select(column)
      .range(from, from + pageSize - 1);

    if (error) throw new Error(`rag_master_chunks ${column}: ${error.message}`);
    rows.push(...data);
    if (data.length < pageSize) break;
  }

  return rows.reduce((counts, row) => {
    const key = row[column] || '(null)';
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

async function getRows(table, columns) {
  const rows = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(columns.join(','))
      .range(from, from + pageSize - 1);

    if (error) throw new Error(`${table} ${columns.join(',')}: ${error.message}`);
    rows.push(...data);
    if (data.length < pageSize) break;
  }

  return rows;
}

async function countInvalidDateStrings() {
  let invalid = 0;

  for (const [table, columns] of Object.entries(DATE_COLUMNS)) {
    const rows = await getRows(table, columns);
    for (const row of rows) {
      for (const column of columns) {
        const value = row[column];
        if (value === null || value === undefined || value === '') continue;
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|T|\s)/.test(value)) {
          invalid += 1;
        }
      }
    }
  }

  return invalid;
}

async function getMasterChunkIdStats() {
  const rows = await getRows('rag_master_chunks', ['source_area', 'chunk_id']);
  const chunkIdCounts = {};
  let duplicateChunkIdCount = 0;
  let termsStandardsNullChunkIdCount = 0;

  for (const row of rows) {
    if (row.source_area === 'terms_standards' && !row.chunk_id) {
      termsStandardsNullChunkIdCount += 1;
    }

    if (!row.chunk_id) continue;
    chunkIdCounts[row.chunk_id] = (chunkIdCounts[row.chunk_id] || 0) + 1;
  }

  for (const count of Object.values(chunkIdCounts)) {
    if (count > 1) duplicateChunkIdCount += count - 1;
  }

  return {
    duplicateChunkIdCount,
    termsStandardsNullChunkIdCount,
  };
}

function printGrouped(title, counts) {
  console.log(title);
  for (const [key, count] of Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${key}: ${count}`);
  }
}

async function main() {
  console.log('Table row counts');
  for (const table of TABLES) {
    console.log(`  ${table}: ${await getCount(table)}`);
  }

  const expectedLegalSourceDocuments = readJson('legal_statutes_server_upload_v1/05_legal_statutes/legal_source_documents.json').length;
  const expectedLegalArticles = readJson('legal_statutes_server_upload_v1/05_legal_statutes/legal_articles_seed.json').length;
  const expectedLegalArticleTargets = readJson('legal_statutes_server_upload_v1/05_legal_statutes/legal_article_targets.json').length;
  const legalSourceDocumentsCount = await getCount('legal_source_documents');
  const legalArticlesCount = await getCount('legal_articles');
  const legalArticleTargetsCount = await getCount('legal_article_targets');
  const termsRawChunksCount = await getCount('terms_raw_chunks');
  const masterTermsStandardsCount = await getEqCount('rag_master_chunks', 'source_area', 'terms_standards');
  const termsCoveragePercentage = termsRawChunksCount === 0
    ? 0
    : (masterTermsStandardsCount / termsRawChunksCount) * 100;
  const masterChunkIdStats = await getMasterChunkIdStats();

  console.log('\nRAG import coverage checks');
  console.log(`  terms_raw_chunks count: ${termsRawChunksCount}`);
  console.log(`  rag_master_chunks terms_standards count: ${masterTermsStandardsCount}`);
  console.log(`  terms coverage percentage: ${termsCoveragePercentage.toFixed(2)}%`);
  console.log(`  rag_master_chunks duplicate chunk_id count: ${masterChunkIdStats.duplicateChunkIdCount}`);
  console.log(`  rag_master_chunks terms_standards null chunk_id count: ${masterChunkIdStats.termsStandardsNullChunkIdCount}`);
  console.log(`  legal_source_documents expected=${expectedLegalSourceDocuments} imported=${legalSourceDocumentsCount} missing=${Math.max(expectedLegalSourceDocuments - legalSourceDocumentsCount, 0)}`);
  console.log(`  legal_articles expected=${expectedLegalArticles} imported=${legalArticlesCount} missing=${Math.max(expectedLegalArticles - legalArticlesCount, 0)}`);
  console.log(`  legal_article_targets expected=${expectedLegalArticleTargets} imported=${legalArticleTargetsCount} missing=${Math.max(expectedLegalArticleTargets - legalArticleTargetsCount, 0)}`);
  console.log(`  invalid date string count: ${await countInvalidDateStrings()}`);

  printGrouped('\nrag_master_chunks by source_area', await getGroupedCounts('source_area'));
  printGrouped('\nrag_master_chunks by embedding_status', await getGroupedCounts('embedding_status'));

  const emptyTitle = await getOrCount('rag_master_chunks', 'title.is.null,title.eq.');
  const emptyChunkText = await getOrCount('rag_master_chunks', 'chunk_text.is.null,chunk_text.eq.');

  console.log('\nrag_master_chunks quality checks');
  console.log(`  empty title: ${emptyTitle}`);
  console.log(`  empty chunk_text: ${emptyChunkText}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
