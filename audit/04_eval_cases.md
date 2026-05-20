# SafeRoad Eval 케이스 정의 보고서

작성일: 2026-05-21  
데이터: `ai_eval/assessment_cases_100_v1.json` (100건)  
Gold fixture: `ai_eval/gold_answers/acute_mi_submission_report_gold_redacted.json`  
Core smoke subset: `ai_eval/assessment_subset_core_10.json`

---

## 1. 전체 케이스 분포

| 카테고리 | 케이스 수 | ID 범위 |
|----------|-----------|---------|
| 계약전 알릴의무 | 15 | ASSESS_001 ~ 015 |
| 실손보험 부지급 | 15 | ASSESS_016 ~ 030 |
| 암/경계성/제자리암 진단비 | 20 | ASSESS_031 ~ 050 |
| 뇌질환 진단비 | 12 | ASSESS_051 ~ 062 |
| 심장질환 진단비 | 12 | ASSESS_063 ~ 074 |
| 후유장해 | 12 | ASSESS_075 ~ 086 |
| 기왕증/인과관계/상해성 | 8 | ASSESS_087 ~ 094 |
| 의료자문/소송 전 분쟁해결 | 6 | ASSESS_095 ~ 100 |

---

## 2. 전체 케이스 목록 (100건)

### 계약전 알릴의무 (ASSESS_001 ~ 015)

| ID | 진단명/ICD | 보험 유형 | 보험사 | 프로파일 |
|----|-----------|---------|--------|---------|
| ASSESS_001 | M47.26 신경뿌리병증을 동반한 요추증 | 실손보험 | 메리츠화재 | m47_disclosure |
| ASSESS_002 | C73 갑상선 결절 → 갑상선암 | 암보험 | 삼성화재 | thyroid_disclosure_cancer |
| ASSESS_003 | I10 고혈압 투약 | 질병보험 | DB손해보험 | disclosure_duty |
| ASSESS_004 | E78 고지혈증 검사수치 | 질병보험 | 현대해상 | disclosure_duty |
| ASSESS_005 | K29 위염 1회 치료 | 실손보험 | KB손해보험 | disclosure_duty |
| ASSESS_006 | N63 유방결절 건강검진 | 암보험 | 흥국화재 | disclosure_duty |
| ASSESS_007 | D25 자궁근종 수술 | 질병보험 | 한화손해보험 | disclosure_duty |
| ASSESS_008 | R73 당뇨 전단계 검진수치 | 질병보험 | 삼성생명 | disclosure_duty |
| ASSESS_009 | G47 수면장애 진료 | 질병보험 | 라이나생명 | disclosure_duty |
| ASSESS_010 | F32 우울증 상담 | 질병보험 | 신한라이프 | disclosure_duty |
| ASSESS_011 | M54 허리통증 MRI 권유 | 실손보험 | 메리츠화재 | disclosure_duty |
| ASSESS_012 | (미상) 건강검진 재검 권유 | 암보험 | 교보생명 | disclosure_duty |
| ASSESS_013 | K80 담석증 | 질병보험 | 농협손해보험 | disclosure_duty |
| ASSESS_014 | K76 지방간 | 질병보험 | 한화생명 | disclosure_duty |
| ASSESS_015 | D12 대장용종 절제 이력 | 암보험 | AIA생명 | disclosure_duty |

### 실손보험 부지급 (ASSESS_016 ~ 030)

| ID | 진단명/ICD | 보험 유형 | 보험사 | 프로파일 |
|----|-----------|---------|--------|---------|
| ASSESS_016 | M54 도수치료 | 실손보험 | 현대해상 | indemnity_manual_therapy_denial |
| ASSESS_017 | H25 백내장 다초점렌즈 | 실손보험 | DB손해보험 | indemnity_cataract_multifocal_lens_denial |
| ASSESS_018 | M77 체외충격파 | 실손보험 | KB손해보험 | indemnity_denial |
| ASSESS_019 | (미상) 비급여 주사치료 | 실손보험 | 삼성화재 | indemnity_denial |
| ASSESS_020 | (미상) 영양수액 | 실손보험 | 메리츠화재 | indemnity_denial |
| ASSESS_021 | (미상) MRI 검사비 | 실손보험 | 롯데손해보험 | indemnity_denial |
| ASSESS_022 | (미상) 신경차단술 | 실손보험 | 흥국화재 | indemnity_denial |
| ASSESS_023 | (미상) 경막외신경성형술 | 실손보험 | DB손해보험 | indemnity_denial |
| ASSESS_024 | (미상) 요양병원 암 입원비 | 실손보험 | 한화손해보험 | indemnity_denial |
| ASSESS_025 | (미상) 피부 레이저 | 실손보험 | 현대해상 | indemnity_denial |
| ASSESS_026 | G47 수면다원검사 | 실손보험 | KB손해보험 | indemnity_denial |
| ASSESS_027 | K07 턱관절 치료 | 실손보험 | 삼성화재 | indemnity_denial |
| ASSESS_028 | E66 비만치료 | 실손보험 | 농협손해보험 | indemnity_denial |
| ASSESS_029 | (미상) 검사 목적 입원 | 실손보험 | 메리츠화재 | indemnity_denial |
| ASSESS_030 | (미상) 중복가입 비례보상 | 실손보험 | 현대해상 | indemnity_denial |

### 암/경계성/제자리암 진단비 (ASSESS_031 ~ 050)

| ID | 진단명/ICD | 보험 유형 | 보험사 | 프로파일 |
|----|-----------|---------|--------|---------|
| ASSESS_031 | D12 대장 용종 high grade dysplasia 제자리암 | 암보험 | 삼성생명 | cancer_borderline_in_situ |
| ASSESS_032 | (미상) 대장점막내암 일반암/제자리암 | 암보험 | 교보생명 | cancer_borderline_in_situ |
| ASSESS_033 | (미상) 직장유암종 경계성종양 | 암보험 | 한화생명 | cancer_borderline_in_situ |
| ASSESS_034 | D09 비침습성 방광암 제자리암 | 암보험 | DB손해보험 | cancer_borderline_in_situ |
| ASSESS_035 | D05 유방상피내암 DCIS | 암보험 | 삼성화재 | cancer_borderline_in_situ |
| ASSESS_036 | C73 갑상선암 림프절 전이 | 암보험 | 흥국생명 | cancer_diagnosis_benefit |
| ASSESS_037 | D39 난소 경계성종양 | 암보험 | 라이나생명 | cancer_borderline_in_situ |
| ASSESS_038 | D37 GIST 위장관기질종양 | 암보험 | 미래에셋생명 | cancer_borderline_in_situ |
| ASSESS_039 | D35 뇌하수체 종양 | 암보험 | 교보생명 | cancer_diagnosis_benefit |
| ASSESS_040 | C18 대장암 조직검사 전 임상진단 | 암보험 | 한화손해보험 | cancer_diagnosis_benefit |
| ASSESS_041 | (미상) 위 선종 high grade dysplasia ESD | 암보험 | 삼성생명 | cancer_borderline_in_situ |
| ASSESS_042 | D06 자궁경부 제자리암 | 암보험 | 현대해상 | cancer_borderline_in_situ |
| ASSESS_043 | D03 흑색종 제자리암 | 암보험 | KB손해보험 | cancer_borderline_in_situ |
| ASSESS_044 | (미상) 병리 행동양식 /2와 코드 불일치 | 암보험 | 메리츠화재 | cancer_borderline_in_situ |
| ASSESS_045 | (미상) 전이암 원발부위 기준 | 암보험 | 흥국화재 | cancer_diagnosis_benefit |
| ASSESS_046 | (미상) 재발암과 새로운 원발암 구분 | 암보험 | 삼성화재 | cancer_diagnosis_benefit |
| ASSESS_047 | (미상) 다발성 원발암 진단비 | 암보험 | 한화생명 | cancer_diagnosis_benefit |
| ASSESS_048 | C73 미세침흡인검사 갑상선암 진단확정 | 암보험 | DB손해보험 | thyroid_disclosure_cancer |
| ASSESS_049 | (미상) 암 책임개시일 전후 진단시점 | 암보험 | 교보생명 | cancer_diagnosis_benefit |
| ASSESS_050 | D37 경계성종양 지급비율 분쟁 | 암보험 | 라이나생명 | cancer_borderline_in_situ |

### 뇌질환 진단비 (ASSESS_051 ~ 062)

| ID | 진단명/ICD | 보험 유형 | 보험사 | 프로파일 |
|----|-----------|---------|--------|---------|
| ASSESS_051 | I63 급성 뇌경색 | 뇌질환보험 | 삼성화재 | brain_diagnosis_benefit |
| ASSESS_052 | I63 열공성 뇌경색 | 뇌질환보험 | 현대해상 | brain_diagnosis_benefit |
| ASSESS_053 | I63 무증상 뇌경색 | 뇌질환보험 | DB손해보험 | brain_diagnosis_benefit |
| ASSESS_054 | I69/I63 진구성 뇌경색 | 뇌질환보험 | KB손해보험 | brain_diagnosis_benefit |
| ASSESS_055 | G45 일과성 뇌허혈 | 뇌질환보험 | 삼성화재 | brain_diagnosis_benefit |
| ASSESS_056 | I61 뇌출혈 | 뇌질환보험 | 현대해상 | brain_diagnosis_benefit |
| ASSESS_057 | I60 지주막하출혈 | 뇌질환보험 | DB손해보험 | brain_diagnosis_benefit |
| ASSESS_058 | I65 경동맥 협착 뇌혈관질환 | 뇌질환보험 | KB손해보험 | brain_diagnosis_benefit |
| ASSESS_059 | I66 뇌혈관 협착 | 뇌질환보험 | 삼성화재 | brain_diagnosis_benefit |
| ASSESS_060 | (미상) MRI 급성 병변 없음 뇌경색 | 뇌질환보험 | 현대해상 | brain_diagnosis_benefit |
| ASSESS_061 | (미상) 신경학적 결손 없는 뇌졸중 | 뇌질환보험 | DB손해보험 | brain_diagnosis_benefit |
| ASSESS_062 | I67 뇌동맥류 수술비/진단비 | 뇌질환보험 | KB손해보험 | brain_diagnosis_benefit |

### 심장질환 진단비 (ASSESS_063 ~ 074) ← 방태복 케이스 관련 섹션

| ID | 진단명/ICD | 보험 유형 | 보험사 | 프로파일 |
|----|-----------|---------|--------|---------|
| ASSESS_063 ⭐ | I21 급성심근경색 | 심장질환보험 | 삼성화재 | heart_diagnosis_benefit |
| ASSESS_064 | I20 협심증 vs I21 심근경색 감별 | 심장질환보험 | 현대해상 | heart_diagnosis_benefit |
| ASSESS_065 | 관상동맥 협착 스텐트 진단비 | 심장질환보험 | DB손해보험 | heart_diagnosis_benefit |
| ASSESS_066 | 트로포닌 경미 상승 진단비 | 심장질환보험 | KB손해보험 | heart_diagnosis_benefit |
| ASSESS_067 ⭐ | NSTEMI (비ST상승 심근경색) | 심장질환보험 | 삼성화재 | heart_diagnosis_benefit |
| ASSESS_068 | STEMI (ST상승 심근경색) | 심장질환보험 | 현대해상 | heart_diagnosis_benefit |
| ASSESS_069 | 진구성 심근경색 | 심장질환보험 | DB손해보험 | heart_diagnosis_benefit |
| ASSESS_070 | 사망 후 급성심근경색 추정 | 심장질환보험 | KB손해보험 | heart_diagnosis_benefit |
| ASSESS_071 | I50 심부전 vs 심근경색 구분 | 심장질환보험 | 삼성화재 | heart_diagnosis_benefit |
| ASSESS_072 | 심근염 vs 급성심근경색 감별 | 심장질환보험 | 현대해상 | heart_diagnosis_benefit |
| ASSESS_073 | 관상동맥 CT 협착 / 효소 정상 | 심장질환보험 | DB손해보험 | heart_diagnosis_benefit |
| ASSESS_074 | I20 변이형 협심증 | 심장질환보험 | KB손해보험 | heart_diagnosis_benefit |

### 후유장해 (ASSESS_075 ~ 086)

| ID | 진단명/ICD | 보험 유형 | 보험사 | 프로파일 |
|----|-----------|---------|--------|---------|
| ASSESS_075 | S83 무릎 동요관절 | 상해보험 | KB손해보험 | disability_benefit |
| ASSESS_076 | S46 회전근개파열 지급률 | 상해보험 | 현대해상 | disability_benefit |
| ASSESS_077 | M51 추간판탈출증 | 상해보험 | DB손해보험 | disability_benefit |
| ASSESS_078 | S32 척추 압박골절 | 상해보험 | 메리츠화재 | disability_benefit |
| ASSESS_079 | S93 발목 운동범위 제한 | 상해보험 | KB손해보험 | disability_benefit |
| ASSESS_080 | (미상) 안면 반흔 추상장해 | 상해보험 | 현대해상 | disability_benefit |
| ASSESS_081 | H90 소음성 난청 | 상해보험 | DB손해보험 | disability_benefit |
| ASSESS_082 | (미상) 말초신경마비 | 상해보험 | 메리츠화재 | disability_benefit |
| ASSESS_083 | (미상) 척추유합술 후 장해 | 상해보험 | KB손해보험 | disability_benefit |
| ASSESS_084 | (미상) CRPS 복합부위통증증후군 | 상해보험 | 현대해상 | disability_benefit |
| ASSESS_085 | (미상) 어깨 반복 탈구 | 상해보험 | DB손해보험 | disability_benefit |
| ASSESS_086 | (미상) 손가락 절단/운동장해 | 상해보험 | 메리츠화재 | disability_benefit |

### 기왕증/인과관계/상해성 (ASSESS_087 ~ 094)

| ID | 진단명/ICD | 보험 유형 | 보험사 | 프로파일 |
|----|-----------|---------|--------|---------|
| ASSESS_087 | S46 회전근개파열 퇴행성 주장 | 상해보험 | 현대해상 | causation_preexisting_injury |
| ASSESS_088 | M51 추간판탈출증 기왕증 | 상해보험 | DB손해보험 | causation_preexisting_injury |
| ASSESS_089 | M48 척추관협착 사고 후 악화 | 상해보험 | KB손해보험 | causation_preexisting_injury |
| ASSESS_090 | M87 대퇴골두 무혈성 괴사 | 상해보험 | 삼성화재 | causation_preexisting_injury |
| ASSESS_091 | S83 반월상연골파열 퇴행성 주장 | 상해보험 | 현대해상 | causation_preexisting_injury |
| ASSESS_092 | (미상) 사망과 사고 인과관계 | 상해보험 | DB손해보험 | causation_preexisting_injury |
| ASSESS_093 | I61 고혈압 기왕증과 뇌출혈 | 상해보험 | KB손해보험 | causation_preexisting_injury |
| ASSESS_094 | (미상) 골다공증 압박골절 상해성 | 상해보험 | 삼성화재 | causation_preexisting_injury |

### 의료자문/소송 전 분쟁해결 (ASSESS_095 ~ 100)

| ID | 진단명/ICD | 보험 유형 | 보험사 | 프로파일 |
|----|-----------|---------|--------|---------|
| ASSESS_095 | (미상) 주치의·제3의사 소견서 있음에도 자문 요구 | 질병보험 | DB손해보험 | medical_review_pre_litigation |
| ASSESS_096 | (미상) 보험사 자체 의료자문으로 부지급 | 질병보험 | 현대해상 | medical_review_pre_litigation |
| ASSESS_097 | (미상) 제3의료기관 자문 요구 | 질병보험 | 삼성화재 | medical_review_pre_litigation |
| ASSESS_098 | (미상) 본사 민원 전 재심사 요청 | 질병보험 | KB손해보험 | medical_review_pre_litigation |
| ASSESS_099 | (미상) 금감원 민원/분쟁조정 전 자료정리 | 질병보험 | DB손해보험 | medical_review_pre_litigation |
| ASSESS_100 | (미상) 보험사가 소송 가능성 언급 | 질병보험 | 현대해상 | medical_review_pre_litigation |

---

## 3. Core Smoke Test Subset (10건)

`ai_eval/assessment_subset_core_10.json`에 정의된 회귀 기준선 케이스:

| ID | 제목 | 카테고리 |
|----|------|---------|
| ASSESS_001 | M47.26 1회 통원 미고지 실손보험 해지 | 계약전 알릴의무 |
| ASSESS_017 | 백내장 다초점렌즈 실손 부지급 | 실손보험 부지급 |
| ASSESS_021 | MRI 검사비 실손 부지급 | 실손보험 부지급 |
| ASSESS_031 | 대장 용종 high grade dysplasia 제자리암 | 암/경계성 진단비 |
| ASSESS_040 | 대장암 조직검사 전 임상진단 진단비 | 암 진단비 |
| ASSESS_051 | 급성 뇌경색 I63 진단비 | 뇌질환 진단비 |
| ASSESS_063 | 급성심근경색 I21 진단비 | 심장질환 진단비 |
| ASSESS_075 | 무릎 동요관절 후유장해 불인정 | 후유장해 |
| ASSESS_095 | 주치의 소견서 있음에도 의료자문 요구 | 의료자문 |
| ASSESS_096 | 보험사 자체 의료자문 결과로 부지급 | 의료자문 |

---

## 4. 방태복 케이스 (I21.4 / 급성 심내막하심근경색증) 존재 여부

### 결론: **100건 케이스 중 I21.4 전용 케이스 없음**

| 항목 | 상세 |
|------|------|
| I21.4 직접 지정 케이스 | **없음** — 100건 중 어떤 케이스도 `I21.4`를 진단코드로 명시하지 않음 |
| 가장 근접한 케이스 | **ASSESS_067** (NSTEMI 진단비, `heart_diagnosis_benefit`) |
| 차선 케이스 | **ASSESS_063** (I21 급성심근경색 진단비, core smoke test 포함) |
| Gold fixture 연결 | `GOLD_ACUTE_MI_SUBMISSION_REPORT_V2_REDACTED`는 `linked_assess_id` 없음 |

### Gold fixture가 실제로 적용되는 시점

`scripts/evalAssessmentDrafts.js:409`에서 다음 조건으로 acute MI 판단:

```javascript
const isAcuteMi = /acute_mi|I21\.?4|NSTEMI|심근경색|troponin|CAG|PCI|Unstable angina/i.test(caseText);
```

이 조건이 true일 때만 `checkArgumentStructureRubric()`이 gold fixture 수준의 hard assertion을 적용한다.  
→ **ASSESS_063** (`심근경색` 포함) 및 **ASSESS_067** (`NSTEMI` 포함)이 이 경로로 평가됨.

### ASSESS_063 vs ASSESS_067 입력 데이터 비교

| 항목 | ASSESS_063 | ASSESS_067 |
|------|-----------|-----------|
| 진단코드 | I21 급성심근경색 | NSTEMI / 비ST상승 심근경색 |
| I21.4 명시 | ❌ | ❌ |
| SOAP note 입력 | ❌ | ❌ |
| hs-troponin T 수치 | ❌ | ❌ |
| CAG/PCI 상세 | ❌ | `adjusterMemo`에만 "NSTEMI, 트로포닌, CAG 확인" 언급 |
| 방태복 v2 보강본 수준 디테일 | **없음** | **없음** |

### 방태복 케이스가 없을 때의 문제

방태복 손해사정서 v2 보강본(`방태복_손해사정서_v2_보강본-1.docx`)의 핵심 요소는:
- `2024.06.27 외래 SOAP 기록`: `cardiac marker 상승, EKG, UA-NSTEMI 진단서 가능`
- `hs-troponin T 0.037` (경미 상승)
- `PCI 전후 관상동맥조영술(CAG)` 결과
- 보험사가 "시술 전 심근효소 상승 없음"만 문제 삼는 부지급 구조

이 특정 패턴이 100건 케이스 어디에도 입력 데이터로 존재하지 않아, **v2 gold fixture가 실제로 이 케이스를 정확히 평가할 수 없는 상태**다.

---

## 5. 권장 조치

### 즉시: I21.4 전용 케이스 추가 (ASSESS_101)

방태복 v2 보강본 사실관계를 그대로 redacted 형태로 eval 케이스에 등록:

```json
{
  "id": "ASSESS_101",
  "title": "I21.4 급성심내막하심근경색 NSTEMI PCI 부지급 (방태복형)",
  "category": "심장질환 진단비",
  "expectedProfile": "heart_diagnosis_benefit",
  "input": {
    "diagnosisText": "I21.4 급성심내막하심근경색증 (NSTEMI)",
    "insurerPosition": "시술 전 심근효소(트로포닌) 상승 없음을 이유로 급성심근경색 진단기준 미충족 주장",
    "customerStatement": "2024.06.27 외래 주치의 SOAP 기록에 cardiac marker 상승·EKG·UA-NSTEMI 진단서 가능 문구 존재. PCI 시행 및 hs-troponin T 0.037 상승 확인.",
    "adjusterMemo": "I21.4, NSTEMI, hs-troponin T, CAG, PCI, SOAP 기록, Fourth Universal Definition 검토"
  },
  "mustInclude": ["I21.4", "NSTEMI", "Fourth Universal Definition", "hs-troponin", "cardiac marker", "지연이자"],
  "mustNotInclude": ["[일자 확인]", "사료됩니다", "가능성이 있습니다"]
}
```

### gold fixture에 linked_assess_id 추가

`ai_eval/gold_answers/acute_mi_submission_report_gold_redacted.json`에:
```json
"linked_assess_id": "ASSESS_101"
```
추가하여 명시적 연결.

---

## 6. 데이터셋 파일 현황

| 파일 | 케이스 수 | 용도 |
|------|-----------|------|
| `assessment_cases_100_v1.json` | 100 | 전체 eval 데이터셋 |
| `assessment_subset_core_10.json` | 10 | 회귀 smoke test (핵심 10건) |
| `assessment_subset_cancer_claim_10.json` | 미확인 | 암 청구 전용 subset |
| `assessment_subset_cancer_claim_40.json` | 미확인 | 암 청구 전용 확장 subset |
| `assessment_cases_cancer_claim_10_v1.json` | 미확인 | 암 청구 케이스 v1 |
| `assessment_cases_cancer_claim_40_v1.json` | 미확인 | 암 청구 케이스 v1 (40건) |
| `gold_answers/acute_mi_submission_report_gold_redacted.json` | 1 | I21.4 v2 보강본 gold rubric |
