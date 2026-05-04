const fs = require('fs');
const path = require('path');

const EVAL_DIR = path.resolve(process.cwd(), 'rag_eval');
const JSON_PATH = path.join(EVAL_DIR, 'rag_test_questions_100.json');
const CSV_PATH = path.join(EVAL_DIR, 'rag_test_questions_100.csv');

const VALID_SOURCE_AREAS = new Set([
  'fss_dispute_cases',
  'legal_statutes',
  'medical_knowledge',
  'precedents',
  'terms_standards',
]);
const VALID_DIFFICULTIES = new Set(['easy', 'medium', 'hard']);
const VALID_PRIORITIES = new Set(['high', 'medium', 'low']);

function fail(message) {
  console.error(`[fail] ${message}`);
  process.exitCode = 1;
}

function parseCsvRows(csv) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(field);
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      field = '';
      continue;
    }

    field += char;
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.some((value) => value !== '')) rows.push(row);
  }

  return rows;
}

function increment(counts, key) {
  counts[key] = (counts[key] || 0) + 1;
}

function printCounts(title, counts) {
  console.log(title);
  for (const [key, count] of Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${key}: ${count}`);
  }
}

function main() {
  if (!fs.existsSync(JSON_PATH)) fail(`JSON file not found: ${JSON_PATH}`);
  if (!fs.existsSync(CSV_PATH)) fail(`CSV file not found: ${CSV_PATH}`);
  if (process.exitCode) return;

  const questions = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  if (!Array.isArray(questions)) fail('JSON root must be an array');
  if (questions.length !== 100) fail(`JSON row count must be 100, got ${questions.length}`);

  const ids = new Set();
  const categoryCounts = {};
  const sourceAreaCounts = {};
  const shortKeywordIds = [];
  const emptyTextIds = [];

  for (const item of questions) {
    if (!item.id || ids.has(item.id)) fail(`duplicate or empty id: ${item.id || '(empty)'}`);
    ids.add(item.id);

    if (!item.question || !item.scenario) emptyTextIds.push(item.id);
    if (!VALID_DIFFICULTIES.has(item.difficulty)) fail(`${item.id} has invalid difficulty: ${item.difficulty}`);
    if (!VALID_PRIORITIES.has(item.priority)) fail(`${item.id} has invalid priority: ${item.priority}`);

    if (!Array.isArray(item.expected_source_areas) || item.expected_source_areas.length === 0) {
      fail(`${item.id} expected_source_areas must contain at least one source area`);
    } else {
      for (const sourceArea of item.expected_source_areas) {
        if (!VALID_SOURCE_AREAS.has(sourceArea)) fail(`${item.id} has invalid source_area: ${sourceArea}`);
        increment(sourceAreaCounts, sourceArea);
      }
    }

    if (!Array.isArray(item.expected_keywords) || item.expected_keywords.length < 5) {
      shortKeywordIds.push(item.id);
    }

    increment(categoryCounts, item.category || '(empty)');
  }

  const csvRows = parseCsvRows(fs.readFileSync(CSV_PATH, 'utf8'));
  const csvDataCount = Math.max(csvRows.length - 1, 0);
  if (csvDataCount !== questions.length) {
    fail(`CSV and JSON row count mismatch: csv=${csvDataCount}, json=${questions.length}`);
  }

  printCounts('Category counts', categoryCounts);
  printCounts('\nexpected_source_areas counts', sourceAreaCounts);

  console.log('\nDataset quality checks');
  console.log(`  total questions: ${questions.length}`);
  console.log(`  duplicate ids: ${questions.length - ids.size}`);
  console.log(`  CSV rows: ${csvDataCount}`);
  console.log(`  expected_keywords < 5: ${shortKeywordIds.length}${shortKeywordIds.length ? ` (${shortKeywordIds.join(', ')})` : ''}`);
  console.log(`  empty question/scenario: ${emptyTextIds.length}${emptyTextIds.length ? ` (${emptyTextIds.join(', ')})` : ''}`);

  if (!process.exitCode) {
    console.log('\n[ok] RAG eval dataset checks passed');
  }
}

main();
