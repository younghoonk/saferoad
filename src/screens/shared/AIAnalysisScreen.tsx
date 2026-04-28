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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { Header } from '../../components/Header';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Colors } from '../../constants';
import { analyzeDocument, generateCounterDocument, AnalysisResult } from '../../lib/openaiApi';

interface AIAnalysisScreenProps {
  onBack: () => void;
}

type Step = 'upload' | 'analyzing' | 'result' | 'counter-doc';

interface UploadedImage {
  name: string;
  size: number;
  uri: string;
  mimeType: string;
  base64: string;
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export function AIAnalysisScreen({ onBack }: AIAnalysisScreenProps) {
  const [step, setStep] = useState<Step>('upload');
  const [uploadedImage, setUploadedImage] = useState<UploadedImage | null>(null);
  const [progress, setProgress] = useState(0);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [counterDoc, setCounterDoc] = useState<string | null>(null);
  const [generatingDoc, setGeneratingDoc] = useState(false);
  const [copied, setCopied] = useState(false);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('권한 필요', '이미지를 선택하려면 사진 접근 권한이 필요합니다.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      base64: true,
    });

    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    if (!asset.base64) {
      Alert.alert('이미지 오류', '이미지 데이터를 읽을 수 없습니다. 다시 선택해 주세요.');
      return;
    }

    const size = asset.fileSize ?? Math.ceil((asset.base64.length * 3) / 4);
    if (size > MAX_IMAGE_BYTES) {
      Alert.alert('파일이 너무 큽니다', '8MB 이하의 JPG, PNG, WEBP 이미지만 업로드할 수 있습니다.');
      return;
    }

    setUploadedImage({
      name: asset.fileName ?? 'insurance-document.jpg',
      size,
      uri: asset.uri,
      mimeType: asset.mimeType ?? 'image/jpeg',
      base64: asset.base64,
    });
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
    if (!uploadedImage) return;
    setStep('analyzing');
    startFakeProgress();

    try {
      const result = await analyzeDocument(uploadedImage.base64, uploadedImage.mimeType);
      finishProgress();
      setAnalysisResult(result);
      setTimeout(() => setStep('result'), 600);
    } catch (err: unknown) {
      if (progressRef.current) clearInterval(progressRef.current);
      setStep('upload');
      Alert.alert('분석 실패', err instanceof Error ? err.message : '분석 중 오류가 발생했습니다.');
    }
  };

  const handleGenerateCounterDoc = async () => {
    if (!analysisResult) return;
    setGeneratingDoc(true);
    try {
      const doc = await generateCounterDocument(analysisResult);
      setCounterDoc(doc);
      setStep('counter-doc');
    } catch (err: unknown) {
      Alert.alert('생성 실패', err instanceof Error ? err.message : '공문 생성 중 오류가 발생했습니다.');
    } finally {
      setGeneratingDoc(false);
    }
  };

  const handleCopy = async () => {
    if (!counterDoc) return;
    await Clipboard.setStringAsync(counterDoc);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const resetAll = () => {
    setStep('upload');
    setUploadedImage(null);
    setProgress(0);
    setAnalysisResult(null);
    setCounterDoc(null);
  };

  const renderUpload = () => (
    <View style={styles.section}>
      <LinearGradient
        colors={['#6C3CE1', '#4A90D9']}
        style={styles.banner}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <Ionicons name="sparkles" size={32} color={Colors.white} />
        <Text style={styles.bannerTitle}>AI 면책공문 분석</Text>
        <Text style={styles.bannerDesc}>
          현재는 이미지 분석만 지원합니다. PDF는 각 페이지를 이미지로 캡처해 업로드해 주세요.
        </Text>
      </LinearGradient>

      <Card style={styles.uploadCard}>
        {uploadedImage ? (
          <View style={styles.fileSelected}>
            <Ionicons name="image" size={36} color={Colors.success} />
            <Text style={styles.fileName} numberOfLines={2}>{uploadedImage.name}</Text>
            <Text style={styles.fileSize}>{(uploadedImage.size / 1024).toFixed(1)} KB</Text>
            <TouchableOpacity onPress={pickImage}>
              <Text style={styles.changeFile}>이미지 변경</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.dropzone}>
            <Ionicons name="image-outline" size={42} color={Colors.textMuted} />
            <Text style={styles.dropzoneTitle}>면책 공문 이미지를 업로드하세요</Text>
            <Text style={styles.dropzoneDesc}>JPG, PNG, WEBP 이미지 파일만 가능, PDF 미지원</Text>
            <TouchableOpacity style={styles.uploadTypeBtn} onPress={pickImage}>
              <Ionicons name="image-outline" size={16} color={Colors.primary} />
              <Text style={styles.uploadTypeBtnText}>이미지 선택</Text>
            </TouchableOpacity>
          </View>
        )}
      </Card>

      <View style={styles.featureList}>
        {[
          { icon: 'search', text: '면책 사유와 법적 근거 분석' },
          { icon: 'alert-circle', text: '보험사 논리의 취약점 탐지' },
          { icon: 'document-text', text: '반박 공문 초안 생성' },
          { icon: 'shield-checkmark', text: '관련 법령과 판례 검토' },
        ].map((feature) => (
          <View key={feature.text} style={styles.featureItem}>
            <View style={styles.featureIconBg}>
              <Ionicons name={feature.icon as any} size={16} color="#6C3CE1" />
            </View>
            <Text style={styles.featureText}>{feature.text}</Text>
          </View>
        ))}
      </View>

      <Button
        title="AI 분석 시작"
        onPress={startAnalysis}
        disabled={!uploadedImage}
        size="lg"
        style={styles.analyzeBtn}
      />
    </View>
  );

  const renderAnalyzing = () => (
    <View style={[styles.section, styles.center]}>
      <View style={styles.analyzingCard}>
        <ActivityIndicator size="large" color="#6C3CE1" />
        <Text style={styles.analyzingTitle}>AI가 분석 중입니다</Text>
        <Text style={styles.analyzingDesc}>이미지의 면책 사유와 반박 근거를 검토하고 있습니다.</Text>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${progress}%` as any }]} />
        </View>
        <Text style={styles.progressText}>{Math.round(progress)}%</Text>
      </View>
    </View>
  );

  const renderResult = () => {
    if (!analysisResult) return null;

    return (
      <View style={styles.section}>
        <LinearGradient colors={[Colors.success, '#2ECC71']} style={styles.banner}>
          <Ionicons name="checkmark-circle" size={32} color={Colors.white} />
          <Text style={styles.bannerTitle}>분석 완료</Text>
          <Text style={styles.bannerDesc}>{uploadedImage?.name}</Text>
        </LinearGradient>

        <ResultCard title="분석 요약" body={analysisResult.summary} />
        <ListCard title="보험사 면책 사유" items={analysisResult.denial_reasons} color={Colors.danger} />
        <ListCard title="취약점" items={analysisResult.weak_points} color="#F39C12" />

        {analysisResult.counter_arguments?.length > 0 && (
          <Card>
            <Text style={styles.sectionTitle}>반박 근거</Text>
            {analysisResult.counter_arguments.map((arg, index) => (
              <View key={`${arg.point}-${index}`} style={styles.counterItem}>
                <View style={styles.counterHeader}>
                  <Text style={styles.counterNum}>{index + 1}</Text>
                  <Text style={styles.counterPoint}>{arg.point}</Text>
                </View>
                <Text style={styles.bodyText}>{arg.argument}</Text>
              </View>
            ))}
          </Card>
        )}

        <ListCard title="관련 법령" items={analysisResult.relevant_laws} color={Colors.primary} />
        <ListCard title="관련 판례" items={analysisResult.precedents} color="#9B59B6" />
        <ResultCard title="권고 조치" body={analysisResult.recommended_action} />

        <Button
          title={generatingDoc ? '공문 생성 중...' : '반박 공문 자동 생성'}
          onPress={handleGenerateCounterDoc}
          disabled={generatingDoc}
          size="lg"
          style={styles.counterDocBtn}
        />
        {generatingDoc && <ActivityIndicator color="#6C3CE1" style={{ marginTop: 8 }} />}
        <Button title="다시 분석하기" onPress={resetAll} variant="outline" size="lg" />
      </View>
    );
  };

  const renderCounterDoc = () => (
    <View style={styles.section}>
      <LinearGradient colors={['#6C3CE1', '#4A90D9']} style={styles.banner}>
        <Ionicons name="document-text" size={32} color={Colors.white} />
        <Text style={styles.bannerTitle}>반박 공문 생성 완료</Text>
        <Text style={styles.bannerDesc}>아래 공문을 복사해 사용할 수 있습니다.</Text>
      </LinearGradient>

      <TouchableOpacity style={styles.copyBtn} onPress={handleCopy}>
        <Ionicons
          name={copied ? 'checkmark-circle' : 'copy-outline'}
          size={18}
          color={copied ? Colors.success : Colors.primary}
        />
        <Text style={[styles.copyBtnText, copied && { color: Colors.success }]}>
          {copied ? '복사됨' : '전체 복사'}
        </Text>
      </TouchableOpacity>

      <Card>
        <ScrollView style={styles.docScroll} scrollEnabled={false}>
          <Text style={styles.docText} selectable>{counterDoc}</Text>
        </ScrollView>
      </Card>

      <Button title="분석 결과로 돌아가기" onPress={() => setStep('result')} variant="outline" size="lg" />
      <Button title="처음으로" onPress={resetAll} variant="outline" size="lg" />
    </View>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <Header title="AI 분석" subtitle="면책공문 반박 생성" showBack onBack={onBack} />
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        {step === 'upload' && renderUpload()}
        {step === 'analyzing' && renderAnalyzing()}
        {step === 'result' && renderResult()}
        {step === 'counter-doc' && renderCounterDoc()}
        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  container: { flex: 1 },
  section: { padding: 16, gap: 12 },
  center: { alignItems: 'center' },
  banner: {
    borderRadius: 18,
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  bannerTitle: { fontSize: 20, fontWeight: '800', color: Colors.white },
  bannerDesc: { fontSize: 13, color: 'rgba(255,255,255,0.85)', textAlign: 'center', lineHeight: 19 },
  uploadCard: { marginBottom: 4 },
  fileSelected: { alignItems: 'center', gap: 8, padding: 24 },
  fileName: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
  fileSize: { fontSize: 12, color: Colors.textSecondary },
  changeFile: { fontSize: 13, color: Colors.accent, textDecorationLine: 'underline' },
  dropzone: { alignItems: 'center', gap: 8, padding: 28 },
  dropzoneTitle: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
  dropzoneDesc: { fontSize: 12, color: Colors.textSecondary, textAlign: 'center' },
  uploadTypeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.primary + '10',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.primary + '30',
    marginTop: 4,
  },
  uploadTypeBtnText: { fontSize: 13, color: Colors.primary, fontWeight: '600' },
  featureList: { gap: 10 },
  featureItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureIconBg: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#6C3CE115',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: { fontSize: 13, color: Colors.textPrimary, fontWeight: '500' },
  analyzeBtn: { backgroundColor: '#6C3CE1', borderRadius: 14 },
  analyzingCard: {
    width: '100%',
    backgroundColor: Colors.white,
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  analyzingTitle: { fontSize: 18, fontWeight: '800', color: Colors.textPrimary },
  analyzingDesc: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center' },
  progressBar: {
    width: '100%',
    height: 8,
    backgroundColor: Colors.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: '#6C3CE1', borderRadius: 4 },
  progressText: { fontSize: 14, fontWeight: '700', color: '#6C3CE1' },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: Colors.textPrimary, marginBottom: 10 },
  bodyText: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  bullet: { width: 6, height: 6, borderRadius: 3, marginTop: 6 },
  bulletText: { flex: 1, fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  counterItem: {
    backgroundColor: Colors.background,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  counterHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  counterNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.primary,
    color: Colors.white,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 22,
  },
  counterPoint: { fontSize: 14, fontWeight: '700', color: Colors.primary, flex: 1 },
  counterDocBtn: { backgroundColor: '#6C3CE1', borderRadius: 14 },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-end',
    backgroundColor: Colors.white,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  copyBtnText: { fontSize: 13, color: Colors.primary, fontWeight: '600' },
  docScroll: { maxHeight: 600 },
  docText: {
    fontSize: 13,
    color: Colors.textPrimary,
    lineHeight: 21,
    fontFamily: 'monospace',
  },
});
