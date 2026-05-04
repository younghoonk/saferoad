const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.resolve(process.cwd(), '.env.rag.local') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATA_DIR = path.resolve(process.cwd(), 'rag_real_cases');

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.rag.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function readJson(fileName) {
  const filePath = path.join(DATA_DIR, fileName);
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

async function getEqCount(table, column, value) {
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq(column, value);

  if (error) throw new Error(`${table}.${column}=${value}: ${error.message}`);
  return count || 0;
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

function printQuality(patterns, documents, rules) {
  const personalData = patterns.filter((row) => row.contains_personal_data === true).length;
  const sensitiveData = patterns.filter((row) => row.contains_sensitive_data === true).length;
  const emptyRequiredDocuments = patterns.filter((row) => !Array.isArray(row.required_documents) || row.required_documents.length === 0).length;
  const shortKeywords = patterns.filter((row) => !Array.isArray(row.useful_search_keywords) || row.useful_search_keywords.length < 5).length;
  const unsafeDocuments = documents.filter((row) => row.pii_removed !== true || row.sensitive_info_minimized !== true).length;

  console.log('\nreal case quality checks');
  console.log(`  contains_personal_data=true: ${personalData}`);
  console.log(`  contains_sensitive_data=true: ${sensitiveData}`);
  console.log(`  required_documents empty: ${emptyRequiredDocuments}`);
  console.log(`  useful_search_keywords < 5: ${shortKeywords}`);
  console.log(`  unsafe document summaries: ${unsafeDocuments}`);
  console.log(`  anonymization_rules count: ${rules.length}`);
}

function printLocalChecks() {
  const patterns = readJson('real_case_patterns_sample_v1.json');
  const documents = readJson('real_case_document_summaries_sample_v1.json');
  const rules = readJson('anonymization_rules_v1.json');

  console.log('Local real case pattern checks');
  console.log(`  real_case_patterns sample count: ${patterns.length}`);
  console.log(`  real_case_document_summaries sample count: ${documents.length}`);
  printCounts('\noutcome_type counts', countBy(patterns, 'outcome_type'));
  printCounts('\ndispute_category counts', countBy(patterns, 'dispute_category'));
  printQuality(patterns, documents, rules);
}

async function main() {
  let patterns = [];
  let documents = [];

  try {
    patterns = await getRows('real_case_patterns', [
      'id',
      'dispute_category',
      'outcome_type',
      'required_documents',
      'useful_search_keywords',
      'contains_personal_data',
      'contains_sensitive_data',
    ]);
    documents = await getRows('real_case_document_summaries', [
      'id',
      'pii_removed',
      'sensitive_info_minimized',
    ]);
  } catch (error) {
    console.warn(`[warn] Supabase real case tables are not ready: ${error.message}`);
    console.warn('[warn] Run the real case migration/import, then rerun this check for DB counts.');
    printLocalChecks();
    return;
  }

  console.log('Real case pattern table counts');
  console.log(`  real_case_patterns: ${patterns.length}`);
  console.log(`  real_case_document_summaries: ${documents.length}`);
  console.log(`  rag_master_chunks real_case_patterns: ${await getEqCount('rag_master_chunks', 'source_area', 'real_case_patterns')}`);
  console.log(`  rag_master_chunks real_case_documents: ${await getEqCount('rag_master_chunks', 'source_area', 'real_case_documents')}`);
  printCounts('\noutcome_type counts', countBy(patterns, 'outcome_type'));
  printCounts('\ndispute_category counts', countBy(patterns, 'dispute_category'));
  printQuality(patterns, documents, readJson('anonymization_rules_v1.json'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
