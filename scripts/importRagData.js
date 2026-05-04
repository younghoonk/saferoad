const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.resolve(process.cwd(), '.env.rag.local') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ASSETS_DIR = path.resolve(process.cwd(), 'rag_assets');
const BATCH_SIZE = Number(process.env.RAG_IMPORT_BATCH_SIZE || 100);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.rag.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const SOURCE_AREAS = new Set([
  'precedents',
  'terms_standards',
  'fss_dispute_cases',
  'medical_knowledge',
  'legal_statutes',
]);

const NON_DATE_STATUS_VALUES = new Set([
  'needs_current_check',
  'current_check_required',
  'unknown',
  'n/a',
  'na',
  'null',
  '-',
]);

function readJson(relativePath) {
  const filePath = path.join(ASSETS_DIR, relativePath);
  if (!fs.existsSync(filePath)) {
    console.warn(`[skip] ${relativePath} not found`);
    return [];
  }

  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.data)) return parsed.data;
  if (Array.isArray(parsed.rows)) return parsed.rows;

  console.warn(`[skip] ${relativePath} is not an array`);
  return [];
}

function emptyToNull(value) {
  return value === '' || value === undefined || value === null ? null : value;
}

function sanitizeDate(value) {
  const normalized = emptyToNull(value);
  if (normalized === null) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof normalized !== 'string') return null;

  const trimmed = normalized.trim();
  if (trimmed === '') return null;
  if (NON_DATE_STATUS_VALUES.has(trimmed.toLowerCase())) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  return null;
}

function getDateStatus(value) {
  const normalized = emptyToNull(value);
  if (typeof normalized !== 'string') return null;

  const trimmed = normalized.trim();
  if (trimmed === '') return null;
  if (sanitizeDate(trimmed)) return null;
  if (NON_DATE_STATUS_VALUES.has(trimmed.toLowerCase())) return trimmed;

  return null;
}

function appendText(existing, addition) {
  const current = emptyToNull(existing);
  const next = emptyToNull(addition);
  if (!next) return current;
  if (!current) return next;
  if (String(current).includes(String(next))) return current;
  return `${current}\n${next}`;
}

function withDateStatus(row, dateFields, statusField, noteField) {
  const mapped = { ...row };
  const statuses = [];

  for (const field of dateFields) {
    const status = getDateStatus(row[field]);
    if (status) statuses.push(`${field}:${status}`);
    if (Object.prototype.hasOwnProperty.call(mapped, field)) {
      mapped[field] = sanitizeDate(row[field]);
    }
  }

  if (statuses.length > 0) {
    const statusValue = statuses.map((status) => status.split(':').slice(1).join(':')).join(';');
    mapped[statusField] = appendText(mapped[statusField], statusValue);
    if (noteField) {
      mapped[noteField] = appendText(mapped[noteField], `date_status=${statuses.join(',')}`);
    }
  }

  return mapped;
}

function toInt(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return null;
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;
  return null;
}

function normalizeEmbeddingStatus(value) {
  return emptyToNull(value) || 'pending';
}

function pickMetadata(row, keys) {
  const metadata = {};
  for (const [key, value] of Object.entries(row)) {
    if (!keys.includes(key) && value !== undefined && value !== '') {
      metadata[key] = value;
    }
  }
  return metadata;
}

async function upsertRows(table, rows, onConflict) {
  let inserted = 0;
  let failed = 0;

  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    const batch = rows.slice(index, index + BATCH_SIZE);
    const { error } = await supabase.from(table).upsert(batch, { onConflict });

    if (!error) {
      inserted += batch.length;
      continue;
    }

    console.error(`[batch failed] ${table} rows ${index + 1}-${index + batch.length}: ${error.message}`);
    for (const row of batch) {
      const { error: rowError } = await supabase.from(table).upsert(row, { onConflict });
      if (rowError) {
        failed += 1;
        console.error(`[row failed] ${table} ${getRowKey(row)}: ${rowError.message}`);
      } else {
        inserted += 1;
      }
    }
  }

  console.log(`[import] ${table}: success=${inserted} failed=${failed}`);
  return { inserted, failed };
}

function getRowKey(row) {
  return row.chunk_id || row.record_id || row.source_document_id || row.source_id || row.code_id || row.article_id || row.target_id || row.title || 'unknown';
}

function mapKnownFields(row, keys) {
  const mapped = {};
  for (const key of keys) {
    if (row[key] !== undefined) mapped[key] = emptyToNull(row[key]);
  }
  mapped.metadata = pickMetadata(row, keys);
  return mapped;
}

function mapCourtPrecedent(row) {
  const keys = [
    'record_id', 'source_type', 'title', 'case_number', 'court_or_agency', 'precedent_categories',
    'insurance_type', 'accident_type', 'issue', 'summary', 'key_points', 'outcome', 'conclusion',
    'keywords', 'source_url', 'source_reference', 'source_status', 'full_text_excerpt',
  ];
  return {
    ...mapKnownFields(row, keys),
    decision_date: sanitizeDate(row.decision_date),
  };
}

function mapTermsSource(row) {
  const keys = [
    'source_document_id', 'source_group', 'document_type', 'terms_category', 'title', 'publisher',
    'version', 'source_url', 'official_reference_url', 'raw_pdf_path', 'raw_text_path', 'source_status',
    'notes', 'pdf_sha256', 'text_sha256',
  ];
  return {
    ...mapKnownFields(row, keys),
    effective_from: sanitizeDate(row.effective_from),
    effective_to: sanitizeDate(row.effective_to),
    pdf_file_size_bytes: toInt(row.pdf_file_size_bytes),
    text_file_size_bytes: toInt(row.text_file_size_bytes),
    collected_at: sanitizeDate(row.collected_at),
  };
}

function mapTermsRawChunk(row) {
  const keys = [
    'chunk_id', 'source_document_id', 'source_group', 'source_type', 'document_type', 'terms_category',
    'title', 'source_url',
  ];
  return {
    ...mapKnownFields(row, keys),
    page_no: toInt(row.page_no),
    chunk_no: toInt(row.chunk_no),
    raw_text: emptyToNull(row.raw_text),
    effective_from: sanitizeDate(row.effective_from),
    effective_to: sanitizeDate(row.effective_to),
    embedding_status: normalizeEmbeddingStatus(row.embedding_status),
  };
}

function mapFssDispute(row) {
  const keys = [
    'record_id', 'source_type', 'title', 'case_number', 'court_or_agency', 'insurance_type',
    'accident_type', 'precedent_categories', 'issue', 'summary', 'key_points', 'outcome', 'conclusion',
    'keywords', 'published_batch', 'published_date', 'source_status', 'pdf_page', 'printed_page',
    'source_reference', 'source_url', 'source_category', 'full_text_excerpt',
  ];
  return {
    ...mapKnownFields(row, keys),
    decision_date: sanitizeDate(row.decision_date),
    latest_flag: toBool(row.latest_flag),
    embedding_status: normalizeEmbeddingStatus(row.embedding_status),
  };
}

function mapMedicalSource(row) {
  const keys = [
    'source_id', 'source_type', 'title', 'publisher', 'source_url', 'scope', 'source_status',
    'update_frequency', 'copyright_note',
  ];
  return {
    ...mapKnownFields(row, keys),
    last_checked_at: sanitizeDate(row.last_checked_at),
  };
}

function mapMedicalRecord(row) {
  const keys = [
    'record_id', 'category', 'body_system', 'diagnosis_name', 'diagnosis_code', 'common_synonyms',
    'issue_type', 'medical_summary', 'common_tests', 'key_findings', 'treatment_summary',
    'insurance_relevance', 'causation_points', 'pre_existing_condition_points', 'disability_points',
    'hospitalization_points', 'surgery_points', 'caution_notes', 'source_ids', 'source_status',
  ];
  return {
    ...mapKnownFields(row, keys),
    priority: toInt(row.priority) || 3,
    last_reviewed_at: sanitizeDate(row.last_reviewed_at),
  };
}

function mapKcdCode(row) {
  const keys = ['code_id', 'kcd_code', 'korean_name', 'category', 'insurance_relevance', 'source_ids', 'verification_status'];
  return {
    ...mapKnownFields(row, keys),
    last_reviewed_at: sanitizeDate(row.last_reviewed_at),
  };
}

function mapLegalSource(row) {
  const keys = [
    'source_document_id', 'source_area', 'law_name', 'law_alias', 'source_type', 'publisher',
    'jurisdiction', 'promulgation_info', 'source_url', 'source_status', 'notes',
  ];
  return withDateStatus({
    ...mapKnownFields(row, keys),
    effective_date: row.effective_date,
  }, ['effective_date', 'effective_from', 'effective_to', 'published_date', 'collected_at'], 'source_status', 'notes');
}

function mapLegalArticle(row) {
  const keys = [
    'article_id', 'source_document_id', 'law_name', 'law_part', 'article_no', 'article_title',
    'article_text', 'source_url', 'issue_tags', 'article_text_status',
  ];
  return withDateStatus({
    ...mapKnownFields(row, keys),
    effective_date: row.effective_date,
    priority: toInt(row.priority) || 3,
  }, ['effective_date'], 'article_text_status');
}

function mapLegalTarget(row) {
  const keys = [
    'target_id', 'source_document_id', 'law_name', 'article_no', 'article_title', 'jo_code',
    'fetch_method', 'source_url', 'issue_tags', 'status',
  ];
  return {
    ...mapKnownFields(row, keys),
    priority: toInt(row.priority) || 3,
  };
}

function toMasterChunk(row, sourceArea) {
  const normalizedArea = sourceArea || row.source_area;
  if (!SOURCE_AREAS.has(normalizedArea)) {
    throw new Error(`Invalid source_area: ${normalizedArea}`);
  }

  const sourceReference = emptyToNull(row.source_reference)
    || emptyToNull(row.case_number)
    || emptyToNull(row.source_record_id)
    || emptyToNull(row.source_id)
    || emptyToNull(row.record_id)
    || emptyToNull(row.source_document_id)
    || emptyToNull(row.chunk_id);

  return {
    chunk_id: emptyToNull(row.chunk_id) || `${normalizedArea}:${sourceReference}`,
    source_area: normalizedArea,
    source_type: emptyToNull(row.source_type) || inferSourceType(row, normalizedArea),
    source_document_id: emptyToNull(row.source_document_id),
    source_record_id: emptyToNull(row.source_record_id) || emptyToNull(row.source_id) || emptyToNull(row.record_id),
    source_reference: sourceReference,
    title: emptyToNull(row.title) || sourceReference,
    chunk_text: emptyToNull(row.chunk_text) || buildChunkText(row),
    summary: emptyToNull(row.summary),
    keywords: emptyToNull(row.keywords),
    source_url: emptyToNull(row.source_url) || emptyToNull(row.source_urls),
    page_no: toInt(row.page_no || row.pdf_page || row.printed_page),
    chunk_no: toInt(row.chunk_no),
    effective_from: sanitizeDate(row.effective_from || row.effective_date || row.decision_date),
    effective_to: sanitizeDate(row.effective_to),
    trust_level: emptyToNull(row.trust_level) || emptyToNull(row.source_status),
    review_status: emptyToNull(row.review_status) || getDateStatus(row.effective_from || row.effective_date || row.decision_date) || 'unreviewed',
    embedding_status: normalizeEmbeddingStatus(row.embedding_status),
    metadata: row,
  };
}

function buildGeneratedChunkId(row, sourceArea) {
  const sourceDocumentId = emptyToNull(row.source_document_id) || emptyToNull(row.source_id) || emptyToNull(row.source_record_id);
  const pageNo = toInt(row.page_no || row.pdf_page || row.printed_page);
  const chunkNo = toInt(row.chunk_no || row.chunk_index);

  if (sourceDocumentId && pageNo !== null && chunkNo !== null) {
    return `${sourceArea}:${sourceDocumentId}:p${pageNo}:c${chunkNo}`;
  }

  const sourceReference = emptyToNull(row.source_reference)
    || emptyToNull(row.record_id)
    || emptyToNull(row.case_number)
    || sourceDocumentId
    || emptyToNull(row.title);

  return sourceReference ? `${sourceArea}:${sourceReference}` : null;
}

function termsRawChunkToMasterChunk(row) {
  const sourceDocumentId = emptyToNull(row.source_document_id);
  const pageNo = toInt(row.page_no);
  const chunkNo = toInt(row.chunk_no || row.chunk_index);
  const chunkId = emptyToNull(row.chunk_id) || buildGeneratedChunkId(row, 'terms_standards');
  const sourceReference = [
    sourceDocumentId || 'terms_raw_chunk',
    pageNo !== null ? `p${pageNo}` : null,
    chunkNo !== null ? `c${chunkNo}` : null,
  ].filter(Boolean).join(':') || chunkId;
  const titleParts = [emptyToNull(row.title) || sourceDocumentId || chunkId];

  if (pageNo !== null) titleParts.push(`p.${pageNo}`);
  if (chunkNo !== null) titleParts.push(`chunk ${chunkNo}`);

  return toMasterChunk({
    ...row,
    chunk_id: chunkId,
    source_area: 'terms_standards',
    source_type: emptyToNull(row.source_type) || 'terms_raw_chunk',
    source_reference: sourceReference,
    title: titleParts.filter(Boolean).join(' / '),
    chunk_text: emptyToNull(row.raw_text) || emptyToNull(row.chunk_text),
    summary: emptyToNull(row.summary),
    keywords: emptyToNull(row.keywords) || emptyToNull(row.terms_category),
    embedding_status: 'pending',
  }, 'terms_standards');
}

function inferSourceType(row, sourceArea) {
  if (sourceArea === 'precedents') return 'court_precedent';
  if (sourceArea === 'fss_dispute_cases') return 'fss_dispute';
  if (sourceArea === 'terms_standards') return row.document_type || 'policy_terms_or_standard';
  if (sourceArea === 'medical_knowledge') return 'medical_knowledge';
  if (sourceArea === 'legal_statutes') return 'legal_article';
  return null;
}

function buildChunkText(row) {
  return [
    row.title,
    row.issue,
    row.summary,
    row.key_points,
    row.conclusion,
    row.full_text_excerpt,
  ].filter(Boolean).join('\n');
}

function sourceAreaForV2(row) {
  if ((row.source_type || '').includes('fss') || row.record_id?.startsWith('fss_')) {
    return 'fss_dispute_cases';
  }
  return 'precedents';
}

function dedupeMasterRows(rows) {
  const seen = new Set();
  const deduped = [];
  for (const row of rows) {
    const key = row.chunk_id
      ? `chunk_id:${row.chunk_id}`
      : [
          row.source_area,
          row.title,
          row.source_reference || row.source_document_id || row.source_record_id,
        ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

async function importJson({ relativePath, table, mapper, onConflict }) {
  const rows = readJson(relativePath).map(mapper).filter(Boolean);
  if (rows.length === 0) {
    console.log(`[import] ${table}: no rows from ${relativePath}`);
    return;
  }
  await upsertRows(table, rows, onConflict);
}

async function importLegalArticleTargets() {
  const sourceRows = readJson('legal_statutes_server_upload_v1/05_legal_statutes/legal_source_documents.json').map(mapLegalSource).filter(Boolean);
  const targetRows = readJson('legal_statutes_server_upload_v1/05_legal_statutes/legal_article_targets.json').map(mapLegalTarget).filter(Boolean);

  if (targetRows.length === 0) {
    console.log('[import] legal_article_targets: no rows from legal_article_targets.json');
    return;
  }

  const sourceIds = new Set(sourceRows.map((row) => row.source_document_id).filter(Boolean));
  const targetSourceIds = [...new Set(targetRows.map((row) => row.source_document_id).filter(Boolean))];
  const missingInAsset = targetSourceIds.filter((sourceDocumentId) => !sourceIds.has(sourceDocumentId));

  if (missingInAsset.length > 0) {
    console.warn(`[warn] legal_article_targets references source_document_id values not present in legal_source_documents.json: ${missingInAsset.join(', ')}`);
  }

  const referencedSourceRows = sourceRows.filter((row) => targetSourceIds.includes(row.source_document_id));
  if (referencedSourceRows.length > 0) {
    await upsertRows('legal_source_documents', referencedSourceRows, 'source_document_id');
  }

  await upsertRows('legal_article_targets', targetRows, 'target_id');
}

async function upsertMasterRows(rows) {
  const rowsWithChunkId = [];
  const rowsWithoutChunkId = [];

  for (const row of rows) {
    if (emptyToNull(row.chunk_id)) {
      rowsWithChunkId.push(row);
    } else {
      rowsWithoutChunkId.push(row);
    }
  }

  if (rowsWithChunkId.length > 0) {
    await upsertRows('rag_master_chunks', rowsWithChunkId, 'chunk_id');
  }

  if (rowsWithoutChunkId.length > 0) {
    await upsertRows('rag_master_chunks', rowsWithoutChunkId, 'source_area,source_type,title,source_reference');
  }
}

async function main() {
  await importJson({
    relativePath: 'server_upload_split_dataset_v1/01_precedents/precedent_cases.json',
    table: 'court_precedents',
    mapper: mapCourtPrecedent,
    onConflict: 'record_id',
  });

  await importJson({
    relativePath: 'server_upload_split_dataset_v1/02_terms_standards/terms_source_documents.json',
    table: 'terms_source_documents',
    mapper: mapTermsSource,
    onConflict: 'source_document_id',
  });

  await importJson({
    relativePath: 'server_upload_split_dataset_v1/02_terms_standards/terms_raw_chunks.json',
    table: 'terms_raw_chunks',
    mapper: mapTermsRawChunk,
    onConflict: 'chunk_id',
  });

  await importJson({
    relativePath: 'server_upload_split_dataset_v1/03_fss_dispute_cases/fss_dispute_cases.json',
    table: 'fss_dispute_cases',
    mapper: mapFssDispute,
    onConflict: 'record_id',
  });

  await importJson({
    relativePath: 'medical_knowledge_server_upload_v1/medical_source_documents.json',
    table: 'medical_source_documents',
    mapper: mapMedicalSource,
    onConflict: 'source_id',
  });

  await importJson({
    relativePath: 'medical_knowledge_server_upload_v1/medical_knowledge_records.json',
    table: 'medical_knowledge_records',
    mapper: mapMedicalRecord,
    onConflict: 'record_id',
  });

  await importJson({
    relativePath: 'medical_knowledge_server_upload_v1/medical_kcd_priority_codes.json',
    table: 'medical_kcd_priority_codes',
    mapper: mapKcdCode,
    onConflict: 'code_id',
  });

  await importJson({
    relativePath: 'legal_statutes_server_upload_v1/05_legal_statutes/legal_source_documents.json',
    table: 'legal_source_documents',
    mapper: mapLegalSource,
    onConflict: 'source_document_id',
  });

  await importJson({
    relativePath: 'legal_statutes_server_upload_v1/05_legal_statutes/legal_articles_seed.json',
    table: 'legal_articles',
    mapper: mapLegalArticle,
    onConflict: 'article_id',
  });

  await importLegalArticleTargets();

  const masterRows = [
    ...readJson('server_upload_split_dataset_v1/99_master_import/rag_master_chunks.json').map((row) => toMasterChunk(row)),
    ...readJson('server_upload_split_dataset_v1/02_terms_standards/terms_raw_chunks.json').map(termsRawChunkToMasterChunk),
    ...readJson('medical_knowledge_server_upload_v1/medical_rag_chunks.json').map((row) => toMasterChunk(row, 'medical_knowledge')),
    ...readJson('legal_statutes_server_upload_v1/05_legal_statutes/legal_rag_chunks.json').map((row) => toMasterChunk(row, 'legal_statutes')),
  ];

  const v2Rows = [
    ...readJson('insurance_dispute_rag_dataset_v2/legal_references_v2.json'),
    ...readJson('insurance_dispute_rag_dataset_v2/fss_2026_latest_75_titles.json'),
    ...readJson('insurance_dispute_rag_dataset_v2/precedent_cases.json'),
  ].map((row) => toMasterChunk(
    { ...row, chunk_id: `v2:${row.record_id || row.case_number || row.title}` },
    sourceAreaForV2(row),
  ));

  await upsertMasterRows(dedupeMasterRows([...masterRows, ...v2Rows]));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
