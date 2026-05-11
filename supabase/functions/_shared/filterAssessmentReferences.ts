import { assessmentProfileById, type AssessmentProfileId } from './assessmentProfiles.ts';
import type { RagSearchResult, RetrievedReference } from './ragSearch.ts';

interface FilterAssessmentReferencesOptions {
  profileId: AssessmentProfileId;
  maxInternalReferences?: number;
  applyProfileKeywordFilters?: boolean;
}

const blockedReferenceText = /\b(?:MIC001|PIP001|RSF001|chunk_id|source_id|internal_)\b/i;
const blockedOfficialDomains = /blog\.naver\.com|m\.blog\.naver\.com|okclaim\.com|insclaim\.co\.kr|tistory\.com|brunch\.co\.kr/i;

function textOf(ref: RetrievedReference) {
  return [
    ref.sourceDisplayName,
    ref.source_area_label,
    ref.source_area,
    ref.source_type,
    ref.title,
    ref.summary,
    ref.case_number,
    ref.court_or_agency,
    ref.decision_date,
    ref.law_name,
    ref.article_title,
    ref.diagnosis_code,
    ref.diagnosis_name,
    ref.note,
    ref.review_status,
    ref.source_provider,
    ref.provider_prec_id,
  ].filter(Boolean).join(' ');
}

function hasAny(text: string, keywords: string[]) {
  return !keywords.length || keywords.some((keyword) => text.toLowerCase().includes(keyword.toLowerCase()));
}

function hasExcluded(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.toLowerCase().includes(keyword.toLowerCase()));
}

function officialKey(ref: RetrievedReference) {
  if (ref.law_name || ref.article_title) {
    return ['law', ref.law_name || ref.title || '', ref.article_title || ref.case_number || ''].join(':');
  }
  return [ref.source_area, ref.title, ref.case_number, ref.court_or_agency, ref.decision_date].filter(Boolean).join(':');
}

function stripUserUnsafeFields(ref: RetrievedReference): RetrievedReference {
  const { source_url: _sourceUrl, ...safeRef } = ref;
  return safeRef;
}

export function filterAssessmentReferences(
  ragResult: RagSearchResult,
  options: FilterAssessmentReferencesOptions,
): RagSearchResult {
  const profile = assessmentProfileById[options.profileId];
  const applyProfileKeywordFilters = options.applyProfileKeywordFilters === true;
  const seenOfficial = new Set<string>();

  const officialReferences = ragResult.officialReferences
    .map(stripUserUnsafeFields)
    .filter((ref) => {
      const text = textOf(ref);
      if (blockedReferenceText.test(text)) return false;
      if (blockedOfficialDomains.test([text, ref.source_url || ''].join(' '))) return false;
      if (applyProfileKeywordFilters && !hasAny(text, profile.officialAllowKeywords)) return false;
      if (applyProfileKeywordFilters && hasExcluded(text, profile.officialExcludeKeywords)) return false;
      const key = officialKey(ref);
      if (seenOfficial.has(key)) return false;
      seenOfficial.add(key);
      return true;
    });

  const maxInternal = options.maxInternalReferences ?? 4;
  const internalReviewMaterials = ragResult.internalReviewMaterials
    .map(stripUserUnsafeFields)
    .filter((ref) => {
      const text = textOf(ref);
      if (blockedReferenceText.test(text)) return false;
      if (applyProfileKeywordFilters && !hasAny(text, profile.internalAllowKeywords)) return false;
      if (applyProfileKeywordFilters && hasExcluded(text, profile.internalExcludeKeywords)) return false;
      return true;
    })
    .slice(0, maxInternal);

  return {
    ...ragResult,
    officialReferences,
    internalReviewMaterials,
  };
}
