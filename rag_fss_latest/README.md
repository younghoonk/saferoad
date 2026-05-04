# FSS Latest Dispute Case Fulltext Enrichment

이 디렉터리는 최신 금감원 보험 분쟁조정사례 title seed 75건을 원문 기반 RAG 데이터로 보강하기 위한 작업 파일을 담는다.

## Files

- `fss_latest_case_targets_v1.json`: 최신 75건 원문 수집 대상 목록
- `fss_latest_case_targets_v1.csv`: 대상 목록 검토용 CSV
- `fss_latest_fulltext_import_v1.json`: 원문 확인에 성공한 사례만 담는 import 파일
- `fss_latest_fulltext_import_v1.csv`: 원문 import 검토용 CSV
- `fetch_logs_v1.json`: fetch 실행 시 생성되는 수집 로그

## Title Seed vs Full Text

기존 `insurance_dispute_rag_dataset_v2/fss_2026_latest_75_titles.json`은 제목과 요지만 있는 seed 성격이다. 이 단계의 목표는 source_url에서 실제 원문을 확인할 수 있는 경우에만 `facts`, `claimant_position`, `insurer_position`, `committee_reasoning`, `conclusion`, `raw_text`를 보강하는 것이다.

원문을 확인하지 못한 사례는 절대 내용을 생성하지 않는다. 이 경우 `source_status='title_seed_needs_full_text'`로 남긴다.

## Fetch Failure

금감원 또는 중간 출처 페이지는 동적 렌더링, 차단, 첨부파일 다운로드, 인코딩 문제로 자동 fetch가 실패할 수 있다. 실패한 항목은 `fetch_status`와 `notes`를 확인해 수동 보강한다.

수동 보강 절차:

1. `source_url` 또는 금감원 원문 페이지에서 실제 사례 원문을 연다.
2. 제목, 출처 URL, 수집일을 확인한다.
3. 원문에 있는 문구만 `fss_latest_fulltext_import_v1.json`에 입력한다.
4. 없는 구간은 `null`로 둔다.
5. `source_status='official_fss_full_text'`로 표시한다.

## Citation Rule

공식 근거로 사용하려면 `source_url`, `source_status='official_fss_full_text'`, `raw_text`가 있어야 한다. title seed만 있는 항목은 원문 근거로 인용하면 안 된다.

## Commands

```powershell
npx.cmd supabase db push
npm.cmd run rag:fss:fetch
npm.cmd run rag:fss:import
npm.cmd run rag:fss:check
```

Supabase CLI를 쓰지 않는 환경에서는 SQL Editor에서 `supabase/migrations/20260505003000_create_fss_latest_case_tracking.sql`을 먼저 실행한다.
