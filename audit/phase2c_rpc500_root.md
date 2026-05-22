# Phase 2-C RPC 500 근본 원인 정밀 진단

작성일: 2026-05-22  
커밋: ragSearch.ts AbortSignal.timeout 격리 수정 포함

---

## 1. 진단 요약

| 항목 | 내용 |
|------|------|
| 증상 | ASSESS_007 동일 입력 2회: 1회 PASS, 1회 FAIL(transport_error) |
| 로그 패턴 | `[ragSearch] medical_issue_codes RAG RPC failed: 500` → 직후 502 |
| 이전 두 진단 | "500은 try-catch로 graceful 처리됨, 502와 무관" |
| **이전 진단이 놓친 것** | 에러가 코드 경로로 전파되는 것이 아닌, **쿼리가 느려서 500이 올 때까지 걸리는 20-30초가 Edge Function 시간 예산을 소진**시키는 간접 경로 |
| **실제 502 메커니즘** | 느린 의료코드 쿼리 → statement_timeout 전까지 20-30초 소비 → GPT-4o 시간 부족 → Edge Function timeout → 502 |
| **격리 갭** | `rpcSearch` fetch에 타임아웃 없음 → AbortSignal 없이 statement_timeout까지 무조건 대기 |
| **적용한 수정** | `AbortSignal.timeout(8000)` + 에러 로그 구별 |

---

## 2. 실제 502 전파 경로 (간접)

```
[시간 0s] mapWithConcurrency concurrency=4, 11 source_areas 시작

[시간 0s] 4개 슬롯 동시 시작:
  슬롯0: legal_statutes   → 1-3초 완료
  슬롯1: terms_standards  → 1-3초 완료
  슬롯2: fss_dispute_cases → 1-3초 완료
  슬롯3: precedents       → 1-3초 완료

[시간 ~3s] 슬롯들이 다음 item 픽업:
  슬롯X가 medical_issue_codes(index 6) 픽업
  → rpcSearch 호출 → PostgreSQL 풀스캔 시작

[시간 3s ~ 20-30s] ← 이 구간이 핵심
  medical_issue_codes 16만 건 풀스캔 진행 중
  → statement_timeout 타이머 카운트
  → AbortSignal 없음 → fetch는 응답 받을 때까지 무조건 대기
  → 슬롯X는 이 기간 동안 다음 item 처리 불가

[시간 ~20-30s] PostgreSQL statement_timeout 발동
  → HTTP 500 응답 전송
  → rpcSearch: throw Error("RAG RPC failed: 500 body=...")
  → worker try/catch: 정상 catch → return { plan, sorted: [] }
  → ← 에러 전파 자체는 없음! 그러나 시간이 이미 소진됨

[시간 ~30s] mapWithConcurrency 완료 (medical_issue_codes 슬롯 해제)
  → searchRagReferences 완료 → officialCount=4 (다른 source_area에서)

[시간 ~30s] callOpenAI(DRAFT) 시작
  → GPT-4o 응답에 필요한 시간: 20-40s

[시간 ~60-70s] Edge Function 타임아웃(60-150s, tier별) 도달
  → Supabase가 502 강제 반환 ← eval FAIL
```

### 왜 간헐적인가?

| 조건 | 쿼리 소요 | 전체 소요 | 결과 |
|------|----------|----------|------|
| 부하 낮음 (쿼리 빠름) | < statement_timeout → 200 반환 | ~30-40s 내 완료 | PASS |
| 부하 높음 (쿼리 느림) | > statement_timeout → 500 반환 | 20-30s 소비 후 GPT-4o 시간 부족 | 502 FAIL |

---

## 3. `try/catch` 분석 — graceful 처리가 맞지만 시간 비용은 유지됨

```typescript
// ragSearch.ts — worker (현재 코드, 5601386 이후)
const planResults = await mapWithConcurrency(searchPlan, 4, async (plan) => {
  try {
    const rawRows = await rpcSearch(...);  // ← HTTP 500이면 여기서 throw
    ...
    return { plan, sorted };
  } catch (error) {
    // 500 에러는 여기서 올바르게 catch됨 ✅
    console.error('[ragSearch] source_area search FAILED', plan.source_area, ...);
    return { plan, sorted: [] };  // graceful empty 반환 ✅
  }
});
```

**에러 전파**: 없음 ✅  
**시간 비용**: statement_timeout(보통 5-30s) 전체 소비 ❌ ← 갭

```typescript
// rpcSearch — 수정 전 (AbortSignal 없음)
const response = await fetch(`${supabaseUrl}/rest/v1/rpc/match_rag_master_chunks`, {
  method: 'POST',
  headers: restHeaders(serviceRoleKey),
  body: JSON.stringify({...}),
  // signal 없음 → statement_timeout까지 무조건 대기
});
```

---

## 4. MATERIALIZED CTE — ivfflat 인덱스 미사용 원인

사용자가 생성한 인덱스:
```sql
CREATE INDEX rag_master_chunks_medical_issue_codes_emb_idx
ON rag_master_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)
WHERE source_area = 'medical_issue_codes';
```

RPC 함수 실행 계획 (`source_area_filter='medical_issue_codes'` 케이스):
```sql
-- 1단계: MATERIALIZED CTE (rag_master_chunks 직접 스캔)
WITH filtered AS MATERIALIZED (
  SELECT r.*
  FROM rag_master_chunks r
  WHERE r.embedding IS NOT NULL
    AND r.source_area = source_area_filter  ← 파라미터 바인딩
    ...
)
-- 2단계: 구체화된 세트에서 거리 계산
SELECT ..., 1 - (f.embedding <=> query_embedding) AS similarity
FROM filtered f
WHERE 1 - (f.embedding <=> query_embedding) >= min_similarity
ORDER BY f.embedding <=> query_embedding
LIMIT match_count;
```

**인덱스 미사용 이유 2가지:**

| 이유 | 내용 |
|------|------|
| MATERIALIZED 울타리 | 2단계의 `f.embedding <=> query` 연산은 alias `f` 기준 → base table 인덱스 접근 불가 |
| 파라미터 바인딩 | partial index 조건은 `source_area = 'medical_issue_codes'` (리터럴), 1단계 쿼리는 `source_area = $param` (바인딩) → 플래너가 partial index 사용 보장 불가 |

**결론**: 인덱스 생성 후에도 sequential scan + 전체 거리 계산이 계속 발생. RPC 500이 여전히 나오는 이유.

---

## 5. 적용한 코드 수정 (ragSearch.ts)

### 수정 1: RPC_FETCH_TIMEOUT_MS 상수

```typescript
// 수정 전 (없음)

// 수정 후
const RPC_FETCH_TIMEOUT_MS = 8000;
// Per-RPC-call hard cap. Guards against MATERIALIZED-CTE full-scans (e.g. medical_issue_codes 16万件)
// hanging indefinitely when no statement_timeout is set in PostgreSQL.
```

### 수정 2: rpcSearch에 AbortSignal.timeout 추가

```typescript
// 수정 전
const response = await fetch(`${supabaseUrl}/rest/v1/rpc/match_rag_master_chunks`, {
  method: 'POST',
  headers: restHeaders(serviceRoleKey),
  body: JSON.stringify({...}),
  // AbortSignal 없음 → statement_timeout(20-30s) 전까지 무조건 대기
});

// 수정 후
let response: Response;
try {
  response = await fetch(`${supabaseUrl}/rest/v1/rpc/match_rag_master_chunks`, {
    method: 'POST',
    headers: restHeaders(serviceRoleKey),
    body: JSON.stringify({...}),
    signal: AbortSignal.timeout(RPC_FETCH_TIMEOUT_MS),  // ← 8초 초과 시 abort
  });
} catch (fetchErr) {
  const isTimeout = fetchErr instanceof DOMException && fetchErr.name === 'TimeoutError';
  throw new Error(isTimeout
    ? `RAG RPC timeout after ${RPC_FETCH_TIMEOUT_MS}ms source_area=${sourceArea}`
    : `RAG RPC network error source_area=${sourceArea}: ${fetchErr.message}`);
}
```

**효과**:
- 쿼리가 8초 초과 → `AbortSignal.timeout` 발동 → fetch DOMException(TimeoutError) throw
- `rpcSearch` 내부 catch가 Error로 변환 → worker try/catch가 catch → `{ plan, sorted: [] }` 반환
- medical_issue_codes 슬롯: **최대 8초** 소비 (기존 20-30초 → 8초)
- Edge Function 시간 예산 확보 → GPT-4o 호출 정상 완료 → PASS

### 수정 3: 로그 구별

```typescript
// 수정 전
console.error('[ragSearch] source_area search FAILED', plan.source_area, error.message);

// 수정 후
const isTimeout = msg.includes('timeout');
console.error(
  isTimeout ? '[ragSearch] RPC_TIMEOUT' : '[ragSearch] RPC_FAIL',
  { source_area: plan.source_area, error: msg },
);
```

배포 후 로그에서:
- `[ragSearch] RPC_TIMEOUT` → AbortSignal 발동 (쿼리 너무 느림)
- `[ragSearch] RPC_FAIL` → HTTP 500 (statement_timeout 등 다른 원인)

---

## 6. medical_issue_codes 자산 보존 방침

| 항목 | 방침 |
|------|------|
| 영구 제외 | **절대 금지** |
| 검색 대상 | 항상 searchPlan에 포함 |
| 실패 처리 | timeout/500 → 해당 호출만 빈 결과, 나머지 source_area 정상 진행 |
| 의의 | KCD 4-9차 전체 + 신구대조표 → 경계성종양/제자리암 차수별 재분류 추적에 필수 |
| 현재 활용도 | 낮음 (유사도 0.32 수준, MIN_SIMILARITY 0.45 미달) — Phase 2-D 재가공 대상 |

---

## 7. 신구대조표 활용 가치 + Phase 2-D 재가공 권고

### 현재 chunk_text 구조 (추정)

```
코드: D23.5
질병명: 피부의 기타 양성 신생물 — 체간
KCD 9차 (2022년~)
```

**문제**: 단순 "코드+질병명" 1줄 → 임베딩이 분쟁 맥락과 유사도 낮음 (0.32)

### 신구대조표가 담겨야 할 정보 (4~9차 각각)

```
D23.5 피부의 기타 양성 신생물 — 체간
→ KCD 4차: C44.5 (악성) 코드로 분류될 수 있었음
→ KCD 8차→9차 개정: D23.5 경계성→D04.5 제자리암 재분류
→ 보험 약관 적용: 가입 당시 차수 기준 — C코드/D코드/양성신생물 구분 분쟁 발생
→ 분쟁 핵심: "암 진단비" vs "기타신생물" 지급 여부
```

**임베딩하면 유사도**: "경계성종양 D코드 암 진단비 차수 개정 재분류 분쟁" 쿼리에서 0.6+ 예상

### Phase 2-D 재가공 방향 (진단/권고만, 실행은 별도)

| 작업 | 내용 |
|------|------|
| chunk_text 보강 | 코드+질병명+차수+분쟁맥락+재분류이력 복합 텍스트 생성 |
| 신구대조 pair 추가 | 4→5→6→7→8→9차 개정별 코드 변경 쌍을 별도 chunk로 저장 |
| 분쟁 키워드 주입 | "암 진단비 지급 기준", "경계성종양", "제자리암", "차수 기준 약관" 등 |
| 재임베딩 | 보강된 chunk_text 기준 재계산 |
| 기대 효과 | 유사도 0.32 → 0.55+ 달성 → MIN_SIMILARITY 통과 → baseline 암 카테고리 75% 개선 기여 |

---

## 8. 사용자 조치 필요 사항 (SQL/배포 — 코드 수정에 포함 안 됨)

### SQL 조치 1: ANALYZE 실행 (즉시)

인덱스 생성 직후 테이블 통계가 없으면 플래너가 seq scan 선택 가능. ANALYZE로 통계 갱신 필요.

```sql
ANALYZE rag_master_chunks;
-- 또는 medical_issue_codes만
ANALYZE rag_master_chunks (embedding);
```

### SQL 조치 2: RPC 함수 최적화 (권고)

MATERIALIZED CTE 제거 + source_area별 분기로 partial index 활성화:

```sql
CREATE OR REPLACE FUNCTION public.match_rag_master_chunks(...)
LANGUAGE plpgsql STABLE AS $function$
BEGIN
  -- medical_issue_codes 전용 경로: partial ivfflat 인덱스 활용
  IF source_area_filter = 'medical_issue_codes' THEN
    RETURN QUERY
    SELECT id, source_area, source_type, title, summary, chunk_text, keywords,
           source_url, page_no, trust_level,
           1 - (embedding <=> query_embedding) AS similarity
    FROM rag_master_chunks
    WHERE source_area = 'medical_issue_codes'   -- ← 리터럴로 partial index 매칭
      AND embedding IS NOT NULL
      AND coalesce(metadata->>'release_stage', 'active') <> 'deprecated'
    ORDER BY embedding <=> query_embedding
    LIMIT match_count;
    -- min_similarity 후처리는 caller(rpcSearch)가 담당
    RETURN;
  END IF;

  -- 기존 경로 유지 (MATERIALIZED CTE)
  ...
END;
$function$;
```

**주의**: 위 SQL은 설계 방향이며 migration 적용 전 검토 필요.

### 배포 순서 (권고)

```
1. ANALYZE rag_master_chunks  (즉시 — 10초 이내)
2. Edge Function 재배포 (AbortSignal.timeout 적용)
3. ASSESS_007 단건 eval → RPC_TIMEOUT 로그 확인
4. 필요 시 RPC 함수 SQL 최적화 적용
```

---

## 9. 배포 후 로그 패턴 (기대)

### AbortSignal 발동 시 (8초 초과 쿼리)

```
[ragSearch] RPC_TIMEOUT { source_area: "medical_issue_codes", error: "RAG RPC timeout after 8000ms source_area=medical_issue_codes" }
```

→ 정상 격리. 사정서 생성 계속 진행.

### HTTP 500 수신 시 (statement_timeout 또는 기타)

```
[ragSearch] RPC_FAIL { source_area: "medical_issue_codes", error: "RAG RPC failed: 500 source_area=medical_issue_codes body={\"code\":\"57014\",...}" }
```

→ statement timeout (`code: "57014"`) 확인 가능. 이 경우도 정상 격리.

### SQL 최적화 적용 후 (기대)

```
// medical_issue_codes 로그 없음 = ivfflat ANN 검색 성공, 2-3초 이내 완료
```

---

## 10. 격리 보호 레이어 현황 (수정 후)

| 레이어 | 위치 | 보호 내용 | 상태 |
|--------|------|----------|------|
| **AbortSignal.timeout(8000)** | rpcSearch fetch | 쿼리 무한 대기 방지 | ✅ 이번 수정 |
| worker try/catch | ragSearch.ts:1057 | HTTP 500 catch → empty result | ✅ 5601386 |
| mapWithConcurrency allSettled | ragSearch.ts:998 | 슬롯 이상 전파 방지 | ✅ 기존 |
| `if (!entry) continue` | ragSearch.ts:1063 | undefined entry 건너뜀 | ✅ 5601386 |
| getRagResult outer catch | index.ts:3985 | searchRagReferences 전체 실패 | ✅ d667a79 |
| DRAFT try/catch + retry | index.ts:~4030 | OpenAI 실패 graceful | ✅ fc0ab5c |
