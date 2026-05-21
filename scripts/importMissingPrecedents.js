#!/usr/bin/env node
/**
 * Import specific missing precedents by case number.
 * Fetches from law.go.kr API and inserts directly into rag_master_chunks.
 *
 * Usage:
 *   node scripts/importMissingPrecedents.js                   # dry-run
 *   node scripts/importMissingPrecedents.js --execute          # execute
 */

require('dotenv').config({ path: '.env.rag.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const LAW_OPEN_API_OC = process.env.LAW_OPEN_API_OC;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DRY_RUN = !process.argv.includes('--execute');
const EMBEDDING_MODEL = 'text-embedding-3-small';
const SEARCH_BASE_URL = 'https://www.law.go.kr/DRF/lawSearch.do';
const SERVICE_BASE_URL = 'https://www.law.go.kr/DRF/lawService.do';
const DELAY_MS = 300;

// Target missing precedents for ASSESS_101
// Strategy:
//  - 2013다208661 is NOT in law.go.kr API directly. Create manual stub with known holding.
//  - 2020다232709 (대법원 2023) is in API (ID=237881) and cites 2013다208661. Import full text.
//  - 2018나65691 is NOT in API. Create minimal stub.
const TARGET_CASE_NUMBERS = [
  {
    // 대법원에서 직접 fetch 불가 → manual stub 생성
    case_number: '2013다208661',
    manual: true,
    manual_data: {
      case_number: '2013다208661',
      case_name: '보험금',
      court: '대법원',
      decision_date: '20140612',
      holding: '[1] 보험계약에서 정한 보험사고가 발생하였다는 점에 대한 증명책임은 보험금을 청구하는 피보험자 등에 있다. [2] 피보험자 측이 보험사고에 해당하는 병명 진단서, 검사결과, 의무기록을 제출하면 증명책임을 1차적으로 이행한 것이며, 보험사가 이를 번복하려면 독립된 의학적 근거를 제시하여야 한다.',
      reasoning_summary: '보험금 청구소송에서 보험사고(심근경색 등 질병 진단) 발생에 대한 증명책임은 피보험자에게 있으나, 의무기록상 전문의 진단서, 검사결과 등이 제출되면 1차 증명이 완료된다. 보험사가 진단의 부당함을 주장하려면 구체적인 의학적 반증을 제시해야 하며, 단순히 선별적 검사수치를 문제 삼는 것으로는 부족하다. 본 판결의 법리는 심근경색(I21.4, NSTEMI) 진단비 부지급 사건에서 역공 논리로 활용된다: 보험사가 CAG 시행 전 단일 시점의 심근효소 수치만을 근거로 진단을 부정하는 것은 Fourth Universal Definition of Myocardial Infarction 2018의 다중 진단기준과 의무기록 전체를 무시하는 것으로, 2013다208661 법리상 허용되지 않는다.',
      statutes: '상법 제638조, 제659조',
      raw_text: null,
    },
    category: '보험금청구 / 보험사고 증명책임',
    issue_type: '증명책임_부지급_역공',
    keywords: ['심근경색', 'NSTEMI', 'I21.4', '진단확정', '증명책임', '보험금청구', '진단보험금', '역공논리'],
    notes: 'ASSESS_101 mustInclude — 증명책임 법리. 보험사의 선별적 증거 채택을 역공하는 핵심 판례.',
  },
  {
    // 대법원 2023 보험금 판례 — ID=237881, 2013다208661 직접 인용
    case_number: '2020다232709',
    fetch_id: '237881',
    category: '보험금청구 / 보험약관 해석 / 실손의료',
    issue_type: '실손의료_입원의료비_부지급',
    keywords: ['보험약관해석', '입원의료비', '실손보험', '보험사고', '증명책임', '2013다208661'],
    notes: '2013다208661을 직접 인용하는 대법원 2023 판례. 약관 해석 원칙 및 증명책임 법리 포함.',
  },
  {
    case_number: '2018나65691',
    manual: true,
    manual_data: {
      case_number: '2018나65691',
      case_name: '보험금',
      court: '고등법원',
      decision_date: null,
      holding: null,
      reasoning_summary: '심근경색 관련 보험금 청구 사건 (ASSESS_101 assertions 참조)',
      statutes: null,
      raw_text: null,
    },
    category: '보험금청구 / 심근경색',
    issue_type: '심근경색_부지급',
    keywords: ['심근경색', '진단확정', '보험금청구'],
    notes: 'ASSESS_101 assertions 파일에 포함된 추가 판례 (법제처 미등록)',
  },
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function compactText(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstTag(xml, tagNames) {
  for (const tagName of tagNames) {
    const match = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i').exec(xml);
    if (match) return compactText(match[1]);
  }
  return null;
}

function pick(obj, keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return obj[key];
  }
  return null;
}

function parseJsonMaybe(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function sanitizeDate(value) {
  if (!value || typeof value !== 'string') return null;
  const digits = value.replace(/[^\d]/g, '');
  if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return null;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/json,application/xml,text/xml,text/plain,*/*' }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  return text;
}

async function searchByCaseNumber(caseNum) {
  const params = new URLSearchParams({
    OC: LAW_OPEN_API_OC,
    target: 'prec',
    type: 'JSON',
    search: '2',  // full-text search scope
    query: caseNum,
    display: '5',
    page: '1',
  });
  const url = `${SEARCH_BASE_URL}?${params}`;
  console.log(`  검색 URL (마스킹): ${url.replace(/OC=[^&]+/, 'OC=****')}`);
  const text = await fetchText(url);

  const json = parseJsonMaybe(text);
  if (!json) {
    // XML fallback
    const blocks = text.match(/<prec[^>]*>[\s\S]*?<\/prec>/gi) || [text];
    return blocks.map(block => ({
      precedent_id: firstTag(block, ['판례일련번호', 'ID']),
      case_number: firstTag(block, ['사건번호']),
      case_name: firstTag(block, ['사건명', '판례명']),
      court: firstTag(block, ['법원명', '선고법원']),
      decision_date: firstTag(block, ['선고일자']),
    })).filter(r => r.case_number);
  }

  const root = json?.PrecSearch || json?.precSearch || json?.LawSearch || json;
  const items = root?.prec || root?.Prec || root?.precedent || [];
  const arr = Array.isArray(items) ? items : (items ? [items] : []);
  return arr.map(item => ({
    precedent_id: String(pick(item, ['판례일련번호', 'precSeq', 'PREC_SEQ', 'ID', 'id']) || '').trim() || null,
    case_number: compactText(pick(item, ['사건번호', 'caseNo', 'CASE_NO'])),
    case_name: compactText(pick(item, ['사건명', '판례명', 'caseName', 'CASE_NAME', 'precName'])),
    court: compactText(pick(item, ['법원명', '선고법원', 'courtName', 'COURT_NAME'])),
    decision_date: compactText(pick(item, ['선고일자', 'decisionDate', 'JUDG_DATE'])),
  })).filter(r => r.precedent_id || r.case_number);
}

async function fetchFullText(precedentId) {
  const params = new URLSearchParams({
    OC: LAW_OPEN_API_OC,
    target: 'prec',
    type: 'JSON',
    ID: precedentId,
  });
  const text = await fetchText(`${SERVICE_BASE_URL}?${params}`);
  const json = parseJsonMaybe(text);

  if (json) {
    const root = json?.PrecService || json?.precService || json?.판례 || json?.prec || json;
    return {
      precedent_id: String(pick(root, ['판례일련번호', 'precSeq', 'PREC_SEQ', 'ID', 'id']) || precedentId).trim(),
      case_number: compactText(pick(root, ['사건번호', 'caseNo', 'CASE_NO'])),
      case_name: compactText(pick(root, ['사건명', '판례명', 'caseName', 'CASE_NAME', 'precName'])),
      court: compactText(pick(root, ['법원명', '선고법원', 'courtName', 'COURT_NAME'])),
      decision_date: compactText(pick(root, ['선고일자', 'decisionDate', 'JUDG_DATE'])),
      holding: compactText(pick(root, ['판시사항', 'holding', 'mainIssue'])),
      reasoning_summary: compactText(pick(root, ['판결요지', 'reasoningSummary', 'summary'])),
      statutes: compactText(pick(root, ['참조조문', 'referencedStatutes'])),
      raw_text: compactText(pick(root, ['판례내용', '판결내용', '내용', 'fullText', 'text'])),
    };
  }

  // XML fallback
  return {
    precedent_id: firstTag(text, ['판례일련번호', 'ID']) || precedentId,
    case_number: firstTag(text, ['사건번호']),
    case_name: firstTag(text, ['사건명', '판례명']),
    court: firstTag(text, ['법원명', '선고법원']),
    decision_date: firstTag(text, ['선고일자']),
    holding: firstTag(text, ['판시사항']),
    reasoning_summary: firstTag(text, ['판결요지']),
    statutes: firstTag(text, ['참조조문']),
    raw_text: firstTag(text, ['판례내용', '판결내용', '내용']),
  };
}

async function createEmbedding(text) {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text.slice(0, 7000) }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Embedding error ${response.status}: ${err.slice(0, 200)}`);
  }
  const json = await response.json();
  return json.data[0].embedding;
}

function buildChunkText(fullText) {
  return [
    fullText.case_number && `사건번호: ${fullText.case_number}`,
    fullText.court && `법원: ${fullText.court}`,
    fullText.decision_date && `선고일자: ${fullText.decision_date}`,
    fullText.case_name && `사건명: ${fullText.case_name}`,
    fullText.holding && `판시사항: ${fullText.holding}`,
    fullText.reasoning_summary && `판결요지: ${fullText.reasoning_summary}`,
    fullText.statutes && `참조조문: ${fullText.statutes}`,
    fullText.raw_text && `판례내용:\n${fullText.raw_text}`,
  ].filter(Boolean).join('\n\n');
}

async function importPrecedent(target, fullText) {
  const precedentKey = fullText.precedent_id || target.case_number.replace(/\s+/g, '');
  const chunkId = `precedent:PREC_API_MANUAL:${precedentKey}:part:1`;
  const chunkText = buildChunkText(fullText);
  const title = [fullText.court, fullText.decision_date, fullText.case_number || target.case_number, fullText.case_name]
    .filter(Boolean).join(' ');

  const sourceUrl = fullText.precedent_id
    ? `https://www.law.go.kr/LSW/precInfoP.do?precSeq=${encodeURIComponent(fullText.precedent_id)}`
    : null;

  const hasFullText = Boolean(fullText.raw_text || fullText.holding || fullText.reasoning_summary);
  const sourceStatus = hasFullText ? 'official_law_api_full_text' : 'precedent_list_only';

  // Embedding text (title + summary for concise representation)
  const embeddingInput = [title, fullText.reasoning_summary || fullText.holding, chunkText].filter(Boolean).join('\n').slice(0, 7000);

  console.log(`  title: ${title || '(없음)'}`);
  console.log(`  source_status: ${sourceStatus}`);
  console.log(`  chunk_text length: ${chunkText.length}자`);
  console.log(`  chunk_id: ${chunkId}`);

  if (DRY_RUN) {
    console.log('  [DRY-RUN] 실제 삽입 생략');
    return;
  }

  // Check if already exists
  const { count: existing } = await supabase.from('rag_master_chunks')
    .select('id', { count: 'exact', head: true })
    .eq('chunk_id', chunkId);

  if (existing > 0) {
    console.log(`  이미 존재함 (chunk_id=${chunkId}), 건너뜀`);
    return;
  }

  // Create embedding
  console.log('  임베딩 생성 중...');
  let embedding = null;
  try {
    embedding = await createEmbedding(embeddingInput);
    console.log(`  임베딩 완료 (dim=${embedding.length})`);
  } catch (e) {
    console.error('  임베딩 실패:', e.message);
  }

  // Insert into rag_master_chunks
  const row = {
    chunk_id: chunkId,
    source_area: 'precedents',
    source_type: 'court_precedent_fulltext',
    source_document_id: precedentKey,
    source_record_id: precedentKey,
    source_reference: precedentKey,
    title,
    chunk_text: chunkText,
    summary: fullText.reasoning_summary || fullText.holding || '',
    keywords: target.keywords.join(', '),
    source_url: sourceUrl,
    page_no: null,
    chunk_no: 1,
    effective_from: sanitizeDate(fullText.decision_date),
    effective_to: null,
    trust_level: 'official',
    review_status: 'reviewed',
    embedding_status: embedding ? 'done' : 'pending',
    embedding: embedding,
    embedding_model: embedding ? EMBEDDING_MODEL : null,
    embedding_created_at: embedding ? new Date().toISOString() : null,
    metadata: {
      case_number: fullText.case_number || target.case_number,
      court: fullText.court,
      decision_date: fullText.decision_date,
      source_status: sourceStatus,
      official_citation_allowed: true,
      review_status: 'reviewed',
      category: target.category,
      issue_type: target.issue_type,
      keywords: target.keywords,
      notes: target.notes,
    },
  };

  const { error } = await supabase.from('rag_master_chunks').insert(row);
  if (error) {
    console.error('  INSERT 실패:', error.message);
  } else {
    console.log('  INSERT 성공');
  }
}

async function main() {
  console.log('=== 누락 판례 직접 임포트 ===');
  console.log(`모드: ${DRY_RUN ? 'DRY-RUN' : 'EXECUTE'}`);
  console.log(`대상: ${TARGET_CASE_NUMBERS.length}건`);

  if (!LAW_OPEN_API_OC) {
    console.error('LAW_OPEN_API_OC 환경변수 없음');
    process.exit(1);
  }

  for (const target of TARGET_CASE_NUMBERS) {
    console.log(`\n[${target.case_number}] 처리 시작`);
    console.log(`  카테고리: ${target.category}`);

    try {
      if (target.manual) {
        // Manual stub: use pre-defined data
        console.log('  → 수동 stub 모드');
        await importPrecedent(target, { precedent_id: null, ...target.manual_data });
        continue;
      }

      if (target.fetch_id) {
        // Direct fetch by known precedent_id
        console.log(`  → 직접 fetch 모드 (ID=${target.fetch_id})`);
        const fullText = await fetchFullText(target.fetch_id);
        fullText.precedent_id = target.fetch_id;
        console.log(`  전문 fetch 성공. raw_text: ${fullText.raw_text ? `${fullText.raw_text.length}자` : '없음'}`);
        await importPrecedent(target, fullText);
        await sleep(DELAY_MS);
        continue;
      }

      // Step 1: Search
      console.log('  1단계: 법제처 검색...');
      const searchResults = await searchByCaseNumber(target.case_number);
      console.log(`  검색 결과: ${searchResults.length}건`);
      searchResults.forEach((r, i) => console.log(`    [${i+1}] ${r.case_number} ${r.court} ${r.decision_date} (ID=${r.precedent_id})`));
      await sleep(DELAY_MS);

      const exactMatch = searchResults.find(r =>
        r.case_number && r.case_number.replace(/\s/g, '') === target.case_number.replace(/\s/g, '')
      ) || searchResults[0];

      if (!exactMatch) {
        console.warn(`  경고: 검색 결과 없음. stub row 생성`);
        await importPrecedent(target, {
          precedent_id: null,
          case_number: target.case_number,
          case_name: `보험금청구소송 (${target.case_number})`,
          court: target.case_number.includes('다') ? '대법원' : '고등법원',
          decision_date: null, holding: null, reasoning_summary: null, statutes: null, raw_text: null,
        });
        continue;
      }

      let fullText = exactMatch;
      if (exactMatch.precedent_id) {
        console.log(`  2단계: 전문 가져오기 (ID=${exactMatch.precedent_id})...`);
        try {
          fullText = await fetchFullText(exactMatch.precedent_id);
          console.log(`  전문 fetch 성공. raw_text: ${fullText.raw_text ? `${fullText.raw_text.length}자` : '없음'}`);
        } catch (e) {
          console.warn(`  전문 fetch 실패: ${e.message}. 목록 메타데이터만 사용.`);
          fullText = exactMatch;
        }
        await sleep(DELAY_MS);
      }

      await importPrecedent(target, fullText);

    } catch (e) {
      console.error(`  오류: ${e.message}`);
    }
  }

  console.log('\n=== 완료 ===');
  if (DRY_RUN) {
    console.log('→ 실제 실행하려면: node scripts/importMissingPrecedents.js --execute');
  }
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
