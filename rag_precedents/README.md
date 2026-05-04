# Precedent Fulltext Enrichment

이 디렉터리는 보험 실무 쟁점별 판례를 국가법령정보 공동활용 판례 API로 수집하기 위한 target, fulltext import, 검증 파일을 담는다.

## Files

- `precedent_search_targets_v1.json`: 판례 검색 쿼리 80개
- `precedent_search_targets_v1.csv`: 검색 타겟 검토용 CSV
- `precedent_fulltext_import_v1.json`: API에서 확인된 판례 목록/본문 import 파일
- `precedent_fulltext_import_v1.csv`: import 검토용 CSV
- `fetch_logs_v1.json`: fetch 실행 시 생성되는 로그

## Target vs Fulltext

검색 target은 쟁점별로 어떤 판례를 찾을지 정의한 내부 작업 목록이다. 공식 판례 근거가 아니다.

`precedent_fulltext_import_v1.json`에는 국가법령정보 API에서 확인된 값만 저장한다. 본문 조회에 실패한 경우 `source_status='precedent_list_only'` 또는 target에 `precedent_target_needs_full_text` 성격으로 남기며, 사건번호/선고일자/법원명/판례내용을 추론해서 채우지 않는다.

## API Key

`.env.rag.local`에 국가법령정보 공동활용 OC 값을 넣어야 한다.

```text
LAW_OPEN_API_OC=여기에_국가법령정보센터_OC값
```

API 키는 코드에 하드코딩하지 않는다.

## Citation Rule

AI 문서에서 판례를 공식 근거로 사용할 때는 사건번호, 선고일자, 법원명, 출처 URL을 함께 표시해야 한다. 원문 없는 목록 정보만 있는 판례는 공식 근거처럼 인용하지 않는다.

## Manual Review

fetch 실패나 본문 누락이 있으면 국가법령정보 원문에서 직접 확인한 뒤 수동 보강한다. 수동 보강 시에도 API 또는 원문에서 확인한 필드만 입력하고, 없는 필드는 `null`로 둔다.

## Commands

```powershell
npx.cmd supabase db push
npm.cmd run rag:precedent:fetch
npm.cmd run rag:precedent:import
npm.cmd run rag:precedent:check
```

Supabase CLI를 쓰지 않는 환경에서는 SQL Editor에서 `supabase/migrations/20260505004500_create_precedent_fetch_tracking.sql`을 먼저 실행한다.
