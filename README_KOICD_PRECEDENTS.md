# KOICD 보험분쟁 판례 수집/가공 파이프라인 v1

목적: KOICD 보험분쟁 판례를 보상파트너 AI 사정서/RAG에서 사용할 수 있도록
수집 → 정규화 → Supabase 저장 → rag_master_chunks 등록까지 처리하는 초안 패키지입니다.

## 중요: 사용권/약관 확인

KOICD 이용약관에는 사이트에서 얻은 정보를 사전승낙 없이 복사·복제·변경·출판·방송 또는
타인에게 제공할 수 없다는 취지의 조항이 있습니다.  
따라서 운영 서비스에 반영하기 전에는 KOICD 또는 권리자에게 사용 허락/라이선스 범위를 확인하세요.

이 패키지는 다음 원칙으로 설계했습니다.

- 허락 확인 전에는 1페이지 테스트 수집만 권장
- 전체 수집은 `KOICD_USAGE_CONFIRMED=true`가 있어야 실행
- 기본값은 `official_citation_allowed=false`
- `review_status='needs_human_review'`
- KOICD는 판례 원문 1차 출처라기보다 판례 조회/재가공 제공처로 보고, 원 판례 출처 확인 후 공식 인용 허용 권장

## 파일 구성

```text
scripts/scrapeKoicdPrecedents.js
scripts/importKoicdPrecedents.js
supabase/migrations/20260511113000_create_koicd_precedents.sql
supabase/functions/_shared/koicdPrecedentUtils.ts
rag_legal_precedents/.gitkeep
package-json-snippet.json
```

## 1. DB migration

```cmd
supabase db push
```

또는 Supabase SQL Editor에서 아래 migration SQL을 실행합니다.

```text
supabase/migrations/20260511113000_create_koicd_precedents.sql
```

## 2. 1페이지 테스트 수집

먼저 1페이지만 확인합니다.

```cmd
node scripts/scrapeKoicdPrecedents.js --dry-run --max-pages 1
```

실제 파일 저장:

```cmd
node scripts/scrapeKoicdPrecedents.js --max-pages 1
```

생성 파일:

```text
rag_legal_precedents/koicd_precedents_raw.jsonl
rag_legal_precedents/koicd_precedents_normalized.jsonl
rag_legal_precedents/koicd_precedents_report.json
```

## 3. 전체 수집

사이트 구조상 페이지 URL 파라미터가 환경에 따라 다를 수 있어 자동 감지를 먼저 시도합니다.
자동 감지가 안 되면 브라우저 개발자도구에서 2페이지 URL을 확인한 뒤 `--page-url-template`을 지정하세요.

예시:

```cmd
set KOICD_USAGE_CONFIRMED=true
node scripts/scrapeKoicdPrecedents.js --max-pages 333 --delay-ms 800 --detail-delay-ms 800
```

페이지 템플릿 지정 예시:

```cmd
set KOICD_USAGE_CONFIRMED=true
node scripts/scrapeKoicdPrecedents.js --max-pages 333 --page-url-template "https://www.koicd.kr/brd/precedentList.do?pageIndex={page}" --delay-ms 800 --detail-delay-ms 800
```

## 4. Supabase import

`.env.rag.local` 또는 환경변수에 아래 값이 있어야 합니다.

```env
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

dry-run:

```cmd
node scripts/importKoicdPrecedents.js --dry-run
```

실제 import:

```cmd
node scripts/importKoicdPrecedents.js
```

RAG master 등록을 보류하려면:

```cmd
node scripts/importKoicdPrecedents.js --skip-rag-master
```

## 5. package.json script 추가

`package-json-snippet.json` 참고.

```json
{
  "scripts": {
    "rag:koicd:scrape:test": "node scripts/scrapeKoicdPrecedents.js --max-pages 1",
    "rag:koicd:scrape": "node scripts/scrapeKoicdPrecedents.js",
    "rag:koicd:import": "node scripts/importKoicdPrecedents.js"
  }
}
```

## 6. 보상파트너 RAG 사용 원칙

권장 초기값:

```text
source_area = legal_precedents
source_type = koicd_precedent
trust_level = legal_reference
citation_allowed = true
official_citation_allowed = false
review_status = needs_human_review
```

운영에서 공식근거처럼 쓰려면 최소한 다음을 확인하세요.

1. 원 판례 출처 또는 대법원 판례 검색 원문과 대조
2. 사건번호/선고일자/법원명/판결요지 정확성 검토
3. 저작권/이용허락 범위 확인
4. 보상파트너 사정서에 긴 원문을 그대로 복제하지 않도록 제한
5. “판례 요지상” 수준으로 짧게 요약하고 사건번호 중심으로 인용

## 7. 우선 태깅되는 쟁점

스크립트는 제목/판시사항/판결요지/본문에서 아래 쟁점을 자동 태깅합니다.

- 고지의무
- 약관 설명의무
- 면책
- 보험금
- 실손보험
- 암진단비
- 뇌혈관질환
- 급성심근경색
- 후유장해
- 의료자문
- 기왕증/인과관계
- 보험자대위
- 자동차보험
- 보험사기

자동 태깅은 초안이므로 `needs_human_review` 상태에서 사람이 검토해야 합니다.
