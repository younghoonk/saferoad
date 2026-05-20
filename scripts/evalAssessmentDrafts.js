const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.resolve(process.cwd(), '.env.rag.local') });

const DEFAULT_CASES_PATH = path.resolve(process.cwd(), 'ai_eval', 'assessment_cases_100_v1.json');
const RESULTS_DIR = path.resolve(process.cwd(), 'ai_eval', 'results');
const DEFAULT_SUBSET_PATH = path.resolve(process.cwd(), 'ai_eval', 'assessment_subset_core_10.json');
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
  const args = { dryRun: false, caseId: '', limit: 0, category: '', from: 0, to: 0, retries: 2, subsetFile: '', casesFile: DEFAULT_CASES_PATH };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === '--dry-run') args.dryRun = true;
    else if (item === '--case') args.caseId = argv[++i] || '';
    else if (item === '--limit') args.limit = Number(argv[++i] || 0);
    else if (item === '--category') args.category = argv[++i] || '';
    else if (item === '--from') args.from = Number(argv[++i] || 0);
    else if (item === '--to') args.to = Number(argv[++i] || 0);
    else if (item === '--retries') args.retries = Number(argv[++i] || 0);
    else if (item === '--subset-file') args.subsetFile = argv[++i] || DEFAULT_SUBSET_PATH;
    else if (item === '--cases-file') args.casesFile = argv[++i] || DEFAULT_CASES_PATH;
    else if (item === '--core-subset') args.subsetFile = DEFAULT_SUBSET_PATH;
    else if (item.startsWith('--case=')) args.caseId = item.slice('--case='.length);
    else if (item.startsWith('--limit=')) args.limit = Number(item.slice('--limit='.length));
    else if (item.startsWith('--category=')) args.category = item.slice('--category='.length);
    else if (item.startsWith('--from=')) args.from = Number(item.slice('--from='.length));
    else if (item.startsWith('--to=')) args.to = Number(item.slice('--to='.length));
    else if (item.startsWith('--retries=')) args.retries = Number(item.slice('--retries='.length));
    else if (item.startsWith('--subset-file=')) args.subsetFile = item.slice('--subset-file='.length);
    else if (item.startsWith('--cases-file=')) args.casesFile = item.slice('--cases-file='.length);
  }
  if (!Number.isFinite(args.retries) || args.retries < 0) args.retries = 2;
  args.retries = Math.floor(args.retries);
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
  return /추가|확인/.test(normalizeText(keyword));
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
  if (args.subsetFile) {
    const subsetIds = new Set(readJson(path.resolve(process.cwd(), args.subsetFile)));
    selected = selected.filter((item) => subsetIds.has(item.id));
  }
  if (args.caseId) selected = selected.filter((item) => item.id === args.caseId);
  if (args.category) selected = selected.filter((item) => item.category === args.category);
  if (args.from > 0 || args.to > 0) {
    selected = selected.filter((item) => {
      const match = String(item.id || '').match(/^ASSESS_(\d+)$/);
      if (!match) return false;
      const number = Number(match[1]);
      if (args.from > 0 && number < args.from) return false;
      if (args.to > 0 && number > args.to) return false;
      return true;
    });
  }
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
  const groups = flattenReferences(references).map((item) => item.ref);
  return groups.map((ref) => [
    ref.sourceDisplayName,
    ref.source_area_label,
    ref.source_area,
    ref.title,
    ref.summary,
    ref.keyHolding,
    ref.excerpt,
    ref.applicableReason,
    ref.limitation,
    ref.policySource,
    ...(Array.isArray(ref.issueTags) ? ref.issueTags : []),
    ref.case_number,
    ref.court_or_agency,
    ref.decision_date,
    ref.law_name,
    ref.article_title,
  ].filter(Boolean).join(' ')).join('\n');
}

function flattenReferences(references) {
  const groups = [
    ['officialReferences', references?.officialReferences || []],
    ['internalReviewMaterials', references?.internalReviewMaterials || []],
    ['auxiliaryReferences', references?.auxiliaryReferences || []],
    ['excludedReferences', references?.excludedReferences || []],
    ['followUpChecks', references?.followUpChecks || []],
  ];
  return groups.flatMap(([group, refs]) => refs.map((ref, index) => ({ group, index, ref })));
}

function policyEvidence(result) {
  const direct = Array.isArray(result?.policyEvidence) ? result.policyEvidence : [];
  const fromReferences = flattenReferences(result?.retrievedReferences)
    .map((item) => item.ref)
    .filter((ref) => ref?.source_area === 'terms_standards' || ref?.sourceType === 'policy' || ref?.source_type === 'policy_terms_bundle');
  const seen = new Set();
  return [...direct, ...fromReferences].filter((ref) => {
    const key = [ref?.id, ref?.title, ref?.summary, ref?.policySource].filter(Boolean).join('|');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function policyEvidenceText(result) {
  return policyEvidence(result).map((ref) => [
    ref.title,
    ref.summary,
    ref.keyHolding,
    ref.excerpt,
    ref.applicableReason,
    ref.limitation,
    ref.policySource,
    ...(Array.isArray(ref.issueTags) ? ref.issueTags : []),
  ].filter(Boolean).join(' ')).join('\n');
}

function extractChapter(text, startTitle, endTitle) {
  const source = String(text || '');
  const start = source.indexOf(startTitle);
  if (start < 0) return '';
  const end = endTitle ? source.indexOf(endTitle, start + startTitle.length) : -1;
  return end >= 0 ? source.slice(start, end) : source.slice(start);
}

function referenceMatchDetails(references, keyword) {
  const target = normalizeText(keyword);
  const matches = [];
  for (const { group, index, ref } of flattenReferences(references)) {
    const text = normalizeText([
      ref.sourceDisplayName,
      ref.source_area_label,
      ref.source_area,
      ref.source_type,
      ref.title,
      ref.summary,
      ref.keyHolding,
      ref.excerpt,
      ref.applicableReason,
      ref.limitation,
      ref.policySource,
      ...(Array.isArray(ref.issueTags) ? ref.issueTags : []),
      ref.case_number,
      ref.court_or_agency,
      ref.decision_date,
      ref.law_name,
      ref.article_title,
    ].filter(Boolean).join(' '));
    const foundAt = text.indexOf(target);
    if (foundAt >= 0) {
      matches.push({
        keyword,
        field: 'displayedReferences',
        group,
        index,
        source_area: ref.source_area || '',
        source_type: ref.source_type || '',
        sourceDisplayName: ref.sourceDisplayName || ref.source_area_label || '',
        title: ref.title || '',
        chunk_id: ref.chunk_id || ref.id || '',
        preview: text.slice(Math.max(0, foundAt - 60), foundAt + target.length + 60),
      });
    }
  }
  return matches;
}

function uniqueReferenceWarnings(warnings) {
  const seen = new Set();
  const unique = [];
  for (const warning of warnings) {
    const key = [
      warning.keyword,
      warning.group,
      warning.index,
      warning.source_area,
      warning.source_type,
      warning.title,
      warning.preview,
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(warning);
  }
  return unique;
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
    result.customerSideAssessmentReport,
    result.finalSubmissionAssessmentReport,
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

function conclusionText(result) {
  if (!result) return '';
  return [
    result.adjusterOpinionDraft,
    result.customerSideAssessmentReport,
    result.finalSubmissionAssessmentReport,
    result.simpleClientSummary,
    result.disclaimer,
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
    ['customerSideAssessmentReport', result?.customerSideAssessmentReport],
    ['finalSubmissionAssessmentReport', result?.finalSubmissionAssessmentReport],
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
    ['customerSideAssessmentReport', result?.customerSideAssessmentReport],
    ['finalSubmissionAssessmentReport', result?.finalSubmissionAssessmentReport],
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
  if (/개요|경위/.test(value)) return 'overview';
  if (/사실|관계/.test(value)) return 'facts';
  if (/쟁점/.test(value)) return 'issues';
  if (/근거|법률|참고|약관|판단기준/.test(value)) return 'legalAndReferenceBasis';
  if (/손해|평가|의학/.test(value)) return 'damageAssessment';
  if (/보험사|주장/.test(value)) return 'insurerPositionReview';
  if (/제출|손해사정서|부지급\s*통보|이의/.test(value)) return 'finalSubmissionAssessmentReport';
  if (/의견|초안|사정|이의/.test(value)) return 'adjusterOpinionDraft';
  if (/추가|확인/.test(value)) return 'requiredAdditionalChecks';
  if (/고객|요약/.test(value)) return 'simpleClientSummary';
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

function checkArgumentStructureRubric(testCase, result) {
  const failures = [];
  const text = normalizeText(result?.finalSubmissionAssessmentReport || draftText(result));
  const caseText = normalizeText([
    testCase.category,
    testCase.title,
    JSON.stringify(testCase.input || {}),
    ...asArray(testCase.mustInclude),
  ].join(' '));
  const isAcuteMi = /acute_mi|I21\.?4|NSTEMI|심근경색|troponin|CAG|PCI|Unstable angina/i.test(caseText);
  if (!normalizeText(result?.finalSubmissionAssessmentReport)) {
    failures.push('missing hard assertion: finalSubmissionAssessmentReport');
  }
  if (normalizeText(result?.reportFormatVersion) !== 'submission_report_v2_claim_argument_structure') {
    failures.push('missing hard assertion: reportFormatVersion');
  }
  const finalText = normalizeText(result?.finalSubmissionAssessmentReport || '');
  if (/\bconfidence\b|document_type|completed|SKMBT_|Resized_|\[일자 확인\]/i.test(finalText)) {
    failures.push('forbidden submission internals: confidence/document_type/completed/file marker/date placeholder');
  }
  const confirmTargetCount = (text.match(/확인 대상/g) || []).length;
  if (confirmTargetCount >= 3) failures.push('forbidden weak wording: 확인 대상 repeated');
  const chapterI = normalizeText(extractChapter(text, 'Ⅰ. 사건의 경위 및 진단 확정 과정', 'Ⅱ. 보험사'));
  if (/문서\s*구성|핵심\s*chronology|chronology/i.test(chapterI)) {
    failures.push('forbidden chapter I internal analysis heading');
  }
  const insurerQuote = text.match(/보험회사의 주장은\s*"([^"]+)"/)?.[1] || '';
  if (/단편적\s*해석/.test(insurerQuote)) {
    failures.push('forbidden insurer quote contamination: 단편적 해석');
  }

  const checks = [
    [/손해사정서\s*\(?보험금\s*부지급\s*통보에\s*대한\s*이의\s*및\s*의견\)?|손해사정서.*부지급\s*통보/i, 'missing hard assertion: submission report title'],
    [/Ⅰ\.\s*사건의\s*경위\s*및\s*진단\s*확정\s*과정/i, 'missing hard assertion: chapter I'],
    [/Ⅱ\.\s*보험사\s*부지급\s*결정의\s*요지\s*및\s*그\s*부당성/i, 'missing hard assertion: chapter II'],
    [/Ⅲ\.\s*의학적\s*근거/i, 'missing hard assertion: chapter III'],
    [/Ⅳ\.\s*보험약관상\s*진단확정\s*요건의\s*충족/i, 'missing hard assertion: chapter IV'],
    [/Ⅴ\.\s*판례\s*및\s*금감원\s*자료에\s*대한\s*적용\s*또는\s*반박/i, 'missing hard assertion: chapter V'],
    [/Ⅵ\.\s*약관해석\s*원칙/i, 'missing hard assertion: chapter VI'],
    [/Ⅶ\.\s*결론/i, 'missing hard assertion: chapter VII'],
    [/\[요청사항\]/i, 'missing hard assertion: request section'],
    [/\[첨부서류\]/i, 'missing hard assertion: attachment section'],
    [/보험금.*지급|지급.*보험금|전액.*지급/i, 'missing hard assertion: payment request'],
    [/지연이자/i, 'missing hard assertion: delay interest request'],
    [/보험회사(?:의)?\s*주장|보험사(?:의)?\s*주장|부지급\s*결정의\s*요지/i, 'missing argument rubric: insurer position extraction'],
    [/오류\s*유형|결정적\s*오류|부당성|단편적\s*해석|왜곡|누락/i, 'missing argument rubric: insurer error classification'],
    [/Ⅰ\.\s*사건의\s*경위|chronology|시간순|일자/i, 'missing argument rubric: chronological facts'],
    [/판례|금감원|분쟁조정|직접\s*적용\s*가능한.*확인되지/i, 'missing argument rubric: case law/FSS handling'],
    [/작성자\s*불이익|약관해석\s*원칙|약관에\s*없는\s*추가\s*요건/i, 'missing argument rubric: interpretation principle'],
    [/지연이자|서면.*회신|분쟁조정|소송|후속\s*절차/i, 'missing argument rubric: final pressure requests'],
    [/\[피보험자\]|\[주민번호\]|\[주소\]|\[연락처\]|\[증권번호\]/i, 'missing argument rubric: redacted placeholders'],
  ];
  if (isAcuteMi) {
    const policies = policyEvidence(result);
    const policyText = normalizeText(policyEvidenceText(result));
    const killingEvidence = Array.isArray(result?.killingEvidence) ? result.killingEvidence : [];
    const preAnalysis = result?.preAnalysis || result?.preAnalysisSummary;
    const selfVerification = result?.selfVerification || {};
    const doctorEvidence = killingEvidence.filter((item) => item?.evidenceType === 'doctor_soap_note' || item?.evidenceType === 'doctor_reasoning');
    if (!preAnalysis) failures.push('missing hard assertion: preAnalysis');
    if (selfVerification && typeof selfVerification === 'object') {
      const failedSelfChecks = Object.entries(selfVerification)
        .filter(([key, value]) => key !== 'defenseLayersCount' && value === false)
        .map(([key]) => key);
      if (typeof selfVerification.defenseLayersCount === 'number' && selfVerification.defenseLayersCount < 4) {
        failedSelfChecks.push('defenseLayersCount');
      }
      if (failedSelfChecks.length) failures.push(`self verification failed: ${failedSelfChecks.join(', ')}`);
    }
    const chapterIi = normalizeText(extractChapter(text, 'Ⅱ. 보험사 부지급 결정의 요지 및 그 부당성', 'Ⅲ. 의학적 근거'));
    const chapterIii = normalizeText(extractChapter(text, 'Ⅲ. 의학적 근거', 'Ⅳ. 보험약관상'));
    const chapterVii = normalizeText(extractChapter(text, 'Ⅶ. 결론', '[요청사항]'));
    if (killingEvidence.length < 1) failures.push('missing hard assertion: killingEvidence');
    if (doctorEvidence.length && !doctorEvidence.some((item) => item.strength === 'decisive')) {
      failures.push('missing hard assertion: decisive doctor SOAP/reasoning evidence');
    }
    if (!/cardiac marker|EKG|UA-?NSTEMI|NSTEMI|심장효소|심근효소|진단서\s*가능/i.test(text)) {
      failures.push('missing hard assertion: killing evidence phrase in final report');
    }
    if (!/주치의.*객관적.*검토|객관적.*검토.*누락|SOAP|외래.*기록/i.test(chapterIi)) {
      failures.push('missing hard assertion: insurer error omits doctor objective review');
    }
    if (!/NSTEMI|I21\.?4|SOAP|외래.*기록|주치의.*객관적/i.test(chapterIii)) {
      failures.push('missing hard assertion: medical section links NSTEMI/I21.4 and doctor SOAP record');
    }
    if (!/의무기록.*자체.*진단.*객관성|의무기록.*객관적.*검토|객관적.*검사자료.*검토/i.test(chapterVii)) {
      failures.push('missing hard assertion: conclusion states medical records prove diagnostic objectivity');
    }
    if (!/Fourth Universal Definition of Myocardial Infarction|제4차\s*심근경색의\s*보편적\s*정의/i.test(text)) {
      failures.push('missing hard assertion: Fourth Universal Definition of MI');
    }
    if (!/\|\s*(?:판단 기준|진단기준|criterion)\s*\|[\s\S]{0,600}(?:troponin|NSTEMI|I21\.?4|myocardial injury)/i.test(text)) {
      failures.push('missing hard assertion: medical mapping table');
    }
    if (!/\|\s*약관상\s*요구\s*요건\s*\|[\s\S]{0,700}(?:심전도|관상동맥|심장효소|의사)/i.test(text)) {
      failures.push('missing hard assertion: policy mapping table');
    }
    if (!/\[요청사항\][\s\S]*보험금[\s\S]*지연이자[\s\S]*(?:서면\s*회신|서면으로\s*회신)/i.test(text)) {
      failures.push('missing hard assertion: payment/delay interest/written reply requests');
    }
    if (!/cardiac marker|EKG|UA-?NSTEMI|NSTEMI|주치의.*객관적.*검토|의무기록.*진단.*객관성/i.test(text)) {
      failures.push('missing hard assertion: v2 killing evidence logic');
    }
    const chapterIv = normalizeText(extractChapter(text, 'Ⅳ. 보험약관상 진단확정 요건의 충족', 'Ⅴ. 판례'));
    if (policies.length < 1) failures.push('missing hard assertion: policyEvidence');
    if (!/급성\s*심근경색|허혈\s*심장질환|심장질환\s*진단확정|심전도|관상동맥|심장효소/i.test(policyText)) {
      failures.push('missing hard assertion: acute MI policy evidence relevance');
    }
    const chapterIvTerms = ['심전도', '관상동맥', '심장효소', '의사'].filter((term) => chapterIv.includes(term)).length;
    if (chapterIvTerms < 3) failures.push('missing hard assertion: chapter IV policy criteria terms');
    if (!/시술\s*전\s*심근효소\s*상승/.test(chapterIv) || !/약관상\s*(?:필수|독립)\s*요건|규정하고\s*있지\s*않다/.test(chapterIv)) {
      failures.push('missing hard assertion: pre-PCI enzyme not policy requirement');
    }
    if (policies.some((ref) => ref.policySource === 'server_default') && !policyText.includes('server_default')) {
      failures.push('missing hard assertion: server default policy source');
    }
    checks.push(
      [/핵심\s*수치|Troponin|hs-?troponin|CK-?MB|협착률|%/i, 'missing argument rubric: repeated key numbers'],
      [/\|\s*판단\s*기준\s*\||\|\s*의학|myocardial injury|myocardial infarction|99th percentile/i, 'missing argument rubric: medical criteria table'],
      [/\|\s*약관상\s*진단확정|\|\s*약관상|심전도\s*검사|관상동맥촬영술|심장효소검사/i, 'missing argument rubric: policy requirement table'],
      [/I21\.?4|급성심근경색/i, 'missing hard assertion: I21.4 or acute MI'],
      [/Troponin|트로포닌/i, 'missing hard assertion: Troponin'],
      [/CAG|PCI|관상동맥촬영술/i, 'missing hard assertion: CAG/PCI'],
      [/Unstable\s*angina|불안정\s*협심증/i, 'missing hard assertion: Unstable angina'],
      [/NSTEMI|급성\s*심내막하심근경색/i, 'missing hard assertion: NSTEMI logic'],
    );
  }
  for (const [pattern, message] of checks) {
    if (!pattern.test(text)) failures.push(message);
  }
  const forbidden = [
    /사료됩니다/g,
    /생각됩니다/g,
    /가능성이 있습니다/g,
    /추가 검토가 필요/g,
    /재검토가 필요/g,
    /검토 가치/g,
    /확정할 수는 없으나/g,
    /지급 여부를 단정/g,
    /초안/g,
    /참고용/g,
    /confidence/g,
    /document_type/g,
    /completed/g,
    /SKMBT_/g,
    /Resized_/g,
    /\[일자 확인\]/g,
    /초안/g,
    /참고용/g,
    /손해액\s*산정보다는/g,
    /재검토가\s*필요/g,
    /재검토\s*필요/g,
    /추가\s*검토가\s*필요/g,
    /검토\s*가치/g,
    /가능성이\s*있습니다/g,
    /확정할\s*수는\s*없으나/g,
    /지급\s*여부를\s*단정하는\s*것이\s*아니라/g,
    /단정하기보다/g,
    /처분의\s*요건\s*충족\s*여부/g,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(text)) failures.push(`forbidden argument wording: ${pattern}`);
  }
  return failures;
}

function duplicateLikely(previous, currentCase, currentText) {
  if (!previous?.result) return '';
  const previousTitle = normalizeText(previous.result.title);
  const currentTitle = normalizeText(currentCase.title);
  const currentResultTitle = normalizeText(currentText.split('\n')[0]);
  const genericResultTitle = /(?:암진단비|손해사정|분쟁|의견|초안)/.test(previousTitle) && previousTitle.length < 40;
  if (!genericResultTitle && previousTitle && currentTitle && previousTitle === currentResultTitle && !includesText(currentTitle, previousTitle)) {
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
  const referenceForbiddenWarnings = [];
  const text = resultText(result);
  const visibleDraft = draftText(result);
  const conclusion = conclusionText(result);
  const refs = referenceText(result?.retrievedReferences);

  missingSections.push(...checkRequiredSections(testCase, result));
  failures.push(...missingSections);
  failures.push(...checkArgumentStructureRubric(testCase, result));

  for (const keyword of asArray(testCase.mustInclude)) {
    const satisfiedByField = isAdditionalCheckKeyword(keyword) && normalizeText(result?.requiredAdditionalChecks).trim();
    if (!satisfiedByField && !includesText(text, keyword)) {
      missingKeywords.push(keyword);
      failures.push(`missing: ${keyword}`);
    }
  }
  for (const keyword of asArray(testCase.mustNotInclude)) {
    const bodyLocation = findLocation(result, keyword, false);
    if (bodyLocation) {
      forbiddenFindings.push({ keyword, area: 'draft_body', ...bodyLocation });
      failures.push(`forbidden found in draft_body: ${keyword} (${bodyLocation.field})`);
      continue;
    }
    for (const referenceWarning of referenceMatchDetails(result?.retrievedReferences, keyword)) {
      referenceForbiddenWarnings.push({
        ...referenceWarning,
        warning_type: 'REFERENCE_NOISE',
        strict: Boolean(testCase.strictReferenceForbidden),
      });
      if (testCase.strictReferenceForbidden) {
        forbiddenReferenceFindings.push(referenceWarning);
        failures.push(`forbidden found in displayed_references: ${keyword} (${referenceWarning.group})`);
      }
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
    for (const referenceWarning of referenceMatchDetails(result?.retrievedReferences, keyword)) {
      referenceForbiddenWarnings.push({
        ...referenceWarning,
        warning_type: 'REFERENCE_NOISE',
        strict: Boolean(testCase.strictReferenceForbidden),
      });
      if (testCase.strictReferenceForbidden) {
        forbiddenReferenceFindings.push(referenceWarning);
        failures.push(`forbidden reference found: ${keyword} (${referenceWarning.group})`);
      }
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
    if (includesText(visibleDraft, phrase)) failures.push(`definitive expression found: ${phrase}`);
  }
  const stale = duplicateLikely(previous, testCase, visibleDraft);
  if (stale) failures.push(stale);

  const uniqueWarnings = uniqueReferenceWarnings(referenceForbiddenWarnings);
  const status = classifyResultStatus(failures, forbiddenFindings, forbiddenReferenceFindings, rawUrlLocation, internalIdLocation, internalFieldLocation, internalSourceLocation);
  return {
    id: testCase.id,
    category: testCase.category,
    title: testCase.title,
    status,
    failures,
    missingSections,
    missingKeywords,
    forbiddenFindings,
    forbiddenReferenceFindings,
    forbidden_in_body: forbiddenFindings,
    forbidden_in_references: forbiddenReferenceFindings,
    reference_forbidden_warnings: uniqueWarnings,
    warningCount: uniqueWarnings.length,
    failure_category: status === 'PASS' && uniqueWarnings.length ? 'PASS_WITH_REFERENCE_WARNING' : status,
    rawUrlFinding: rawUrlLocation,
    internalFindings: [internalIdLocation, internalFieldLocation, internalSourceLocation].filter(Boolean),
    preview: preview(visibleDraft, 500),
    conclusionPreview: preview(conclusion, 500),
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

function classifyResultStatus(failures, forbiddenFindings, forbiddenReferenceFindings, rawUrlLocation, internalIdLocation, internalFieldLocation, internalSourceLocation) {
  if (!failures.length) return 'PASS';
  if (forbiddenFindings.length || rawUrlLocation || internalIdLocation || internalFieldLocation || internalSourceLocation || failures.some((item) => /forbidden|definitive expression|internal .* exposed|raw URL/i.test(item))) {
    return 'FORBIDDEN_PHRASE_FAIL';
  }
  if (forbiddenReferenceFindings.length || failures.some((item) => /reference/i.test(item))) return 'REFERENCE_FAIL';
  return 'QUALITY_FAIL';
}

function classifyTransportError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|timed out|deadline/i.test(message)) return 'TIMEOUT';
  if (/rag|match_rag|embedding/i.test(message)) return 'RAG_ERROR';
  if (/model|openai|rate limit|quota|token/i.test(message)) return 'MODEL_ERROR';
  return 'TRANSPORT_ERROR';
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
    if (item.attempts !== undefined) lines.push(`- Attempts: ${item.attempts}`);
    if (item.transportError !== undefined) lines.push(`- Transport error: ${item.transportError}`);
    if (item.preview) lines.push(`- Preview: ${item.preview}`);
    if (item.error) lines.push(`- Error: ${item.error}`);
    if (item.failures?.length) {
      for (const failure of item.failures) lines.push(`- ${failure}`);
    }
    if (item.reference_forbidden_warnings?.length) {
      lines.push('- Reference warnings:');
      for (const warning of item.reference_forbidden_warnings) {
        lines.push(`  - ${warning.keyword}: ${warning.group} ${warning.source_area || ''}/${warning.source_type || ''} | ${warning.title || ''} | ${warning.preview}`);
      }
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
  if (error) throw new AssessmentTransportError(error.message || String(error), error);
  if (data?.error) throw new AssessmentTransportError(data.error);
  return data;
}

class AssessmentTransportError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'AssessmentTransportError';
    this.cause = cause;
    this.transportError = true;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function invokeAssessmentWithRetry(supabase, payload, retries) {
  const maxAttempts = retries + 1;
  let lastError = null;
  const transientErrors = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const data = await invokeAssessment(supabase, payload);
      return { data, attempts: attempt, transientErrors };
    } catch (error) {
      lastError = error;
      transientErrors.push({
        attempt,
        category: classifyTransportError(error),
        message: preview(error instanceof Error ? error.message : String(error), 200),
      });
      if (attempt >= maxAttempts) break;
      console.log(`  - transport error, retrying ${attempt}/${retries}: ${preview(error instanceof Error ? error.message : String(error), 120)}`);
      await sleep(Math.min(1000 * attempt, 3000));
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  const finalError = new AssessmentTransportError(message, lastError);
  finalError.attempts = maxAttempts;
  finalError.transientErrors = transientErrors;
  throw finalError;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const casesPath = path.resolve(process.cwd(), args.casesFile || DEFAULT_CASES_PATH);
  const cases = readJson(casesPath);
  if (!Array.isArray(cases)) throw new Error(`${casesPath} must contain an array`);

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
        attempts: 0,
        transportError: false,
      };
      results.push(item);
      console.log(`${testCase.id}: ${item.status}`);
      for (const failure of item.failures) console.log(`  - ${failure}`);
      continue;
    }

    const payload = buildPayload(testCase);
    console.log(`${testCase.id}: running (${preview(testCase.title, 60)})`);
    try {
      const invoked = await invokeAssessmentWithRetry(supabase, payload, args.retries);
      const result = invoked.data;
      const item = evaluateResult(testCase, result, previous);
      item.attempts = invoked.attempts;
      item.transportError = false;
      item.transient_errors = invoked.transientErrors || [];
      results.push(item);
      previous = { id: testCase.id, case: testCase, result };
      console.log(`${testCase.id}: ${item.status}`);
      for (const failure of item.failures.slice(0, 8)) console.log(`  - ${failure}`);
      if (item.failures.length > 8) console.log(`  - ... ${item.failures.length - 8} more`);
      if (item.reference_forbidden_warnings?.length) console.log(`  - reference warnings: ${item.reference_forbidden_warnings.length}`);
    } catch (error) {
      const item = {
        id: testCase.id,
        category: testCase.category,
        title: testCase.title,
        status: 'FAIL',
        failures: [classifyTransportError(error).toLowerCase()],
        error: error instanceof Error ? error.message : String(error),
        attempts: error?.attempts || args.retries + 1,
        transportError: true,
        transient_errors: error?.transientErrors || [],
      };
      item.status = classifyTransportError(error);
      results.push(item);
      console.log(`${testCase.id}: FAIL`);
      console.log(`  - transport_error after ${item.attempts} attempt(s): ${preview(item.error, 160)}`);
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    dryRun: args.dryRun,
    filters: args,
    totalAvailable: cases.length,
    total: results.length,
    pass: results.filter((item) => item.status === 'PASS').length,
    fail: results.filter((item) => item.status !== 'PASS').length,
    warningCount: results.reduce((total, item) => total + (item.warningCount || 0), 0),
    warningCases: results.filter((item) => item.warningCount > 0).map((item) => item.id),
    statusCounts: results.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    }, {}),
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
