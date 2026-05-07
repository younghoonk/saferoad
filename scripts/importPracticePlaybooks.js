const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.resolve(process.cwd(), '.env.rag.local') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATA_DIR = path.resolve(process.cwd(), 'rag_practice_playbooks');
const INPUT_FILE = process.env.PRACTICE_PLAYBOOKS_FILE || 'practice_playbooks_from_blog_44_v1.json';
const BATCH_SIZE = Number(process.env.RAG_IMPORT_BATCH_SIZE || 100);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.rag.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function readJson(fileName) {
  const filePath = path.isAbsolute(fileName) ? fileName : path.join(DATA_DIR, fileName);
  if (!fs.existsSync(filePath)) throw new Error(`${filePath} not found`);
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error(`${filePath} must be an array`);
  return parsed;
}

function asArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return value.split(/\n+|;\s*/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function text(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stableHash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sourceDomain(sourceUrl) {
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function pick(row, keys, fallback = '') {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && text(row[key])) return row[key];
  }
  return fallback;
}

function normalizeRow(row, index) {
  const title = text(pick(row, ['title', 'playbook_title', 'case_title', 'subject'], `practice playbook ${index + 1}`));
  const scenarioSummary = text(pick(row, ['scenario_summary', 'summary', 'description', 'content_summary', 'blog_summary']));
  const body = text(pick(row, ['body', 'content', 'main_text', 'raw_text', 'article_text']));
  const sourceUrl = text(pick(row, ['source_url', 'blog_url', 'url']));
  const category = text(pick(row, ['category', 'insurance_category', 'dispute_category']));
  const issueType = text(pick(row, ['issue_type', 'issue', 'claim_type']));
  const requiredDocuments = asArray(row.required_documents || row.documents || row.requiredAdditionalChecks);
  const practicePoints = asArray(row.practice_points || row.key_points || row.adjuster_points || row.check_points);
  const customerArguments = asArray(row.customer_arguments || row.customer_position || row.customer_points);
  const insurerArguments = asArray(row.insurer_arguments || row.insurer_position || row.insurer_points);
  const rebuttalPoints = asArray(row.rebuttal_points || row.counter_arguments || row.counter_points);
  const keywords = asArray(row.useful_search_keywords || row.keywords || row.search_keywords);
  const contentForHash = [
    title,
    scenarioSummary,
    body,
    ...practicePoints,
    ...customerArguments,
    ...insurerArguments,
    ...rebuttalPoints,
    ...requiredDocuments,
  ].filter(Boolean).join('\n').toLowerCase();
  const contentHash = text(row.content_hash) || stableHash(contentForHash);
  const duplicateGroupBase = text(row.duplicate_group_key) || [category, issueType, title].filter(Boolean).join(':').toLowerCase();
  const duplicateGroupKey = duplicateGroupBase ? stableHash(duplicateGroupBase) : contentHash;
  const id = text(row.id) || `practice_blog_44_${String(index + 1).padStart(3, '0')}`;

  return {
    id,
    title,
    category,
    sub_category: text(pick(row, ['sub_category', 'subcategory'])),
    issue_type: issueType,
    scenario_summary: scenarioSummary || body.slice(0, 700),
    practice_points: practicePoints,
    customer_arguments: customerArguments,
    insurer_arguments: insurerArguments,
    rebuttal_points: rebuttalPoints,
    required_documents: requiredDocuments,
    useful_search_keywords: keywords,
    source_title: text(pick(row, ['source_title', 'blog_title'], title)),
    source_url: sourceUrl || null,
    source_domain: sourceDomain(sourceUrl),
    source_area: 'practice_playbooks',
    source_type: 'internal_practice_playbook',
    trust_level: 'internal_practice_playbook',
    review_status: 'needs_human_review',
    official_citation_allowed: false,
    content_hash: contentHash,
    duplicate_group_key: duplicateGroupKey,
    raw_payload: row,
  };
}

function dedupeLocal(rows) {
  const seenContent = new Map();
  const duplicates = [];
  const unique = [];
  for (const row of rows) {
    if (seenContent.has(row.content_hash)) {
      duplicates.push({ id: row.id, duplicateOf: seenContent.get(row.content_hash), content_hash: row.content_hash });
      continue;
    }
    seenContent.set(row.content_hash, row.id);
    unique.push(row);
  }
  return { unique, duplicates };
}

async function existingValues(table, column, values) {
  const result = new Set();
  const uniqueValues = Array.from(new Set(values.filter(Boolean)));
  for (let index = 0; index < uniqueValues.length; index += BATCH_SIZE) {
    const batch = uniqueValues.slice(index, index + BATCH_SIZE);
    const { data, error } = await supabase.from(table).select(column).in(column, batch);
    if (error) throw new Error(`[select failed] ${table}.${column}: ${error.message}`);
    for (const row of data || []) result.add(row[column]);
  }
  return result;
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
        console.error(`[row failed] ${table} ${row.id || row.chunk_id}: ${rowError.message}`);
      } else {
        success += 1;
      }
    }
  }
  console.log(`[insert] ${table}: success=${success} failed=${failed}`);
}

function toMasterChunk(row) {
  const chunkText = [
    row.title,
    row.scenario_summary,
    'practice_points:',
    ...row.practice_points,
    'customer_arguments:',
    ...row.customer_arguments,
    'insurer_arguments:',
    ...row.insurer_arguments,
    'rebuttal_points:',
    ...row.rebuttal_points,
    'required_documents:',
    ...row.required_documents,
  ].filter(Boolean).join('\n');

  return {
    chunk_id: `practice_playbook:${row.id}`,
    source_area: 'practice_playbooks',
    source_type: 'internal_practice_playbook',
    source_document_id: row.id,
    source_record_id: row.id,
    source_reference: row.source_title || row.id,
    title: row.title,
    chunk_text: chunkText,
    summary: row.scenario_summary,
    keywords: row.useful_search_keywords.join(','),
    source_url: null,
    page_no: null,
    chunk_no: null,
    effective_from: null,
    effective_to: null,
    trust_level: 'internal_practice_playbook',
    review_status: 'needs_human_review',
    embedding_status: 'pending',
    content_hash: row.content_hash,
    duplicate_group_key: row.duplicate_group_key,
    metadata: {
      category: row.category,
      sub_category: row.sub_category,
      issue_type: row.issue_type,
      source_title: row.source_title,
      source_domain: row.source_domain,
      official_citation_allowed: false,
      citation_policy: 'do_not_cite_as_official_ground',
    },
  };
}

async function main() {
  const rawRows = readJson(INPUT_FILE);
  const normalized = rawRows.map(normalizeRow);
  const { unique, duplicates } = dedupeLocal(normalized);
  if (duplicates.length) {
    console.warn(`[dedupe] local duplicate content_hash rows skipped: ${duplicates.length}`);
  }

  const existingHashes = await existingValues('rag_practice_playbooks', 'content_hash', unique.map((row) => row.content_hash));
  const rowsToImport = unique.filter((row) => !existingHashes.has(row.content_hash));
  const skippedExisting = unique.length - rowsToImport.length;
  if (skippedExisting) console.warn(`[dedupe] existing content_hash rows skipped: ${skippedExisting}`);

  await upsertRows('rag_practice_playbooks', rowsToImport, 'id');

  const masterRows = rowsToImport.map(toMasterChunk);
  const existingChunkIds = await existingValues('rag_master_chunks', 'chunk_id', masterRows.map((row) => row.chunk_id));
  const newMasterRows = masterRows.filter((row) => !existingChunkIds.has(row.chunk_id));
  if (masterRows.length - newMasterRows.length) {
    console.warn(`[embedding] existing master chunks preserved without resetting embedding_status: ${masterRows.length - newMasterRows.length}`);
  }
  await insertRows('rag_master_chunks', newMasterRows);

  console.log(`[summary] input=${rawRows.length} unique=${unique.length} imported=${rowsToImport.length} local_duplicates=${duplicates.length} existing_duplicates=${skippedExisting} new_master_chunks=${newMasterRows.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
