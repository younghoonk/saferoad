const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.resolve(process.cwd(), '.env.rag.local') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATA_DIR = path.resolve(process.cwd(), 'rag_fss_latest');
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
  if (!fs.existsSync(filePath)) return [];
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
        console.error(`[row failed] ${table} ${row.id || row.record_id || row.chunk_id}: ${rowError.message}`);
      } else {
        success += 1;
      }
    }
  }

  console.log(`[import] ${table}: success=${success} failed=${failed}`);
}

function targetForDb(row) {
  return {
    id: row.id,
    fss_category: row.fss_category,
    insurance_type: row.insurance_type,
    coverage_type: row.coverage_type,
    title: row.title,
    source_url: row.source_url,
    source_status: row.source_status,
    fetch_status: row.fetch_status,
    fetched_at: row.fetched_at || null,
    notes: row.notes,
  };
}

function fulltextToFssDispute(row) {
  return {
    record_id: row.id,
    source_type: 'fss_latest_dispute_case',
    title: row.title,
    case_number: row.case_number,
    court_or_agency: row.court_or_agency || '금융감독원',
    decision_date: row.decision_date,
    insurance_type: row.insurance_type,
    accident_type: row.coverage_type,
    precedent_categories: null,
    issue: row.issue,
    summary: row.rag_summary,
    key_points: [
      row.facts,
      row.claimant_position,
      row.insurer_position,
      row.committee_reasoning,
      row.conclusion,
    ].filter(Boolean).join('\n\n'),
    outcome: row.result_type,
    conclusion: row.conclusion,
    keywords: Array.isArray(row.keywords) ? row.keywords.join(',') : row.keywords,
    latest_flag: true,
    published_batch: 'FSS_LATEST_FULLTEXT_V1',
    published_date: row.collected_at ? row.collected_at.slice(0, 10) : null,
    source_status: row.source_status,
    pdf_page: null,
    printed_page: null,
    source_reference: row.id,
    source_url: row.source_url,
    source_category: 'FSS latest full text',
    full_text_excerpt: row.raw_text,
    embedding_status: 'pending',
    metadata: row,
  };
}

function chunkText(row) {
  return [
    row.title,
    row.issue,
    row.facts,
    row.claimant_position,
    row.insurer_position,
    row.committee_reasoning,
    row.conclusion,
    row.raw_text,
  ].filter(Boolean).join('\n\n');
}

function fulltextToMaster(row) {
  return {
    chunk_id: `fss_latest:${row.id}`,
    source_area: 'fss_dispute_cases',
    source_type: 'fss_latest_dispute_case',
    source_document_id: row.id,
    source_record_id: row.id,
    source_reference: row.id,
    title: row.title,
    chunk_text: chunkText(row),
    summary: row.rag_summary,
    keywords: Array.isArray(row.keywords) ? row.keywords.join(',') : row.keywords,
    source_url: row.source_url,
    page_no: null,
    chunk_no: null,
    effective_from: row.decision_date || (row.collected_at ? row.collected_at.slice(0, 10) : null),
    effective_to: null,
    trust_level: 'official',
    review_status: 'full_text_imported_needs_review',
    embedding_status: 'pending',
    metadata: row,
  };
}

async function main() {
  const targets = readJson('fss_latest_case_targets_v1.json').map(targetForDb);
  const fulltexts = readJson('fss_latest_fulltext_import_v1.json')
    .filter((row) => row.source_status === 'official_fss_full_text' && row.raw_text);

  if (targets.length > 0) await upsertRows('fss_latest_case_targets', targets, 'id');
  if (fulltexts.length > 0) {
    await upsertRows('fss_dispute_cases', fulltexts.map(fulltextToFssDispute), 'record_id');
    await upsertRows('rag_master_chunks', fulltexts.map(fulltextToMaster), 'chunk_id');
  } else {
    console.log('[import] fss_latest fulltext: no verified fulltext rows to import');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
