/**
 * Directly checks the DB row for 2013다208661 and all its fields.
 */
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(process.cwd(), '.env.rag.local') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
  // Search by chunk_id pattern
  const url = `${SUPABASE_URL}/rest/v1/rag_master_chunks?select=id,chunk_id,source_area,source_type,title,summary,chunk_text,keywords,metadata,review_status,trust_level,embedding_status&chunk_id=like.*2013다208661*`;
  const res = await fetch(url, {
    headers: { apikey: KEY, authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) { console.error('HTTP', res.status, await res.text()); process.exit(1); }
  const rows = await res.json();

  if (!rows.length) {
    console.log('No rows found by chunk_id pattern. Trying title search...');
    const url2 = `${SUPABASE_URL}/rest/v1/rag_master_chunks?select=id,chunk_id,source_area,source_type,title,summary,chunk_text,keywords,metadata,review_status,trust_level,embedding_status&title=like.*2013다208661*`;
    const res2 = await fetch(url2, { headers: { apikey: KEY, authorization: `Bearer ${KEY}` } });
    const rows2 = await res2.json();
    rows.push(...rows2);
  }

  console.log(`Found ${rows.length} row(s) matching 2013다208661\n`);

  for (const row of rows) {
    console.log('=== ROW ===');
    console.log(`id: ${row.id}`);
    console.log(`chunk_id: ${row.chunk_id}`);
    console.log(`source_area: ${row.source_area}`);
    console.log(`source_type: ${row.source_type}`);
    console.log(`review_status: ${row.review_status}`);
    console.log(`trust_level: ${row.trust_level}`);
    console.log(`embedding_status: ${row.embedding_status}`);
    console.log(`title (${(row.title || '').length} chars): ${row.title}`);
    console.log(`summary (${(row.summary || '').length} chars): ${(row.summary || '').substring(0, 200)}...`);
    console.log(`chunk_text (${(row.chunk_text || '').length} chars): ${(row.chunk_text || '').substring(0, 200)}...`);
    console.log(`metadata: ${JSON.stringify(row.metadata, null, 2)}`);
    console.log();

    // Check what publicText would do to the summary
    const CHUNK_REF = /\b(?:medical_issue_code|real_case_pattern|real_case_document|issue_playbook|practice_playbook|precedent|fss_latest|terms_raw|fss_dispute_case):[A-Za-z0-9:_-]+\b/g;
    const INTERNAL_ID = /\b(?:RQ|RSF|RCP|RCD|MIC|PIP|RKA|PST|FSS|PREC|PREC_API|FSS_LATEST)[-_]?\d{3,6}\b/g;
    const INTERNAL_SOURCE = /\binternal_[A-Za-z0-9_:-]*\b/g;

    const summaryText = String(row.summary || row.chunk_text || '');
    const processed = summaryText.slice(0, 500)
      .replace(CHUNK_REF, '')
      .replace(INTERNAL_ID, '')
      .replace(INTERNAL_SOURCE, '')
      .replace(/\s+/g, ' ').trim();

    console.log(`publicText(summary || chunk_text).slice(0,500):`);
    console.log(processed.substring(0, 300));
    console.log();

    // Check isAcuteMiPrecedentReference
    const combinedText = [
      row.source_area,
      '판례',
      row.title,
      processed,
      row.metadata?.case_number,
      row.metadata?.court || row.metadata?.court_or_agency,
    ].filter(Boolean).join(' ');

    const acuteMiPattern = /급성심근경색|심근경색|허혈성심장질환|협심증|진단비|심전도|심근효소|troponin|트로포닌|관상동맥|CAG|PCI|I21|I20|I25/i;
    console.log(`isAcuteMiPrecedentReference: ${acuteMiPattern.test(combinedText)}`);

    // Check publicText(metadata.case_number)
    const caseNumber = String(row.metadata?.case_number || '');
    const cleanedCaseNumber = caseNumber
      .replace(CHUNK_REF, '').replace(INTERNAL_ID, '').replace(INTERNAL_SOURCE, '').replace(/\s+/g, ' ').trim();
    console.log(`publicText(metadata.case_number): "${cleanedCaseNumber}"`);
    console.log(`Has 2013다208661: ${cleanedCaseNumber.includes('2013다208661')}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
