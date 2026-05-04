# RAG Real Case Patterns

이 디렉터리는 실제 사건을 원문 그대로 저장하지 않고, 개인정보와 민감정보를 제거한 뒤 보험 실무 쟁점 패턴으로 축적하기 위한 샘플 데이터와 익명화 규칙을 담는다.

## 목적

- 실제 사건에서 반복되는 보험사 면책/부지급 논리와 고객/사정사 대응 패턴을 RAG 검색 보조 데이터로 축적한다.
- 진단서, 면책공문, 의료자문 결과, 사정서 등의 원문을 저장하지 않고 쟁점 중심 요약만 저장한다.
- AI가 유사 사건의 쟁점, 필요자료, 반박 포인트를 찾는 데 도움을 주되, 공식 근거처럼 인용하지 않도록 `source_type`과 `trust_level`을 내부 패턴으로 구분한다.

## 개인정보/민감정보 원칙

- 실제 고객자료, 원본 진단서, 원본 면책공문, 원본 검사결과지, 원본 이미지는 저장하지 않는다.
- 이름, 주민등록번호, 전화번호, 주소, 이메일, 병원등록번호, 보험증권번호, 사고번호, 차량번호, 계좌번호는 저장하지 않는다.
- 정확한 생년월일은 연령대로, 구체적 사고장소는 지역 또는 장소 유형으로 축소한다.
- 의료기록 원문은 저장하지 않고 보험 쟁점과 추가 확인자료 중심의 요약만 저장한다.

## 실제 사건 추가 전 검수 절차

1. 원본 문서에서 식별자와 민감정보를 제거한다.
2. `anonymization_rules_v1.json` 기준으로 제거 항목을 점검한다.
3. 원문 대신 사건 패턴과 문서 유형별 요약만 작성한다.
4. `contains_personal_data=false`, `contains_sensitive_data=false`, `pii_removed=true`, `sensitive_info_minimized=true`인지 확인한다.
5. 내부 검수 후 `review_status='needs_human_review'` 상태로 import한다.

## RAG 사용 방식

- `real_case_patterns`는 유사 사건 패턴, 보험사 주장, 반박 포인트, 필요자료 검색에 사용한다.
- `real_case_document_summaries`는 문서 유형별 쟁점 추출 예시와 추가자료 체크리스트 검색에 사용한다.
- AI 문서에서 내부 사건 패턴은 공식 법령, 약관, 판례, 분쟁조정례가 아니라 참고 패턴으로만 사용해야 한다.

## 원본 문서 저장

현재 단계에서는 원본 문서 저장을 하지 않는다. 원본 저장이 필요하다면 별도 보안 설계, 접근통제, 암호화, 보존기간, 고객 동의 및 민감정보 처리 동의 체계를 먼저 설계해야 한다.

## 파일

- `real_case_patterns_sample_v1.json`: 익명화 사건 패턴 샘플 30건
- `real_case_patterns_sample_v1.csv`: 검토용 CSV
- `real_case_document_summaries_sample_v1.json`: 문서 유형별 익명 요약 샘플 30건
- `real_case_document_summaries_sample_v1.csv`: 검토용 CSV
- `anonymization_rules_v1.json`: 개인정보/민감정보 제거 규칙
