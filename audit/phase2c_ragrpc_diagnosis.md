# Phase 2-C RAG RPC 진단 보고서

작성일: 2026-05-22  
커밋: 이 파일 포함 commit (Option A 코드 변경 + Option B 마이그레이션 포함)

---

## 1. 진단 요약

| 항목 | 내용 |
|------|------|
| 관찰된 증상 | `medical_issue_codes RAG RPC failed: 500` 로그 → 직후 502 반환 |
| 초기 가설 | medical_issue_codes RPC 500이 502를 전파시킴 |
| **실제 근본 원인 (502)** | `callOpenAI` (DRAFT 단계)가 OpenAI 오류로 3회 재시도 후 실패 |
| **medical_issue_codes 500 근본 원인** | rag_master_chunks.embedding에 벡터 인덱스 없음 → 풀스캔 statement timeout |
| medical_issue_codes 500의 502 전파 여부 | **전파 안 됨** — mapWithConcurrency try-catch로 이미 graceful 처리됨 |
| 502 실패 시간 | 10-12초 (callOpenAI 재시도 delay 2+4+6=12초와 정확히 일치) |

---

## 2. 오류 전파 경로 분석

### 2-1. medical_issue_codes RPC 500 경로 (이미 graceful)

```
rpcSearch(source_area='medical_issue_codes')
  → HTTP 500 (statement timeout)
  → throw new Error("RAG RPC failed: 500 body=...")
    ↓
mapWithConcurrency worker try-catch (ragSearch.ts line 1041-1043)
  → console.error('[ragSearch] source_area search FAILED medical_issue_codes ...')
  → return { plan, sorted: [] }   ← graceful empty 반환
    ↓
evidence pack 정상 조립 (officialCount=4 from other source_areas)
```

**결론**: medical_issue_codes 500은 이미 완전히 처리됨. 502 전파 없음.

---

### 2-2. 실제 502 전파 경로 (fc0ab5c 배포 전 상태)

```
evidence pack 로그 (officialCount=4) ← 정상 완료

callOpenAI(DRAFT, full RAG prompt)
  → OpenAI 에러 (5xx or empty content)
  → attempt 1: 실패 → wait 2s
  → attempt 2: 실패 → wait 4s
  → attempt 3: 실패 → wait 6s
  → attempt 4: 실패 → throw HttpError(502)     ← 12초 소요
    ↓
DRAFT try-catch 없음 (fc0ab5c 배포 전)
    ↓
outer catch (line 4103) → HTTP 502 반환
```

**fc0ab5c 배포 후 예상 경로**:
```
callOpenAI(DRAFT, full RAG prompt) → 실패 → throw HttpError(502)
    ↓
DRAFT try-catch catches → console.warn('draft call failed, retrying with reduced prompt')
    ↓
callOpenAI(DRAFT, emptyRagResult) → 성공 가능성 있음 (shorter prompt)
→ 성공 시: 품질 낮은 draft 반환 (RAG 없음)
→ 실패 시: HttpError(502) → outer catch → HTTP 502
```

---

## 3. 실패 패턴 vs 성공 패턴

| 케이스 | insuranceType | accidentType | diagnosisText | 결과 | 시간 |
|--------|--------------|--------------|---------------|------|------|
| ASSESS_004 | 질병보험 | 고지의무/계약해지 | E78 고지혈증 | **PASS** | 33s |
| ASSESS_007 | 질병보험 | 고지의무/계약해지 | D25 자궁근종 | **FAIL** | 12s |
| E78_MIN | 질병보험 | 고지의무/계약해지 | E78 (최소) | **PASS** | 32s |
| E78_SILSON | 실손보험 | 고지의무/계약해지 | E78 고지혈증 | **FAIL** | 11s |
| D25_MIN | 질병보험 | 고지의무/계약해지 | D25 (최소) | **FAIL** | 11s |
| ASSESS_005 | 실손보험 | 고지의무/계약해지 | K29 위염 | **FAIL** | 11s |

**실패 조건:**
- `실손보험` + `고지의무/계약해지` → 진단코드 무관 FAIL
- `D25 계열` + `고지의무/계약해지` → insuranceType 무관 FAIL

**33s PASS vs 11-12s FAIL:**
- PASS (33s): OpenAI가 GPT-4o 생성을 완료 (정상 응답)
- FAIL (11-12s): `callOpenAI` 내부 재시도 delay 합계 2+4+6=12s + 빠른 OpenAI 오류 응답

---

## 4. medical_issue_codes RPC 500 근본 원인

### 원인: 벡터 인덱스 없음

`match_rag_master_chunks` RPC는 `source_area_filter='medical_issue_codes'` 시 다음을 수행:

```sql
WITH filtered AS MATERIALIZED (
  SELECT r.*
  FROM rag_master_chunks r
  WHERE r.embedding IS NOT NULL
    AND r.source_area = 'medical_issue_codes'
    ...
)
SELECT ..., 1 - (f.embedding <=> query_embedding) AS similarity
FROM filtered f
WHERE 1 - (f.embedding <=> query_embedding) >= min_similarity
ORDER BY f.embedding <=> query_embedding
LIMIT match_count;
```

- `rag_master_chunks`에 source_area='medical_issue_codes' 행이 존재함  
  (`syncReferenceDatasetsToRagMaster.js`가 importMedicalIssueCodes.js 데이터를 임베딩해 저장)
- embedding 컬럼에 ivfflat/hnsw 인덱스 없음 (migration 확인)
- medical_issue_codes 행 전체를 메모리에 로드 후 1536차원 코사인 거리 계산
- Supabase REST API statement_timeout 초과 → HTTP 500

### 기여 요인

| 요인 | 내용 |
|------|------|
| 인덱스 없음 | rag_master_chunks.embedding에 벡터 인덱스(ivfflat/hnsw) 미생성 |
| MATERIALIZED CTE | 필터 후 전체 행을 메모리에 적재 — large source_area에 불리 |
| Supabase timeout | 기본 statement_timeout (보통 5-10초)으로 대용량 벡터 연산 제한 |

---

## 5. OpenAI 실패 원인 (미확정)

`callOpenAI`가 D25+고지의무, 실손+고지의무 조합에서 일관적으로 실패하는 원인은 아직 미확정.

**가설 순위:**

| 가설 | 근거 |
|------|------|
| H1: Content filter | D25 자궁근종+고지의무 조합이 OpenAI content policy 트리거 → HTTP 200 + content=null |
| H2: Context window 초과 | 실손보험 고지의무 RAG 조합이 긴 프롬프트 생성 → max_tokens 또는 context limit |
| H3: GPT-4o 모델 변경 | silent model update로 특정 조합에 다른 동작 |
| H4: RAG content 문제 | 실손보험+고지의무 조합의 특정 RAG 청크가 모순된 프롬프트 생성 |

**확인 방법 (fc0ab5c 배포 후):**
1. Supabase Dashboard → Functions → create-assessment-draft → Logs
2. 검색: `"OpenAI returned empty content"` → finish_reason 확인  
   - `content_filter` → 프롬프트 내용 조정 필요
   - `length` → max_tokens 6000으로 축소 검토
   - `stop` + empty → 모델 이상 (GPT-4o 변경)
3. 검색: `"OpenAI API error attempt"` → HTTP 상태코드 확인  
   - 429 → rate limit (이미 재시도 로직 있음)
   - 5xx → OpenAI 서버 오류
4. 검색: `"draft call failed, retrying"` → DRAFT retry 동작 확인

---

## 6. 적용된 수정 사항

### 수정 1: rpcSearch 오류 본문 로깅 (ragSearch.ts)

```typescript
// 수정 전
if (!response.ok) throw new Error(`RAG RPC failed: ${response.status}`);

// 수정 후
if (!response.ok) {
  const body = await response.text().catch(() => '');
  throw new Error(`RAG RPC failed: ${response.status}${body ? ` body=${body.slice(0, 300)}` : ''}`);
}
```

**효과:** RPC 500 발생 시 PostgreSQL 오류 상세 메시지 (statement timeout, OOM 등) 로그에 기록

---

### 수정 2: fetchDisclosureStatuteRows try-catch (ragSearch.ts)

```typescript
// 수정 전
if (disclosureQuery(query)) {
  const statuteRows = await fetchDisclosureStatuteRows(...);
  for (const row of statuteRows) { officialRows.unshift(row); }
  const ensuredRows = ensureDisclosureStatuteRows(officialRows);
  officialRows.splice(0, officialRows.length, ...ensuredRows);
}

// 수정 후
if (disclosureQuery(query)) {
  try {
    const statuteRows = await fetchDisclosureStatuteRows(...);
    for (const row of statuteRows) { officialRows.unshift(row); }
  } catch (fetchErr) {
    console.error('[ragSearch] fetchDisclosureStatuteRows failed, proceeding with fallback only', ...);
  }
  const ensuredRows = ensureDisclosureStatuteRows(officialRows);  // fallback 항상 실행
  officialRows.splice(0, officialRows.length, ...ensuredRows);
}
```

**효과:** 
- `fetchDisclosureStatuteRows` 네트워크 오류 시 502 전파 방지
- `ensureDisclosureStatuteRows`는 try 성공/실패 무관하게 항상 실행 → 상법 651/651-2/655 fallback 항상 포함

---

### 수정 3: SQL 마이그레이션 (Option B)

```sql
-- supabase/migrations/20260522100000_add_medical_issue_codes_vector_index.sql
CREATE INDEX IF NOT EXISTS rag_master_chunks_medical_issue_codes_emb_idx
ON rag_master_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)
WHERE source_area = 'medical_issue_codes';
```

**효과:** medical_issue_codes 벡터 검색에 ANN(Approximate Nearest Neighbor) 인덱스 적용 → statement timeout 해소

---

## 7. 이미 정상 동작 중인 graceful fallback

| 보호 대상 | 코드 위치 | 상태 |
|----------|---------|------|
| 개별 source_area RPC 실패 | `mapWithConcurrency` worker try-catch (ragSearch.ts:1041) | ✅ 이미 처리됨 |
| 전체 RAG 검색 실패 | `getRagResult` try-catch (index.ts:3985) | ✅ 이미 처리됨 |
| DRAFT OpenAI 실패 (1차) | DRAFT try-catch (index.ts:4030) — fc0ab5c | ✅ 커밋됨, 배포 대기 |
| DRAFT OpenAI 실패 (2차) | DRAFT retry 실패 → outer catch → 502 | ⚠️ 불가피 (생성 자체 불가) |
| REVIEW OpenAI 실패 | REVIEW try-catch (index.ts:4082) — 3f78ddc | ✅ 배포됨 |
| fetchDisclosureStatuteRows 실패 | **이번 수정 (수정 2)** | ✅ 적용됨 |

---

## 8. 배포 후 검증 절차

1. **마이그레이션 적용** (Supabase Dashboard → SQL Editor 또는 CLI):
   ```powershell
   supabase db push --project-ref xnbmostitbwntazexpos
   ```

2. **재배포** (create-assessment-draft):
   ```powershell
   supabase functions deploy create-assessment-draft --project-ref xnbmostitbwntazexpos
   ```

3. **단건 eval**:
   ```powershell
   npm.cmd run ai:assessment:eval -- --case ASSESS_007 --retries 1
   npm.cmd run ai:assessment:eval -- --case ASSESS_011 --retries 1
   ```

4. **로그 확인** (Supabase Dashboard → Functions → Logs):
   - `"RAG RPC failed: 500 body="` → PostgreSQL 오류 상세 확인
   - `"OpenAI returned empty content"` → finish_reason 확인
   - `"OpenAI API error attempt"` → HTTP 상태코드 확인
   - `"draft call failed, retrying"` → DRAFT retry 동작 확인

5. **15건 eval**:
   ```powershell
   npm.cmd run ai:assessment:eval -- --limit 15 --retries 2 --delay 2000
   ```

---

## 9. 미해결 사항 (배포 후 로그 기반 확인 필요)

| 항목 | 내용 | 확인 방법 |
|------|------|----------|
| OpenAI 실패 원인 | content_filter vs 5xx vs context_limit | finish_reason / "OpenAI API error" 로그 |
| DRAFT retry 효과 | emptyRagResult 재시도로 TE 감소 여부 | "draft call failed" 로그 + eval 결과 |
| medical_issue_codes 인덱스 효과 | RPC 500 해소 여부 | "RAG RPC failed" 로그 소멸 여부 |
| E78 vs D25/K29 OpenAI 차이 | 왜 E78+질병보험만 통과하는지 | finish_reason + prompt_length 비교 |
