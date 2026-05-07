# AI 사정서 자동평가

`assessment_cases_100_v1.json`은 `create-assessment-draft` Edge Function의 현재 동작을 검증하기 위한 100개 회귀 평가셋입니다. 새 기능을 검증하기보다, 이미 PASS가 확인된 사정서 생성 품질과 금지 표현 차단 기준이 이후 수정에서도 유지되는지 확인하는 목적입니다.

## 평가셋 구성

평가셋 이름은 `assessment_cases_100_v1`입니다. 총 100개 케이스로 구성되어 있으며, 주요 커버 범위는 계약전 알릴의무, 실손보험 부지급, 암/경계성/제자리암 진단비, 뇌질환 진단비, 심장질환 진단비, 후유장해, 기왕증/인과관계/상해성, 의료자문/소송 전 분쟁해결입니다.

현재 100개 PASS 상태를 baseline으로 간주합니다. `create-assessment-draft` 또는 평가 스크립트를 수정할 때는 최소 smoke test를 실행하고, 영향 범위가 넓으면 전체 100개 평가를 다시 실행해야 합니다.

## 실행 준비

평가 스크립트는 `.env.rag.local`에서 아래 값을 읽습니다.

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `TEST_ADJUSTER_EMAIL`
- `TEST_ADJUSTER_PASSWORD`

## 실행 명령어

형식 검사:

```powershell
node --check scripts/evalAssessmentDrafts.js
npx.cmd tsc --noEmit
```

평가셋 구조만 확인:

```powershell
npm.cmd run ai:assessment:eval -- --dry-run
```

단일 케이스 실행:

```powershell
npm.cmd run ai:assessment:eval -- --case ASSESS_001
```

구간 실행:

```powershell
npm.cmd run ai:assessment:eval -- --from 51 --to 70
```

개수 제한 실행:

```powershell
npm.cmd run ai:assessment:eval -- --limit 10
```

카테고리 실행:

```powershell
npm.cmd run ai:assessment:eval -- --category "실손보험 부지급"
```

전체 100개 실행:

```powershell
npm.cmd run ai:assessment:eval
```

## 결과 파일

평가 결과는 아래 파일로 생성됩니다.

- `ai_eval/results/assessment_eval_latest.json`
- `ai_eval/results/assessment_eval_latest.md`

`ai_eval/results/`는 생성 산출물이므로 커밋하지 않습니다. 결과 파일은 `.gitignore`에 포함되어야 하며, tracked 상태가 되면 `git rm --cached -r ai_eval/results`로 Git 추적에서 제거합니다.

## 케이스 작성 규칙

새 케이스는 기존 JSON 구조를 유지하고, 입력 사실관계와 평가 기준을 분리해서 작성합니다. 특정 결론을 강제하기보다, 현재 손해사정 초안이 필요한 쟁점과 금지 표현을 안정적으로 반영하는지 검증하는 방향으로 작성합니다.

- `requiredSections`: 결과 JSON에서 비어 있으면 안 되는 필수 섹션입니다.
- `mustInclude`: 본문 또는 표시 참고근거에 반드시 포함되어야 하는 표현입니다.
- `mustNotInclude`: 본문 또는 표시 참고근거에 포함되면 안 되는 표현입니다.
- `forbiddenReferenceKeywords`: RAG 참고근거 영역에 노출되면 안 되는 키워드입니다.
- `expectedReferenceLabels`: 특정 참고근거 출처명이 반드시 필요한 경우 사용합니다.
- `anyOfReferenceLabels`: 여러 참고근거 중 하나 이상이 필요할 때 사용합니다.

공통으로 raw URL 노출, 내부 ID 노출, `chunk_id`/`source_id` 같은 내부 필드 노출, `internal_` source type 노출, 지급 확정성 표현을 검사합니다.

## 회귀 테스트 절차

`create-assessment-draft`를 수정한 경우 최소 smoke test는 아래 케이스를 실행합니다.

```powershell
npm.cmd run ai:assessment:eval -- --case ASSESS_001
npm.cmd run ai:assessment:eval -- --case ASSESS_017
npm.cmd run ai:assessment:eval -- --case ASSESS_031
npm.cmd run ai:assessment:eval -- --case ASSESS_051
npm.cmd run ai:assessment:eval -- --case ASSESS_063
npm.cmd run ai:assessment:eval -- --case ASSESS_075
npm.cmd run ai:assessment:eval -- --case ASSESS_087
npm.cmd run ai:assessment:eval -- --case ASSESS_095
```

프로필 분류, 후처리, RAG 필터링, 금지 표현 제거처럼 공통 동작에 영향을 주는 변경이면 전체 100개 평가를 실행하고 `100 PASS / 0 FAIL`을 확인한 뒤 병합합니다.
