const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.resolve(process.cwd(), '.env.rag.local') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATA_DIR = path.resolve(process.cwd(), 'rag_precedents');

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

async function getRows(table, columns, builder = null) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let query = supabase.from(table).select(columns.join(',')).range(from, from + pageSize - 1);
    if (builder) query = builder(query);
    const { data, error } = await query;
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

function duplicateCount(rows, column) {
  const counts = countBy(rows.filter((row) => row[column]), column);
  return Object.values(counts).reduce((total, count) => total + Math.max(count - 1, 0), 0);
}

function printCounts(title, counts) {
  console.log(title);
  for (const [key, count] of Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${key}: ${count}`);
  }
}

function printLocalChecks() {
  const targets = readJson('precedent_search_targets_v1.json');
  const imports = readJson('precedent_fulltext_import_v1.json');
  console.log('Local precedent checks');
  console.log(`  precedent_search_targets count: ${targets.length}`);
  printCounts('\nfetch_status counts', countBy(targets, 'fetch_status'));
  console.log(`\n  precedent_fulltext_import_v1.json count: ${imports.length}`);
  printCounts('\ncategory imported counts', countBy(imports, 'category'));
  printCounts('\nsource_status counts', countBy(imports, 'source_status'));
  console.log(`  raw_text empty: ${imports.filter((row) => !row.raw_text).length}`);
  console.log(`  case_number empty: ${imports.filter((row) => !row.case_number).length}`);
  console.log(`  duplicate precedent_id count: ${duplicateCount(imports, 'precedent_id')}`);
  console.log(`  duplicate case_number count: ${duplicateCount(imports, 'case_number')}`);
}

async function main() {
  let targets = [];
  let courtRows = [];
  let masterRows = [];
  try {
    targets = await getRows('precedent_search_targets', ['id', 'category', 'fetch_status']);
    courtRows = await getRows(
      'court_precedents',
      ['record_id', 'source_type', 'precedent_categories', 'source_status', 'full_text_excerpt', 'case_number'],
      (query) => query.eq('source_type', 'court_precedent_fulltext'),
    );
    masterRows = await getRows(
      'rag_master_chunks',
      ['chunk_id', 'source_type'],
      (query) => query.eq('source_type', 'court_precedent_fulltext'),
    );
  } catch (error) {
    console.warn(`[warn] Supabase precedent tracking tables are not ready: ${error.message}`);
    console.warn('[warn] Run the precedent migration/import, then rerun this check for DB counts.');
    printLocalChecks();
    return;
  }

  console.log('Precedent DB checks');
  console.log(`  precedent_search_targets count: ${targets.length}`);
  printCounts('\nfetch_status counts', countBy(targets, 'fetch_status'));
  console.log(`\n  precedent_fulltext_import_v1.json count: ${readJson('precedent_fulltext_import_v1.json').length}`);
  console.log(`  court_precedents source_type=court_precedent_fulltext count: ${courtRows.length}`);
  console.log(`  rag_master_chunks source_type=court_precedent_fulltext count: ${masterRows.length}`);
  printCounts('\ncategory imported counts', countBy(courtRows, 'precedent_categories'));
  printCounts('\nsource_status counts', countBy(courtRows, 'source_status'));
  console.log(`  raw_text empty: ${courtRows.filter((row) => !row.full_text_excerpt).length}`);
  console.log(`  case_number empty: ${courtRows.filter((row) => !row.case_number).length}`);
  console.log(`  duplicate precedent_id count: ${duplicateCount(courtRows, 'record_id')}`);
  console.log(`  duplicate case_number count: ${duplicateCount(courtRows, 'case_number')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
