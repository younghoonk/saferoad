# 트랙 1.5 결과 보고

작성일: 2026-05-21  
작업자: Claude Code (Sonnet 4.6)

---

## 1. 적용 변경 요약

| 파일 | 변경 | 효과 |
|------|------|------|
| `ragSearch.ts` | `dispute_resolution_cases` searchPlan 제거 | RPC 1회 + enrichRows 1회 제거 |
| `ragSearch.ts` | `plan.count * 4` → `plan.count * 2`, min 10 → 6 | fetch 데이터 50% 감소 |
| `ragSearch.ts` | `clip(..., 700)` → `clip(..., 500)` | RAG 프롬프트 토큰 ~30% 감소 |

---

## 2. 예상 성능 개선

| 지표 | Track 1 이후 (변경 전) | Track 1.5 이후 (변경 후) | 절감 |
|------|---------------------|----------------------|------|
| Supabase API 호출 수 | 24 | 22 | -2 |
| 총 fetch/enrich 데이터 | ~132건 | ~66건 | -50% |
| RAG 섹션 토큰 수 | ~4,700 | ~3,300 | ~-30% |
| 예상 응답 시간 단축 | — | ~5-10초 단축 | — |

**실제 성능 수치는 재배포 후 eval에서 확인 필요.**

---

## 3. 품질 영향 분석

### 변경 A (dispute_resolution_cases 제거)
- 0건 row를 검색하던 category 제거 → 결과 품질에 영향 없음
- fss_dispute_cases에 1,966건의 공식 FSS 자료가 이미 포함됨

### 변경 B (fetch 수 감소: 12→6)
- per-category fetch 6건 중 최대 plan.count(2-3)건이 실제 사용됨
- 이전(12건 fetch)과 비교 시, top-6 내에 top-3가 포함될 가능성 매우 높음 (similarity 기준 정렬)
- 품질 저하 리스크: 낮음

### 변경 C (요약 clip 700→500)
- 실제 summary 필드 평균 길이: ~150-350자 (DB row 분포 기준)
- 500자 초과 케이스: chunk_text fallback 시 일부 절단 가능
- 절단되는 내용: 요약 후반부 → 핵심 논지는 앞부분에 위치하므로 실질 손실 최소

---

## 4. 재배포 후 검증 체크리스트

```
□ ASSESS_001 (급성심근경색 기본) PASS 확인
□ ASSESS_008 (NSTEMI 부지급) PASS 확인
□ ASSESS_011 (암 진단금) PASS 확인
□ 응답 시간 50초 이하 확인
□ 502 오류 없음 확인
```

---

## 5. 미해결 (Track 2 이월)

| # | 항목 | 우선순위 |
|---|------|---------|
| 1 | 2013다208661 판례 미임포트 → ASSESS_101 FAIL | 높음 |
| 2 | selfVerifySubmissionReport() I21.4 하드코딩 (index.ts:1614) | 높음 |
| 3 | GPT 2회 순차 호출 구조 → 근본 원인이나 품질 타협 없이 최적화 어려움 | 중간 |
| 4 | policy_terms_bundle 4,343건 insurance_line null | 중간 |

---

## 6. 파일 변경 목록

| 파일 | 유형 | 내용 |
|------|------|------|
| `supabase/functions/_shared/ragSearch.ts` | 수정 (3줄) | 성능 최적화 |
| `audit/08_track1_5_diagnosis.md` | 신규 | 진단 보고서 |
| `audit/09_track1_5_changes.md` | 신규 | 변경 상세 |
| `audit/10_track1_5_results.md` | 신규 | 결과 보고 (본 파일) |
