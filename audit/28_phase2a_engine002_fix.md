# Phase 2-A 작업 3: ENGINE-002 reasoning engine 강화

작성일: 2026-05-21  

---

## 1. 변경 사항

### 1-1. max_tokens 6000 → 8000 (supabase/functions/create-assessment-draft/index.ts:1123)

**이유:** 
- GPT-4o 최대 출력: 16,384 토큰  
- 기존 6000 → 복잡한 암/경계성, 실손, 심장 케이스에서 finalSubmissionAssessmentReport 잘림 가능
- 8000으로 증가 시 약 33% 더 많은 본문 생성 가능

**효과:**
- Ⅰ~Ⅶ 전 구조 완성 확률 증가
- Killing evidence, 매핑표 등 상세 내용 누락 감소

---

### 1-2. buildReviewPrompt v2 보강본 품질 체크 9개 항목 추가

**위치:** buildReviewPrompt 함수 초입 `[v2 보강본 품질 체크]` 블록

**추가 항목:**
1. 보험사 부지급 사유 원문 「」 인용 확인
2. 국제 진단기준 명칭 + 연도 명시 확인  
3. 진단기준 vs 환자 매핑표 또는 약관 요건표 (표 형식) 확인
4. Killing evidence (troponin, SOAP 등) 별도 강조 확인
5. Ⅲ/Ⅳ/Ⅴ/Ⅵ 독립 방어선 구조 확인
6. 약한 어미 제거 (사료됩니다, 가능성이 있습니다)
7. Ⅶ장 결론 3종 요청 (보험금+지연이자+서면회신) 확인
8. [요청사항] 3종 명시 확인
9. 개인정보 placeholder 사용 확인

**이유:**
- draft 프롬프트에는 이미 9개 사전분석 + 자체검증 있음
- **review** 단계에서도 동일한 v2 기준을 명시적으로 강제하여 GPT가 두 번 체크하도록
- selfVerification (deterministic) + GPT review (semantic) 이중 검증

---

## 2. 검증 결과

카테고리별 대표 케이스 5건:

| 케이스 | 카테고리 | 결과 |
|--------|---------|------|
| ASSESS_001 | 계약전 알릴의무 | PASS |
| ASSESS_031 | 암/경계성/제자리암 | PASS |
| ASSESS_051 | 뇌질환 진단비 | PASS (1회 TE 후 재시도 PASS) |
| ASSESS_063 | 심장질환 진단비 | PASS |
| ASSESS_075 | 후유장해 | PASS |

**5/5 PASS. 회귀 없음.**

---

## 3. 기대 효과

- max_tokens 증가 → 복잡 케이스 finalSubmissionAssessmentReport 완성도 향상
- v2 품질 체크 → GPT review가 누락 항목 보완하는 빈도 증가
- repair 호출 빈도 감소 (review에서 이미 보완 → selfVerification 통과율 증가)

---

## 4. 미적용 항목 (설명)

- 재작성 루프 (최대 2회): Phase 2-A 평가 후 필요시 Phase 2-B에서 추가
  - 이유: 현재 repair 1회로 충분, 루프 추가 시 Edge Function 처리 시간 2배
- structured JSON rubric output: 현재 자체검증(selfVerification)이 이를 대체
