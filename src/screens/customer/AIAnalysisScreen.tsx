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
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
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

interface UploadedFile {
  name: string;
  size: number;
  uri: string;
  mimeType: string;
  base64: string;    // 선택 시점에 미리 변환
}

export function AIAnalysisScreen({ onBack }: AIAnalysisScreenProps) {
  const [step,           setStep]           = useState<Step>('upload');
  const [uploadedFile,   setUploadedFile]   = useState<UploadedFile | null>(null);
  const [progress,       setProgress]       = useState(0);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [counterDoc,     setCounterDoc]     = useState<string | null>(null);
  const [generatingDoc,  setGeneratingDoc]  = useState(false);
  const [copied,         setCopied]         = useState(false);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── 파일 선택 ─────────────────────────────────────────────────
  const pickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*'],
      copyToCacheDirectory: true,
    });
    if (!result.canceled && result.assets[0]) {
      const a = result.assets[0];
      if (!a.uri) { Alert.alert('오류', '파일 경로를 가져올 수 없습니다.'); return; }
      try {
        const base64 = await FileSystem.readAsStringAsync(a.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        if (!base64) throw new Error('base64 변환 결과가 비어 있습니다.');
        setUploadedFile({
          name:     a.name,
          size:     a.size ?? 0,
          uri:      a.uri,
          mimeType: a.mimeType ?? 'application/pdf',
          base64,
        });
      } catch (e: any) {
        Alert.alert('파일 읽기 실패', e.message ?? '파일을 읽을 수 없습니다. 다시 시도해주세요.');
      }
    }
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      base64: true,   // ImagePicker에서 직접 base64 요청 (FileSystem 불필요)
    });
    if (!result.canceled && result.assets[0]) {
      const a = result.assets[0];
      const b64 = a.base64;
      if (!b64) { Alert.alert('오류', '이미지 데이터를 가져올 수 없습니다.'); return; }
      setUploadedFile({
        name:     a.fileName ?? '이미지.jpg',
        size:     a.fileSize ?? 0,
        uri:      a.uri,
        mimeType: 'image/jpeg',
        base64:   b64,
      });
    }
  };

  // ── 가짜 진행바 (API 응답 대기 중 시각적 피드백) ───────────────
  const startFakeProgress = () => {
    setProgress(0);
    let p = 0;
    progressRef.current = setInterval(() => {
      p += Math.random() * 8;
      if (p >= 90) { clearInterval(progressRef.current!); p = 90; }
      setProgress(Math.min(p, 90));
    }, 400);
  };

  const finishProgress = () => {
    if (progressRef.current) clearInterval(progressRef.current);
    setProgress(100);
  };

  // ── 분석 시작 ─────────────────────────────────────────────────
  const startAnalysis = async () => {
    if (!uploadedFile) return;
    if (!uploadedFile.base64) {
      Alert.alert('오류', '파일 데이터가 없습니다. 파일을 다시 선택해주세요.');
      return;
    }
    setStep('analyzing');
    startFakeProgress();

    try {
      const result = await analyzeDocument(uploadedFile.base64, uploadedFile.mimeType);
      finishProgress();
      setAnalysisResult(result);
      setTimeout(() => setStep('result'), 600);
    } catch (err: any) {
      if (progressRef.current) clearInterval(progressRef.current);
      setStep('upload');
      Alert.alert('분석 실패', err.message);
    }
  };

  // ── 반박 공문 생성 ────────────────────────────────────────────
  const handleGenerateCounterDoc = async () => {
    if (!analysisResult) return;
    setGeneratingDoc(true);
    try {
      const doc = await generateCounterDocument(analysisResult);
      setCounterDoc(doc);
      setStep('counter-doc');
    } catch (err: any) {
      Alert.alert('생성 실패', err.message);
    } finally {
      setGeneratingDoc(false);
    }
  };

  // ── 클립보드 복사 ─────────────────────────────────────────────
  const handleCopy = async () => {
    if (!counterDoc) return;
    await Clipboard.setStringAsync(counterDoc);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const resetAll = () => {
    setStep('upload');
    setUploadedFile(null);
    setProgress(0);
    setAnalysisResult(null);
    setCounterDoc(null);
  };

  // ── 업로드 화면 ───────────────────────────────────────────────
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
          보험사 면책 공문을 업로드하면{'\n'}AI가 반박 논거를 자동으로 생성합니다
        </Text>
      </LinearGradient>

      {/* 업로드 영역 */}
      <Card style={styles.uploadCard}>
        {uploadedFile ? (
          <View style={styles.fileSelected}>
            <Ionicons
              name={uploadedFile.mimeType === 'application/pdf' ? 'document-text' : 'image'}
              size={36}
              color={Colors.success}
            />
            <Text style={styles.fileName} numberOfLines={2}>{uploadedFile.name}</Text>
            {uploadedFile.size > 0 && (
              <Text style={styles.fileSize}>{(uploadedFile.size / 1024).toFixed(1)} KB</Text>
            )}
            <TouchableOpacity onPress={pickDocument}>
              <Text style={styles.changeFile}>파일 변경</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.dropzone}>
            <Ionicons name="cloud-upload-outline" size={40} color={Colors.textMuted} />
            <Text style={styles.dropzoneTitle}>면책 공문을 업로드하세요</Text>
            <Text style={styles.dropzoneDesc}>PDF 또는 이미지 파일</Text>
            <View style={styles.uploadBtnRow}>
              <TouchableOpacity style={styles.uploadTypeBtn} onPress={pickDocument}>
                <Ionicons name="document-outline" size={16} color={Colors.primary} />
                <Text style={styles.uploadTypeBtnText}>PDF 선택</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.uploadTypeBtn} onPress={pickImage}>
                <Ionicons name="image-outline" size={16} color={Colors.primary} />
                <Text style={styles.uploadTypeBtnText}>사진 선택</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </Card>

      {/* 기능 목록 */}
      <View style={styles.featureList}>
        {[
          { icon: 'search',            text: '면책 이유 법적 근거 분석' },
          { icon: 'alert-circle',      text: '보험사 논리 허점 탐지' },
          { icon: 'document-text',     text: '반박 공문 자동 생성' },
          { icon: 'shield-checkmark',  text: '관련 판례 및 법령 인용' },
        ].map((f) => (
          <View key={f.text} style={styles.featureItem}>
            <View style={styles.featureIconBg}>
              <Ionicons name={f.icon as any} size={16} color="#6C3CE1" />
            </View>
            <Text style={styles.featureText}>{f.text}</Text>
          </View>
        ))}
      </View>

      <Button
        title="AI 분석 시작"
        onPress={startAnalysis}
        disabled={!uploadedFile}
        size="lg"
        style={styles.analyzeBtn}
      />
    </View>
  );

  // ── 분석 중 화면 ──────────────────────────────────────────────
  const renderAnalyzing = () => (
    <View style={[styles.section, styles.center]}>
      <View style={styles.analyzingCard}>
        <ActivityIndicator size="large" color="#6C3CE1" />
        <Text style={styles.analyzingTitle}>AI가 분석 중입니다...</Text>
        <Text style={styles.analyzingDesc}>면책 공문의 법적 논리를 검토하고 있습니다</Text>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${progress}%` as any }]} />
        </View>
        <Text style={styles.progressText}>{Math.round(progress)}%</Text>
        <View style={styles.steps}>
          {[
            { label: '문서 분석',     done: progress > 20 },
            { label: '법적 검토',     done: progress > 50 },
            { label: '반박 논거 생성', done: progress > 80 },
            { label: '공문 작성',     done: progress >= 100 },
          ].map((s) => (
            <View key={s.label} style={styles.stepItem}>
              <Ionicons
                name={s.done ? 'checkmark-circle' : 'ellipse-outline'}
                size={16}
                color={s.done ? Colors.success : Colors.textMuted}
              />
              <Text style={[styles.stepLabel, s.done && styles.stepLabelDone]}>
                {s.label}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );

  // ── 결과 화면 ─────────────────────────────────────────────────
  const renderResult = () => {
    if (!analysisResult) return null;
    return (
      <View style={styles.section}>
        <LinearGradient colors={[Colors.success, '#2ECC71']} style={styles.banner}>
          <Ionicons name="checkmark-circle" size={32} color={Colors.white} />
          <Text style={styles.bannerTitle}>분석 완료</Text>
          <Text style={styles.bannerDesc}>{uploadedFile?.name}</Text>
        </LinearGradient>

        {/* 요약 */}
        <Card>
          <Text style={styles.sectionTitle}>📋 분석 요약</Text>
          <Text style={styles.bodyText}>{analysisResult.summary}</Text>
        </Card>

        {/* 면책 이유 */}
        {analysisResult.denial_reasons?.length > 0 && (
          <Card>
            <Text style={styles.sectionTitle}>📌 보험사 면책 이유</Text>
            {analysisResult.denial_reasons.map((r, i) => (
              <View key={i} style={styles.bulletRow}>
                <View style={[styles.bullet, { backgroundColor: Colors.danger }]} />
                <Text style={styles.bulletText}>{r}</Text>
              </View>
            ))}
          </Card>
        )}

        {/* 취약점 */}
        {analysisResult.weak_points?.length > 0 && (
          <Card>
            <Text style={styles.sectionTitle}>⚠️ 보험사 논리의 취약점</Text>
            {analysisResult.weak_points.map((p, i) => (
              <View key={i} style={styles.bulletRow}>
                <View style={[styles.bullet, { backgroundColor: '#F39C12' }]} />
                <Text style={styles.bulletText}>{p}</Text>
              </View>
            ))}
          </Card>
        )}

        {/* 반박 논거 */}
        {analysisResult.counter_arguments?.length > 0 && (
          <Card>
            <Text style={styles.sectionTitle}>💡 반박 논거</Text>
            {analysisResult.counter_arguments.map((arg, i) => (
              <View key={i} style={styles.counterItem}>
                <View style={styles.counterHeader}>
                  <Text style={styles.counterNum}>{i + 1}</Text>
                  <Text style={styles.counterPoint}>{arg.point}</Text>
                </View>
                <Text style={styles.bodyText}>{arg.argument}</Text>
              </View>
            ))}
          </Card>
        )}

        {/* 관련 법령 */}
        {analysisResult.relevant_laws?.length > 0 && (
          <Card>
            <Text style={styles.sectionTitle}>⚖️ 관련 법령</Text>
            {analysisResult.relevant_laws.map((law, i) => (
              <View key={i} style={styles.bulletRow}>
                <View style={[styles.bullet, { backgroundColor: Colors.primary }]} />
                <Text style={styles.bulletText}>{law}</Text>
              </View>
            ))}
          </Card>
        )}

        {/* 관련 판례 */}
        {analysisResult.precedents?.length > 0 && (
          <Card>
            <Text style={styles.sectionTitle}>📚 관련 판례</Text>
            {analysisResult.precedents.map((p, i) => (
              <View key={i} style={styles.bulletRow}>
                <View style={[styles.bullet, { backgroundColor: '#9B59B6' }]} />
                <Text style={styles.bulletText}>{p}</Text>
              </View>
            ))}
          </Card>
        )}

        {/* 권고 조치 */}
        <Card>
          <Text style={styles.sectionTitle}>🎯 권고 조치</Text>
          <Text style={styles.bodyText}>{analysisResult.recommended_action}</Text>
        </Card>

        {/* 버튼 */}
        <Button
          title={generatingDoc ? '공문 생성 중...' : '반박 공문 자동 생성'}
          onPress={handleGenerateCounterDoc}
          disabled={generatingDoc}
          size="lg"
          style={styles.counterDocBtn}
        />
        {generatingDoc && <ActivityIndicator color="#6C3CE1" style={{ marginTop: 8 }} />}
        <Button
          title="다시 분석하기"
          onPress={resetAll}
          variant="outline"
          size="lg"
        />
      </View>
    );
  };

  // ── 반박 공문 화면 ────────────────────────────────────────────
  const renderCounterDoc = () => (
    <View style={styles.section}>
      <LinearGradient colors={['#6C3CE1', '#4A90D9']} style={styles.banner}>
        <Ionicons name="document-text" size={32} color={Colors.white} />
        <Text style={styles.bannerTitle}>반박 공문 생성 완료</Text>
        <Text style={styles.bannerDesc}>아래 공문을 복사해 사용하세요</Text>
      </LinearGradient>

      {/* 복사 버튼 */}
      <TouchableOpacity style={styles.copyBtn} onPress={handleCopy}>
        <Ionicons
          name={copied ? 'checkmark-circle' : 'copy-outline'}
          size={18}
          color={copied ? Colors.success : Colors.primary}
        />
        <Text style={[styles.copyBtnText, copied && { color: Colors.success }]}>
          {copied ? '복사됨!' : '전체 복사'}
        </Text>
      </TouchableOpacity>

      {/* 공문 본문 */}
      <Card>
        <ScrollView style={styles.docScroll} scrollEnabled={false}>
          <Text style={styles.docText} selectable>{counterDoc}</Text>
        </ScrollView>
      </Card>

      <Button
        title="분석 결과로 돌아가기"
        onPress={() => setStep('result')}
        variant="outline"
        size="lg"
      />
      <Button
        title="처음으로"
        onPress={resetAll}
        variant="outline"
        size="lg"
      />
    </View>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <Header title="AI 분석" subtitle="면책공문 반박 생성" showBack onBack={onBack} />
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        {step === 'upload'       && renderUpload()}
        {step === 'analyzing'    && renderAnalyzing()}
        {step === 'result'       && renderResult()}
        {step === 'counter-doc'  && renderCounterDoc()}
        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: Colors.background },
  container: { flex: 1 },
  section:   { padding: 16, gap: 12 },
  center:    { alignItems: 'center' },

  banner: {
    borderRadius: 18, padding: 24,
    alignItems: 'center', gap: 8,
  },
  bannerTitle: { fontSize: 20, fontWeight: '800', color: Colors.white },
  bannerDesc:  { fontSize: 13, color: 'rgba(255,255,255,0.85)', textAlign: 'center', lineHeight: 19 },

  uploadCard: { marginBottom: 4 },
  fileSelected: { alignItems: 'center', gap: 8, padding: 24 },
  fileName:     { fontSize: 14, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
  fileSize:     { fontSize: 12, color: Colors.textSecondary },
  changeFile:   { fontSize: 13, color: Colors.accent, textDecorationLine: 'underline' },

  dropzone: { alignItems: 'center', gap: 8, padding: 28 },
  dropzoneTitle: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  dropzoneDesc:  { fontSize: 12, color: Colors.textSecondary },
  uploadBtnRow:  { flexDirection: 'row', gap: 12, marginTop: 4 },
  uploadTypeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.primary + '10',
    borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: Colors.primary + '30',
  },
  uploadTypeBtnText: { fontSize: 13, color: Colors.primary, fontWeight: '600' },

  featureList: { gap: 10 },
  featureItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureIconBg: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: '#6C3CE115',
    alignItems: 'center', justifyContent: 'center',
  },
  featureText: { fontSize: 13, color: Colors.textPrimary, fontWeight: '500' },
  analyzeBtn:  { backgroundColor: '#6C3CE1', borderRadius: 14 },

  analyzingCard: {
    width: '100%', backgroundColor: Colors.white,
    borderRadius: 20, padding: 32,
    alignItems: 'center', gap: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 12, elevation: 3,
  },
  analyzingTitle: { fontSize: 18, fontWeight: '800', color: Colors.textPrimary },
  analyzingDesc:  { fontSize: 13, color: Colors.textSecondary },
  progressBar: {
    width: '100%', height: 8,
    backgroundColor: Colors.border, borderRadius: 4, overflow: 'hidden',
  },
  progressFill:  { height: '100%', backgroundColor: '#6C3CE1', borderRadius: 4 },
  progressText:  { fontSize: 14, fontWeight: '700', color: '#6C3CE1' },
  steps:         { width: '100%', gap: 8 },
  stepItem:      { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepLabel:     { fontSize: 13, color: Colors.textMuted },
  stepLabelDone: { color: Colors.success, fontWeight: '600' },

  sectionTitle: { fontSize: 15, fontWeight: '800', color: Colors.textPrimary, marginBottom: 10 },
  bodyText:     { fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },

  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  bullet:    { width: 6, height: 6, borderRadius: 3, marginTop: 6 },
  bulletText:{ flex: 1, fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },

  counterItem: {
    backgroundColor: Colors.background, borderRadius: 10,
    padding: 12, marginBottom: 8,
  },
  counterHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  counterNum: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: Colors.primary,
    color: Colors.white, fontSize: 12, fontWeight: '700',
    textAlign: 'center', lineHeight: 22,
  },
  counterPoint: { fontSize: 14, fontWeight: '700', color: Colors.primary, flex: 1 },

  counterDocBtn: { backgroundColor: '#6C3CE1', borderRadius: 14 },

  copyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-end',
    backgroundColor: Colors.white,
    borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: Colors.border,
  },
  copyBtnText: { fontSize: 13, color: Colors.primary, fontWeight: '600' },

  docScroll: { maxHeight: 600 },
  docText: {
    fontSize: 13, color: Colors.textPrimary,
    lineHeight: 21, fontFamily: 'monospace',
  },
});
