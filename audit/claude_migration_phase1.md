# Claude API 전환 Phase 1: create-assessment-draft

작성일: 2026-05-23  
커밋: d5adfad  
대상: `supabase/functions/create-assessment-draft/index.ts`  
범위: chat 모델(GPT-4o → claude-sonnet-4-6)만 전환. 임베딩(text-embedding-3-small) OpenAI 유지.

---

## 1. 변경 내용

### 1-1. 상수 교체 (line 301~303)

```typescript
// Before
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = 'gpt-4o';

// After
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_VERSION = '2023-06-01';
```

### 1-2. callOpenAI → callClaude (line 1125~)

| 항목 | Before (OpenAI) | After (Claude) |
|------|-----------------|----------------|
| 엔드포인트 | `api.openai.com/v1/chat/completions` | `api.anthropic.com/v1/messages` |
| 인증 헤더 | `Authorization: Bearer <key>` | `x-api-key: <key>` + `anthropic-version: 2023-06-01` |
| 요청 body | `{model, messages, max_tokens, temperature}` | `{model, max_tokens, temperature, messages}` |
| 응답 파싱 | `json.choices[0].message.content` | `json.content[0].text` |
| usage 로그 | `prompt_tokens / completion_tokens` | `input_tokens / output_tokens` |
| stop 로그 | `finish_reason` | `stop_reason` |

### 1-3. API 키 분리 (line 4745~4746)

```typescript
// Before — apiKey 하나로 embedding + chat 모두 사용
const apiKey = requiredEnv('OPENAI_API_KEY');
getRagResult(apiKey, input);      // embedding
callOpenAI(apiKey, prompt, ...);  // chat

// After — 역할별로 분리
const openAiKey = requiredEnv('OPENAI_API_KEY');      // embedding 전용
const claudeApiKey = requiredEnv('ANTHROPIC_API_KEY'); // chat 전용
getRagResult(openAiKey, input);         // embedding → OpenAI 유지
callClaude(claudeApiKey, prompt, ...);  // chat → Claude
```

### 1-4. callClaude 호출 3곳

| 위치 | 역할 | temperature | maxTokens |
|------|------|------------|-----------|
| line 4771 | Draft (full RAG) | 0.2 | 5000 |
| line 4781 | Draft fallback (no RAG) | 0.2 | 5000 |
| line 4826 | Review | 0.0 | 5000 |

### 1-5. 미변경 항목

- `createEmbedding()` in `ragSearch.ts` — OpenAI Embeddings API 그대로
- `OPENAI_API_KEY` Supabase secret — 임베딩용으로 유지
- retry/error 처리 로직 — 동일 (429/5xx retry, HttpError 502 throw)
- `parseJsonResponse()` — 응답 구조 무관, JSON 추출 로직 그대로
- `selfVerifySubmissionReport()` / `repairSubmissionReport()` — LLM 호출 없음

---

## 2. 배포 전제 조건

```powershell
# ANTHROPIC_API_KEY Supabase secrets 등록 (사용자 직접)
npx.cmd supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref xnbmostitbwntazexpos

# 배포
npx.cmd supabase functions deploy create-assessment-draft --project-ref xnbmostitbwntazexpos
```

---

## 3. 검증 결과 (배포 후 채울 것)

### 3-1. API 연동 성공 여부

| 케이스 | API 응답 | 오류 여부 | 비고 |
|--------|---------|---------|------|
| ASSESS_035 (DCIS 암) | ? | ? | ? |
| ASSESS_051 (뇌경색) | ? | ? | ? |
| ASSESS_101 (심장 NSTEMI) | ? | ? | ? |

### 3-2. 7단 구조 유지 여부

| 케이스 | Ⅰ~Ⅶ 섹션 | 판정 |
|--------|---------|------|
| ASSESS_035 | ? | ? |
| ASSESS_051 | ? | ? |
| ASSESS_101 | ? | ? |

### 3-3. cardiac/암 혼입 여부

| 케이스 | cardiac 키워드 | 암 키워드 오혼입 | 판정 |
|--------|-------------|--------------|------|
| ASSESS_035 (암) | ? | — | ? |
| ASSESS_051 (뇌) | ? | — | ? |
| ASSESS_101 (심장) | 정상 있어야 함 | ? | ? |

### 3-4. GPT-4o vs Claude 품질 비교

| 항목 | GPT-4o | Claude sonnet-4-6 | 비고 |
|------|--------|-------------------|------|
| 보험사 주장 직접 인용 | | | |
| 반박 구체성 | | | |
| 한국어 자연스러움 | | | |
| 7단 구조 완성도 | | | |
| selfVerify repair 루프 발생 | | | |
| 출력 토큰 수 | | | |

### 3-5. 재튜닝 필요 항목

| 항목 | 상태 | 조치 |
|------|------|------|
| selfVerify — Claude 출력 검증 정상 작동 여부 | 미확인 | 배포 후 확인 |
| cleanPublicText — Claude 특유 출력 패턴 처리 여부 | 미확인 | 배포 후 확인 |
| buildDraftPrompt — 프롬프트 재튜닝 필요 여부 | 미확인 | eval 후 판단 |
| max_tokens 5000 충분한지 | 미확인 | output_tokens 로그 확인 |

---

## 4. 예상 동작 변화

- **프롬프트 지시 준수:** Claude Sonnet이 JSON 형식 지시를 더 엄격히 따르는 경향 → `parseJsonResponse` 실패율 감소 예상
- **한국어 자연스러움:** GPT-4o와 동급 이상으로 예상
- **temperature=0 결정론성:** Claude도 temperature=0에서 결정론적 → review 단계 동일
- **7단 구조:** 프롬프트에 명시적 지시 있어 구조 유지 예상

---

## 5. 관련 커밋/파일

| 항목 | 참조 |
|------|------|
| 전환 범위 진단 | `audit/claude_migration_scope.md` (13b5a92) |
| Phase 1 코드 변경 | `d5adfad` |
| Phase 2 (closing-report) | 미진행 |
| Phase 3 (analyze-document) | 미진행 |
