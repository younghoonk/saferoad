#!/usr/bin/env node
const fs = require('fs');
const path = 'ai_eval/assessment_cases_100_v1.json';
const cases = JSON.parse(fs.readFileSync(path, 'utf8'));

const newCases = [
  {
    id: 'ASSESS_051',
    title: '급성 뇌경색(I63) — MRI 급성 병변 불명확, 진단비 부지급',
    category: '뇌혈관질환 진단비',
    expectedProfile: 'brain_diagnosis_benefit',
    input: {
      insurerName: '[보험사]',
      insuranceType: '뇌혈관질환 진단비 (뇌졸중 2000만원)',
      contractDate: '2018-06',
      accidentType: '뇌혈관질환 진단비 청구',
      diagnosisText: 'I63.9 뇌경색증, 좌측 중대뇌동맥 영역 급성 뇌경색',
      damageDescription: '피보험자는 2024.04.10 갑작스러운 우측 위약감과 구음장애로 응급실 내원. 신경학적 검사상 우측 상하지 근력 4/5, 구음장애(dysarthria) 확인. NIHSS 4점. 내원 당시 시행한 확산강조영상(DWI)에서 좌측 중대뇌동맥 영역에 고신호 병변 확인, ADC map상 신호 감소로 급성 허혈성 병변 확정. MRA상 좌측 중대뇌동맥 분지 협착. 주치의는 급성 뇌경색(I63.9)으로 진단, 항혈소판제 및 재활치료 시행. 진단서 I63.9 기재. 보험사는 초기 CT에서 명확한 병변이 안 보였던 점을 들어 진단에 의문 제기.',
      insurerPosition: '보험사는 내원 당시 시행한 뇌 CT에서 명확한 저음영 병변이 확인되지 않았고, 증상이 일과성이었을 가능성이 있어 일과성 허혈발작(TIA)에 해당할 수 있으므로 뇌경색(I63)으로 단정하기 어렵다는 입장. DWI 고신호만으로는 확정적 뇌경색으로 보기 부족하다며 지급 보류.',
      customerStatement: '확산강조영상(DWI)에서 분명히 급성 뇌경색 병변이 확인됐고 신경학적 증상도 지속되어 재활치료까지 받고 있는데, CT에 안 보였다는 이유로 지급을 보류하는 것은 부당합니다.',
      adjusterMemo: '쟁점: 뇌경색 진단확정 — DWI 급성 병변 vs CT 미확인. 보험사는 CT 음성 TIA 가능성 주장. 핵심: 급성 뇌경색 진단의 표준은 DWI/MRI(CT는 초기 음성이 흔함), DWI 고신호+ADC 감소는 급성 허혈 확정 소견, NIHSS 4점 지속 신경결손은 TIA(24시간 내 완전 회복)와 구분됨, I63 진단서. 뇌졸중 진단기준(영상+신경결손), 가입 약관 검토.',
    },
    mustInclude: ['I63', '뇌경색', 'DWI', '확산강조영상', '진단확정', '신경학적', '급성', '허혈', '가입 당시 약관', '작성자 불이익', '지연이자', '서면'],
    mustNotInclude: ['사료됩니다', '생각됩니다', '가능성이 있습니다', '재검토 필요', '[일자 확인]', 'troponin', 'NSTEMI', 'EKG', '심근경색', 'C50', 'DCIS', '병리조직검사', 'microinvasion'],
    requiredSections: ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ'],
  },
  {
    id: 'ASSESS_052',
    title: '뇌경색 vs 일과성뇌허혈(TIA) — 진단명 분쟁, 영구적 경색 입증',
    category: '뇌혈관질환 진단비',
    expectedProfile: 'brain_diagnosis_benefit',
    input: {
      insurerName: '[보험사]',
      insuranceType: '뇌혈관질환 진단비 (뇌졸중 3000만원, TIA 제외)',
      contractDate: '2020-01',
      accidentType: '뇌혈관질환 진단비 청구',
      diagnosisText: 'I63.5 대뇌동맥 폐색에 의한 뇌경색, 우측 후대뇌동맥 영역',
      damageDescription: '피보험자는 2024.05.02 좌측 시야장애와 어지럼으로 내원. 증상은 약 6시간 지속 후 부분 호전. DWI에서 우측 후두엽(후대뇌동맥 영역) 1.2cm 급성 경색 병변 확인, 추적 MRI(2주 후)에서 동일 부위 뇌연화증(encephalomalacia) 변화로 영구적 경색 확정. 신경학적으로 좌측 동측 반맹(homonymous hemianopia) 잔존. 주치의 I63.5 진단. 보험사는 증상이 일부 호전된 점을 들어 TIA 주장하며 부지급.',
      insurerPosition: '보험사는 피보험자의 증상이 발생 후 부분적으로 호전되었고, 일과성 신경학적 증상은 일과성 허혈발작(TIA)의 특징이므로 약관상 보장 대상인 뇌졸중(뇌경색)이 아니라 보장 제외 대상인 TIA에 해당한다고 주장하며 부지급.',
      customerStatement: '증상이 일부 호전됐어도 MRI에 영구적인 뇌경색 병변과 뇌연화증이 남아있고 시야장애도 계속되는데, 호전됐다고 TIA로 처리하는 것은 부당합니다.',
      adjusterMemo: '쟁점: 뇌경색(I63) vs TIA. 보험사는 증상 호전으로 TIA 주장. 핵심: TIA는 영상상 경색 병변 없이 24시간 내 완전 회복(조직 손상 없음)이 정의, 본 건은 DWI 급성 병변+추적 MRI 뇌연화증(영구 조직손상)+동측 반맹 잔존으로 명백한 뇌경색, 증상 부분호전은 TIA 근거 안 됨(영구 병변이 결정적), I63.5 진단서. 뇌졸중/TIA 감별기준, 약관 검토.',
    },
    mustInclude: ['I63', '뇌경색', 'TIA', '일과성', 'DWI', '뇌연화증', '진단확정', '영구', '가입 당시 약관', '작성자 불이익', '지연이자', '서면'],
    mustNotInclude: ['사료됩니다', '생각됩니다', '가능성이 있습니다', '재검토 필요', '[일자 확인]', 'troponin', 'NSTEMI', 'EKG', '심근경색', 'C50', 'DCIS', '병리조직검사'],
    requiredSections: ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ'],
  },
  {
    id: 'ASSESS_053',
    title: '열공성 뇌경색(I63.8) — 경미함 이유 부지급, 뇌졸중 인정 분쟁',
    category: '뇌혈관질환 진단비',
    expectedProfile: 'brain_diagnosis_benefit',
    input: {
      insurerName: '[보험사]',
      insuranceType: '뇌혈관질환 진단비 (뇌졸중 2000만원)',
      contractDate: '2017-09',
      accidentType: '뇌혈관질환 진단비 청구',
      diagnosisText: 'I63.8 기타 뇌경색증, 좌측 기저핵 열공성 경색(lacunar infarction)',
      damageDescription: '피보험자는 2024.03.20 우측 손 미세운동 장애와 경미한 구음장애로 내원. DWI에서 좌측 기저핵(basal ganglia)에 0.8cm 열공성 급성 경색(lacunar infarct) 확인. 고혈압 기왕력 있음. 주치의는 소혈관 폐색에 의한 열공성 뇌경색(I63.8)으로 진단, 항혈소판제 투여 및 위험인자 관리. 진단서 I63.8 기재. 보험사는 병변이 작고 증상이 경미하다는 이유로 뇌졸중 진단비 부지급, 단순 소혈관질환 주장.',
      insurerPosition: '보험사는 병변 크기가 0.8cm로 작은 열공성 경색이고 신경학적 증상이 경미하여 일상생활에 큰 지장이 없으므로, 약관에서 정한 뇌졸중의 중증도에 이르지 못한 단순 소혈관질환에 해당한다며 뇌졸중 진단비 부지급.',
      customerStatement: '병변이 작아도 명백히 DWI에 급성 뇌경색으로 확인됐고 진단서도 I63으로 나왔는데, 증상이 경미하다는 이유로 뇌졸중이 아니라는 것은 부당합니다.',
      adjusterMemo: '쟁점: 열공성 뇌경색의 뇌졸중 해당 여부. 보험사는 병변 작음·경증으로 부지급. 핵심: 열공성 경색도 KCD상 I63(뇌경색)으로 명백한 뇌졸중, 약관의 뇌졸중 정의는 영상상 경색 확인이지 중증도·크기 기준이 아님, DWI 급성 병변 확정, 병변 크기는 진단비 지급요건과 무관, I63.8 진단서. 뇌졸중 진단기준, 약관에 없는 중증도 요건 추가 금지.',
    },
    mustInclude: ['I63', '열공성', '뇌경색', 'lacunar', 'DWI', '진단확정', '뇌졸중', '급성', '가입 당시 약관', '작성자 불이익', '지연이자', '서면'],
    mustNotInclude: ['사료됩니다', '생각됩니다', '가능성이 있습니다', '재검토 필요', '[일자 확인]', 'troponin', 'NSTEMI', 'EKG', '심근경색', 'C50', 'DCIS', '병리조직검사'],
    requiredSections: ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ'],
  },
  {
    id: 'ASSESS_054',
    title: '뇌내출혈(I61) — 외상성 출혈 주장으로 질병 진단비 부지급',
    category: '뇌혈관질환 진단비',
    expectedProfile: 'brain_diagnosis_benefit',
    input: {
      insurerName: '[보험사]',
      insuranceType: '뇌혈관질환 진단비 (뇌출혈 3000만원, 질병 한정)',
      contractDate: '2019-11',
      accidentType: '뇌혈관질환 진단비 청구',
      diagnosisText: 'I61.0 대뇌반구의 뇌내출혈, 피질하 출혈',
      damageDescription: '피보험자는 2024.04.15 두통과 좌측 위약감으로 내원, 뇌 CT에서 우측 기저핵-시상 부위 3.5cm 뇌내출혈 확인. 고혈압 기왕력(수년간 약물치료) 있음. 입원 당시 외상 흔적 없음, 낙상 병력 없음. 신경외과는 고혈압성 뇌내출혈(hypertensive ICH)로 진단. 주치의 I61.0 기재. 보험사는 출혈 부위와 무관하게 외상 가능성 배제 불충분을 이유로 질병성 뇌출혈 인정 보류.',
      insurerPosition: '보험사는 뇌내출혈이 외상에 의해서도 발생할 수 있고 피보험자의 외상 여부가 의무기록상 명확히 배제되지 않았다는 이유로, 질병으로 인한 뇌출혈(I61)임이 충분히 입증되지 않았다며 질병 뇌혈관질환 진단비 지급을 보류.',
      customerStatement: '외상도 없었고 낙상한 적도 없으며 수년간 고혈압 치료를 받아왔는데, 외상 가능성을 배제 못 했다는 이유로 지급을 보류하는 것은 부당합니다. 명백한 고혈압성 뇌출혈입니다.',
      adjusterMemo: '쟁점: 뇌내출혈의 질병성 vs 외상성. 보험사는 외상 배제 불충분 주장. 핵심: 출혈 위치(기저핵-시상)는 고혈압성 뇌출혈의 전형적 호발 부위(외상성은 주로 피질/경막), 고혈압 기왕력+외상 흔적 없음+낙상 병력 없음은 질병성 입증, 외상성 배제 입증책임은 보험사, I61.0 진단서 신경외과 고혈압성 ICH 진단. 뇌출혈 질병성 판단기준, 약관 검토.',
    },
    mustInclude: ['I61', '뇌내출혈', '뇌출혈', '고혈압성', '기저핵', '진단확정', '질병', '외상', '가입 당시 약관', '작성자 불이익', '지연이자', '서면'],
    mustNotInclude: ['사료됩니다', '생각됩니다', '가능성이 있습니다', '재검토 필요', '[일자 확인]', 'troponin', 'NSTEMI', 'EKG', '심근경색', 'C50', 'DCIS', '병리조직검사'],
    requiredSections: ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ'],
  },
  {
    id: 'ASSESS_055',
    title: '지주막하출혈(I60) — 동맥류 파열, 책임개시일 전후 분쟁',
    category: '뇌혈관질환 진단비',
    expectedProfile: 'brain_diagnosis_benefit',
    input: {
      insurerName: '[보험사]',
      insuranceType: '뇌혈관질환 진단비 (뇌졸중 3000만원)',
      contractDate: '2023-12',
      accidentType: '뇌혈관질환 진단비 청구',
      diagnosisText: 'I60.7 두개내동맥의 지주막하출혈, 전교통동맥류 파열',
      damageDescription: '피보험자는 2024.03.18 갑작스러운 심한 두통(thunderclap headache)과 구토로 응급실 내원. 뇌 CT에서 기저수조 지주막하출혈(SAH) 확인, CT 혈관조영술(CTA)에서 전교통동맥류(7mm) 파열 확인. 책임개시일 2024.01.10. 즉시 코일색전술 시행. 주치의 I60.7 진단. 보험사는 가입 전 2023.10 두통으로 신경과 외래 기록을 근거로 동맥류가 책임개시일 이전 존재했다며 면책 주장.',
      insurerPosition: '보험사는 가입 전 2023.10 두통으로 신경과 진료받은 기록이 있고 뇌동맥류는 선천적/장기간에 걸쳐 형성되므로 책임개시일(2024.01.10) 이전에 이미 동맥류가 존재했을 것이라며, 뇌혈관질환의 발생이 책임개시일 이전이라는 이유로 면책 주장.',
      customerStatement: '2023년 10월 두통은 단순 긴장성 두통이었고 당시 동맥류 진단은 없었습니다. 실제 지주막하출혈은 책임개시일 이후인 2024년 3월에 발생했는데, 동맥류가 미리 있었을 거라는 추정으로 면책하는 것은 부당합니다.',
      adjusterMemo: '쟁점: 지주막하출혈 발생 시점 vs 책임개시일. 보험사는 동맥류 기존 존재로 면책 주장. 핵심: 보험사고는 동맥류 존재가 아니라 지주막하출혈(파열) 발생이고 파열일(2024.03.18)이 책임개시일(2024.01.10) 이후, 미파열 동맥류는 보험사고 아님(파열이 사고), 가입 전 두통은 동맥류 진단 아님, 발생시점 입증책임은 보험사, I60.7 진단서. 뇌졸중 발생시점 법리, 약관 검토.',
    },
    mustInclude: ['I60', '지주막하출혈', '동맥류', '파열', '진단확정', '책임개시일', '뇌졸중', 'CTA', '가입 당시 약관', '작성자 불이익', '지연이자', '서면'],
    mustNotInclude: ['사료됩니다', '생각됩니다', '가능성이 있습니다', '재검토 필요', '[일자 확인]', 'troponin', 'NSTEMI', 'EKG', '심근경색', 'C50', 'DCIS', '병리조직검사'],
    requiredSections: ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ'],
  },
  {
    id: 'ASSESS_056',
    title: '미파열 뇌동맥류(I67.1) — 뇌혈관질환 진단비 해당 여부 분쟁',
    category: '뇌혈관질환 진단비',
    expectedProfile: 'brain_diagnosis_benefit',
    input: {
      insurerName: '[보험사]',
      insuranceType: '뇌혈관질환 진단비 (뇌혈관질환 1500만원, I60~I69)',
      contractDate: '2016-04',
      accidentType: '뇌혈관질환 진단비 청구',
      diagnosisText: 'I67.1 대뇌동맥류(비파열), 좌측 중대뇌동맥 분지부 동맥류',
      damageDescription: '피보험자는 2024.02 두통 정밀검사 중 뇌 MRA에서 좌측 중대뇌동맥 분지부 6mm 비파열 뇌동맥류 발견. 파열 위험으로 2024.03.05 코일색전술(coil embolization) 시행. 주치의는 대뇌동맥류(I67.1)로 진단. 진단서 I67.1 기재. 보험사는 약관상 뇌혈관질환 보장범위(I60~I69)에 I67.1이 포함됨에도, 출혈/경색이 없는 미파열 동맥류는 질병으로 인한 뇌혈관질환의 실질이 아니라며 부지급.',
      insurerPosition: '보험사는 약관상 뇌혈관질환 분류표에 I67.1이 포함되어 있으나, 미파열 뇌동맥류는 출혈이나 경색 등 실질적 뇌혈관 손상이 발생하지 않은 상태이므로 약관이 보장하는 뇌혈관질환의 취지에 부합하지 않는다며 뇌혈관질환 진단비 부지급.',
      customerStatement: '약관 분류표에 I67.1이 분명히 뇌혈관질환으로 포함되어 있고 코일색전술까지 받았는데, 파열이 안 됐다는 이유로 보장 안 한다는 것은 약관과 다릅니다.',
      adjusterMemo: '쟁점: 미파열 뇌동맥류(I67.1)의 뇌혈관질환 진단비 해당 여부. 보험사는 출혈/경색 없음으로 부지급. 핵심: 약관 뇌혈관질환 분류표(I60~I69)에 I67.1 명시 포함, 약관에 I67.1 제외 또는 파열 필수 조항 없으면 분류표대로 지급, 진단서 I67.1+코일색전술 시행, 약관에 없는 실질적 손상 요건 사후 추가 금지, 작성자 불이익. 약관 분류표 해석, 가입 당시 약관 검토.',
    },
    mustInclude: ['I67', '뇌동맥류', '미파열', '코일색전술', '진단확정', '뇌혈관질환', '분류표', '가입 당시 약관', '작성자 불이익', '지연이자', '서면'],
    mustNotInclude: ['사료됩니다', '생각됩니다', '가능성이 있습니다', '재검토 필요', '[일자 확인]', 'troponin', 'NSTEMI', 'EKG', '심근경색', 'C50', 'DCIS', '병리조직검사'],
    requiredSections: ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ'],
  },
];

const targetIds = new Set(['ASSESS_051', 'ASSESS_052', 'ASSESS_053', 'ASSESS_054', 'ASSESS_055', 'ASSESS_056']);
const newCasesMap = Object.fromEntries(newCases.map((c) => [c.id, c]));

const updated = cases.map((c) => (targetIds.has(c.id) ? newCasesMap[c.id] : c));

// 검증
const check = updated.filter((c) => targetIds.has(c.id));
console.log('교체 확인:');
check.forEach((c) => console.log(`  ${c.id} | ${c.category} | ${c.expectedProfile}`));
console.log(`총 케이스 수: ${updated.length}`);

fs.writeFileSync(path, JSON.stringify(updated, null, 2), 'utf8');
console.log('저장 완료:', path);
