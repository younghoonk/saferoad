const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.resolve(process.cwd(), '.env.rag.local') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATA_DIR = path.resolve(process.cwd(), 'rag_fss_latest');

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

function duplicateTitleCount(rows) {
  const counts = countBy(rows.filter((row) => row.title), 'title');
  return Object.values(counts).reduce((total, count) => total + Math.max(count - 1, 0), 0);
}

function printCounts(title, counts) {
  console.log(title);
  for (const [key, count] of Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${key}: ${count}`);
  }
}

function printLocalChecks() {
  const targets = readJson('fss_latest_case_targets_v1.json');
  const fulltexts = readJson('fss_latest_fulltext_import_v1.json');

  console.log('Local FSS latest checks');
  console.log(`  fss_latest_case_targets: ${targets.length}`);
  printCounts('\nfetch_status counts', countBy(targets, 'fetch_status'));
  console.log(`\n  fulltext import count: ${fulltexts.length}`);
  printCounts('\nsource_status counts', countBy(targets, 'source_status'));
  console.log(`  raw_text empty fulltext rows: ${fulltexts.filter((row) => !row.raw_text).length}`);
  console.log(`  source_url empty targets: ${targets.filter((row) => !row.source_url).length}`);
  console.log(`  duplicate title count: ${duplicateTitleCount(targets)}`);
}

async function main() {
  let targets = [];
  let fulltextDisputes = [];
  let masterChunks = [];

  try {
    targets = await getRows('fss_latest_case_targets', ['id', 'title', 'source_url', 'source_status', 'fetch_status']);
    fulltextDisputes = await getRows(
      'fss_dispute_cases',
      ['record_id', 'source_type', 'source_status', 'full_text_excerpt'],
      (query) => query.eq('source_type', 'fss_latest_dispute_case'),
    );
    masterChunks = await getRows(
      'rag_master_chunks',
      ['chunk_id', 'source_type', 'source_area'],
      (query) => query.eq('source_type', 'fss_latest_dispute_case'),
    );
  } catch (error) {
    console.warn(`[warn] Supabase FSS latest tables are not ready: ${error.message}`);
    console.warn('[warn] Run the FSS latest migration/import, then rerun this check for DB counts.');
    printLocalChecks();
    return;
  }

  console.log('FSS latest DB checks');
  console.log(`  fss_latest_case_targets count: ${targets.length}`);
  printCounts('\nfetch_status counts', countBy(targets, 'fetch_status'));
  console.log(`\n  fulltext import count: ${readJson('fss_latest_fulltext_import_v1.json').length}`);
  console.log(`  fss_dispute_cases source_type=fss_latest_dispute_case count: ${fulltextDisputes.length}`);
  console.log(`  rag_master_chunks source_type=fss_latest_dispute_case count: ${masterChunks.length}`);
  printCounts('\nsource_status counts', countBy(targets, 'source_status'));
  console.log(`  raw_text empty items: ${fulltextDisputes.filter((row) => !row.full_text_excerpt).length}`);
  console.log(`  source_url empty targets: ${targets.filter((row) => !row.source_url).length}`);
  console.log(`  duplicate title count: ${duplicateTitleCount(targets)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
