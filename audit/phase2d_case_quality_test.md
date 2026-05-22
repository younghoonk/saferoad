# Phase 2-D: 케이스 품질이 사정서 품질을 결정하는가? — ASSESS_037 비교 실험

작성일: 2026-05-23  
실험 대상: ASSESS_037 (난소 경계성종양)

---

## 실험 설계

| 구분 | 구 버전 (v1) | 신 버전 (v2) |
|------|------------|------------|
| 케이스 정의 | 빈약 (각 필드 1문장) | 실제 분쟁 수준 (병리 수치·KCD 코드 불일치·보험사 주장 원문) |
| 1단계 RAG 수정 | 적용됨 | 동일 (적용됨) |
| 생성일 | 2026-05-22 | 2026-05-23 |

---

## 1. official 근거 건수 비교

| 상태 | official | internal |
|------|----------|---------|
| v1 원본 (1단계 수정 전) | **0건** | 4건 |
| v1 (1단계 수정 후: medical_guideline URL 게이트 해제) | 3건 | 4건 |
| **v2 (케이스 정의 교체)** | **6건** | 4건 |

**결론:** 1단계 코드 수정으로 0→3건, 케이스 품질 개선으로 3→6건. 케이스 정의 품질이 official 건수에 2배 차이를 만든다.

---

## 2. 인용 자료 비교

### v1 (빈약한 케이스 — 1단계 수정 후)
```
official (3건):
  - WHO 암 분류 기준 — 경계성 종양 (medical_guideline, 유사도 0.627)
  - 난소암 FIGO 병기 분류 (medical_guideline, 유사도 0.557)
  - AJCC/UICC TNM 병기 분류 (medical_guideline, 유사도 0.548)
internal (4건):
  - M8000/3 Neoplasm, malignant (medical_issue_codes, 0.460)
  - M8002/3 Malignant tumour, small cell type (medical_issue_codes, 0.453)
  - M8003/3 Malignant tumour, giant cell type (medical_issue_codes, 0.448)
  - 카르시노이드 종양 보험금 (practice_playbooks, 0.537)
```

### v2 (상세한 케이스)
```
official (6건):
  - 2012 12년도 약관.pdf (terms_standards/policy_terms_bundle, 유사도 0.686)
  - 2016 16년도 약관.pdf (terms_standards/policy_terms_bundle, 유사도 0.661)
  - 대법원 2013다208661 (precedents/court_precedent_fulltext, 유사도 0.607)  ⚠️
  - 난소암 FIGO 병기 분류 (medical_guideline, 유사도 0.557)
  - WHO 암 분류 기준 — 경계성 종양 (medical_guideline, 유사도 0.627)
  - AJCC/UICC TNM 병기 분류 (medical_guideline, 유사도 0.548)
internal (4건):
  - 보험금 part 2 (precedents, 0.637)
  - 보험금 part 2 (precedents, 0.566)
  - 보험금 part 2 (precedents, 0.558)
  - M8002/3 Malignant tumour, small cell type (medical_issue_codes, 0.562)
```

**v2에서 추가된 자료:**
1. **약관 2016년도, 2012년도** — 계약일 2016-03 입력으로 시기별 약관이 자동 매칭됨. v1에는 계약일이 없어 약관 검색 불가.
2. **2013다208661 대법원 판례** — 증명책임 법리 판례. ⚠️ 심장(NSTEMI) 사건 판례인데 암 케이스에 인용됨 (아래 3-1 참조).

---

## 3. 본문 품질 비교

### 3-1. 보험사 부지급 사유 인용 (가장 중요한 변화)

**v1 본문 Ⅱ:**
```
보험회사의 부지급 사유는 「보험사는 경계성종양 소액 지급만 인정」로 정리됩니다.
```
→ 부지급 사유를 추상적으로만 나열.

**v2 본문 Ⅱ:**
```
보험회사의 부지급 사유는 「보험사는 진단서상 KCD 코드가 D39.1(행동양식 불명, 경계성)로
기재되어 있고, 병리 진단명이 'borderline tumor'이므로 약관상 경계성종양에 해당하여
경계성종양 진단비(500만원)만 지급 대상이라는 입장. 미세침윤(microinvasion)은 명백한
침윤암(invasive carcinoma)이 아니므로 악성신생물(C코드)로 볼 수 없고, 진단서에 C코드가
기재되지 않은 이상 일반암 진단비(5000만원) 지급 요건을 충족하지 못한다고 주장.」
```
→ 보험사의 실제 논거(KCD 코드·microinvasion·C코드 부재)를 원문 수준으로 인용. 반박 구조가 명확해짐.

### 3-2. 의학 근거 섹션 (Ⅲ)

**v1:** "경계성종양의 진단이 암보험 약관상 지급 대상에 해당하는지 여부가 쟁점입니다." (1문장)

**v2:** WHO 경계성종양 정의 원문 인용 + FIGO 확진 기준 인용:
```
WHO 암 분류 기준: 경계성 종양은 "상피세포 증식이 있으나 간질 침습(stromal invasion)이
없는 종양"으로 정의. WHO 정의 핵심: atypical epithelial proliferation WITHOUT stromal
invasion. → 본 사례 microinvasion 1.8mm는 이 정의의 경계에 해당.

FIGO 병기 분류: 난소암 확진은 수술 중 조직 채취 후 병리조직학적 검사로 확정.
CA-125 단독 불가 → 병리 보고서가 진단확정의 기준.
```

### 3-3. 약관 섹션 (Ⅳ)

**v1:** "직접 적용 가능한 가입 당시 원약관 자료는 확인되지 않았습니다." (근거 자료 없음)

**v2:** 2012년·2016년 약관 원문 인용:
```
2016 약관: 「암」의 진단확정은 병리 또는 진단검사의학의 전문의사 자격증을 가진 자에 의하여
내려져야 하며, 이 진단은 조직(fixed tissue)검사, 미세바늘흡인검사(fine needle aspiration)
또는 혈액(hemic system)검사에 대한 현미경 소견을 기초...
```
→ 약관상 "진단확정 = 병리 전문의 + 조직검사"임이 명문화. D39.1 코드 여부와 무관하게 병리 보고서가 기준임을 뒷받침.

---

## 4. "근거 부족" 노출 비교

| 표현 | v1 | v2 |
|------|----|----|
| "직접 관련 근거자료 부족" | 2회 | 0회 |
| "확인되지 않았습니다" | 3회 | 1회 (FSS 자료 부재 고지) |
| "추가 확인이 필요합니다" | 반복 | 1회 (필요 서류 목록으로 정리) |

→ v2는 핵심 근거(WHO 정의, 약관 원문, 증명책임 판례)를 실제로 인용하므로 "근거 부족" 공백이 크게 줄었다.

---

## 5. eval 결과 비교

| 항목 | v1 | v2 |
|------|----|----|
| status | PASS | PASS |
| failures | 0 | 0 |
| missingKeywords | — | 0 |
| warningCount | 0 | 0 |
| referenceCounts | official 3, internal 4 | official **6**, internal 4 |

→ eval 기준으로는 둘 다 PASS이나, v2는 mustInclude 12개(D39.1, microinvasion, 행동양식, 작성자 불이익 등) 모두 충족.

---

## 6. 문제점 — 심장 판례(2013다208661) 혼입

**현상:** v2 사정서에서 심근경색(I21.4·NSTEMI) 전용 판례(대법원 2013다208661)가 official로 인용되고,
본문 Ⅰ~Ⅲ섹션에 "cardiac marker 상승, EKG, UA-NSTEMI, troponin" 등 심장 용어가 혼입됨.

**원인:**
- `2013다208661`은 RAG DB에 `appendMedicalGuidelineEvidence()` 강제삽입 대상으로 저장된 심장 전용 판례.
- 구체적 입력(`adjusterMemo`에 "진단확정의 기준" 등 키워드)이 심장 판례 임베딩과 유사도 0.607로 매칭됨.
- `directlyRelevantOfficial`에서 `cancerInsuranceQuery` 조건 내 판례 분기가 이 판례를 필터링하지 않음:
  ```typescript
  if (cancerInsuranceQuery(query)) {
    if (row.source_area === 'precedents') {
      return (/2009다103349|2009다103356|2023다274056/.test(text) || thyroidOfficialText(row) || ...)
    }
  }
  ```
  → `2013다208661`은 위 코드에 포함되지 않아 일반 경로(`return true`)로 통과.

**영향:** 사정서 본문에서 암 케이스임에도 심장 전문 용어와 논리가 혼합됨. 보험사에 제출 시 오히려 신뢰도를 떨어뜨릴 수 있음.

**후속 대응 필요:** `directlyRelevantOfficial` cancerInsuranceQuery 분기에서 심장 전용 판례(I21.4/NSTEMI 키워드 포함)를 배제하는 조건 추가.

---

## 7. 결론: 케이스 품질이 사정서 품질을 결정하는가?

**예, 결정적으로 영향을 준다.**

| 케이스 품질 요인 | 효과 |
|----------------|------|
| 계약일(contractDate) 명시 | 약관 검색 시기 매칭 → 약관 원문 인용 가능 |
| 구체적 damageDescription (수치·날짜·병리 결과) | RAG 쿼리 임베딩 품질 향상 → 관련 자료 유사도 상승 |
| 보험사 부지급 사유 원문 입력 | 부지급 사유 직접 인용 → Ⅱ섹션 논거 구체화 |
| 쟁점 명시 (adjusterMemo) | 검색 방향 지정 → 불필요 자료 감소 |

**수치로 요약:**
- official 건수: 빈약 케이스 0건 → 상세 케이스 6건 (단계별: 코드 수정 +3건, 케이스 품질 +3건)
- "근거 부족" 노출 빈도: v1 5회 → v2 1회

---

## 8. 후속 권고

1. **심장 판례 혼입 수정 (긴급):** `directlyRelevantOfficial` cancerInsuranceQuery 분기에서 `I21|I20|I22|NSTEMI|심근경색|troponin|CAG|PCI` 포함 판례를 암 케이스에서 배제.
2. **암 케이스 케이스 정의 일괄 보강:** `assessment_cases_100_v1.json`의 암/경계성/제자리암 카테고리 케이스들(ASSESS_034, 043, 044 등) 모두 계약일·구체적 병리 데이터·보험사 부지급 사유 원문 추가.
3. **mustNotInclude 확장:** `cardiac marker, NSTEMI, troponin, EKG, CAG, PCI` 등 심장 전용 키워드를 암 케이스 mustNotInclude에 추가하면 혼입 자동 감지 가능.
