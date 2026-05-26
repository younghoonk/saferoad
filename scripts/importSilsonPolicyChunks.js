#!/usr/bin/env node
/**
 * 실손 약관 47건 → rag_master_chunks 적재
 * 실행: node scripts/importSilsonPolicyChunks.js
 * 소스: silson_policy_chunks.json (프로젝트 루트)
 */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.resolve(process.cwd(), '.env.rag.local') });
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATASET_VERSION = 'silson_policy_v1';
const BATCH_SIZE = 50;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[error] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.rag.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function extractTitle(chunk) {
  // text 첫 줄에서 "[실손의료비 약관 - X세대]" 형태 추출
  const firstLine = (chunk.text || '').split('\n')[0].trim();
  if (firstLine) return firstLine.slice(0, 200);
  return chunk.metadata?.chunk_type || chunk.id;
}

function extractKeywords(chunk) {
  const topics = chunk.metadata?.topics;
  if (Array.isArray(topics) && topics.length) return topics.join(' ');
  return null;
}

async function main() {
  const srcPath = path.resolve(process.cwd(), 'silson_policy_chunks.json');
  if (!fs.existsSync(srcPath)) {
    console.error(`[error] silson_policy_chunks.json not found at ${srcPath}`);
    process.exit(1);
  }

  const chunks = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
  console.log(`[info] loaded ${chunks.length} chunks from silson_policy_chunks.json`);

  // 중복 방지: 기존 dataset_version = 'silson_policy_v1' 행 삭제
  console.log(`[info] deleting existing rows with dataset_version='${DATASET_VERSION}'...`);
  const { error: deleteError, count: deleteCount } = await supabase
    .from('rag_master_chunks')
    .delete({ count: 'exact' })
    .eq('metadata->>dataset_version', DATASET_VERSION);

  if (deleteError) {
    console.error(`[error] delete failed: ${deleteError.message}`);
    process.exit(1);
  }
  console.log(`[info] deleted ${deleteCount ?? '?'} existing rows`);

  // 행 변환
  const rows = chunks.map((chunk) => ({
    chunk_id: chunk.id,
    source_area: 'terms_standards',
    source_type: 'policy_terms',
    source_document_id: null,
    source_record_id: null,
    source_reference: null,
    title: extractTitle(chunk),
    chunk_text: chunk.text,
    summary: null,
    keywords: extractKeywords(chunk),
    source_url: null,
    page_no: null,
    chunk_no: null,
    effective_from: null,
    effective_to: null,
    trust_level: 'policy_reference',
    review_status: 'unreviewed',
    embedding_status: 'pending',
    metadata: {
      ...(chunk.metadata || {}),
      dataset_version: DATASET_VERSION,
    },
  }));

  // 배치 upsert (on conflict: chunk_id)
  let inserted = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('rag_master_chunks')
      .upsert(batch, { onConflict: 'chunk_id' });

    if (!error) {
      inserted += batch.length;
      console.log(`[info] upserted ${inserted}/${rows.length}`);
      continue;
    }

    console.warn(`[warn] batch ${i + 1}-${i + batch.length} failed (${error.message}), retrying individually...`);
    for (const row of batch) {
      const { error: rowError } = await supabase
        .from('rag_master_chunks')
        .upsert(row, { onConflict: 'chunk_id' });
      if (rowError) {
        failed += 1;
        console.error(`[error] row ${row.chunk_id}: ${rowError.message}`);
      } else {
        inserted += 1;
      }
    }
  }

  console.log(JSON.stringify({
    dataset_version: DATASET_VERSION,
    total: chunks.length,
    inserted,
    failed,
  }, null, 2));

  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error('[fatal]', e.message);
  process.exit(1);
});
