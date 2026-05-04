const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.resolve(process.cwd(), '.env.rag.local') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATA_DIR = path.resolve(process.cwd(), 'rag_precedents');
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
    category: row.category,
    sub_category: row.sub_category,
    query: row.query,
    search_scope: row.search_scope,
    expected_issue_types: row.expected_issue_types || [],
    expected_source_keywords: row.expected_source_keywords || [],
    fetch_status: row.fetch_status,
    source_status: row.source_status,
    fetched_count: row.fetched_count || 0,
    imported_count: row.imported_count || 0,
    notes: row.notes,
  };
}

function toCourtPrecedent(row) {
  return {
    record_id: row.precedent_id || row.id,
    source_type: 'court_precedent_fulltext',
    title: row.title || row.case_name || row.case_number || row.id,
    case_number: row.case_number,
    court_or_agency: row.court,
    decision_date: sanitizeDate(row.decision_date),
    precedent_categories: row.category,
    insurance_type: null,
    accident_type: row.issue_type,
    issue: row.holding,
    summary: row.reasoning_summary,
    key_points: row.reasoning_summary,
    outcome: null,
    conclusion: row.holding,
    keywords: Array.isArray(row.keywords) ? row.keywords.join(',') : row.keywords,
    source_url: row.source_url,
    source_reference: row.precedent_id,
    source_status: row.source_status,
    full_text_excerpt: row.raw_text || row.reasoning_summary || row.holding,
    metadata: row,
  };
}

function sanitizeDate(value) {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/[^\d]/g, '');
  if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return null;
}

function splitText(text, maxLength = 7000) {
  if (!text || text.length <= maxLength) return [text || ''];
  const chunks = [];
  for (let index = 0; index < text.length; index += maxLength) {
    chunks.push(text.slice(index, index + maxLength));
    if (chunks.length >= 4) break;
  }
  return chunks;
}

function toMasterChunks(row) {
  const baseText = [
    row.title,
    row.case_number,
    row.decision_date,
    row.court,
    row.holding,
    row.reasoning_summary,
    Array.isArray(row.referenced_statutes) ? row.referenced_statutes.join('\n') : row.referenced_statutes,
    row.raw_text,
  ].filter(Boolean).join('\n\n');
  const parts = splitText(baseText);
  const precedentKey = row.precedent_id || row.id;

  return parts.map((chunkText, index) => ({
    chunk_id: `precedent:${precedentKey}:part:${index + 1}`,
    source_area: 'precedents',
    source_type: 'court_precedent_fulltext',
    source_document_id: precedentKey,
    source_record_id: precedentKey,
    source_reference: precedentKey,
    title: parts.length > 1 ? `${row.title || row.case_name} part ${index + 1}` : (row.title || row.case_name || precedentKey),
    chunk_text: chunkText,
    summary: row.reasoning_summary,
    keywords: Array.isArray(row.keywords) ? row.keywords.join(',') : row.keywords,
    source_url: row.source_url,
    page_no: null,
    chunk_no: index + 1,
    effective_from: sanitizeDate(row.decision_date),
    effective_to: null,
    trust_level: 'official',
    review_status: row.raw_text ? 'full_text_imported_needs_review' : 'needs_human_review',
    embedding_status: 'pending',
    metadata: row,
  }));
}

async function main() {
  const targets = readJson('precedent_search_targets_v1.json').map(targetForDb);
  const precedents = readJson('precedent_fulltext_import_v1.json')
    .filter((row) => row.source_status === 'official_law_api_full_text' || row.source_status === 'precedent_list_only');

  if (targets.length > 0) await upsertRows('precedent_search_targets', targets, 'id');
  if (precedents.length > 0) {
    await upsertRows('court_precedents', precedents.map(toCourtPrecedent), 'record_id');
    await upsertRows('rag_master_chunks', precedents.flatMap(toMasterChunks), 'chunk_id');
  } else {
    console.log('[import] precedents: no fetched precedent rows to import');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
