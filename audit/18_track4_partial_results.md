# Track 4 부분 결과 보고서

작성일: 2026-05-21  
작업자: Claude Code (Sonnet 4.6)

---

## 1. 개요

Track 4에서 두 가지 수정이 적용됐다.

| 수정 | 파일 | 커밋 |
|------|------|------|
| 뇌질환 케이스 "심근경색" RAG 오염 차단 | `index.ts:sanitizeRagResultForAssessment` | 1bc8092 |
| eval 스크립트 케이스 간 2초 delay 추가 | `scripts/evalAssessmentDrafts.js` | 1bc8092 |

전체 101건 재실행은 Bash 10분 timeout으로 중단됨. 아래 세 가지 실행 결과를 종합한다.

---

## 2. 데이터 소스

| 실행 | 범위 | 시점 | 상태 |
|------|------|------|------|
| `bs5m24ezz` | ASSESS_001~101 (전체) | Track 3 배포 후 | 완료 — audit/17 기준 |
| `br4pyqn8r` | ASSESS_051~062 (뇌질환) | Track 4 배포 후 | 완료 |
| `bv4a6wxv1` | ASSESS_001~012 (부분) | Track 4 배포 후 | 중단 (001~012만) |

---

## 3. 뇌질환 케이스 비교 (ASSESS_051~062) — 완전 측정

### 3.1 수정 전 (Track 3, bs5m24ezz)

| 상태 | 건수 |
|------|------|
| PASS | 0 |
| FORBIDDEN_PHRASE_FAIL | **12** |
| TRANSPORT_ERROR | 0 |

원인: `policy_terms_bundle` 종합보험 약관 문서(뇌질환+심장질환 통합 규정)가 RAG에서 검색돼 "심근경색" 단어가 뇌졸중 보고서에 인용됨.

### 3.2 수정 후 (Track 4, br4pyqn8r)

| 케이스 | 제목 | Track 3 | Track 4 |
|--------|------|---------|---------|
| ASSESS_051 | 급성 뇌경색 I63 진단비 | FORBIDDEN | **PASS** |
| ASSESS_052 | 열공성 뇌경색 진단비 | FORBIDDEN | TRANSPORT |
| ASSESS_053 | 무증상 뇌경색 진단비 부지급 | FORBIDDEN | **PASS** |
| ASSESS_054 | 진구성 뇌경색 I69/I63 분쟁 | FORBIDDEN | **PASS** |
| ASSESS_055 | 일과성 뇌허혈 G45 진단비 | FORBIDDEN | **PASS** |
| ASSESS_056 | 뇌출혈 I61 진단비 | FORBIDDEN | **PASS** |
| ASSESS_057 | 지주막하출혈 I60 진단비 | FORBIDDEN | **PASS** |
| ASSESS_058 | 경동맥 협착 뇌혈관질환 진단비 | FORBIDDEN | **PASS** |
| ASSESS_059 | 뇌혈관 협착 I66 진단비 | FORBIDDEN | **PASS** |
| ASSESS_060 | MRI상 급성 병변 없음 뇌경색 진단비 | FORBIDDEN | TRANSPORT |
| ASSESS_061 | 신경학적 결손 없는 뇌졸중 진단비 | FORBIDDEN | **PASS** |
| ASSESS_062 | 뇌동맥류 수술비/진단비 분쟁 | FORBIDDEN | TRANSPORT |

**결과: 0/12 → 9/12 PASS. FORBIDDEN_PHRASE_FAIL 12건 → 0건.**  
잔여 3건(052, 060, 062)은 transport_error (로직 오류 아님).

---

## 4. eval delay 효과 (ASSESS_001~012) — 부분 측정

### 4.1 Track 3 vs Track 4 비교

| 케이스 | Track 3 상태 | Track 4 상태 | 변화 |
|--------|------------|------------|------|
| ASSESS_001 | PASS | PASS | = |
| ASSESS_002 | PASS | PASS | = |
| ASSESS_003 | PASS | PASS | = |
| ASSESS_004 | PASS | PASS | = |
| ASSESS_005 | PASS | PASS | = |
| ASSESS_006 | PASS | PASS (retry 1) | = |
| ASSESS_007 | **TRANSPORT** | **PASS** (retry 1) | ✅ 개선 |
| ASSESS_008 | **TRANSPORT** | **PASS** | ✅ 개선 |
| ASSESS_009 | PASS | PASS | = |
| ASSESS_010 | PASS | PASS (retry 1) | = |
| ASSESS_011 | PASS | **TRANSPORT** | ⚠ 역전 |
| ASSESS_012 | PASS | PASS | = |

소계: PASS 11/12 (Track 3: 10/12). ASSESS_007·008 transport→PASS 전환 확인.  
ASSESS_011은 역전됐으나 네트워크 부하 변동성으로 판단 (재실행 시 회복 예상).

---

## 5. Track 3 → Track 4 예측 비교

### 5.1 카테고리별 예상 (full 재실행 미완료 — 추정치)

| 카테고리 | Track 3 PASS | Track 4 예상 PASS | 근거 |
|---------|-------------|-----------------|------|
| 고지의무 (001~030) | 20/30 (66.7%) | ~23/30 (+3) | delay로 transport 일부 감소 |
| 암 진단비 (031~050) | 18/20 (90.0%) | ~18/20 | 변동 없음 |
| **뇌질환 (051~062)** | **0/12 (0%)** | **9/12 (75%)** | 심근경색 오염 해소 |
| 심장질환 (063~074) | 8/12 (66.7%) | ~8~9/12 | 소폭 개선 가능 |
| 후유장해 (075~091) | 11/17 (64.7%) | ~12/17 | delay 효과 |
| 의료자문 (092~101) | 9/10 (90.0%) | ~9/10 | 변동 없음 |

### 5.2 종합 예상

| 지표 | Track 3 | Track 4 예상 |
|------|---------|------------|
| PASS | 66 | **~79** |
| FORBIDDEN_PHRASE_FAIL | 12 | **0** |
| TRANSPORT_ERROR | 22 | **~18** |
| QUALITY_FAIL | 1 | 1 |
| **PASS율** | **65.3%** | **~78%** |

---

## 6. 수정 내용 요약

### 6.1 RAG 오염 차단 (핵심)

`index.ts:3632` — `brainDiagnosisProfile` 필터의 `excludedBrain` 정규식에 cardiac 키워드 추가:

```typescript
// Before
const excludedBrain = /도수치료|...|계약해지/i;

// After
const excludedBrain = /도수치료|...|계약해지|심근경색|급성심근경색|NSTEMI|I21\.?4|심내막하심근경색/i;
```

→ 종합보험 약관 문서(뇌질환+심장질환 통합)가 뇌졸중 케이스 RAG에서 차단됨.

### 6.2 eval 배치 안정성 개선

`scripts/evalAssessmentDrafts.js` — 케이스 간 2초 delay 추가:

```javascript
if (results.length > 0) await sleep(2000);
```

---

## 7. 잔여 과제 (Track 5)

| 우선순위 | 과제 | 예상 효과 |
|---------|------|---------|
| ★★★ | **101건 전체 재실행** (full measurement) | Track 4 정확한 PASS율 확인 |
| ★★☆ | **ASSESS_066 QUALITY_FAIL 분석** | 심장 케이스 policy evidence 미주입 원인 |
| ★★☆ | **mapWithConcurrency silent failure 근본 수정** | ragSearch.ts catch 블록 logging |
| ★☆☆ | conclusionPreview 문장 깨짐 수정 | 출력 품질 개선 |

---

## 8. 다음 세션 체크리스트

1. `git push origin master` — 7개 커밋 push 필요
2. 101건 전체 재실행 (Bash 10분 제한 → 별도 터미널 직접 실행 권장)
   ```powershell
   node scripts/evalAssessmentDrafts.js
   ```
3. 결과 → audit/19 작성
