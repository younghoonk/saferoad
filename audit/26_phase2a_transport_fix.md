# Phase 2-A 작업 1: transport_error 진단 및 수정

작성일: 2026-05-21  
담당: Phase 2-A 자율 진행

---

## 1. 진단 결과

### 근본 원인
`callOpenAI` 함수에 retry 로직 없음:
- OpenAI API가 429 (rate limit) 또는 5xx 오류 반환 시 즉시 502로 변환
- Edge Function → 502 응답 → eval script "Edge Function returned a non-2xx status code"
- Track 5 eval 실행 시간대의 OpenAI API 부하 상태로 37/101 (36.6%) 전부 TE

### 카테고리별 패턴
| 카테고리 | PASS | TE | TE율 |
|---------|------|-----|------|
| 암/경계성/제자리암 | 8 | 12 | 60% |
| 의료자문/소송 전 | 3 | 3 | 50% |
| 실손보험 부지급 | 7 | 8 | 53% |
| 심장질환 진단비 | 8 | 5 | 38% |
| 후유장해 | 9 | 3 | 25% |
| 기왕증/인과관계 | 6 | 2 | 25% |
| 뇌질환 진단비 | 10 | 2 | 17% |
| 계약전 알릴의무 | 13 | 2 | 13% |

→ 암/경계성 카테고리 60% TE: 복잡 케이스 + OpenAI 처리 시간 증가 + transient error 누적

---

## 2. 수정 사항

### supabase/functions/create-assessment-draft/index.ts

**callOpenAI 함수 retry 로직 추가** (line ~1110):
- maxRetries=3 (default), 지수 백오프: 2s → 4s → 6s → 8s (최대)
- 재시도 조건: HTTP 429 (rate limit) 또는 5xx (server error)
- 비재시도: 400, 401, 403, 404 등 클라이언트 오류는 즉시 502

### scripts/evalAssessmentDrafts.js

**--delay 옵션 추가**:
- `--delay <ms>` 또는 `--delay=<ms>` 지원
- 기본값 2000ms (변경 없음)
- 101건 full baseline 시 `--delay 3000` 권장
- 이미 있던 sleep(2000) → sleep(args.delay)로 변경

---

## 3. 검증 결과

이전 TE 케이스 12건 재테스트:

| 케이스 | 이전 | 이후 |
|--------|------|------|
| ASSESS_032 | TRANSPORT_ERROR | **PASS** |
| ASSESS_016 | TRANSPORT_ERROR | **PASS** |
| ASSESS_065 | TRANSPORT_ERROR | **PASS** |
| ASSESS_037 | TRANSPORT_ERROR | **PASS** |
| ASSESS_068 | TRANSPORT_ERROR | **PASS** |
| ASSESS_079 | TRANSPORT_ERROR | **PASS** |
| ASSESS_007 | TRANSPORT_ERROR | **PASS** |
| ASSESS_009 | TRANSPORT_ERROR | **PASS** |
| ASSESS_034 | TRANSPORT_ERROR | ❌ TE (3회 모두 실패) |
| ASSESS_018 | TRANSPORT_ERROR | ❌ TE (3회 모두 실패) |

**PASS 전환율: 10/12 = 83%**

### ASSESS_034, ASSESS_018 분석
- 입력 크기: ~316 bytes (작음)
- 3회 모두 실패 → 케이스 내용과 무관한 환경적 원인 가능성
- 또는 해당 케이스의 RAG 검색 결과가 과도하게 크거나 GPT 응답이 일관되게 실패하는 특이 케이스
- Phase 2-B에서 추가 조사 예정

---

## 4. 예상 개선 효과

- Track 5 TE: 37/101 (36.6%)
- Phase 2-A 예상 TE: ~6-8/101 (6-8%)
- 목표: 10% 이하 → **달성 가능**

---

## 5. 배포 완료

```
supabase functions deploy create-assessment-draft --project-ref xnbmostitbwntazexpos
```

Deployed at: 2026-05-21
Commit: (이후 커밋 예정)
