const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.resolve(process.cwd(), '.env.rag.local') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATA_DIR = path.resolve(process.cwd(), 'rag_medical_expansion');

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

function duplicateDiagnosisCodeCount(rows) {
  const counts = countBy(rows.filter((row) => row.diagnosis_code), 'diagnosis_code');
  return Object.values(counts).reduce((total, count) => total + Math.max(count - 1, 0), 0);
}

function printCounts(title, counts) {
  console.log(title);
  for (const [key, count] of Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${key}: ${count}`);
  }
}

function printQuality(rows) {
  const emptyDiagnosisCode = rows.filter((row) => !row.diagnosis_code).length;
  const emptyRequiredDocuments = rows.filter((row) => !Array.isArray(row.required_documents) || row.required_documents.length === 0).length;
  const shortKeywords = rows.filter((row) => !Array.isArray(row.useful_search_keywords) || row.useful_search_keywords.length < 5).length;
  const emptyRelatedSourceAreas = rows.filter((row) => !Array.isArray(row.related_source_areas) || row.related_source_areas.length === 0).length;

  console.log('\nmedical_issue_codes quality checks');
  console.log(`  diagnosis_code empty: ${emptyDiagnosisCode}`);
  console.log(`  required_documents empty: ${emptyRequiredDocuments}`);
  console.log(`  useful_search_keywords < 5: ${shortKeywords}`);
  console.log(`  related_source_areas empty: ${emptyRelatedSourceAreas}`);
  console.log(`  duplicate diagnosis_code count: ${duplicateDiagnosisCodeCount(rows)}`);
  console.log('  note: 같은 diagnosis_code라도 insurance_issue_category가 다르면 중복 사용이 허용될 수 있다.');
}

function printLocalChecks() {
  const rows = readJson('medical_issue_codes_300_v1.json');
  console.log('Local medical issue code checks');
  console.log(`  medical_issue_codes JSON count: ${rows.length}`);
  printCounts('\nbody_system counts', countBy(rows, 'body_system'));
  printCounts('\ninsurance_issue_category counts', countBy(rows, 'insurance_issue_category'));
  printQuality(rows);
}

async function main() {
  let rows = [];
  try {
    rows = await getRows('medical_issue_codes', [
      'id',
      'diagnosis_code',
      'body_system',
      'insurance_issue_category',
      'required_documents',
      'useful_search_keywords',
      'related_source_areas',
    ]);
  } catch (error) {
    console.warn(`[warn] Supabase medical_issue_codes table is not ready: ${error.message}`);
    console.warn('[warn] Run the medical issue codes migration and import, then rerun this check for DB counts.');
    printLocalChecks();
    return;
  }

  console.log('Medical issue code table counts');
  console.log(`  medical_issue_codes: ${rows.length}`);
  console.log(`  rag_master_chunks medical_issue_codes: ${await getEqCount('rag_master_chunks', 'source_area', 'medical_issue_codes')}`);
  printCounts('\nbody_system counts', countBy(rows, 'body_system'));
  printCounts('\ninsurance_issue_category counts', countBy(rows, 'insurance_issue_category'));
  printQuality(rows);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
