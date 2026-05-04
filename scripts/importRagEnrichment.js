const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.resolve(process.cwd(), '.env.rag.local') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ENRICHMENT_DIR = path.resolve(process.cwd(), 'rag_enrichment');
const BATCH_SIZE = Number(process.env.RAG_IMPORT_BATCH_SIZE || 100);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.rag.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function readJson(fileName) {
  const filePath = path.join(ENRICHMENT_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`${filePath} not found`);
  }

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

function playbookToMasterChunk(row) {
  const chunkText = [
    row.title,
    row.scenario_summary,
    '핵심 보험사 주장:',
    ...(row.key_arguments || []),
    '반박 및 검토 포인트:',
    ...(row.counter_arguments || []),
    '필요자료:',
    ...(row.required_documents || []),
    '주의:',
    row.caution_notes,
  ].filter(Boolean).join('\n');

  return {
    chunk_id: `issue_playbook:${row.id}`,
    source_area: 'issue_playbooks',
    source_type: 'internal_issue_playbook',
    source_document_id: row.id,
    source_record_id: row.id,
    source_reference: row.id,
    title: row.title,
    chunk_text: chunkText,
    summary: row.scenario_summary,
    keywords: (row.useful_search_keywords || []).join(','),
    source_url: null,
    page_no: null,
    chunk_no: null,
    effective_from: null,
    effective_to: null,
    trust_level: 'internal_playbook',
    review_status: 'needs_human_review',
    embedding_status: 'pending',
    metadata: {
      category: row.category,
      sub_category: row.sub_category,
      issue_type: row.issue_type,
      expected_source_areas: row.expected_source_areas,
      caution_notes: row.caution_notes,
      official_citation_allowed: false,
    },
  };
}

async function main() {
  const playbooks = readJson('priority_issue_playbooks_v1.json');
  const aliases = readJson('rag_keyword_aliases_v1.json');

  await upsertRows('priority_issue_playbooks', playbooks, 'id');
  await upsertRows('rag_keyword_aliases', aliases, 'id');
  await upsertRows('rag_master_chunks', playbooks.map(playbookToMasterChunk), 'chunk_id');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
