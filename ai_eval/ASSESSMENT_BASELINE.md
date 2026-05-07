# Assessment Baseline

## Baseline

- Baseline name: `assessment_cases_100_v1`
- Current status: `100 PASS / 0 FAIL` confirmed
- Baseline meaning: the current 100-case PASS state is the regression baseline for AI assessment draft generation.

## Coverage

1. 계약전 알릴의무
2. 실손보험 부지급
3. 암/경계성/제자리암 진단비
4. 뇌질환 진단비
5. 심장질환 진단비
6. 후유장해
7. 기왕증/인과관계/상해성
8. 의료자문/소송 전 분쟁해결

## Minimum Smoke Test

When `create-assessment-draft` is changed, run at least:

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

Run the full 100-case evaluation when a change affects profile detection, draft post-processing, RAG filtering, forbidden-expression removal, result formatting, or shared assessment behavior.

## Result Artifacts

Evaluation output is generated under `ai_eval/results/`:

- `ai_eval/results/assessment_eval_latest.json`
- `ai_eval/results/assessment_eval_latest.md`

These files are generated artifacts and must not be committed.
