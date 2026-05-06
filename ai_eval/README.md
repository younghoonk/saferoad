# AI 사정서 자동 평가 데이터셋

`assessment_cases_100_v1.json`은 `create-assessment-draft` 품질 회귀를 확인하기 위한 100개 테스트 케이스입니다. 앱 화면이나 Edge Function 로직을 수정하지 않고, 로컬 평가 스크립트가 테스트 사정사 계정으로 로그인한 뒤 Edge Function을 순차 호출합니다.

## 실행

환경변수는 `.env.rag.local`에서 읽습니다.

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `TEST_ADJUSTER_EMAIL`
- `TEST_ADJUSTER_PASSWORD`

명령어:

```powershell
npm.cmd run ai:assessment:eval -- --dry-run
npm.cmd run ai:assessment:eval -- --limit 3
npm.cmd run ai:assessment:eval -- --case ASSESS_001
npm.cmd run ai:assessment:eval -- --category "실손보험 부지급"
npm.cmd run ai:assessment:eval
```

## 검사 기준

각 케이스는 다음 필드를 기준으로 검사합니다.

- `requiredSections`: 결과 구조 필수 섹션
- `mustInclude`: 본문 또는 참고근거에 반드시 포함되어야 하는 표현
- `mustNotInclude`: 본문 또는 참고근거에 나오면 안 되는 표현
- `expectedReferenceLabels`: RAG 참고근거에 기대하는 출처명
- `forbiddenReferenceKeywords`: RAG 참고근거에 나오면 안 되는 키워드

공통으로 raw URL 노출, 내부 ID 노출, `chunk_id`/`source_id` 등 내부 필드 노출, `internal_` source type 노출, 지급 확정성 표현을 검사합니다.

## 결과

평가 결과는 아래 경로에 저장됩니다.

- `ai_eval/results/assessment_eval_latest.json`
- `ai_eval/results/assessment_eval_latest.md`

100개 전체 평가는 비용과 시간이 들 수 있으므로, 개발 중에는 `--dry-run`, `--case`, `--limit`, `--category` 옵션으로 좁혀 실행하세요.
