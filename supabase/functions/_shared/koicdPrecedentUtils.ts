export type KoicdPrecedent = {
  prec_id: string;
  source_url: string;
  case_title: string;
  case_number?: string | null;
  decision_date?: string | null;
  decision_date_raw?: string | null;
  disposition?: string | null;
  court_name?: string | null;
  case_type?: string | null;
  judgment_type?: string | null;
  holdings?: string | null;
  summary?: string | null;
  statutes?: string | null;
  cited_precedents?: string | null;
  full_text?: string | null;
  keywords?: string[];
  insurance_issue_tags?: string[];
  disease_codes?: string[];
  source_area: "precedents";
  source_type: "court_precedent_fulltext";
  source_provider: "koicd";
  provider_prec_id: string;
  trust_level: "legal_reference";
  citation_allowed: boolean;
  official_citation_allowed: boolean;
  review_status: "needs_human_review" | "reviewed" | "rejected";
  content_hash: string;
};

const ISSUE_RULES: Array<[string, RegExp]> = [
  ["고지의무", /(고지의무|계약 전 알릴.?의무|알릴의무|부실고지|고의|중대한 과실)/i],
  ["약관 설명의무", /(설명의무|명시.?설명의무|약관.*설명|중요한 내용|약관규제법)/i],
  ["면책", /(면책|보상하지 않|보험금 지급.*거절|지급거절|부지급|지급제한)/i],
  ["보험금", /(보험금|진단비|입원비|수술비|장해보험금|사망보험금)/i],
  ["실손보험", /(실손|실비|비급여|도수치료|백내장|다초점|입원의 필요성)/i],
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

export function extractDiseaseCodes(text: string): string[] {
  const hits = text.match(/\b[A-Z][0-9]{2}(?:\.[0-9A-Z]{1,3})?\b/g) ?? [];
  return Array.from(new Set(hits));
}

export function detectInsuranceIssueTags(text: string): string[] {
  const tags: string[] = [];
  for (const [tag, re] of ISSUE_RULES) {
    if (re.test(text)) tags.push(tag);
  }
  return Array.from(new Set(tags));
}

export function buildKoicdReferenceLabel(p: KoicdPrecedent): string {
  const court = p.court_name ?? "법원";
  const date = p.decision_date ? p.decision_date.replaceAll("-", ".") : p.decision_date_raw ?? "";
  const num = p.case_number ?? p.prec_id;
  return `${court} ${date} 선고 ${num} ${p.judgment_type ?? "판결"}`.replace(/\s+/g, " ").trim();
}

export function isKoicdOfficialCitationAllowed(p: KoicdPrecedent): boolean {
  return p.citation_allowed === true &&
    p.official_citation_allowed === true &&
    p.review_status === "reviewed";
}
