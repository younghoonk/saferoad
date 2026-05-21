# Phase 2-A 종합 요약

**작성일:** 2026-05-22  
**기간:** 2026-05-21 ~ 2026-05-22  
**상태:** ✅ 완료

---

## 1. Phase 2-A 전체 작업 요약

### 작업 1 — transport_error 수정 (2026-05-21)

**목표:** Track 5에서 transport_error 22건(21.8%) 대폭 감소  
**실행:**
- `callOpenAI()` retry 3회 + backoff 추가 (scripts/evalAssessmentDrafts.js)
- eval `--delay` 옵션 추가 (케이스 간 2초 간격)  
**결과:** transport_error 22 → 18 (-4건) ✅  
**커밋:** 2595864

---

### 작업 2 — ENGINE-001 분석 (2026-05-21)

**목표:** QUALITY_FAIL 원인 분석  
**결과:** QUALITY_FAIL 원인은 transport_error 연쇄로 인한 오염으로 판단. 별도 코드 수정 없음. (audit만)

---

### 작업 3 — ENGINE-002: max_tokens + v2 rubric (2026-05-21)

**목표:** 사정서 생성 품질 개선  
**실행:**
- `create-assessment-draft` GPT-4o `max_tokens` 6000 → 8000
- v2 보강본 기반 quality rubric 추가  
**결과:** ASSESS_066 QUALITY_FAIL 해소 확인 ✅  
**커밋:** 43db439 (ENGINE-002/003 통합)

---

### 작업 4 — ENGINE-003: piiRedacted 조건 완화 (2026-05-21)

**목표:** piiRedacted 미충족으로 인한 부지급 사정서 생성 실패 방지  
**실행:**
- `piiRedacted` 조건 완화 + repair 단계에 PII 마스킹 추가  
**결과:** repair 루프 오류 감소 ✅  
**커밋:** 43db439

---

### 작업 5 — 101건 baseline 측정 (2026-05-21 중단 → 2026-05-22 완료)

**목표:** 전체 101건 PASS율 측정  
**경위:** Phase 2-A에서 13건만 처리 후 데이터 재가공(Phase 2-B') 우선 결정으로 중단  
**Phase 2-B' 완료 후 재개 (2026-05-22):**
- 30건 부분 baseline: 26/30 PASS (86.7%) → 기준 통과
- 101건 전체 baseline: **82/101 PASS (81.2%)** ✅ 목표 80% 달성  

**결과 파일:** audit/30_phase2a_final_baseline.md

---

### 작업 6 — 마무리 보고서 (2026-05-22)

**이 파일** + audit/31_phase2a_summary.md + audit/wake_up_summary.md

---

## 2. Phase 2-B' 요약 (2026-05-21, 삽입 작업)

Phase 2-A 작업 5 중단 후 Phase 2-B'(데이터 재가공) 실행.  
**내용:** FSS 89건 + KOICD 100건 = 189건 chunk_text 재가공  
**추가 메타:** 결정 방향성, 인용 가능성, 활용 가이드 분류  
**비용:** $4.58 (GPT-4o 199건)  
**커밋:** a0eb34a

---

## 3. 시작/종료 시각 및 소요

| 단계 | 시각 | 소요 |
|------|------|------|
| Phase 2-A 작업 1~4 | 2026-05-21 (이전 세션) | ~2시간 추정 |
| Phase 2-A 작업 5 부분 (13건) | 2026-05-21 | ~5분 |
| Phase 2-B' 전체 (189건 재가공) | 2026-05-21 17:23~18:36 | **73분** |
| Phase 2-C 작업 1 (30건 partial baseline) | 2026-05-22 00:XX | ~15분 |
| Phase 2-C 작업 2 (101건 full baseline) | 2026-05-22 00:XX | ~40분 |
| Phase 2-C 작업 3~5 (보고서 작성) | 2026-05-22 00:XX | ~15분 |

---

## 4. Track 5 → Phase 2-A → Phase 2-B' 최종 비교 표

| 측정 | PASS | TE | FPF | QF | **PASS율** | TE제외 |
|------|------|----|-----|----|-----------|--------|
| Track 5 (2026-05-21) | 66 | 22 | 12 | 1 | 65.3% | 83.5% |
| Phase 2-B' 후 (2026-05-22) | **82** | **18** | **1** | **0** | **81.2%** | **98.8%** |
| **개선폭** | **+16** | **-4** | **-11** | **-1** | **+15.9%p** | **+15.3%p** |

---

## 5. 누적 비용 (예상 vs 실제)

| 단계 | 예상 | 실제 |
|------|------|------|
| Phase 2-A 작업 1~4 (배포/테스트) | ~$2 | ~$2 추정 |
| Phase 2-B' 데이터 재가공 (189건) | ~$5 | **$4.58** |
| 부분 baseline 30건 eval | ~$5~6 | ~$5 추정 |
| 전체 baseline 101건 eval | ~$15 | ~$12~15 추정 |
| **총 누적** | **~$27** | **~$22~27** |

---

## 6. 미해결 사항 (Phase 2-C 이월)

### 즉시 과제 (높음)

| # | 항목 | 파일/위치 | 내용 |
|---|------|-----------|------|
| 1 | transport_error 18건 | Edge Function | 비급여 실손/희귀 암종 케이스 타임아웃. max_tokens/timeout 증가 또는 RAG 쿼리 최적화 필요 |
| 2 | ASSESS_097 FORBIDDEN_PHRASE | 의료자문 프롬프트 | "재검토 필요" 어미 사용. `enforceSubmissionReportContract()` 패턴 추가 또는 프롬프트 수정 |
| 3 | 형식 실패 10건 수동 처리 | Phase 2-B' 잔여 | KOICD 단문 레코드 8건 + 사례집 메타 1건 + 형사사건 1건 |

### 중기 과제 (중간)

| # | 항목 | 내용 |
|---|------|------|
| 4 | 실손보험 부지급 RAG 보강 | ASSESS_022~029 TE 집중 → 비급여 치료 관련 FSS 사례 보강 |
| 5 | 암/경계성 희귀 암종 보강 | ASSESS_034, 038, 043, 045, 050 TE → GIST, 흑색종, 경계성종양 데이터 추가 |
| 6 | medical_guideline 5개 분야 보강 | Track 3에서 9건 DB 이전 완료. 추가 분야(실손, 후유장해) 가이드라인 필요 |
| 7 | 약관 메타데이터 보강 | policy_terms_bundle 4,343건 insurance_line null 상태 |
| 8 | MIN_SIMILARITY 카테고리별 차별화 | 현재 0.45 일률 적용 → 카테고리별 최적값 탐색 |

### 저우선 과제 (낮음)

| # | 항목 | 내용 |
|---|------|------|
| 9 | KOICD 867건 정책 결정 | official_citation_allowed 허용 여부 미결 |
| 10 | FSS 잔여 데이터 재가공 | full_text_excerpt 500자+ 필터 후 추가 처리 |
| 11 | docx/PDF export | 미구현 |

---

## 7. Phase 2-C 권고 순서

```
Phase 2-C 우선순위:
1. ASSESS_097 FORBIDDEN_PHRASE 수정 → 재배포 → 단건 검증
2. transport_error 근본 원인 분석:
   - Edge Function timeout 설정 확인
   - RAG 쿼리 복잡도 측정 (실손/희귀 암종 케이스)
   - max_tokens 단계적 증가 테스트
3. 실손보험 부지급 RAG 데이터 보강 (22~29 케이스 대상)
4. 전체 101건 재측정 → 목표: 90/101 (89%+)
```

---

*연계 문서: audit/30_phase2a_final_baseline.md, audit/phase2c_partial_baseline.md, audit/phase2b_completion.md*
