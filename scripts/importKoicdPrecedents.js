#!/usr/bin/env node
/**
 * Import KOICD-collected court precedents into the existing precedent model.
 *
 * KOICD is treated as a source provider, not as a precedent type.
 */

require("dotenv").config({ path: ".env.rag.local" });
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const args = parseArgs(process.argv.slice(2));
const INPUT = args.input || path.join(process.cwd(), "rag_legal_precedents", "koicd_precedents_normalized.jsonl");
const DRY_RUN = Boolean(args.dryRun || args["dry-run"]);
const SKIP_RAG_MASTER = Boolean(args.skipRagMaster || args["skip-rag-master"]);
const BATCH_SIZE = Number(args.batchSize || args["batch-size"] || 50);
const CHUNK_SIZE = Number(args.chunkSize || args["chunk-size"] || 7000);
const LIMIT = Number(args.limit || 0);
const EXCLUDED_CASE_TYPES = parseCsv(args.excludeCaseTypes || args["exclude-case-types"] || "산재,일반행정");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[env] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY is required");
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});

async function main() {
  if (!fs.existsSync(INPUT)) {
    console.error("[input] not found:", INPUT);
    process.exit(2);
  }

  const allRows = readJsonl(INPUT);
  const excludedItems = allRows
    .filter((item) => isExcludedCaseType(item.case_type, EXCLUDED_CASE_TYPES))
    .map((item) => ({
      provider_prec_id: item.prec_id,
      case_title: item.case_title,
      case_type: item.case_type,
      source_url: item.source_url,
    }));
  const filteredRows = allRows.filter((item) => !isExcludedCaseType(item.case_type, EXCLUDED_CASE_TYPES));
  const sourceRows = LIMIT > 0 ? filteredRows.slice(0, LIMIT) : filteredRows;

  const candidateRows = sourceRows.map(normalizeInputRow);
  const localDuplicateReport = findLocalDuplicates(candidateRows);
  const uniqueCandidates = candidateRows.filter((row) => !localDuplicateReport.duplicateProviderPrecIds.has(row.provider_prec_id));

  const dbDuplicateReport = await findDbDuplicates(uniqueCandidates);
  const rowsToImport = uniqueCandidates.filter((row) => !dbDuplicateReport.duplicateRecordIds.has(row.record_id));
  const courtRows = rowsToImport.map(toCourtPrecedentRow);
  const masterRows = SKIP_RAG_MASTER ? [] : rowsToImport.flatMap(toRagMasterChunkRows);

  console.log(`[input] total=${allRows.length} filtered=${filteredRows.length} selected=${sourceRows.length} excluded=${excludedItems.length} limit=${LIMIT || "(none)"}`);
  console.log(`[dedupe:local] duplicateCandidates=${localDuplicateReport.items.length}`);
  console.log(`[dedupe:db] suspectedDuplicates=${dbDuplicateReport.items.length}`);
  console.log(`[plan] importPrecedents=${courtRows.length} newPrecedents=${rowsToImport.length} ragMasterChunks=${masterRows.length}`);
  console.log(`[config] dryRun=${DRY_RUN} skipRagMaster=${SKIP_RAG_MASTER}`);

  let importedPrecedents = 0;
  let importedMasterChunks = 0;
  let failed = 0;
  const failures = [];

  if (!DRY_RUN) {
    const courtResult = await upsertRows("court_precedents", courtRows, "record_id");
    importedPrecedents = courtResult.success;
    failed += courtResult.failed;
    failures.push(...courtResult.failures);

    if (!SKIP_RAG_MASTER && masterRows.length > 0) {
      const masterResult = await upsertRows("rag_master_chunks", masterRows, "chunk_id");
      importedMasterChunks = masterResult.success;
      failed += masterResult.failed;
      failures.push(...masterResult.failures);
    }
  }

  const report = {
    input: INPUT,
    dryRun: DRY_RUN,
    skipRagMaster: SKIP_RAG_MASTER,
    limit: LIMIT || null,
    sourceProvider: "koicd",
    sourceArea: "precedents",
    sourceType: "court_precedent_fulltext",
    excludeCaseTypes: EXCLUDED_CASE_TYPES,
    sourcePrecedents: allRows.length,
    filteredPrecedents: filteredRows.length,
    selectedPrecedents: sourceRows.length,
    skippedExcluded: excludedItems.length,
    excludedItems,
    localDuplicateCandidates: localDuplicateReport.items.length,
    dbDuplicateCandidates: dbDuplicateReport.items.length,
    importTargetPrecedents: courtRows.length,
    newPrecedents: rowsToImport.length,
    ragMasterChunksToCreate: masterRows.length,
    plannedMasterChunkSourceAreas: countBy(masterRows, (row) => row.source_area),
    plannedMasterChunkSourceTypes: countBy(masterRows, (row) => row.source_type),
    plannedMasterChunkSourceProviders: countBy(masterRows, (row) => row.metadata?.source_provider || "(none)"),
    importedPrecedents,
    importedMasterChunks,
    failed,
    localDuplicateItems: localDuplicateReport.items,
    dbDuplicateItems: dbDuplicateReport.items,
    failures,
    finishedAt: new Date().toISOString(),
  };

  const reportPath = path.join(path.dirname(INPUT), "koicd_precedents_import_report.json");
  fs.writeFileSync(reportPath, `\uFEFF${JSON.stringify(report, null, 2)}`, "utf8");
  console.log("[done]", summarizeReport(report));
}

function normalizeInputRow(row) {
  const contentHash = row.content_hash || sha256(JSON.stringify({
    case_title: clean(row.case_title),
    case_number: clean(row.case_number),
    court_name: clean(row.court_name),
    decision_date: clean(row.decision_date),
    holdings: clean(row.holdings),
    summary: clean(row.summary),
    statutes: clean(row.statutes),
    cited_precedents: clean(row.cited_precedents),
    full_text: clean(row.full_text),
  }));

  const naturalKey = precedentNaturalKey(row, contentHash);
  return {
    ...row,
    provider_prec_id: String(row.prec_id),
    source_provider: "koicd",
    source_area: "precedents",
    source_type: "court_precedent_fulltext",
    content_hash: contentHash,
    record_id: naturalKey,
  };
}

function precedentNaturalKey(row, contentHash) {
  const caseNumber = clean(row.case_number);
  if (caseNumber) return `precedent:case_number:${normalizeKey(caseNumber)}`;

  const court = clean(row.court_name);
  const date = clean(row.decision_date);
  const title = clean(row.case_title);
  if (court && date && title) {
    return `precedent:court_date_title:${sha256(`${court}|${date}|${title}`).slice(0, 24)}`;
  }

  return `precedent:content_hash:${contentHash}`;
}

function toCourtPrecedentRow(p) {
  const fullText = [
    p.holdings ? `판시사항\n${p.holdings}` : "",
    p.summary ? `판결요지\n${p.summary}` : "",
    p.statutes ? `참조조문\n${p.statutes}` : "",
    p.cited_precedents ? `참조판례\n${p.cited_precedents}` : "",
    p.full_text ? `판례내용\n${p.full_text}` : "",
  ].filter(Boolean).join("\n\n");

  return {
    record_id: p.record_id,
    source_type: "court_precedent_fulltext",
    title: p.case_title || p.case_number || p.record_id,
    case_number: p.case_number || null,
    court_or_agency: p.court_name || null,
    decision_date: sanitizeDate(p.decision_date),
    precedent_categories: Array.isArray(p.insurance_issue_tags) ? p.insurance_issue_tags.join(",") : null,
    insurance_type: null,
    accident_type: null,
    issue: p.holdings || p.summary || null,
    summary: p.summary || p.holdings || null,
    key_points: p.holdings || p.summary || null,
    outcome: p.disposition || null,
    conclusion: p.summary || p.holdings || null,
    keywords: arrayToText(p.keywords),
    source_url: p.source_url,
    source_reference: p.case_number || p.record_id,
    source_status: "koicd_collected_needs_review",
    full_text_excerpt: fullText || p.full_text || p.summary || p.holdings || null,
    metadata: {
      source_area: "precedents",
      source_type: "court_precedent_fulltext",
      source_provider: "koicd",
      provider_prec_id: p.provider_prec_id,
      source_url: p.source_url,
      case_number: p.case_number || null,
      court_name: p.court_name || null,
      decision_date: p.decision_date || null,
      case_type: p.case_type || null,
      judgment_type: p.judgment_type || null,
      insurance_issue_tags: p.insurance_issue_tags || [],
      disease_codes: p.disease_codes || [],
      citation_allowed: true,
      official_citation_allowed: false,
      review_status: "needs_human_review",
      content_hash: p.content_hash,
      raw_payload: p.raw_payload || {},
    },
  };
}

function toRagMasterChunkRows(p) {
  const referenceLabel = buildReferenceLabel(p);
  const body = [
    `출처 제공자: KOICD`,
    `판례: ${referenceLabel}`,
    `사건명: ${p.case_title || ""}`,
    `검토상태: 원 판례 출처/이용권 확인 전 공식근거 직접 인용 보류`,
    "",
    p.holdings ? `판시사항\n${p.holdings}` : "",
    p.summary ? `판결요지\n${p.summary}` : "",
    p.statutes ? `참조조문\n${p.statutes}` : "",
    p.cited_precedents ? `참조판례\n${p.cited_precedents}` : "",
    p.full_text ? `판례내용\n${p.full_text}` : "",
  ].filter(Boolean).join("\n\n");

  return splitText(body, CHUNK_SIZE).map((chunkText, index) => {
    const chunkNo = index + 1;
    return {
      chunk_id: `precedent:${p.record_id}:part:${chunkNo}`,
      source_area: "precedents",
      source_type: "court_precedent_fulltext",
      source_document_id: p.record_id,
      source_record_id: p.record_id,
      source_reference: p.case_number || p.record_id,
      title: chunkNo > 1 ? `${p.case_title || p.record_id} part ${chunkNo}` : (p.case_title || p.record_id),
      chunk_text: chunkText,
      summary: p.summary || p.holdings || null,
      keywords: arrayToText(p.keywords),
      source_url: p.source_url,
      page_no: null,
      chunk_no: chunkNo,
      effective_from: sanitizeDate(p.decision_date),
      effective_to: null,
      trust_level: "legal_reference",
      review_status: "needs_human_review",
      embedding_status: "pending",
      content_hash: sha256(["legal_precedent", p.record_id, chunkNo, chunkText].join("|")),
      duplicate_group_key: p.case_number
        ? `case_number:${normalizeKey(p.case_number)}`
        : `record_id:${p.record_id}`,
      metadata: {
        source_area: "precedents",
        source_type: "court_precedent_fulltext",
        source_provider: "koicd",
        provider_prec_id: p.provider_prec_id,
        case_number: p.case_number || null,
        court_name: p.court_name || null,
        decision_date: p.decision_date || null,
        case_title: p.case_title || null,
        case_type: p.case_type || null,
        judgment_type: p.judgment_type || null,
        insurance_issue_tags: p.insurance_issue_tags || [],
        disease_codes: p.disease_codes || [],
        citation_allowed: true,
        official_citation_allowed: false,
        review_status: "needs_human_review",
        content_hash: p.content_hash,
      },
    };
  });
}

async function findDbDuplicates(rows) {
  const items = [];
  const duplicateRecordIds = new Set();

  const recordIds = rows.map((row) => row.record_id).filter(Boolean);
  for (const batch of chunkArray(recordIds, BATCH_SIZE)) {
    const { data, error } = await supabase
      .from("court_precedents")
      .select("record_id,case_number,title,court_or_agency,decision_date,metadata")
      .in("record_id", batch);
    if (error) throw new Error(`court_precedents record_id duplicate check failed: ${error.message}`);
    for (const existing of data || []) {
      duplicateRecordIds.add(existing.record_id);
      items.push({
        reason: "record_id",
        record_id: existing.record_id,
        existing,
      });
    }
  }

  const caseNumbers = Array.from(new Set(rows.map((row) => clean(row.case_number)).filter(Boolean)));
  for (const batch of chunkArray(caseNumbers, BATCH_SIZE)) {
    const { data, error } = await supabase
      .from("court_precedents")
      .select("record_id,case_number,title,court_or_agency,decision_date,metadata")
      .in("case_number", batch);
    if (error) throw new Error(`court_precedents case_number duplicate check failed: ${error.message}`);
    for (const existing of data || []) {
      const matchingRows = rows.filter((row) => clean(row.case_number) === clean(existing.case_number));
      for (const row of matchingRows) {
        duplicateRecordIds.add(row.record_id);
        items.push({
          reason: "case_number",
          record_id: row.record_id,
          provider_prec_id: row.provider_prec_id,
          case_number: row.case_number,
          existing,
        });
      }
    }
  }

  const contentHashes = Array.from(new Set(rows.map((row) => row.content_hash).filter(Boolean)));
  for (const batch of chunkArray(contentHashes, BATCH_SIZE)) {
    const { data, error } = await supabase
      .from("court_precedents")
      .select("record_id,case_number,title,court_or_agency,decision_date,metadata")
      .in("metadata->>content_hash", batch);
    if (error) {
      console.warn(`[warn] metadata content_hash duplicate check skipped: ${error.message}`);
      break;
    }
    for (const existing of data || []) {
      const hash = existing.metadata?.content_hash;
      const matchingRows = rows.filter((row) => row.content_hash === hash);
      for (const row of matchingRows) {
        duplicateRecordIds.add(row.record_id);
        items.push({
          reason: "content_hash",
          record_id: row.record_id,
          provider_prec_id: row.provider_prec_id,
          content_hash: row.content_hash,
          existing,
        });
      }
    }
  }

  return { duplicateRecordIds, items };
}

function findLocalDuplicates(rows) {
  const duplicateProviderPrecIds = new Set();
  const items = [];
  const seen = new Map();

  for (const row of rows) {
    const keys = [
      clean(row.case_number) ? `case_number:${normalizeKey(row.case_number)}` : "",
      clean(row.court_name) && clean(row.decision_date) && clean(row.case_title)
        ? `court_date_title:${clean(row.court_name)}|${clean(row.decision_date)}|${clean(row.case_title)}`
        : "",
      `content_hash:${row.content_hash}`,
    ].filter(Boolean);

    const duplicateKey = keys.find((key) => seen.has(key));
    if (duplicateKey) {
      duplicateProviderPrecIds.add(row.provider_prec_id);
      items.push({
        reason: duplicateKey.split(":")[0],
        key: duplicateKey,
        record_id: row.record_id,
        provider_prec_id: row.provider_prec_id,
        first_record_id: seen.get(duplicateKey).record_id,
        first_provider_prec_id: seen.get(duplicateKey).provider_prec_id,
      });
      continue;
    }

    for (const key of keys) seen.set(key, row);
  }

  return { duplicateProviderPrecIds, items };
}

async function upsertRows(table, rows, onConflict) {
  let success = 0;
  let failed = 0;
  const failures = [];

  for (const batch of chunkArray(rows, BATCH_SIZE)) {
    const { error } = await supabase.from(table).upsert(batch, { onConflict });
    if (error) {
      failed += batch.length;
      failures.push({ table, onConflict, error: error.message, sample: batch[0]?.record_id || batch[0]?.chunk_id });
      console.warn(`[upsert:failed] ${table}: ${error.message}`);
    } else {
      success += batch.length;
    }
  }

  console.log(`[import] ${table}: success=${success} failed=${failed}`);
  return { success, failed, failures };
}

function buildReferenceLabel(p) {
  const court = p.court_name || "법원";
  const date = p.decision_date ? p.decision_date.replaceAll("-", ".") : (p.decision_date_raw || "");
  const number = p.case_number || p.provider_prec_id;
  const type = p.judgment_type || "판결";
  return `${court} ${date} 선고 ${number} ${type}`.replace(/\s+/g, " ").trim();
}

function splitText(text, maxLength) {
  const value = String(text || "").trim();
  if (!value) return [];
  if (value.length <= maxLength) return [value];

  const chunks = [];
  for (let start = 0; start < value.length; start += maxLength) {
    chunks.push(value.slice(start, start + maxLength).trim());
    if (chunks.length >= 4) break;
  }
  return chunks.filter(Boolean);
}

function readJsonl(file) {
  return fs.readFileSync(file, "utf8")
    .replace(/^\uFEFF/, "")
    .split(/\n+/)
    .map((line) => line.trim().replace(/^\uFEFF/, ""))
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function parseCsv(value) {
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

function sanitizeDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return null;
}

function arrayToText(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(",");
  return value || null;
}

function normalizeKey(value) {
  return clean(value).replace(/\s+/g, "").toLowerCase();
}

function clean(value) {
  if (value == null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function countBy(rows, selector) {
  const counts = {};
  for (const row of rows) {
    const key = selector(row);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function sha256(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

function summarizeReport(report) {
  return {
    sourcePrecedents: report.sourcePrecedents,
    filteredPrecedents: report.filteredPrecedents,
    selectedPrecedents: report.selectedPrecedents,
    skippedExcluded: report.skippedExcluded,
    localDuplicateCandidates: report.localDuplicateCandidates,
    dbDuplicateCandidates: report.dbDuplicateCandidates,
    importTargetPrecedents: report.importTargetPrecedents,
    newPrecedents: report.newPrecedents,
    ragMasterChunksToCreate: report.ragMasterChunksToCreate,
    plannedMasterChunkSourceAreas: report.plannedMasterChunkSourceAreas,
    plannedMasterChunkSourceTypes: report.plannedMasterChunkSourceTypes,
    plannedMasterChunkSourceProviders: report.plannedMasterChunkSourceProviders,
    dryRun: report.dryRun,
    failed: report.failed,
  };
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
