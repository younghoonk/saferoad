const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(process.cwd(), 'rag_fss_latest');
const TARGETS_PATH = path.join(DATA_DIR, 'fss_latest_case_targets_v1.json');
const FULLTEXT_PATH = path.join(DATA_DIR, 'fss_latest_fulltext_import_v1.json');
const FULLTEXT_CSV_PATH = path.join(DATA_DIR, 'fss_latest_fulltext_import_v1.csv');
const TARGETS_CSV_PATH = path.join(DATA_DIR, 'fss_latest_case_targets_v1.csv');
const LOG_PATH = path.join(DATA_DIR, 'fetch_logs_v1.json');

const SECTION_PATTERNS = [
  ['facts', /(사실관계|민원\s*내용)/],
  ['claimant_position', /(신청인\s*주장|민원인\s*주장|계약자\s*주장)/],
  ['insurer_position', /(피신청인\s*주장|보험회사\s*주장|보험사\s*주장)/],
  ['committee_reasoning', /(위원회\s*판단|판단|관련\s*약관)/],
  ['conclusion', /(결론|조정결정|결정사항)/],
  ['issue', /(쟁점|분쟁\s*요지)/],
];

function readJson(filePath, fallback = []) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#40;/g, '(')
    .replace(/&#41;/g, ')')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseSections(rawText) {
  const sections = {
    facts: null,
    claimant_position: null,
    insurer_position: null,
    committee_reasoning: null,
    conclusion: null,
    issue: null,
  };
  const matches = [];

  for (const [field, pattern] of SECTION_PATTERNS) {
    const match = pattern.exec(rawText);
    if (match) matches.push({ field, index: match.index, heading: match[0] });
  }

  matches.sort((a, b) => a.index - b.index);
  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const next = matches[index + 1];
    const start = current.index + current.heading.length;
    const end = next ? next.index : rawText.length;
    const value = rawText.slice(start, end).trim();
    if (value) sections[current.field] = value;
  }

  return sections;
}

function hasUsefulFullText(target, rawText) {
  if (!rawText || rawText.length < 800) return false;
  if (target.title && !rawText.includes(target.title.slice(0, Math.min(target.title.length, 12)))) {
    return false;
  }
  return /(사실관계|신청인|피신청인|위원회|조정|결론|쟁점|보험금|약관)/.test(rawText);
}

function toFullTextRow(target, rawText) {
  const sections = parseSections(rawText);
  const collectedAt = new Date().toISOString();
  const keywords = [
    target.title,
    target.insurance_type,
    target.coverage_type,
    sections.issue,
  ].filter(Boolean);

  return {
    id: target.id,
    source_type: 'fss_latest_dispute_case',
    title: target.title,
    case_number: null,
    court_or_agency: '금융감독원',
    decision_date: null,
    insurance_type: target.insurance_type,
    coverage_type: target.coverage_type,
    issue: sections.issue,
    facts: sections.facts,
    claimant_position: sections.claimant_position,
    insurer_position: sections.insurer_position,
    committee_reasoning: sections.committee_reasoning,
    conclusion: sections.conclusion,
    result_type: null,
    keywords,
    rag_summary: sections.issue || null,
    source_url: target.source_url,
    source_status: 'official_fss_full_text',
    raw_text: rawText,
    collected_at: collectedAt,
  };
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

async function fetchTarget(target) {
  if (!target.source_url) {
    return { status: 'needs_manual_url', message: 'source_url is empty', fulltext: null };
  }

  const response = await fetch(target.source_url, {
    headers: {
      'user-agent': 'Mozilla/5.0 saferoad-rag-fulltext-check/1.0',
      accept: 'text/html,text/plain,*/*',
    },
  });

  if (!response.ok) {
    return { status: 'fetch_failed', message: `HTTP ${response.status}`, fulltext: null };
  }

  const contentType = response.headers.get('content-type') || '';
  if (!/text|html|xml|json/i.test(contentType)) {
    return { status: 'fetch_failed', message: `Unsupported content-type ${contentType}`, fulltext: null };
  }

  const html = await response.text();
  const rawText = htmlToText(html);
  if (!hasUsefulFullText(target, rawText)) {
    return { status: 'full_text_not_detected', message: 'Fetched page did not expose verifiable FSS full text for this target', fulltext: null };
  }

  return { status: 'full_text_extracted', message: 'Full text extracted from source_url', fulltext: toFullTextRow(target, rawText) };
}

async function main() {
  const targets = readJson(TARGETS_PATH);
  const existingFulltexts = readJson(FULLTEXT_PATH);
  const fulltextById = new Map(existingFulltexts.map((row) => [row.id, row]));
  const logs = readJson(LOG_PATH);

  for (const target of targets) {
    if (!target.source_url) {
      target.fetch_status = 'needs_manual_url';
      target.source_status = 'title_seed_needs_full_text';
      continue;
    }

    try {
      const result = await fetchTarget(target);
      target.fetch_status = result.status;
      target.fetched_at = new Date().toISOString();
      target.source_status = result.fulltext ? 'official_fss_full_text' : 'title_seed_needs_full_text';
      target.notes = result.message;
      logs.push({ target_id: target.id, source_url: target.source_url, status: result.status, message: result.message, fetched_at: target.fetched_at });
      if (result.fulltext) fulltextById.set(result.fulltext.id, result.fulltext);
    } catch (error) {
      target.fetch_status = 'fetch_failed';
      target.fetched_at = new Date().toISOString();
      target.source_status = 'title_seed_needs_full_text';
      target.notes = error.message;
      logs.push({ target_id: target.id, source_url: target.source_url, status: 'fetch_failed', message: error.message, fetched_at: target.fetched_at });
    }
  }

  const fulltexts = [...fulltextById.values()];
  fs.writeFileSync(TARGETS_PATH, `${JSON.stringify(targets, null, 2)}\n`, 'utf8');
  fs.writeFileSync(FULLTEXT_PATH, `${JSON.stringify(fulltexts, null, 2)}\n`, 'utf8');
  fs.writeFileSync(LOG_PATH, `${JSON.stringify(logs, null, 2)}\n`, 'utf8');

  writeCsv(TARGETS_CSV_PATH, targets, ['id', 'fss_category', 'insurance_type', 'coverage_type', 'title', 'source_url', 'source_status', 'fetch_status', 'fetched_at', 'notes']);
  writeCsv(FULLTEXT_CSV_PATH, fulltexts, ['id', 'source_type', 'title', 'case_number', 'court_or_agency', 'decision_date', 'insurance_type', 'coverage_type', 'issue', 'facts', 'claimant_position', 'insurer_position', 'committee_reasoning', 'conclusion', 'result_type', 'keywords', 'rag_summary', 'source_url', 'source_status', 'raw_text', 'collected_at']);

  console.log({
    targets: targets.length,
    source_url_count: targets.filter((row) => row.source_url).length,
    fulltext_count: fulltexts.length,
    needs_manual_or_failed: targets.filter((row) => row.fetch_status !== 'full_text_extracted').length,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
