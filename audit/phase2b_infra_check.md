# Phase 2-B' 인프라 점검 결과

**작성일:** 2026-05-22

## 데이터 현황

### DB 테이블
| 테이블 | 행 수 | 비고 |
|--------|-------|------|
| rag_master_chunks | 170,835 | 전체 |
| fss_dispute_cases | 361 | FSS 분쟁조정사례 |
| court_precedents | 882 | KOICD 판례 |
| rag_master_chunks (fss_dispute) | 508 | chunk_text 828~2580자 |
| rag_master_chunks (court_precedent_fulltext) | 1,185 | chunk_text 384~7000자 |

### 원본 데이터
| 경로 | 수량 | 비고 |
|------|------|------|
| data_sources/fss_dispute_cases/raw/*.hwp | 442 | 원본 HWP |
| rag_legal_precedents/koicd_precedents_normalized.jsonl | 812 | KOICD normalized |

### 선별 가능 후보
- FSS 2016+: 101건 (전체 361건 중)
- KOICD 2016+: 256건 (전체 882건 중)

## 도구 확인

| 도구 | 상태 | 대안 |
|------|------|------|
| hwp5txt | ❌ 미설치 | DB full_text_excerpt 사용 |
| pdftotext | ❌ 미설치 | DB full_text_excerpt 사용 |
| openai npm | ❌ 미설치 | native fetch 사용 |
| @supabase/supabase-js | ✅ | - |
| iconv-lite | ✅ | - |
| dotenv | ✅ | - |
| Node.js 24.14.1 | ✅ | - |

## GPT-4o 입력 소스 결정

### FSS (100건)
- 소스: `fss_dispute_cases.full_text_excerpt` + `summary` + `issue` + `conclusion`
- 기존 `rag_master_chunks.chunk_text` (828~2580자) 도 보조 입력

### KOICD (150건)
- 소스: `court_precedents.full_text_excerpt` (최대 7,551자) + `summary` + `issue` + `conclusion`
- 2016+ 우선 (256건), 부족 시 2013+ 보완

## 진행 방식

1. 후보 선별 스크립트 → `audit/phase2b_candidates.json`
2. GPT-4o 재가공 스크립트 → `rag_master_chunks.chunk_text` 직접 UPDATE
3. embedding_status = 'pending' 설정 → 기존 embedRagDatasetChunks.js로 임베딩
4. 진행 로그: `audit/phase2b_progress.json` (재시작 가능)
