# 기상 후 확인 요약 — Phase 2-B' 효과 측정 완료

**작성일:** 2026-05-22  
**수면 중 자율 진행 결과 요약**

---

## 한 줄 결론

> **Phase 2-B' + Phase 2-A 누적 효과: 81.2% PASS (Track 5 대비 +15.9%p). 목표 80% 달성 ✅**

---

## 1. 작업 1 — 30건 부분 baseline 결과

| 항목 | 수치 |
|------|------|
| 총 케이스 | 30건 |
| **PASS** | **26건 (86.7%)** ✅ |
| TRANSPORT_ERROR | 4건 |
| QUALITY_FAIL | 0건 |
| FORBIDDEN_PHRASE_FAIL | 0건 |

**카테고리별:**
- 심장질환/뇌질환/암/실손/의료자문: 전원 PASS (100%)
- 계약전 알릴의무 13건: 10/13 PASS (3건 TE)
- 후유장해: 2/3 PASS (1건 TE)

→ **80% 기준 초과 → 101건 전체 eval 진행**

---

## 2. 작업 2 — 101건 전체 baseline 결과

| 항목 | 수치 |
|------|------|
| 총 케이스 | 101건 |
| **PASS** | **82건 (81.2%)** ✅ 목표 80% 달성 |
| TRANSPORT_ERROR | 18건 (17.8%) |
| FORBIDDEN_PHRASE_FAIL | **1건** (ASSESS_097) |
| QUALITY_FAIL | **0건** ✅ |
| TE 제외 실질 PASS율 | **98.8%** |

**카테고리별:**

| 카테고리 | PASS율 |
|----------|--------|
| 계약전 알릴의무 (15건) | 93.3% |
| 심장질환 진단비 (13건) | 92.3% |
| 뇌질환 진단비 (12건) | 91.7% |
| 기왕증/인과관계 (8건) | 87.5% |
| 후유장해 (12건) | 83.3% |
| 암/경계성 (20건) | 75.0% |
| 실손보험 부지급 (15건) | 66.7% |
| 의료자문/소송 (6건) | 50.0% |

---

## 3. Phase 2-B' 재가공 효과 평가

| 지표 | Track 5 (전) | Phase 2-B' 후 | 변화 |
|------|-------------|--------------|------|
| PASS율 | 65.3% | **81.2%** | **+15.9%p** |
| FORBIDDEN_PHRASE_FAIL | 12건 | 1건 | **-91.7%** |
| QUALITY_FAIL | 1건 | 0건 | **-1건** |
| TRANSPORT_ERROR | 22건 | 18건 | -4건 |

**한 줄 평가:** Phase 2-B' 재가공(189건 결정 방향성·인용 가능성 메타 추가) + Track 4 뇌질환 오염 수정이 결합하여 PASS율 +15.9%p, FORBIDDEN_PHRASE -91.7% 달성. 재가공 효과 검증 완료.

---

## 4. 비용 (예상 vs 실제)

| 단계 | 예상 | 실제 (추정) |
|------|------|------------|
| Phase 2-B' 재가공 (189건) | ~$5 | **$4.58** (실측) |
| 부분 baseline 30건 | ~$5~6 | ~$5 |
| 전체 baseline 101건 | ~$15 | ~$12~15 |
| **총 누적** | **~$27** | **~$22~24** |

총 $30 한도 내 완료 ✅

---

## 5. 미해결 사항 + Phase 2-C 권고

### 즉시 해결 권고 (높음)

1. **ASSESS_097 FORBIDDEN_PHRASE_FAIL**
   - 위반: `재검토 필요` 어미
   - 파일: `create-assessment-draft/index.ts` 프롬프트 또는 `enforceSubmissionReportContract()`
   - 조치: 금지 패턴 목록에 "재검토 필요" 추가 → 재배포 → 단건 검증

2. **transport_error 18건 감소**
   - 약한 카테고리: 실손보험(5건), 암/경계성(5건), 의료자문(2건)
   - 추정 원인: Edge Function 타임아웃 (비급여/희귀 케이스 생성 길이)
   - 조치: Edge Function timeout 설정 확인 또는 max_tokens 재조정

### 중기 과제 (Phase 2-C)

3. 실손보험 부지급 RAG 보강 (비급여 치료 FSS 사례)
4. 암/경계성 희귀 암종 RAG 보강 (GIST, 흑색종, 경계성종양)
5. 의료자문 카테고리 프롬프트 정교화 (50% → 80%+ 목표)

---

## 6. 사용자가 다음에 할 일

### 필수
```
git push origin master   # 8759da6 커밋 push (미push 상태)
```

### 선택 (Phase 2-C 시작 시)
```powershell
# ASSESS_097 수정 후 재배포
supabase functions deploy create-assessment-draft --project-ref xnbmostitbwntazexpos

# 단건 검증
node scripts\evalAssessmentDrafts.js --case ASSESS_097

# Phase 2-C 전체 재측정 (수정 후)
node scripts\evalAssessmentDrafts.js --retries 2 --delay 2000
```

---

## 7. 생성된 파일 목록

| 파일 | 내용 |
|------|------|
| audit/phase2c_partial_baseline.md | 30건 부분 baseline 상세 |
| audit/30_phase2a_final_baseline.md | 101건 전체 baseline 상세 |
| audit/31_phase2a_summary.md | Phase 2-A 전체 종합 요약 |
| audit/wake_up_summary.md | 이 파일 |
| ai_eval/assessment_subset_phase2c_30.json | 30건 subset 정의 파일 |

**커밋:** `8759da6` — feat(eval): Phase 2-B' validation + Phase 2-A final baseline complete

---

*수고하셨습니다. 목표 80% 달성 ✅*
