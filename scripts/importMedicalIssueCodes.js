const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.resolve(process.cwd(), '.env.rag.local') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATA_DIR = path.resolve(process.cwd(), 'rag_medical_expansion');
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

function toMasterChunk(row) {
  const chunkText = [
    `${row.diagnosis_code} ${row.diagnosis_name}`,
    row.insurance_relevance,
    '고객 표현:',
    ...(row.common_customer_expression || []),
    '문서 표현:',
    ...(row.common_document_expression || []),
    '검사:',
    ...(row.common_tests || []),
    '주요 확인 소견:',
    ...(row.key_medical_findings || []),
    '인과관계 확인:',
    ...(row.causation_points || []),
    '고지의무 확인:',
    ...(row.disclosure_duty_points || []),
    '필요자료:',
    ...(row.required_documents || []),
    '주의:',
    row.caution_notes,
  ].filter(Boolean).join('\n');

  return {
    chunk_id: `medical_issue_code:${row.id}`,
    source_area: 'medical_issue_codes',
    source_type: 'internal_medical_issue_code',
    source_document_id: row.id,
    source_record_id: row.id,
    source_reference: row.diagnosis_code || row.id,
    title: `${row.diagnosis_code} ${row.diagnosis_name}`,
    chunk_text: chunkText,
    summary: row.insurance_relevance,
    keywords: (row.useful_search_keywords || []).join(','),
    source_url: null,
    page_no: null,
    chunk_no: null,
    effective_from: null,
    effective_to: null,
    trust_level: 'internal_review_required',
    review_status: 'needs_human_review',
    embedding_status: 'pending',
    metadata: {
      diagnosis_code: row.diagnosis_code,
      diagnosis_name: row.diagnosis_name,
      code_group: row.code_group,
      body_system: row.body_system,
      insurance_issue_category: row.insurance_issue_category,
      related_source_areas: row.related_source_areas,
      official_citation_allowed: false,
    },
  };
}

async function main() {
  const rows = readJson('medical_issue_codes_300_v1.json');
  await upsertRows('medical_issue_codes', rows, 'id');
  await upsertRows('rag_master_chunks', rows.map(toMasterChunk), 'chunk_id');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
