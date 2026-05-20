# SafeRoad Mojibake 스캔 보고서

작성일: 2026-05-21  
점검 브랜치: `rag-datasets-staging`  
점검자: Claude Code (Sonnet 4.6)

---

## 스캔 범위

- `scripts/*.js` — 전체
- `src/lib/*.ts` — 전체
- `src/**/*.tsx` — 전체
- `supabase/functions/**/*.ts` — 전체

---

## 발견된 인코딩 문제

### 1. `scripts/evalAssessmentDrafts.js` — mojibake (심각)

**문제:** EUC-KR/CP949로 인코딩된 한글이 UTF-8 파일에 혼입. GPT-4o 출력은 정상 UTF-8이므로 이 regex들은 실제로 어떤 섹션도 매칭하지 못하는 dead code였음.

| 위치 | 원래 (mojibake) | 수정 후 |
|------|----------------|---------|
| `isAdditionalCheckKeyword()` (line 73) | `/추가\|확인\|異붽\|뺤씤/` | `/추가\|확인/` |
| `sectionField()` overview | `/개요\|媛쒖슂/` | `/개요\|경위/` |
| `sectionField()` facts | `/사실\|愿怨\|ъ떎/` | `/사실\|관계/` |
| `sectionField()` issues | `/쟁점\|곸젏\|二쇱슂/` | `/쟁점/` |
| `sectionField()` legalAndReferenceBasis | `/근거\|법률\|참고\|踰뺣\|洹쇨굅\|李멸퀬/` | `/근거\|법률\|참고\|약관\|판단기준/` |
| `sectionField()` damageAssessment | `/손해\|평가\|댁슜\|됯/` | `/손해\|평가\|의학/` |
| `sectionField()` insurerPositionReview | `/보험사\|주장\|二쇱옣/` | `/보험사\|주장/` |
| `sectionField()` requiredAdditionalChecks | `/추가\|확인\|異붽\|뺤씤/` | `/추가\|확인/` |

**수정 방법:** Node.js로 함수 경계 탐지 후 clean Korean 교체 (Edit tool은 mojibake byte sequence 매칭 불가로 사용 불가)

### 2. `supabase/functions/create-closing-report/index.ts` — UTF-8 BOM

**문제:** 파일 앞에 UTF-8 BOM (`EF BB BF`) 존재. 일부 파서/도구에서 오작동 가능.

**수정:** BOM 제거 완료 (binary slice)

---

## 이상 없음 확인 파일

| 파일 | 결과 |
|------|------|
| `src/lib/assessmentDraftApi.ts` | 정상 UTF-8, mojibake 없음 |
| `src/lib/ragReferences.ts` | 정상 UTF-8, mojibake 없음 |
| `src/lib/closingReportApi.ts` | 정상 UTF-8, mojibake 없음 |
| `scripts/testRagSearch.js` | 정상 UTF-8, mojibake 없음 |
| `supabase/functions/_shared/ragSearch.ts` | 정상 UTF-8, mojibake 없음 |
| `supabase/functions/create-assessment-draft/index.ts` | 정상 UTF-8, mojibake 없음 |
| `supabase/functions/analyze-document/index.ts` | 정상 UTF-8, mojibake 없음 |

---

## 수정 후 검증

- `scripts/evalAssessmentDrafts.js` 내 mojibake 문자 수: **0개**
- `supabase/functions/create-closing-report/index.ts` BOM: **제거됨**
- 잔여 비ASCII: 로마 숫자 (Ⅰ, Ⅱ, Ⅲ 등) — 정상 Unicode, 사정서 섹션 번호용

---

## 영향 분석

- **`sectionField()` 수정 전:** 실제 GPT-4o 출력 섹션명이 올바른 필드에 매핑되지 않아 eval 점수 오집계 가능성
- **`sectionField()` 수정 후:** `개요/경위`, `사실관계`, `약관 및 판단기준`, `손해 및 의학적 검토` 등 실제 AI 출력 패턴과 정확히 매핑됨
- **`isAdditionalCheckKeyword()` 수정:** `requiredAdditionalChecks` 섹션 키워드 감지 정확도 향상
