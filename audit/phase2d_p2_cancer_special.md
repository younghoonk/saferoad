# Phase 2-D P2: buildCancerInsurerErrorMap 특수쟁점 3블록 추가

작성일: 2026-05-26  
커밋: (이하 참조)

---

## 작업 범위

`extractCancerDiagnosisContext` + `buildCancerInsurerErrorMap` 수정.  
특수 법리 쟁점 3종(CUP/원발불명, 책임개시일, 중복암)을 Ⅱ섹션에서 정면 반박.

---

## Before

특수쟁점 케이스(045/046/047/049)의 Ⅱ섹션은 generic 2개 블록으로만 구성:
1. `policy_requirement_misread` — 약관상 암 진단확정 요건 미충족 (항상)
2. `unsupported_additional_requirement` — 약관 없는 추가 조건 (항상)

핵심 반박 법리(CUP 독립 진단단위 / 진단확정일 기준 / 별개 원발=독립 사고)가  
Ⅱ섹션이 아닌 Ⅲ(의학) 또는 Ⅵ(약관해석) 섹션에 묻혀 있었음.

---

## After: 변경 사항

### 1. `extractCancerDiagnosisContext` — 플래그 3개 추가

```typescript
// 추가된 플래그
const cupDenial = /원발\s*불명|원발부위\s*불명|\bCUP\b|\bC80\b/i.test(allText);
const contractDateDispute = /책임개시일|면책기간|이미\s*존재|검진\s*당시|소급|발병\s*시점/i.test(insurerText);
const duplicateCancerDenial = /중복암|두\s*번째\s*암|별개\s*원발|다발성\s*원발/i.test(insurerText);
```

- `cupDenial`: `allText` 대상 (C80 코드는 diagnosisCode/diagnosisText에도 등장)
- `contractDateDispute`, `duplicateCancerDenial`: `insurerText`(insurerPosition + adjusterMemo) 대상

추가로:
- `malignantHistology`: `allText`에서 adenocarcinoma 등 악성 조직학 소견 추출 → CUP 반박 인용용
- `coreIssue`: cupDenial/contractDateDispute/duplicateCancerDenial 우선 매칭 (기존 코드 분기보다 선행)

### 2. `buildCancerInsurerErrorMap` — 3블록 상단 삽입

기존 코드/병리 블록 앞에 특수쟁점 블록 배치 (주 쟁점이 Ⅱ섹션 상단).

| 블록 | 트리거 | errorType | 핵심 반박 |
|------|--------|-----------|----------|
| CUP | `cupDenial` | `medical_criteria_distortion` | C80 = WHO/KCD 독립 진단단위, 병리 악성 확인으로 요건 충족, 원발 특정 불요 |
| 책임개시일 | `contractDateDispute` | `policy_requirement_misread` | 보험사고 = 진단확정일 기준, 가입 전 소견 ≠ 확정, 입증책임 보험사 |
| 중복암 | `duplicateCancerDenial` | `policy_requirement_misread` | IHC로 별개 원발 확인 = 독립 보험사고, '최초 1회' = 동일 암 기준, 작성자 불이익 |

`_input` → `input` 파라미터 활성화 (contractDate 등 필드 인용용).

---

## Smoke Test 결과

### 특수쟁점 케이스 (전원 PASS)

| 케이스 | 쟁점 | 블록 발동 여부 | Ⅱ섹션 핵심 반박 (Before→After) |
|--------|------|-------------|-------------------------------|
| ASSESS_045 | 원발불명 C80 | `cupDenial` ✅ | generic → "CUP = WHO/KCD 독립 임상 진단단위, adenocarcinoma 악성 확인, 원발 특정 불요" |
| ASSESS_046 | 책임개시일 DLBCL | `contractDateDispute` ✅ | generic → "보험사고=진단확정일 기준, 가입 전 증상≠확정, 입증책임 보험사" |
| ASSESS_047 | 중복암(유방+대장) | `duplicateCancerDenial` ✅ | generic → "IHC 별개 원발=독립 보험사고, '최초 1회'=동일 암 기준, 작성자 불이익" |
| ASSESS_049 | 책임개시일 갑상선 | `contractDateDispute` ✅ | generic → "병리검사일 기준, 가입 전 결절≠암 확정, 입증책임 보험사" |

### 회귀 케이스 (전원 PASS — 특수블록 미발동 확인)

| 케이스 | 타입 | Ⅱ섹션 | 기존 블록 |
|--------|------|--------|---------|
| ASSESS_035 | DCIS 유방암 | 코드/병리 3~4블록 그대로 | dCode, microinvasion, codeMismatch ✅ |
| ASSESS_037 | 경계성종양 | 코드/병리 4블록 그대로 | dCode, microinvasion, borderline ✅ |
| ASSESS_039 | 교모세포종 | 2블록(generic) | 특수블록 미발동 ✅ |
| ASSESS_044 | 직장 NET G2 | borderline + generic | 특수블록 미발동 ✅ |
| ASSESS_051 | 뇌경색 | 뇌 분기 그대로 | cancer 블록 없음 ✅ |
| ASSESS_101 | 심장 gold | PASS | cancer 오염 없음 ✅ |

---

## 미해결 (P3~P7)

| 우선순위 | 항목 |
|---------|------|
| P3 | `buildHeartInsurerErrorMap()` 함수화 — 책임개시일/허혈성원인/협심증진행 분기 |
| P4 | 뇌혈관 약관 데이터 수집·임베딩 |
| P5 | C80 파싱 정규화 |
| P6 | ASSESS_051 `policyQuotePresent: false` (Ⅳ섹션 약관 인용구 미생성, repair 트리거 중) |
| P7 | detectAssessmentProfile 중복 패턴 정리 |
