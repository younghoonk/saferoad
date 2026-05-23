# Phase 2D: 암 세트2 교체 + 검증 결과

작성일: 2026-05-23  
교체 케이스: ASSESS_031, 033, 034, 036, 038, 040  
expectedProfile 통일: 전부 `cancer_diagnosis_benefit`

---

## 1. 교체 내용

| ID | 이전 프로파일 | 변경 후 | 쟁점 유형 |
|----|-------------|---------|---------|
| ASSESS_031 | cancer_borderline_in_situ | cancer_diagnosis_benefit | 대장 점막내암(C18.7 vs D01.0) |
| ASSESS_033 | cancer_borderline_in_situ | cancer_diagnosis_benefit | GIST 행동양식(/3 vs /1, C16 vs D37) |
| ASSESS_034 | cancer_borderline_in_situ | cancer_diagnosis_benefit | 방광암 T1(C67 vs D09) |
| ASSESS_036 | cancer_diagnosis_benefit | cancer_diagnosis_benefit | AML C92.0 진단확정 시점 |
| ASSESS_038 | cancer_borderline_in_situ | cancer_diagnosis_benefit | 호지킨림프종 C81.1 진단확정 방법 |
| ASSESS_040 | cancer_diagnosis_benefit | cancer_diagnosis_benefit | 발덴스트롬 C88.0 일반암 해당 여부 |

---

## 2. 케이스별 PASS / FAIL 판정

| 케이스 | Ⅱ섹션 구체성 | cardiac 혼입 | mustNotInclude | 판정 |
|--------|------------|-------------|---------------|------|
| ASSESS_031 | ✓ C18.7/D01.0 코드 불일치, high grade, 절제 임상 경과 | 없음(0건) | 통과 | **PASS** |
| ASSESS_033 | ✗ generic (행동양식/ICD-O 구체 반박 없음) | **12건** (2013다208661) | **FAIL** | **FAIL** |
| ASSESS_034 | ✓ C67.9/D09.0 코드 불일치, T1 침윤, high grade | 없음(0건) | 통과 | **PASS** |
| ASSESS_036 | △ 책임개시일 부지급 이유 직접 인용, 반박 2건(약간 generic) | 없음(0건) | 통과 | **PARTIAL** |
| ASSESS_038 | △ ICD-O /3 행동양식 반박 있음, Reed-Sternberg/FNA 구체화 없음 | 없음(0건) | 통과 | **PARTIAL** |
| ASSESS_040 | ✗ generic (C88.0 악성/저등급 구체 반박 없음) | **12건** (2013다208661) | **FAIL** | **FAIL** |

**결과: 2 PASS / 2 PARTIAL / 2 FAIL (PASS+PARTIAL 4/6)**

---

## 3. ★ cardiac 혼입 근본 원인 (033/040)

### 증상
- Ⅰ섹션(사건경위) killing evidence에 `2013다208661 심근경색(NSTEMI/I21.4)` 판례가 4번 반복
- `2014.06.12` 날짜 + `cardiac marker, EKG, UA-NSTEMI, CAG/PCI` 내용이 타임라인 이벤트로 삽입

### 발생 경로
1. RAG 검색 시 `2013다208661` precedent chunk가 GIST(C16)/발덴스트롬(C88) 쿼리에 반환됨
2. `cancerDiagnosisProfile` 필터(index.ts:4418)가 차단 시도:
   ```typescript
   if ((ref.source_area === 'precedents') && /NSTEMI|STEMI|I21\.\d|심내막하심근경색|급성심근경색/i.test(text)) return false;
   ```
3. **필터 미작동**: `text`는 `ref.title + ref.summary + ...` 필드 조합 — 일부 `2013다208661` 청크의 `summary` 필드에 NSTEMI/I21.4 키워드가 없으면 필터 통과
4. 통과된 판례가 `isSubmissionMedicalChronologyLine`을 만족 → Ⅰ섹션 타임라인으로 삽입

### 왜 033/040만? (036/038은 정상)
- C81.1(호지킨)/C92.0(AML): 표준 혈액암 → 충분한 cancer-specific RAG 결과 → `2013다208661` 유사도 점수 낮음 → 미포함
- C16.2(GIST)/C88.0(발덴스트롬): 희귀/특수 → cancer-specific RAG 결과 빈약 → `2013다208661` 유사도 상대적으로 높아 포함

### 구조적 근본 원인
현재 `cancerDiagnosisProfile` 판례 필터가 **차단 목록(blocklist)** 방식:
`2013다208661`의 특정 키워드만 제거 → 키워드 없는 청크는 통과.

**필요한 방향**: allowlist 방식 — cancer 쿼리에서 판례는 cancer-specific 키워드 포함 청크만 허용 (brain cases의 `brainInsuranceQuery` 필터와 동일한 구조).

---

## 4. Ⅱ섹션 구체성 분석

### PASS 케이스 — 구체 반박 확인

**ASSESS_031** (점막내암)
```
1) 병리 보고서 D01.0(제자리암)를 근거로 진단서 C18.7 악성 진단을 부정하는 주장
   → medical_criteria_distortion: high nuclear grade, 종양 크기 1.5cm, 수술적 절제 임상 경과 언급
2) 진단서 C코드보다 병리 보고서 D코드를 우선 적용하는 주장
   → policy_requirement_misread: D01.0 사후 대체는 약관에 없는 추가 요건
3) 약관상 암 진단확정 요건 미충족 주장
   → 병리 보고서 제출로 요건 충족 반박
```
→ **035(DCIS)와 동일 구조 작동** ✓

**ASSESS_034** (방광암 T1)
```
1) 병리 보고서 D09.0(제자리암)를 근거로 진단서 C67.9 악성 진단을 부정하는 주장
   → medical_criteria_distortion: T1 고유판 침윤, high grade, 2.0cm 언급
2) D코드 우선 적용 주장 → 약관에 없는 추가 요건
3) 약관상 진단확정 요건 미충족 → 병리 보고서 충족 반박
```
→ **T1 침윤/CIS 구분 논거 포함** ✓

### PARTIAL 케이스 — 부분 특화

**ASSESS_036** (AML 책임개시일)
- 보험사 부지급 이유 직접 인용: "경미한 빈혈(Hb 11.5)로 발병 추정" ✓
- 반박 2건: 약관상 진단확정 요건(병리 보고서 충족), 추가 요건 불가 원칙
- 한계: `2024.06.18 골수모세포 45%` 명시적 반박, `빈혈 ≠ AML` 의학적 구체화 부족

**ASSESS_038** (호지킨 림프종)
- ICD-O behavior code /3(악성) vs /2(상피내암) 구분 언급 ✓
- 한계: Reed-Sternberg 세포, CD30/CD15, FNA vs 절제생검 구분 없음

### FAIL 케이스 — generic + cardiac 오염

**ASSESS_033, 040**: 보험사 주장 직접 인용은 있으나 반박이 "omitted_key_evidence: 일부 문구만으로 부지급" 수준. GIST NIH 위험도, 발덴스트롬 MYD88/IgM 수치 언급 없음.

---

## 5. 회귀 검증

| 케이스 | 암 | cardiac | brain | 판정 |
|--------|---|---------|-------|------|
| ASSESS_035 (DCIS) | 35건 ✓ | 0 | 0 | **PASS** |
| ASSESS_051 (뇌경색) | 0 | 0 | 38건 ✓ | **PASS** |
| ASSESS_101 (심장) | 0 | 44건 ✓ | 0 | **PASS** |

---

## 6. 후속 과제 (우선순위)

| # | 과제 | 유형 | 대상 | 우선순위 |
|---|------|------|------|---------|
| 1 | cancer 판례 필터 allowlist 방식 전환 | 코드 | ragSearch.ts / index.ts | 높음 |
| 2 | C16.x/C88.x 쿼리에 `2013다208661` 혼입 차단 | 코드 | index.ts cancerDiagnosisProfile 필터 | 높음 |
| 3 | ASSESS_033 GIST 행동양식 구체 반박 | 케이스 품질 | buildCancerInsurerErrorMap | 중간 |
| 4 | ASSESS_040 발덴스트롬 C88.0 구체 반박 | 케이스 품질 | buildCancerInsurerErrorMap | 중간 |
| 5 | ASSESS_036/038 Ⅱ섹션 추가 구체화 | 케이스 품질 | cancer 분기 확장 | 낮음 |

---

## 7. 관련 커밋

| 커밋 | 내용 |
|------|------|
| `bb75fc6` | 암 케이스에 2013다208661 혼입 최초 차단 (C50/C73 대상) |
| `4471d34` | 뇌혈관 암 약관 혼입 차단 (brainInsuranceQuery allowlist 방식) |
| 이번 커밋 | 암 세트2 교체 + 검증 — GIST/발덴스트롬 cardiac 혼입 신규 확인 |
