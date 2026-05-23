# Phase 2D: cancer 판례 필터 allowlist 전환

작성일: 2026-05-23  
커밋: (현재 커밋 참조)  
목적: GIST(C16)/발덴스트롬(C88) 케이스에 2013다208661 심장 판례 혼입 차단

---

## 1. 근본 원인 (재확인)

기존 `cancerDiagnosisProfile` 판례 필터:

```typescript
// 기존 — blocklist 방식 (NSTEMI/I21.\d 키워드만 차단)
if ((ref.source_area === 'precedents' || ref.source_area === 'medical_guideline')
    && /NSTEMI|STEMI|I21\.\d|심내막하심근경색|급성심근경색/i.test(text)) return false;
const directCancer = /...약관|진단비/i;  // 진단비 포함 → 2013다208661 통과
```

문제:
1. `2013다208661` 일부 청크에 `NSTEMI/I21.\d` 키워드 미포함 → blocklist 통과
2. `directCancer`에 `진단비` 포함 → 심장 판례도 `진단비` 언급 → false positive 허용

---

## 2. 수정 내용

### 2-1. ragSearch.ts — generalCancerDiagnosisQuery 판례 allowlist 추가

위치: `directlyRelevantOfficial()`, terms_standards cancer 필터 직후 (~line 657)

```typescript
// 암 쿼리에 심장 판례(2013다208661 NSTEMI 등) 혼입 차단 — allowlist 방식
if (row.source_area === 'precedents' && generalCancerDiagnosisQuery(query)) {
  const text = rowText(row);
  // 심장 키워드 포함 판례 차단 (blocklist first — 고속 경로)
  if (/심근경색|관상동맥|협심증|NSTEMI|STEMI|\bI21\b|트로포닌|troponin|심근효소|CK-MB|심전도/i.test(text)) return false;
  // 암 관련 키워드 없는 판례 차단 (allowlist — 희귀암 GIST/발덴스트롬 포함)
  if (!/암|악성|종양|병리|carcinoma|lymphoma|leukemia|GIST|신경내분비|경계성|제자리|행동양식|암진단비|혈액암|림프종|백혈병|책임개시일|발병시점/i.test(text)) return false;
}
```

효과: `brainInsuranceQuery` 판례 allowlist 와 동일한 구조. brain 케이스에서 검증된 패턴.

### 2-2. index.ts — cancerDiagnosisProfile 필터 강화

위치: line 4416

**Before:**
```typescript
if ((ref.source_area === 'precedents' || ref.source_area === 'medical_guideline')
    && /NSTEMI|STEMI|I21\.\d|심내막하심근경색|급성심근경색/i.test(text)) return false;
const excludedCancer = /도수치료|...|자동차보험/i;
const directCancer = /암|...|원발암|전이암|약관|진단비/i;  // 약관|진단비 포함
```

**After:**
```typescript
// ragSearch allowlist 통과분 2차 방어
const excludedCancer = /도수치료|...|자동차보험|심근경색|관상동맥|협심증|NSTEMI|STEMI|\bI21\b|트로포닌|troponin|심근효소|CK-MB|심전도/i;
// 약관|진단비 제거 — 심장 판례에도 해당 키워드 포함되어 false negative 발생
const directCancer = /암|...|원발암|전이암|혈액암|림프종|백혈병|책임개시일|발병시점/i;
```

변경 요점:
- `excludedCancer`에 심장 키워드 추가 (2차 방어선)
- `directCancer`에서 `약관|진단비` 제거 (false negative 원인)
- `directCancer`에 `혈액암|림프종|백혈병|책임개시일|발병시점` 추가 (혈액암/분쟁시점 쿼리 포괄)

---

## 3. 예상 동작

### ASSESS_033 (GIST C16.2)
- `generalCancerDiagnosisQuery` 감지: C16.2, GIST → true
- `2013다208661` 청크: `심근경색|NSTEMI|트로포닌` 등 심장 키워드 → ragSearch에서 차단
- 잔여 암 판례: GIST, 위장관기질종양, 행동양식 키워드 포함 → 통과
- 기대: cardiac 혼입 0건

### ASSESS_040 (발덴스트롬 C88.0)
- `generalCancerDiagnosisQuery` 감지: C88.0, 발덴스트롬 → true
- `2013다208661` 청크: 심장 키워드 → ragSearch에서 차단
- 잔여 암 판례: 림프종, 혈액암, 악성 키워드 포함 → 통과
- 기대: cardiac 혼입 0건

### ASSESS_101 (심장 I21.4 NSTEMI) — 회귀 테스트
- `generalCancerDiagnosisQuery(query)`: C코드/암 키워드 없음 → false
- 암 판례 필터 미적용 → `2013다208661` 정상 포함
- 기대: 심장 판례 정상 유지

### ASSESS_035 (DCIS C50.9) — 회귀 테스트
- `generalCancerDiagnosisQuery` 감지: C50, 유방암 → true
- `2013다208661`: 심장 키워드 → 차단
- 암 판례: 유방암, DCIS, 제자리암 → 통과
- 기대: cancer 판례 정상 유지, cardiac 0건

### ASSESS_051 (뇌경색 I63.9) — 회귀 테스트
- `generalCancerDiagnosisQuery(query)`: 암 키워드 없음 → false
- `brainInsuranceQuery`: I63 → true (brain 필터 적용)
- 기대: 회귀 없음

---

## 4. 검증 결과 (배포 후 채울 것)

| 케이스 | cardiac 혼입 | 암 판례 | 판정 |
|--------|------------|--------|------|
| ASSESS_033 (GIST) | ? | ? | ? |
| ASSESS_040 (발덴스트롬) | ? | ? | ? |
| ASSESS_031 (점막내암) | ? | ? | ? |
| ASSESS_034 (방광암 T1) | ? | ? | ? |
| ASSESS_035 (DCIS — 회귀) | ? | ? | ? |
| ASSESS_048 (갑상선암 — 회귀) | ? | ? | ? |
| ASSESS_101 (심장 — 회귀) | ? | ? | ? |
| ASSESS_051 (뇌경색 — 회귀) | ? | ? | ? |

---

## 5. 방어선 구조 (완료 후)

```
암 케이스 RAG 판례 필터:
  Layer 1 (ragSearch.ts): generalCancerDiagnosisQuery 감지
    → 심장 키워드 blocklist → false
    → 암 키워드 allowlist → false (없으면)
  Layer 2 (index.ts): cancerDiagnosisProfile
    → excludedCancer (심장 키워드 포함) → false
    → directCancer allowlist → false (없으면)
```

brain 케이스와 동일한 이중 방어 구조.

---

## 6. 관련 커밋

| 커밋 | 내용 |
|------|------|
| `bb75fc6` | 2013다208661 최초 차단 시도 (NSTEMI blocklist) |
| `4471d34` | brain 케이스 암 약관 혼입 차단 (allowlist 방식) |
| 이번 | cancer 판례 allowlist 전환 — GIST/발덴스트롬 cardiac 혼입 차단 |
