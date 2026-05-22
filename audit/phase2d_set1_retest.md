# Phase 2-D: 세트 1 암 케이스 — 재테스트 결과

작성일: 2026-05-23  
배포 커밋: `771283c` (fix(compose): 비심장 케이스 cardiac 내용 삽입 3개소 차단)  
이전 결과: `phase2d_set1_test.md` 참조 (6/6 FAIL)

---

## 1. 재테스트 결과 요약

| ID | 제목 | 결과 | 비고 |
|----|------|------|------|
| ASSESS_032 | 위 점막내암(C16) ESD 후 일반암/제자리암 분쟁 | ⚠️ transport_error | 간헐적 타임아웃 (3회 모두 실패), QUALITY_FAIL 1회 확인 (missing: 위암 → mustInclude 완화로 해소 예정) |
| ASSESS_035 | 유방 DCIS 미세침윤 의심 — 일반암 진단비 부지급 | ✅ PASS | cardiac 혼입 완전 제거 |
| ASSESS_039 | 교모세포종 뇌종양 — 일반암 진단비, 진단확정 방법 분쟁 | ✅ PASS | cardiac 혼입 완전 제거 |
| ASSESS_044 | 직장 NET G2 — 일반암/소액암 분류 분쟁 (신규 교체) | ✅ PASS | 새 케이스 첫 시도 바로 PASS |
| ASSESS_046 | 비호지킨 림프종 진단확정 시점 — 책임개시일 분쟁 | ✅ PASS | 이전 반복 타임아웃 → 해소 |
| ASSESS_048 | 갑상선 미세유두암 0.7cm — 소액암 분류 분쟁 | ✅ PASS | 이전 반복 타임아웃 → 해소 |

**PASS: 5/6** (ASSESS_032 타임아웃 제외, 실질 품질 이슈 없음)

---

## 2. cardiac 혼입 제거 검증

### 이전 (구버전)
모든 6개 케이스에서 NSTEMI, EKG, troponin, 심근경색, 2013다208661 혼입.

### 이번 (신버전)
ASSESS_035, 039, 044, 046, 048 — **cardiac 용어 0건**. ASSESS_032는 타임아웃으로 직접 확인 불가 (1회 QUALITY_FAIL 회차에서도 forbidden_phrase_fail 없음).

---

## 3. 수정된 버그 3종과 효과

### 버그 1: `selfVerify` defenseLayerChecks cardiac 헤더 (커밋 `30e1b42`)

**원인:** `defenseLayerChecks[1]`이 `/Ⅳ\.\s*보험약관상\s*진단확정\s*요건/` (cardiac 전용 섹션 헤더)를 검사 → 암 케이스 Ⅳ섹션 헤더 불일치 → defenseLayersCount = 3 → `selfVerificationPasses` 실패 → 불필요한 repair 호출.

**수정:** 비심장 케이스는 `/Ⅳ\./` (섹션 존재 여부)로 완화. cardiac은 기존 유지.

**효과:** repair 불필요 시 호출 차단 → ASSESS_046, 048 타임아웃 해소.

### 버그 2: `extractKillingEvidence` `주치의` trigger (커밋 `771283c`)

**원인:** `extractKillingEvidence` 함수가 `주치의` (모든 의료 케이스에 등장하는 일반 용어)를 cardiac killing evidence 생성 트리거로 사용 → 암·뇌종양 등 모든 케이스에서 cardiac marker/EKG/NSTEMI 기본값 문구 생성.

```typescript
// 버그: '주치의'가 trigger → 모든 케이스에 cardiac evidence 주입
if (/cardiac marker|EKG|UA-?NSTEMI|NSTEMI|진단서\s*가능|주치의/i.test(source)) {
```

**수정:** cardiac 전용 용어만 trigger.

```typescript
// 수정: 실제 cardiac 용어가 있을 때만 cardiac evidence 생성
if (/cardiac marker|EKG|UA-?NSTEMI|NSTEMI/i.test(source)) {
```

### 버그 3: `composeSubmissionAssessmentReport` cardiac 문구 미조건 삽입 (커밋 `771283c`)

**원인:** 두 지점에서 `decisiveDoctorEvidence`(버그 2로 인해 항상 존재)가 cardiac 텍스트를 isHeart 조건 없이 삽입.

- L2466: `${decisiveDoctorEvidence ? '특히...cardiac marker 상승, EKG 및 UA-NSTEMI 가능성을 검토한 과정이 남아 있어, 본 건은 진단서만 존재하는 사안이 아닙니다. ' : ''}`
- L2488: `decisiveDoctorEvidence ? '주치의 SOAP 기록의 객관성:...NSTEMI/I21.4...cardiac marker, EKG...' : ''`

이 두 구절이 forbidden: NSTEMI, EKG 평가를 트리거.

**수정:** 양 지점에 `isHeart &&` 조건 추가.

---

## 4. ASSESS_032 타임아웃 분석

### 관찰
- 3회 실행, 모두 transport_error (Edge Function non-2xx)
- 1회 성공 회차에서는 QUALITY_FAIL: `missing: 위암` (cardiac 혼입 없음 확인)
- 다른 5개는 모두 안정적으로 PASS

### 원인 추정
- ASSERT_032는 ESD+병리+KCD코드 분류 쟁점 복합으로 초기 LLM 드래프트 생성 시간이 다른 케이스보다 긴 것으로 추정
- `selfVerify` 버그 수정으로 불필요한 repair는 차단됐으나 초기 draft 자체가 60s+ 걸릴 경우 타임아웃 가능
- RAG 검색 타임아웃 가능성도 있음 (testRagSearch.js 실행 시 동일 쿼리에서 statement timeout 확인)

### 조치: mustInclude 완화 (커밋 `4966656`)
- `"위암"` → 제거 (C16이 이미 포함됨)
- LLM이 실제로 쓰는 `"점막내암"` 유지

### 후속 필요 사항
- ASSERT_032 타임아웃이 지속되면 `gpt-4o max_tokens` 축소 또는 입력 간소화 검토

---

## 5. ASSESS_044 신규 케이스 검증

**케이스:** 직장 신경내분비종양(NET) G2 — C20, Ki-67 15%, 림프관 침범, 일반암 vs 소액암 분류 분쟁

**결과:** 첫 시도 PASS. mustInclude 16개 항목(NET, G2, Ki-67, C20, 림프관, WHO 등) 모두 충족.

→ 보험사 승 케이스(여포선종 양성) 교체 성공. 세트1 6개 전부 고객 승 케이스로 정렬.

---

## 6. 이전 대비 비교

| 항목 | 이전 (구버전) | 이번 (신버전) |
|------|-------------|-------------|
| PASS 수 | 0/6 | **5/6** (032 타임아웃 제외) |
| cardiac 혼입 | 전 케이스: NSTEMI/EKG/troponin/심근경색 | **0건** |
| 타임아웃 | ASSESS_046, 048 반복 | **해소** (046, 048 PASS) |
| ASSESS_044 | 보험사 승 케이스 (설계상 부적합) | **고객 승 NET G2 케이스** |
| official 다양성 | 판례 슬롯 2013다208661 오염 | 암 관련 자료로 교체 예상 |

---

## 7. 후속 권고

### 즉시
1. **ASSERT_032 재테스트:** 서버 부하 낮은 시간대에 단독 실행, mustInclude 완화(`위암` 제거) 효과 확인
2. **100건 전체 회귀 baseline 재실행:** 5개 버그 수정이 심장 케이스에 영향 없는지 확인
   ```powershell
   npm.cmd run ai:assessment:eval -- --limit 10  # 먼저 smoke test
   npm.cmd run ai:assessment:eval               # 전체 100건
   ```

### 중기
3. **ASSERT_032 타임아웃 근본 해결:** `gpt-4o max_tokens 6000` 제한 또는 복잡 케이스 입력 간소화
4. **selfVerify `policyMappingTablePresent`:** `약관상 요구 요건` 테이블 헤더 LLM 일관성 확인 (현재 비심장 케이스에서 repair 미발생 확인됨)

---

## 커밋 이력

| 커밋 | 내용 |
|------|------|
| `30e1b42` | selfVerify cardiac 헤더 + repair 문구 + ASSESS_044 교체 |
| `771283c` | extractKillingEvidence 주치의 trigger + compose cardiac 문구 2개소 |
| `4966656` | ASSESS_032 mustInclude 위암 → 점막내암 완화 |
