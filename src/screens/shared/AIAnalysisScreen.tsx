import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  Alert,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { Header } from '../../components/Header';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Colors } from '../../constants';
import { analyzeDocuments, generateCounterDocument, AnalysisResult, ImagePayload } from '../../lib/openaiApi';
import {
  createAssessmentDraft,
  formatAssessmentDraftResult,
  AssessmentDraftInput,
  AssessmentDraftResult,
  AssessmentDraftTone,
} from '../../lib/assessmentDraftApi';
import {
  createClosingReport,
  formatClosingReportResult,
  ClosingFinalOpinion,
  ClosingReportInput,
  ClosingReportResult,
  ClosingReportType,
} from '../../lib/closingReportApi';

interface AIAnalysisScreenProps {
  onBack: () => void;
  initialMode?: Mode;
}

type Mode = 'denial-analysis' | 'assessment-draft' | 'closing-report';
type AnalysisStep = 'upload' | 'analyzing' | 'result' | 'counter-doc';
type UploadGroup = 'denial' | 'customer' | 'hospital' | 'insurer' | 'other';

interface SelectedImage extends ImagePayload {
  id: string;
  size: number;
  uri: string;
  name: string;
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGES_PER_GROUP = 5;
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;
const AI_NOTICE = 'AI 결과는 참고용 초안입니다. 최종 제출 전 손해사정사의 검토가 필요하며, 개인정보와 민감정보 입력은 최소화해 주세요. 원본 이미지는 이번 단계에서 DB에 저장하지 않습니다.';

const initialDraftInput: AssessmentDraftInput = {
  caseTitle: '',
  accidentType: '',
  accidentDate: '',
  accidentLocation: '',
  damageDetails: '',
  insurerPosition: '',
  customerStatement: '',
  adjusterMemo: '',
  tone: 'professional',
  retrievedReferences: [],
};

const initialClosingInput: ClosingReportInput = {
  reportType: 'final',
  insurerName: '',
  caseInfo: {},
  adjusterMemo: '',
  finalOpinion: 'investigate',
  hospitalDocuments: [],
  insurerDocuments: [],
  otherDocuments: [],
};

const toneOptions: { value: AssessmentDraftTone; label: string }[] = [
  { value: 'concise', label: '간결' },
  { value: 'professional', label: '전문적' },
  { value: 'detailed', label: '상세' },
];

const reportTypeOptions: { value: ClosingReportType; label: string }[] = [
  { value: 'interim', label: '중간보고서' },
  { value: 'final', label: '종결보고서' },
];

const finalOpinionOptions: { value: ClosingFinalOpinion; label: string }[] = [
  { value: 'pay', label: '지급' },
  { value: 'deny', label: '부지급' },
  { value: 'partial', label: '일부지급' },
  { value: 'investigate', label: '추가조사 필요' },
];

export function AIAnalysisScreen({ onBack, initialMode = 'denial-analysis' }: AIAnalysisScreenProps) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [analysisStep, setAnalysisStep] = useState<AnalysisStep>('upload');
  const [denialImages, setDenialImages] = useState<SelectedImage[]>([]);
  const [customerImages, setCustomerImages] = useState<SelectedImage[]>([]);
  const [hospitalImages, setHospitalImages] = useState<SelectedImage[]>([]);
  const [insurerImages, setInsurerImages] = useState<SelectedImage[]>([]);
  const [otherImages, setOtherImages] = useState<SelectedImage[]>([]);
  const [progress, setProgress] = useState(0);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [counterDoc, setCounterDoc] = useState<string | null>(null);
  const [generatingDoc, setGeneratingDoc] = useState(false);
  const [draftInput, setDraftInput] = useState<AssessmentDraftInput>(initialDraftInput);
  const [draftResult, setDraftResult] = useState<AssessmentDraftResult | null>(null);
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [closingInput, setClosingInput] = useState<ClosingReportInput>(initialClosingInput);
  const [closingResult, setClosingResult] = useState<ClosingReportResult | null>(null);
  const [generatingClosing, setGeneratingClosing] = useState(false);
  const [copied, setCopied] = useState(false);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const analysisBytes = [...denialImages, ...customerImages].reduce((sum, image) => sum + image.size, 0);
  const closingBytes = [...hospitalImages, ...insurerImages, ...otherImages].reduce((sum, image) => sum + image.size, 0);
  const canAnalyze = denialImages.length + customerImages.length > 0;
  const canCreateClosing = hospitalImages.length + insurerImages.length + otherImages.length > 0 || Boolean(closingInput.adjusterMemo?.trim());

  const getImages = (group: UploadGroup) => {
    if (group === 'denial') return denialImages;
    if (group === 'customer') return customerImages;
    if (group === 'hospital') return hospitalImages;
    if (group === 'insurer') return insurerImages;
    return otherImages;
  };

  const setImages = (group: UploadGroup, updater: (prev: SelectedImage[]) => SelectedImage[]) => {
    if (group === 'denial') setDenialImages(updater);
    else if (group === 'customer') setCustomerImages(updater);
    else if (group === 'hospital') setHospitalImages(updater);
    else if (group === 'insurer') setInsurerImages(updater);
    else setOtherImages(updater);
  };

  const contextBytes = (group: UploadGroup) => (
    group === 'denial' || group === 'customer' ? analysisBytes : closingBytes
  );

  const pickImages = async (group: UploadGroup) => {
    const existing = getImages(group);
    const remaining = MAX_IMAGES_PER_GROUP - existing.length;
    if (remaining <= 0) {
      Alert.alert('업로드 제한', `각 영역은 최대 ${MAX_IMAGES_PER_GROUP}장까지 업로드할 수 있습니다.`);
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('권한 필요', '이미지를 선택하려면 사진 접근 권한이 필요합니다.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      base64: true,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
    });
    if (result.canceled) return;

    const selected: SelectedImage[] = [];
    for (const [index, asset] of result.assets.entries()) {
      if (!asset.base64) continue;
      const size = asset.fileSize ?? Math.ceil((asset.base64.length * 3) / 4);
      if (size > MAX_IMAGE_BYTES) {
        Alert.alert('파일 제한', '8MB를 초과한 이미지는 제외되었습니다.');
        continue;
      }
      selected.push({
        id: `${group}-${Date.now()}-${index}-${asset.uri}`,
        name: asset.fileName ?? `${groupLabel(group)} ${existing.length + index + 1}`,
        size,
        uri: asset.uri,
        mimeType: asset.mimeType ?? 'image/jpeg',
        base64: asset.base64,
      });
    }
    if (!selected.length) return;
    const nextTotal = contextBytes(group) + selected.reduce((sum, image) => sum + image.size, 0);
    if (nextTotal > MAX_TOTAL_BYTES) {
      Alert.alert('전체 용량 제한', '전체 업로드 용량은 24MB 이하로 제한됩니다.');
      return;
    }
    setImages(group, (prev) => [...prev, ...selected].slice(0, MAX_IMAGES_PER_GROUP));
  };

  const removeImage = (group: UploadGroup, id: string) => {
    setImages(group, (prev) => prev.filter((image) => image.id !== id));
  };

  const setDraftField = <K extends keyof AssessmentDraftInput>(key: K, value: AssessmentDraftInput[K]) => {
    setDraftInput((prev) => ({ ...prev, [key]: value }));
  };

  const setClosingCaseField = (key: keyof ClosingReportInput['caseInfo'], value: string) => {
    setClosingInput((prev) => ({
      ...prev,
      caseInfo: { ...prev.caseInfo, [key]: value },
    }));
  };

  const startFakeProgress = () => {
    setProgress(0);
    let nextProgress = 0;
    progressRef.current = setInterval(() => {
      nextProgress += Math.random() * 8;
      if (nextProgress >= 90 && progressRef.current) {
        clearInterval(progressRef.current);
        nextProgress = 90;
      }
      setProgress(Math.min(nextProgress, 90));
    }, 400);
  };

  const finishProgress = () => {
    if (progressRef.current) clearInterval(progressRef.current);
    setProgress(100);
  };

  const startAnalysis = async () => {
    if (!canAnalyze) return;
    setAnalysisStep('analyzing');
    startFakeProgress();
    try {
      const result = await analyzeDocuments({
        denialDocuments: denialImages.map(toPayload),
        customerDocuments: customerImages.map(toPayload),
      });
      finishProgress();
      setAnalysisResult(result);
      setTimeout(() => setAnalysisStep('result'), 600);
    } catch (err: unknown) {
      if (progressRef.current) clearInterval(progressRef.current);
      setAnalysisStep('upload');
      Alert.alert('분석 실패', err instanceof Error ? err.message : '분석 중 오류가 발생했습니다.');
    }
  };

  const handleGenerateCounterDoc = async () => {
    if (!analysisResult) return;
    setGeneratingDoc(true);
    try {
      const doc = await generateCounterDocument(analysisResult);
      setCounterDoc(doc);
      setAnalysisStep('counter-doc');
    } catch (err: unknown) {
      Alert.alert('생성 실패', err instanceof Error ? err.message : '공문 생성 중 오류가 발생했습니다.');
    } finally {
      setGeneratingDoc(false);
    }
  };

  const handleUseAnalysisForDraft = () => {
    if (!analysisResult) return;
    const structured = analysisResult.structuredData;
    const denialReason = structured?.denialReason || analysisResult.denial_reasons?.join('\n') || '';
    const insurerPosition = structured?.insurerPosition
      || [analysisResult.summary, denialReason ? `면책 사유: ${denialReason}` : ''].filter(Boolean).join('\n\n');
    const keyIssues = structured?.keyIssues?.length
      ? structured.keyIssues
      : [...(analysisResult.weak_points ?? []), ...(analysisResult.counter_arguments ?? []).map((item) => item.point)];
    const requiredAdditionalChecks = structured?.requiredAdditionalChecks?.length
      ? structured.requiredAdditionalChecks
      : [analysisResult.recommended_action].filter(Boolean);
    const supportingFacts = structured?.draftSupportingFacts?.length
      ? structured.draftSupportingFacts
      : analysisResult.draft_supporting_facts ?? [];
    const damageSummary = [
      structured?.customerMedicalSummary,
      structured?.diagnosisSummary ? `진단/상병: ${structured.diagnosisSummary}` : '',
      structured?.testResultSummary ? `검사결과: ${structured.testResultSummary}` : '',
      structured?.treatmentSummary ? `치료/입퇴원: ${structured.treatmentSummary}` : '',
      structured?.damageEvidenceSummary ? `손해 입증자료: ${structured.damageEvidenceSummary}` : '',
      supportingFacts.length ? `핵심 근거:\n${supportingFacts.map((item) => `- ${item}`).join('\n')}` : '',
    ].filter(Boolean).join('\n\n');

    setDraftInput((prev) => ({
      ...prev,
      caseTitle: prev.caseTitle || '면책공문 및 고객자료 분석 기반 사정서 초안',
      accidentType: prev.accidentType || structured?.accidentTypeGuess || '',
      damageDetails: prev.damageDetails || damageSummary,
      insurerPosition: insurerPosition || prev.insurerPosition,
      customerStatement: prev.customerStatement || structured?.customerClaimSummary || analysisResult.customer_document_summary || '',
      adjusterMemo: [
        prev.adjusterMemo,
        keyIssues.length ? `주요 쟁점\n${keyIssues.map((item) => `- ${item}`).join('\n')}` : '',
        requiredAdditionalChecks.length ? `추가 확인 필요\n${requiredAdditionalChecks.map((item) => `- ${item}`).join('\n')}` : '',
      ].filter(Boolean).join('\n\n'),
      sourceAnalysis: {
        summary: analysisResult.summary,
        insurerPosition,
        denialReason,
        keyIssues,
        requiredAdditionalChecks,
        customerMedicalSummary: structured?.customerMedicalSummary || analysisResult.customer_document_summary,
        diagnosisSummary: structured?.diagnosisSummary,
        testResultSummary: structured?.testResultSummary,
        treatmentSummary: structured?.treatmentSummary,
        damageEvidenceSummary: structured?.damageEvidenceSummary,
        draftSupportingFacts: supportingFacts,
      },
    }));
    setDraftResult(null);
    setMode('assessment-draft');
  };

  const handleGenerateDraft = async () => {
    setGeneratingDraft(true);
    try {
      const result = await createAssessmentDraft(draftInput);
      setDraftResult(result);
    } catch (err: unknown) {
      Alert.alert('초안 생성 실패', err instanceof Error ? err.message : '사정서 초안 생성 중 오류가 발생했습니다.');
    } finally {
      setGeneratingDraft(false);
    }
  };

  const handleGenerateClosingReport = async () => {
    setGeneratingClosing(true);
    try {
      const result = await createClosingReport({
        ...closingInput,
        hospitalDocuments: hospitalImages.map(toPayload),
        insurerDocuments: insurerImages.map(toPayload),
        otherDocuments: otherImages.map(toPayload),
      });
      setClosingResult(result);
    } catch (err: unknown) {
      Alert.alert('종결보고서 생성 실패', err instanceof Error ? err.message : '종결보고서 생성 중 오류가 발생했습니다.');
    } finally {
      setGeneratingClosing(false);
    }
  };

  const handleCopy = async (text?: string | null) => {
    if (!text) return;
    await Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const resetAnalysis = () => {
    setAnalysisStep('upload');
    setDenialImages([]);
    setCustomerImages([]);
    setProgress(0);
    setAnalysisResult(null);
    setCounterDoc(null);
  };

  const renderModeTabs = () => (
    <View style={styles.modeTabs}>
      <ModeTab
        label="면책공문 분석"
        icon="document-text-outline"
        active={mode === 'denial-analysis'}
        onPress={() => setMode('denial-analysis')}
      />
      <ModeTab
        label="AI 사정서 초안"
        icon="create-outline"
        active={mode === 'assessment-draft'}
        onPress={() => setMode('assessment-draft')}
      />
      <ModeTab
        label="종결보고서 작성"
        icon="clipboard-outline"
        active={mode === 'closing-report'}
        onPress={() => setMode('closing-report')}
      />
    </View>
  );

  const renderNotice = () => (
    <View style={styles.noticeBox}>
      <Ionicons name="shield-checkmark-outline" size={16} color={Colors.primary} />
      <Text style={styles.noticeText}>{AI_NOTICE}</Text>
    </View>
  );

  const renderUpload = () => (
    <View style={styles.section}>
      <Hero title="AI 자료 분석" subtitle="면책공문과 고객 의학/손해자료 이미지를 함께 분석합니다. PDF는 아직 지원하지 않습니다." icon="sparkles" />
      <UploadSection
        title="보험사 면책공문 / 안내문"
        description="보험사 주장, 면책 사유, 거절 사유 중심으로 분석합니다."
        images={denialImages}
        countLabel={`${denialImages.length}/${MAX_IMAGES_PER_GROUP}`}
        onPick={() => pickImages('denial')}
        onRemove={(id) => removeImage('denial', id)}
      />
      <UploadSection
        title="고객 의학자료 / 손해자료"
        description="진단서, 소견서, 검사결과지, 진료기록, 입퇴원확인서 등을 분석합니다."
        images={customerImages}
        countLabel={`${customerImages.length}/${MAX_IMAGES_PER_GROUP}`}
        onPick={() => pickImages('customer')}
        onRemove={(id) => removeImage('customer', id)}
      />
      <Text style={styles.limitText}>각 이미지는 8MB 이하, 전체 업로드 용량은 24MB 이하로 제한됩니다.</Text>
      {renderNotice()}
      <Button title="면책공문 및 고객자료 분석하기" onPress={startAnalysis} disabled={!canAnalyze} size="lg" style={styles.primaryBtn} />
    </View>
  );

  const renderAnalyzing = () => (
    <View style={[styles.section, styles.center]}>
      <View style={styles.analyzingCard}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.analyzingTitle}>AI가 자료를 분석 중입니다</Text>
        <Text style={styles.analyzingDesc}>보험사 주장과 고객 의학/손해자료를 함께 검토하고 있습니다.</Text>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${progress}%` as any }]} />
        </View>
        <Text style={styles.progressText}>{Math.round(progress)}%</Text>
      </View>
    </View>
  );

  const renderAnalysisResult = () => {
    if (!analysisResult) return null;
    const structured = analysisResult.structuredData;
    return (
      <View style={styles.section}>
        <Hero title="분석 완료" subtitle={`면책공문 ${denialImages.length}장, 고객자료 ${customerImages.length}장 분석`} icon="checkmark-circle" success />
        <ResultCard title="보험사 주장 요약" body={structured?.insurerPosition || analysisResult.summary} />
        <ResultCard title="면책 사유" body={structured?.denialReason} />
        <ListCard title="주요 쟁점" items={structured?.keyIssues ?? analysisResult.weak_points} color={Colors.warning} />
        <ResultCard title="고객 자료 요약" body={structured?.customerMedicalSummary || analysisResult.customer_document_summary} />
        <ResultCard title="진단/소견 요약" body={structured?.diagnosisSummary} />
        <ResultCard title="검사 결과 요약" body={structured?.testResultSummary} />
        <ResultCard title="치료/입퇴원 요약" body={structured?.treatmentSummary} />
        <ResultCard title="손해 자료 요약" body={structured?.damageEvidenceSummary} />
        <ListCard title="사정서에 반영할 핵심 근거" items={structured?.draftSupportingFacts ?? analysisResult.draft_supporting_facts} color={Colors.primary} />
        <ListCard title="추가 확인 필요 사항" items={structured?.requiredAdditionalChecks} color={Colors.danger} />
        <ListCard title="관련 법령/약관" items={analysisResult.relevant_laws} color={Colors.primary} />
        <ListCard title="관련 판례/결정례" items={analysisResult.precedents} color={Colors.accent} />
        <ResultCard title="권고 조치" body={analysisResult.recommended_action} />
        {renderNotice()}
        <Button title="이 분석 결과로 사정서 초안 작성" onPress={handleUseAnalysisForDraft} size="lg" style={styles.primaryBtn} />
        <Button title="종결보고서 작성" onPress={() => setMode('closing-report')} size="lg" style={styles.emphasisBtn} />
        <Button
          title={generatingDoc ? '공문 생성 중...' : '반박 공문 자동 생성'}
          onPress={handleGenerateCounterDoc}
          disabled={generatingDoc}
          size="lg"
          style={styles.primaryBtn}
        />
        {generatingDoc && <ActivityIndicator color={Colors.primary} style={{ marginTop: 8 }} />}
        <Button title="다시 분석하기" onPress={resetAnalysis} variant="outline" size="lg" />
      </View>
    );
  };

  const renderCounterDoc = () => (
    <View style={styles.section}>
      <Hero title="반박 공문 생성 완료" subtitle="아래 공문을 복사해 검토 후 사용할 수 있습니다." icon="document-text" />
      <CopyButton copied={copied} onPress={() => handleCopy(counterDoc)} />
      <Card><Text style={styles.docText} selectable>{counterDoc}</Text></Card>
      {renderNotice()}
      <Button title="분석 결과로 돌아가기" onPress={() => setAnalysisStep('result')} variant="outline" size="lg" />
      <Button title="처음으로" onPress={resetAnalysis} variant="outline" size="lg" />
    </View>
  );

  const renderDenialAnalysis = () => {
    if (analysisStep === 'analyzing') return renderAnalyzing();
    if (analysisStep === 'result') return renderAnalysisResult();
    if (analysisStep === 'counter-doc') return renderCounterDoc();
    return renderUpload();
  };

  const renderDraftInput = () => (
    <View style={styles.section}>
      <Hero title="AI 사정서 초안 작성" subtitle="분석 결과와 사건 정보를 바탕으로 손해사정사가 검토할 사정서 초안을 생성합니다." icon="create-outline" />
      {renderNotice()}
      <FormInput label="사건명 또는 사건 선택 메모" value={draftInput.caseTitle ?? ''} onChangeText={(value) => setDraftField('caseTitle', value)} placeholder="예: 2026년 3월 후미추돌 사고" />
      <FormInput label="사고 유형" required value={draftInput.accidentType} onChangeText={(value) => setDraftField('accidentType', value)} placeholder="예: 교통사고, 화재사고, 상해사고" />
      <FormInput label="사고 일자" required value={draftInput.accidentDate} onChangeText={(value) => setDraftField('accidentDate', value)} placeholder="예: 2026-04-29" />
      <FormInput label="사고 장소" required value={draftInput.accidentLocation} onChangeText={(value) => setDraftField('accidentLocation', value)} placeholder="예: 서울시 강남구 테헤란로 인근" />
      <FormInput label="피해 내용" required multiline value={draftInput.damageDetails} onChangeText={(value) => setDraftField('damageDetails', value)} placeholder="차량 파손, 진단/소견, 검사결과, 치료내용, 휴업손해 등 핵심 피해를 요약하세요." />
      <FormInput label="보험사 주장/면책 사유" required multiline value={draftInput.insurerPosition} onChangeText={(value) => setDraftField('insurerPosition', value)} placeholder="보험사가 주장하는 과실, 면책, 감액 사유를 입력하세요." />
      <FormInput label="고객 진술 요약" required multiline value={draftInput.customerStatement} onChangeText={(value) => setDraftField('customerStatement', value)} placeholder="고객이 설명한 사고 경위와 피해 상황을 요약하세요." />
      <FormInput label="손해사정사 메모" multiline value={draftInput.adjusterMemo ?? ''} onChangeText={(value) => setDraftField('adjusterMemo', value)} placeholder="검토 포인트, 추가 자료, 유의사항을 입력하세요." />
      <OptionCard title="원하는 문체" options={toneOptions} value={draftInput.tone} onSelect={(value) => setDraftField('tone', value)} />
      <Button title={generatingDraft ? '초안 생성 중...' : draftResult ? '다시 생성' : '사정서 초안 생성'} onPress={handleGenerateDraft} disabled={generatingDraft} loading={generatingDraft} size="lg" style={styles.primaryBtn} />
      {draftResult && renderDraftResult()}
    </View>
  );

  const renderDraftResult = () => {
    if (!draftResult) return null;
    return (
      <View style={styles.resultWrap}>
        <View style={styles.resultHeader}>
          <Text style={styles.resultTitle}>생성된 사정서 초안</Text>
          <CopyButton copied={copied} onPress={() => handleCopy(formatAssessmentDraftResult(draftResult))} />
        </View>
        <Card><Text style={styles.docText} selectable>{formatAssessmentDraftResult(draftResult)}</Text></Card>
        {renderNotice()}
        <Button title="입력값 수정 후 재생성" onPress={handleGenerateDraft} disabled={generatingDraft} loading={generatingDraft} variant="outline" size="lg" />
      </View>
    );
  };

  const renderClosingReport = () => (
    <View style={styles.section}>
      <Hero title="종결보고서 작성" subtitle="보험사 제출용 조사 결과 문서 초안을 객관적인 보고서 문체로 작성합니다." icon="clipboard-outline" />
      {renderNotice()}
      <UploadSection title="병원자료 / 의학자료" description="진단서, 소견서, 검사결과지, 진료기록, 입퇴원확인서" images={hospitalImages} countLabel={`${hospitalImages.length}/${MAX_IMAGES_PER_GROUP}`} onPick={() => pickImages('hospital')} onRemove={(id) => removeImage('hospital', id)} />
      <UploadSection title="보험사 자료 / 조사자료" description="보험사 조사자료, 접수 안내, 보상 관련 자료" images={insurerImages} countLabel={`${insurerImages.length}/${MAX_IMAGES_PER_GROUP}`} onPick={() => pickImages('insurer')} onRemove={(id) => removeImage('insurer', id)} />
      <UploadSection title="기타 손해자료" description="사고 및 손해 입증에 필요한 기타 이미지 자료" images={otherImages} countLabel={`${otherImages.length}/${MAX_IMAGES_PER_GROUP}`} onPick={() => pickImages('other')} onRemove={(id) => removeImage('other', id)} />
      <Text style={styles.limitText}>각 이미지는 8MB 이하, 종결보고서 업로드 전체 용량은 24MB 이하로 제한됩니다.</Text>

      <OptionCard title="보고서 유형" options={reportTypeOptions} value={closingInput.reportType} onSelect={(value) => setClosingInput((prev) => ({ ...prev, reportType: value }))} />
      <FormInput label="보험사명" required value={closingInput.insurerName} onChangeText={(value) => setClosingInput((prev) => ({ ...prev, insurerName: value }))} placeholder="예: DB손해보험" />
      {closingFields.map((field) => (
        <FormInput
          key={field.key}
          label={field.label}
          value={String(closingInput.caseInfo[field.key] ?? '')}
          onChangeText={(value) => setClosingCaseField(field.key, value)}
          placeholder={field.placeholder}
          multiline={field.multiline}
        />
      ))}
      <FormInput label="조사담당자 메모" multiline value={closingInput.adjusterMemo ?? ''} onChangeText={(value) => setClosingInput((prev) => ({ ...prev, adjusterMemo: value }))} placeholder="조사 중 확인한 특이사항, 유의사항, 미확인 자료를 입력하세요." />
      <OptionCard title="최종 의견" options={finalOpinionOptions} value={closingInput.finalOpinion} onSelect={(value) => setClosingInput((prev) => ({ ...prev, finalOpinion: value }))} />
      <Button title={generatingClosing ? '종결보고서 생성 중...' : closingResult ? '종결보고서 다시 생성' : '종결보고서 작성'} onPress={handleGenerateClosingReport} disabled={generatingClosing || !canCreateClosing} loading={generatingClosing} size="lg" style={styles.emphasisBtn} />
      {closingResult && renderClosingResult()}
    </View>
  );

  const renderClosingResult = () => {
    if (!closingResult) return null;
    return (
      <View style={styles.resultWrap}>
        <View style={styles.resultHeader}>
          <Text style={styles.resultTitle}>생성된 종결보고서 초안</Text>
          <CopyButton copied={copied} onPress={() => handleCopy(formatClosingReportResult(closingResult))} />
        </View>
        <ResultCard title="기본정보" body={[
          `보험사명: ${closingResult.basicInfo.insurerName}`,
          `접수일: ${closingResult.basicInfo.receivedDate}`,
          `위임일: ${closingResult.basicInfo.assignedDate}`,
          `보고일자: ${closingResult.basicInfo.reportDate}`,
          `피보험자: ${closingResult.basicInfo.insuredName}`,
          `사고/접수번호: ${closingResult.basicInfo.claimNumber}`,
          `조사자: ${closingResult.basicInfo.investigator}`,
          `보상담당자: ${closingResult.basicInfo.claimManager}`,
        ].join('\n')} />
        <ResultCard title="계약사항" body={closingResult.contractInfo} />
        <ResultCard title="손해사항" body={closingResult.lossInfo} />
        <ResultCard title="청구내용 및 조사결과" body={closingResult.claimAndInvestigationResult} />
        <ResultCard title="주요 쟁점사항" body={closingResult.keyIssues} />
        <ResultCard title="조사자 확인사항" body={closingResult.investigationChecklist} />
        <ResultCard title="타사 가입사항" body={closingResult.otherInsuranceInfo} />
        <ResultCard title="관련자 면담 및 특이사항" body={closingResult.interviewAndSpecialNotes} />
        <ResultCard title="조사처리과정" body={closingResult.investigationProcessTimeline} />
        <ResultCard title="최종 조사 의견" body={closingResult.finalOpinion} />
        <ListCard title="추가 확인 필요 사항" items={closingResult.requiredAdditionalChecks} color={Colors.danger} />
        <ResultCard title="안내" body={closingResult.disclaimer} />
        <Button title="다시 생성" onPress={handleGenerateClosingReport} disabled={generatingClosing} loading={generatingClosing} variant="outline" size="lg" />
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <Header title="AI 분석" subtitle="면책공문 분석, 사정서 초안, 종결보고서 작성" showBack onBack={onBack} />
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: Math.max(insets.bottom + 16, 32) }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.tabSection}>{renderModeTabs()}</View>
        {mode === 'denial-analysis' && renderDenialAnalysis()}
        {mode === 'assessment-draft' && renderDraftInput()}
        {mode === 'closing-report' && renderClosingReport()}
        <View style={{ height: 16 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const closingFields: Array<{
  key: keyof ClosingReportInput['caseInfo'];
  label: string;
  placeholder: string;
  multiline?: boolean;
}> = [
  { key: 'receivedDate', label: '사건접수일', placeholder: '예: 2026-04-01' },
  { key: 'assignedDate', label: '위임일', placeholder: '예: 2026-04-02' },
  { key: 'reportDate', label: '보고일자', placeholder: '예: 2026-04-29' },
  { key: 'insuredName', label: '피보험자명', placeholder: '예: 홍길동' },
  { key: 'claimNumber', label: '사고번호 또는 접수번호', placeholder: '예: 2026-000000' },
  { key: 'policyNumber', label: '증권번호', placeholder: '예: 123456789' },
  { key: 'productName', label: '상품명', placeholder: '예: 참좋은운전자보험' },
  { key: 'coveragePeriod', label: '보험기간', placeholder: '예: 2024-01-01 ~ 2044-01-01' },
  { key: 'contractorName', label: '계약자명', placeholder: '예: 홍길동' },
  { key: 'accidentDate', label: '사고일자', placeholder: '예: 2026-03-20' },
  { key: 'accidentType', label: '사고유형', placeholder: '예: 상해, 질병, 교통사고' },
  { key: 'diagnosisName', label: '진단명', placeholder: '예: 요추 염좌' },
  { key: 'diagnosisCode', label: '질병코드', placeholder: '예: S33.5' },
  { key: 'jobClassAtEnrollment', label: '가입시 직업급수', placeholder: '예: 1급' },
  { key: 'jobClassAtAccident', label: '사고시 직업급수', placeholder: '예: 1급' },
  { key: 'claimedCoverage', label: '청구 담보', placeholder: '예: 상해입원일당, 수술비' },
  { key: 'claimSummary', label: '청구 내용', placeholder: '청구 금액, 청구 사유, 제출 자료를 요약하세요.', multiline: true },
  { key: 'investigator', label: '조사자명', placeholder: '예: 김조사' },
  { key: 'claimManager', label: '보상담당자', placeholder: '예: 이담당' },
];

function toPayload(image: SelectedImage): ImagePayload {
  return { base64: image.base64, mimeType: image.mimeType, name: image.name };
}

function groupLabel(group: UploadGroup) {
  if (group === 'denial') return '면책공문';
  if (group === 'customer') return '고객자료';
  if (group === 'hospital') return '병원자료';
  if (group === 'insurer') return '보험사자료';
  return '기타자료';
}

function Hero({ title, subtitle, icon, success }: { title: string; subtitle: string; icon: keyof typeof Ionicons.glyphMap; success?: boolean }) {
  return (
    <LinearGradient colors={success ? [Colors.success, '#2ECC71'] : [Colors.primaryDark, Colors.accent]} style={styles.banner} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
      <Ionicons name={icon} size={32} color={Colors.white} />
      <Text style={styles.bannerTitle}>{title}</Text>
      <Text style={styles.bannerDesc}>{subtitle}</Text>
    </LinearGradient>
  );
}

function ModeTab({ label, icon, active, onPress }: { label: string; icon: keyof typeof Ionicons.glyphMap; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.modeTab, active && styles.modeTabActive]} onPress={onPress}>
      <Ionicons name={icon} size={15} color={active ? Colors.white : Colors.primary} />
      <Text style={[styles.modeTabText, active && styles.modeTabTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function UploadSection({ title, description, images, countLabel, onPick, onRemove }: {
  title: string;
  description: string;
  images: SelectedImage[];
  countLabel: string;
  onPick: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <Card style={styles.uploadCard}>
      <View style={styles.uploadHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.uploadTitle}>{title}</Text>
          <Text style={styles.uploadDesc}>{description}</Text>
        </View>
        <Text style={styles.countBadge}>{countLabel}</Text>
      </View>
      {images.length > 0 && (
        <View style={styles.fileList}>
          {images.map((image, index) => (
            <View key={image.id} style={styles.fileRow}>
              <Ionicons name="image-outline" size={18} color={Colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.fileName} numberOfLines={1}>{image.name || `${index + 1}번 이미지`}</Text>
                <Text style={styles.fileSize}>{(image.size / 1024).toFixed(1)} KB</Text>
              </View>
              <TouchableOpacity style={styles.removeBtn} onPress={() => onRemove(image.id)}>
                <Ionicons name="close" size={16} color={Colors.danger} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
      <TouchableOpacity style={styles.uploadTypeBtn} onPress={onPick}>
        <Ionicons name="images-outline" size={16} color={Colors.primary} />
        <Text style={styles.uploadTypeBtnText}>이미지 선택</Text>
      </TouchableOpacity>
    </Card>
  );
}

function OptionCard<T extends string>({ title, options, value, onSelect }: {
  title: string;
  options: { value: T; label: string }[];
  value: T;
  onSelect: (value: T) => void;
}) {
  return (
    <Card>
      <Text style={styles.fieldLabel}>{title}</Text>
      <View style={styles.chipRow}>
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <TouchableOpacity key={option.value} style={[styles.toneChip, selected && styles.toneChipActive]} onPress={() => onSelect(option.value)}>
              <Text style={[styles.toneChipText, selected && styles.toneChipTextActive]}>{option.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </Card>
  );
}

function FormInput({ label, value, onChangeText, placeholder, multiline, required }: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
  required?: boolean;
}) {
  return (
    <Card>
      <Text style={styles.fieldLabel}>{label} {required ? <Text style={styles.required}>*</Text> : null}</Text>
      <TextInput style={[styles.input, multiline && styles.textArea]} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={Colors.textMuted} multiline={multiline} textAlignVertical={multiline ? 'top' : 'center'} maxLength={multiline ? 1800 : 180} />
    </Card>
  );
}

function ResultCard({ title, body }: { title: string; body?: string }) {
  if (!body) return null;
  return (
    <Card>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.bodyText}>{body}</Text>
    </Card>
  );
}

function ListCard({ title, items, color }: { title: string; items?: string[]; color: string }) {
  if (!items?.length) return null;
  return (
    <Card>
      <Text style={styles.sectionTitle}>{title}</Text>
      {items.map((item, index) => (
        <View key={`${item}-${index}`} style={styles.bulletRow}>
          <View style={[styles.bullet, { backgroundColor: color }]} />
          <Text style={styles.bulletText}>{item}</Text>
        </View>
      ))}
    </Card>
  );
}

function CopyButton({ copied, onPress }: { copied: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.copyBtn} onPress={onPress}>
      <Ionicons name={copied ? 'checkmark-circle' : 'copy-outline'} size={18} color={copied ? Colors.success : Colors.primary} />
      <Text style={[styles.copyBtnText, copied && { color: Colors.success }]}>{copied ? '복사됨' : '복사'}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  container: { flex: 1 },
  tabSection: { paddingHorizontal: 16, paddingTop: 12 },
  section: { padding: 16, gap: 12 },
  center: { alignItems: 'center' },
  modeTabs: {
    gap: 8,
  },
  modeTab: {
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modeTabActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  modeTabText: { fontSize: 14, color: Colors.primary, fontWeight: '800', textAlign: 'center' },
  modeTabTextActive: { color: Colors.white },
  banner: { borderRadius: 16, padding: 24, alignItems: 'center', gap: 8 },
  bannerTitle: { fontSize: 20, fontWeight: '800', color: Colors.white },
  bannerDesc: { fontSize: 13, color: 'rgba(255,255,255,0.85)', textAlign: 'center', lineHeight: 19 },
  noticeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: Colors.primary + '08',
    borderWidth: 1,
    borderColor: Colors.primary + '18',
    borderRadius: 14,
    padding: 12,
  },
  noticeText: { flex: 1, fontSize: 12, color: Colors.textSecondary, lineHeight: 18 },
  uploadCard: { marginBottom: 4 },
  uploadHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  uploadTitle: { fontSize: 15, fontWeight: '800', color: Colors.textPrimary },
  uploadDesc: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17, marginTop: 4 },
  countBadge: {
    fontSize: 12,
    fontWeight: '800',
    color: Colors.primary,
    backgroundColor: Colors.primary + '10',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  fileList: { gap: 8, marginBottom: 12 },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.background,
    borderRadius: 12,
    padding: 10,
  },
  fileName: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary },
  fileSize: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  removeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.danger + '10',
  },
  uploadTypeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.primary + '10',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: Colors.primary + '30',
  },
  uploadTypeBtnText: { fontSize: 13, color: Colors.primary, fontWeight: '700' },
  limitText: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
  primaryBtn: { backgroundColor: Colors.primary, borderRadius: 14 },
  emphasisBtn: { backgroundColor: Colors.accent, borderRadius: 14 },
  analyzingCard: {
    width: '100%',
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    gap: 12,
    shadowColor: '#0B1F3A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 2,
  },
  analyzingTitle: { fontSize: 18, fontWeight: '800', color: Colors.textPrimary },
  analyzingDesc: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center' },
  progressBar: { width: '100%', height: 8, backgroundColor: Colors.border, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: Colors.primary, borderRadius: 4 },
  progressText: { fontSize: 14, fontWeight: '700', color: Colors.primary },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: Colors.textPrimary, marginBottom: 10 },
  bodyText: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  bullet: { width: 6, height: 6, borderRadius: 3, marginTop: 6 },
  bulletText: { flex: 1, fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  fieldLabel: { fontSize: 13, fontWeight: '800', color: Colors.textPrimary, marginBottom: 8 },
  required: { color: Colors.danger },
  input: {
    minHeight: 48,
    backgroundColor: Colors.inputBg,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1.2,
    borderColor: Colors.border,
    fontSize: 14,
    color: Colors.textPrimary,
  },
  textArea: { minHeight: 110, lineHeight: 20 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  toneChip: {
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1.2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
    paddingHorizontal: 14,
    flexGrow: 1,
  },
  toneChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  toneChipText: { fontSize: 13, color: Colors.primary, fontWeight: '700' },
  toneChipTextActive: { color: Colors.white },
  resultWrap: { gap: 12, marginTop: 4 },
  resultHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  resultTitle: { fontSize: 16, fontWeight: '800', color: Colors.textPrimary },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-end',
    backgroundColor: Colors.white,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  copyBtnText: { fontSize: 13, color: Colors.primary, fontWeight: '700' },
  docText: { fontSize: 13, color: Colors.textPrimary, lineHeight: 21, fontFamily: 'monospace' },
});
