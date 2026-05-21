# 트랙 3 의학 가이드라인 소스 라이선스 점검

작성일: 2026-05-21  
작업자: Claude Code (Sonnet 4.6)

---

## 1. 개요

Track 3에서 DB에 적재된 9개 `medical_guideline` row의 출처 및 인용 적법성을 검토한다.  
모든 row는 원문 전문이 아닌 **보험 쟁점 요약 chunk** 형태로 저장됨 (note: '보험 쟁점용 자체 요약 chunk. 원문 전문 저장 아님.').

---

## 2. 소스별 라이선스 검토

| chunk_id | 출처 도메인 | 원문 성격 | 저장 형태 | 인용 적법성 |
|---------|-----------|---------|---------|-----------|
| ACUTE_MI_FOURTH_UNIVERSAL_DEF | jacc.org | ESC/ACC/AHA/WHF Consensus, peer-reviewed | 요약·해석 | ✅ 학술 논문 공정이용 범위, 출처 명기 |
| ACUTE_MI_TROPONIN_CRITERIA | professional.heart.org | AHA 공식 웹사이트, 공개 자료 | 요약·해석 | ✅ 공개 자료 요약 |
| ACUTE_MI_PCI_RELATED | acc.org | ACC 공식 웹사이트, 공개 자료 | 요약·해석 | ✅ 공개 자료 요약 |
| ACUTE_MI_UNSTABLE_ANGINA_VS_NSTEMI | acc.org | ESC ACS Guideline 요약, 공개 자료 | 요약·해석 | ✅ 공개 자료 요약 |
| ACUTE_MI_CAG_PCI_FINDINGS | pubmed.ncbi.nlm.nih.gov | PubMed 등재 논문 (PMID 30154043) | 요약·해석 | ✅ 학술 논문 공정이용 범위, 출처 명기 |
| STROKE_AHA_DIAGNOSIS | pubmed.ncbi.nlm.nih.gov | AHA/ASA Stroke Guideline (PMID 29790764) | 요약·해석 | ✅ 학술 논문 공정이용 범위, 출처 명기 |
| CANCER_DIAGNOSIS_CRITERIA | cancer.go.kr | 국가암정보센터 (정부 공개 자료) | 요약·해석 | ✅ 공공저작물 자유이용 허용 |
| DISABILITY_STANDARD_TABLE | fss.or.kr | 금융감독원 표준약관 (정부 공개 자료) | 요약·해석 | ✅ 공공저작물 자유이용 허용 |
| THYROID_ATA_GUIDELINE | pubmed.ncbi.nlm.nih.gov | ATA 2015 Guideline (PMID 26462967) | 요약·해석 | ✅ 학술 논문 공정이용 범위, 출처 명기 |

---

## 3. 공통 인용 원칙

- **요약·해석 형태**: 원문 그대로 저장하지 않고 보험 쟁점 맥락에서 핵심 기준만 파라프레이징
- **출처 표기**: `source_url` 필드에 원문 URL 명기; `metadata.source_provider`에 발행 기관 명기
- **`official_citation_allowed: true`**: 사정서에서 해당 기준을 인용할 때 출처를 명시하는 조건으로 허용
- **RAG 프롬프트 출력**: `formatRagForPrompt()`에서 `sourceDisplayName`을 포함하여 인용 맥락 제공

---

## 4. 주의사항

- JACC, PubMed 논문의 경우: 논문 전문을 저장하지 않음. 요약·해석 형태로만 저장.
- 사정서 출력에서 인용 시: "Fourth Universal Definition of Myocardial Infarction 2018 (JACC)" 등 출처 병기 권장.
- cancer.go.kr, fss.or.kr: 공공저작물이므로 출처 명기 후 자유롭게 활용 가능.

---

## 5. 결론

9개 row 모두 공정이용 또는 공공저작물 범위 내 요약·해석 형태로 적재됨.  
`official_citation_allowed: true` 설정 유지.
