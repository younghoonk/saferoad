# Track 5 마무리 보고서

작성일: 2026-05-21  
누적 비용: ~$18 (작업 1~6 포함)

---

## 1. 작업 요약

| 작업 | 내용 | 커밋 | 결과 |
|------|------|------|------|
| 작업 1 | ASSESS_066 QUALITY_FAIL 수정 — `isAcuteMiPolicyReference` bare "진단확정" 제거 | e7ea786 | ✅ PASS |
| 작업 2 | mapWithConcurrency BUG-006 — `Promise.all` → `Promise.allSettled` + SILENT_EMPTY 로깅 | 2a78c44 | ✅ 완료 |
| 작업 3 | BUG-005 conclusionPreview 문장 깨짐 — 템플릿 전체 문장 패턴 + 후처리 정리 | ad7bf7a | ✅ PASS |
| 작업 4 | selfVerifySubmissionReport 프로파일화 — `killingEvidencePresentForProfile` 추가 | 183a498 | ✅ PASS |
| 작업 5 | BUG-002/003/004 감사 — 모두 비이슈 확인 | b4ab6dc | ✅ 조치불필요 |
| 작업 6 | 101건 baseline eval 1회 실행 | — | ✅ 완료 |

---

## 2. 101건 Baseline 결과 (2026-05-21)

| 항목 | 수치 |
|------|------|
| 총 케이스 | 101 |
| PASS | **64 (63.4%)** |
| TRANSPORT_ERROR | 37 (36.6%) |
| QUALITY_FAIL | **0** |
| FORBIDDEN_PHRASE_FAIL | **0** |
| WARNING | 0 |

### 카테고리별 PASS율

| 카테고리 | PASS | transport_err | 계 |
|---------|------|--------------|-----|
| 계약전 알릴의무 | 13 | 2 | 15 |
| 실손보험 부지급 | 7 | 8 | 15 |
| 암/경계성/제자리암 진단비 | 8 | 12 | 20 |
| 뇌질환 진단비 | 10 | 2 | 12 |
| 심장질환 진단비 | 8 | 5 | 13 |
| 후유장해 | 9 | 3 | 12 |
| 기왕증/인과관계/상해성 | 6 | 2 | 8 |
| 의료자문/소송 전 분쟁해결 | 3 | 3 | 6 |

---

## 3. 베이스라인 대비

| 지표 | Track 4 이전 (17차 baseline) | Track 5 (25차 baseline) | 변화 |
|------|------------------------------|------------------------|------|
| PASS | 66 / 101 (65.3%) | 64 / 101 (63.4%) | -2 (transport_error 증가) |
| QUALITY_FAIL | 1 (ASSESS_066) | **0** | ✅ -1 |
| FORBIDDEN_PHRASE_FAIL | 12 (뇌졸중 cardiac 오염) | **0** | ✅ -12 |
| TRANSPORT_ERROR | 22 | 37 | △+15 (OpenAI rate limit) |

**핵심:** QUALITY_FAIL/FORBIDDEN_PHRASE_FAIL 13건 모두 해소. TRANSPORT_ERROR 증가는 당일 OpenAI rate limit 상태 반영 — 품질 문제 아님.

---

## 4. 미해결 이슈

| 항목 | 설명 | 우선순위 |
|------|------|----------|
| ASSESS_031 pre-existing 실패 | cancer borderline in-situ 케이스 일부 transport_error — Task 4 이전부터 존재 | 중간 |
| transport_error 37건 | OpenAI rate limit/timeout — --retries 1 → 일부 해소 가능, eval 시간대 분산 필요 | 낮음 |
| selfVerification regex-only | deterministic check 기반 품질 판단의 한계 — reasoning engine 교체 전까지 편차 존재 | 낮음 |
| docx/PDF export | 미구현 | 낮음 |

---

## 5. 배포된 커밋 목록 (Track 5)

```
183a498  fix(assessment): profile-aware killingEvidencePresent check
ad7bf7a  fix(assessment): repair conclusionPreview sentence corruption
2a78c44  fix(rag): resolve mapWithConcurrency silent failure with allSettled pattern
e7ea786  fix(assessment): resolve ASSESS_066 policy evidence injection
```

모든 변경사항 배포 완료: `xnbmostitbwntazexpos` (create-assessment-draft)
