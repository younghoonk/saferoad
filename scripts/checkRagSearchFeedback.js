const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.resolve(process.cwd(), '.env.rag.local') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATA_DIR = path.resolve(process.cwd(), 'rag_search_feedback');

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

const SENSITIVE_PATTERNS = [
  {
    type: 'resident_registration_number',
    pattern: /\b\d{6}-[1-4]\d{6}\b/g,
  },
  {
    type: 'phone_number',
    pattern: /\b(?:01[016789]|02|0[3-6][1-5])[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g,
  },
  {
    type: 'email',
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  },
  {
    type: 'bank_account_candidate',
    pattern: /\b\d{2,6}[-\s]\d{2,6}[-\s]\d{2,8}(?:[-\s]\d{1,4})?\b/g,
  },
];

const FALSE_POSITIVE_PATTERNS = [
  { type: 'diagnosis_code', pattern: /\b[A-Z]\d{2}(?:\.\d{1,3})?\b/g },
  { type: 'date', pattern: /\b\d{4}[.-]\d{1,2}[.-]\d{1,2}\b/g },
  { type: 'sample_or_case_code', pattern: /\b(?:RQ|RSF|RCP|RCD|MIC|PIP|RKA|PST|FSS|PREC)[-_]?\d{3,6}\b/gi },
  { type: 'chunk_reference', pattern: /\b(?:medical_issue_code|real_case_pattern|real_case_document|issue_playbook|precedent|fss_latest):[A-Z0-9:_-]+\b/gi },
  { type: 'uuid', pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi },
];

function maskValue(value) {
  const text = String(value);
  if (text.length <= 4) return `${text.slice(0, 1)}****`;
  if (text.length <= 8) return `${text.slice(0, 2)}****${text.slice(-2)}`;
  return `${text.slice(0, 3)}****${text.slice(-3)}`;
}

function flattenRow(row, prefix = '') {
  const fields = [];

  for (const [key, value] of Object.entries(row)) {
    const fieldName = prefix ? `${prefix}.${key}` : key;
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      value.forEach((item, index) => fields.push({ field: `${fieldName}[${index}]`, value: item }));
      continue;
    }
    if (typeof value === 'object') {
      fields.push(...flattenRow(value, fieldName));
      continue;
    }
    fields.push({ field: fieldName, value });
  }

  return fields;
}

function isKnownFalsePositive(value) {
  const text = String(value);
  return FALSE_POSITIVE_PATTERNS.some(({ pattern }) => {
    pattern.lastIndex = 0;
    const matches = text.match(pattern);
    return matches && matches.some((match) => match === text || text.includes(match));
  });
}

function findPatternMatches(table, rows) {
  const sensitive = [];
  const falsePositive = [];

  for (const row of rows) {
    for (const { field, value } of flattenRow(row)) {
      const text = String(value);
      const rowId = row.id || '(no id)';

      for (const { type, pattern } of FALSE_POSITIVE_PATTERNS) {
        pattern.lastIndex = 0;
        const matches = text.match(pattern) || [];
        for (const match of matches) {
          falsePositive.push({ table, rowId, field, type, value: match });
        }
      }

      for (const { type, pattern } of SENSITIVE_PATTERNS) {
        pattern.lastIndex = 0;
        const matches = text.match(pattern) || [];
        for (const match of matches) {
          if (isKnownFalsePositive(match)) {
            falsePositive.push({ table, rowId, field, type: `false_positive_${type}`, value: match });
          } else {
            sensitive.push({ table, rowId, field, type, masked: maskValue(match) });
          }
        }
      }
    }
  }

  return { sensitive, falsePositive };
}

function printPersonalDataScan(title, tableRows) {
  const allSensitive = [];
  const allFalsePositive = [];

  for (const { table, rows } of tableRows) {
    const result = findPatternMatches(table, rows);
    allSensitive.push(...result.sensitive);
    allFalsePositive.push(...result.falsePositive);
  }

  console.log(`\n${title}`);
  console.log(`  possible personal data pattern count: ${allSensitive.length}`);
  console.log(`  false_positive_count: ${allFalsePositive.length}`);

  if (allSensitive.length > 0) {
    console.warn('  [warn] possible personal data patterns found');
    for (const match of allSensitive.slice(0, 20)) {
      console.warn(`    table=${match.table} row=${match.rowId} field=${match.field} type=${match.type} value=${match.masked}`);
    }
  }

  if (allFalsePositive.length > 0) {
    console.log('  false positive examples');
    for (const match of allFalsePositive.slice(0, 10)) {
      console.log(`    table=${match.table} row=${match.rowId} field=${match.field} type=${match.type} value=${match.value}`);
    }
  }
}

function printLocalChecks() {
  const samples = readJson('rag_search_failure_samples_v1.json');

  console.log('Local RAG search feedback checks');
  console.log(`  sample logs: ${samples.length}`);
  console.log(`  sample feedback: ${samples.length}`);
  console.log(`  sample improvement tasks: ${samples.length}`);
  printCounts('\nsearch_status counts', countBy(samples, 'search_status'));
  printCounts('\nfeedback_type counts', countBy(samples, 'feedback_type'));
  printCounts('\ntask_type counts', countBy(samples, 'task_type'));
  printCounts('\npriority counts', countBy(samples, 'priority'));
  console.log(`  open task count: ${samples.filter((row) => (row.status || 'open') === 'open').length}`);
  console.log(`  input_text empty: ${samples.filter((row) => !row.input_text).length}`);
  console.log(`  generated_query empty: ${samples.filter((row) => !row.generated_query).length}`);
  printPersonalDataScan('local personal data scan', [{ table: 'rag_search_failure_samples_v1.json', rows: samples }]);
}

async function main() {
  let logs = [];
  let feedback = [];
  let tasks = [];

  try {
    logs = await getRows('rag_search_logs', [
      'id',
      'feature_name',
      'input_text',
      'generated_query',
      'diagnosis_codes',
      'issue_types',
      'source_area_filters',
      'returned_chunk_ids',
      'search_status',
      'error_message',
    ]);
    feedback = await getRows('rag_search_feedback', [
      'id',
      'feedback_type',
      'rating',
      'feedback_text',
      'missing_keywords',
      'missing_source_areas',
      'wrong_chunk_ids',
      'useful_chunk_ids',
      'reviewer_role',
    ]);
    tasks = await getRows('rag_search_improvement_tasks', [
      'id',
      'task_type',
      'priority',
      'status',
      'issue_summary',
      'recommended_action',
      'related_query',
      'related_diagnosis_codes',
      'related_issue_types',
      'related_source_areas',
    ]);
  } catch (error) {
    console.warn(`[warn] Supabase RAG search feedback tables are not ready: ${error.message}`);
    console.warn('[warn] Run the feedback migration/import, then rerun this check for DB counts.');
    printLocalChecks();
    return;
  }

  console.log('RAG search feedback table counts');
  console.log(`  rag_search_logs: ${logs.length}`);
  console.log(`  rag_search_feedback: ${feedback.length}`);
  console.log(`  rag_search_improvement_tasks: ${tasks.length}`);
  printCounts('\nsearch_status counts', countBy(logs, 'search_status'));
  printCounts('\nfeedback_type counts', countBy(feedback, 'feedback_type'));
  printCounts('\ntask_type counts', countBy(tasks, 'task_type'));
  printCounts('\npriority counts', countBy(tasks, 'priority'));
  console.log(`  open task count: ${tasks.filter((row) => row.status === 'open').length}`);
  console.log(`  input_text empty: ${logs.filter((row) => !row.input_text).length}`);
  console.log(`  generated_query empty: ${logs.filter((row) => !row.generated_query).length}`);
  printPersonalDataScan('DB personal data scan', [
    { table: 'rag_search_logs', rows: logs },
    { table: 'rag_search_feedback', rows: feedback },
    { table: 'rag_search_improvement_tasks', rows: tasks },
  ]);

  printLocalChecks();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
