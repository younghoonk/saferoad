#!/usr/bin/env node
/**
 * 신의료기술 고시 978건 → rag_dataset_chunks 적재
 * 실행: node scripts/importNmtChunks.js
 * 소스: nmt_chunks.json (프로젝트 루트)
 *
 * 원본 필드: { source_area, title, tech_no, target_criteria, content }
 * 변환:
 *   chunk_id   = "nmt_" + 4자리 인덱스 (1-based, 예: "nmt_0001")
 *   text       = content
 *   source_area = "terms_standards"
 *   trust_level = "official_guideline"
 *   metadata   = { dataset_version, tech_no, title, target_criteria, original_source_area }
 *   embedding  = null
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
const TABLE = 'rag_dataset_chunks';

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
    .from(TABLE)
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
    text: chunk.content,
    source_area: 'terms_standards',
    trust_level: 'official_guideline',
    metadata: {
      dataset_version: DATASET_VERSION,
      tech_no: chunk.tech_no,
      title: chunk.title,
      target_criteria: chunk.target_criteria,
      original_source_area: chunk.source_area,
    },
    embedding: null,
  }));

  // 배치 INSERT
  let inserted = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from(TABLE).insert(batch);

    if (!error) {
      inserted += batch.length;
      if (inserted % 200 === 0 || inserted === rows.length) {
        console.log(`[info] inserted ${inserted}/${rows.length}`);
      }
      continue;
    }

    console.warn(`[warn] batch ${i + 1}-${i + batch.length} failed (${error.message}), retrying individually...`);
    for (const row of batch) {
      const { error: rowError } = await supabase.from(TABLE).insert(row);
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
