# FSS 자료 출처 검증 보고서

**작성일:** 2026-05-22  
**상태: 사용자 결정 대기**

---

## 확인 1 — DB full_text_excerpt 출처

**결론: (A) 요약문 수준 — 결정서 전문 아님**

| record_id | full_text_excerpt 길이 | 출처 |
|-----------|----------------------|------|
| fss_insurance_v1_0001 | 402자 | 금융분쟁조정 사례집(제1권) 보험 / PDF p.25 — PDF 다이제스트 요약본 |
| fss_insurance_v1_0021 | 236자 | 금융분쟁조정 사례집(제1권) 보험 / PDF p.95 — PDF 다이제스트 요약본 |
| fss_insurance_v1_0041 | 287자 | 금융분쟁조정 사례집(제1권) 보험 / PDF p.168 — PDF 다이제스트 요약본 |
| FSS_LATEST_002 | 6337자 | **HTML 쓰레기** (insclaim.co.kr 사이트 nav/메뉴 포함) |
| fss_insurance_v1_0061 | 289자 | 금융분쟁조정 사례집(제1권) 보험 / PDF p.231 — PDF 다이제스트 요약본 |

**분포 (100건 기준):**
- 500자 이하: 40건 (40%)
- 500~2,000자: 44건 (44%)  
- 2,000자 초과: 16건 (16%, 일부는 HTML 쓰레기 포함)
- 평균: 1,425자

**판정:** DB full_text_excerpt는 결정서 전문이 아님. `fss_insurance_v1_XXXX` 레코드는 "금융분쟁조정 사례집 제1권 PDF"에서 추출된 케이스 요약본이며, 분쟁조정결정서 원문이 아님.

---

## 확인 2 — 첨부파일 처리 상태

| 경로 | 파일 수 | 상태 |
|------|---------|------|
| `data_sources/fss_dispute_cases/raw/` | **442건** (HWP/PDF 원본) | ✅ 완전히 다운로드됨 |
| `fss_dispute_cases_processed_v1/extracted_text/` | **421건** (txt 추출 완료) | ✅ UTF-8 정상 저장 |
| `data_sources/fss_dispute_cases/extracted_text/` | 0건 | — (빈 디렉토리) |

**ntt_id 매핑:** txt 파일 419건이 metadata jsonl의 ntt_id와 일치 → 사실상 완전 매핑 가능

**주의:** 이전에 mojibake로 오인했던 `fss_dispute_cases_processed_v1/extracted_text/` 파일들은 실제로 **UTF-8로 정상 저장**되어 있음. PowerShell 콘솔 표시 오류였음.

---

## 확인 3 — 추출 도구 상태

| 도구 | 상태 | 비고 |
|------|------|------|
| hwp5txt | ❌ 미설치 | 이미 불필요 — txt 추출 완료 |
| pdftotext | ❌ 미설치 | 이미 불필요 — txt 추출 완료 |
| Python 3.12 | ✅ 설치됨 | — |
| Node.js 24 | ✅ 설치됨 | — |

**결론:** 추출 작업 이미 완료. 도구 설치 불필요.

---

## 확인 4 — 실제 본문 크기 비교

| 자료 유형 | 샘플 | 크기 |
|-----------|------|------|
| DB full_text_excerpt | fss_insurance_v1_0001 (사례집) | 402자 |
| extracted txt | 0414_64775_1_(게시용)제2018-8호_.txt | **85,500자** |
| extracted txt | 0417_64779_1_(게시용)제2018-13호_.txt | 81,800자 |
| extracted txt (소형) | 0001_64312_1_98-18.txt | 4,022자 |
| extracted txt 평균 | — | **15,272자** |

**격차: DB는 1,425자 vs 실제 결정서 txt 15,272자 → 10.7배 차이**

---

## 핵심 결론

### 왜 DB full_text_excerpt가 짧은가

```
DB fss_insurance_v1_XXXX 레코드 소스:
  "금융분쟁조정 사례집 제1권 보험 / PDF p.XX"
  → 이 책은 수백 건 결정례를 각 1~2페이지 요약으로 압축한 다이제스트
  → 따라서 full_text_excerpt = 요약문 (400~500자)

추출된 txt 파일 소스:
  FSS 사이트 개별 게시물 첨부파일 (HWP/PDF)
  → 각 결정서 원문 (조정결정서 / 조정결정사항 / 이유 전문)
  → 따라서 txt = 원문 (평균 15,272자)
```

### 두 데이터셋의 관계

```
DB fss_dispute_cases (361건)        ≠      txt 파일 (421건)
  fss_insurance_v1_XXXX: PDF 사례집           raw HWP → 추출
  fss_2026_latest_XXXX: 웹 스크래핑           ntt_id 기반 매핑 가능
  
겹치는 케이스: 일부 있으나 ID 체계가 달라
직접 1:1 매핑 어려움
```

---

## 선택지 (사용자 결정 필요)

### Option A — txt 파일 직접 사용 ★ 권장
- `fss_dispute_cases_processed_v1/extracted_text/` 421건 중 양질 케이스 직접 GPT-4o 입력
- DB `full_text_excerpt` 무시
- ntt_id로 metadata jsonl에서 제목/카테고리 파악
- 새 rag_master_chunks 행 INSERT (기존 DB fss_dispute_cases와 별개)
- **장점:** 15,272자 풍부한 원문, 추가 작업 불필요
- **단점:** DB fss_dispute_cases와 직접 연결 안 됨

### Option B — DB 업데이트 후 진행 (시간 소요)
- txt 파일 → ntt_id 매핑 → `fss_dispute_cases.full_text_excerpt` 업데이트
- 그 후 기존 파이프라인 사용
- **장점:** DB 구조 유지
- **단점:** 매핑 복잡 + 추가 30~60분 소요

### Option C — 혼합 (KOICD는 현행 유지, FSS만 txt 사용)
- FSS: txt 파일 직접 사용 (Option A)
- KOICD: court_precedents DB 사용 (현행 그대로)
- **장점:** FSS 품질 대폭 개선 + KOICD 변경 없음
- **단점:** FSS/KOICD 파이프라인이 더 이질적

---

## 권장 사항

**Option A (또는 C)**를 권장.

txt 파일 421건이 이미 추출 완료된 상태이고 평균 15,272자로 풍부한 원문을 포함하고 있어 GPT-4o 재가공 품질이 대폭 향상될 것이다. DB full_text_excerpt (400~500자 요약)를 사용하면 GPT-4o가 만들어낼 수 있는 정보가 너무 제한됨.

**txt 파일 기반 FSS 100건 선별 시 가능한 필터링:**
- 5KB 이상 (유의미 본문): 346건 
- 10KB 이상 (충분한 본문): 117건
- 파일명 내 키워드로 카테고리 분류 가능

---

**사용자 지시 대기 중. 결정 전 작업 진행 중단.**
