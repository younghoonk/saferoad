# Claude API 전환 범위 진단

작성일: 2026-05-23  
목적: GPT-4o → Claude API 전환 범위 및 작업량 파악. 수정 없음.  
전략: chat 모델만 Claude로 전환, 임베딩(text-embedding-3-small, 17만 건)은 OpenAI 유지.

---

## 1. chat 모델 호출 위치 (전환 대상)

### 1-1. `create-assessment-draft/index.ts`

| 위치 | 함수 | 호출 방식 | 파라미터 | 비고 |
|------|------|-----------|----------|------|
| line 4768 | `callOpenAI` | `(key, prompt, 0.2, 3, 5000)` | temp=0.2, retry=3, maxTokens=5000 | 사정서 draft (full RAG) |
| line 4778 | `callOpenAI` | `(key, prompt, 0.2, 3, 5000)` | temp=0.2, retry=3, maxTokens=5000 | draft 실패 시 no-RAG fallback |
| line 4823 | `callOpenAI` | `(key, prompt, 0, 3, 5000)` | temp=0, retry=3, maxTokens=5000 | review 단계 |

**callOpenAI 시그니처 (line 1124):**
```typescript
async function callOpenAI(apiKey: string, prompt: string, temperature: number, maxRetries = 3, maxTokens = 8000)
```
- 메시지 형식: `prompt`(string)을 내부에서 `[{ role: 'user', content: prompt }]`로 감쌈
- vision 없음 (text-only)
- retry 로직 내장 (429/5xx)
- 응답 파싱: `json.choices[0].message.content`

### 1-2. `create-closing-report/index.ts`

| 위치 | 함수 | 호출 방식 | 비고 |
|------|------|-----------|------|
| line 321 | `callOpenAI` | `(key, messages, 0.1)` | 업로드 자료 사실관계 구조화 — **Vision** |
| line 568 | `callOpenAI` | `(key, messages, 0.2)` | 보고서 초안 생성 (text) |
| line 570 | `callOpenAI` | `(key, messages, 0)` | 보고서 review (text) |

**callOpenAI 시그니처 (line 258):**
```typescript
async function callOpenAI(apiKey: string, messages: unknown[], temperature: number, maxTokens = 4096)
```
- 메시지 형식: `messages[]` 직접 전달
- **line 321: Vision 사용** — `image_url` 형식 (`detail: 'high'`)으로 이미지 전달
- 응답 파싱: `json.choices[0].message.content`

### 1-3. `analyze-document/index.ts`

| 위치 | 함수 | 호출 방식 | 비고 |
|------|------|-----------|------|
| line 383 | `callOpenAI` | `(key, messages, 4096)` | 문서 이미지 분석 — **Vision** |
| line 437 | `callOpenAI` | `(key, messages, 2048)` | 반박 공문 생성 (text) |

**callOpenAI 시그니처 (line 340):**
```typescript
async function callOpenAI(apiKey: string, messages: unknown[], maxTokens = 4096): Promise<string>
```
- temperature 하드코딩: `0.2`
- **Vision 사용** — `image_url` 형식 (`detail: 'high'`)으로 이미지 전달
- 응답 파싱: `json.choices[0].message.content`

---

## 2. 임베딩 호출 위치 (OpenAI 유지)

| 파일 | 함수 | 모델 | 비고 |
|------|------|------|------|
| `_shared/ragSearch.ts` line 855 | `createEmbedding()` | `text-embedding-3-small` | RAG 검색 쿼리 임베딩 (Edge Function 내부) |
| `rag-embed-backfill/index.ts` line 210 | `createEmbedding()` | `text-embedding-3-small` | 신규 청크 임베딩 (Edge Function) |
| `scripts/embedRagDatasetChunks.js` line 69 | `createEmbedding/Embeddings()` | `text-embedding-3-small` | 배치 임베딩 스크립트 |
| `scripts/track1_embed_pending.js` | 동일 패턴 | `text-embedding-3-small` | 임베딩 보정 스크립트 |

**핵심: chat ↔ embedding 분리 구조 확인**

```
_shared/ragSearch.ts
  ├─ createEmbedding()      ← OpenAI Embeddings API만 호출 (유지)
  └─ searchRagReferences()  ← chat 모델 호출 없음 (embedding 결과를 DB 검색에만 사용)

create-assessment-draft/index.ts
  ├─ callOpenAI()           ← chat 호출 (전환 대상)
  └─ getRagResult()         ← ragSearch.ts 위임 (embedding, 유지)
```

→ **완전 분리됨.** `callOpenAI` 함수만 교체하면 embedding 코드는 무관.

---

## 3. API 형식 차이 (OpenAI vs Anthropic)

### 3-1. 요청 형식

| 항목 | OpenAI | Anthropic |
|------|--------|-----------|
| endpoint | `https://api.openai.com/v1/chat/completions` | `https://api.anthropic.com/v1/messages` |
| 인증 헤더 | `Authorization: Bearer <key>` | `x-api-key: <key>` + `anthropic-version: 2023-06-01` |
| model 파라미터 | `model: 'gpt-4o'` | `model: 'claude-sonnet-4-6'` |
| 최대 출력 토큰 | `max_tokens: 5000` | `max_tokens: 5000` (동일) |
| temperature | `temperature: 0~2` | `temperature: 0~1` (현재 최대 0.2 — 범위 내) |
| system 메시지 | `messages: [{role:'system', content:'...'}]` | 최상위 `system: '...'` 파라미터로 분리 |

### 3-2. 응답 파싱

```typescript
// OpenAI (현재)
json.choices?.[0]?.message?.content

// Anthropic (변경 후)
json.content?.[0]?.text
```

### 3-3. Vision 이미지 형식

```typescript
// OpenAI (현재)
{
  type: 'image_url',
  image_url: {
    url: `data:${mimeType};base64,${base64}`,
    detail: 'high',
  }
}

// Anthropic (변경 후)
{
  type: 'image',
  source: {
    type: 'base64',
    media_type: mimeType,   // 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
    data: base64,            // prefix 제거 필요: base64.replace(/^data:[^;]+;base64,/, '')
  }
}
```

### 3-4. 에러 응답

```typescript
// OpenAI: res.status가 4xx/5xx이면 에러
// Anthropic: 동일하게 4xx/5xx HTTP status 사용
// 에러 body 형식만 다름 (error.message 구조)
```

---

## 4. 환경변수 변경

| 변수 | 용도 | 조치 |
|------|------|------|
| `OPENAI_API_KEY` | 임베딩 (유지), (기존 chat 호출 제거) | **유지** — embedding용 |
| `ANTHROPIC_API_KEY` | Claude chat 호출 | **신규 추가** — Supabase secrets에 등록 |

Supabase Edge Function 환경변수 추가:
```powershell
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref xnbmostitbwntazexpos
```

---

## 5. 함수별 전환 복잡도

| 함수 | Vision | chat 호출 수 | 복잡도 | 이유 |
|------|--------|-------------|--------|------|
| `create-assessment-draft` | ❌ | 3곳 (함수 1개) | **낮음** | text-only, callOpenAI 1개 함수 교체로 완료 |
| `create-closing-report` | ✅ (1곳) | 3곳 (함수 1개) | **중간** | Vision 메시지 형식 변환 필요 |
| `analyze-document` | ✅ (1곳) | 2곳 (함수 1개) | **중간** | Vision 메시지 형식 변환 필요 |

**SDK vs 직접 fetch:**  
Anthropic SDK (npm/Deno)를 사용하면 Vision 형식 변환 일부 추상화 가능.  
그러나 현재 OpenAI도 직접 fetch 사용 중 → **직접 fetch 유지가 일관성 있음** (Deno import map 변경 불필요).

---

## 6. 모델 추천

| 모델 | 특징 | 추천 여부 |
|------|------|---------|
| `claude-sonnet-4-6` | 사정서 품질 요건 충족, 비용 합리적, 128K 컨텍스트 | **✅ 추천** |
| `claude-opus-4-7` | 최고 품질, 3-5배 비쌈, Edge Function timeout 위험 | 생산 비추천 |
| `claude-haiku-4-5-20251001` | 빠름/저렴, 품질 미검증 | 비추천 |

`claude-sonnet-4-6`: 
- 출력 토큰: 최대 8,192 (기본) — 현재 max_tokens=5000 OK
- vision: 지원 ✅
- 한국어: 충분한 성능
- 비용: GPT-4o와 유사 수준

---

## 7. 전환 작업 단계

### Step 1 — `create-assessment-draft` (난이도: 낮음)

```typescript
// OPENAI_MODEL → CLAUDE_MODEL
const CLAUDE_MODEL = 'claude-sonnet-4-6';
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

async function callClaude(apiKey: string, prompt: string, temperature: number, maxRetries = 3, maxTokens = 8000) {
  // body: { model, max_tokens, temperature, messages: [{role:'user', content: prompt}] }
  // headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
  // 응답 파싱: json.content[0].text
}
```

변경 범위: `callOpenAI` 함수 본체 교체 + 환경변수명 변경 (`OPENAI_API_KEY` → `ANTHROPIC_API_KEY` for chat)

### Step 2 — `create-closing-report` (난이도: 중간)

- Vision 메시지 `image_url` → Anthropic `source.type=base64` 변환 필요
- `imageContent()` 함수의 content 배열 형식 수정

### Step 3 — `analyze-document` (난이도: 중간)

- `buildImageContent()` 함수의 content 배열 형식 수정
- `image_url.detail:'high'` 제거 (Anthropic에 해당 없음)

### Step 4 — Supabase secrets 등록 + 재배포

---

## 8. 위험 요소

| 위험 | 수준 | 대응 |
|------|------|------|
| Vision 형식 변환 오류 | 중간 | analyze-document/closing-report 실사용 테스트 필요 |
| 응답 파싱 누락 (`choices` → `content`) | 높음 | 교체 후 즉시 eval 확인 |
| temperature=0 거동 차이 | 낮음 | 현재 review에서 temp=0 사용, Claude에서도 동일하게 결정론적 |
| rate limit 차이 | 낮음 | Anthropic Sonnet: 충분한 RPM |
| 프롬프트 품질 — GPT-4o 튜닝된 프롬프트 | 중간 | 동일 프롬프트로 baseline 먼저 실행, 차이 확인 후 조정 |
| Edge Function timeout | 낮음 | Sonnet이 GPT-4o보다 느릴 수 있음, 모니터링 필요 |

---

## 9. 전환 대상 아닌 것 (명시)

- `_shared/ragSearch.ts` — embedding만, chat 없음. **변경 없음.**
- `rag-embed-backfill/index.ts` — embedding만. **변경 없음.**
- `scripts/embed*.js` — 배치 임베딩. **변경 없음.**
- `selfVerifySubmissionReport()` / `repairSubmissionReport()` — LLM 호출 없음, regex 기반. **변경 없음.**

---

## 10. 작업량 추정

| 작업 | 예상 시간 | 비고 |
|------|----------|------|
| `create-assessment-draft` callClaude 교체 | ~30분 | 함수 1개, text-only |
| `create-closing-report` callClaude + Vision 형식 | ~45분 | Vision 변환 포함 |
| `analyze-document` callClaude + Vision 형식 | ~30분 | Vision 변환 포함 |
| Supabase secrets 등록 + 3함수 재배포 | ~10분 | CLI 1줄 |
| eval baseline 재실행 (create-assessment-draft) | ~20분 | 100건 기준 |
| **총합** | **~2.5시간** | eval 시간 포함 |

**핵심:** `create-assessment-draft`만 먼저 전환 → eval로 품질 확인 → 이상 없으면 나머지 2개 전환하는 단계적 접근이 안전.
