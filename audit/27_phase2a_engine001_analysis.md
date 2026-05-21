# Phase 2-A 작업 2: ENGINE-001 v2 hard assertion 실패 지점 분석

작성일: 2026-05-21  

---

## 1. Track 5 baseline 재분석

### 핵심 발견: 품질 문제 없음, transport_error만 존재

| 구분 | 수치 |
|------|------|
| 총 케이스 | 101 |
| PASS (완료 후 통과) | 64 (63.4%) |
| TRANSPORT_ERROR | 37 (36.6%) |
| QUALITY_FAIL | **0** |
| FORBIDDEN_PHRASE_FAIL | **0** |

→ 64건 중 품질 실패 0건: 사정서 생성이 완료되면 모두 통과

---

## 2. 진짜 PASS율 추정

### transport_error 보정 후 예상 PASS율

작업 1에서 37개 TE 케이스 중 12건 재테스트:
- 10/12 (83%) → PASS 전환
- 2/12 (17%) → 여전히 TE

예상: 37건 × 83% = ~31건 PASS 전환 가능  
예상 최종 PASS: 64 + 31 = **~95/101 (94%)**

---

## 3. 카테고리별 약점 식별 (transport 보정 포함)

| 카테고리 | PASS | TE | TE율 | 예상 진짜 PASS율 |
|---------|------|-----|------|----------------|
| 계약전 알릴의무 | 13 | 2 | 13% | ~98% |
| 뇌질환 진단비 | 10 | 2 | 17% | ~97% |
| 후유장해 | 9 | 3 | 25% | ~95% |
| 기왕증/인과관계/상해성 | 6 | 2 | 25% | ~95% |
| 심장질환 진단비 | 8 | 5 | 38% | ~92% |
| 의료자문/소송 전 | 3 | 3 | 50% | ~90% |
| 실손보험 부지급 | 7 | 8 | 53% | ~89% |
| 암/경계성/제자리암 | 8 | 12 | 60% | ~85% |

**핵심:** 암/경계성/제자리암은 복잡한 케이스가 많아 OpenAI API 처리 시간이 길고 TE가 집중됨.  
transport 해결 후에도 일부 케이스는 TE 잔존 예상.

---

## 4. 10건 샘플 품질 분석 (Phase 2-A 재실행 결과)

| 케이스 | 카테고리 | 프로파일 | refs_official | 결과 |
|--------|---------|---------|--------------|------|
| ASSESS_001 | 계약전알릴의무 | m47_disclosure | 6 | PASS |
| ASSESS_002 | 계약전알릴의무 | thyroid_disclosure_cancer | 9 | PASS |
| ASSESS_003 | 계약전알릴의무 | general_disclosure | 7 | PASS |
| ASSESS_004 | 계약전알릴의무 | N/A (TE) | 0 | TE |
| ASSESS_005 | 계약전알릴의무 | general_disclosure | 4 | PASS |
| ASSESS_006 | 계약전알릴의무 | general_disclosure | 6 | PASS |
| ASSESS_007 | 계약전알릴의무 | general_disclosure | 4 | PASS |
| ASSESS_008 | 계약전알릴의무 | general_disclosure | 5 | PASS |
| ASSESS_009 | 계약전알릴의무 | general_disclosure | 4 | PASS |
| ASSESS_010 | 계약전알릴의무 | general_disclosure | 8 | PASS |

refs_official 평균: 5.9 (PASS 케이스 기준)

---

## 5. 현재 품질 수준 평가

### 강점
- QUALITY_FAIL 0건: 모든 완료 케이스가 평가 기준 통과
- FORBIDDEN_PHRASE_FAIL 0건: 사료됩니다 등 금지 표현 전무
- refs_official 평균 ~6: 공식 근거 충분히 인용

### 약점 (ENGINE-002, 003 대상)
1. **piiRedacted 검증 오류** (ENGINE-003 대상):
   - `[피보험자]` 등 마스킹 문자열 없으면 selfVerification 실패
   - 비심장 케이스에서 불필요한 repair 유발 → 처리 시간 증가 → TE 간접 기여
   
2. **max_tokens 6000 제한** (ENGINE-002 대상):
   - 복잡한 케이스(암/경계성, 실손)에서 응답 truncation 가능
   - finalSubmissionAssessmentReport가 잘리면 구조 불완전
   
3. **selfVerification 하드코딩** (ENGINE-003 대상):
   - 비심장 케이스에서 medicalStandardNamed, medicalMappingTablePresent 항상 true
   - 하지만 piiRedacted 실패 → 불필요한 repair 트리거

---

## 6. ENGINE-002 우선순위 결정

1. **HIGH**: piiRedacted 완화 (ENGINE-003) → repair 빈도 감소 → TE 간접 감소
2. **HIGH**: max_tokens 증가 6000 → 8000 (복잡 케이스 truncation 방지)
3. **MEDIUM**: structured prompt rubric 추가 (v2 보강본 9개 체크리스트 명시)
4. **LOW**: 재작성 루프 추가 (현재 1회 repair로 충분)
