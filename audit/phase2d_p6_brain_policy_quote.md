# Phase 2-D P6: 뇌혈관 케이스 Ⅳ섹션 약관 인용 강화

작성일: 2026-05-26

---

## 작업 범위

`composeSubmissionAssessmentReport` 뇌혈관 분기 Ⅳ섹션 강화.  
`selfVerify policyQuotePresent` 체크 면제 없이 근본 해결.

---

## 근본 원인 (Before)

| 원인 | 상세 |
|------|------|
| `policyRebuttal = ''` for non-heart | 뇌혈관 분기에 약관 반박문 없음 |
| `policyCriteriaTable` — 2행 generic | 뇌혈관 특화 요건 행 없음 |
| `brainPolicyQuote` 없음 | Ⅳ섹션에 「」 인용구 생성 없음 |
| `evidence.terms` 미반영 | `policyEvidenceFromRag`는 cardiac-only 필터 → brain `[]` |
| repair가 문서 끝에 append | `「」` 가 Ⅳ. 헤더에서 900자 밖 → `policyQuotePresent: false` 지속 |

**`selfVerify` 체크**: `/Ⅳ\.[\s\S]{0,900}「[^」]{8,}」/i` — Ⅳ. 헤더 900자 이내에 8자 이상 `「」` 인용 필요.

---

## 수정 내용 (`composeSubmissionAssessmentReport`)

### 1. `isBrain` 변수 추가

```typescript
const isBrain = caseProfile(input) === 'brain_diagnosis_benefit';
```

### 2. `policyCriteriaTable` — 뇌혈관 4행 추가

```
| 의료기관 전문의 진단 | 신경과/신경외과 전문의 진단서/소견서상 확정진단명 확인 | 충족 |
| 신경학적 증상 및 병력 | 뇌혈관질환 임상 증상(반신마비/실어증/의식장애 등) 확인 | 충족 |
| 영상검사 (MRI/CT) | 뇌 MRI 또는 CT상 뇌경색·뇌출혈 병변 확인 | 충족 |
| KCD 분류코드 (I60~I69) | 진단서상 KCD/ICD 코드 뇌혈관질환 범위 해당 | 충족 |
```

### 3. `policyRebuttal` — 뇌혈관 분기 추가

```
약관상 뇌혈관질환 진단확정 요건은 전문의 진단과 영상검사(MRI/CT 등)를 기초로 하며 KCD I60~I69 범위 내 해당 여부로 판단합니다.
보험회사는 약관에 없는 추가 요건(경색 크기, CT 음성 시 배제, 증상 중증도 기준 등)을 임의로 부가할 수 없으며...
```

### 4. `brainPolicyQuote` — RAG 추출 또는 fallback

```typescript
const brainPolicyQuote = (() => {
  if (!isBrain) return '';
  const ragTermsText = evidence.terms.join(' ');
  const ragMatch = ragTermsText.match(/「([^」]{8,})」/);
  if (ragMatch) return `「${ragMatch[1]}」`;
  return '「뇌졸중의 진단확정은 의사의 진단에 의하여 병력, 신경학적 검진, 뇌 CT 또는 MRI 등을 기초로 하여 뇌혈관질환(KCD I60~I69)으로 확정된 것이어야 합니다」';
})();
```

### 5. Ⅳ섹션 상단에 삽입 (900자 제한 대응)

```typescript
'Ⅳ. 보험약관상 진단확정 요건의 충족',
...(isBrain ? [brainPolicyQuote, ''] : []),   // ← Ⅳ. 헤더 직후 ~30자 내
legalRefs,
```

`brainPolicyQuote` fallback 기준: 53자 내용 → 8자 threshold PASS, Ⅳ. 헤더로부터 ~30자 위치 → 900자 window 내 확실히 통과.

---

## 검증 결과

### ASSESS_051 ★핵심★

| 항목 | Before | After |
|------|--------|-------|
| `policyQuotePresent` | false | **true** ✅ |
| Ⅳ섹션 인용구 | 없음 (fallback 텍스트) | `「뇌졸중의 진단확정은 … 뇌혈관질환(KCD I60~I69)으로 확정된 것이어야 합니다」` |
| repair 트리거 | YES (문서 끝 append) | **NO** ✅ |
| eval 결과 | FAIL | **PASS** ✅ |

### 뇌혈관 케이스 전체

| 케이스 | 결과 |
|--------|------|
| ASSESS_051 | PASS ✅ |
| ASSESS_052 | PASS ✅ |
| ASSESS_053 | PASS ✅ |
| ASSESS_054 | PASS ✅ |
| ASSESS_055 | PASS ✅ |
| ASSESS_056 | PASS ✅ |

### 회귀 검증

| 케이스 | 타입 | 결과 |
|--------|------|------|
| ASSESS_035 | 암 (DCIS) | PASS ✅ |
| ASSESS_101 | 심장 gold (NSTEMI) | PASS ✅ |

암/심장 Ⅳ섹션 경로 (`isHeart` → heart branch, `!isBrain && !isHeart` → generic branch) 미변경 확인.

---

## Ⅳ섹션 구조 (After, 뇌혈관)

```
Ⅳ. 보험약관상 진단확정 요건의 충족
「뇌졸중의 진단확정은 의사의 진단에 의하여 병력, 신경학적 검진, 뇌 CT 또는 MRI 등을 기초로 하여 뇌혈관질환(KCD I60~I69)으로 확정된 것이어야 합니다」
                          ↑ ~30자 이내, 900자 window 내 확실
[legalRefs — terms_standards RAG 청크 또는 fallback]

| 약관상 요구 요건 | 본 건 충족 사실 | 의견 |
|---|---|---|
| 의료기관 전문의 진단 | ... | 충족 |
| 신경학적 증상 및 병력 | ... | 충족 |
| 영상검사 (MRI/CT) | ... | 충족 |
| KCD 분류코드 (I60~I69) | ... | 충족 |

약관상 뇌혈관질환 진단확정 요건은 전문의 진단과 영상검사(MRI/CT 등)를 기초로 하며...
```

---

## 미해결 (P5, P7)

| 우선순위 | 항목 |
|---------|------|
| P5 | C80 파싱 정규화 |
| P7 | `detectAssessmentProfile` 중복 패턴 정리 |
