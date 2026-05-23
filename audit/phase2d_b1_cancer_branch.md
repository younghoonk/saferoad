# B-1 중기: Cancer 프로파일 분기 추가 — 구현 및 검증 기록

작성일: 2026-05-23  
커밋: `7e67143` (Phase 1 skeleton) + `03e47f9` (Phase 2 패턴)

---

## 1. 배경 및 문제

### 문제
- `buildClaimArgumentStructure`의 `insurerErrorMap`이 심장 케이스만 특화, 암 케이스는 generic fallback 3줄
- ASSESS_035(유방 DCIS) Ⅱ섹션 반박 명제가 "보험회사는 제출자료 전체가 아니라..." 범용 문구
- 입력 데이터(DCIS, microinvasion, comedo necrosis, C50.9 vs D05.1 코드 불일치)가 반박에 전혀 활용 안 됨

### 목표
- 심장 회귀 절대 금지 유지
- `if(isHeart) / else if(isCancer) / else` 구조로 확장
- cancer 분기에서 입력 병리소견 기반 구체 반박 생성

---

## 2. 변경 내용

### Phase 1 커밋 `7e67143` — 구조 skeleton + cancer 로직

| 파일 위치 | 변경 내용 |
|-----------|-----------|
| L92–100 `KillingEvidenceType` | `pathology_finding`, `treatment_record` 추가 |
| L1807 `buildClaimArgumentStructure` | `const isCancer = caseProfile(input) === 'cancer_diagnosis_benefit'` 추가 |
| L1907–1911 (isHeart 블록 직후) | `else if (isCancer)` 분기 추가 → `buildCancerClaimArgument` 호출 |
| 신규 `buildCancerClaimArgument` | cancer 전용 ClaimArgumentStructure 반환 wrapper |
| 신규 `extractCancerDiagnosisContext` | 입력에서 병리 소견 추출: DCIS/microinvasion/comedo necrosis/C코드/D코드/치료 |
| 신규 `buildCancerInsurerErrorMap` | 오류 유형별 병리 소견 인용 반박 6종 |
| 신규 `buildCancerDefenseLayers` | 병리 보고서 기반 의학·약관·판례·해석 방어층 |
| 신규 `extractShortCancerDenialReason` | `coreDenialReason` 1문장 요약 추출 |

### Phase 2 커밋 `03e47f9` — cancer 전용 패턴

| 파일 위치 | 변경 내용 |
|-----------|-----------|
| `extractKillingEvidence` | cardiac 없을 때 `pathology_finding` + `treatment_record` 추출 (DCIS/comedo necrosis/microinvasion/수술 감지) |
| `extractKeyNumbersForArgument` | cancer 입력 시 cardiac 패턴 → cancer 패턴 전환 (종양크기 cm, Ki-67 %, CA 종양표지자, 림프절 전이) |
| `isSubmissionMedicalChronologyLine` | DCIS/carcinoma/조직검사/생검/수술/항암 등 cancer 용어 허용 |

---

## 3. cancer 반박 로직 설계

### `extractCancerDiagnosisContext` 추출 항목

| 항목 | 검출 대상 |
|------|-----------|
| `cCode` | C코드 (C50, C18 등) |
| `dCode` | D코드 (D05, D01 등) |
| `dcis` | DCIS / ductal carcinoma in situ |
| `microinvasion` | microinvasion / 미세침습 |
| `comedoNecrosis` | comedo necrosis |
| `highGrade` | high grade / high nuclear grade / grade 3 |
| `tumorSize` | X.X cm 수치 |
| `hormoneTherapy` | 항호르몬 치료 / tamoxifen 등 |
| `surgery` | 수술 / 절제 / lumpectomy |
| `dCodeDenial` | 보험사가 D코드/제자리암을 이유로 부지급 |
| `microinvasionDenial` | 보험사가 microinvasion 의심 소견이라고 부지급 |
| `codeMismatch` | C코드·D코드 불일치 쟁점 |
| `borderlineDenial` | 경계성/행동양식으로 부지급 |

### `buildCancerInsurerErrorMap` 반박 유형

| 트리거 | 오류 유형 | 반박 핵심 |
|--------|-----------|-----------|
| dCodeDenial \|\| codeMismatch | `medical_criteria_distortion` | 병리 코드 하나로 임상 전체 무시 불가, 병리 소견(DCIS/microinvasion/comedo necrosis/종양크기) 직접 인용 |
| microinvasion \|\| microinvasionDenial | `omitted_key_evidence` | high grade + comedo necrosis + 항호르몬 치료 = 악성 준한 판단 근거 |
| codeMismatch \|\| dCodeDenial | `policy_requirement_misread` | 약관은 진단서 코드 대체 허용 안 함, C50.9 진단서 인용 |
| borderlineDenial | `medical_criteria_distortion` | WHO ICD-O /2·/3 병리 전문의 결정 사항 |
| (공통) | `policy_requirement_misread` | 병리 소견 포함 보고서로 약관 요건 충족 |
| (공통) | `unsupported_additional_requirement` | 작성자 불이익 원칙 |

---

## 4. Before / After 비교 — ASSESS_035 Ⅱ섹션 반박

### Before (배포 전 — generic)

```
1) [insurerClaim 원문]
 - 오류 유형: omitted_key_evidence
 - 반박 명제: 보험회사는 제출자료 전체가 아니라 일부 문구나 제한된 근거만으로 부지급 판단을 구성한 것으로 보입니다.

2) 약관상 지급요건 미충족 주장
 - 오류 유형: policy_requirement_misread
 - 반박 명제: 부지급을 유지하려면 가입 당시 약관 문언과 고객 자료가 어떻게 불일치하는지 보험회사가 구체적으로 제시해야 합니다.

3) 추가 요건을 전제로 한 지급 거절
 - 오류 유형: unsupported_additional_requirement
 - 반박 명제: 약관에 없는 요건을 사후적으로 추가하여 지급을 제한할 수 없습니다.
```

### After (배포 후 — ASSESS_035 v4, 2026-05-23)

```
핵심 부지급 사유는 병리 보고서 코드(D05.1)를 근거로 진단서 C50.9를 배척하고
제자리암 또는 소액 지급만 인정하려는 주장입니다.

1) 병리 보고서 D05.1(상피내암/DCIS)를 근거로 진단서 C50.9 악성 진단을 부정하는 주장
 - 오류 유형: medical_criteria_distortion
 - 반박 명제: 진단확정의 기준은 진단서 코드와 병리 보고서 전체를 종합하여 판단해야 합니다.
   본 건에서는 DCIS(ductal carcinoma in situ), high nuclear grade, comedo necrosis,
   microinvasion, 종양 크기 2.3cm 소견이 확인되며, 수술적 절제, 항호르몬 치료까지
   시행된 임상 경과를 배제하고 병리 코드 하나만으로 일반암 지급을 거절할 수 없습니다.

2) microinvasion이 의심 소견에 불과하여 확정된 침윤암이 아니라는 주장
 - 오류 유형: omitted_key_evidence
 - 반박 명제: microinvasion 의심 소견은 침윤 가능성을 배제하지 않습니다.
   high nuclear grade, comedo necrosis 동반, 항호르몬 치료 권고까지 결합한 임상 전체가
   단순 상피내암 관찰이 아닌 악성에 준한 판단을 지지합니다.

3) 진단서 C코드보다 병리 보고서 D코드를 우선 적용하여 소액 지급만 인정하는 주장
 - 오류 유형: policy_requirement_misread
 - 반박 명제: 약관이 규정하는 진단확정은 병리·임상병리 전문의의 조직검사 등 현미경 소견에
   기초한 것으로, 진단서 코드를 병리 보고서 코드로 사후 대체하는 것은 약관에 없는 추가
   요건입니다. 주치의가 발급한 진단서에는 C50.9가 기재되어 있습니다.

4) 약관상 암 진단확정 요건 미충족 주장
 - 오류 유형: policy_requirement_misread
 - 반박 명제: DCIS(ductal carcinoma in situ), high nuclear grade, comedo necrosis,
   microinvasion, 종양 크기 2.3cm 소견을 포함한 병리 보고서가 제출되어 요건이 충족됩니다.

5) 약관에 명시되지 않은 추가 조건으로 지급 거절
 - 오류 유형: unsupported_additional_requirement
 - 반박 명제: 약관에 없는 사후적 제한 요건(특정 코드 우선 적용, 침윤암 확정 요건 등)을
   부가하여 지급을 제한할 수 없습니다. 작성자 불이익 원칙 적용.
```

**판정: generic → 구체적(병리 소견 직접 인용) 전환 성공** ✅

---

## 5. 검증 결과 — ASSESS_035 v4 (2026-05-23)

| 항목 | 결과 |
|------|------|
| Profile | cancer_diagnosis_benefit ✅ |
| "핵심 수치는 제출자료에서..." 지시문 | NO ✅ (Bug 1 수정 유지) |
| "제시해야 합니다.입니다" 깨진 문구 | NO ✅ (Bug 2 수정 유지) |
| DCIS 인용 | YES ✅ |
| microinvasion 인용 | YES ✅ |
| comedo necrosis 인용 | YES ✅ |
| C50.9 코드 인용 | YES ✅ |
| D05.1 코드 인용 | YES ✅ |
| cardiac troponin 혼입 | NO ✅ |
| cardiac NSTEMI 혼입 | NO ✅ |
| coreDenialReason 요약 | "병리 보고서 코드(D05.1)를 근거로 진단서 C50.9를 배척하고 제자리암 또는 소액 지급만 인정하려는 주장" ✅ |

---

## 6. 심장 회귀 검증 — ASSESS_101 v4 (2026-05-23)

| 항목 | 결과 |
|------|------|
| Profile | heart_diagnosis_benefit ✅ |
| 지시문 누출 없음 | ✅ |
| troponin 정상 인용 | YES ✅ |
| NSTEMI 정상 인용 | YES ✅ |
| 2013다208661 정상 인용 | YES ✅ |
| CAG 정상 인용 | YES ✅ |
| 심장 회귀 | 없음 ✅ |

---

## 7. 남은 과제 (B-1 단계 3 이후)

| 항목 | 우선순위 |
|------|----------|
| 뇌(brain)/후유장해(disability) else if 분기 추가 | 낮음 (현재 generic fallback 유지) |
| cancer `buildArgumentChronology` 전용 format 추가 | 낮음 (현재 generic 출력) |
| ASSESS_046(림프종)/ASSESS_044(직장 NET) 전문 검증 | 다음 eval 라운드 |
| eval 100건 재기준 검증 (FORBIDDEN_PHRASE 등) | 중간 |
