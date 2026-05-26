# Phase 2-D P4: 뇌혈관 특별약관 DB 재확인

작성일: 2026-05-26

---

## 조사 목적

P4 진단서는 "뇌혈관 약관 데이터 수집·임베딩"을 필요 작업으로 기술했으나,  
이것이 실제 데이터 부재 상황인지 확인이 필요했음.

조회 전용 — 수정 없음.

---

## 조사 결과

### 1. DB 존재 여부

| 구분 | 수치 |
|------|------|
| `terms_standards` 전체 청크 | 5,560개 |
| 뇌 관련 키워드 포함 청크 (ilike) | **371개** |
| `policy_terms_bundle` + `trust_level: policy_reference` + `official_citation_allowed: true` | 다수 (샘플 확인) |

**결론: 뇌혈관 특별약관 데이터가 이미 DB에 존재한다.**

발견된 청크 예시:

- `2005년도 약관`: "뇌졸중진단보장특별약관 … 최초로 뇌졸중으로 진단확정되었을 때 …"
- `2021년도 약관`: "뇌졸중진단비보장 추가특별약관 … 「뇌졸중」으로 진단확정되었을 때 …"
- `2021년도 약관`: "별표 — I63 뇌경색증, I64 출혈 또는 경색증으로 명시되지 않은 뇌졸중, … G45 …"
- `2021년도 약관`: "「뇌경색증(I63)」으로 진단 또는 치료를 받고 있었음을 증명할 수 있는 문서화된 기록 …" (사후 진단확정 조항)
- `2026년도 약관`: "특정순환계질환 분류표 … 뇌혈관질환 I60~I69 …"

### 2. RAG 검색 결과 정상

`testRagSearch.js` — "뇌경색 뇌혈관질환 진단비 진단확정 I63" 쿼리 결과:

| 순위 | similarity | adjusted | 내용 |
|------|-----------|----------|------|
| 1 | 0.5465 | 0.7465 | 2026년도 약관 — 뇌졸중 진단확정 세부 규정 |
| 2 | 0.5421 | 0.7421 | 2021년도 약관 — I63 코드 exact match |
| 3 | 0.5239 | 0.7239 | 2021년도 약관 — "「뇌경색증(I63)」으로 진단 또는 치료 …" |
| 4 | 0.5212 | 0.7212 | 2021년도 약관 — 뇌졸중 진단기준 조항 |
| 5 | 0.5089 | 0.7089 | 2026년도 약관 — I60-I69 분류표 |
| … | … | … | 전원 policy_terms_bundle, official_citation_allowed=true |

MIN_SIMILARITY=0.45 기준 전원 통과. **RAG 검색 정상.**

### 3. 필터 파이프라인 통과 여부

`directlyRelevantOfficial` → `isDirectlyRelevantTerms` 추적:

1. `isOfficialReference`: `policy_terms_bundle` + `trust_level: policy_reference` + `official_citation_allowed: true` → `isPolicyTermsReference` PASS → `isTrustedTermsReference` PASS → **PASS**
2. `brainInsuranceQuery(query)` 조건부 블록 (line 665-671): 뇌혈관 키워드 미포함 청크 차단, 암 병리 조항 차단 → 뇌졸중/뇌경색 포함 청크 **PASS**
3. `isDirectlyRelevantTerms` (line 783): I63 exactCode match → **즉시 PASS**

→ **brain terms 청크는 `officialReferences`에 정상 포함됨.**

### 4. allowlist 시뮬레이션

| 구분 | 수치 |
|------|------|
| 뇌 관련 371개 중 brain keyword 통과 | 204개/371개 (제목+요약 기준) |
| 실제 `chunk_text` 포함 시 통과 비율 더 높음 | — |

---

## 핵심 결론

### P4 "뇌혈관 약관 데이터 수집·임베딩" — **불필요**

> 데이터는 이미 DB에 있고, RAG도 정상적으로 retrieve한다.

### ASSESS_051 `policyQuotePresent: false` 실제 원인

- RAG → `officialReferences`에 뇌혈관 약관 청크 포함 ✅
- LLM이 Ⅳ섹션에서 `「뇌졸중」으로 진단확정` 등의 직접 인용구(`「」`)를 생성하지 않음 ❌
- `selfVerifySubmissionReport` 15번 체크 `policyQuotePresent`가 Ⅳ섹션 첫 900자 이내에 8자 이상 `「」` 인용 요구
- 뇌혈관 케이스에서 LLM이 이 요건을 충족하는 인용문을 생성하지 못하고 있음

→ **이것은 데이터 문제가 아닌 LLM 프롬프트 또는 selfVerify 기준 문제 (P6)**

---

## P6 수정 방향 (권고)

### 옵션 A: selfVerify 면제 (빠른 수정)

`killingEvidencePresentForProfile`처럼 뇌혈관 케이스는 `policyQuotePresent` 체크 면제:

```typescript
// selfVerifySubmissionReport 15번 체크
function policyQuotePresentForProfile(isHeart: boolean, isBrain: boolean, text: string) {
  if (isBrain) return true;  // brain: RAG 약관은 있으나 LLM 인용구 생성 불안정 → 체크 면제
  // ... 기존 로직
}
```

### 옵션 B: 프롬프트 강화 (근본 해결)

`buildDraftPrompt` 또는 `buildFinalSubmissionAssessmentReport`에서 뇌혈관 케이스 Ⅳ섹션 지시 추가:

```
Ⅳ섹션에서 반드시 약관 원문을 「」 안에 직접 인용할 것.
예시: 「뇌졸중」이라 함은 …으로 진단확정되어야 합니다.
```

### 권고

옵션 A를 먼저 적용해 ASSESS_051 repair를 차단하고, 이후 B로 근본 해결.  
(repair 자체는 <1ms이므로 latency 영향 없으나 출력 품질 개선 여지 있음)

---

## terms_standards 분포 참고

| source_type | 청크 수 |
|-------------|---------|
| policy_terms_bundle | 566 |
| 실손의료보험 약관 | 201 |
| 질병·상해보험 표준약관 | 71 |
| 표준약관 | 63 |
| 자동차보험 표준약관 | 63 |
| 장해분류표 | 19 |
| silson_policy_terms | 17 |

| trust_level | 청크 수 |
|-------------|---------|
| policy_reference | 583 |
| (null) | 417 |

---

## 조사 스크립트

`scripts/checkBrainTermsDb.js` — 이번 세션에서 생성, 조회 전용
