const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.resolve(process.cwd(), '.env.rag.local') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ENRICHMENT_DIR = path.resolve(process.cwd(), 'rag_enrichment');

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.rag.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function readJson(fileName) {
  const filePath = path.join(ENRICHMENT_DIR, fileName);
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function getCount(table) {
  const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return count || 0;
}

async function getEqCount(table, column, value) {
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq(column, value);

  if (error) throw new Error(`${table}.${column}=${value}: ${error.message}`);
  return count || 0;
}

async function getRows(table, columns) {
  const rows = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(columns.join(','))
      .range(from, from + pageSize - 1);

    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < pageSize) break;
  }

  return rows;
}

function countBy(rows, column) {
  return rows.reduce((counts, row) => {
    const key = row[column] || '(empty)';
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function printCounts(title, counts) {
  console.log(title);
  for (const [key, count] of Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${key}: ${count}`);
  }
}

function printLocalQualityChecks() {
  const playbooks = readJson('priority_issue_playbooks_v1.json');
  const aliases = readJson('rag_keyword_aliases_v1.json');
  const emptyRequiredDocuments = playbooks.filter((row) => !Array.isArray(row.required_documents) || row.required_documents.length === 0);
  const shortKeywords = playbooks.filter((row) => !Array.isArray(row.useful_search_keywords) || row.useful_search_keywords.length < 5);
  const emptySourceAreas = playbooks.filter((row) => !Array.isArray(row.expected_source_areas) || row.expected_source_areas.length === 0);

  console.log('\nLocal enrichment quality checks');
  console.log(`  priority_issue_playbooks JSON count: ${playbooks.length}`);
  console.log(`  rag_keyword_aliases JSON count: ${aliases.length}`);
  printCounts('  local playbook category counts', countBy(playbooks, 'category'));
  printCounts('  local keyword alias domain counts', countBy(aliases, 'domain'));
  console.log(`  required_documents empty: ${emptyRequiredDocuments.length}${emptyRequiredDocuments.length ? ` (${emptyRequiredDocuments.map((row) => row.id).join(', ')})` : ''}`);
  console.log(`  useful_search_keywords < 5: ${shortKeywords.length}${shortKeywords.length ? ` (${shortKeywords.map((row) => row.id).join(', ')})` : ''}`);
  console.log(`  expected_source_areas empty: ${emptySourceAreas.length}${emptySourceAreas.length ? ` (${emptySourceAreas.map((row) => row.id).join(', ')})` : ''}`);
}

async function main() {
  let playbooks = [];
  let aliases = [];

  try {
    playbooks = await getRows('priority_issue_playbooks', ['id', 'category', 'required_documents', 'useful_search_keywords', 'expected_source_areas']);
    aliases = await getRows('rag_keyword_aliases', ['id', 'domain']);
  } catch (error) {
    console.warn(`[warn] Supabase enrichment tables are not ready: ${error.message}`);
    console.warn('[warn] Run the enrichment migration and import, then rerun this check for DB counts.');
    printLocalQualityChecks();
    return;
  }

  console.log('RAG enrichment table counts');
  console.log(`  priority_issue_playbooks: ${await getCount('priority_issue_playbooks')}`);
  console.log(`  rag_keyword_aliases: ${await getCount('rag_keyword_aliases')}`);
  console.log(`  rag_master_chunks issue_playbooks: ${await getEqCount('rag_master_chunks', 'source_area', 'issue_playbooks')}`);

  printCounts('\npriority_issue_playbooks by category', countBy(playbooks, 'category'));
  printCounts('\nrag_keyword_aliases by domain', countBy(aliases, 'domain'));

  const emptyRequiredDocuments = playbooks.filter((row) => !Array.isArray(row.required_documents) || row.required_documents.length === 0);
  const shortKeywords = playbooks.filter((row) => !Array.isArray(row.useful_search_keywords) || row.useful_search_keywords.length < 5);
  const emptySourceAreas = playbooks.filter((row) => !Array.isArray(row.expected_source_areas) || row.expected_source_areas.length === 0);

  console.log('\nImported enrichment quality checks');
  console.log(`  required_documents empty: ${emptyRequiredDocuments.length}${emptyRequiredDocuments.length ? ` (${emptyRequiredDocuments.map((row) => row.id).join(', ')})` : ''}`);
  console.log(`  useful_search_keywords < 5: ${shortKeywords.length}${shortKeywords.length ? ` (${shortKeywords.map((row) => row.id).join(', ')})` : ''}`);
  console.log(`  expected_source_areas empty: ${emptySourceAreas.length}${emptySourceAreas.length ? ` (${emptySourceAreas.map((row) => row.id).join(', ')})` : ''}`);

  printLocalQualityChecks();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
