drop index if exists rag_master_chunks_source_dedupe_idx;

create unique index if not exists rag_master_chunks_chunk_id_uidx
on rag_master_chunks (chunk_id)
where chunk_id is not null;

create unique index if not exists rag_master_chunks_source_dedupe_idx
on rag_master_chunks (
  source_area,
  coalesce(source_type, ''),
  coalesce(title, ''),
  coalesce(source_reference, '')
)
where chunk_id is null;
