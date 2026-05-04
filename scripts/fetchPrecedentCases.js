const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.rag.local') });

const LAW_OPEN_API_OC = process.env.LAW_OPEN_API_OC;
const DATA_DIR = path.resolve(process.cwd(), 'rag_precedents');
const TARGETS_PATH = path.join(DATA_DIR, 'precedent_search_targets_v1.json');
const FULLTEXT_PATH = path.join(DATA_DIR, 'precedent_fulltext_import_v1.json');
const LOG_PATH = path.join(DATA_DIR, 'fetch_logs_v1.json');
const SEARCH_BASE_URL = 'https://www.law.go.kr/DRF/lawSearch.do';
const SERVICE_BASE_URL = 'https://www.law.go.kr/DRF/lawService.do';
const PER_TARGET_LIMIT = Number(process.env.PRECEDENT_FETCH_PER_TARGET_LIMIT || 5);
const TOTAL_LIMIT = Number(process.env.PRECEDENT_FETCH_TOTAL_LIMIT || 300);
const TARGET_LIMIT = Number(process.env.PRECEDENT_FETCH_LIMIT || 0);
const DELAY_MS = Number(process.env.PRECEDENT_FETCH_DELAY_MS || 250);
const SEARCH_SCOPE = process.env.PRECEDENT_SEARCH_SCOPE || '2';

if (!LAW_OPEN_API_OC) {
  console.error('Missing LAW_OPEN_API_OC in .env.rag.local');
  process.exit(1);
}

function maskOc(value) {
  if (!value) return '(missing)';
  return value.length <= 4 ? '****' : `${value.slice(0, 2)}****${value.slice(-2)}`;
}

function maskUrl(url) {
  return url.replace(/([?&]OC=)[^&]+/i, '$1****');
}

function readJson(filePath, fallback = []) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function compactText(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pick(obj, keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return obj[key];
  }
  return null;
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function findArraysDeep(value, pathKeyHints) {
  const arrays = [];
  function walk(node, keyPath) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      if (node.some((item) => item && typeof item === 'object')) arrays.push({ keyPath, value: node });
      for (const item of node) walk(item, keyPath);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      const nextPath = [...keyPath, key];
      if (Array.isArray(child) && pathKeyHints.some((hint) => key.toLowerCase().includes(hint))) {
        arrays.unshift({ keyPath: nextPath, value: child });
      } else {
        walk(child, nextPath);
      }
    }
  }
  walk(value, []);
  return arrays;
}

function parseJsonMaybe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseSearchJson(json) {
  const root = json?.PrecSearch || json?.precSearch || json?.LawSearch || json?.lawSearch || json;
  const direct = root?.prec || root?.Prec || root?.precedent || root?.판례;
  const candidates = direct ? asArray(direct) : [];
  const deep = candidates.length > 0 ? candidates : (findArraysDeep(root, ['prec', 'precedent', '판례'])[0]?.value || []);

  return asArray(deep).map((item) => ({
    precedent_id: String(pick(item, ['판례일련번호', 'precSeq', 'PREC_SEQ', 'ID', 'id', '판례ID']) || '').trim() || null,
    case_number: compactText(pick(item, ['사건번호', 'caseNo', 'CASE_NO'])),
    case_name: compactText(pick(item, ['사건명', '판례명', 'caseName', 'CASE_NAME', 'precName'])),
    court: compactText(pick(item, ['법원명', '선고법원', 'courtName', 'COURT_NAME'])),
    decision_date: compactText(pick(item, ['선고일자', 'decisionDate', 'JUDG_DATE', 'judgDate'])),
  })).filter((row) => row.precedent_id || row.case_number || row.case_name);
}

function firstTag(xml, tagNames) {
  for (const tagName of tagNames) {
    const match = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i').exec(xml);
    if (match) return compactText(match[1]);
  }
  return null;
}

function extractXmlBlocks(xml) {
  const blocks = [];
  for (const pattern of [/<prec[^>]*>[\s\S]*?<\/prec>/gi, /<판례[^>]*>[\s\S]*?<\/판례>/gi]) {
    const matches = xml.match(pattern);
    if (matches) blocks.push(...matches);
  }
  return blocks.length > 0 ? blocks : [xml];
}

function parseSearchXml(xml) {
  return extractXmlBlocks(xml).map((block) => ({
    precedent_id: firstTag(block, ['판례일련번호', 'ID', 'id']),
    case_number: firstTag(block, ['사건번호']),
    case_name: firstTag(block, ['사건명', '판례명']),
    court: firstTag(block, ['법원명', '선고법원']),
    decision_date: firstTag(block, ['선고일자']),
  })).filter((row) => row.precedent_id || row.case_number || row.case_name);
}

function parseSearchResults(text) {
  const json = parseJsonMaybe(text);
  return json ? parseSearchJson(json) : parseSearchXml(text);
}

function parseFullTextJson(json, target, listRow, sequence) {
  const root = json?.PrecService || json?.precService || json?.판례 || json?.prec || json;
  const precedentId = String(pick(root, ['판례일련번호', 'precSeq', 'PREC_SEQ', 'ID', 'id']) || listRow.precedent_id || '').trim() || null;
  const caseNumber = compactText(pick(root, ['사건번호', 'caseNo', 'CASE_NO']) || listRow.case_number);
  const caseName = compactText(pick(root, ['사건명', '판례명', 'caseName', 'CASE_NAME', 'precName']) || listRow.case_name);
  const court = compactText(pick(root, ['법원명', '선고법원', 'courtName', 'COURT_NAME']) || listRow.court);
  const decisionDate = compactText(pick(root, ['선고일자', 'decisionDate', 'JUDG_DATE', 'judgDate']) || listRow.decision_date);
  const holding = compactText(pick(root, ['판시사항', 'holding', 'mainIssue']));
  const reasoningSummary = compactText(pick(root, ['판결요지', 'reasoningSummary', 'summary']));
  const statutes = compactText(pick(root, ['참조조문', 'referencedStatutes']));
  const rawText = compactText(pick(root, ['판례내용', '판결내용', '내용', 'fullText', 'text']));

  return buildFullTextRow(target, sequence, {
    precedentId,
    caseNumber,
    caseName,
    court,
    decisionDate,
    holding,
    reasoningSummary,
    statutes,
    rawText,
  });
}

function parseFullTextXml(xml, target, listRow, sequence) {
  return buildFullTextRow(target, sequence, {
    precedentId: firstTag(xml, ['판례일련번호', 'ID', 'id']) || listRow.precedent_id,
    caseNumber: firstTag(xml, ['사건번호']) || listRow.case_number,
    caseName: firstTag(xml, ['사건명', '판례명']) || listRow.case_name,
    court: firstTag(xml, ['법원명', '선고법원']) || listRow.court,
    decisionDate: firstTag(xml, ['선고일자']) || listRow.decision_date,
    holding: firstTag(xml, ['판시사항']),
    reasoningSummary: firstTag(xml, ['판결요지']),
    statutes: firstTag(xml, ['참조조문']),
    rawText: firstTag(xml, ['판례내용', '판결내용', '내용']),
  });
}

function buildFullTextRow(target, sequence, fields) {
  const sourceStatus = fields.rawText ? 'official_law_api_full_text' : 'precedent_list_only';
  return {
    id: `PREC_API_${String(sequence).padStart(4, '0')}`,
    source_type: 'court_precedent_fulltext',
    precedent_id: fields.precedentId || null,
    case_number: fields.caseNumber || null,
    case_name: fields.caseName || null,
    court: fields.court || null,
    decision_date: fields.decisionDate || null,
    category: target.category,
    issue_type: target.sub_category,
    title: [fields.court, fields.decisionDate, fields.caseNumber, fields.caseName].filter(Boolean).join(' ') || fields.caseName || fields.caseNumber || fields.precedentId,
    holding: fields.holding || null,
    reasoning_summary: fields.reasoningSummary || null,
    referenced_statutes: fields.statutes ? fields.statutes.split(/\s*[,;]\s*/).filter(Boolean) : [],
    keywords: [...new Set([...(target.expected_source_keywords || []), ...(target.expected_issue_types || [])])],
    raw_text: fields.rawText || null,
    source_url: fields.precedentId ? `https://www.law.go.kr/LSW/precInfoP.do?precSeq=${encodeURIComponent(fields.precedentId)}` : null,
    source_status: sourceStatus,
    collected_at: new Date().toISOString(),
  };
}

function parseFullText(text, target, listRow, sequence) {
  const json = parseJsonMaybe(text);
  return json ? parseFullTextJson(json, target, listRow, sequence) : parseFullTextXml(text, target, listRow, sequence);
}

function csvEscape(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function writeCsv(filePath, rows, columns) {
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => {
      const value = row[column];
      return csvEscape(Array.isArray(value) ? value.join(';') : value);
    }).join(','));
  }
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTextWithDebug(url, label, debug) {
  if (debug) console.log(`[debug] ${label} url: ${maskUrl(url)}`);
  const response = await fetch(url, { headers: { accept: 'application/json,text/json,application/xml,text/xml,text/plain,*/*' } });
  const text = await response.text();
  if (debug) {
    console.log(`[debug] ${label} HTTP status: ${response.status}`);
    console.log(`[debug] ${label} response first 500 chars:\n${text.slice(0, 500)}`);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
  return text;
}

function buildSearchUrl(query) {
  const params = new URLSearchParams({
    OC: LAW_OPEN_API_OC,
    target: 'prec',
    type: 'JSON',
    search: SEARCH_SCOPE,
    query,
    display: String(PER_TARGET_LIMIT),
    page: '1',
  });
  return `${SEARCH_BASE_URL}?${params.toString()}`;
}

function buildServiceUrl(precedentId) {
  const params = new URLSearchParams({
    OC: LAW_OPEN_API_OC,
    target: 'prec',
    type: 'JSON',
    ID: precedentId,
  });
  return `${SERVICE_BASE_URL}?${params.toString()}`;
}

async function main() {
  const targets = readJson(TARGETS_PATH);
  const selectedTargets = TARGET_LIMIT > 0 ? targets.slice(0, TARGET_LIMIT) : targets;
  const logs = readJson(LOG_PATH);
  const existing = readJson(FULLTEXT_PATH);
  const byDedupeKey = new Map(existing.map((row) => [row.precedent_id || row.case_number || row.id, row]));
  let totalFetched = byDedupeKey.size;

  console.log(`[debug] LAW_OPEN_API_OC present: yes (${maskOc(LAW_OPEN_API_OC)})`);
  console.log(`[debug] precedent search scope: ${SEARCH_SCOPE} (1=case name, 2=body/full-text search)`);
  console.log(`[debug] target count: ${targets.length}, run target count: ${selectedTargets.length}`);
  if (selectedTargets[0]) console.log(`[debug] first query: ${selectedTargets[0].query}`);

  const zeroResultQueries = [];

  for (let targetIndex = 0; targetIndex < selectedTargets.length; targetIndex += 1) {
    const target = selectedTargets[targetIndex];
    const debug = targetIndex === 0;
    const searchUrl = buildSearchUrl(target.query);

    try {
      const searchText = await fetchTextWithDebug(searchUrl, 'search', debug);
      await sleep(DELAY_MS);
      const listRows = parseSearchResults(searchText).slice(0, PER_TARGET_LIMIT);
      if (debug) console.log(`[debug] parsed precedent list count: ${listRows.length}`);
      if (debug && listRows[0]) console.log(`[debug] first parsed precedent: ${JSON.stringify(listRows[0], null, 2)}`);
      if (listRows.length === 0) zeroResultQueries.push(target.query);

      let importedCount = 0;
      let fulltextCount = 0;
      let listOnlyCount = 0;
      let duplicateCount = 0;
      let totalLimitSkippedCount = 0;

      for (const listRow of listRows) {
        const dedupeKey = listRow.precedent_id || listRow.case_number;
        if (dedupeKey && byDedupeKey.has(dedupeKey)) {
          duplicateCount += 1;
          continue;
        }
        if (totalFetched >= TOTAL_LIMIT) {
          totalLimitSkippedCount += 1;
          continue;
        }

        let parsed;
        if (listRow.precedent_id) {
          try {
            const serviceText = await fetchTextWithDebug(buildServiceUrl(listRow.precedent_id), 'service', debug && importedCount === 0);
            await sleep(DELAY_MS);
            parsed = parseFullText(serviceText, target, listRow, totalFetched + 1);
          } catch (error) {
            parsed = buildFullTextRow(target, totalFetched + 1, {
              precedentId: listRow.precedent_id,
              caseNumber: listRow.case_number,
              caseName: listRow.case_name,
              court: listRow.court,
              decisionDate: listRow.decision_date,
              rawText: null,
            });
            parsed.source_status = 'precedent_list_only';
            logs.push({ target_id: target.id, query: target.query, status: 'full_text_failed', message: error.message, fetched_at: new Date().toISOString() });
          }
        } else {
          parsed = buildFullTextRow(target, totalFetched + 1, {
            caseNumber: listRow.case_number,
            caseName: listRow.case_name,
            court: listRow.court,
            decisionDate: listRow.decision_date,
            rawText: null,
          });
          parsed.source_status = 'precedent_list_only';
        }

        byDedupeKey.set(parsed.precedent_id || parsed.case_number || parsed.id, parsed);
        importedCount += 1;
        totalFetched += 1;
        if (parsed.source_status === 'official_law_api_full_text') fulltextCount += 1;
        if (parsed.source_status === 'precedent_list_only') listOnlyCount += 1;
      }

      target.fetched_count = listRows.length;
      target.imported_count = importedCount;
      target.fetch_status = listRows.length > 0 ? 'fetched' : 'no_results';
      target.source_status = listRows.length > 0 ? 'list_or_fulltext_checked' : 'target_only';
      const message = `results=${listRows.length} imported=${importedCount} fulltext=${fulltextCount} list_only=${listOnlyCount} duplicates=${duplicateCount} total_limit_skipped=${totalLimitSkippedCount}`;
      target.notes = message;
      console.log(`[${targetIndex + 1}/${selectedTargets.length}] ${target.query}: list=${listRows.length} fulltext=${fulltextCount} list_only=${listOnlyCount} imported=${importedCount} duplicates=${duplicateCount} skipped_by_total_limit=${totalLimitSkippedCount}`);
      logs.push({ target_id: target.id, query: target.query, status: target.fetch_status, message, fetched_at: new Date().toISOString() });
    } catch (error) {
      target.fetch_status = 'fetch_failed';
      target.source_status = 'target_only';
      target.notes = error.message;
      console.log(`[${targetIndex + 1}/${selectedTargets.length}] ${target.query}: fetch_failed ${error.message}`);
      logs.push({ target_id: target.id, query: target.query, status: 'fetch_failed', message: error.message, fetched_at: new Date().toISOString() });
      if (targetIndex === 0) console.log(`[debug] first query failed: ${error.message}`);
    }

    await sleep(DELAY_MS);
  }

  if (zeroResultQueries.length > 0) {
    console.log(`[debug] zero-result query count: ${zeroResultQueries.length}`);
    for (const query of zeroResultQueries.slice(0, 20)) console.log(`[debug] zero-result query: ${query}`);
  }

  const rows = [...byDedupeKey.values()];
  fs.writeFileSync(TARGETS_PATH, `${JSON.stringify(targets, null, 2)}\n`, 'utf8');
  fs.writeFileSync(FULLTEXT_PATH, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
  fs.writeFileSync(LOG_PATH, `${JSON.stringify(logs, null, 2)}\n`, 'utf8');
  writeCsv(path.join(DATA_DIR, 'precedent_search_targets_v1.csv'), targets, ['id', 'category', 'sub_category', 'query', 'search_scope', 'expected_issue_types', 'expected_source_keywords', 'fetch_status', 'source_status', 'fetched_count', 'imported_count', 'notes']);
  writeCsv(path.join(DATA_DIR, 'precedent_fulltext_import_v1.csv'), rows, ['id', 'source_type', 'precedent_id', 'case_number', 'case_name', 'court', 'decision_date', 'category', 'issue_type', 'title', 'holding', 'reasoning_summary', 'referenced_statutes', 'keywords', 'raw_text', 'source_url', 'source_status', 'collected_at']);
  console.log({
    targets: targets.length,
    processed_targets: selectedTargets.length,
    import_rows: rows.length,
    official_fulltext: rows.filter((row) => row.source_status === 'official_law_api_full_text').length,
    list_only: rows.filter((row) => row.source_status === 'precedent_list_only').length,
    failed_queries: selectedTargets.filter((row) => row.fetch_status === 'fetch_failed').length,
    zero_result_queries: selectedTargets.filter((row) => row.fetch_status === 'no_results').length,
    total_limit: TOTAL_LIMIT,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
