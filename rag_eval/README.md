# RAG Evaluation Dataset

이 디렉터리는 보상파트너 RAG 검색 품질을 평가하기 위한 보험 실무형 테스트 질문 100개를 담는다. 앱 화면, Edge Function, AI 사정서/종결보고서 로직, Supabase 테이블 구조를 바꾸지 않고 검색 결과 품질만 따로 점검하기 위한 데이터셋이다.

## Files

- `rag_test_questions_100.json`: 평가 기준 원본 데이터
- `rag_test_questions_100.csv`: 스프레드시트 검토용 CSV
- `../scripts/checkRagEvalDataset.js`: 데이터셋 형식과 분포 확인 스크립트

## How To Use

RAG 검색 연결 후 각 `question` 또는 `question + scenario`를 검색 질의로 넣고, 반환된 `rag_master_chunks` 결과가 기대 영역과 키워드에 맞는지 확인한다.

기본 확인:

```powershell
npm run rag:eval:check
```

검색 품질 평가 시에는 질문별로 top-k 결과를 저장하고, 다음 항목을 비교한다.

- 검색 결과의 `source_area`가 `expected_source_areas`에 포함되는지
- 검색 결과 제목, 본문, 요약에 `expected_keywords`가 충분히 포함되는지
- 법령, 약관, 의료지식, 분쟁조정례, 판례 유형이 질문 쟁점에 맞게 섞여 나오는지
- 같은 문서나 같은 chunk만 반복되지 않고 서로 다른 근거가 나오는지

## expected_source_areas

`expected_source_areas`는 해당 질문에서 검색되면 유용한 `rag_master_chunks.source_area` 후보를 뜻한다.

- `legal_statutes`: 상법, 보험업법 등 법령 근거
- `fss_dispute_cases`: 금융분쟁조정례, 보험 분쟁 사례
- `medical_knowledge`: 진단명, 검사, 인과관계, 장해 관련 의료 지식
- `terms_standards`: 보험약관, 표준약관, 보상 제외 및 지급 기준
- `precedents`: 판례 또는 판례 유형 근거

## expected_keywords

`expected_keywords`는 검색 결과가 질문의 핵심 쟁점을 잘 포착했는지 확인하기 위한 키워드다. 정확히 모든 키워드가 포함되어야 한다는 뜻은 아니며, 동의어와 관련 표현도 함께 평가할 수 있다.

## Evaluation Examples

정성 평가 예시:

- 좋음: top 5 안에 약관 조항, 분쟁조정례, 의료지식이 함께 나오고 질문 쟁점과 직접 관련된다.
- 보통: source_area는 맞지만 구체 질병명이나 면책 쟁점이 약하다.
- 나쁨: source_area가 빗나가거나, 질문과 무관한 일반 보험 설명만 나온다.

정량 평가 예시:

- Precision@5: top 5 중 관련 chunk 비율
- Recall@10: 기대 source_area 또는 핵심 키워드를 top 10 안에서 찾은 비율
- Source coverage: 100개 질문 전체에서 5개 source_area가 균형 있게 검색되는지

이 데이터셋은 이후 RAG 검색 결과의 precision, recall, source coverage, 키워드 hit rate를 계산하는 평가 스크립트의 기준 데이터로 사용할 수 있다.
