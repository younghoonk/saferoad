# Phase 2-D P0+P1 보강 결과 보고

작성일: 2026-05-26  
커밋: `dc09d83`

---

## 작업 범위

P0와 P1 두 건만. P2~P4는 다음 단계.

---

## P0: killingEvidencePresentForProfile 비심장 패스스루

### 원래 진단 (phase2d_consolidation_plan.md)

`selfVerifySubmissionReport()` 15번 체크인 `killingEvidencePresent`가 비심장 케이스에서 항상 `false` 반환 → `repairSubmissionReport()` 강제 실행 (+30~40s 레이턴시).

### 최초 진단 내용의 수정

consolidation_plan에서 P0를 "L2438 헤더 문구 수정(`약관상 진단확정 요소` → `약관상 요구 요건`)"으로 기술했으나, **실제 조사 결과 헤더는 이전 세션에서 이미 수정되어 있었음.**

- `composeSubmissionAssessmentReport` (L3163~3176): isHeart 분기와 비심장 분기 모두 `| 약관상 요구 요건 |` 출력 — 확인 완료
- 실제 repair 트리거는 **`killingEvidencePresentForProfile()`가 비심장 케이스에서 `false` 반환**

### 원인

`extractKillingEvidence()`는 cardiac 전용 evidence(troponin, EKG, CAG/PCI)를 추출하고, 암/뇌 evidence는 각각 pathology 키워드 / DWI·NIHSS 키워드가 있을 때만 추출함. 두 조건 모두 없으면 `killingEvidence = []`.

`killingEvidencePresentForProfile()` 이전 코드:
```typescript
function killingEvidencePresentForProfile(isHeart, argument, text) {
  if (argument.killingEvidence.length === 0) return false;  // 빈 배열이면 무조건 false
  return /cardiac marker|troponin|.../.test(text);
}
```

→ 암 케이스에서 pathology 키워드 없거나, 뇌 케이스에서 DWI/NIHSS 키워드 없으면 항상 `false`.

### 수정

```typescript
function killingEvidencePresentForProfile(
  isHeart: boolean,
  argument: ClaimArgumentStructure,
  text: string,
): boolean {
  // Non-cardiac: killingEvidence extraction is cardiac-only — skip check entirely.
  // Requiring non-empty array would always trigger repair for cancer/brain/disability cases.
  if (!isHeart) return true;
  if (argument.killingEvidence.length === 0) return false;
  return /cardiac marker|EKG|UA-?NSTEMI|NSTEMI|troponin|심근효소|주치의 SOAP|의무기록상 진단 검토/i.test(text);
}
```

**파일:** `supabase/functions/create-assessment-draft/index.ts`

---

## P1: detectAssessmentProfile 암진단비 조기반환

### 문제

ASSESS_046(DLBCL), ASSESS_049(갑상선유두암)처럼 `insuranceType`에 "암진단비"가 명시된 케이스도 `adjusterMemo`나 `damageDescription`에 "기왕증", "인과관계" 등의 키워드가 있으면 `causation_preexisting_injury`로 오라우팅될 위험 존재.

심장(ASSESS_072)에서 동일한 버그가 실제 발생한 전례가 있음.

### 수정

`detectAssessmentProfile()`에서 심장/뇌 조기반환 블록 바로 뒤에 암 추가:

```typescript
const insuranceProductText = [input.insuranceType, input.coverageType, input.accidentType]
  .filter(Boolean).join(' ');
if (/심장질환\s*진단비|허혈성\s*심장질환\s*진단비|심장진단비/i.test(insuranceProductText)) {
  return 'heart_diagnosis_benefit';
}
if (/뇌질환\s*진단비|뇌졸중\s*진단비|뇌경색\s*진단비|뇌진단비/i.test(insuranceProductText)) {
  return 'brain_diagnosis_benefit';
}
if (/암진단비|암\s*진단비/i.test(insuranceProductText)) {  // ← P1 추가
  return 'cancer_diagnosis_benefit';
}
// causation check는 이 아래에서만 실행됨
```

**파일:** `supabase/functions/_shared/detectAssessmentProfile.ts`

---

## Smoke Test 결과

| 케이스 | 내용 | 결과 | 시간 | 비고 |
|--------|------|------|------|------|
| ASSESS_035 | DCIS 유방암 | PASS | 137.5s | 기준 케이스 |
| ASSESS_046 | DLBCL 책임개시일 | PASS | 112.8s | P1 적용 확인, `detectedProfile: cancer_diagnosis_benefit` ✅ |
| ASSESS_049 | 갑상선유두암 책임개시일 | PASS | — | P1 적용 확인 |
| ASSESS_051 | 뇌경색 | PASS | 131.7s | P0 적용 — `killingEvidencePresent: true` ✅ |
| ASSESS_101 | 급성심근경색 gold | PASS | 135.4s | 회귀 없음 |

---

## 미해결 P2~P7 (다음 단계)

| 우선순위 | 항목 | 파일 |
|---------|------|------|
| P2 | `buildCancerInsurerErrorMap` — CUP/원발불명·책임개시일·중복암 블록 추가 | `index.ts` L2612~ |
| P3 | `buildHeartInsurerErrorMap()` 함수화 — 책임개시일/허혈성원인/협심증진행 분기 | `index.ts` L1853~ |
| P4 | 뇌혈관 약관 데이터 수집·임베딩 (진단확정 조항, I60~I69 분류표, TIA 제외) | 데이터 파이프라인 |
| P5 | C80 파싱 정규화 (청크 반복 제거) | RAG pipeline |
| P6 | L2514 isHeart 가드 확인 | `index.ts` |
| P7 | detectAssessmentProfile 중복 패턴 정리 (L101~102, L107~108) | `_shared/detectAssessmentProfile.ts` |

상세: `audit/phase2d_consolidation_plan.md`
