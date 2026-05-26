#!/usr/bin/env node
/**
 * 신의료기술 고시 978건 → rag_master_chunks 적재
 * 실행: node scripts/importNmtChunks.js
 * 소스: nmt_chunks.json (프로젝트 루트)
 *
 * 원본 필드: { source_area, title, tech_no, target_criteria, content }
 */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.resolve(process.cwd(), '.env.rag.local') });
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATASET_VERSION = 'nmt_v1';
const BATCH_SIZE = 50;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[error] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.rag.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function padIndex(n) {
  return String(n).padStart(4, '0');
}

async function main() {
  const srcPath = path.resolve(process.cwd(), 'nmt_chunks.json');
  if (!fs.existsSync(srcPath)) {
    console.error(`[error] nmt_chunks.json not found at ${srcPath}`);
    process.exit(1);
  }

  const chunks = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
  console.log(`[info] loaded ${chunks.length} chunks from nmt_chunks.json`);

  // 중복 방지: 기존 dataset_version = 'nmt_v1' 행 삭제
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
  const rows = chunks.map((chunk, index) => ({
    chunk_id: `nmt_${padIndex(index + 1)}`,
    source_area: 'terms_standards',
    source_type: 'official_guideline',
    source_document_id: null,
    source_record_id: null,
    source_reference: null,
    title: chunk.title,
    chunk_text: chunk.content,
    summary: chunk.target_criteria || null,
    keywords: null,
    source_url: null,
    page_no: null,
    chunk_no: null,
    effective_from: null,
    effective_to: null,
    trust_level: 'official_guideline',
    review_status: 'unreviewed',
    embedding_status: 'pending',
    metadata: {
      dataset_version: DATASET_VERSION,
      tech_no: chunk.tech_no,
      title: chunk.title,
      target_criteria: chunk.target_criteria,
      original_source_area: chunk.source_area,
    },
  }));

  // 배치 INSERT (chunk_id가 nmt_NNNN 형태라 충돌 없으므로 insert 사용,
  // 재실행 안전을 위해 위 delete로 중복 제거 후 insert)
  let inserted = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('rag_master_chunks').insert(batch);

    if (!error) {
      inserted += batch.length;
      if (inserted % 200 === 0 || inserted === rows.length) {
        console.log(`[info] inserted ${inserted}/${rows.length}`);
      }
      continue;
    }

    console.warn(`[warn] batch ${i + 1}-${i + batch.length} failed (${error.message}), retrying individually...`);
    for (const row of batch) {
      const { error: rowError } = await supabase.from('rag_master_chunks').insert(row);
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
