# Phase 2-B' 저작권 및 데이터 컴플라이언스 점검

**작성일:** 2026-05-22  
**점검 기준:** CLAUDE.md 절대 금지 사항 (보안·컴플라이언스)

---

## 1. glaw.scourt.go.kr 접근 코드 점검

**결론: 접근 코드 없음 ✅**

`scripts/phase2b_reprocess.js`는 아래 두 소스만 사용:

| 소스 | 데이터 획득 경로 | 저작권 상태 |
|------|-----------------|-------------|
| FSS (금융감독원) | `fss_dispute_cases_processed_v1/extracted_text/*.txt` (로컬 파일) | 금융감독원 공개 자료 — 연구·교육 목적 이용 가능 |
| KOICD (판례) | Supabase `court_precedents` 테이블 조회 (RPC) | 대법원 공개 판례 — `glaw.scourt.go.kr` 직접 스크래핑 아님 |

`glaw.scourt.go.kr`에 HTTP 요청하는 코드가 `phase2b_reprocess.js`에 **존재하지 않음**. Supabase RPC를 통해 이미 DB에 적재된 데이터를 조회하는 방식으로 동작.

---

## 2. extracted_text 저장 정책 준수 점검

**결론: 준수 ✅**

- `phase2b_reprocess.js`가 DB에 upsert하는 필드:
  - `chunk_id`, `source_area`, `chunk_text` (GPT-4o 재가공 결과물), `embedding`, `metadata`
- `extracted_text` 원문 필드는 upsert 대상에 **포함되지 않음**
- FSS txt 파일 내용은 GPT-4o system prompt의 소스 컨텍스트로만 사용되며 DB에 저장되지 않음

---

## 3. 고객 의료자료 RAG 혼입 방지 점검

**결론: 혼입 없음 ✅**

- phase2b 재가공 대상은 `audit/phase2b_candidates_v3.json` 목록(FSS 분쟁조정 사례 + KOICD 판례)만
- 개인 의료 문서(OCR 결과, redacted 처리 문서)는 처리 대상에 포함되지 않음
- `rag_master_chunks`의 `source_area`에 고객 데이터 소스 유형(예: `customer_medical`) 없음

---

## 4. PII 비식별화 점검

**결론: 준수 ✅**

- FSS 결정문 원문: 금감원이 공개한 비식별화 버전 txt 파일 사용
- KOICD 판례: 대법원 공개 판례 — 원고·피고 성명은 법원 판결문에서 이미 甲·乙 등으로 익명 처리
- GPT-4o 재가공 출력물: 실제 인물 이름이 아닌 역할(신청인, 피신청인, 원고, 피고)로 기술

---

## 5. 평가 스크립트 배포 전 실행 방지

**결론: 준수 ✅**

- `phase2b_reprocess.js`는 `evalAssessmentDrafts.js`를 호출하지 않음
- Edge Function 재배포 없이 eval 실행 위험 없음

---

## 6. OCR/Batch/redacted-only 로직 변경 여부

**결론: 변경 없음 ✅**

- `phase2b_reprocess.js`는 OCR 관련 함수(`processOcrJob`, `batchOcr` 등)를 import하거나 호출하지 않음
- 기존 안정화된 OCR 파이프라인에 영향 없음

---

## 종합 판정

| 항목 | 결과 |
|------|------|
| glaw.scourt.go.kr 접근 코드 | ✅ 없음 |
| extracted_text 저장 금지 | ✅ 준수 |
| 고객 의료자료 RAG 혼입 방지 | ✅ 없음 |
| PII 비식별화 | ✅ 준수 |
| eval 조기 실행 방지 | ✅ 준수 |
| OCR 로직 불변 | ✅ 확인 |

**모든 컴플라이언스 항목 통과 — 배포 가능 상태**
