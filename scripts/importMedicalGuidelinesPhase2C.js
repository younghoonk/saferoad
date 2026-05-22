#!/usr/bin/env node
/**
 * Import Phase 2-C medical guideline references into rag_master_chunks.
 * Reads 18 txt files from data_sources/medical_guidelines_phase2c/
 *
 * Usage:
 *   node scripts/importMedicalGuidelinesPhase2C.js           # dry-run
 *   node scripts/importMedicalGuidelinesPhase2C.js --execute  # insert + embed
 */

require('dotenv').config({ path: '.env.rag.local' });
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY');
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DRY_RUN = !process.argv.includes('--execute');
const EMBEDDING_MODEL = 'text-embedding-3-small';
const DATASET_VERSION = 'phase2c_medical_guidelines_2026-05-22';
const SOURCE_DIR = path.resolve(process.cwd(), 'data_sources/medical_guidelines_phase2c');

function parseTxtFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  let title = '';
  let publisher = '';
  let diseaseRaw = '';

  for (const line of lines.slice(0, 10)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('가이드라인명:')) {
      title = trimmed.replace('가이드라인명:', '').trim();
    } else if (trimmed.startsWith('발행기관:')) {
      publisher = trimmed.replace('발행기관:', '').trim();
    } else if (trimmed.startsWith('적용 질환:')) {
      diseaseRaw = trimmed.replace('적용 질환:', '').trim();
    }
  }

  // Extract ICD code from "(KCD/ICD-10: ...)" pattern
  const icdMatch = diseaseRaw.match(/\(KCD\/ICD-10:\s*([^)]+)\)/);
  const diagnosisCode = icdMatch ? icdMatch[1].trim() : null;
  // Disease name without the code part
  const disease = diseaseRaw.replace(/\s*\(KCD\/ICD-10:[^)]+\)/, '').trim();

  // Extract keywords from 【키워드】 section
  const keywordsMatch = content.match(/【키워드】\s*\n([\s\S]+?)(?:\n\n|$)/);
  const keywords = keywordsMatch ? keywordsMatch[1].trim() : '';

  // Build summary: disease + first diagnostic criteria items
  const diagMatch = content.match(/【진단 기준 핵심】\s*\n([\s\S]+?)(?:【|$)/);
  const diagText = diagMatch ? diagMatch[1].trim().split('\n').slice(0, 3).join(' ') : '';
  const summary = `${disease} — ${diagText}`.substring(0, 600);

  return { title, publisher, disease, diagnosisCode, keywords, summary, chunk_text: content.trim() };
}

function getCategoryFromFilename(filename) {
  if (filename.startsWith('cancer_')) return 'cancer';
  if (filename.startsWith('brain_')) return 'brain';
  if (filename.startsWith('heart_')) return 'heart';
  return 'general';
}

async function createEmbedding(text) {
  const resp = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ input: text.slice(0, 8000), model: EMBEDDING_MODEL }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI embedding error: ${resp.status} ${err.slice(0, 200)}`);
  }
  const json = await resp.json();
  return json.data[0].embedding;
}

async function checkExists(chunkId) {
  const { data } = await supabase
    .from('rag_master_chunks')
    .select('chunk_id')
    .eq('chunk_id', chunkId)
    .maybeSingle();
  return Boolean(data);
}

async function importGuideline(filename, parsed) {
  const baseName = path.basename(filename, '.txt');
  const chunkId = `medical_guideline:phase2c:${baseName}:v1`;
  const category = getCategoryFromFilename(baseName);

  const exists = await checkExists(chunkId);
  if (exists) {
    console.log(`  [SKIP] Already exists: ${chunkId}`);
    return { status: 'skipped', chunk_id: chunkId };
  }

  const embeddingInput = `${parsed.title}\n\n${parsed.chunk_text}`.slice(0, 8000);

  let embedding = null;
  if (!DRY_RUN) {
    console.log(`  [EMBED] Generating embedding...`);
    embedding = await createEmbedding(embeddingInput);
    if (!Array.isArray(embedding) || embedding.length !== 1536) {
      throw new Error(`Unexpected embedding dimension: ${embedding?.length}`);
    }
  }

  const row = {
    chunk_id: chunkId,
    title: parsed.title,
    chunk_text: parsed.chunk_text,
    summary: parsed.summary,
    keywords: parsed.keywords,
    source_area: 'medical_guideline',
    source_type: 'guideline_phase2c',
    trust_level: 'official',
    review_status: 'reviewed',
    embedding_status: DRY_RUN ? 'pending' : 'done',
    ...(embedding ? {
      embedding,
      embedding_model: EMBEDDING_MODEL,
      embedding_created_at: new Date().toISOString(),
    } : {}),
    metadata: {
      official_citation_allowed: true,
      review_status: 'reviewed',
      source_status: 'reprocessed_v1',
      reprocessing_source: 'phase2c',
      dataset_version: DATASET_VERSION,
      format_version: 'v_medical_guideline_pattern',
      category,
      diagnosis_code: parsed.diagnosisCode,
      disease: parsed.disease,
      publisher: parsed.publisher,
      imported_by: 'importMedicalGuidelinesPhase2C.js',
    },
  };

  if (DRY_RUN) {
    console.log(`  [DRY-RUN] Would insert: ${chunkId}`);
    console.log(`    title: ${parsed.title.substring(0, 80)}`);
    console.log(`    category: ${category} | code: ${parsed.diagnosisCode || 'N/A'}`);
    console.log(`    keywords length: ${parsed.keywords.length} chars`);
    return { status: 'dry_run', chunk_id: chunkId };
  }

  const { error } = await supabase.from('rag_master_chunks').insert(row);
  if (error) {
    console.error(`  [ERROR] Insert failed: ${error.message}`);
    return { status: 'error', chunk_id: chunkId, error: error.message };
  }

  console.log(`  [OK] Inserted: ${chunkId}`);
  return { status: 'inserted', chunk_id: chunkId };
}

async function main() {
  console.log('\n=== importMedicalGuidelinesPhase2C.js ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN (pass --execute to insert)' : 'EXECUTE'}`);
  console.log(`Dataset version: ${DATASET_VERSION}`);
  console.log(`Source directory: ${SOURCE_DIR}\n`);

  if (!fs.existsSync(SOURCE_DIR)) {
    console.error(`Source directory not found: ${SOURCE_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(SOURCE_DIR)
    .filter(f => f.endsWith('.txt'))
    .sort();

  console.log(`Files found: ${files.length}`);
  const categories = { cancer: 0, brain: 0, heart: 0, general: 0 };
  for (const f of files) categories[getCategoryFromFilename(f)]++;
  console.log(`  cancer: ${categories.cancer} | brain: ${categories.brain} | heart: ${categories.heart}\n`);

  const results = { inserted: 0, skipped: 0, dry_run: 0, error: 0 };

  for (let i = 0; i < files.length; i++) {
    const filename = files[i];
    const filePath = path.join(SOURCE_DIR, filename);
    const parsed = parseTxtFile(filePath);

    console.log(`[${i + 1}/${files.length}] ${filename}`);
    const result = await importGuideline(filename, parsed);
    results[result.status] = (results[result.status] || 0) + 1;

    if (!DRY_RUN && i < files.length - 1) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Inserted:            ${results.inserted}`);
  console.log(`Skipped (exists):    ${results.skipped}`);
  console.log(`Dry-run (would):     ${results.dry_run}`);
  console.log(`Errors:              ${results.error}`);

  if (!DRY_RUN) {
    const { count: totalCount } = await supabase
      .from('rag_master_chunks')
      .select('*', { count: 'exact', head: true })
      .eq('source_area', 'medical_guideline');
    console.log(`\nDB medical_guideline total rows: ${totalCount}`);

    const { data: phase2cRows } = await supabase
      .from('rag_master_chunks')
      .select('chunk_id, metadata')
      .eq('source_area', 'medical_guideline')
      .eq('review_status', 'reviewed');

    const phase2cCount = (phase2cRows || []).filter(
      r => r.metadata?.reprocessing_source === 'phase2c'
    ).length;
    console.log(`Phase 2-C rows (reprocessing_source=phase2c): ${phase2cCount}`);
  }

  if (results.error > 0) process.exitCode = 1;
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
