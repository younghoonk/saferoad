declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const OPENAI_API_URL = 'https://api.openai.com/v1/embeddings';
const EMBEDDING_MODEL = 'text-embedding-3-small';
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 25;
const MAX_INPUT_CHARS = 8000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type RequestBody = {
  limit?: number;
  source_area?: string | null;
  status?: string | null;
};

type RagChunk = {
  id: string;
  chunk_id: string;
  source_area: string;
  title: string;
  summary: string | null;
  keywords: string | null;
  chunk_text: string | null;
};

class AuthError extends Error {
  status = 401;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function requiredEnv(key: string) {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`${key} is not configured`);
  return value;
}

function requireBackfillAuthorization(req: Request) {
  const authHeader = req.headers.get('authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
  const backfillToken = Deno.env.get('BACKFILL_RAG_EMBEDDINGS_TOKEN');
  if (backfillToken && bearer && bearer === backfillToken) return;
  throw new AuthError('Unauthorized backfill request');
}

function clampLimit(value: unknown) {
  const parsed = Number(value || DEFAULT_LIMIT);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(parsed), MAX_LIMIT);
}

function escapePostgrestValue(value: string) {
  return value.replace(/"/g, '\\"');
}

function buildEmbeddingInput(row: RagChunk) {
  return [
    row.title,
    row.summary,
    row.keywords,
    row.chunk_text,
  ].filter(Boolean).join('\n\n').slice(0, MAX_INPUT_CHARS).trim();
}

function restHeaders(serviceRoleKey: string, prefer?: string) {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

async function restSelect<T>(supabaseUrl: string, serviceRoleKey: string, path: string) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: restHeaders(serviceRoleKey),
  });
  if (!response.ok) {
    throw new Error(`Supabase select failed: ${response.status} ${(await response.text()).slice(0, 300)}`);
  }
  return await response.json() as T;
}

async function restPatch(
  supabaseUrl: string,
  serviceRoleKey: string,
  id: string,
  body: Record<string, unknown>,
) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rag_master_chunks?id=eq.${id}`, {
    method: 'PATCH',
    headers: restHeaders(serviceRoleKey, 'return=minimal'),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Supabase update failed: ${response.status} ${(await response.text()).slice(0, 300)}`);
  }
}

async function restCount(supabaseUrl: string, serviceRoleKey: string, query: string) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rag_master_chunks?select=id&${query}`, {
    method: 'HEAD',
    headers: {
      ...restHeaders(serviceRoleKey),
      Prefer: 'count=exact',
    },
  });
  if (!response.ok) return 0;
  const contentRange = response.headers.get('content-range') || '';
  const total = Number(contentRange.split('/')[1]);
  return Number.isFinite(total) ? total : 0;
}

function buildSelectionQuery(limit: number, sourceArea?: string | null, status?: string | null) {
  const requestedStatus = status || 'pending';
  const statusFilter = requestedStatus === 'any'
    ? 'embedding_status.in.(pending,not_created,error)'
    : `embedding_status.eq.${escapePostgrestValue(requestedStatus)}`;
  const filters = [
    'select=id,chunk_id,source_area,title,summary,keywords,chunk_text',
    `or=(embedding.is.null,${statusFilter})`,
    'order=updated_at.asc',
    `limit=${limit}`,
  ];
  if (sourceArea) filters.push(`source_area=eq.${encodeURIComponent(sourceArea)}`);
  return `rag_master_chunks?${filters.join('&')}`;
}

function buildPendingCountQuery(sourceArea?: string | null) {
  const filters = ['or=(embedding.is.null,embedding_status.in.(pending,not_created,error))'];
  if (sourceArea) filters.push(`source_area=eq.${encodeURIComponent(sourceArea)}`);
  return filters.join('&');
}

async function createEmbedding(apiKey: string, input: string) {
  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OpenAI embedding failed: ${response.status} ${message.slice(0, 300)}`);
  }

  const json = await response.json() as { data?: { embedding?: number[] }[] };
  const embedding = json.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length !== 1536) {
    throw new Error(`Unexpected embedding dimension: ${embedding?.length ?? 0}`);
  }
  return embedding;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'POST only' }, 405);

  try {
    const supabaseUrl = requiredEnv('SUPABASE_URL');
    const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
    const openAiKey = requiredEnv('OPENAI_API_KEY');
    requireBackfillAuthorization(req);

    const body = await req.json().catch(() => ({})) as RequestBody;
    const limit = clampLimit(body.limit);
    const rows = await restSelect<RagChunk[]>(
      supabaseUrl,
      serviceRoleKey,
      buildSelectionQuery(limit, body.source_area, body.status),
    );

    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    for (const row of rows) {
      const input = buildEmbeddingInput(row);
      const now = new Date().toISOString();
      if (!input) {
        skipped += 1;
        await restPatch(supabaseUrl, serviceRoleKey, row.id, {
          embedding_status: 'skipped_empty_text',
          embedding_error: null,
          last_embedding_attempt_at: now,
        });
        continue;
      }

      try {
        const embedding = await createEmbedding(openAiKey, input);
        await restPatch(supabaseUrl, serviceRoleKey, row.id, {
          embedding,
          embedding_status: 'done',
          embedding_model: EMBEDDING_MODEL,
          embedding_created_at: now,
          embedding_error: null,
          last_embedding_attempt_at: now,
        });
        succeeded += 1;
        console.log(`[embedding] done source_area=${row.source_area} title=${row.title.slice(0, 80)}`);
      } catch (rowError) {
        failed += 1;
        const message = rowError instanceof Error ? rowError.message : String(rowError);
        console.error(`[embedding] failed source_area=${row.source_area} title=${row.title.slice(0, 80)} message=${message.slice(0, 200)}`);
        await restPatch(supabaseUrl, serviceRoleKey, row.id, {
          embedding_status: 'error',
          embedding_error: message.slice(0, 1000),
          last_embedding_attempt_at: now,
        });
      }
    }

    const remainingPending = await restCount(
      supabaseUrl,
      serviceRoleKey,
      buildPendingCountQuery(body.source_area),
    );

    return jsonResponse({
      processed: rows.length,
      succeeded,
      failed,
      skipped,
      remaining_pending: remainingPending,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof AuthError ? error.status : 500;
    return jsonResponse({ error: message }, status);
  }
});
