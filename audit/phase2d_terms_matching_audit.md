# 약관(terms_standards) RAG 매칭 오류 진단

작성일: 2026-05-23  
기준 커밋: `03e47f9` (cancer branch)  
진단 대상: ASSESS_046 (DLBCL, 2023-08) + 타 케이스 영향 범위

---

## 1. 증상 요약

| 케이스 | 계약일 | 매칭된 약관 | 문제 |
|--------|--------|------------|------|
| ASSESS_032 | 2018-07 | 2021+2016 약관 | 2021 약관이 계약일 이후 |
| ASSESS_037 | 2016-03 | 2012+2016 약관 | 정상 범위 |
| ASSESS_039 | 2019-02 | 2012+2021 약관 | 2021 약관이 계약일 이후 |
| ASSESS_044 | 2019-08 | 2012+2021 약관 | 2021 약관이 계약일 이후 |
| **ASSESS_046** | **2023-08** | **2026+2021 약관** | **2026은 계약일 3년 이후, N18.5 콩팥병 조항 혼입** |
| ASSESS_048 | 2014-11 | 2021+2026 약관 | 둘 다 계약일 이후 |
| ASSESS_034 | 2021-01 | terms_standards 0건 | 약관 청크 아예 없음 |

계약일 이후 약관 매칭은 ASSESS_046·048만의 문제가 아니라 **대부분의 케이스에 존재**.

---

## 2. 원인 1 — `effectiveDateScore`가 하드 필터가 아닌 소프트 ±0.12 조정

### 위치
`supabase/functions/_shared/ragSearch.ts` L307–316

### 코드
```typescript
function effectiveDateScore(row: EnrichedRow, contractDate?: string) {
  const contract = parseDate(contractDate);
  if (!contract) return 0;
  const from = parseDate(firstMetadataValue(row, ['effective_from', 'effectiveFrom', 'applicable_from', 'start_date']));
  const to   = parseDate(firstMetadataValue(row, ['effective_to',   'effectiveTo',   'applicable_to',   'end_date']));
  if (from && contract < from) return -0.12;   // 계약일이 발효일 이전 → -0.12
  if (to   && contract > to)   return -0.12;   // 계약일이 만료일 이후 → -0.12
  if (from || to)              return  0.12;   // 범위 내 → +0.12
  return 0;                                    // 날짜 메타데이터 없음 → 0
}
```

### 문제
1. **하드 필터가 없다**: -0.12 패널티는 벡터 유사도(0.45~0.70)에 비해 작아, 계약일 이후 약관도 최종 top-3에 살아남을 수 있음
2. **메타데이터 부재 시 패널티 자체가 없다**: 약관 청크의 `metadata`에 `effective_from`/`effective_to`가 없으면 return 0 → 날짜 조정 전혀 없음
3. **사용 위치**: `scoreRow` (L721)에서만 사용 — `directlyRelevantOfficial`/`isDirectlyRelevantTerms` 등 필터 함수에는 연동 없음

### 확인 방법
DB에서 실제 메타데이터 확인 필요:
```sql
SELECT id, title, metadata->'effective_from', metadata->'effective_to'
FROM rag_master_chunks
WHERE source_area = 'terms_standards' AND title LIKE '%26년도%'
LIMIT 5;
```
메타데이터가 비어 있으면 패널티 = 0, 약관 연도와 무관하게 벡터 유사도만으로 선택됨.

---

## 3. 원인 2 — `cancerInsuranceQuery`가 갑상선/thyroid 특화, 비갑상선 암 케이스 감지 안 함

### 위치
`ragSearch.ts` L453–455

```typescript
function cancerInsuranceQuery(query: string) {
  return /암보험|암진단비|갑상선암|갑상선\s*결절|C73|E04|D34/i.test(query);
}
```

### DLBCL(C83.3) 케이스에서의 동작

DLBCL 쿼리에는 "C83.3", "림프종", "혈액암" 등이 포함되나 "C73"·"갑상선" 계열이 없음.  
→ `cancerInsuranceQuery(query)` = **false**

### 영향 (2단계 연쇄)

**단계 A** — L618–621 암 약관 전용 필터가 통째로 스킵됨:
```typescript
if (row.source_area === 'terms_standards' && cancerInsuranceQuery(query)) {
  // 실손/도수/백내장 제외 + 암진단비 키워드 필수 검증
  // → DLBCL 쿼리에서 이 블록 자체가 실행 안 됨
}
```

**단계 B** — L633에서 `isDirectlyRelevantTerms`만 실행됨:
```typescript
if (row.source_area === 'terms_standards') return isDirectlyRelevantTerms(row, query);
```

---

## 4. 원인 3 — `isDirectlyRelevantTerms`가 N18.5 콩팥병 청크를 통과시키는 메커니즘

### 위치
`ragSearch.ts` L734–796

### 통과 경로 분석

DLBCL 쿼리는 "암진단비", "혈액암", "C83.3" 등을 포함 → 이슈 그룹 매칭:
```typescript
{ query: /암|뇌경색|뇌출혈|심근경색|협심증|진단비|경계성|제자리/,
  terms: /암|뇌경색|뇌출혈|심근경색|협심증|진단비|경계성|제자리|진단확정/ }
```
쿼리에 "암" 있음 → 그룹 활성화 → 청크 `rowText`(title+summary+chunk_text+keywords)에
`/암|…|진단확정/`이 하나라도 있으면 통과.

### N18.5 청크 `rowText` 구성
`rowText = title + summary + chunk_text + keywords`

- `title`: "2026 26년도 약관.pdf keyword_matched_policy_clause" — "암" 없음
- `chunk_text` (샘플에 표시된 부분): 만성콩팥병/N18.5/신대체요법 텍스트 — "암" 없음
- **`keywords` 필드 (DB 저장값)**: 확인 안 됨. 만약 "진단확정", "암진단" 등이 저장되어 있으면 통과. 또는 chunk가 약관 PDF의 넓은 범위를 포함해 인접 섹션에 "암" 텍스트가 있을 수 있음.

`keyword_matched_policy_clause` source_type은 키워드 기반 임포트로 추가된 청크임을 암시.  
"진단확정" 같은 공통 약관 키워드로 임포트된 청크가 콩팥병 조항을 포함하게 된 것으로 추정.

### 확인 방법
```sql
SELECT id, title, keywords, chunk_text
FROM rag_master_chunks
WHERE source_area = 'terms_standards' 
  AND chunk_text LIKE '%N18.5%'
LIMIT 3;
```

---

## 5. 영향받는 케이스 범위

### 계약일 이후 약관 매칭
**사실상 모든 케이스에 존재**. `effectiveDateScore`의 -0.12 패널티가 하드 컷오프 없이 소프트 조정에 불과하기 때문. 특히 약관 청크에 날짜 메타데이터가 없을 경우 패널티 자체가 0.

### 비갑상선 암 케이스에서 `cancerInsuranceQuery = false`가 되는 케이스들
| 진단코드 | 암 유형 | cancerInsuranceQuery | 약관 필터 |
|----------|---------|---------------------|----------|
| C73 (갑상선암) | 갑상선 | **true** | 암 전용 필터 적용 |
| C83.3 (DLBCL) | 혈액암/림프종 | **false** | 필터 미적용 |
| C50 (유방암) | 유방 | **false** | 필터 미적용 |
| C18 (대장암) | 대장 | **false** | 필터 미적용 |
| C34 (폐암) | 폐 | **false** | 필터 미적용 |
| C16 (위암) | 위 | **false** | 필터 미적용 |
| C25 (췌장암) | 췌장 | **false** | 필터 미적용 |

DLBCL 케이스(ASSESS_046)와 유사한 무관 약관 조항 혼입이 갑상선 제외 암 케이스 전체에서 발생 가능.

ASSESS_035 (유방암, C50.x) — 단, 이미 cancer 분기에서 구체 반박이 생성됨. 약관 섹션 자체는 동일 문제 잠재.

---

## 6. ASSESS_046 콩팥병 조항 혼입 — 증상 요약

**발생 경로**: DLBCL C83.3 쿼리 → `cancerInsuranceQuery = false` → 암 필터 미적용 → `isDirectlyRelevantTerms`에서 "암" 쿼리-이슈그룹 활성화 → N18.5 청크 rowText에 "암" 또는 "진단확정" 포함 시 통과 → 콩팥병/신대체요법 조항이 IV섹션에 인용

**영향**: 사정서 Ⅳ섹션이 DLBCL과 무관한 만성콩팥병(5기) 약관 조항을 인용 → 신뢰성 저하

---

## 7. 수정 방안 제안

### 방안 A: `cancerInsuranceQuery` 확장 (즉시 적용 가능, 중간 난이도)

현재 갑상선 특화 → 일반 암 케이스로 확장:
```typescript
function cancerInsuranceQuery(query: string) {
  return /암보험|암진단비|갑상선암|갑상선\s*결절|C73|E04|D34|일반암|소액암|제자리암|경계성종양|혈액암|림프종|C[1-8]\d|C9[0-7]/i.test(query);
}
```
효과: DLBCL 등 비갑상선 암 케이스에도 L618-621 암 약관 전용 필터 적용.

### 방안 B: `effectiveDateScore`에 하드 컷오프 추가 (중난이도)

현재: 소프트 ±0.12 → 수정: 계약일보다 명확히 이후인 약관은 `directlyRelevantOfficial`에서 false 반환:
```typescript
function effectiveDateHardBlock(row: EnrichedRow, contractDate?: string): boolean {
  const contract = parseDate(contractDate);
  if (!contract) return false;
  const from = parseDate(firstMetadataValue(row, ['effective_from', 'effectiveFrom']));
  // 계약일보다 1년 이상 이후 약관은 차단
  if (from && contract < new Date(from.getTime() - 365*24*60*60*1000)) return true;
  return false;
}
```
주의: 약관 청크에 `effective_from` 메타데이터가 저장되어 있어야 작동. DB 상태 먼저 확인 필요.

### 방안 C: 약관 청크 keyword 필드 오염 점검 (데이터 레이어)

"진단확정" 키워드로 임포트된 청크 중 암과 무관한 조항(실손, 콩팥병, 희귀난치성 등) 포함 여부 확인.  
필요 시 `keywords` 필드에서 일반적 약관 키워드 제거 또는 `source_type` 재분류.

### 권장 순서
1. **방안 A** (cancerInsuranceQuery 확장) — 코드 변경만, 즉시 효과
2. **DB 확인** (방안 B/C 전제) — `effective_from` 메타데이터 현황, N18.5 청크 keywords 확인
3. **방안 B** — DB에 날짜 메타데이터 있으면 추가 구현

---

## 8. 미해결 확인 사항

- [ ] DB에서 terms_standards 청크들의 `effective_from`/`effective_to` 메타데이터 실제 저장 현황
- [ ] N18.5 청크의 `keywords` 필드 내용 확인
- [ ] `keyword_matched_policy_clause` source_type 임포트 스크립트에서 키워드 선정 방식 확인
- [ ] ASSESS_035 (C50.x 유방암) Ⅳ섹션에 콩팥병/실손 조항 혼입 여부 확인
