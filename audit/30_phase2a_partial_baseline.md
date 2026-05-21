# Phase 2-A 작업 5: 101건 baseline 부분 결과 (중단)

작성일: 2026-05-21  
중단 이유: 데이터 재가공(FSS + KOICD) 우선 진행 결정 → baseline은 재가공 완료 후 단 1회 재실행

---

## 중단 시점

- 시작: ASSESS_001 (2026-05-21 23:36)
- 중단: ASSESS_014 진행 중 (2026-05-21 23:4X)
- 완료된 케이스: 13건 (ASSESS_001~ASSESS_013)

---

## 부분 결과 (13건, 계약전 알릴의무 카테고리)

| 케이스 | 결과 | 비고 |
|--------|------|------|
| ASSESS_001 | PASS | |
| ASSESS_002 | PASS | |
| ASSESS_003 | PASS | |
| ASSESS_004 | PASS | |
| ASSESS_005 | PASS | |
| ASSESS_006 | PASS | 1회 retry |
| ASSESS_007 | TRANSPORT_ERROR | 3회 모두 실패 |
| ASSESS_008 | PASS | |
| ASSESS_009 | PASS | |
| ASSESS_010 | PASS | |
| ASSESS_011 | PASS | 1회 retry 후 PASS |
| ASSESS_012 | PASS | |
| ASSESS_013 | PASS | |

**소계: 12 PASS / 1 TE / 13건 = 92.3% PASS**

참고: Track 5 baseline에서 계약전 알릴의무 카테고리는 13/15 PASS (86.7%)였음.  
→ Phase 2-A 초기 결과에서 이미 소폭 개선 추세 확인.

---

## 중단 시점 배포 상태

최신 커밋 (배포 완료):
```
43db439 fix(assessment): ENGINE-002/003 quality rubric + max_tokens + piiRedacted fix
2595864 fix(transport): add OpenAI retry with backoff in callOpenAI + --delay option in eval
```

Edge Function: xnbmostitbwntazexpos create-assessment-draft (Phase 2-A 최종본 배포됨)

---

## 재개 조건

1. FSS + KOICD 데이터 재가공 완료
2. Edge Function 재배포 (데이터 재가공 반영 시)
3. 101건 baseline 재실행: `node scripts\evalAssessmentDrafts.js --retries 2 --delay 2000`
