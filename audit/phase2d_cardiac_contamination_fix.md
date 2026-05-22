# Phase 2-D: 암 케이스 심장 판례/용어 혼입 버그 수정

작성일: 2026-05-23  
수정 대상: ASSESS_037(난소암) v2 실험에서 발견된 `2013다208661` 혼입

---

## 1. 버그 원인 분석

### 현상
- ASSESS_037(난소 경계성종양) 사정서에 대법원 2013다208661(NSTEMI/I21.4 심근경색 판례)이 official로 인용됨
- 사정서 본문에 cardiac marker, EKG, NSTEMI, troponin 등 심장 전용 용어 혼입

### 근본 원인 — 3단 낙하산 구조

| 단계 | 위치 | 문제 |
|------|------|------|
| ① RAG 검색 필터 | `ragSearch.ts` `directlyRelevantOfficial()` | `cancerInsuranceQuery`가 갑상선암 한정 → ASSESS_037(D39.1) 미매칭 → 모든 특화 분기 미통과 → `return true` 낙하산으로 심장 판례 통과 |
| ② 내부 자료 필터 | `ragSearch.ts` `directlyRelevantInternal()` precedents 블록 | 동일한 `return true` 낙하산 존재 (내부 판례에도 동일 위험) |
| ③ 결과 후처리 필터 | `create-assessment-draft/index.ts` `sanitizeRagResultForAssessment()` | `cancerDiagnosisProfile` 블록의 `directCancer` 정규식에 "진단확정" 포함 → 심장 판례 제목 "NSTEMI/I21.4 **진단확정** 증명책임"이 cancer 자료로 오인되어 배제되지 않음 |

### `cancerInsuranceQuery` 적용 범위 한계
```typescript
// 기존 — 갑상선 한정
function cancerInsuranceQuery(query: string) {
  return /암보험|암진단비|갑상선암|갑상선\s*결절|C73|E04|D34/i.test(query);
}
// ASSESS_037 쿼리(경계성종양, D39.1) → false → 이 분기 전혀 작동 안 함
```

---

## 2. 수정 내용

### Fix 1: `supabase/functions/_shared/ragSearch.ts` — `directlyRelevantOfficial()`

위치: `return true;` 직전 (terms_standards 분기 다음)

```typescript
// 추가
// Cardiac-specific precedents/guidelines must not appear in non-cardiac queries (e.g. 2013다208661 in cancer cases)
if (!heartDiagnosisQuery(query) && heartInternalText(row)) return false;
return true;
```

**효과:**
- `2013다208661`(NSTEMI/I21.4/troponin 포함) → `heartInternalText(row)` = true
- ASSESS_037 쿼리(심장 키워드 없음) → `heartDiagnosisQuery(query)` = false
- 조건 충족 → `return false` → official에서 배제 ✓
- ASSESS_101 쿼리(심장 케이스) → `heartDiagnosisQuery(query)` = true → 조건 미충족 → `return true` 유지 ✓

### Fix 2: `supabase/functions/_shared/ragSearch.ts` — `directlyRelevantInternal()` precedents 블록

```typescript
// 추가 (심장 전용 fallback 차단, 내부 판례도 동일 위험)
if (!heartDiagnosisQuery(query) && heartInternalText(row)) return false;
return true;
```

### Fix 3: `supabase/functions/create-assessment-draft/index.ts` — `sanitizeRagResultForAssessment()` `cancerDiagnosisProfile` 블록

```typescript
// 추가 (3중 방어: RAG 검색 단계에서 이미 차단되더라도 후처리 안전망)
// Cardiac-specific precedents/guidelines (e.g. 2013다208661 NSTEMI cases) must not appear in cancer assessments
if ((ref.source_area === 'precedents' || ref.source_area === 'medical_guideline') && /NSTEMI|STEMI|I21\.\d|심내막하심근경색|급성심근경색/i.test(text)) return false;
```

**`brainDiagnosisProfile`과의 대칭:** brain 프로파일은 이미 `excludedBrain`에 `심근경색|NSTEMI|I21\.?4`를 포함하고 있었음. 이번 수정으로 cancer 프로파일도 동일 수준으로 맞춤.

---

## 3. 로직 trace — 수정 후 `2013다208661` 경로

| 함수 | 조건 | 결과 |
|------|------|------|
| `directlyRelevantOfficial` | `heartInternalText(row)=true` AND `!heartDiagnosisQuery(암 쿼리)=true` | `return false` → official 배제 |
| `isInternalReviewMaterial` | `strongPrecedentCitation=true` (reviewed+official_citation_allowed) | `return false` → internal도 배제 |
| `sanitizeRagResultForAssessment` | `NSTEMI` in text AND `cancerDiagnosisProfile` | `return false` → 후처리 안전망 |

→ ASSESS_037 사정서에 `2013다208661` 도달 불가 (3중 차단)

---

## 4. 검증

### eval 결과 (배포 후 확인 필요)

| 케이스 | 기대 결과 | 검증 항목 |
|--------|-----------|-----------|
| ASSESS_037 (난소암) | PASS | 사정서에 troponin/NSTEMI/EKG/심근경색 없음, 2013다208661 미인용 |
| ASSESS_101 (심장) | PASS | 2013다208661 여전히 정상 인용 (회귀 없음) |
| ASSESS_002 (갑상선) | PASS | 정상 통과 유지 |

> **참고:** `evalAssessmentDrafts.js`는 원격 Edge Function 호출. 재배포 전 eval은 구배포본 기준.  
> 수정 배포 후 `npm run ai:assessment:eval -- --case ASSESS_037` 실행으로 확인 요망.

### 타입 체크
```
npx.cmd tsc --noEmit → 오류 없음 ✓
```

---

## 5. 회귀 리스크 분석

| 케이스 유형 | 위험 여부 | 근거 |
|-------------|-----------|------|
| 심장 케이스 | 없음 | `heartDiagnosisQuery(query)=true` → Fix 1/2 조건 미충족 |
| 갑상선/암 케이스 | 없음 | `heartInternalText(row)=false` for 암/갑상선 자료 |
| 뇌 케이스 | 없음 | 뇌 프로파일은 이미 별도 배제 조건 있음 |
| 도수치료/백내장 | 없음 | 관련 쿼리 함수로 선처리됨 |

---

## 6. 후속 권고

1. **`cancerInsuranceQuery` 확장 검토 (별도 PR):** D39, 경계성종양, 악성신생물, 소액암 등 비갑상선 암 케이스도 커버하도록 확장하면 기존 allowlist 로직이 정상 작동함
2. **mustNotInclude 확장:** 암 케이스 eval에 `cardiac marker, NSTEMI, troponin, EKG, CAG, PCI` 추가하면 향후 혼입 자동 감지 가능
3. **암 케이스 케이스 정의 일괄 보강:** `assessment_cases_100_v1.json` 암/경계성 케이스에 계약일·병리데이터·부지급 사유 원문 추가 (ASSESS_034, 043, 044 등)
