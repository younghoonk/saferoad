const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.resolve(process.cwd(), '.env.rag.local') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATA_DIR = path.resolve(process.cwd(), 'rag_search_feedback');
const BATCH_SIZE = Number(process.env.RAG_IMPORT_BATCH_SIZE || 100);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.rag.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function readJson(fileName) {
  const filePath = path.join(DATA_DIR, fileName);
  if (!fs.existsSync(filePath)) throw new Error(`${filePath} not found`);
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error(`${fileName} must be an array`);
  return parsed;
}

async function insertRows(table, rows) {
  let success = 0;
  let failed = 0;

  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    const batch = rows.slice(index, index + BATCH_SIZE);
    const { error } = await supabase.from(table).insert(batch);

    if (!error) {
      success += batch.length;
      continue;
    }

    console.error(`[batch failed] ${table} rows ${index + 1}-${index + batch.length}: ${error.message}`);
    for (const row of batch) {
      const { error: rowError } = await supabase.from(table).insert(row);
      if (rowError) {
        failed += 1;
        console.error(`[row failed] ${table}: ${rowError.message}`);
      } else {
        success += 1;
      }
    }
  }

  console.log(`[import] ${table}: success=${success} failed=${failed}`);
}

function validateSamples(samples) {
  const unsafe = samples.filter((row) => /(\d{6}-\d{7}|\d{2,3}-\d{3,4}-\d{4})/.test(`${row.input_text || ''} ${row.feedback_text || ''}`));
  if (unsafe.length > 0) {
    throw new Error(`Sample data contains possible personal identifiers: ${unsafe.map((row) => row.id).join(', ')}`);
  }
}

async function main() {
  const samples = readJson('rag_search_failure_samples_v1.json');
  validateSamples(samples);

  const searchLogs = samples.map((row) => ({
    user_id: null,
    case_id: null,
    feature_name: row.feature_name,
    input_text: row.input_text,
    generated_query: row.generated_query,
    diagnosis_codes: row.diagnosis_codes || [],
    issue_types: row.issue_types || [],
    source_area_filters: row.source_area_filters || [],
    returned_chunk_ids: row.returned_chunk_ids || [],
    returned_count: row.returned_count,
    max_similarity: row.max_similarity,
    source_area_counts: row.source_area_counts || {},
    search_status: row.search_status,
    error_message: row.error_message || null,
  }));

  const { data: insertedLogs, error } = await supabase
    .from('rag_search_logs')
    .insert(searchLogs)
    .select('id');

  if (error) throw new Error(`rag_search_logs insert failed: ${error.message}`);
  console.log(`[import] rag_search_logs: success=${insertedLogs.length} failed=0`);

  const feedbackRows = samples.map((row, index) => ({
    search_log_id: insertedLogs[index].id,
    feedback_type: row.feedback_type,
    rating: row.rating,
    feedback_text: row.feedback_text,
    missing_keywords: row.missing_keywords || [],
    missing_source_areas: row.missing_source_areas || [],
    wrong_chunk_ids: row.wrong_chunk_ids || [],
    useful_chunk_ids: row.useful_chunk_ids || [],
    reviewer_role: row.reviewer_role || 'adjuster',
  }));

  const { data: insertedFeedback, error: feedbackError } = await supabase
    .from('rag_search_feedback')
    .insert(feedbackRows)
    .select('id');

  if (feedbackError) throw new Error(`rag_search_feedback insert failed: ${feedbackError.message}`);
  console.log(`[import] rag_search_feedback: success=${insertedFeedback.length} failed=0`);

  const taskRows = samples.map((row, index) => ({
    search_log_id: insertedLogs[index].id,
    feedback_id: insertedFeedback[index].id,
    task_type: row.task_type,
    priority: row.priority,
    status: row.status || 'open',
    issue_summary: row.issue_summary,
    recommended_action: row.recommended_action,
    related_query: row.generated_query,
    related_diagnosis_codes: row.diagnosis_codes || [],
    related_issue_types: row.issue_types || [],
    related_source_areas: row.missing_source_areas || row.source_area_filters || [],
    assigned_to: null,
    resolved_at: null,
  }));

  await insertRows('rag_search_improvement_tasks', taskRows);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
