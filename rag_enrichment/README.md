# RAG Enrichment Data

이 디렉터리는 보상파트너 RAG 검색 품질을 높이기 위한 내부 보강 데이터다. 공식 원문, 판례, 분쟁조정례, 약관을 대체하지 않으며, 최종 문서에서 공식 근거처럼 인용하면 안 된다.

## Files

- `priority_issue_playbooks_v1.json`: 고지의무, 실손보험 부지급, 후유장해, 암/뇌/심장 진단비 실무 쟁점 플레이북 100개
- `priority_issue_playbooks_v1.csv`: 플레이북 검토용 CSV
- `rag_keyword_aliases_v1.json`: 질병코드, 질환명, 보험사 표현, 고객 표현, 약관 표현, 의료문서 표현 등 검색 alias 200개
- `rag_keyword_aliases_v1.csv`: alias 검토용 CSV

## Intended Use

이 데이터는 RAG 검색의 recall을 높이기 위한 검색 보조 자료다.

- 쟁점 분류
- 키워드 확장
- 추가자료 체크리스트 제안
- 공식 근거를 찾기 위한 검색 경로 보강

`priority_issue_playbooks`는 `rag_master_chunks`에도 `source_area='issue_playbooks'`, `source_type='internal_issue_playbook'`로 들어간다. `trust_level='internal_playbook'`, `review_status='needs_human_review'`로 표시되어야 한다.

## Citation Rule

이 보강 데이터는 최종 사정서, 종결보고서, 고객 안내문에서 공식 근거로 인용하지 않는다. 최종 판단에는 반드시 실제 법령, 약관, 분쟁조정례, 판례, 진료기록을 확인해야 한다.

## Import

먼저 migration을 적용한 뒤 import한다.

```powershell
npx.cmd supabase db push
npm.cmd run rag:enrich:import
npm.cmd run rag:enrich:check
```

Supabase CLI를 쓰지 않는 환경에서는 SQL Editor에서 `supabase/migrations/20260504191000_create_rag_enrichment_tables.sql`을 실행한 뒤 import/check를 실행한다.
