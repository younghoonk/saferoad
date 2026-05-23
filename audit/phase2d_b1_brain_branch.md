# Phase 2D B-1: brain 분기 신설 결과

작성일: 2026-05-23  
커밋: `423177e`  
케이스 파일: `ai_eval/assessment_cases_100_v1.json` (ASSESS_051~056)  
회귀 검증: ASSESS_101 (심장), ASSESS_035 (암)

---

## 1. 구현 요약

`buildClaimArgumentStructure` 분기:
```
if (isHeart)  → cardiac 전용 반박 (6건 고정)
if (isCancer) → buildCancerClaimArgument()
if (isBrain)  → buildBrainClaimArgument()  ← 신설
else          → generic
```

### 신설 함수
| 함수 | 역할 |
|------|------|
| `buildBrainClaimArgument` | brain 분기 진입점 (cancer와 동일 시그니처) |
| `extractBrainDiagnosisContext` | I60~I69/G45, DWI/ADC/MRA, NIHSS/편마비, 뇌연화증, 동맥류, TIA 컨텍스트 추출 |
| `buildBrainInsurerErrorMap` | 뇌혈관 부지급 유형별 구체 반박 (최대 6건) |
| `buildBrainDefenseLayers` | AHA/ASA·KCD·판례·contra proferentem 4개 방어선 |

### 기타 수정
- `KillingEvidenceType`: `brain_imaging`, `neurological_deficit`, `brain_followup` 추가
- `extractKillingEvidence`: brain profile 시 DWI·신경결손·추적뇌연화증 killing evidence 추출
- `extractKeyNumbersForArgument`: brain input 시 NIHSS·병변크기·협착률·동맥류크기 추출
- `isSubmissionMedicalChronologyLine`: DWI/MRI/뇌경색/NIHSS/편마비/동맥류/뇌연화증 추가

---

## 2. Ⅱ섹션 반박 Before / After 비교 (ASSESS_051)

### Before (generic — commit `f10d4b0`)
```
1) [insurerPosition 직접 인용]
   - 오류 유형: omitted_key_evidence
   - 반박 명제: 보험회사는 제출자료 전체가 아니라 일부 문구나 제한된 근거만으로 부지급 판단을 구성한 것으로 보입니다.
2) 약관상 지급요건 미충족 주장
   - 오류 유형: policy_requirement_misread
   - 반박 명제: 부지급을 유지하려면 가입 당시 약관 문언과 고객 자료가 어떻게 불일치하는지 보험회사가 구체적으로 제시해야 합니다.
3) 추가 요건을 전제로 한 지급 거절
   - 오류 유형: unsupported_additional_requirement
   - 반박 명제: 약관에 없는 요건을 사후적으로 추가하여 지급을 제한할 수 없습니다.
```

### After (brain 분기 — commit `423177e`)
```
1) CT 음성을 근거로 뇌경색이 아니라는 주장
   - 오류 유형: medical_criteria_distortion
   - 반박 명제: AHA/ASA 뇌졸중/TIA 진료지침에 따르면 급성기 CT는 허혈성 병변을 초기에 검출하지
     못하는 경우가 흔하며, DWI(확산강조영상)가 급성 뇌경색의 표준 영상진단입니다.
     본 건에서는 DWI에서 급성 허혈성 병변이 확인되어 뇌경색 진단이 이루어진 것입니다.
     CT 음성은 뇌경색을 배제하지 않습니다.
2) 증상 호전을 이유로 TIA에 해당하여 뇌경색 진단을 부정하는 주장
   - 오류 유형: omitted_key_evidence
   - 반박 명제: AHA/ASA 2009 개정 이후 TIA의 정의는 증상 지속 시간이 아닌 조직 기반(tissue-based)
     기준으로, DWI에서 급성 뇌경색 병변이 확인되면 증상이 호전되더라도 TIA가 아닌 뇌경색으로 분류됩니다.
3) 약관상 뇌혈관질환 진단비 지급요건 미충족 주장
   - 오류 유형: policy_requirement_misread
   - 반박 명제: 약관이 요구하는 뇌혈관질환 진단확정은 전문의 진단과 MRI/CT 등 영상검사 결과를
     기초로 한 것입니다. 본 건은 KCD I63.9로 확진되어 요건이 충족됩니다.
4) 약관에 명시되지 않은 추가 조건으로 지급 거절
   - 오류 유형: unsupported_additional_requirement
   - 반박 명제: 보험회사는 약관에 없는 사후적 제한 요건(TIA 분류 재적용, CT 영상 의존 등)을
     부가하여 지급을 제한할 수 없습니다.
```

---

## 3. 케이스별 Ⅱ섹션 반박 확인 (`423177e` 배포 후)

| 케이스 | 보험사 주장 유형 | 구체 반박 트리거 | brain specific 여부 |
|--------|---------------|----------------|-------------------|
| ASSESS_051 | CT 음성, TIA 가능성 | `insurerClaimsTia=T, ctNegative=T, hasDwi=T` | ✓ DWI/AHA-ASA 명시 |
| ASSESS_052 | 증상 호전=TIA | `insurerClaimsTia=T, symptomImproved=T, hasEncephalomalacia=T` | ✓ 조직기반 TIA 정의 + 뇌연화증 |
| ASSESS_053 | 열공성 소경색 경미 | `lesionSmall=T, lesionSize=8mm` | ✓ I63 크기무관 + 약관 중증도 요건 없음 |
| ASSESS_054 | 외상성 출혈 주장 | `isTraumaticBleed=T, lesionLocation=기저핵` | ✓ 기저핵 호발부위 + 고혈압기왕력 |
| ASSESS_055 | 책임개시일 (동맥류) | `hasAneurysm=T, isRuptured=T` | ✓ I67.1 분류표 포함 + 코일색전술 |
| ASSESS_056 | 미파열 실질손상 없음 | `hasAneurysm=T, isUnruptured=T, coilEmbolization=T` | ✓ I67.1 명시 + 약관에 없는 실질손상 요건 |

---

## 4. 회귀 검증 (심장 ASSESS_101 / 암 ASSESS_035)

### ASSESS_101 — 심장 Ⅱ섹션 (전문)
```
1) 급성심근경색 진단기준을 시술 전 효소 상승 여부로 축소
   - 오류 유형: medical_criteria_distortion
   - 반박 명제: Fourth Universal Definition of MI는 troponin rise/fall과 허혈 증상, ECG,
     영상, CAG/PCI 등 허혈 근거를 종합하도록 하며, 시술 전 상승만을 단독 요건으로 두지 않습니다.
2) Unstable angina 또는 CAD 기재만 선택
   - 오류 유형: omitted_key_evidence
   - 반박 명제: 주치의 I21.4 진단서, 흉통, ECG/TMT ST 변화, CAG상 중증 협착, PCI/stent,
     심근효소 자료를 함께 보아야 합니다.
3) 주치의의 객관적 검토 과정 누락
   ...cardiac marker 상승, EKG, UA-NSTEMI 진단 가능성...
4) 약관상 진단확정 요건 미충족
   ...전문의 진단과 병력, 심전도, 관상동맥촬영술, 심장효소검사...
5) 판례 또는 결정례 오용
   ...CAG/PCI와 심근효소 자료가 있는 사안에는...
6) 시술 전 효소 상승 추가 요건화
   ...작성자 불이익 원칙...
```
**판정: ✓ 회귀 없음** — troponin/Fourth Universal Definition/CAG-PCI 구체 반박 6건 유지

### ASSESS_035 — 암 Ⅱ섹션 (전문)
```
1) 병리 보고서 D05.1(상피내암/DCIS)를 근거로 진단서 C50.9 악성 진단 부정
   ...DCIS(ductal carcinoma in situ), high nuclear grade, comedo necrosis, microinvasion,
   종양 크기 2.3cm 소견...수술적 절제, 항호르몬 치료까지 시행된 임상 경과...
2) microinvasion이 의심 소견에 불과하여 확정된 침윤암이 아니라는 주장
   ...high nuclear grade, comedo necrosis 동반, 항호르몬 치료 권고까지 결합한 임상 전체...
3) 진단서 C코드보다 병리 보고서 D코드를 우선 적용
   ...진단서 코드를 병리 보고서 코드로 사후 대체하는 것은 약관에 없는 추가 요건...
4) 약관상 암 진단확정 요건 미충족
   ...DCIS(ductal carcinoma in situ), high nuclear grade, comedo necrosis, microinvasion...
5) 약관에 없는 추가 조건으로 지급 거절
   ...특정 코드 우선 적용, 침윤암 확정 요건 등...
```
**판정: ✓ 회귀 없음** — DCIS/microinvasion/D05.1 vs C50.9 구체 반박 5건 유지

---

## 5. killing evidence 변화

| | Before (generic) | After (brain 분기) |
|--|------------------|--------------------|
| "결정적 의무기록 문구" | 없음 (killing evidence = 0) | **있음** — DWI 병변 + 신경학적 결손 |
| 예시 (051) | — | `DWI에서 급성 허혈성 병변 확인` (decisive) + `구음장애, NIHSS 4` (strong) |

---

## 6. PASS/FAIL 판정

| 케이스 | 프로파일 | Ⅱ섹션 구체 | cardiac 혼입 | 암 혼입 | 7단 구조 | 판정 |
|--------|---------|-----------|------------|--------|---------|------|
| ASSESS_051 | ✓ | ✓ DWI/TIA | 없음 | 없음 | ✓ | **PASS** |
| ASSESS_052 | ✓ | ✓ 뇌연화증/TIA정의 | 없음 | 없음 | ✓ | **PASS** |
| ASSESS_053 | ✓ | ✓ I63 크기무관 | 없음 | 없음 | ✓ | **PASS** |
| ASSESS_054 | ✓ | ✓ 기저핵/외상 반박 | 없음 | 없음 | ✓ | **PASS** |
| ASSESS_055 | ✓ | ✓ 동맥류/I67.1 | 없음 | 없음 | ✓ | **PASS** |
| ASSESS_056 | ✓ | ✓ 미파열/코일색전술 | 없음 | 없음 | ✓ | **PASS** |
| ASSESS_101 | ✓ | ✓ 회귀 없음 | — | — | ✓ | **PASS** |
| ASSESS_035 | ✓ | ✓ 회귀 없음 | — | — | ✓ | **PASS** |

**8/8 PASS**

---

## 7. 남은 후속 과제

| 과제 | 우선순위 | 비고 |
|------|---------|------|
| 뇌혈관 약관 DB 보강 (2012~2016) | 중간 | ASSESS_051~054 Ⅳ섹션 약관 0건 |
| ASSESS_056 약관 연도 문제 | 낮음 | DB 데이터 갭 (기존 issue와 동일) |
| self-verification cardiac hardcode (index.ts:1588) | 높음 | I21.4 regex — 비심장 케이스 repair 유발 |
