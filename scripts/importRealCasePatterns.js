const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.resolve(process.cwd(), '.env.rag.local') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATA_DIR = path.resolve(process.cwd(), 'rag_real_cases');
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

async function upsertRows(table, rows, onConflict) {
  let success = 0;
  let failed = 0;

  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    const batch = rows.slice(index, index + BATCH_SIZE);
    const { error } = await supabase.from(table).upsert(batch, { onConflict });

    if (!error) {
      success += batch.length;
      continue;
    }

    console.error(`[batch failed] ${table} rows ${index + 1}-${index + batch.length}: ${error.message}`);
    for (const row of batch) {
      const { error: rowError } = await supabase.from(table).upsert(row, { onConflict });
      if (rowError) {
        failed += 1;
        console.error(`[row failed] ${table} ${row.id || row.chunk_id}: ${rowError.message}`);
      } else {
        success += 1;
      }
    }
  }

  console.log(`[import] ${table}: success=${success} failed=${failed}`);
}

function assertSafeRows(rows, table) {
  const unsafeRows = rows.filter((row) => row.contains_personal_data === true || row.contains_sensitive_data === true);
  if (unsafeRows.length > 0) {
    console.warn(`[skip] ${table}: ${unsafeRows.length} rows contain personal or sensitive data flags`);
  }
  return rows.filter((row) => row.contains_personal_data !== true && row.contains_sensitive_data !== true);
}

function patternToMasterChunk(row) {
  const chunkText = [
    row.case_pattern_code,
    row.insurer_position_summary,
    row.customer_position_summary,
    row.adjuster_strategy_summary,
    'rebuttal_points:',
    ...(row.rebuttal_points || []),
    'required_documents:',
    ...(row.required_documents || []),
    'outcome:',
    row.outcome_summary,
  ].filter(Boolean).join('\n');

  return {
    chunk_id: `real_case_pattern:${row.id}`,
    source_area: 'real_case_patterns',
    source_type: 'anonymized_real_case_pattern',
    source_document_id: row.id,
    source_record_id: row.id,
    source_reference: row.case_pattern_code || row.id,
    title: `${row.dispute_category} - ${row.case_pattern_code}`,
    chunk_text: chunkText,
    summary: row.adjuster_strategy_summary,
    keywords: (row.useful_search_keywords || []).join(','),
    source_url: null,
    page_no: null,
    chunk_no: null,
    effective_from: null,
    effective_to: null,
    trust_level: 'internal_case_pattern',
    review_status: 'needs_human_review',
    embedding_status: 'pending',
    metadata: {
      insurance_type: row.insurance_type,
      insurer_name: row.insurer_name,
      claim_type: row.claim_type,
      accident_type: row.accident_type,
      diagnosis_code: row.diagnosis_code,
      dispute_category: row.dispute_category,
      outcome_type: row.outcome_type,
      anonymization_status: row.anonymization_status,
      official_citation_allowed: false,
    },
  };
}

function documentToMasterChunk(row) {
  const chunkText = [
    row.document_summary,
    'issue_points:',
    ...(row.extracted_issue_points || []),
    'medical_points:',
    ...(row.extracted_medical_points || []),
    'policy_points:',
    ...(row.extracted_policy_points || []),
    'legal_points:',
    ...(row.extracted_legal_points || []),
  ].filter(Boolean).join('\n');

  return {
    chunk_id: `real_case_document:${row.id}`,
    source_area: 'real_case_documents',
    source_type: 'anonymized_document_summary',
    source_document_id: row.case_pattern_id,
    source_record_id: row.id,
    source_reference: `${row.case_pattern_id}:${row.document_type}`,
    title: `${row.case_pattern_id} ${row.document_type}`,
    chunk_text: chunkText,
    summary: row.document_summary,
    keywords: [
      row.document_type,
      ...(row.extracted_issue_points || []),
      ...(row.extracted_medical_points || []),
      ...(row.extracted_policy_points || []),
      ...(row.extracted_legal_points || []),
    ].filter(Boolean).join(','),
    source_url: null,
    page_no: null,
    chunk_no: null,
    effective_from: null,
    effective_to: null,
    trust_level: 'internal_case_pattern',
    review_status: 'needs_human_review',
    embedding_status: 'pending',
    metadata: {
      case_pattern_id: row.case_pattern_id,
      document_type: row.document_type,
      pii_removed: row.pii_removed,
      sensitive_info_minimized: row.sensitive_info_minimized,
      official_citation_allowed: false,
    },
  };
}

async function main() {
  const patterns = assertSafeRows(readJson('real_case_patterns_sample_v1.json'), 'real_case_patterns');
  const documents = readJson('real_case_document_summaries_sample_v1.json').filter((row) => {
    if (row.pii_removed !== true || row.sensitive_info_minimized !== true) {
      console.warn(`[skip] real_case_document_summaries ${row.id}: pii_removed/sensitive_info_minimized flags are not safe`);
      return false;
    }
    return true;
  });

  await upsertRows('real_case_patterns', patterns, 'id');
  await upsertRows('real_case_document_summaries', documents, 'id');
  await upsertRows('rag_master_chunks', patterns.map(patternToMasterChunk), 'chunk_id');
  await upsertRows('rag_master_chunks', documents.map(documentToMasterChunk), 'chunk_id');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
