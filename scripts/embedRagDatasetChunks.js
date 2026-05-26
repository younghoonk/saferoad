#!/usr/bin/env node
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.resolve(process.cwd(), '.env.rag.local') });
dotenv.config();

const args = parseArgs(process.argv.slice(2));
const datasetVersion = String(args.datasetVersion || args['dataset-version'] || '').trim();
const releaseStage = String(args.releaseStage || args['release-stage'] || '').trim();
const batchSize = Math.min(Math.max(Number(args.batchSize || args['batch-size'] || 50), 1), 100);
const model = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
if (!process.env.OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY');
if (!datasetVersion) throw new Error('Missing --dataset-version');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  let selected = 0;
  let succeeded = 0;
  let failed = 0;
  const failures = [];
  let lastId = null;
  const pageSize = 1000;

  for (;;) {
    let query = supabase
      .from('rag_master_chunks')
      .select('id,chunk_id,title,summary,chunk_text,keywords,metadata,embedding_status,embedding')
      .order('id', { ascending: true })
      .limit(pageSize);
    if (lastId) query = query.gt('id', lastId);

    const { data, error } = await query;
    if (error) throw new Error(`[select embedding targets failed] ${error.message}`);
    const pageRows = data || [];
    if (!pageRows.length) break;
    lastId = pageRows[pageRows.length - 1]?.id;
    const rows = pageRows.filter(isEmbeddingTarget);
    if (!rows.length) {
      if (pageRows.length < pageSize) break;
      continue;
    }

    for (let offset = 0; offset < rows.length; offset += batchSize) {
      const batchRows = rows.slice(offset, offset + batchSize);
      selected += batchRows.length;
      const embeddingInputs = [];
      for (const row of batchRows) {
        const input = embeddingInput(row);
        if (!input.trim()) {
          const { error: updateError } = await supabase
            .from('rag_master_chunks')
            .update({ embedding_status: 'skipped_empty_text', embedding_error: null, last_embedding_attempt_at: new Date().toISOString() })
            .eq('id', row.id);
          if (updateError) failures.push({ chunk_id: row.chunk_id, error: updateError.message });
          continue;
        }
        embeddingInputs.push({ row, input });
      }
      if (!embeddingInputs.length) continue;

      try {
        const embeddings = await createEmbeddings(embeddingInputs.map((item) => item.input));
        const now = new Date().toISOString();
        for (let index = 0; index < embeddingInputs.length; index += 1) {
          const { row } = embeddingInputs[index];
          const embedding = embeddings[index];
          if (!Array.isArray(embedding) || embedding.length !== 1536) {
            failed += 1;
            const dimErr = `unexpected embedding dimension: ${embedding?.length || 0}`;
            failures.push({ chunk_id: row.chunk_id, error: dimErr });
            await supabase
              .from('rag_master_chunks')
              .update({ embedding_status: 'error', embedding_error: dimErr, last_embedding_attempt_at: now })
              .eq('id', row.id);
            continue;
          }
          const { error: updateError } = await supabase
            .from('rag_master_chunks')
            .update({
              embedding,
              embedding_status: 'done',
              embedding_model: model,
              embedding_created_at: now,
              embedding_error: null,
              last_embedding_attempt_at: now,
            })
            .eq('id', row.id);
          if (updateError) {
            failed += 1;
            const message = updateError.message || JSON.stringify(updateError);
            failures.push({ chunk_id: row.chunk_id, error: message });
            await supabase
              .from('rag_master_chunks')
              .update({ embedding_status: 'error', embedding_error: message.slice(0, 1000), last_embedding_attempt_at: now })
              .eq('id', row.id);
          } else {
            succeeded += 1;
          }
        }
      } catch (batchError) {
        // OpenAI API 호출 실패 시 (DB 저장 에러는 위에서 개별 처리)
        const batchMessage = batchError instanceof Error ? batchError.message : (batchError?.message || JSON.stringify(batchError));
        console.warn(`[warn] batch OpenAI embedding failed (${embeddingInputs.length} rows skipped): ${batchMessage.slice(0, 400)}`);
        const now = new Date().toISOString();
        for (const { row } of embeddingInputs) {
          failed += 1;
          failures.push({ chunk_id: row.chunk_id, error: batchMessage });
          await supabase
            .from('rag_master_chunks')
            .update({ embedding_status: 'error', embedding_error: batchMessage.slice(0, 1000), last_embedding_attempt_at: now })
            .eq('id', row.id);
        }
      }
    }
    if (pageRows.length < pageSize) break;
  }

  const statusCounts = await embeddingStatusCounts();
  console.log(JSON.stringify({ dataset_version: datasetVersion, release_stage: releaseStage || null, selected, succeeded, failed, statusCounts, failures }, null, 2));
  if (failed) process.exitCode = 1;
}

function isEmbeddingTarget(row) {
  if (row.metadata?.dataset_version !== datasetVersion) return false;
  if (releaseStage && row.metadata?.release_stage !== releaseStage) return false;
  if (row.embedding_status !== 'pending') return false;
  if (row.embedding) return false;
  return true;
}

function embeddingInput(row) {
  return [row.title, row.summary, row.chunk_text, Array.isArray(row.keywords) ? row.keywords.join(' ') : ''].filter(Boolean).join('\n\n');
}


async function createEmbeddings(inputs) {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model, input: inputs }),
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OpenAI embedding failed: ${response.status} ${message.slice(0, 300)}`);
  }
  const json = await response.json();
  const data = Array.isArray(json.data) ? json.data : [];
  if (data.length !== inputs.length) throw new Error(`Unexpected embedding count: ${data.length}/${inputs.length}`);
  return data.map((item) => item.embedding);
}

async function embeddingStatusCounts() {
  const counts = {};
  let lastId = null;
  for (;;) {
    let query = supabase
      .from('rag_master_chunks')
      .select('id,metadata,embedding_status')
      .order('id', { ascending: true })
      .limit(1000);
    if (lastId) query = query.gt('id', lastId);
    const { data, error } = await query;
    if (error) throw new Error(`[select embedding status failed] ${error.message}`);
    const rows = data || [];
    for (const row of rows) {
      if (row.metadata?.dataset_version !== datasetVersion) continue;
      if (releaseStage && row.metadata?.release_stage !== releaseStage) continue;
      const key = row.embedding_status || '(empty)';
      counts[key] = (counts[key] || 0) + 1;
    }
    if (!rows.length || rows.length < 1000) break;
    lastId = rows[rows.length - 1]?.id;
  }
  return counts;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;
    const eqIndex = item.indexOf('=');
    const key = (eqIndex > 2 ? item.slice(2, eqIndex) : item.slice(2)).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (eqIndex > 2) out[key] = item.slice(eqIndex + 1);
    else {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) out[key] = true;
      else {
        out[key] = next;
        i += 1;
      }
    }
  }
  return out;
}

main().catch((error) => {
  console.error('[fatal]', error);
  process.exit(1);
});
