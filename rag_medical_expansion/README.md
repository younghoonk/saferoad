# Medical Issue Codes Expansion

이 디렉터리는 보상파트너 RAG 검색 품질 보강을 위한 질병코드별 의료쟁점 300개 데이터셋을 담는다.

이 데이터는 진단서, 소견서, 검사결과지, 입퇴원확인서, 수술확인서에서 질병코드나 진단명이 추출됐을 때 AI가 보험 실무 쟁점으로 연결할 수 있도록 돕는 내부 검색 보조 자료다.

## Files

- `medical_issue_codes_300_v1.json`: 질병코드/진단명/치료·검사 항목별 보험쟁점 원본
- `medical_issue_codes_300_v1.csv`: 사람이 검토하기 위한 CSV
- `../scripts/importMedicalIssueCodes.js`: Supabase import 스크립트
- `../scripts/checkMedicalIssueCodes.js`: 로컬/DB 검증 스크립트

## Scope

구성 비율:

- 근골격계 / 척추 / 관절: 90개
- 뇌 / 신경계: 40개
- 심장 / 혈관: 40개
- 암 / 종양: 50개
- 대사 / 내분비 / 만성질환: 30개
- 실손보험 다빈도 치료/검사 쟁점: 30개
- 기타 보험분쟁 다빈도 질환/문서 쟁점: 20개

## Use

이 데이터는 다음 용도로만 사용한다.

- 질병코드 또는 진단명 기반 쟁점 분류
- 검색 키워드 확장
- 추가자료 체크리스트 생성
- 관련 source_area 검색 경로 추천

`medical_issue_codes`는 `rag_master_chunks`에도 `source_area='medical_issue_codes'`, `source_type='internal_medical_issue_code'`로 들어간다. `trust_level='internal_review_required'`, `review_status='needs_human_review'`가 기본이다.

## Citation Rule

이 데이터는 의료 판단 확정용이 아니며 공식 의학 근거가 아니다. 최종 AI 사정서, 종결보고서, 고객 안내문에서 공식 근거로 인용하면 안 된다.

진단, 인과관계, 장해율, 고지의무 위반 여부는 실제 진료기록, 검사결과, 약관, 법령, 분쟁조정례, 판례를 확인해 판단해야 한다.

## Commands

```powershell
npx.cmd supabase db push
npm.cmd run rag:medical:import
npm.cmd run rag:medical:check
```

Supabase CLI를 쓰지 않는 환경에서는 SQL Editor에서 `supabase/migrations/20260505001000_create_medical_issue_codes.sql`을 먼저 실행한다.
