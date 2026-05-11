#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const args = parseArgs(process.argv.slice(2));
const OUT_DIR = args.outDir || path.join(process.cwd(), "rag_legal_precedents");
const RAW_PATH = args.raw || path.join(OUT_DIR, "koicd_precedents_raw.jsonl");
const NORMALIZED_PATH = args.normalized || path.join(OUT_DIR, "koicd_precedents_normalized.jsonl");
const REPORT_PATH = args.report || path.join(OUT_DIR, "koicd_precedents_pruned_report.json");
const EXCLUDED_CASE_TYPES = parseCsv(args.excludeCaseTypes || args["exclude-case-types"] || "산재,일반행정");

const EXCLUDED_CONTENT_KEYWORDS = [
  "산업재해보상보험",
  "산재보험",
  "근로복지공단",
  "업무상 재해",
  "재해근로자",
  "장해보상연금",
  "휴업급여",
  "요양급여",
  "평균임금정정",
  "보험급여차액",
  "장기요양",
  "건강보험약제",
  "급여비용",
  "환수결정처분",
  "보험료부과처분취소",
  "국민건강보험공단",
  "건강보험심사평가원",
];

const TITLE_KEYWORDS = [
  "평균임금정정",
  "보험급여차액",
  "요양급여",
  "장기요양",
  "보험료부과처분취소",
  "건강보험약제",
  "급여비용",
  "환수결정처분",
];

const BOILERPLATE_CUT_MARKERS = [
  "목록 보험담보금 보기",
  "보험청구 질병분류코드 보기",
  "KOICD 검색서비스 재개 안내",
  "KOICD 서비스 점검안내",
  "이용약관 | 개인정보처리방침",
  "COMPANY. 질병분류정보센터",
  "오늘 하루 이창을 열지 않음",
];

const PRIVATE_INSURANCE_HINTS = [
  "보험금",
  "실손",
  "실비",
  "암진단비",
  "고지의무",
  "계약 전 알릴의무",
  "부지급",
  "면책",
  "상법 제651조",
];

main();

function main() {
  console.log(`[config] excludeCaseTypes=${EXCLUDED_CASE_TYPES.join(",") || "(none)"}`);
  console.log(`[config] contentKeywords=${EXCLUDED_CONTENT_KEYWORDS.join(",")}`);

  const raw = pruneFile(RAW_PATH, { normalized: false });
  const normalized = pruneFile(NORMALIZED_PATH, { normalized: true });
  const report = {
    finishedAt: new Date().toISOString(),
    excludeCaseTypes: EXCLUDED_CASE_TYPES,
    contentKeywords: EXCLUDED_CONTENT_KEYWORDS,
    boilerplateCutMarkers: BOILERPLATE_CUT_MARKERS,
    raw,
    normalized,
  };

  fs.writeFileSync(REPORT_PATH, `\uFEFF${JSON.stringify(report, null, 2)}`, "utf8");
  console.log("[done]", {
    raw: summarizeResult(raw),
    normalized: summarizeResult(normalized),
    report: REPORT_PATH,
  });
}

function pruneFile(file, options) {
  if (!fs.existsSync(file)) {
    console.log(`[skip] not found: ${file}`);
    return emptyResult(file);
  }

  const rows = readJsonl(file);
  const keptRows = [];
  const removedItems = [];
  const reasonCounts = {};
  let removedByCaseType = 0;
  let removedByTitleKeyword = 0;
  let removedByContentKeyword = 0;

  for (const originalRow of rows) {
    const row = cleanRow(originalRow, options);
    const reasons = removalReasons(row);
    const titleKeywordReasons = reasons.filter((reason) => reason.startsWith("title_keyword:"));
    const contentKeywordReasons = reasons.filter((reason) => reason.startsWith("content_keyword:"));
    const caseTypeReasons = reasons.filter((reason) => reason.startsWith("case_type:"));

    if (reasons.length > 0) {
      if (caseTypeReasons.length > 0) removedByCaseType++;
      if (titleKeywordReasons.length > 0) removedByTitleKeyword++;
      if (contentKeywordReasons.length > 0) removedByContentKeyword++;
      for (const reason of reasons) reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
      removedItems.push({
        prec_id: row.prec_id,
        source_url: row.source_url,
        case_title: row.case_title || row.title || row.case_name || "",
        case_type: row.case_type || "",
        reasons,
        privateInsuranceHints: matchedKeywords(inspectText(row), PRIVATE_INSURANCE_HINTS),
      });
    } else {
      keptRows.push(row);
    }
  }

  const backup = backupPath(file);
  fs.copyFileSync(file, backup);
  writeJsonl(file, keptRows);

  const result = {
    file,
    found: true,
    kept: keptRows.length,
    removed: removedItems.length,
    removedByCaseType,
    removedByTitleKeyword,
    removedByContentKeyword,
    reasonCounts,
    backup,
    removedItems,
  };

  console.log(`[prune] ${path.basename(file)} kept=${result.kept} removed=${result.removed} removedByCaseType=${removedByCaseType} removedByTitleKeyword=${removedByTitleKeyword} removedByContentKeyword=${removedByContentKeyword} backup=${backup}`);
  return result;
}

function cleanRow(row, options) {
  const cleaned = { ...row };
  cleaned.holdings = cleanKoicdBoilerplate(cleaned.holdings);
  cleaned.summary = cleanKoicdBoilerplate(cleaned.summary);
  cleaned.full_text = cleanKoicdBoilerplate(cleaned.full_text);

  if (options.normalized) {
    const searchableText = inspectText(cleaned);
    const diseaseCodes = Array.from(new Set([
      ...(Array.isArray(cleaned.disease_codes) ? cleaned.disease_codes : []),
      ...(searchableText.match(/\b[A-Z][0-9]{2}(?:\.[0-9A-Z]{1,3})?\b/g) || []),
    ]));
    const issueTags = detectIssueTags(searchableText);
    cleaned.disease_codes = diseaseCodes;
    cleaned.insurance_issue_tags = issueTags;
    cleaned.keywords = Array.from(new Set([...issueTags, ...diseaseCodes]));
  }

  return cleaned;
}

function removalReasons(row) {
  const reasons = [];
  const caseType = clean(row.case_type);
  if (caseType && EXCLUDED_CASE_TYPES.some((excluded) => caseType === excluded)) {
    reasons.push(`case_type:${caseType}`);
  }

  const title = clean(row.case_title || row.title || row.case_name || "");
  for (const keyword of matchedKeywords(title, TITLE_KEYWORDS)) {
    reasons.push(`title_keyword:${keyword}`);
  }

  const body = inspectText(row);
  for (const keyword of matchedKeywords(body, EXCLUDED_CONTENT_KEYWORDS)) {
    reasons.push(`content_keyword:${keyword}`);
  }

  return Array.from(new Set(reasons));
}

function inspectText(row) {
  return [
    row.case_title,
    row.holdings,
    row.summary,
    stringifyForSearch(row.statutes),
    stringifyForSearch(row.cited_precedents),
    row.full_text,
  ].filter(Boolean).join("\n");
}

function matchedKeywords(text, keywords) {
  const value = String(text || "");
  return keywords.filter((keyword) => value.includes(keyword));
}

function cleanKoicdBoilerplate(value) {
  if (value == null) return value;
  let text = String(value);
  for (const marker of BOILERPLATE_CUT_MARKERS) {
    const index = text.indexOf(marker);
    if (index >= 0) text = text.slice(0, index);
  }
  return text.replace(/\s+/g, " ").trim() || null;
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

function readJsonl(file) {
  return fs.readFileSync(file, "utf8")
    .replace(/^\uFEFF/, "")
    .split(/\n+/)
    .map((line) => line.trim().replace(/^\uFEFF/, ""))
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function writeJsonl(file, rows) {
  const body = rows.map((row) => JSON.stringify(row, null, 0)).join("\n");
  fs.writeFileSync(file, `\uFEFF${body}${body ? "\n" : ""}`, "utf8");
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => clean(item))
    .filter(Boolean);
}

function backupPath(file) {
  const base = `${file}.bak`;
  if (!fs.existsSync(base)) return base;

  let index = 1;
  while (fs.existsSync(`${base}.${index}`)) index++;
  return `${base}.${index}`;
}

function emptyResult(file) {
  return {
    file,
    found: false,
    kept: 0,
    removed: 0,
    removedByCaseType: 0,
    removedByTitleKeyword: 0,
    removedByContentKeyword: 0,
    reasonCounts: {},
    backup: null,
    removedItems: [],
  };
}

function summarizeResult(result) {
  return {
    file: result.file,
    found: result.found,
    kept: result.kept,
    removed: result.removed,
    removedByCaseType: result.removedByCaseType,
    removedByTitleKeyword: result.removedByTitleKeyword,
    removedByContentKeyword: result.removedByContentKeyword,
    reasonCounts: result.reasonCounts,
    backup: result.backup,
  };
}

function stringifyForSearch(value) {
  if (Array.isArray(value)) return value.join("\n");
  if (value && typeof value === "object") return JSON.stringify(value);
  return value || "";
}

function clean(value) {
  if (value == null) return "";
  return String(value).replace(/\s+/g, " ").trim();
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
