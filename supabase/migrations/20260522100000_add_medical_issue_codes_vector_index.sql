-- medical_issue_codes source_area 벡터 인덱스 추가
-- 증상: match_rag_master_chunks RPC가 source_area_filter='medical_issue_codes' 호출 시 HTTP 500 반환
-- 원인: rag_master_chunks.embedding 컬럼에 벡터 인덱스 없음 → 풀스캔 + 코사인 유사도 전체 계산 → statement timeout
-- 해결: partial ivfflat 인덱스로 ANN 검색 활성화

CREATE INDEX IF NOT EXISTS rag_master_chunks_medical_issue_codes_emb_idx
ON rag_master_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)
WHERE source_area = 'medical_issue_codes';
