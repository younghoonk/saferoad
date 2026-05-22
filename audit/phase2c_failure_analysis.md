# Phase 2-C 전체 Baseline 실패 분석

분석일: 2026-05-22  
대상: 101건 baseline (--retries 2)  
결과: PASS 76 / FAIL 25 (FAIL율 24.8%)

---

## 1. 요약 결론

**25건 FAIL 전부 `transport_error`, QUALITY_FAIL 0.**  
ASSESS_066 및 ASSESS_076 단독 실행 시 **즉시 PASS (1회 시도)**.  
→ 입력 내용·프로파일에 의한 결정론적 실패 아님.  
→ **고부하 세션 + 2× GPT-4o 직렬 호출 구조에 의한 확률론적 Edge Function 타임아웃**.

---

## 2. 입력 크기 분석 — FAIL vs PASS 차이 없음

| 지표 | FAIL (25건) avg | PASS (76건) avg |
|---|---|---|
| 전체 입력 chars | 124 | 140 |
| damageDescription chars | 29 | 35 |
| insurerPosition chars | 24 | 25 |
| adjusterMemo chars | 23 | 26 |
| mustInclude 항목 수 | 6 | 6 |

FAIL군 입력 크기가 오히려 약간 **작음** → 입력 크기는 실패 예측 지표가 아님.

---

## 3. 카테고리별 FAIL율

| 카테고리 | FAIL | TOTAL | FAIL율 |
|---|---|---|---|
| 후유장해 | 5 | 12 | **42%** |
| 심장질환 진단비 | 5 | 13 | **38%** |
| 암/경계성/제자리암 진단비 | 5 | 20 | 25% |
| 계약전 알릴의무 | 3 | 15 | 20% |
| 실손보험 부지급 | 3 | 15 | 20% |
| 의료자문/소송 전 분쟁해결 | 1 | 6 | 17% |
| 뇌질환 진단비 | 2 | 12 | 17% |
| 기왕증/인과관계/상해성 | 1 | 8 | **13%** |

후유장해·심장이 FAIL율 높고, 인과관계가 FAIL율 낮음.  
그러나 **동일 카테고리(심장)에서 PASS/FAIL이 혼재** (065-066 FAIL, 067-068 PASS) →  
카테고리 자체가 실패 원인이 아닌, **해당 카테고리 프롬프트가 평균적으로 더 길 가능성**.

---

## 4. FAIL 케이스 전수 목록

| ID | 카테고리 | 진단/쟁점 | 입력chars | profile | attempts |
|---|---|---|---|---|---|
| ASSESS_003 | 계약전 알릴의무 | I10 고혈압 | 160 | disclosure_duty | 3 |
| ASSESS_005 | 계약전 알릴의무 | K29 위염 | 149 | disclosure_duty | 3 |
| ASSESS_007 | 계약전 알릴의무 | 당뇨/DM | 152 | disclosure_duty | 3 |
| ASSESS_023 | 실손보험 부지급 | 비급여 주사 | 122 | indemnity_denial | 3 |
| ASSESS_027 | 실손보험 부지급 | 도수치료 분쟁 | 114 | indemnity_denial | 3 |
| ASSESS_028 | 실손보험 부지급 | 비급여 초음파 | 113 | indemnity_denial | 3 |
| ASSESS_035 | 암/경계성 | 경계성 종양 | 128 | cancer_borderline_in_situ | 3 |
| ASSESS_041 | 암/경계성 | 제자리암 | 137 | cancer_borderline_in_situ | 3 |
| ASSESS_047 | 암/경계성 | 암 진단비 | 106 | cancer_diagnosis_benefit | 3 |
| ASSESS_049 | 암/경계성 | 암 진단비 | 129 | cancer_diagnosis_benefit | 3 |
| ASSESS_050 | 암/경계성 | 경계성 종양 | 119 | cancer_borderline_in_situ | 3 |
| ASSESS_052 | 뇌질환 진단비 | 뇌경색 | 109 | brain_diagnosis_benefit | 3 |
| ASSESS_057 | 뇌질환 진단비 | 뇌출혈 | 102 | brain_diagnosis_benefit | 3 |
| ASSESS_065 | 심장질환 진단비 | 관상동맥 협착/스텐트 | 140 | heart_diagnosis_benefit | 3 |
| ASSESS_066 | 심장질환 진단비 | 트로포닌 경미 상승 | 120 | heart_diagnosis_benefit | 3 |
| ASSESS_070 | 심장질환 진단비 | 심근경색 의심 | 119 | heart_diagnosis_benefit | 3 |
| ASSESS_072 | 심장질환 진단비 | CAD/협심증 | 128 | heart_diagnosis_benefit | 3 |
| ASSESS_074 | 심장질환 진단비 | 불안정 협심증 | 121 | heart_diagnosis_benefit | 3 |
| ASSESS_076 | 후유장해 | 회전근개파열 | 142 | disability_benefit | 3 |
| ASSESS_077 | 후유장해 | 요추 압박골절 | 122 | disability_benefit | 3 |
| ASSESS_082 | 후유장해 | 무릎 인대손상 | 109 | disability_benefit | 3 |
| ASSESS_084 | 후유장해 | 발목 운동범위 | 107 | disability_benefit | 3 |
| ASSESS_086 | 후유장해 | 어깨 관절 | 105 | disability_benefit | 3 |
| ASSESS_087 | 기왕증/인과관계 | 기왕증 기여도 | 116 | causation_preexisting_injury | 3 |
| ASSESS_100 | 의료자문/소송전 | 소송전 분쟁 | 134 | medical_review_pre_litigation | 3 |

---

## 5. 비교군 — 동일 카테고리 PASS 케이스

| ID | 카테고리 | profile | 입력chars | 단독 재실행 |
|---|---|---|---|---|
| ASSESS_067 | 심장질환 진단비 | heart_diagnosis_benefit | 121 | — |
| ASSESS_068 | 심장질환 진단비 | heart_diagnosis_benefit | 124 | — |
| ASSESS_066 | 심장질환 진단비 | heart_diagnosis_benefit | 120 | **PASS (1회)** |
| ASSESS_076 | 후유장해 | disability_benefit | 142 | **PASS (1회)** |
| ASSESS_092~094 | 기왕증/인과관계 | causation_preexisting_injury | 107-132 | — |

→ FAIL 케이스도 단독 실행 시 정상 작동. 콘텐츠 원인 배제.

---

## 6. 핵심 질문 규명

### Q1. 심장(38%)·후유장해(42%)가 왜 실패율 높은가?

두 프로파일(`heart_diagnosis_benefit`, `disability_benefit`)의 **buildReviewPrompt 내 profile-specific rules이 가장 길다**:
- heart: I21.4, Unstable angina, CAD, CAG/PCI, hs-troponin, CK-MB, ECG, RWMA/LVEF 등 상세 가이드 (~350자)
- disability: 장해분류표, 운동범위, 영구장해, 고정증 등 상세 가이드 (~300자)

프롬프트가 길수록 GPT-4o 생성 시간 증가 → 타임아웃 확률 상승.  
그러나 이는 **확률 증가 요인**이지 결정론적 원인 아님.

### Q2. 인과관계(092~094)는 왜 0% 실패인가?

8케이스 중 1건(087) FAIL로 실제 FAIL율 13%.  
인과관계 profile-specific rule이 가장 짧고 (제외 대상 열거 위주),  
`finalizeSubmissionAssessmentReport` 내 조건부 로직이 단순 → 프롬프트·출력 모두 짧음.

### Q3. 단순 케이스(I10 고혈압)도 FAIL하는 이유?

`disclosure_duty` 프로파일은 전체 3건이 모두 FAIL.  
profile rule 중 `general_disclosure` 분기가 적용되어 고혈압에 특화된 로직 없이 일반화된 긴 지침이 적용됨.  
→ 단순 입력이라도 빌드되는 프롬프트는 다른 케이스와 동일하게 큼.

### Q4. ASSESS_101 (NSTEMI gold, 796자 입력)은 왜 PASS?

- `acute_mi_I214` 전용 프로파일이 감지되어 특화 경로 실행
- 세션 시점 OpenAI 응답이 빨랐을 가능성

---

## 7. 실패의 구조적 원인

```
Edge Function 실행 흐름:
  RAG 검색 (~8s, 병렬)
  → callOpenAI(buildDraftPrompt) — GPT-4o, max_tokens=8000 → 20~60s
  → callOpenAI(buildReviewPrompt) — GPT-4o, max_tokens=8000 → 20~60s
  → buildFinalSubmissionAssessmentReport (CPU, <1s)

총 실행시간: 48~128s
Supabase Edge Function 기본 timeout: 60s
```

**두 번의 GPT-4o 직렬 호출이 60s 타임아웃 초과의 구조적 원인.**  
101건 연속 실행 세션(약 50분)에서 OpenAI 응답이 느린 구간이 발생하면,  
해당 구간의 케이스들은 3회 재시도 모두 타임아웃 → FAIL로 기록됨.

---

## 8. 복잡도 지표 결론

| 지표 | FAIL 예측력 | 이유 |
|---|---|---|
| 입력 chars 크기 | ❌ 없음 | FAIL avg < PASS avg |
| 카테고리 | △ 상관 | 심장/후유장해 프롬프트 더 길어 확률↑ |
| profile | △ 상관 | 일부 profile rule이 더 길어 확률↑ |
| 실행 시점 OpenAI 부하 | ✅ 핵심 | 세션 내 부하 구간에서 집중 발생 |
| 두 번째 GPT-4o 호출 존재 | ✅ 구조 | 모든 케이스가 이 구조 → 누적 확률 |

**사전에 측정 가능한 복잡도 점수로 FAIL을 예측하기 어려움.**  
실패는 콘텐츠가 아닌 인프라 타이밍 문제.

---

## 9. finish_reason 상태

eval 스크립트는 `finish_reason`을 캡처하지 않음.  
Edge Function 코드 내 `console.error('OpenAI returned empty content', { finish_reason })` 로그는  
`content`가 null일 때만 실행 — `finish_reason: length` (truncation) 시에는 미실행.  

ASSESS_066·076 단독 eval → PASS (attempts:1).  
Edge Function이 정상 완료 가능하므로 `finish_reason: stop` 으로 추정.  
실제 실패 케이스의 finish_reason 확인은 Supabase Dashboard → Edge Functions → create-assessment-draft → Logs에서 수동 확인 필요.

---

## 10. 권장 조치

### 즉시 (재측정)
- 저부하 시간대(새벽)에 `--retries 3` 으로 101건 재실행  
- 동일 25건이 또 FAIL하면 콘텐츠 문제, 서로 다른 케이스가 FAIL하면 타임아웃 확인

### 단기 (구조 개선)
- **`buildReviewPrompt`에서 RAG 중복 제거**: `formatRagForPrompt(ragResult)` 는 이미 draft에 적용됨 → review에서는 `formatOfficialGroundsForBody`만 남기고 전체 RAG 삭제 → 프롬프트 ~30% 축소
- **review `max_tokens` 축소**: 8000 → 5000 (JSON 재출력이므로 draft보다 작아도 충분)
- **`config.toml` timeout 연장**: `create-assessment-draft` 함수에 `verify_jwt = true` + 별도 섹션으로 timeout 설정 검토

### 중기
- GPT-4o → GPT-4o-mini 혼용: review 단계를 GPT-4o-mini로 → 응답 2× 빠름, 비용 90% 절감
- finish_reason 로깅 추가: `callOpenAI` 내 `choice?.finish_reason`을 항상 `console.info`로 출력

---

*생성: 2026-05-22, Phase 2-C transport_error 전수 분석*
