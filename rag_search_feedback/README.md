# RAG Search Feedback

이 디렉터리는 RAG 검색 실패, 저품질 검색 결과, 사용자/사정사 피드백을 저장하고 데이터 보강 작업으로 연결하기 위한 샘플과 운영 기준을 담는다.

## 목적

- 검색 결과가 없거나 similarity가 낮은 질의를 추적한다.
- 잘못된 쟁점, 빠진 법령/약관/판례/분쟁사례, 의료근거 부족을 기록한다.
- 피드백을 `rag_search_improvement_tasks`로 전환해 키워드, 메타데이터, 원문 보강 작업으로 관리한다.

## 로그를 남길 시점

- AI 사정서 생성 전 RAG 검색 결과가 `no_results` 또는 `low_similarity`인 경우
- 반환 chunk 수가 부족하거나 특정 source_area가 누락된 경우
- 사용자가 결과에 부정 피드백을 남긴 경우
- 사정사가 잘못된 근거, 빠진 근거, 과도하게 일반적인 답변을 발견한 경우
- 공식 근거가 부족해 환각 위험이 있는 경우

## 피드백에서 DB 개선까지

1. `rag_search_logs`에 검색 질의, 생성 query, source_area, 검색 결과 요약을 저장한다.
2. `rag_search_feedback`에 사용자/사정사 평가, 빠진 키워드, 유용하거나 잘못된 chunk를 저장한다.
3. `rag_search_improvement_tasks`에 보강 작업을 생성한다.
4. 작업 유형에 따라 `rag_keyword_aliases`, `medical_issue_codes`, `terms_standards`, `fss_dispute_cases`, `precedents`, `real_case_patterns`를 보강한다.
5. 동일 평가 질문 또는 실제 유사 질의로 검색 품질이 개선됐는지 재검증한다.

## 개인정보/민감정보 원칙

- 실제 고객 검색 로그는 이번 단계에서 저장하지 않는다.
- 샘플 데이터는 모두 가상 문장이다.
- 실제 운영 연결 시 이름, 주민등록번호, 전화번호, 주소, 이메일, 계좌번호, 병원등록번호, 보험증권번호, 사고번호는 저장하지 않는다.
- 의료 원문이나 민감한 원문 문서는 저장하지 않고 검색 품질 개선에 필요한 요약 정보만 저장한다.
- RLS는 enabled 상태이며 일반 사용자의 전체 로그 조회를 허용하지 않는다.

## 향후 Edge Function 연결

- RAG 검색 직후 `returned_count`, `max_similarity`, `source_area_counts`, `returned_chunk_ids`를 기록할 수 있다.
- AI 생성 로직은 이번 단계에서 변경하지 않는다.
- 향후 연결 시 service role 또는 제한된 RPC를 통해 최소 필드만 저장한다.
- 검색 실패 기준은 예를 들어 `returned_count=0`, `max_similarity < 0.65`, 필수 source_area 누락 등으로 시작할 수 있다.

## 관리자 대시보드 후보 항목

- search_status별 실패 추이
- feedback_type별 사용자 불만 유형
- missing_source_areas 상위 목록
- open improvement task 목록
- high priority task 처리 현황
- 동일 input/query 반복 실패 여부

## Improvement Task 운영

- `add_keywords`: alias, 보험사 표현, 고객 표현 보강
- `add_medical_issue_code`: 질병코드/치료/검사 쟁점 보강
- `add_fss_case`: 금감원 분쟁조정례 원문 또는 메타데이터 보강
- `add_precedent`: 판례 원문 또는 쟁점 태그 보강
- `add_terms_chunk`: 약관 chunk 제목, 기준, 적용시점 보강
- `fix_metadata`: source_reference, effective date, issue_type 등 정리
- `improve_query_prompt`: 후속 단계에서 검색 query 생성 정책 개선 검토
