const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.resolve(process.cwd(), '.env.rag.local') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.rag.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function getRows() {
  const rows = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('rag_master_chunks')
      .select('id,source_area,embedding_status,chunk_text,embedding')
      .range(from, from + pageSize - 1);

    if (error) throw new Error(`rag_master_chunks: ${error.message}`);
    rows.push(...data);
    if (data.length < pageSize) break;
  }

  return rows;
}

function countBy(rows, keyFn) {
  return rows.reduce((counts, row) => {
    const key = keyFn(row);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function printCounts(title, counts) {
  console.log(title);
  for (const [key, value] of Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${key}: ${value}`);
  }
}

async function main() {
  const rows = await getRows();
  const nullEmbeddingDone = rows.filter((row) => row.embedding == null && row.embedding_status === 'done').length;
  const nonNullEmbeddingNotDone = rows.filter((row) => row.embedding != null && row.embedding_status !== 'done').length;
  const emptyChunkText = rows.filter((row) => !String(row.chunk_text || '').trim()).length;

  console.log('RAG embedding checks');
  console.log(`  rag_master_chunks total: ${rows.length}`);
  printCounts('\nembedding_status counts', countBy(rows, (row) => row.embedding_status || '(empty)'));
  printCounts('\nsource_area + embedding_status counts', countBy(rows, (row) => `${row.source_area || '(empty)'} / ${row.embedding_status || '(empty)'}`));
  console.log('\nquality checks');
  console.log(`  embedding null but status=done: ${nullEmbeddingDone}`);
  console.log(`  embedding not null but status!=done: ${nonNullEmbeddingNotDone}`);
  console.log(`  empty chunk_text: ${emptyChunkText}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
