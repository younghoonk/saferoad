# 트랙 1–3 종합 결과 보고

작성일: 2026-05-21  
작업자: Claude Code (Sonnet 4.6)

---

## 1. 작업 개요

3개 트랙으로 구성된 RAG 품질·성능 개선 작업.

| 트랙 | 목표 | 결과 |
|------|------|------|
| Track 1 | FSS 판례·분쟁 1,966건 공식근거로 전환, 임베딩 완료 | ✅ 완료 (이전 세션) |
| Track 1.5 | Edge Function 502 timeout 긴급 성능 패치 | ✅ 완료 |
| Track 2 | 2013다208661 판례 임포트 → ASSESS_101 FAIL 해소 | ✅ 데이터 완료, 배포 대기 |
| Track 3 | 의학 가이드라인 DB 이전 + 4개 신규 진단 분야 추가 | ✅ 완료, 배포 대기 |

---

## 2. 트랙별 변경 요약

### Track 1.5 — ragSearch.ts 성능 최적화

**파일:** `supabase/functions/_shared/ragSearch.ts`

| 변경 | Before | After | 효과 |
|------|--------|-------|------|
| `dispute_resolution_cases` 제거 | searchPlan 12항목 | 11항목 | API 호출 -2 |
| rpcSearch fetch 수 | `count*4, min 10` | `count*2, min 6` | 데이터 -50% |
| RAG 요약 clip | 700자 | 500자 | 토큰 -28% |

예상 효과: 응답 시간 5–10초 단축, 502 오류 감소.  
Git commit: `bcc61a3`

### Track 2 — 판례 DB 보강

**스크립트:** `scripts/importMissingPrecedents.js`

| 판례 | 상태 | 유사도 |
|------|------|--------|
| 2013다208661 (ASSESS_101 mustInclude) | ✅ 적재, sim=0.736 | 0.736 |
| 2020다232709 (2013다208661 인용 판례) | ✅ 적재 | — |
| 2018나65691 (assertions 참조) | ✅ 적재 | — |

총 precedents: 1,235 → 1,238 (+3). 전부 `reviewed`, `oca=true`.  
Git commit: `43b094f`

### Track 3 — 의학 가이드라인 DB 이전

**마이그레이션:** `supabase/migrations/20260521120000_allow_medical_guideline_source_area.sql`  
**스크립트:** `scripts/importMedicalGuidelines.js`

| 분야 | 행 수 | 최고 유사도 (테스트 쿼리) |
|------|-------|------------------------|
| 급성심근경색 (ACUTE_MI) | 5 | 0.618 |
| 뇌졸중 (STROKE) | 1 | 0.581 |
| 암 진단확정 (CANCER) | 1 | 0.450 |
| 후유장해 (DISABILITY) | 1 | 0.587 |
| 갑상선 (THYROID) | 1 | 0.512 |

총 medical_guideline: 0 → **9** (+9). 전부 `reviewed`, `oca=true`, `embedding_status=done`.

---

## 3. 재배포 필요 파일

```
supabase/functions/_shared/ragSearch.ts          ← Track 1.5 변경
```

**재배포 방법:**
```
Supabase Dashboard → https://supabase.com/dashboard/project/xnbmostitbwntazexpos
→ Edge Functions → create-assessment-draft → Deploy
```

또는 CLI:
```powershell
.\.tools\supabase-cli\supabase.exe functions deploy create-assessment-draft --linked
```

**재배포 후 즉시 검증:**
```powershell
.\scripts\deploy_and_eval.ps1 -limit 3
# 또는
npm.cmd run ai:assessment:eval -- --case ASSESS_001
npm.cmd run ai:assessment:eval -- --case ASSESS_101
```

---

## 4. 재배포 후 예상 결과

| 케이스 | 현재 상태 | 재배포 후 예상 |
|--------|---------|--------------|
| ASSESS_001 ~ 008 (급성심근경색) | 배포 전 미확인 | PASS (Track 1 달성 품질 유지) |
| ASSESS_101 (2013다208661) | TRANSPORT_ERROR | PASS (판례 sim=0.736, 의학 가이드라인 보강) |
| 전체 100건 baseline | 이전 세션 11/12 | ≥11/12 유지 예상 |
| 응답 시간 | 50-60s (502) | 40-50s (Track 1.5 최적화) |

---

## 5. 알려진 미해결 버그 (우선순위)

| 우선순위 | 항목 | 위치 |
|---------|------|------|
| 높음 | `selfVerifySubmissionReport()` I21.4 하드코딩 — 비심장 케이스 불필요 repair 유발 | `index.ts:1588` |
| 높음 | `[일자 확인]` 플레이스홀더 일부 출력 필드 누출 | postprocess 미적용 |
| 중간 | GPT 2회 순차 호출 구조 — 근본적 응답 시간 병목 | `index.ts:3948,3951` |
| 중간 | `policy_terms_bundle` 4,343건 `insurance_line` null | RAG 필터 미작동 |

---

## 6. Track 4 권고 (다음 작업)

우선순위 순:

1. **selfVerify I21.4 하드코딩 수정** (index.ts:1588) — 비심장 케이스 repair 루프 제거
2. **`[일자 확인]` 플레이스홀더 완전 제거** — 출력 품질
3. **GPT 호출 구조 개선** — 2회 순차 → 1회 + 구조화 출력 검토
4. **cancer_claim eval 케이스 추가** — 갑상선/암 진단금 분쟁 10-40건 baseline 구축

---

## 7. 커밋 목록 (이번 세션)

| commit | 내용 |
|--------|------|
| `bcc61a3` | Track 1.5: ragSearch.ts 성능 최적화 3건 |
| `43b094f` | Track 2: 판례 3건 임포트 + audit 보고서 |
| (이번 커밋) | Track 3: 의학 가이드라인 9건 + 마이그레이션 |
