# Phase 2-C Task 1: ASSESS_097 FORBIDDEN_PHRASE 수정

## 문제 요약
- **케이스**: ASSESS_097 (의료자문/소송 전 분쟁해결)
- **위반 패턴**: `/재검토\s*필요/g`
- **위반 문구**: "객관적 재검토 필요성" (section heading)
- **eval 실패 유형**: `FORBIDDEN_PHRASE_FAIL`
- **이전 상태**: eval 1건 FAIL로 98.8% PASS율 저해

## 근본 원인
`enforceSubmissionReportContract()`의 금지 패턴이 `재검토가\s*필요`만 잡았고,  
`재검토 필요` (가/를/은/는 없는 변형)는 슬립스루.

eval 스크립트는 `/재검토\s*필요/g` (넓은 패턴) 체크 → 실패.  
`weakLanguageAbsent` 정규식도 `재검토가 필요`만 커버.

## 수정 내용

### 1. `enforceSubmissionReportContract()` — 사전 치환 규칙 추가 (line 1532~)
단순 삭제 대신 의미있는 어휘로 치환:
- `재검토\s*필요성` → `이의 근거`
- `재검토\s*(?:가|를|은|는)?\s*필요합니다` → `재심사해야 합니다`
- `재검토\s*(?:가|를|은|는)?\s*필요하다` → `재심사해야 한다`
- `재검토\s*(?:가|를|은|는)?\s*필요` → `재심사 의무 있음`

### 2. `prohibitedPatterns` 배열 갱신
`/재검토가\s*필요(?:합니다|하다)?/g` →  
`/재검토\s*(?:가|를|은|는)?\s*필요(?:합니다|하다)?/g`

추가\s*검토 패턴도 동일하게 넓힘.

### 3. `selfVerifySubmissionReport()` — `weakLanguageAbsent` 정규식 갱신
`재검토가 필요` →  
`재검토\s*(?:가|를|은|는)?\s*필요`

## 검증
- `npx.cmd tsc --noEmit` 통과 (타입 오류 없음)
- 치환 순서: 사전 치환 → prohibitedPatterns 루프 → 기존 assertive 치환 체인
- `"객관적 재검토 필요성"` → `"객관적 이의 근거"` (문장 구조 보존)

## 배포 후 확인 사항
- `npm run ai:assessment:eval -- --case ASSESS_097` 재실행
- status: PASS 확인
- weakLanguageAbsent: true 확인
