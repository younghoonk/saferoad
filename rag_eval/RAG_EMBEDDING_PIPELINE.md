# RAG Embedding And Search Test Pipeline

이 문서는 RAG 실제 연결 전 `rag_master_chunks` embedding 생성과 `match_rag_master_chunks` RPC 검색 테스트 순서를 정리한다.

## 실행 순서

1. Migration 적용

```powershell
supabase db push
```

2. Edge Function 배포

```powershell
supabase functions deploy backfill-rag-embeddings
```

3. Edge Function secrets 설정

```powershell
supabase secrets set OPENAI_API_KEY=...
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...
supabase secrets set BACKFILL_RAG_EMBEDDINGS_TOKEN=...
```

`SUPABASE_URL`은 Supabase Edge Function 기본 환경값을 사용한다.
`BACKFILL_RAG_EMBEDDINGS_TOKEN`은 선택값이지만 설정을 권장한다. 함수 호출 시 `Authorization: Bearer <BACKFILL_RAG_EMBEDDINGS_TOKEN>` 또는 service role key를 사용한다.

4. 현재 embedding 상태 확인

```powershell
npm.cmd run rag:embeddings:check
```

5. Backfill 실행

```powershell
curl -X POST "https://<project-ref>.functions.supabase.co/backfill-rag-embeddings" `
  -H "Authorization: Bearer <BACKFILL_RAG_EMBEDDINGS_TOKEN-or-service-role-key>" `
  -H "Content-Type: application/json" `
  -d "{\"limit\":25,\"status\":\"pending\",\"source_area\":null}"
```

한 번에 최대 50개만 처리한다. 응답의 `remaining_pending`이 0이 될 때까지 반복 실행한다.

6. 검색 테스트

로컬 `.env.rag.local`에 `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`가 있을 때 실행한다.

```powershell
npm.cmd run rag:search:test
```

다른 질의 테스트:

```powershell
npm.cmd run rag:search:test -- "갑상선 결절 건강검진 미고지 갑상선암 고지의무"
```

## 주의

- 이 단계는 embedding 생성과 검색 테스트 전용이다.
- AI 사정서, 종결보고서, 앱 화면에는 아직 RAG 검색 결과를 연결하지 않는다.
- `OPENAI_API_KEY`와 `SUPABASE_SERVICE_ROLE_KEY`는 클라이언트 앱에 노출하지 않는다.
- Edge Function은 chunk text 전체를 로그로 출력하지 않고 title/source_area 정도만 기록한다.
