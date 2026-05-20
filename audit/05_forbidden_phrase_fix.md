# FORBIDDEN_PHRASE_FAIL 박멸 보고서

작성일: 2026-05-21  
대상 케이스: ASSESS_001 (M47.26 1회 통원 미고지 실손보험 해지)  
수정 파일: `supabase/functions/create-assessment-draft/index.ts`

---

## 1. 누출 원인 분석

### 실패 내역 (수정 전)

```
forbidden submission internals: confidence/document_type/completed/file marker/date placeholder
forbidden argument wording: /\[일자 확인\]/g
```

### 원인 A: 프롬프트가 GPT-4o에게 대괄호 플레이스홀더를 학습시킴

`buildDraftPrompt()` line 712:
```
Unknown personal values must be placeholders such as [피보험자], [주민번호], [주소], [연락처], [증권번호].
```

GPT-4o가 이 패턴을 학습하여, **날짜가 없는 경우** `[일자 확인]`, **수치가 없는 경우** `[확인 필요]` 등을 자동 생성. ASSESS_001 케이스에 `accidentDate`가 없어 특히 발생.

### 원인 B: `enforceSubmissionReportContract()`의 적용 범위 제한

적용 전:
```
enforceSubmissionReportContract(finalSubmissionAssessmentReport)만 적용
adjusterOpinionDraft, requiredAdditionalChecks 등 → cleanPublicText()만 통과 (forbidden 패턴 미제거)
```

GPT-4o가 `[일자 확인]`을 `adjusterOpinionDraft`에 생성 → `enforceSubmissionReportContract()`가 처리하지 않음 → eval의 `draftText()` 검사에서 감지.

### 원인 C: `FORBIDDEN_PHRASE_PATTERNS` 분산 정의

`enforceSubmissionReportContract()`, `selfVerifySubmissionReport()`, `cleanSubmissionMedicalFact()`에 각각 다른 형태로 패턴이 정의되어 동기화 불일치 존재.

---

## 2. 적용한 3중 방어선

### 방어선 1: 프롬프트 레벨 (buildDraftPrompt)

`[핵심 원칙]` 섹션에 절대 금지 출력 패턴 명시 추가:

```
[절대 금지 출력 패턴]
· 대괄호 플레이스홀더: [일자 확인], [확인 필요], [TBD], [PLACEHOLDER], [날짜], [일자] 등
· 영문 메타데이터 키: confidence, document_type, completed, status, file_name, phase
· 날짜 불명 시: "일자 미기재" 또는 "해당 사항 없음"
· 수치 불명 시: "수치 미기재" 또는 "검사결과 기재 없음"
```

**효과:** GPT-4o가 처음부터 이 패턴을 생성하지 않도록 방지 (Source-level prevention).

### 방어선 2: Composer 레벨 (sanitizeResult)

`FORBIDDEN_PHRASE_PATTERNS` 상수 정의 (모듈 최상단):

```typescript
const FORBIDDEN_PHRASE_PATTERNS: RegExp[] = [
  /\[일자\s*확인\]/g,
  /\[확인\s*필요\]/g,
  /\[TBD\]/gi,
  /\[PLACEHOLDER\]/gi,
  /\[날짜\]/g,
  /\[일자\]/g,
  /\[[A-Z][A-Z_]{1,}\]/g,      // 영문 대문자 2자 이상 플레이스홀더 일반형
  /\bconfidence\s*[:=]\s*[^\s,\])\n]*/gi,
  /\bdocument_type\s*[:=]\s*[^\s,\])\n]*/gi,
  /\bcompleted\s*[:=]\s*[^\s,\])\n]*/gi,
  /\bSKMBT_[^\s,)]+/gi,
  /\bResized_[^\s,)]+/gi,
];
```

`stripForbiddenPhrases()` 함수 추가 → `sanitizeResult()`의 모든 텍스트 필드에 적용:

```typescript
const clean = (v: string | undefined) => stripForbiddenPhrases(cleanPublicText(v));
// title, overview, facts, issues, legalAndReferenceBasis, damageAssessment,
// insurerPositionReview, adjusterOpinionDraft, requiredAdditionalChecks,
// simpleClientSummary, customerSideAssessmentReport, finalSubmissionAssessmentReport
// → 모두 clean() 적용
```

**효과:** GPT-4o가 어느 필드에 생성하든 출력 직전 제거 (Catch-all).

`enforceSubmissionReportContract()`도 `FORBIDDEN_PHRASE_PATTERNS`를 재활용하여 동기화:
```typescript
const prohibitedPatterns = [
  /초안/g, /참고용/g, ...기존 약어 패턴들...,
  ...FORBIDDEN_PHRASE_PATTERNS,  // 추가
];
```

### 방어선 3: SelfVerification 레벨

`SelfVerification` 인터페이스에 `forbiddenPhrasesAbsent: boolean` 추가.

`selfVerifySubmissionReport()` 에 체크 추가:
```typescript
forbiddenPhrasesAbsent: !FORBIDDEN_PHRASE_PATTERNS.some((p) => { p.lastIndex = 0; return p.test(text); })
  && !/\bconfidence\b|\bdocument_type\b|\bcompleted\b|\bSKMBT_|\bResized_/i.test(text),
```

`selfVerificationPasses()` 에 `value.forbiddenPhrasesAbsent` 조건 추가.

`repairSubmissionReport()` 에 대응 로직:
- `forbiddenPhrasesAbsent === false` → 보고서에서 `FORBIDDEN_PHRASE_PATTERNS` 일괄 제거 후 반환
- 추가 repairs도 함께 적용

**효과:** 방어선 1·2를 뚫은 패턴이 있으면 self-repair 루프에서 최종 차단.

---

## 3. 수정 전후 비교

| 항목 | 수정 전 | 수정 후 |
|------|---------|---------|
| `[일자 확인]` in `adjusterOpinionDraft` | 통과 (cleanPublicText만 적용) | 제거 (stripForbiddenPhrases 적용) |
| `[일자 확인]` in `finalSubmissionAssessmentReport` | enforceSubmissionReportContract 적용 | enforceSubmissionReportContract + FORBIDDEN_PHRASE_PATTERNS |
| `confidence/document_type/completed` | enforceSubmissionReportContract에서 일부 제거 | 모든 필드에 stripForbiddenPhrases 적용 |
| 프롬프트 지시 | 없음 (GPT-4o가 [피보험자] 패턴 유추) | 명시적 금지 + 대안 표현 안내 |
| selfVerification | weakLanguageAbsent에 일부 포함 (혼합) | forbiddenPhrasesAbsent 독립 체크 |
| repairSubmissionReport | 금지 패턴 감지 시 repair 없음 | forbiddenPhrasesAbsent=false 시 자동 제거 |

---

## 4. 배포 및 검증 순서

```powershell
# 1. 변경사항 확인
git diff supabase/functions/create-assessment-draft/index.ts

# 2. 커밋 후 push (GitHub Desktop 또는 git push)
git commit -m "fix(ai): triple-layer defense against forbidden phrase leakage"
git push origin rag-datasets-staging

# 3. Supabase Dashboard에서 Edge Function 재배포
# https://supabase.com/dashboard/project/xnbmostitbwntazexpos/functions
# create-assessment-draft → Deploy

# 4. 배포 완료 후 ASSESS_001 검증
node scripts/evalAssessmentDrafts.js --limit 1

# 5. FORBIDDEN_PHRASE_FAIL 없으면 5건 확장
node scripts/evalAssessmentDrafts.js --limit 5
```

---

## 5. 예상 영향도

| 케이스 유형 | 예상 변화 |
|------------|---------|
| ASSESS_001 (M47.26 고지의무) | FORBIDDEN_PHRASE_FAIL → 해소 |
| ASSESS_063 (I21 급성심근경색) | 유지 또는 개선 (weak language 정리) |
| ASSESS_051 (I63 뇌경색) | 유지 또는 개선 |
| 전체 100건 | FORBIDDEN_PHRASE_FAIL 비율 대폭 감소 예상 |

**주의:** `selfVerificationPasses()`에 `forbiddenPhrasesAbsent` 조건 추가로, 이전에 통과하던 케이스 중 forbidden 패턴이 있던 케이스가 self-repair 루프를 한 번 더 돌 수 있음. 품질은 같거나 향상, 속도는 약간 증가 가능.
