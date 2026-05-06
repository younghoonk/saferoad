const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.resolve(process.cwd(), '.env.rag.local') });

const CASES_PATH = path.resolve(process.cwd(), 'ai_eval', 'assessment_cases_100_v1.json');
const RESULTS_DIR = path.resolve(process.cwd(), 'ai_eval', 'results');
const JSON_RESULT_PATH = path.join(RESULTS_DIR, 'assessment_eval_latest.json');
const MD_RESULT_PATH = path.join(RESULTS_DIR, 'assessment_eval_latest.md');

const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'TEST_ADJUSTER_EMAIL', 'TEST_ADJUSTER_PASSWORD'];
const INTERNAL_ID_PATTERN = /\b(?:RQ|RSF|RCP|RCD|MIC|PIP|RKA|PST|FSS|PREC|PREC_API|FSS_LATEST)[-_]?\d{3,6}\b/i;
const INTERNAL_FIELD_PATTERN = /\b(?:chunk_id|source_id|record_id|source_record_id|source_document_id|embedding_status|review_status|trust_level)\b/i;
const INTERNAL_SOURCE_PATTERN = /\binternal_[A-Za-z0-9_:-]*\b/i;
const RAW_URL_PATTERN = /https?:\/\/[^\s)\]}>"']+/i;
const DEFINITIVE_PATTERNS = [
  '반드시 받을 수',
  '보험금 지급 확정',
  '무조건 위법',
  '승소 가능성',
];

function parseArgs(argv) {
  const args = { dryRun: false, caseId: '', limit: 0, category: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === '--dry-run') args.dryRun = true;
    else if (item === '--case') args.caseId = argv[++i] || '';
    else if (item === '--limit') args.limit = Number(argv[++i] || 0);
    else if (item === '--category') args.category = argv[++i] || '';
    else if (item.startsWith('--case=')) args.caseId = item.slice('--case='.length);
    else if (item.startsWith('--limit=')) args.limit = Number(item.slice('--limit='.length));
    else if (item.startsWith('--category=')) args.category = item.slice('--category='.length);
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function asArray(value) {
  return Array.isArray(value) ? value.filter((item) => item !== undefined && item !== null && String(item).trim()) : [];
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function includesText(haystack, needle) {
  const target = normalizeText(needle);
  if (!target) return true;
  return normalizeText(haystack).includes(target);
}

function isAdditionalCheckKeyword(keyword) {
  return /추가|확인|異붽|뺤씤/.test(normalizeText(keyword));
}

function preview(value, max = 80) {
  const text = normalizeText(value);
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function validateCaseShape(testCase) {
  const errors = [];
  if (!testCase || typeof testCase !== 'object') errors.push('case is not an object');
  if (!testCase.id) errors.push('missing id');
  if (!testCase.category) errors.push('missing category');
  if (!testCase.input || typeof testCase.input !== 'object') errors.push('missing input object');
  for (const key of ['mustInclude', 'mustNotInclude', 'expectedReferenceLabels', 'anyOfReferenceLabels', 'forbiddenReferenceKeywords', 'requiredSections']) {
    if (testCase[key] !== undefined && !Array.isArray(testCase[key])) errors.push(`${key} must be an array`);
  }
  return errors;
}

function selectCases(cases, args) {
  let selected = cases;
  if (args.caseId) selected = selected.filter((item) => item.id === args.caseId);
  if (args.category) selected = selected.filter((item) => item.category === args.category);
  if (args.limit > 0) selected = selected.slice(0, args.limit);
  return selected;
}

function buildPayload(testCase) {
  const input = testCase.input || {};
  const requestId = `eval-${testCase.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    requestId,
    caseTitle: input.caseTitle || testCase.title || testCase.id,
    insurerName: input.insurerName || '',
    insuranceType: input.insuranceType || '',
    contractDate: input.contractDate || 'unknown',
    accidentType: input.accidentType || testCase.category || '기타',
    accidentDate: input.accidentDate || 'unknown',
    diagnosisText: input.diagnosisText || input.diagnosisName || input.diagnosisCode || '',
    diagnosisName: input.diagnosisName || '',
    diagnosisCode: input.diagnosisCode || '',
    damageDetails: input.damageDetails || input.damageDescription || '',
    insurerPosition: input.insurerPosition || '',
    customerStatement: input.customerStatement || '',
    adjusterMemo: input.adjusterMemo || '',
    tone: input.tone || 'professional',
    retrievedReferences: [],
  };
}

function referenceText(references) {
  const groups = [
    ...(references?.officialReferences || []),
    ...(references?.internalReviewMaterials || []),
    ...(references?.auxiliaryReferences || []),
    ...(references?.excludedReferences || []),
    ...(references?.followUpChecks || []),
  ];
  return groups.map((ref) => [
    ref.sourceDisplayName,
    ref.source_area_label,
    ref.source_area,
    ref.title,
    ref.summary,
    ref.case_number,
    ref.court_or_agency,
    ref.decision_date,
    ref.law_name,
    ref.article_title,
  ].filter(Boolean).join(' ')).join('\n');
}

function draftText(result) {
  if (!result) return '';
  return [
    result.title,
    result.overview,
    result.facts,
    result.issues,
    result.legalAndReferenceBasis,
    result.damageAssessment,
    result.insurerPositionReview,
    result.adjusterOpinionDraft,
    result.requiredAdditionalChecks,
    result.simpleClientSummary,
    result.disclaimer,
  ].filter(Boolean).join('\n\n');
}

function resultText(result) {
  if (!result) return '';
  return [
    draftText(result),
    referenceText(result.retrievedReferences),
  ].filter(Boolean).join('\n\n');
}

function findLocation(result, keyword, includeReferences = true) {
  const fields = [
    ['title', result?.title],
    ['overview', result?.overview],
    ['facts', result?.facts],
    ['issues', result?.issues],
    ['legalAndReferenceBasis', result?.legalAndReferenceBasis],
    ['damageAssessment', result?.damageAssessment],
    ['insurerPositionReview', result?.insurerPositionReview],
    ['adjusterOpinionDraft', result?.adjusterOpinionDraft],
    ['requiredAdditionalChecks', result?.requiredAdditionalChecks],
    ['simpleClientSummary', result?.simpleClientSummary],
    ['disclaimer', result?.disclaimer],
  ];
  if (includeReferences) fields.push(['displayedReferences', referenceText(result?.retrievedReferences)]);
  const target = normalizeText(keyword);
  for (const [field, value] of fields) {
    const text = normalizeText(value);
    const index = text.indexOf(target);
    if (index >= 0) {
      return {
        field,
        preview: text.slice(Math.max(0, index - 60), index + target.length + 60),
      };
    }
  }
  return null;
}

function findPatternLocation(result, pattern, includeReferences = false) {
  const fields = [
    ['title', result?.title],
    ['overview', result?.overview],
    ['facts', result?.facts],
    ['issues', result?.issues],
    ['legalAndReferenceBasis', result?.legalAndReferenceBasis],
    ['damageAssessment', result?.damageAssessment],
    ['insurerPositionReview', result?.insurerPositionReview],
    ['adjusterOpinionDraft', result?.adjusterOpinionDraft],
    ['requiredAdditionalChecks', result?.requiredAdditionalChecks],
    ['simpleClientSummary', result?.simpleClientSummary],
    ['disclaimer', result?.disclaimer],
  ];
  if (includeReferences) fields.push(['displayedReferences', referenceText(result?.retrievedReferences)]);
  for (const [field, value] of fields) {
    const text = normalizeText(value);
    const match = text.match(pattern);
    if (match?.[0]) {
      const index = text.indexOf(match[0]);
      return {
        field,
        value: match[0],
        preview: text.slice(Math.max(0, index - 60), index + match[0].length + 60),
      };
    }
  }
  return null;
}

function sectionField(sectionName) {
  const value = normalizeText(sectionName);
  if (/개요|媛쒖슂/.test(value)) return 'overview';
  if (/사실|愿怨|ъ떎/.test(value)) return 'facts';
  if (/쟁점|곸젏|二쇱슂/.test(value)) return 'issues';
  if (/근거|법률|참고|踰뺣|洹쇨굅|李멸퀬/.test(value)) return 'legalAndReferenceBasis';
  if (/손해|평가|댁슜|됯/.test(value)) return 'damageAssessment';
  if (/보험사|주장|二쇱옣/.test(value)) return 'insurerPositionReview';
  if (/의견|초안|사정|珥덉븞|섍껄/.test(value)) return 'adjusterOpinionDraft';
  if (/추가|확인|異붽|뺤씤/.test(value)) return 'requiredAdditionalChecks';
  if (/고객|요약|怨좉컼|붿빟/.test(value)) return 'simpleClientSummary';
  if (/RAG|참고\s*근거|retrieved/i.test(value)) return 'retrievedReferences';
  return '';
}

function checkRequiredSections(testCase, result) {
  const failures = [];
  for (const section of asArray(testCase.requiredSections)) {
    const field = sectionField(section);
    if (field === 'retrievedReferences') {
      if (!referenceText(result?.retrievedReferences).trim()) failures.push(`missing section: ${section}`);
    } else if (field) {
      if (!normalizeText(result?.[field]).trim()) failures.push(`missing section: ${section}`);
    } else if (!includesText(resultText(result), section)) {
      failures.push(`missing section: ${section}`);
    }
  }
  return failures;
}

function duplicateLikely(previous, currentCase, currentText) {
  if (!previous?.result) return '';
  const previousTitle = normalizeText(previous.result.title);
  const currentTitle = normalizeText(currentCase.title);
  const currentResultTitle = normalizeText(currentText.split('\n')[0]);
  if (previousTitle && currentTitle && previousTitle === currentResultTitle && !includesText(currentTitle, previousTitle)) {
    return `stale result suspected: title reused from ${previous.id}`;
  }
  const previousCore = asArray(previous.case?.mustInclude).slice(0, 4);
  const forbiddenOverlap = previousCore.find((keyword) => asArray(currentCase.mustNotInclude).includes(keyword) && includesText(currentText, keyword));
  return forbiddenOverlap ? `stale result suspected: previous keyword found (${forbiddenOverlap})` : '';
}

function evaluateResult(testCase, result, previous) {
  const failures = [];
  const missingSections = [];
  const missingKeywords = [];
  const forbiddenFindings = [];
  const forbiddenReferenceFindings = [];
  const text = resultText(result);
  const visibleDraft = draftText(result);
  const refs = referenceText(result?.retrievedReferences);

  missingSections.push(...checkRequiredSections(testCase, result));
  failures.push(...missingSections);

  for (const keyword of asArray(testCase.mustInclude)) {
    const satisfiedByField = isAdditionalCheckKeyword(keyword) && normalizeText(result?.requiredAdditionalChecks).trim();
    if (!satisfiedByField && !includesText(text, keyword)) {
      missingKeywords.push(keyword);
      failures.push(`missing: ${keyword}`);
    }
  }
  for (const keyword of asArray(testCase.mustNotInclude)) {
    const location = findLocation(result, keyword, true);
    if (location) {
      forbiddenFindings.push({ keyword, ...location });
      failures.push(`forbidden found: ${keyword} (${location.field})`);
    }
  }
  for (const label of asArray(testCase.expectedReferenceLabels)) {
    if (!includesText(refs, label)) failures.push(`missing reference label: ${label}`);
  }
  const anyOfReferenceLabels = asArray(testCase.anyOfReferenceLabels);
  if (anyOfReferenceLabels.length && !anyOfReferenceLabels.some((label) => includesText(refs, label))) {
    failures.push(`missing any reference label: ${anyOfReferenceLabels.join(' | ')}`);
  }
  for (const keyword of asArray(testCase.forbiddenReferenceKeywords)) {
    const location = includesText(refs, keyword) ? findLocation({ retrievedReferences: result?.retrievedReferences }, keyword, true) : null;
    if (location) {
      forbiddenReferenceFindings.push({ keyword, ...location });
      failures.push(`forbidden reference found: ${keyword} (${location.field})`);
    }
  }
  const rawUrlLocation = findPatternLocation(result, RAW_URL_PATTERN, false);
  if (rawUrlLocation) failures.push(`raw URL exposed (${rawUrlLocation.field})`);
  const internalIdLocation = findPatternLocation(result, INTERNAL_ID_PATTERN, true);
  if (internalIdLocation) failures.push(`internal ID exposed (${internalIdLocation.field})`);
  const internalFieldLocation = findPatternLocation(result, INTERNAL_FIELD_PATTERN, true);
  if (internalFieldLocation) failures.push(`internal field exposed (${internalFieldLocation.field})`);
  const internalSourceLocation = findPatternLocation(result, INTERNAL_SOURCE_PATTERN, true);
  if (internalSourceLocation) failures.push(`internal source_type exposed (${internalSourceLocation.field})`);
  for (const phrase of DEFINITIVE_PATTERNS) {
    if (includesText(text, phrase)) failures.push(`definitive expression found: ${phrase}`);
  }
  const stale = duplicateLikely(previous, testCase, text);
  if (stale) failures.push(stale);

  return {
    id: testCase.id,
    category: testCase.category,
    title: testCase.title,
    status: failures.length ? 'FAIL' : 'PASS',
    failures,
    missingSections,
    missingKeywords,
    forbiddenFindings,
    forbiddenReferenceFindings,
    rawUrlFinding: rawUrlLocation,
    internalFindings: [internalIdLocation, internalFieldLocation, internalSourceLocation].filter(Boolean),
    preview: preview(visibleDraft, 500),
    detectedProfile: result?.detectedProfile || result?.profile || '',
    resultTitle: result?.title || '',
    requestId: result?.requestId || '',
    referenceCounts: {
      official: result?.retrievedReferences?.officialReferences?.length || 0,
      internal: result?.retrievedReferences?.internalReviewMaterials?.length || 0,
      auxiliary: result?.retrievedReferences?.auxiliaryReferences?.length || 0,
      followUp: result?.retrievedReferences?.followUpChecks?.length || 0,
    },
  };
}

function writeReports(summary) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(JSON_RESULT_PATH, JSON.stringify(summary, null, 2), 'utf8');
  const lines = [
    '# Assessment Draft Evaluation Latest',
    '',
    `- Generated at: ${summary.generatedAt}`,
    `- Total: ${summary.total}`,
    `- Pass: ${summary.pass}`,
    `- Fail: ${summary.fail}`,
    `- Dry run: ${summary.dryRun}`,
    '',
    '## Results',
    '',
  ];
  for (const item of summary.results) {
    lines.push(`### ${item.id}: ${item.status}`);
    lines.push(`- Category: ${item.category || ''}`);
    lines.push(`- Case: ${item.title || ''}`);
    if (item.resultTitle) lines.push(`- Result title: ${item.resultTitle}`);
    if (item.detectedProfile) lines.push(`- Detected profile: ${item.detectedProfile}`);
    if (item.preview) lines.push(`- Preview: ${item.preview}`);
    if (item.error) lines.push(`- Error: ${item.error}`);
    if (item.failures?.length) {
      for (const failure of item.failures) lines.push(`- ${failure}`);
    }
    if (item.forbiddenFindings?.length) {
      lines.push('- Forbidden locations:');
      for (const finding of item.forbiddenFindings) lines.push(`  - ${finding.keyword}: ${finding.field} | ${finding.preview}`);
    }
    if (item.forbiddenReferenceFindings?.length) {
      lines.push('- Forbidden reference locations:');
      for (const finding of item.forbiddenReferenceFindings) lines.push(`  - ${finding.keyword}: ${finding.field} | ${finding.preview}`);
    }
    if (item.rawUrlFinding) lines.push(`- Raw URL location: ${item.rawUrlFinding.field} | ${item.rawUrlFinding.preview}`);
    lines.push('');
  }
  fs.writeFileSync(MD_RESULT_PATH, lines.join('\n'), 'utf8');
}

async function signIn() {
  for (const name of REQUIRED_ENV) {
    if (!process.env[name]) throw new Error(`Missing ${name} in .env.rag.local`);
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({
    email: process.env.TEST_ADJUSTER_EMAIL,
    password: process.env.TEST_ADJUSTER_PASSWORD,
  });
  if (error) throw error;
  if (!data.session?.access_token) throw new Error('No access_token returned from signInWithPassword');
  return supabase;
}

async function invokeAssessment(supabase, payload) {
  const { data, error } = await supabase.functions.invoke('create-assessment-draft', { body: payload });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cases = readJson(CASES_PATH);
  if (!Array.isArray(cases)) throw new Error('assessment_cases_100_v1.json must contain an array');

  const selected = selectCases(cases, args);
  const shapeResults = selected.map((testCase) => ({ id: testCase.id, errors: validateCaseShape(testCase) }));
  const shapeFailures = shapeResults.filter((item) => item.errors.length);
  if (!selected.length) throw new Error('No cases matched the requested filters');

  let supabase = null;
  if (!args.dryRun) supabase = await signIn();

  const results = [];
  let previous = null;
  for (const testCase of selected) {
    const shapeErrors = validateCaseShape(testCase);
    if (args.dryRun || shapeErrors.length) {
      const item = {
        id: testCase.id,
        category: testCase.category,
        title: testCase.title,
        status: shapeErrors.length ? 'FAIL' : 'PASS',
        failures: shapeErrors,
        dryRun: true,
      };
      results.push(item);
      console.log(`${testCase.id}: ${item.status}`);
      for (const failure of item.failures) console.log(`  - ${failure}`);
      continue;
    }

    const payload = buildPayload(testCase);
    console.log(`${testCase.id}: running (${preview(testCase.title, 60)})`);
    try {
      const result = await invokeAssessment(supabase, payload);
      const item = evaluateResult(testCase, result, previous);
      results.push(item);
      previous = { id: testCase.id, case: testCase, result };
      console.log(`${testCase.id}: ${item.status}`);
      for (const failure of item.failures.slice(0, 8)) console.log(`  - ${failure}`);
      if (item.failures.length > 8) console.log(`  - ... ${item.failures.length - 8} more`);
    } catch (error) {
      const item = {
        id: testCase.id,
        category: testCase.category,
        title: testCase.title,
        status: 'FAIL',
        failures: ['edge function error'],
        error: error instanceof Error ? error.message : String(error),
      };
      results.push(item);
      console.log(`${testCase.id}: FAIL`);
      console.log(`  - edge function error: ${preview(item.error, 160)}`);
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    dryRun: args.dryRun,
    filters: args,
    totalAvailable: cases.length,
    total: results.length,
    pass: results.filter((item) => item.status === 'PASS').length,
    fail: results.filter((item) => item.status === 'FAIL').length,
    shapeFailures,
    results,
  };
  writeReports(summary);
  console.log(`\nSummary: total=${summary.total} pass=${summary.pass} fail=${summary.fail}`);
  console.log(`JSON: ${JSON_RESULT_PATH}`);
  console.log(`MD: ${MD_RESULT_PATH}`);
  if (summary.fail) process.exitCode = args.dryRun ? 0 : 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
