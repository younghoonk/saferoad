// 암 세트2 교체: ASSESS_031, 033, 034, 036, 038, 040
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../ai_eval/assessment_cases_100_v1.json');
const raw = fs.readFileSync(filePath, 'utf8');
const data = JSON.parse(raw);
const cases = data.cases || data;

const newCases = [
  {
    id: 'ASSESS_031',
    title: '대장 점막내암(C18) ESD — 일반암 진단비 부지급, 제자리암 주장',
    category: '암/경계성/제자리암 진단비',
    expectedProfile: 'cancer_diagnosis_benefit',
    input: {
      insurerName: '[보험사]',
      insuranceType: '암진단비 (일반암 3000만원 / 제자리암 600만원)',
      contractDate: '2019-07',
      accidentType: '암진단비 청구',
      diagnosisText: 'C18.7 결장의 악성신생물 / D01.0 결장의 제자리암 — 진단서·병리 코드 불일치',
      damageDescription: '피보험자는 2024.04 대장내시경에서 S상결장 1.5cm 측방발육형 종양(LST) 발견, ESD 시행. 절제 병리: tubular adenocarcinoma arising in adenoma, high grade dysplasia 동반, 점막근층(muscularis mucosae) 침범하여 점막고유층 침윤(intramucosal carcinoma), 점막하층 미침범, 절제연 음성. 일부 영역 high grade dysplasia, 일부 영역 점막내 선암. 주치의 진단서 C18.7 기재, 병리 보고서는 intramucosal adenocarcinoma (Tis), high grade dysplasia로 기재.',
      insurerPosition: '보험사는 병리상 점막하층 침범이 없는 점막내암(intramucosal carcinoma)이고 Tis(상피내)에 해당하므로, KCD D01.0(제자리암)으로 분류되어 제자리암 진단비(600만원)만 지급 대상이라는 입장. 대장의 점막내암은 전이 위험이 거의 없어 상피내암에 준하므로 일반암(C코드)으로 볼 수 없다고 주장.',
      customerStatement: '병리에 명백히 adenocarcinoma(선암)로 되어 있고 진단서도 C18.7 대장암인데, 점막에 국한됐다는 이유로 제자리암 취급하는 게 부당합니다. 일반암 진단비를 받아야 합니다.',
      adjusterMemo: '쟁점: 대장 점막내암(intramucosal carcinoma)의 분류 — 일반암(C18)이냐 제자리암(D01)이냐. 보험사는 점막하 미침범·Tis로 제자리암 주장. 핵심: 대장 점막내암의 KCD 분류 논쟁(WHO는 점막내암을 침윤암 전 단계로 보나 KCD/약관 해석은 다를 수 있음), 진단서 C18.7과 병리 adenocarcinoma, 진단확정 기준, 가입 약관의 암/제자리암 정의 검토 필요. 대장은 위와 달리 점막내암의 침윤암 인정 여부가 더 다툼.',
    },
    mustInclude: ['C18', '점막내암', 'intramucosal', 'adenocarcinoma', '병리', '진단확정', '제자리암', '악성', '가입 당시 약관', '작성자 불이익', '지연이자', '서면'],
    mustNotInclude: ['사료됩니다', '생각됩니다', '가능성이 있습니다', '재검토 필요', '[일자 확인]', 'troponin', 'NSTEMI', 'EKG', '심근경색'],
    requiredSections: ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ'],
  },
  {
    id: 'ASSESS_033',
    title: '위 GIST(위장관기질종양) — 행동양식 분쟁, 일반암/경계성 분류',
    category: '암/경계성/제자리암 진단비',
    expectedProfile: 'cancer_diagnosis_benefit',
    input: {
      insurerName: '[보험사]',
      insuranceType: '암진단비 (일반암 4000만원 / 경계성종양 800만원)',
      contractDate: '2017-12',
      accidentType: '암진단비 청구',
      diagnosisText: 'C16.2 위의 악성신생물 / D37.1 위의 행동양식 불명 신생물 — GIST, 코드 불일치',
      damageDescription: '피보험자는 2024.03 상복부 불편감으로 위내시경 및 CT 시행, 위체부 4.5cm 점막하 종괴 확인. 2024.04.15 위부분절제술 시행. 절제 병리: gastrointestinal stromal tumor(GIST), 크기 4.8cm, 유사분열 수(mitotic count) 8/50HPF, c-KIT(CD117) 양성, DOG1 양성, Ki-67 12%. NIH 위험도 분류상 고위험군(high risk). 주치의는 재발 위험으로 이매티닙(글리벡) 보조요법 시작. 진단서 C16.2 기재, 보험사 의료자문은 행동양식 코드 /1(경계성)로 판단하여 D37.1 주장.',
      insurerPosition: '보험사는 GIST의 형태학적 행동양식 코드가 /1(행동양식 불명, 경계성)에 해당하고 KCD D37.1로 분류되므로 경계성종양 진단비(800만원)만 지급 대상이라는 입장. GIST는 ICD-O상 /1 또는 /3 모두 가능하나, 명백한 전이가 없는 한 경계성으로 보아야 한다고 주장.',
      customerStatement: '종양이 4.8cm로 크고 유사분열도 많고 고위험군이라 글리벡 항암치료까지 받는데, 행동양식 코드가 /1이라는 이유로 경계성 취급하는 게 부당합니다. 진단서도 C16.2 위암입니다.',
      adjusterMemo: '쟁점: GIST의 행동양식 분류 — 악성(/3, C16)이냐 경계성(/1, D37)이냐. 보험사는 /1로 경계성 주장. 핵심: GIST는 크기·유사분열수·위험도에 따라 악성도 결정(NIH 고위험군은 악성에 준함), 4.8cm·8/50HPF·고위험군·이매티닙 치료는 악성 입증, ICD-O 행동양식 코드의 의미, 진단서 C16.2, 가입 약관 검토. GIST 행동양식은 크기·분열수로 판단해야지 일률적 /1 적용은 부당.',
    },
    mustInclude: ['C16', 'GIST', '위장관기질종양', '행동양식', '유사분열', '병리', '진단확정', '경계성종양', '악성', '가입 당시 약관', '작성자 불이익', '서면'],
    mustNotInclude: ['사료됩니다', '생각됩니다', '가능성이 있습니다', '재검토 필요', '[일자 확인]', 'troponin', 'NSTEMI', 'EKG', '심근경색'],
    requiredSections: ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ'],
  },
  {
    id: 'ASSESS_034',
    title: '방광 유두상 요로상피암 — 비침습/침습 분쟁, 일반암/제자리암 분류',
    category: '암/경계성/제자리암 진단비',
    expectedProfile: 'cancer_diagnosis_benefit',
    input: {
      insurerName: '[보험사]',
      insuranceType: '암진단비 (일반암 3000만원 / 제자리암 600만원)',
      contractDate: '2020-02',
      accidentType: '암진단비 청구',
      diagnosisText: 'C67.9 방광의 악성신생물 / D09.0 방광의 제자리암 — 요로상피암, 코드 불일치',
      damageDescription: '피보험자는 2024.05 혈뇨로 내원, 방광경 검사상 방광 측벽 2.0cm 유두상 종양 확인. 2024.05.20 경요도방광종양절제술(TURBT) 시행. 절제 병리: papillary urothelial carcinoma, high grade, 고유판(lamina propria) 침윤 확인(T1), 근육층 침범 여부는 표본 한계로 불명확. 일부 영역 carcinoma in situ(CIS) 동반. 주치의는 high grade T1으로 추가 TURBT 및 BCG 방광내 주입요법 권고. 진단서 C67.9 기재, 보험사는 CIS 동반·근육층 미침범을 이유로 D09.0 제자리암 주장.',
      insurerPosition: '보험사는 병리에 carcinoma in situ(CIS) 소견이 있고 근육층 침범이 확인되지 않았으므로, 방광의 비근침윤성 종양으로서 KCD D09.0(제자리암)에 해당하여 제자리암 진단비(600만원)만 지급 대상이라는 입장. 근육층을 침범하지 않은 표재성 방광암은 전이 위험이 낮아 일반암으로 볼 수 없다고 주장.',
      customerStatement: '병리에 high grade이고 고유판 침윤(T1)까지 확인됐고 BCG 치료까지 받는데, CIS가 같이 있다는 이유로 제자리암 600만원만 준다는 게 부당합니다. T1은 명백히 침윤암입니다.',
      adjusterMemo: '쟁점: 방광암의 분류 — 침윤암(C67, T1)이냐 제자리암(D09, CIS)이냐. 보험사는 CIS 동반·근육층 미침범으로 제자리암 주장. 핵심: T1은 고유판 침윤으로 이미 침습성(제자리암 아님), CIS 동반과 별개로 T1 침윤이 확인되면 침윤암, high grade·BCG 치료는 악성 입증, TNM 병기상 T1과 Tis(CIS)의 구분, 진단서 C67.9, 가입 약관 검토 필요.',
    },
    mustInclude: ['C67', '방광암', '요로상피암', '침윤', 'T1', '병리', '진단확정', '제자리암', '악성', '가입 당시 약관', '작성자 불이익', '서면'],
    mustNotInclude: ['사료됩니다', '생각됩니다', '가능성이 있습니다', '재검토 필요', '[일자 확인]', 'troponin', 'NSTEMI', 'EKG', '심근경색'],
    requiredSections: ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ'],
  },
  {
    id: 'ASSESS_036',
    title: '급성 골수성 백혈병(C92.0) — 일반암 진단비, 진단확정 시점 분쟁',
    category: '암/경계성/제자리암 진단비',
    expectedProfile: 'cancer_diagnosis_benefit',
    input: {
      insurerName: '[보험사]',
      insuranceType: '암진단비 (일반암 5000만원, 혈액암 포함)',
      contractDate: '2022-11',
      accidentType: '암진단비 청구',
      diagnosisText: 'C92.0 급성 골수성 백혈병(AML)',
      damageDescription: '피보험자는 2024.06 발열·멍·피로감으로 내원, 말초혈액검사상 백혈구 32,000/µL, 모세포(blast) 38% 확인. 보험 책임개시일 2023.01.15(가입 후 90일 경과). 2024.06.18 골수천자 및 생검 시행, 골수 모세포 45%, 유세포분석상 CD13/CD33/CD117 양성 골수계 마커 확인, 최종진단 급성 골수성 백혈병(AML, C92.0). 염색체검사 정상핵형. 즉시 관해유도 항암화학요법 시작. 보험사는 가입 전 2022.09 검진에서 경미한 빈혈(Hb 11.5) 기록을 근거로 책임개시일 이전 발병 가능성 제기.',
      insurerPosition: '보험사는 가입 전 2022.09 검진 혈액검사에 경미한 빈혈(Hb 11.5) 소견이 있었고 백혈병은 골수 이상이 선행할 수 있으므로, 책임개시일(2023.01.15) 이전에 전구 단계가 시작되었을 가능성을 제기하며 진단확정 시점에 의문을 표하고 지급 보류. 또한 진단확정에 추가 자료 검토가 필요하다는 입장.',
      customerStatement: '2022년 9월 경미한 빈혈은 흔한 소견이고 백혈병과 무관합니다. 실제 AML이 골수검사로 확정된 건 2024년 6월로 책임개시일 한참 후입니다. 발병 시점을 추정으로 앞당기는 것은 부당합니다.',
      adjusterMemo: '쟁점: AML 진단확정 시점 vs 책임개시일. 보험사는 가입 전 경미한 빈혈로 발병 추정. 핵심: 백혈병 진단확정은 골수검사 기준(모세포 45%, AML 확정일 2024.06.18이 책임개시일 2023.01.15 이후), 경미한 빈혈은 AML과 인과 없음(흔한 소견), 발병시점 입증책임은 보험사, 진단확정 기준과 책임개시일 법리. C92.0은 명백한 악성.',
    },
    mustInclude: ['C92', '급성 골수성 백혈병', 'AML', '골수검사', '모세포', '진단확정', '책임개시일', '악성', '가입 당시 약관', '작성자 불이익', '지연이자', '서면'],
    mustNotInclude: ['사료됩니다', '생각됩니다', '가능성이 있습니다', '재검토 필요', '[일자 확인]', 'troponin', 'NSTEMI', 'EKG', '심근경색'],
    requiredSections: ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ'],
  },
  {
    id: 'ASSESS_038',
    title: '호지킨 림프종(C81.1) — 일반암 진단비, 진단확정 방법 분쟁',
    category: '암/경계성/제자리암 진단비',
    expectedProfile: 'cancer_diagnosis_benefit',
    input: {
      insurerName: '[보험사]',
      insuranceType: '암진단비 (일반암 5000만원, 혈액암 포함)',
      contractDate: '2021-06',
      accidentType: '암진단비 청구',
      diagnosisText: 'C81.1 결절성 경화형 호지킨 림프종(nodular sclerosis classical Hodgkin lymphoma)',
      damageDescription: '피보험자는 2024.04 무통성 경부 림프절 종대 및 야간 발한·체중감소(B증상)로 내원, PET-CT상 경부·종격동 다발성 림프절 종대 및 FDG 고섭취 확인. 2024.04.25 경부 림프절 절제생검 시행, 병리 결과 Reed-Sternberg 세포 확인, 면역조직화학 CD30 양성, CD15 양성, CD20 음성, 결절성 경화형 고전적 호지킨 림프종(C81.1) 확정. 골수검사상 침범 없음, 병기 II기. ABVD 항암화학요법 시작. 진단서 C81.1 기재. 보험사는 초기 세침흡인검사(FNA)에서 비특이적이었던 점을 들어 진단확정에 의문 제기.',
      insurerPosition: '보험사는 초기 시행한 세침흡인세포검사(FNA)에서 명확한 악성 소견이 나오지 않았던 점, 그리고 일부 림프종은 반응성 림프절 증식과 감별이 어렵다는 점을 들어, 절제생검 결과만으로 진단을 확정하기에 추가 검토가 필요하다며 지급 보류. 진단확정 자료의 충분성에 의문을 제기.',
      customerStatement: '절제생검에서 Reed-Sternberg 세포가 확인되고 CD30 양성으로 호지킨 림프종이 명확히 확정됐고 항암치료까지 시작했는데, 초기 FNA가 비특이적이었다는 이유로 지급을 보류하는 것은 부당합니다.',
      adjusterMemo: '쟁점: 호지킨 림프종 진단확정 인정 여부. 보험사는 초기 FNA 비특이를 이유로 의문. 핵심: 림프종 진단확정은 절제생검(병리조직검사) 기준이지 FNA가 아님, Reed-Sternberg 세포 + CD30/CD15 양성은 호지킨 확정 소견, FNA는 림프종 진단의 보조수단일 뿐 확정은 절제생검, ABVD 치료 시작은 활동성 악성 입증, 진단서 C81.1, 가입 약관 검토.',
    },
    mustInclude: ['C81', '호지킨 림프종', 'Reed-Sternberg', '절제생검', 'CD30', '진단확정', '병리', '악성', '가입 당시 약관', '작성자 불이익', '지연이자', '서면'],
    mustNotInclude: ['사료됩니다', '생각됩니다', '가능성이 있습니다', '재검토 필요', '[일자 확인]', 'troponin', 'NSTEMI', 'EKG', '심근경색'],
    requiredSections: ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ'],
  },
  {
    id: 'ASSESS_040',
    title: '발덴스트롬 마크로글로불린혈증(C88.0) — 일반암 진단비 부지급, 진단확정 분쟁',
    category: '암/경계성/제자리암 진단비',
    expectedProfile: 'cancer_diagnosis_benefit',
    input: {
      insurerName: '[보험사]',
      insuranceType: '암진단비 (일반암 5000만원, 혈액암 포함)',
      contractDate: '2018-04',
      accidentType: '암진단비 청구',
      diagnosisText: 'C88.0 발덴스트롬 마크로글로불린혈증(Waldenström macroglobulinemia), 림프형질세포림프종',
      damageDescription: '피보험자는 2024.05 만성 피로·빈혈·체중감소로 내원, 혈액검사상 혈청 IgM 단클론성 단백 4,200 mg/dL 현저히 상승, 혈색소 9.2 g/dL 빈혈 확인. 2024.06.10 골수생검 시행, 병리 결과 lymphoplasmacytic lymphoma(림프형질세포림프종) 침윤 확인, 면역조직화학 CD20 양성, MYD88 L265P 변이 양성. 골수 침범 40%. 최종진단 발덴스트롬 마크로글로불린혈증(C88.0). 주치의는 증상 동반 활동성 질환으로 항암화학요법(리툭시맙 기반) 시작. 진단서 KCD C88.0(악성 면역증식성 질환) 기재.',
      insurerPosition: '보험사는 발덴스트롬 마크로글로불린혈증이 진행이 느린 저등급(low-grade) 질환이고, KCD C88.0이 악성 면역증식성 질환으로 분류되나 전형적인 림프종(C82~C85)이나 백혈병(C90~C95)과 달리 경계성 또는 행동양식 불명에 가깝다는 의료자문을 근거로, 일반암(5000만원)이 아닌 소액 또는 경계성 수준 지급 대상이라는 입장. 또한 단클론성 단백 상승만으로는 활동성 악성종양으로 단정할 수 없다고 주장.',
      customerStatement: '골수검사에서 림프형질세포림프종이 명확히 확인됐고 MYD88 변이까지 양성으로 나왔으며 항암치료까지 시작했는데, 진행이 느리다는 이유로 일반암으로 인정 안 한다는 게 부당합니다. KCD C88.0은 명백히 악성 코드입니다.',
      adjusterMemo: '쟁점: C88.0 발덴스트롬 마크로글로불린혈증의 일반암 해당 여부. 보험사 의료자문은 저등급·진행느림으로 경계성 주장. 핵심: C88.0은 KCD상 악성신생물(C코드)로 분류, 골수생검상 lymphoplasmacytic lymphoma 확정 + MYD88 L265P 변이 + 항암치료 시작은 활동성 악성종양 입증, 진행 속도는 악성 여부와 무관(저등급도 악성), 진단확정은 골수 병리검사 기준. WHO 혈액종양 분류, 약관상 암 정의, C88 코드의 악성 분류 검토 필요.',
    },
    mustInclude: ['C88', '발덴스트롬', '마크로글로불린혈증', '림프형질세포림프종', '골수생검', '진단확정', '악성', 'MYD88', '가입 당시 약관', '작성자 불이익', '지연이자', '서면'],
    mustNotInclude: ['사료됩니다', '생각됩니다', '가능성이 있습니다', '재검토 필요', '[일자 확인]', 'troponin', 'NSTEMI', 'EKG', '심근경색'],
    requiredSections: ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ'],
  },
];

const idSet = new Set(newCases.map(c => c.id));
let replaced = 0;
for (let i = 0; i < cases.length; i++) {
  if (idSet.has(cases[i].id)) {
    cases[i] = newCases.find(c => c.id === cases[i].id);
    replaced++;
  }
}

const out = JSON.stringify(data.cases ? data : cases, null, 2);
fs.writeFileSync(filePath, out, 'utf8');
console.log('교체 완료:', replaced, '건');
newCases.forEach(c => {
  const found = cases.find(x => x.id === c.id);
  console.log(' ', c.id, found.expectedProfile,
    '부지급사유:' + found.input.insurerPosition.length + '자',
    found.title.slice(0, 35));
});
