alter table rag_master_chunks
add column if not exists embedding_model text;

alter table rag_master_chunks
add column if not exists embedding_created_at timestamptz;

alter table rag_master_chunks
add column if not exists embedding_error text;

alter table rag_master_chunks
add column if not exists last_embedding_attempt_at timestamptz;

create index if not exists rag_master_chunks_embedding_model_idx
on rag_master_chunks(embedding_model);

create index if not exists rag_master_chunks_embedding_created_at_idx
on rag_master_chunks(embedding_created_at);
