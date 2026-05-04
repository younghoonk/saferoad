import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { Button } from '../../components/Button';
import { Colors } from '../../constants';
import { INSURANCE_COMPANIES } from '../../constants';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

interface DirectHireScreenProps {
  onBack: () => void;
  onSubmit: () => void;
}

const REGIONS = [
  '전국', '서울', '경기', '인천', '부산', '대구', '광주', '대전',
  '경남', '경북', '충남', '충북', '전남', '전북', '강원', '제주',
];

export function DirectHireScreen({ onBack, onSubmit }: DirectHireScreenProps) {
  const { session } = useAuth();
  const insets = useSafeAreaInsets();

  const [insuranceCompany, setInsuranceCompany] = useState('');
  const [region,           setRegion]           = useState('전국');
  const [description,      setDescription]      = useState('');
  const [images,           setImages]           = useState<string[]>([]);
  const [loading,          setLoading]          = useState(false);
  const [uploadProgress,   setUploadProgress]   = useState('');

  const isValid = insuranceCompany && description.trim();

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('권한 필요', '사진 접근 권한이 필요합니다.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (!result.canceled) {
      const uris = result.assets.map((a) => a.uri);
      setImages((prev) => [...prev, ...uris].slice(0, 5));
    }
  };

  const uploadImages = async (): Promise<string[]> => {
    if (images.length === 0) return [];
    const userId = session!.user.id;
    const results: string[] = [];
    for (let i = 0; i < images.length; i++) {
      setUploadProgress(`사진 업로드 중 (${i + 1}/${images.length})...`);
      const response = await fetch(images[i]);
      const blob     = await response.blob();
      const buffer   = await blob.arrayBuffer();
      const filename = `${userId}/${Date.now()}_${i}.jpg`;
      const { data, error } = await supabase.storage
        .from('case-images')
        .upload(filename, buffer, { contentType: 'image/jpeg', upsert: false });
      if (error) { console.warn('이미지 업로드 실패:', error.message); continue; }
      const { data: urlData } = supabase.storage.from('case-images').getPublicUrl(data.path);
      results.push(urlData.publicUrl);
    }
    return results;
  };

  const handleSubmit = async () => {
    if (!isValid) { Alert.alert('입력 오류', '보험사와 내용을 입력해주세요.'); return; }
    if (!session) { Alert.alert('오류', '로그인이 필요합니다.'); return; }
    setLoading(true);
    try {
      const imageUrls = await uploadImages();
      setUploadProgress('등록 중...');
      const autoTitle = description.trim().slice(0, 30) + (description.length > 30 ? '...' : '');
      const { error } = await supabase.from('cases').insert({
        customer_id:       session.user.id,
        title:             autoTitle,
        accident_type:     '소비자직접선임권',
        insurance_company: insuranceCompany,
        region,
        description:       description.trim(),
        images:            imageUrls,
        status:            'pending',
      });
      if (error) { Alert.alert('등록 실패', error.message); return; }
      Alert.alert(
        '✅ 등록 완료!',
        '소비자직접선임권 요청이 등록되었습니다.\n전문 손해사정사들이 검토 후 프로필을 보내드릴게요.',
        [{ text: '확인', onPress: onSubmit }],
      );
    } catch (e: any) {
      Alert.alert('오류', e?.message ?? '알 수 없는 오류가 발생했습니다.');
    } finally {
      setLoading(false);
      setUploadProgress('');
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* 헤더 */}
      <LinearGradient
        colors={[Colors.primaryDark, Colors.accent]}
        style={[styles.header, { paddingTop: insets.top + 12 }]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Ionicons name="chevron-back" size={24} color={Colors.white} />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <View style={styles.headerBadge}>
            <Ionicons name="shield-checkmark" size={13} color="#C4B5FD" />
            <Text style={styles.headerBadgeText}>소비자 권리</Text>
          </View>
          <Text style={styles.headerTitle}>소비자직접선임권</Text>
          <Text style={styles.headerSubtitle}>보험사 추천 없이 내가 직접 손해사정사를 선임할 수 있어요</Text>
        </View>
      </LinearGradient>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* 안내 박스 */}
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <View style={styles.infoIconWrap}>
              <Ionicons name="information-circle" size={20} color={Colors.accent} />
            </View>
            <View style={styles.infoTextWrap}>
              <Text style={styles.infoTitle}>소비자직접선임권이란?</Text>
              <Text style={styles.infoDesc}>
                보험사가 일방적으로 지정한 손해사정사 대신, 소비자가 독립적인 손해사정사를 직접 선임할 수 있는 법적 권리입니다.
                공정한 손해사정을 통해 정당한 보험금을 받으세요.
              </Text>
            </View>
          </View>
        </View>

        {/* 보험사 */}
        <View style={styles.section}>
          <Text style={styles.label}>보험사 <Text style={styles.required}>*</Text></Text>
          <View style={styles.chipGrid}>
            {INSURANCE_COMPANIES.map((company) => (
              <TouchableOpacity
                key={company}
                style={[styles.chip, insuranceCompany === company && styles.chipSelected]}
                onPress={() => setInsuranceCompany(company)}
              >
                <Text style={[styles.chipText, insuranceCompany === company && styles.chipTextSelected]}>
                  {company}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* 지역 선택 */}
        <View style={styles.section}>
          <Text style={styles.label}>지역 <Text style={styles.required}>*</Text></Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.regionRow}
          >
            {REGIONS.map((r) => (
              <TouchableOpacity
                key={r}
                style={[styles.chip, region === r && styles.chipSelected]}
                onPress={() => setRegion(r)}
              >
                <Text style={[styles.chipText, region === r && styles.chipTextSelected]}>{r}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* 내용 입력 */}
        <View style={styles.section}>
          <Text style={styles.label}>내용 <Text style={styles.required}>*</Text></Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="사고 경위, 분쟁 내용, 보험사와의 갈등 상황, 요청 사항 등을 작성해주세요."
            placeholderTextColor={Colors.textMuted}
            value={description}
            onChangeText={setDescription}
            multiline
            textAlignVertical="top"
            maxLength={1000}
          />
          <Text style={styles.charCount}>{description.length}/1000</Text>
        </View>

        {/* 사진 첨부 */}
        <View style={styles.section}>
          <Text style={styles.label}>사진 첨부 (최대 5장)</Text>
          <View style={styles.imageGrid}>
            {images.map((uri, index) => (
              <View key={index} style={styles.imageWrap}>
                <Image source={{ uri }} style={styles.imageThumbnail} />
                <TouchableOpacity
                  style={styles.removeImageBtn}
                  onPress={() => setImages((prev) => prev.filter((_, i) => i !== index))}
                >
                  <Ionicons name="close-circle" size={22} color={Colors.danger} />
                </TouchableOpacity>
              </View>
            ))}
            {images.length < 5 && (
              <TouchableOpacity style={styles.addImageBtn} onPress={pickImage}>
                <Ionicons name="camera-outline" size={28} color={Colors.textMuted} />
                <Text style={styles.addImageText}>사진 추가</Text>
              </TouchableOpacity>
            )}
          </View>
          <Text style={styles.hint}>
            보험사 공문, 진단서, 사고 현장 사진 등을 첨부하면 더 정확한 안내를 받을 수 있어요
          </Text>
        </View>

        <View style={styles.securityBox}>
          <Ionicons name="lock-closed-outline" size={16} color={Colors.primary} />
          <Text style={styles.securityText}>
            등록하신 정보는 전문 손해사정사들만 열람 가능하며, 안전하게 보호됩니다.
          </Text>
        </View>

        {loading && uploadProgress ? (
          <View style={styles.progressBox}>
            <Ionicons name="cloud-upload-outline" size={16} color={Colors.accent} />
            <Text style={styles.progressText}>{uploadProgress}</Text>
          </View>
        ) : null}

        <View style={[styles.submitWrap, { paddingBottom: Math.max(insets.bottom + 16, 32) }]}>
          <Button
            title={loading ? '' : '소비자직접선임권 등록하기'}
            onPress={handleSubmit}
            disabled={!isValid}
            loading={loading}
            size="lg"
            style={styles.submitBtn}
          />
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: Colors.background },
  flex:      { flex: 1 },
  container: { flex: 1 },

  header: { paddingTop: 12, paddingBottom: 28, paddingHorizontal: 20 },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  headerContent: { gap: 6 },
  headerBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
  },
  headerBadgeText: { fontSize: 11, color: '#C4B5FD', fontWeight: '600' },
  headerTitle: { fontSize: 24, fontWeight: '900', color: Colors.white },
  headerSubtitle: { fontSize: 13, color: 'rgba(255,255,255,0.75)', lineHeight: 18 },

  infoCard: {
    margin: 16,
    backgroundColor: Colors.accent + '0D',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.accent + '25',
  },
  infoRow: { flexDirection: 'row', gap: 10 },
  infoIconWrap: { paddingTop: 2 },
  infoTextWrap: { flex: 1 },
  infoTitle: { fontSize: 13, fontWeight: '700', color: Colors.accent, marginBottom: 6 },
  infoDesc:  { fontSize: 12, color: Colors.textSecondary, lineHeight: 18 },

  section: {
    padding: 16,
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    marginBottom: 8,
  },
  label:    { fontSize: 14, fontWeight: '700', color: Colors.textPrimary, marginBottom: 12 },
  required: { color: Colors.danger },

  chipGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  regionRow: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 14, borderWidth: 1.2,
    borderColor: Colors.border, backgroundColor: Colors.white,
  },
  chipSelected:     { borderColor: Colors.accent, backgroundColor: Colors.accent + '10' },
  chipText:         { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' },
  chipTextSelected: { color: Colors.accent, fontWeight: '700' },

  input: {
    backgroundColor: Colors.inputBg,
    borderRadius: 14, padding: 14,
    fontSize: 14, color: Colors.textPrimary,
    borderWidth: 1.2, borderColor: Colors.border,
  },
  textArea:  { height: 160, paddingTop: 14 },
  charCount: { fontSize: 11, color: Colors.textMuted, textAlign: 'right', marginTop: 6 },

  imageGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  imageWrap:      { position: 'relative' },
  imageThumbnail: { width: 80, height: 80, borderRadius: 10 },
  removeImageBtn: { position: 'absolute', top: -6, right: -6 },
  addImageBtn: {
    width: 80, height: 80, borderRadius: 10,
    borderWidth: 1.5, borderColor: Colors.border, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.inputBg,
  },
  addImageText: { fontSize: 10, color: Colors.textMuted, marginTop: 4 },
  hint: { fontSize: 12, color: Colors.textMuted, lineHeight: 17 },

  securityBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: Colors.primary + '08',
    borderRadius: 12, padding: 14, margin: 16,
    borderWidth: 1, borderColor: Colors.primary + '20',
  },
  securityText: { flex: 1, fontSize: 12, color: Colors.primary, lineHeight: 17 },

  progressBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.accent + '12',
    borderRadius: 10, padding: 12,
    marginHorizontal: 16, marginBottom: 4,
  },
  progressText: { fontSize: 13, color: Colors.accent, fontWeight: '600' },

  submitWrap: { padding: 16, paddingBottom: 32 },
  submitBtn:  { borderRadius: 14, backgroundColor: Colors.primary },
});
