# Phase 2-D 통합 보강 계획 (진단 전용)

작성일: 2026-05-26  
기준: 심장 세트2(069~074) 완료 후, 진단비 3대 마무리 전 최종 점검  
범위: 수정 없음, 진단만

---

## 총평

진단비 3대(암/뇌/심장) 분기 기본 구조는 완성. 다음 3개 축에서 체계적 보강 필요:

| 축 | 심각도 | 핵심 문제 |
|----|--------|----------|
| **특수 법리 쟁점 Ⅱ섹션 미반영** | 높음 | 원발불명/책임개시일/중복암/허혈성원인이 generic 반박으로 덮임 |
| **암 프로파일 오라우팅 위험** | 중간 | 기왕증 키워드 → causation으로 오라우팅, 심장/뇌는 오늘 수정으로 보호됨 |
| **B-2-1 repair loop 버그** | 중간(latency) | 모든 비심장 케이스 repair 항상 실행 (+30~40s) |

---

## [1] 분기 특수 쟁점 — 가장 중요

### 1-A. 함수 구조 현황

| 함수 | 위치(lines) | 특수 쟁점 감지 플래그 | 감지 못하는 쟁점 |
|------|------------|---------------------|----------------|
| `buildCancerInsurerErrorMap` | L2612–2669 | `dCodeDenial`, `microinvasionDenial`, `codeMismatch`, `borderlineDenial` | **원발불명(CUP), 책임개시일, 중복암** |
| `buildBrainInsurerErrorMap` | L2877–3003 | `insurerClaimsTia`, `noSymptomDenial`, `recurrentStrokeDenial`, `classificationTableDenial`, `venousStrokeDenial` | 책임개시일 (뇌 세트 미포함, 현재 무관) |
| `buildHeartInsurerErrorMap` | **없음** | — | **전부** (책임개시일/허혈성원인/협심증진행) |

심장 오류 맵은 `buildClaimArgumentStructure` L1853–1890에 6개 고정 hardcoded. 서브타입 감지 없음.

---

### 1-B. 암 분기 — 감지 못하는 3개 쟁점

#### ASSESS_045 원발불명(C80, CUP)
| 항목 | 내용 |
|------|------|
| 보험사 주장 | "원발 부위 미특정 = 진단 불확정 = 일반암 인정 불가" |
| 현재 Ⅱ섹션 | generic 2개 (진단확정 요건 미충족, 약관 추가 조건 불가) |
| 목표 반박 | "CUP(C80)은 WHO 독립 임상 진단 단위. 원발 미특정 ≠ 진단 불확정. KCD C80 단독으로 악성신생물 확정 가능" |
| 감지 신호 | `adjusterMemo`/`damageDescription`에서 "원발불명", "CUP", "C80", "원발 부위" 키워드 |

#### ASSESS_046 / ASSESS_049 책임개시일 분쟁
| 항목 | 내용 |
|------|------|
| 보험사 주장 | "검진 발견 시점 = 책임개시일 이전 병력 시작, 이미 존재하던 질병" |
| 현재 Ⅱ섹션 | 부분 특화, 발생 시점 법리 미명시 |
| 목표 반박 | "보험사고 = 진단확정일. 검진 이상 소견 = 위험인자 존재 ≠ 진단확정. 대법원 책임개시일 기준(진단확정일) 명시" |
| 감지 신호 | "책임개시일", "면책기간", "이미 존재", "검진 당시", "소급 적용" |

#### ASSESS_047 중복암
| 항목 | 내용 |
|------|------|
| 보험사 주장 | "두 번째 원발암 = 동일 암 재발 또는 전이, 별도 보험사고 불인정" |
| 현재 Ⅱ섹션 | 부분 특화 |
| 목표 반박 | "중복암 = ICD-O 원발부위 코드 상이 = 별개 원발암 = 독립 보험사고. 재발·전이와 구분 기준 명시" |
| 감지 신호 | "중복암", "두 번째 암", "원발 부위 다름", "별개 원발" |

---

### 1-C. 심장 분기 — buildHeartInsurerErrorMap 부재

현재 구조:
```typescript
// buildClaimArgumentStructure L1853–1890 — 6개 고정 hardcoded
// 항상 NSTEMI/I21.4 기준으로만 생성됨
// 책임개시일/허혈성원인/협심증진행 케이스 → 보일러플레이트로 덮임
```

#### ASSESS_066 책임개시일(I21.1)
| 항목 | 내용 |
|------|------|
| 보험사 주장 | "관상동맥 석회화 검진 소견 = 책임개시일 이전부터 심근경색 존재" |
| 현재 Ⅱ섹션 | NSTEMI/시술전 심근효소 boilerplate |
| 목표 반박 | "보험사고 = 심근경색 발생일. 석회화 = 위험인자 ≠ 심근경색 진단. 대법원 책임개시일 = 보험사고 발생일 기준" |
| 감지 신호 | "석회화", "책임개시일", "이미 존재", "검진 당시" |

#### ASSESS_067 허혈성 심부전(I25.5)
| 항목 | 내용 |
|------|------|
| 보험사 주장 | "고혈압이 심부전 원인 = 허혈성심장질환 진단비 불해당" |
| 현재 Ⅱ섹션 | NSTEMI template |
| 목표 반박 | "허혈성 원인 = 다혈관 협착 + 전벽 벽운동 이상. 고혈압 = 배경질환, 직접 원인 아님. 약관은 원인 제한 없음" |
| 감지 신호 | "허혈성", "고혈압 원인", "다혈관 협착", "허혈성 심부전" |

#### ASSESS_065 협심증→심근경색 진행(I21.9)
| 항목 | 내용 |
|------|------|
| 보험사 주장 | "협심증 과거력 = 심근경색은 기존 질병 진행, 최초 진단 시점 분쟁" |
| 현재 Ⅱ섹션 | 부분 특화 |
| 목표 반박 | "트로포닌 상승 = 심근괴사 발생 시점 = 독립 보험사고. 협심증과 심근경색은 별개 진단단위" |

---

### 1-D. 보강 방법 비교

| 방법 | 설명 | 작업량 | 회귀 위험 |
|------|------|--------|----------|
| A. 공통 특수쟁점 모듈 1개 | `buildSpecialDisputeErrors()` — profile 무관 키워드 감지 → 주입 | 중간 | 중간 (범용 → 과적합) |
| **B. 분기별 개별 추가** | cancerErrorMap 3블록 추가, heartErrorMap 함수 신설 | 높음 | 낮음 (각 분기 독립) |

**권장: B (분기별 개별 추가)**  
이유: 원발불명 논거(CUP WHO 기준) ≠ 책임개시일 논거(대법원 발생 기준) — 근거가 근본적으로 달라 공통 모듈화 불가. 분기 독립으로 회귀 위험 최소화.

**구현 포인트:**
- 암: `extractCancerDiagnosisContext()` 함수에 `cupDenial`, `contractDateDispute`, `duplicateCancerDenial` 플래그 추가 → `buildCancerInsurerErrorMap()` 3블록 조건부 추가
- 심장: `buildHeartInsurerErrorMap(ctx, input)` 함수 신설. `adjusterMemo`/`insurerPosition`에서 심장 서브타입 감지

---

## [2] 프로파일 라우팅 — 오라우팅 위험

### 2-A. 현재 라우팅 우선순위

```
① disclosure duty (L53-68)      — allText 검사, 최우선
② 심장/뇌 진단비 조기 반환 (L72-78) — insuranceProductText만 검사 ← 오늘 추가
③ causationSpecific (L80)       — allText: 기왕증, 퇴행성, 기존병력...
④ medical_review_pre_litigation (L87) — allText: 의료자문 (strongCancerSignal 게이트)
⑤ disability (L80, L82)         — allText: 후유장해, 장해지급률...
⑥ 각종 실손/입원 (L93-96)        — allText
⑦ 암/심장/뇌 진단비 (L101-115)   ← 암은 ③까지 돌파해야 여기 도달
```

### 2-B. 취약점 분석

| 트리거 키워드 | 오라우팅 대상 | 심장 보호 | 뇌 보호 | 암 보호 |
|-------------|-------------|----------|--------|--------|
| `퇴행성` | causation_preexisting_injury | ✅ (조기 반환) | ✅ (조기 반환) | ⚠️ 없음 |
| `기왕증` | causation_preexisting_injury | ✅ (조기 반환) | ✅ (조기 반환) | ⚠️ 없음 |
| `의료자문` | medical_review_pre_litigation | ✅ (조기 반환) | ✅ (조기 반환) | ✅ (strongCancerSignal) |
| `후유장해` | disability_benefit | ✅ (조기 반환) | ✅ (조기 반환) | ⚠️ 없음 |

**암진단비가 유일하게 조기 반환 없음.** `기왕증`이 adjusterMemo에 있으면 cancerErrorMap 대신 generic 3-error fallback.

**L87 의료자문 gate 분석:**
- `!strongCancerSignal && /의료자문/` 구조
- 암 케이스: 항상 strongCancerSignal 있으므로 안전 ✅
- 심장/뇌 케이스: 조기 반환으로 L87 도달 전 처리 ✅
- **의료자문은 현재 모두 안전함**

**실제 위험: L80 causationSpecific (기왕증/퇴행성)**
- 암진단비 케이스에서 발병시점/책임개시일 분쟁 시 "기왕증" 등장 가능
- ASSESS_046, ASSESS_049(책임개시일 분쟁 케이스) — adjusterMemo에 관련 키워드 있을 경우 오라우팅

### 2-C. 추가 위험: detectAssessmentProfile 중복 패턴

```typescript
// 심장 패턴 2중 등록 (L101-102, L107-108)
// 암 패턴 2중 등록 (L98-99, L110-111)
// 기능 문제 없으나 코드 스멜, 리팩토링 시 주의
```

### 2-D. 보강 방법

**즉시 필요 (P1):** 암진단비도 insuranceProductText 조기 반환 추가
```typescript
// detectAssessmentProfile L72-78 블록 확장:
const insuranceProductText = ...기존 코드...;
if (/심장질환\s*진단비|허혈성\s*심장질환\s*진단비|심장진단비/i.test(insuranceProductText)) return 'heart_diagnosis_benefit';
if (/뇌질환\s*진단비|뇌졸중\s*진단비|뇌진단비/i.test(insuranceProductText)) return 'brain_diagnosis_benefit';
// 추가할 줄:
if (/암진단비|암\s*진단비|일반암.*진단비|진단비.*일반암/i.test(insuranceProductText)) return 'cancer_diagnosis_benefit';
```

**중기:** 중복 패턴 정리는 3대 완료 후, 전체 eval 백업 후 진행.

---

## [3] 데이터 갭

### 3-A. 우선순위별 목록

| 갭 | 케이스 | 우선순위 | 증상 | 수급 경로 |
|----|--------|---------|------|----------|
| 뇌혈관 진단확정 전용 약관 | ASSESS_051~054, 057~062 | **P0** | Ⅳ섹션 0건 | 표준약관 원문 + 주요 5개 손보사 |
| 자궁경부암 FIGO 2018 청크 | ASSESS_042 | P1 | 난소암 FIGO 청크 오매칭 | FIGO 2018 공식 가이드라인 |
| C80 분류표 반복 파싱 | 암 케이스 다수 | P1 | "C80 C80 C80..." 출력 | 임베딩 전처리 정규화 스크립트 |
| 갑상선암 특약 연도 불일치 | ASSESS_048 | P2 | 2012년 케이스에 2021 약관 매칭 | 2010~2014년 갑상선암 특약 약관 |

### 3-B. 뇌혈관 약관 P0 상세

**현황:**
- terms_standards 5,560건 중 뇌혈관 언급 366건이나 대부분 후유장해 분류표 또는 다질환 나열형 복합약관
- ASSESS_051~054(뇌경색 4건), ASSESS_057/058/062(각 뇌 케이스) → Ⅳ섹션 0건

**필요 청크 3종:**
```
① 뇌혈관질환 진단확정 조항:
   "뇌혈관질환(I60~I69)의 진단확정은 의료법상 의사·치과의사·한의사 자격을 가진 자가
    뇌 영상검사(CT, MRI 등)에 의하여 내려진 진단으로 확인된 경우를 말한다."
   → 연도: 2010~2022년 표준약관 및 삼성화재/현대해상/DB손보/KB손보/메리츠화재

② 뇌혈관질환 분류표 (I60~I69 전체 명시):
   I60 지주막하출혈 / I61 뇌내출혈 / I62 기타 두개내출혈
   I63 뇌경색증 / I65~I66 뇌전동맥 폐색 / I67 기타 뇌혈관질환
   I67.1 미파열뇌동맥류 / I67.5 모야모야병 / I69 뇌혈관질환 후유증

③ TIA 제외 조항 유무 확인:
   있는 경우: "G45 일과성뇌허혈발작은 제외"
   없는 경우: 그 자체가 약관 해석 유리 근거
```

**적재 방법:** `scripts/embedRagDatasetChunks.js --source_area terms_standards --upsert`

### 3-C. C80 반복 파싱 문제

**원인:** 약관 분류표(행·열 구조)가 텍스트 임베딩 시 플래튼되어 `C80 C80 C80 C80 C80` 형태로 동일 코드 반복  
**수정 위치:** 청크 전처리 파이프라인 (scripts/embedRagDatasetChunks.js 또는 상위 파싱 스크립트)  
**수정 방법:** 연속 중복 토큰 정규화 regex (`/(\b[A-Z]\d{2,3}\b)(\s+\1)+/g → '$1 ...'`)

---

## [4] selfVerify 하드코딩 현황

### 4-A. CLAUDE.md 참조 오류 정정

CLAUDE.md: `"selfVerifySubmissionReport() I21.4 regex 하드코딩 → index.ts:1588"`  
→ **L1588은 `enforceSubmissionReportContract`의 헤더 체크 부분.** 실제 selfVerify 이슈는 별도.

**이미 수정된 것 (commits 30e1b42, 771283c — phase2d_hardcoding_audit.md 참조):**
- selfVerify cardiac 헤더 패턴 → isHeart 분기 (L1682, L1696-1698, L1701-1703)
- repair cardiac 약관 문구 → isHeart 가드 (L1765)
- extractKillingEvidence 주치의 trigger 제거 (L2191, L2196)
- compose L2466/2488 isHeart 가드

### 4-B. 남은 버그 2개

**Bug B-2-1 (HIGH, 즉시 수정 권장):**

| | 위치 | 내용 |
|--|------|------|
| selfVerify 체크 | L1699 | `/\|\s*약관상\s*요구\s*요건\s*\|/` |
| 비심장 compose 출력 | **L2438** | **`\| 약관상 진단확정 요소 \|` ← 불일치 ❌** |
| 결과 | 모든 비심장 케이스 | repair 항상 실행 → +30~40초 latency |

수정 방법 (1줄, 리스크 없음):
```typescript
// L2438 변경:
// Before: '| 약관상 진단확정 요소 | 본 건 충족 사실 | 의견 |',
// After:  '| 약관상 요구 요건 | 본 건 충족 사실 | 의견 |',
```

**Bug B-2-2 (LOW, 예방적):**

| 위치 | 증상 | 현황 |
|------|------|------|
| L2514 | `decisiveDoctorEvidence`로 I21.4/NSTEMI 문구 삽입 | 현재 proxy-safe (extractKillingEvidence B-1-E 수정으로 비심장에서 decisiveDoctorEvidence = undefined) |

수정 방법:
```typescript
// L2514: decisiveDoctorEvidence ? → isHeart && decisiveDoctorEvidence ?
```

### 4-C. B-1 설계 과제 (phase2d_hardcoding_audit.md 3항 참조)

비심장 profile 분리 미구현 4개 항목 (selfVerify 암 품질 체크, argument 구조, killing evidence, compose 특화) — 이것이 CLAUDE.md "기술 부채 높음" 항목의 실체. 단기 수정 범위 아님.

---

## 우선순위 종합

| 순위 | 항목 | 위치 | 작업량 | 예상 효과 | 회귀 위험 | 회귀 보호 케이스 |
|-----|------|------|--------|----------|----------|----------------|
| **P0** | B-2-1 repair loop 차단 | L2438 1줄 | 최소 | 전 케이스 latency -30~40s | 없음 | ASSESS_035, 051, 101 |
| **P1** | 암진단비 조기 반환 | detectAssessmentProfile 2줄 | 최소 | 기왕증/퇴행성 오라우팅 차단 | 없음 | ASSESS_035, 046, 049 |
| **P2** | cancer 특수 쟁점 3블록 | buildCancerInsurerErrorMap | 중간 | ASSESS_045/046/047/049 Ⅱ섹션 품질 | 낮음 | ASSESS_035, 039, 044 |
| **P3** | heart 특수 쟁점 함수 신설 | buildHeartInsurerErrorMap 신설 | 높음 | ASSESS_065/066/067 Ⅱ섹션 품질 | 낮음 | ASSESS_101, 063, 069 |
| **P4** | 뇌혈관 약관 데이터 적재 | 데이터 파이프라인 | 높음(수집) | ASSESS_051~062 Ⅳ섹션 복원 | 없음 | — |
| **P5** | C80 파싱 정규화 | 임베딩 파이프라인 | 중간 | 약관 표 노이즈 제거 | 없음 | — |
| **P6** | B-2-2 L2514 isHeart | L2514 1줄 | 최소 | 예방적 (현재 safe) | 없음 | — |
| **P7** | 중복 패턴 정리 | detectAssessmentProfile | 낮음 | 가독성 | 낮음 (전체 eval 필요) | — |

### 절대 보호선
P0~P3 각 단계 후 최소 smoke test: `ASSESS_035` (암), `ASSESS_051` (뇌), `ASSESS_101` (심장 v2 gold)

---

## 작업 순서

```
[즉시 — 1줄 수정]
① L2438 헤더 수정 → 배포 → smoke test (035/051/101)

[단기 — 진단비 3대 마무리 전]
② detectAssessmentProfile 암진단비 조기 반환 → 배포 → smoke test (035/046/049)
③ buildCancerInsurerErrorMap CUP/책임개시일/중복암 3블록 → 배포 → eval 045/046/047/049
④ buildHeartInsurerErrorMap() 신설 (책임개시일/허혈성원인) → 배포 → eval 065/066/067

[중기 — 데이터]
⑤ 뇌혈관 약관 PDF 수집 + 청크 분할 + 임베딩 적재 → eval 051~054, 057~062

[여유]
⑥ C80 파싱 정규화
⑦ B-2-2 L2514 isHeart 가드
⑧ 중복 패턴 정리 (전체 eval 후)
```

---

*이 파일은 진단 전용 메모. 수정은 각 단계 승인 후 별도 세션에서 진행.*
