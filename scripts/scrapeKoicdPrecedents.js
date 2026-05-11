#!/usr/bin/env node
/**
 * KOICD 보험분쟁 판례 수집 스크립트
 *
 * 주의:
 * - 운영 서비스에 사용하기 전 KOICD/권리자 사용 허락 범위를 확인하세요.
 * - 전체 수집은 KOICD_USAGE_CONFIRMED=true 환경변수가 있어야 실행됩니다.
 * - 기본적으로 rate limit을 둡니다.
 *
 * 사용 예:
 *   node scripts/scrapeKoicdPrecedents.js --max-pages 1
 *   KOICD_USAGE_CONFIRMED=true node scripts/scrapeKoicdPrecedents.js --max-pages 333 --delay-ms 800
 *   KOICD_USAGE_CONFIRMED=true node scripts/scrapeKoicdPrecedents.js --page-url-template "https://www.koicd.kr/brd/precedentList.do?pageIndex={page}"
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const iconv = require("iconv-lite");

const BASE_URL = "https://www.koicd.kr";
const LIST_URL = `${BASE_URL}/brd/precedentList.do`;

const args = parseArgs(process.argv.slice(2));

const OUT_DIR = args.outDir || path.join(process.cwd(), "rag_legal_precedents");
const RAW_PATH = args.raw || path.join(OUT_DIR, "koicd_precedents_raw.jsonl");
const NORMALIZED_PATH = args.normalized || path.join(OUT_DIR, "koicd_precedents_normalized.jsonl");
const REPORT_PATH = args.report || path.join(OUT_DIR, "koicd_precedents_report.json");

const MAX_PAGES = Number(args.maxPages || args["max-pages"] || 1);
const FROM_PAGE = Number(args.fromPage || args["from-page"] || 1);
const TO_PAGE = Number(args.toPage || args["to-page"] || MAX_PAGES);
const DRY_RUN = Boolean(args.dryRun || args["dry-run"]);
const DELAY_MS = Number(args.delayMs || args["delay-ms"] || 800);
const DETAIL_DELAY_MS = Number(args.detailDelayMs || args["detail-delay-ms"] || DELAY_MS);
const PAGE_URL_TEMPLATE = args.pageUrlTemplate || args["page-url-template"] || process.env.KOICD_PAGE_URL_TEMPLATE || "";
const EXCLUDED_CASE_TYPES = parseCaseTypes(args.excludeCaseTypes || args["exclude-case-types"] || "산재,일반행정");

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

if ((TO_PAGE - FROM_PAGE + 1) > 1 && process.env.KOICD_USAGE_CONFIRMED !== "true") {
  console.error("[safety] 전체/다중 페이지 수집 전 KOICD 사용권/약관 확인이 필요합니다.");
  console.error("[safety] 확인 후 환경변수 KOICD_USAGE_CONFIRMED=true 를 설정하세요.");
  console.error("[safety] 테스트는 --max-pages 1 로 먼저 실행하세요.");
  process.exit(2);
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});

async function main() {
  const startedAt = new Date().toISOString();
  const seenPrecIds = loadSeenPrecIds(NORMALIZED_PATH);

  const pageTemplate = PAGE_URL_TEMPLATE || await autoDetectPageTemplate();
  console.log("[config] pageTemplate =", pageTemplate || "(base-only)");
  console.log("[config] pages =", `${FROM_PAGE}-${TO_PAGE}`, "maxPages =", MAX_PAGES, "dryRun =", DRY_RUN);
  console.log("[config] excludeCaseTypes =", EXCLUDED_CASE_TYPES.join(",") || "(none)");

  let discovered = 0;
  let fetched = 0;
  let skipped = 0;
  let skippedExcluded = 0;
  let failed = 0;
  const failures = [];
  const listFailures = [];
  const emptyListPages = [];
  const excludedItems = [];

  for (let page = FROM_PAGE; page <= TO_PAGE; page++) {
    const pageUrl = makePageUrl(pageTemplate, page);
    console.log(`[list] page=${page} url=${pageUrl}`);

    const detailUrls = await fetchListDetailUrls(pageUrl, page, listFailures, emptyListPages);
    console.log(`[list] page=${page} detailLinks=${detailUrls.length}`);
    if (detailUrls.length === 0) {
      await sleep(DELAY_MS);
      continue;
    }

    for (const detailUrl of detailUrls) {
      const precId = extractPrecId(detailUrl);
      if (!precId) continue;
      discovered++;

      if (seenPrecIds.has(precId)) {
        skipped++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`[dry-run] would fetch precId=${precId} ${detailUrl}`);
        continue;
      }

      try {
        await sleep(DETAIL_DELAY_MS);
        const detailHtml = await fetchText(detailUrl);
        const raw = parseDetail(detailHtml, detailUrl, precId);
        const normalized = normalizePrecedent(raw);

        if (isExcludedCaseType(raw.case_type, EXCLUDED_CASE_TYPES) || isExcludedCaseType(normalized.case_type, EXCLUDED_CASE_TYPES)) {
          skippedExcluded++;
          seenPrecIds.add(precId);
          excludedItems.push({
            precId,
            case_title: normalized.case_title || raw.case_title,
            case_type: normalized.case_type || raw.case_type,
            source_url: detailUrl,
          });
          console.log(`[detail:excluded] skippedExcluded=${skippedExcluded} precId=${precId} caseType=${normalized.case_type || raw.case_type}`);
          continue;
        }

        appendJsonl(RAW_PATH, raw);
        appendJsonl(NORMALIZED_PATH, normalized);
        seenPrecIds.add(precId);
        fetched++;

        console.log(`[detail] fetched=${fetched} precId=${precId} title=${normalized.case_title.slice(0, 60)}`);
      } catch (err) {
        failed++;
        failures.push({ type: "detail", precId, url: detailUrl, error: String(err.message || err) });
        console.warn("[detail:failed]", precId, err.message || err);
      }
    }

    await sleep(DELAY_MS);
  }

  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    maxPages: MAX_PAGES,
    fromPage: FROM_PAGE,
    toPage: TO_PAGE,
    dryRun: DRY_RUN,
    pageTemplate,
    discovered,
    fetched,
    skipped,
    skippedExcluded,
    failed,
    failures,
    listFailures,
    emptyListPages,
    excludedItems,
    output: {
      raw: RAW_PATH,
      normalized: NORMALIZED_PATH,
      report: REPORT_PATH,
    },
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
  console.log("[done]", report);
}

async function autoDetectPageTemplate() {
  const candidates = [
    `${LIST_URL}?pageIndex={page}`,
    `${LIST_URL}?page={page}`,
    `${LIST_URL}?pageNo={page}`,
    `${LIST_URL}?currentPage={page}`,
    `${LIST_URL}?currentPageNo={page}`,
    `${LIST_URL}?curPage={page}`,
    `${LIST_URL}?pageNum={page}`,
    `${LIST_URL}?cPage={page}`,
  ];

  let firstIds = [];
  try {
    firstIds = extractDetailUrls(await fetchText(LIST_URL)).map(extractPrecId).filter(Boolean);
  } catch (_) {
    return LIST_URL;
  }

  for (const tmpl of candidates) {
    try {
      const page2Url = makePageUrl(tmpl, 2);
      const ids = extractDetailUrls(await fetchText(page2Url)).map(extractPrecId).filter(Boolean);
      if (ids.length > 0 && ids.join(",") !== firstIds.join(",")) {
        return tmpl;
      }
    } catch (_) {
      // ignore
    }
    await sleep(250);
  }

  console.warn("[warn] 페이지 템플릿 자동 감지 실패. --page-url-template 을 지정해야 전체 수집이 가능합니다.");
  return LIST_URL;
}

function makePageUrl(template, page) {
  if (!template || template === LIST_URL) return page === 1 ? LIST_URL : LIST_URL;
  return template.replace("{page}", String(page));
}

async function fetchText(url, retry = 2) {
  let lastErr;
  for (let i = 0; i <= retry; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "BosangPartner-RAG-Research/1.0 (+contact: internal)",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const charset = detectCharset(res.headers.get("content-type"), buffer);
      return iconv.decode(buffer, charset);
    } catch (err) {
      lastErr = err;
      await sleep(500 * (i + 1));
    }
  }
  throw lastErr;
}

function detectCharset(contentType, buffer) {
  const headerCharset = String(contentType || "").match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1];
  if (headerCharset) return normalizeCharset(headerCharset);

  const head = buffer.subarray(0, Math.min(buffer.length, 4096)).toString("latin1");
  const metaCharset = head.match(/<meta[^>]+charset\s*=\s*["']?([^"'\s/>;]+)/i)?.[1]
    || head.match(/<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([^"'\s;]+)/i)?.[1];
  if (metaCharset) return normalizeCharset(metaCharset);

  return "cp949";
}

function normalizeCharset(charset) {
  const value = String(charset || "").trim().toLowerCase().replace(/^["']|["']$/g, "");
  if (!value) return "cp949";
  if (value === "euc-kr" || value === "ks_c_5601-1987" || value === "x-windows-949") return "cp949";
  if (value === "utf8") return "utf-8";
  return value;
}

async function fetchListDetailUrls(pageUrl, page, listFailures, emptyListPages) {
  const maxAttempts = 3;
  let lastError = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const listHtml = await fetchText(pageUrl);
      const detailUrls = extractDetailUrls(listHtml);
      if (detailUrls.length > 0) {
        if (attempt > 1) console.log(`[list:retry:ok] page=${page} attempt=${attempt} detailLinks=${detailUrls.length}`);
        return detailUrls;
      }
      lastError = "detailLinks=0";
      console.warn(`[list:empty] page=${page} attempt=${attempt}/${maxAttempts}`);
    } catch (err) {
      lastError = String(err.message || err);
      listFailures.push({ type: "list", page, url: pageUrl, attempt, error: lastError });
      console.warn("[list:failed]", page, `attempt=${attempt}/${maxAttempts}`, lastError);
    }

    if (attempt < maxAttempts) await sleep(DELAY_MS);
  }

  emptyListPages.push({ page, url: pageUrl, attempts: maxAttempts, reason: lastError });
  return [];
}

function extractDetailUrls(html) {
  const byPrecId = new Map();
  const normalizedHtml = decodeHtmlEntities(String(html || "")).replace(/&amp;/gi, "&");
  const re = /(?:https?:\/\/[^"'<>\\\s)]*?)?(?:\/?brd\/)?precedentDetail\.do\?[^"'<>\\\s)]*?precId\s*=\s*(\d+)/gi;
  let m;
  while ((m = re.exec(normalizedHtml))) {
    const precId = m[1];
    if (!byPrecId.has(precId)) {
      byPrecId.set(precId, `${BASE_URL}/brd/precedentDetail.do?precId=${precId}`);
    }
  }
  return Array.from(byPrecId.values());
}

function extractPrecId(url) {
  const m = String(url).match(/precId=(\d+)/);
  return m ? m[1] : null;
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#034;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function parseDetail(html, sourceUrl, precId) {
  const text = htmlToText(html);
  const labels = [
    "사건명",
    "사건번호",
    "선고일자",
    "선고",
    "법원명",
    "사건종류",
    "판결유형",
    "판시사항",
    "판결요지",
    "참조조문",
    "참조판례",
    "판례내용",
  ];

  const raw = {
    prec_id: precId,
    source_url: sourceUrl,
    case_title: extractField(text, "사건명", labels),
    case_number: extractField(text, "사건번호", labels),
    decision_date_raw: extractField(text, "선고일자", labels),
    disposition: extractField(text, "선고", labels),
    court_name: extractField(text, "법원명", labels),
    case_type: extractField(text, "사건종류", labels),
    judgment_type: extractField(text, "판결유형", labels),
    holdings: extractField(text, "판시사항", labels),
    summary: extractField(text, "판결요지", labels),
    statutes: extractField(text, "참조조문", labels),
    cited_precedents: extractField(text, "참조판례", labels),
    full_text: extractField(text, "판례내용", labels),
    raw_text: text,
    fetched_at: new Date().toISOString(),
  };

  const koreanLabels = [
    "사건명",
    "사건번호",
    "선고일자",
    "선고",
    "법원명",
    "사건종류",
    "판결유형",
    "판시사항",
    "판결요지",
    "참조조문",
    "참조판례",
    "판례내용",
  ];

  if (!raw.case_title) raw.case_title = extractField(text, "사건명", koreanLabels);
  if (!raw.case_number) raw.case_number = extractField(text, "사건번호", koreanLabels);
  if (!raw.decision_date_raw) raw.decision_date_raw = extractField(text, "선고일자", koreanLabels);
  if (!raw.disposition) raw.disposition = extractField(text, "선고", koreanLabels);
  if (!raw.court_name) raw.court_name = extractField(text, "법원명", koreanLabels);
  if (!raw.case_type) raw.case_type = extractField(text, "사건종류", koreanLabels);
  if (!raw.judgment_type) raw.judgment_type = extractField(text, "판결유형", koreanLabels);
  if (!raw.holdings) raw.holdings = extractField(text, "판시사항", koreanLabels);
  if (!raw.summary) raw.summary = extractField(text, "판결요지", koreanLabels);
  if (!raw.statutes) raw.statutes = extractField(text, "참조조문", koreanLabels);
  if (!raw.cited_precedents) raw.cited_precedents = extractField(text, "참조판례", koreanLabels);
  if (!raw.full_text) raw.full_text = extractField(text, "판례내용", koreanLabels);

  if (!raw.case_title) {
    throw new Error(`failed to parse case_title precId=${precId}`);
  }

  return raw;
}

function normalizePrecedent(raw) {
  const cleanedRaw = {
    ...raw,
    holdings: cleanKoicdBoilerplate(raw.holdings),
    summary: cleanKoicdBoilerplate(raw.summary),
    full_text: cleanKoicdBoilerplate(raw.full_text),
  };

  const searchableText = [
    cleanedRaw.case_title,
    cleanedRaw.case_number,
    cleanedRaw.court_name,
    cleanedRaw.case_type,
    cleanedRaw.holdings,
    cleanedRaw.summary,
    cleanedRaw.statutes,
    cleanedRaw.cited_precedents,
    cleanedRaw.full_text,
  ].filter(Boolean).join("\n");

  const diseaseCodes = Array.from(new Set(searchableText.match(/\b[A-Z][0-9]{2}(?:\.[0-9A-Z]{1,3})?\b/g) || []));
  const issueTags = detectIssueTags(searchableText);
  const keywords = Array.from(new Set([...issueTags, ...diseaseCodes]));

  const normalized = {
    prec_id: String(cleanedRaw.prec_id),
    source_url: cleanedRaw.source_url,
    case_title: clean(cleanedRaw.case_title),
    case_number: clean(cleanedRaw.case_number),
    decision_date: normalizeDate(cleanedRaw.decision_date_raw),
    decision_date_raw: clean(cleanedRaw.decision_date_raw),
    disposition: clean(cleanedRaw.disposition),
    court_name: clean(cleanedRaw.court_name),
    case_type: clean(cleanedRaw.case_type),
    judgment_type: clean(cleanedRaw.judgment_type),
    holdings: clean(cleanedRaw.holdings),
    summary: clean(cleanedRaw.summary),
    statutes: clean(cleanedRaw.statutes),
    cited_precedents: clean(cleanedRaw.cited_precedents),
    full_text: clean(cleanedRaw.full_text),
    keywords,
    insurance_issue_tags: issueTags,
    disease_codes: diseaseCodes,
    source_area: "precedents",
    source_type: "court_precedent_fulltext",
    source_provider: "koicd",
    provider_prec_id: String(cleanedRaw.prec_id),
    trust_level: "legal_reference",
    citation_allowed: true,
    official_citation_allowed: false,
    review_status: "needs_human_review",
    fetched_at: raw.fetched_at,
    raw_payload: {
      source_url: cleanedRaw.source_url,
      prec_id: cleanedRaw.prec_id,
    },
  };

  normalized.content_hash = sha256(JSON.stringify({
    prec_id: normalized.prec_id,
    case_title: normalized.case_title,
    case_number: normalized.case_number,
    decision_date: normalized.decision_date,
    holdings: normalized.holdings,
    summary: normalized.summary,
    statutes: normalized.statutes,
    cited_precedents: normalized.cited_precedents,
    full_text: normalized.full_text,
  }));

  return normalized;
}

function detectIssueTags(text) {
  const rules = [
    ["고지의무", /(고지의무|계약\s*전\s*알릴\s*의무|알릴\s*의무|부실고지|불실고지|중요사항\s*고지|상법\s*제?\s*651\s*조|상법\s*651\s*조)/i],
    ["약관 설명의무", /(설명의무|명시.?설명의무|약관.*설명|중요한 내용|약관규제법)/i],
    ["면책", /(면책|보상하지 않|보험금 지급.*거절|지급거절|부지급|지급제한)/i],
    ["보험금", /(보험금|진단비|입원비|수술비|장해보험금|사망보험금)/i],
    ["실손보험", /(실손|실비|실손의료비|실손의료보험|도수치료|백내장|다초점|비급여)/i],
    ["암진단비", /(암진단비|암 보험금|제자리암|경계성종양|상피내암|악성신생물|C\d{2}|D0[0-9]|D37\.?5)/i],
    ["뇌혈관질환", /(뇌혈관|뇌출혈|뇌경색|I6[0-9]|I67|MRA|MRI|CTA)/i],
    ["급성심근경색", /(급성심근경색|심근경색|I21|트로포닌|troponin|CK-MB|관상동맥)/i],
    ["후유장해", /(후유장해|장해분류표|AMA|노동능력상실|장해율)/i],
    ["의료자문", /(의료자문|자문의|제3의료기관|감정|감정의)/i],
    ["기왕증/인과관계", /(기왕증|기왕력|인과관계|상해성|외래성|퇴행성|질병성)/i],
    ["보험자대위", /(보험자대위|상법 제682조|대위권|구상금)/i],
    ["자동차보험", /(자동차보험|자기차량손해|자차|자기부담금|교통사고|대물배상)/i],
    ["보험사기", /(보험사기|사기|허위청구|입원일수|과잉진료|의료법위반)/i],
  ];
  return filterIssueTags(text, rules.filter(([, re]) => re.test(text)).map(([tag]) => tag));
}

function filterIssueTags(text, tags) {
  const value = String(text || "");
  const autoOrSubrogation = /(자동차보험|자기차량손해|자차|자기부담금|교통사고|대물배상|보험자대위|상법\s*제?\s*682\s*조|대위권|구상금)/i.test(value);
  const strongIndemnity = /(실손|실손의료비|실손의료보험|도수치료|백내장|다초점)/i.test(value);
  if (autoOrSubrogation && !strongIndemnity) {
    return tags.filter((tag) => tag !== "실손보험");
  }
  return tags;
}

function extractField(text, label, allLabels) {
  const startRe = new RegExp(`(?:^|\\n)\\s*${escapeRegExp(label)}\\s+`, "m");
  const start = text.search(startRe);
  if (start < 0) return null;

  const afterStart = text.slice(start).replace(startRe, "");
  let end = afterStart.length;

  for (const next of allLabels) {
    if (next === label) continue;
    const re = new RegExp(`\\n\\s*${escapeRegExp(next)}\\s+`, "m");
    const idx = afterStart.search(re);
    if (idx >= 0 && idx < end) end = idx;
  }

  return clean(afterStart.slice(0, end));
}

function htmlToText(html) {
  return decodeHtmlEntities(html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(br|p|div|li|tr|h1|h2|h3|h4|td|th)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function clean(value) {
  if (value == null) return null;
  const s = String(value).replace(/\s+/g, " ").trim();
  return s.length ? s : null;
}

function cleanKoicdBoilerplate(value) {
  if (value == null) return value;
  const markers = [
    "목록 보험담보금 보기",
    "KOICD 검색서비스 재개 안내",
    "KOICD 서비스 점검안내",
    "이용약관 | 개인정보처리방침",
    "COMPANY. 질병분류정보센터",
    "오늘 하루 이창을 열지 않음",
  ];
  let text = String(value);
  for (const marker of markers) {
    const index = text.indexOf(marker);
    if (index >= 0) text = text.slice(0, index);
  }
  return text.replace(/\s+/g, " ").trim() || null;
}

function parseCaseTypes(value) {
  return String(value || "")
    .split(",")
    .map((item) => clean(item))
    .filter(Boolean);
}

function isExcludedCaseType(caseType, excludedCaseTypes) {
  const value = clean(caseType);
  if (!value) return false;
  return excludedCaseTypes.some((excluded) => value === excluded);
}

function normalizeDate(raw) {
  const s = String(raw || "").replace(/\D/g, "");
  if (s.length !== 8) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function sha256(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

function appendJsonl(file, obj) {
  const prefix = !fs.existsSync(file) || fs.statSync(file).size === 0 ? "\uFEFF" : "";
  fs.appendFileSync(file, prefix + JSON.stringify(obj, null, 0) + "\n", "utf8");
}

function loadSeenPrecIds(file) {
  const set = new Set();
  if (!fs.existsSync(file)) return set;
  const lines = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").split(/\n+/).filter(Boolean);
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      if (row.prec_id) set.add(String(row.prec_id));
    } catch (_) {}
  }
  return set;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
