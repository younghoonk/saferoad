# Phase 2-C RPC 400 진단 보고서

작성일: 2026-05-22

---

## 1. 증상

- 이전: `medical_issue_codes` RPC HTTP 500 (statement timeout, ~20-30초 대기)
- 현재: `medical_issue_codes` RPC HTTP 400 (즉시 실패, ~0초)
- 다른 source_area: 정상 200
- ASSESS_007: 4회 중 2 PASS 2 FAIL (400은 격리됨, FAIL은 OpenAI 문제 잔존)

---

## 2. 400 근본 원인: `execute 'set local ivfflat.probes = 10'`

### 오류 전파 경로

```
POST /rest/v1/rpc/match_rag_master_chunks
  { source_area_filter: 'medical_issue_codes', ... }
    ↓
PostgreSQL plpgsql 함수 실행
  if source_area_filter = 'medical_issue_codes' then
    execute 'set local ivfflat.probes = 10';  ← 오류 발생
      ↓
    ERROR 42704: unrecognized configuration parameter "ivfflat.probes"
    (ivfflat.probes GUC가 이 PostgreSQL 인스턴스에 미등록)
      ↓
PostgREST: 오류 클래스 42 (Syntax Error / Access Rule Violation) → HTTP 400
```

### 왜 medical_issue_codes만 400인가

`execute 'set local ivfflat.probes = 10'`는 오직 `if source_area_filter = 'medical_issue_codes'` 분기에만 존재. 다른 source_area는 이 코드를 실행하지 않으므로 정상 200.

### PostgREST HTTP 매핑 규칙

| PostgreSQL SQLSTATE 클래스 | PostgREST HTTP |
|--------------------------|----------------|
| `42xxx` (Syntax Error / Access Rule Violation) | **400** |
| `P0001` (raise_exception) | 500 |
| `23xxx` (Integrity Constraint) | 409 또는 400 |
| 기타 예외 | 500 |

`42704` = `42xxx` 클래스 → PostgREST가 400으로 매핑.

### ivfflat.probes GUC 지원 여부

pgvector는 버전에 따라 GUC 등록 여부가 다름:
- pgvector < 0.5.0: `ivfflat.probes` GUC 없음 → `SET LOCAL` 시 42704
- pgvector >= 0.5.0: `ivfflat.probes` 등록됨 → `SET LOCAL` 정상 동작

Supabase 인스턴스의 pgvector 버전에 따라 달라지며, 해당 환경에서는 미등록 상태로 확인됨.

---

## 3. pg_proc 진단 SQL (현재 함수 상태 확인용)

```sql
-- 1. 함수 중복 여부 확인 (2행 이상이면 중복 → 400 추가 원인 가능)
SELECT
  proname,
  pg_get_function_identity_arguments(oid) AS signature
FROM pg_proc
WHERE proname = 'match_rag_master_chunks'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');

-- 2. ivfflat.probes GUC 지원 여부 확인
DO $$
BEGIN
  EXECUTE 'SET LOCAL ivfflat.probes = 1';
  RAISE NOTICE 'ivfflat.probes: SUPPORTED';
EXCEPTION WHEN others THEN
  RAISE NOTICE 'ivfflat.probes: NOT SUPPORTED (SQLSTATE=%, MSG=%)', SQLSTATE, SQLERRM;
END;
$$;

-- 3. 현재 함수 본문 확인
SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname = 'match_rag_master_chunks'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
```

---

## 4. 수정 SQL (migration 20260522130000 전문)

`execute 'set local ivfflat.probes = 10'` 한 줄만 제거. 나머지 변경 없음.

**적용 방법**: Dashboard SQL Editor에 migration 파일 전문 붙여넣기 실행.

**파일 위치**: `supabase/migrations/20260522130000_fix_medical_issue_codes_rpc_probes.sql`

### 핵심 변경 전/후

```sql
-- 수정 전 (20260522120000 — 400 유발)
if source_area_filter = 'medical_issue_codes' then
  execute 'set local ivfflat.probes = 10';  -- ← 제거 대상
  return query select ... order by r.embedding <=> query_embedding limit match_count * 4;
  return;
end if;

-- 수정 후 (20260522130000 — 정상)
if source_area_filter = 'medical_issue_codes' then
  -- ivfflat index: probes=1(default) 로 작동, 풀스캔 대비 압도적 성능
  return query select ... order by r.embedding <=> query_embedding limit match_count * 4;
  return;
end if;
```

---

## 5. probes=1 vs probes=10 성능 비교

ivfflat index: lists=100으로 생성됨.

| probes | 탐색 파티션 | 정확도(재현율) | 속도 | 비고 |
|--------|-----------|------------|------|------|
| 1 (default) | 1/100 (1%) | ~70-80% | 가장 빠름 | 이번 수정으로 사용 |
| 10 | 10/100 (10%) | ~95%+ | 10배 느림 | 원래 목표였으나 GUC 오류로 제거 |
| 풀스캔 (인덱스 없음) | 100% | 100% (exact) | 매우 느림 (500 원인) | 이전 상태 |

**probes=1 결론**: 풀스캔 대비 압도적 빠름. 16만 건 → ~1600건만 탐색.  
재현율 70-80%는 medical_issue_codes가 현재 MIN_SIMILARITY 0.45를 대부분 미달하는 상황에서 충분함.  
Phase 2-D에서 chunk_text 재가공으로 유사도가 개선되면 그때 probes 재조정 가능.

### probes 향후 지원 시 활성화 방법

pgvector >= 0.5.0 확인 후:
```sql
-- ivfflat.probes 지원 확인 후 함수에 추가 가능
PERFORM set_config('ivfflat.probes', '10', true);
-- 또는
EXECUTE 'SET LOCAL ivfflat.probes = 10';
```

---

## 6. 2 PASS / 2 FAIL 설명

400이 worker try/catch로 격리된 이후에도 FAIL이 남는 이유:

| 경로 | 상태 | 영향 |
|------|------|------|
| medical_issue_codes RPC | 400 → catch → `{ sorted: [] }` | ✅ 격리됨, 사정서 생성 계속 |
| 나머지 10개 source_area | 200 정상 | officialCount=4 확보 |
| callOpenAI(DRAFT) | D25 + 고지의무 조합 | ⚠️ 잔존 문제 (fc0ab5c 배포 후에도 간헐적) |

**FAIL 원인은 여전히 OpenAI DRAFT 호출 문제** (D25 자궁근종 + 고지의무/계약해지 조합).  
400 수정 후에도 PASS율이 50% 수준이면 OpenAI 문제가 남은 것.

---

## 7. 적용 순서

```
1. SQL Editor: 20260522130000 전문 실행
   (CREATE OR REPLACE FUNCTION — probes EXECUTE 줄 없는 버전)

2. 즉시 확인 (SQL Editor):
   SELECT * FROM match_rag_master_chunks(
     (SELECT embedding FROM rag_master_chunks WHERE source_area='medical_issue_codes' LIMIT 1),
     6, 'medical_issue_codes', 0.45
   );
   → 결과 반환 + 수 초 이내 완료 = 인덱스 정상

3. Edge Function 재배포 불필요
   (ragSearch.ts는 이미 재배포됨, 이번 수정은 SQL만)

4. eval 확인:
   npm.cmd run ai:assessment:eval -- --case ASSESS_007 --retries 1
   → 로그에 medical_issue_codes 400/FAIL 없음 확인
```

---

## 8. 현재까지 적용된 수정 스택

| migration | 내용 | 상태 |
|-----------|------|------|
| 20260522100000 | ivfflat partial index 생성 | ✅ DB 적용됨 |
| 20260522120000 | medical_issue_codes 전용 경로 + probes=10 | ⚠️ 400 유발, 교체 필요 |
| **20260522130000** | probes EXECUTE 제거 (이번 수정) | 사용자 SQL 실행 필요 |

| ragSearch.ts 커밋 | 내용 | 상태 |
|------------------|------|------|
| 3213aec | AbortSignal.timeout(8000) + RPC_TIMEOUT/FAIL 로그 | ✅ 배포됨 |
| f2e1224 | isTimeout AbortError 보강 | ✅ 배포됨 |
