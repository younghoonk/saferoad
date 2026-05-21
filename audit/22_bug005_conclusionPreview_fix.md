# BUG-005 conclusionPreview 문장 깨짐 수정

작성일: 2026-05-21  
누적 비용: ~$2

---

## 1. 문제

`conclusionPreview` 및 `preview` 필드에서 아래와 같은 깨진 문장 패턴 발생:

```
"따라서 보험금 지급을, 위 고객의 방향으로 의견을 정리한다."
```

`stripProhibitedBodyPhrases`가 템플릿 문장에서 중간 어구만 제거하면서 발생:
- 원본: "따라서 손해사정 의견은 ... 방향으로 의견을 정리한다."
- `검토 가치가 있습니다` 등 하위 패턴이 중간에 적중 → 앞뒤 쉼표·조사만 남음

## 2. 수정 내용

**파일:** `supabase/functions/create-assessment-draft/index.ts`  
**함수:** `stripProhibitedBodyPhrases`

### 2.1 템플릿 전체 문장 패턴 추가 (prohibited 배열 최상단)

```typescript
// Before: 하위 어구 패턴만 존재 → 중간만 제거되어 쉼표/조사 유령 발생

// After: 전체 템플릿 문장을 먼저 통째로 제거
/따라서\s*손해사정\s*의견은[^\n]*?(?:정리한다|재검토해야\s*한다는\s*방향)[^\n]*\.?[ \t]*/g,
```

### 2.2 사후 정리 (clean 함수 내)

```typescript
// 하위 패턴 제거 후 남은 유령 조사·쉼표 정리
text = text
  .replace(/[ \t]*,[ \t]*(?=[위이에])/g, ' ')
  .replace(/[ \t]+[을를][ \t]+(?=[위재검])/g, ' ')
  .replace(/,\s*\n/g, '\n')
  .replace(/[ \t]{2,}/g, ' ');
```

## 3. 효과

| 케이스 | 이전 | 이후 |
|--------|------|------|
| ASSESS_051 | PASS | PASS |
| ASSESS_031 | PASS | PASS |
| ASSESS_075 | PASS | PASS |
| ASSESS_092 | PASS | PASS |
| ASSESS_066 | PASS | PASS |

conclusionPreview 샘플 (ASSESS_066):
```
고객 측에서는 트로포닌 상승과 흉통, 심전도 변화가 심근손상의 증거로 충분하다고 주장합니다.
보험사의 부지급 결정은 전체 의무기록과 지급요건 검토에 비추어 불충분하며...
```
— 깨진 문장 패턴 없음 확인.

## 4. 미해결

- GPT-4o 출력 자체에서 해당 템플릿 문장이 생성되지 않도록 프롬프트 레벨 가이드 추가 필요 (낮은 우선순위)
