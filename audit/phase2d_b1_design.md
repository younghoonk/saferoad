# Phase 2-D B-1: 사정서 생성 공통+분기 설계 진단 보고서

작성일: 2026-05-23  
분석 범위: `supabase/functions/create-assessment-draft/index.ts`  
수정 없음 — 설계/진단 전용

---

## 1. 사정서 생성 전체 흐름 맵

```
buildFinalSubmissionAssessmentReport()  [L1504]
│
├─ buildClaimArgumentStructure()         [L1801]  → ClaimArgumentStructure
│   ├─ buildArgumentChronology()         [L1970]  입력→시간순 사실 정리
│   ├─ extractKillingEvidence()          [L2176]  결정적 증거 추출 ★심장전용
│   ├─ extractKeyNumbersForArgument()    [L2294]  핵심 수치 추출 ★심장전용
│   ├─ keyNumbersFromKillingEvidence()   [L2262]  killing evidence → 수치 ★심장전용
│   └─ findInsurerCitedAuthority()       [L2349]  보험사 인용 판례 탐색
│
├─ buildPreAnalysisResult()              [L1567]  → PreAnalysisResult
│   └─ (argument 구조를 UI용으로 평탄화)
│
├─ composeSubmissionAssessmentReport()  [L2361]  → string (7단 본문)
│   ├─ formatSubmissionChronology()     [L2040]
│   ├─ formatKillingEvidenceForReport() [L2122]
│   ├─ formatCaseLawAndFssSection()     [L2110]
│   └─ officialGroundsByArea()          [ragSearch]
│
├─ enforceSubmissionReportContract()    [L1533]  금지표현 제거
│
└─ selfVerifySubmissionReport()         [L1673]
    └─ [실패 시 1회] repairSubmissionReport()  [L1742]
```

**핵심 갈림길:** `buildClaimArgumentStructure()` 내 `if (isHeart)` 블록 [L1814]  
→ true: 심장 전용 상세 argument 구조 (5개 insurerErrorMap, 5개 defenseLayers 항목)  
→ false: generic 3항목 argument 구조 (암/뇌/장해 공통, 내용 없음)

---

## 2. 공통 vs 심장 전용 구분표

| 함수 | 위치 | 공통/심장전용 | 비고 |
|------|------|------------|------|
| `buildArgumentChronology` | L1970 | ⚠️ fallback 심장전용 | L1984-1988 fallback 문자열 = CAG/PCI/troponin |
| `extractKillingEvidence` | L2176 | **심장전용** | cardiac marker/EKG/troponin/CAG만 추출 |
| `extractKeyNumbersForArgument` | L2294 | **심장전용** | troponin/CK-MB/협착률만 추출 |
| `keyNumbersFromKillingEvidence` | L2262 | **심장전용** | hs-troponin/CK-MB/LM-LAD만 탐색 |
| `extractInsurerQuotedPosition` | L2097 | ⚠️ fallback 심장전용 | L2107 fallback = "시술 전 심근효소..." |
| `buildClaimArgumentStructure` isHeart | L1814 | **심장전용** | 상세 5개 오류 + 5개 defenseLayers |
| `buildClaimArgumentStructure` else | L1907 | generic (빈껍데기) | 3개 generic 오류, 내용 없음 |
| `buildGenericFactMapping` | L2339 | ⚠️ pseudo-공통 | 의료요약 앞 4줄만 나열 |
| `composeSubmissionAssessmentReport` | L2361 | isHeart 분기 다수 | 7개 ternary 분기 |
| `formatSubmissionChronology` | L2040 | isHeart 분기 | cardiac은 4섹션, 비심장은 텍스트 이어붙임 |
| `selfVerifySubmissionReport` | L1673 | isHeart 분기 수정됨 | B-2에서 완화됨 |
| `repairSubmissionReport` | L1742 | isHeart 분기 수정됨 | B-2에서 수정됨 |
| `buildPreAnalysisResult` | L1567 | isHeart 분기 | standardName만 분기, 나머지 공통 |
| `enforceSubmissionReportContract` | L1533 | 공통 | 금지표현 replace |
| `buildArgumentChronology` | L1970 | 공통 | 입력 텍스트 파싱 |

---

## 3. 템플릿 문구 노출 버그 2종

### Bug 1: "핵심 수치는 제출자료에서 확인되는 값만..." 노출

**위치:** `composeSubmissionAssessmentReport` L2389-2391 + L2475-2476

```typescript
// L2389-2391
const repeatedNumbers = argument.factualFoundation.keyNumbers.length
  ? argument.factualFoundation.keyNumbers.map(...).join('\n')
  : '- 핵심 수치는 제출자료에서 확인되는 값만 반복 기재합니다. 확인되지 않은 수치는 생성하지 않습니다.';

// L2475-2476 (항상 렌더링)
'핵심 수치 및 반복 논거',
repeatedNumbers,
```

**원인 연쇄:**
1. `extractKeyNumbersForArgument()` [L2294]: 후보 패턴 3개가 모두 cardiac (`troponin`, `CK-MB`, `협착률`)
2. `keyNumbersFromKillingEvidence()` [L2262]: 후보 패턴 4개 모두 cardiac
3. 암/뇌 케이스 → `keyNumbers = []` → fallback 문구 노출
4. "핵심 수치 및 반복 논거" 섹션 헤더는 isHeart 조건 없이 항상 렌더링됨

**영향:** 모든 비심장 케이스에서 이 LLM 지시 문구가 보고서 본문에 출력됨

---

### Bug 2: "핵심 부지급 사유는 보험회사가...제시해야 합니다.입니다"

**위치:** `composeSubmissionAssessmentReport` L2479

```typescript
`보험회사의 부지급 사유는 「${insurerQuotedPosition}」로 정리됩니다. ... 핵심 부지급 사유는 ${argument.insurerPosition.coreDenialReason}입니다.`
```

**원인 연쇄:**
1. `buildClaimArgumentStructure` else 분기 [L1910]:
   ```typescript
   coreDenialReason: cleanPublicText(input.sourceAnalysis?.denialReason || result.insurerPositionReview) || '보험회사의 부지급 사유',
   ```
2. `input.sourceAnalysis?.denialReason` 없으면 → `result.insurerPositionReview` 사용
3. LLM이 `insurerPositionReview` 필드에 지시 문구 포함된 텍스트 생성:
   - 예: "보험회사가 D코드, 양성 표현, 경계성 또는 제자리암 분류를 이유로 부지급하거나 감액하는 경우, 병리보고서 원문과 가입 당시 약관상...을 함께 **제시해야 합니다**."
4. `cleanPublicText()`는 이 지시 문구를 제거하지 않음
5. 템플릿 `${...}입니다.` → "제시해야 합니다.입니다." 생성

**이것은 두 가지 근본 원인의 합성:**
- A: `insurerPositionReview` → `coreDenialReason`으로 쓰는 매핑이 부적절 (LLM 필드 ≠ 사용자가 말한 실제 부지급 사유)
- B: `cleanPublicText`가 "~해야 합니다" 같은 지시문을 정리하지 않음

---

## 4. Generic 반박 원인

### 심장(ASSESS_101)이 구체적인 이유

`buildClaimArgumentStructure` isHeart=true 분기 [L1814-1904]:
- `coreDenialReason`: 하드코딩 5종 — `시술 전 심근효소 상승 부재`, `Unstable angina`, `PCI 후 troponin`, `약관상 요건 미충족`, `판례 오용`
- `insurerErrorMap`: 5개 항목, 각각 troponin/ECG/CAG 기반 구체 rebuttalThesis
- `defenseLayers.medical.patientFactMapping`: 흉통/troponin/ECG/CAG 4개 항목, `findFactText()`로 실제 입력에서 팩트 추출
- `defenseLayers.policy.policyRequirementMapping`: 심전도/관상동맥/심장효소 5개 요건 매핑
- `extractKillingEvidence()`: 실제 입력 텍스트에서 cardiac 용어 검색하여 "결정적 증거" 추출

### 암/뇌/기타가 generic인 이유

`buildClaimArgumentStructure` else 분기 [L1907-1967]:
- `coreDenialReason`: LLM `insurerPositionReview` 필드 그대로 → 불안정
- `insurerErrorMap`: 3개 고정 generic 문자열 (입력 데이터 미사용)
- `defenseLayers.medical.standard`: 고정 `'제출 의료자료와 전문의 판단, 객관검사, 치료 경과를 종합합니다.'`
- `defenseLayers.medical.patientFactMapping`: `buildGenericFactMapping()` → 의료요약 앞 4줄 나열, criterion 없음
- `defenseLayers.policy.policyRequirementMapping`: 1개 generic 행만 있음
- `extractKillingEvidence()`: cardiac 패턴만 검색 → 항상 empty → killing evidence 없음

**결론:** 암 케이스 반박이 generic한 이유는 `buildClaimArgumentStructure`의 else 분기가 실질적으로 비어있기 때문.  
LLM이 생성한 `result.facts/issues/damageAssessment` 필드는 참조되지 않고, 입력의 `diagnosisText`/`insurerPosition`/`adjusterMemo`도 논증에 쓰이지 않는다.

---

## 5. 공통+분기 설계안 (profileConfig 구조)

### 5-A. 제안 구조

```typescript
type AssessmentProfile = 'heart' | 'cancer' | 'brain' | 'disability' | 'generic';

interface ProfileConfig {
  profileId: AssessmentProfile;

  // Ⅰ. 사건 경위 — 시간순 사실 fallback
  chronologyFallback: string[];

  // 핵심 수치 추출 패턴
  keyNumberPatterns: Array<{ pattern: RegExp; label: string; meaning: string }>;

  // Killing evidence 추출 패턴 목록
  killingEvidenceSpecs: Array<{
    pattern: RegExp;
    fallback: string;
    evidenceType: KillingEvidenceType;
    strategicMeaning: string;
    strength: 'decisive' | 'strong';
  }>;

  // Ⅱ. 보험사 오류 유형 (3~5개)
  insurerErrorMap: (insurerClaim: string, input: ValidatedInput) => InsuranceErrorItem[];

  // Ⅲ. 의학 defense layer
  medicalDefense: {
    standard: string;                     // 적용 의학 기준명
    patientFactPatterns: Array<{ criterion: string; pattern: RegExp }>;
    conclusion: (hasKillingEvidence: boolean) => string;
  };

  // Ⅳ. 약관 defense layer
  policyDefense: {
    requirementRows: Array<{ requirement: string; pattern: RegExp }>;
    conclusion: string;
  };

  // selfVerify 체크 설정
  selfVerifyConfig: {
    medicalStandardPattern: RegExp;
    medicalTablePattern: RegExp;
  };
}
```

### 5-B. 프로파일별 설정 항목

#### heart (현재 구현 수준)
```
keyNumberPatterns: hs-troponin, Troponin T, CK-MB, LM-LAD 협착률
killingEvidence: doctor_soap_note (NSTEMI), lab_trend (troponin), ecg_finding, cag_pci_finding
insurerErrorMap: 5종 (troponin 기준, UA 선택, 주치의 과정, 약관 추가요건, 판례 오용)
medicalDefense.standard: Fourth Universal Definition of Myocardial Infarction 2018
policyRequirements: 5종 (전문의/병력/심전도/관상동맥/심장효소)
```

#### cancer (신규 추가 필요)
```
keyNumberPatterns: Ki-67 %, AJCC 병기(stage), 종양 크기(cm), C코드
killingEvidence:
  - pathology_report: 병리조직검사 결과 (glioblastoma WHO grade 4, IDH-wildtype 등)
  - diagnosis_date: 확정진단일 vs 책임개시일 관계
  - kcd_code: C코드/D코드 확정 기재
insurerErrorMap:
  - 부분절제 → 진단 불완전 주장 → 병리보고서 기준 반박
  - D코드/경계성 주장 → 병리보고서 C코드 확인
  - 면책기간 적용 → 진단확정일 선후 다툼
  - 소액암/유사암 분류 → 약관 질병분류표 기준
medicalDefense.standard: WHO Classification of Tumours + AJCC TNM staging
policyRequirements: 3종 (전문의/조직검사 또는 세포검사/KCD C코드)
```

#### brain (brain_tumor, 교모세포종 등)
```
keyNumberPatterns: WHO grade (1-4), 종양 크기(cm), KPS/ECOG 점수, IDH 상태
killingEvidence:
  - pathology_report: 병리보고서 (WHO grade 4, IDH-wildtype)
  - mri_finding: MRI 소견 (종괴 크기, 위치, 부종)
  - treatment_record: 수술/방사선/항암 시행
insurerErrorMap:
  - 부분절제 → 악성도 불명확 주장
  - 뇌종양 특약 범위 쟁점
  - WHO grade 분류 다툼
medicalDefense.standard: WHO Classification of CNS Tumours 2021
```

#### disability (후유장해)
```
keyNumberPatterns: 장해지급률 %, McKesson/Barthel/mRS 점수, AMA 가이드 인용 등급
killingEvidence:
  - disability_assessment: 장해진단서 + 측정 기준
  - functional_test: ADL/보행/상지기능 등 객관 측정치
insurerErrorMap:
  - 장해 등급 과소 평가
  - 약관상 장해 분류 오적용
  - 영구장해 vs 한시장해 다툼
```

---

## 6. 단계별 수정 계획 + 위험도

### 단계 1 (즉시, 위험도 낮음): 공통 템플릿 노출 버그 수정

| 항목 | 위치 | 수정 내용 | 회귀 위험 |
|------|------|---------|---------|
| 핵심 수치 fallback 제거 | L2389-2392 | `keyNumbers === 0` → 섹션 자체 미렌더링 | 없음 (심장은 keyNumbers 항상 있음) |
| "핵심 수치 및 반복 논거" 헤더 조건화 | L2475 | `keyNumbers.length > 0`일 때만 출력 | 없음 |
| `coreDenialReason` 소스 개선 | L1910 | `insurerPositionReview` 대신 `insurerPosition` 직접 사용 | 낮음 |
| `extractInsurerQuotedPosition` fallback | L2107 | cardiac fallback 제거 → `'보험회사의 부지급 사유'` | 없음 |

검증: ASSESS_039 샘플 재생성 → "핵심 수치는..." 문구 사라짐 확인

---

### 단계 2 (단기, 위험도 중간): cancer 프로파일 키 추출 추가

| 항목 | 위치 | 수정 내용 |
|------|------|---------|
| `extractKeyNumbersForArgument` | L2304 | cancer 패턴 추가 (Ki-67, 종양 크기, 병기) |
| `keyNumbersFromKillingEvidence` | L2264 | cancer 패턴 추가 |
| `extractKillingEvidence` | L2176 | `isCancer` 분기: pathology_report, diagnosis_date, kcd_code 추출 |
| `buildArgumentChronology` fallback | L1984 | isCancer fallback: "조직생검", "병리보고서 확정" |

회귀 위험: `extractKillingEvidence`에 isCancer 분기 추가 시 `isHeart` 분기에 영향 없도록 격리 필요

검증: ASSESS_032, 035, 039, 044, 046, 048 eval 재실행

---

### 단계 3 (중기, 위험도 높음): `buildClaimArgumentStructure` cancer 분기

| 항목 | 설명 |
|------|------|
| `isCancer()` 함수 추가 | `caseProfile === 'cancer_diagnosis_benefit'` 감지 |
| `if (isCancer)` 블록 추가 | isHeart 블록과 병렬 구조, cancer-specific 5종 오류/방어선 |
| `composeSubmissionAssessmentReport` | medicalCriteriaTable cancer 분기 (WHO/AJCC 기준표) |
| `selfVerifySubmissionReport` | cancer 체크 추가 (병리/C코드 언급 여부) |

회귀 위험: **심장(isHeart) 블록에 절대 손대지 말 것** — 기존 if(isHeart) / else 구조에서 if(isHeart) / else if(isCancer) / else 로 확장

검증: ASSESS_101 eval PASS 유지 + 암 케이스 6개 PASS 유지

---

## 7. 현재 샘플에서 관찰되는 품질 이슈 요약 (ASSESS_039 기준)

| 섹션 | 현재 출력 | 이상적 출력 | 원인 |
|------|-----------|-----------|------|
| 핵심 수치 | "핵심 수치는 제출자료에서 확인되는 값만..." | 없음 or Ki-67, 종양 크기 4.5cm | keyNumbers 비어있음 |
| Ⅱ. 부지급 사유 | "핵심 부지급 사유는 ...제시해야 합니다.입니다" | "핵심 부지급 사유는 부분절제로 악성도 단정 불가입니다" | coreDenialReason 소스 오류 |
| Ⅱ. insurerErrorMap | 3개 generic 반박 | glioblastoma WHO grade 4 병리 기준 반박 | else 분기 generic |
| Ⅲ. 의학적 근거 | `result.issues` (LLM 생성 텍스트) | WHO CNS Tumours 2021 기준 + 환자 매핑표 | medicalCriteriaTable = result.issues |
| Ⅳ. 약관 매핑표 | 2행 generic | 전문의/조직검사/C코드 3행 | policyCriteriaTable generic |
| killing evidence | 없음 | 병리보고서 "glioblastoma IDH-wildtype WHO grade 4" | extractKillingEvidence cardiac만 |

---

## 결론

**즉시 수정 가능한 공통 버그 (위험도 낮음):**
1. "핵심 수치..." fallback 텍스트 제거 → 빈 섹션이면 헤더 미출력
2. `coreDenialReason` 소스를 `insurerPositionReview` 대신 `insurerPosition` 직접 사용

**중기 설계 작업 (암 프로파일 분리):**
3. `extractKillingEvidence` cancer 분기 (병리/C코드/책임개시일)
4. `buildClaimArgumentStructure` else if (isCancer) 블록 추가
5. `composeSubmissionAssessmentReport` cancer medicalCriteriaTable

**불변 원칙:**
- `if (isHeart)` 블록은 절대 수정 금지 — 심장 케이스 PASS는 이미 확보됨
- 분기 확장: `if (isHeart)` / `else if (isCancer)` / `else` 구조 유지
- 각 단계 수정 후 ASSESS_101 + 암 케이스 6개 재실행 필수
