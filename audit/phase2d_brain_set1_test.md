# 뇌혈관질환 케이스 세트1 테스트 결과

작성일: 2026-05-23  
배포 커밋: `22a74e3` (샘플 생성 기준) / `edbb3a8` (fix commit — ★재배포 필요)  
케이스 파일: `ai_eval/assessment_cases_100_v1.json` (ASSESS_051~056)

---

## 1. 프로파일 인식

| 케이스 | expectedProfile | 실제 감지 | 일치 |
|--------|----------------|----------|------|
| ASSESS_051 | brain_diagnosis_benefit | brain_diagnosis_benefit | ✓ |
| ASSESS_052 | brain_diagnosis_benefit | brain_diagnosis_benefit | ✓ |
| ASSESS_053 | brain_diagnosis_benefit | brain_diagnosis_benefit | ✓ |
| ASSESS_054 | brain_diagnosis_benefit | brain_diagnosis_benefit | ✓ |
| ASSESS_055 | brain_diagnosis_benefit | brain_diagnosis_benefit | ✓ |
| ASSESS_056 | brain_diagnosis_benefit | brain_diagnosis_benefit | ✓ |

**6/6 정상 감지.** `detectAssessmentProfile`의 L101 brain 분기가 올바르게 동작함.

---

## 2. buildClaimArgumentStructure 분기

`isHeart` → cardiac 전용 / `isCancer` → `buildCancerClaimArgument()` / **else → generic 분기**.

`brain_diagnosis_benefit` 프로파일은 현재 **else(generic) 분기**로 처리됨.  
Ⅱ섹션 반박이 brain-specific이 아닌 generic 템플릿 패턴으로 생성됨 (아래 §4 참조).

---

## 3. Cardiac / 암 혼입 검사 (22a74e3 기준 pre-fix 샘플)

### 3-1. Cardiac 혼입

| 케이스 | "결정적 의무기록 문구" cardiac 혼입 | 본문 cardiac 혼입 |
|--------|-----------------------------------|-----------------|
| ASSESS_051 | ✗ PCI ("관상동맥촬영술 및 PCI/stent 시행은...관상동맥증후군") | 없음 |
| ASSESS_052 | ✗ PCI (동일) | 없음 |
| ASSESS_053 | ✗ PCI (동일) | 없음 |
| ASSESS_054 | ✗ PCI (동일) | 없음 |
| ASSESS_055 | ✗ PCI (동일) | 없음 |
| ASSESS_056 | ✗ PCI (동일) | 없음 |

**원인**: `extractKillingEvidence` CAG/PCI 블록의 regex에 `|협착`이 포함되어 있어,  
뇌혈관 협착(MRA/CTA 소견)이 cardiac evidence로 오인됨.

**수정 완료** (commit `edbb3a8`):
```typescript
const isBrainProfile = caseProfile(input) === 'brain_diagnosis_benefit';
const cardiacProcedurePattern = /CAG|PCI|LM-?LAD|LM disease|LM-?mLAD|stent|스텐트|관상동맥(?:\s*협착)?/i;
if (!isBrainProfile && cardiacProcedurePattern.test(source)) { ... }
```
→ 재배포 후 "결정적 의무기록 문구"에서 cardiac 텍스트 사라질 것

### 3-2. 암 혼입

| 케이스 | "결정적 의무기록 문구" 암 혼입 | 본문 암 혼입 |
|--------|-------------------------------|------------|
| ASSESS_051~055 | 없음 | 없음 |
| ASSESS_056 | ✗ "병리 보고서상 조직학적 소견" + "악성 또는 암에 준한 임상적 판단" | 없음 |

**원인 (056 한정)**: 2021/2026 약관 RAG 텍스트에 "수술"이 포함 → cancer 수술 블록 오트리거.  
**수정 완료** (commit `edbb3a8`):
```typescript
if (!hasCardiacTerms && !isBrainProfile) {  // cancer 블록 전체에 brain guard 추가
```
→ 재배포 후 056 암 혼입 해소

### 3-3. 신장/기타 혼입

전체 6건 없음 ✓

---

## 4. Ⅱ섹션 반박 구체성

**현재 패턴 (generic):**
```
1) [insurerPosition 직접 인용]
   - 오류 유형: omitted_key_evidence
   - 반박 명제: 보험회사는 제출자료 전체가 아니라 일부 문구나 제한된 근거만으로 부지급 판단을 구성한 것으로 보입니다.
2) 약관상 지급요건 미충족 주장
   - 오류 유형: policy_requirement_misread
   - 반박 명제: 부지급을 유지하려면 가입 당시 약관 문언과 고객 자료가 어떻게 불일치하는지 보험회사가 구체적으로 제시해야 합니다.
3) 추가 요건을 전제로 한 지급 거절
   - 오류 유형: unsupported_additional_requirement
   - 반박 명제: 약관에 없는 요건을 사후적으로 추가하여 지급을 제한할 수 없습니다.
```

**판정**: ✗ **generic** — 6건 동일 패턴.  
DWI, ADC map, NIHSS, 뇌연화증, TIA 정의 등 케이스별 뇌 소견 미반영.

**단, Ⅲ섹션은 case-specific 작동 확인**:
- ASSESS_051: "DWI 및 ADC map에서 급성 허혈성 병변이 확인되었고, 지속적인 신경학적 결손이 존재하여 TIA와는 구분됩니다" ← 입력 내용 반영
- ASSESS_052: TIA 조직기반 정의, 뇌연화증 언급 ✓
- ASSESS_053: 열공성 경색, 소혈관 병변 기준 ✓

**결론**: `buildClaimArgumentStructure`에 brain-specific 분기 (`isBrain` branch) 추가가 필요하면  
구체적 Ⅱ섹션 반박이 가능. 현재 Ⅲ섹션 수준은 준수하나 Ⅱ섹션이 약함.

---

## 5. 약관 매칭

| 케이스 | 계약일 | terms_standards 매칭 | 비고 |
|--------|--------|---------------------|------|
| ASSESS_051 | 2018-06 | 없음 | 뇌혈관 특화 약관 청크 DB 미확보 |
| ASSESS_052 | 2020-01 | 없음 | 동일 |
| ASSESS_053 | 2017-09 | 없음 | 동일 |
| ASSESS_054 | 2019-11 | 없음 | 동일 |
| ASSESS_055 | 2023-12 | 2021 약관 ✓ | 2021 < 2023, +0.20 보너스 적정 |
| ASSESS_056 | 2016-04 | 2026 + 2021 약관 ✗ | 둘 다 계약 이후. 2012/2016 뇌혈관 청크 DB 부재로 대체 불가 |

- 뇌혈관 전용 약관 청크(I60~I69 분류표 포함 2012~2016 약관)가 DB에 없어 051~054는 약관 0건
- 056은 기존 암 케이스 동일 문제(계약 이후 약관 잔존, DB 데이터 갭)
- 약관 0건은 Ⅳ섹션에 "직접 적용 가능한 가입 당시 원약관 자료 미확인"으로 graceful fallback 처리됨

---

## 6. PASS/FAIL 판정 (pre-fix 22a74e3 기준)

| 케이스 | 프로파일 | cardiac 혼입 | 암 혼입 | 7단 구조 | 타임아웃 | 판정 |
|--------|---------|-------------|--------|---------|---------|------|
| ASSESS_051 | ✓ | ✗(PCI*) | 없음 | ✓ | 없음 | **PARTIAL** |
| ASSESS_052 | ✓ | ✗(PCI*) | 없음 | ✓ | 1회(재시도 성공) | **PARTIAL** |
| ASSESS_053 | ✓ | ✗(PCI*) | 없음 | ✓ | 없음 | **PARTIAL** |
| ASSESS_054 | ✓ | ✗(PCI*) | 없음 | ✓ | 없음 | **PARTIAL** |
| ASSESS_055 | ✓ | ✗(PCI*) | 없음 | ✓ | 없음 | **PARTIAL** |
| ASSESS_056 | ✓ | ✗(PCI*) | ✗(암템플릿*) | ✓ | 없음 | **PARTIAL** |

\* = `edbb3a8` fix에서 수정됨. 재배포 후 PASS 예상.

---

## 7. 수정 요약 및 후속 과제

### 이번 세션 수정 (edbb3a8)
| 수정 | 대상 | 효과 |
|------|------|------|
| CAG/PCI 블록 brain guard | `extractKillingEvidence` | 뇌 케이스 "결정적 의무기록 문구" cardiac 혼입 제거 |
| cancer 블록 brain guard | `extractKillingEvidence` | 뇌 코일색전술이 암 수술로 오인되는 현상 제거 |

### 후속 과제 (이번 스코프 외)
| 과제 | 우선순위 | 비고 |
|------|---------|------|
| Ⅱ섹션 brain-specific 반박 분기 추가 | 중간 | `buildClaimArgumentStructure`에 `isBrain` 분기 신설 필요 |
| 뇌혈관 약관 DB 보강 (2012~2016 뇌혈관 분류표) | 중간 | 051~054 Ⅳ섹션 약관 0건 해소 |
| ASSESS_056 약관 연도 문제 | 낮음 | DB 데이터 갭 (기존 issue, 암 케이스와 동일) |

### 재배포 필요
`edbb3a8` fix 배포 후 뇌 6건 재생성으로 최종 확인 권장.

---

## 8. 참고: 생성 품질 관찰 (22a74e3 pre-fix)

- **Ⅲ섹션 (의학)**: brain-specific 가이드라인(AHA/ASA 뇌졸중/TIA, ICH, SAH 기준) 정상 인용 ✓
- **Ⅴ섹션 (판례/금감원)**: 뇌혈관 FSS 분쟁조정례 정상 인용 ✓ (뇌경색 진단급여금 사례)
- **Ⅶ섹션 (결론)**: 지연이자·서면 회신 요청 ✓
- **금지 표현**: 없음 ✓
- **심장(ASSESS_101) 회귀**: 없음 (이전 세션 확인)
