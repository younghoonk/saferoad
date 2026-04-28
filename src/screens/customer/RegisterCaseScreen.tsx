import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  SafeAreaView,
  Alert,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Header } from '../../components/Header';
import { Button } from '../../components/Button';
import { Colors } from '../../constants';
import { ACCIDENT_TYPES, INSURANCE_COMPANIES } from '../../constants';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

interface RegisterCaseScreenProps {
  onBack: () => void;
  onSubmit: () => void;
}

const REGIONS = [
  '전국', '서울', '경기', '인천', '부산', '대구', '광주', '대전',
  '경남', '경북', '충남', '충북', '전남', '전북', '강원', '제주',
];

export function RegisterCaseScreen({ onBack, onSubmit }: RegisterCaseScreenProps) {
  const { session } = useAuth();

  const [accidentType,     setAccidentType]     = useState('');
  const [insuranceCompany, setInsuranceCompany] = useState('');
  const [region,           setRegion]           = useState('전국');
  const [title,            setTitle]            = useState('');
  const [description,      setDescription]      = useState('');
  const [images,           setImages]           = useState<string[]>([]);
  const [loading,          setLoading]          = useState(false);
  const [uploadProgress,   setUploadProgress]   = useState('');

  const isValid = accidentType && insuranceCompany && title.trim() && description.trim();

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
    if (!isValid) { Alert.alert('입력 오류', '모든 항목을 입력해주세요.'); return; }
    if (!session) { Alert.alert('오류', '로그인이 필요합니다.'); return; }
    setLoading(true);
    try {
      const imageUrls = await uploadImages();
      setUploadProgress('사건 등록 중...');
      const { error } = await supabase.from('cases').insert({
        customer_id:       session.user.id,
        title:             title.trim(),
        accident_type:     accidentType,
        insurance_company: insuranceCompany,
        region,
        description:       description.trim(),
        images:            imageUrls,
        status:            'pending',
      });
      if (error) { Alert.alert('등록 실패', error.message); return; }
      Alert.alert(
        '✅ 등록 완료!',
        '사건이 등록되었습니다.\n전문 손해사정사들이 검토 후 프로필을 보내드릴게요.',
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
      <Header title="사건 등록" showBack onBack={onBack} />
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>

        {/* 사고 유형 */}
        <View style={styles.section}>
          <Text style={styles.label}>사고 유형 <Text style={styles.required}>*</Text></Text>
          <View style={styles.chipGrid}>
            {ACCIDENT_TYPES.map((type) => (
              <TouchableOpacity
                key={type}
                style={[styles.chip, accidentType === type && styles.chipSelected]}
                onPress={() => setAccidentType(type)}
              >
                <Text style={[styles.chipText, accidentType === type && styles.chipTextSelected]}>
                  {type}
                </Text>
              </TouchableOpacity>
            ))}
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
          <Text style={styles.label}>사고 지역 <Text style={styles.required}>*</Text></Text>
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

        {/* 사건 제목 */}
        <View style={styles.section}>
          <Text style={styles.label}>사건 제목 <Text style={styles.required}>*</Text></Text>
          <TextInput
            style={styles.input}
            placeholder="예: 교통사고 후 보험사 과실 비율 분쟁"
            placeholderTextColor={Colors.textMuted}
            value={title}
            onChangeText={setTitle}
            maxLength={50}
            returnKeyType="next"
          />
          <Text style={styles.charCount}>{title.length}/50</Text>
        </View>

        {/* 사고 내용 */}
        <View style={styles.section}>
          <Text style={styles.label}>사고 내용 <Text style={styles.required}>*</Text></Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="사고 일시, 장소, 경위, 피해 내용 등을 상세히 작성해주세요."
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
                <TouchableOpacity style={styles.removeImageBtn} onPress={() => setImages((prev) => prev.filter((_, i) => i !== index))}>
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
            사고 현장, 진단서, 영수증 등 관련 사진을 첨부하면 더 정확한 견적을 받을 수 있어요
          </Text>
        </View>

        {/* 안내 박스 */}
        <View style={styles.infoBox}>
          <Ionicons name="shield-checkmark" size={20} color={Colors.primary} />
          <Text style={styles.infoText}>
            등록하신 사건 정보는 전문 손해사정사들만 열람 가능하며, 안전하게 보호됩니다.
          </Text>
        </View>

        {loading && uploadProgress ? (
          <View style={styles.progressBox}>
            <Ionicons name="cloud-upload-outline" size={16} color={Colors.accent} />
            <Text style={styles.progressText}>{uploadProgress}</Text>
          </View>
        ) : null}

        <View style={styles.submitWrap}>
          <Button
            title={loading ? '' : '견적 요청하기'}
            onPress={handleSubmit}
            disabled={!isValid}
            loading={loading}
            size="lg"
            style={styles.submitBtn}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: Colors.background },
  container: { flex: 1 },
  section: {
    padding: 16,
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    marginBottom: 8,
  },
  label:    { fontSize: 14, fontWeight: '700', color: Colors.textPrimary, marginBottom: 12 },
  required: { color: Colors.danger },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  regionRow: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1.5,
    borderColor: Colors.border, backgroundColor: Colors.white,
  },
  chipSelected:     { borderColor: Colors.primary, backgroundColor: Colors.primary + '10' },
  chipText:         { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' },
  chipTextSelected: { color: Colors.primary, fontWeight: '700' },
  input: {
    backgroundColor: Colors.inputBg,
    borderRadius: 12, padding: 14,
    fontSize: 14, color: Colors.textPrimary,
    borderWidth: 1, borderColor: Colors.border,
  },
  textArea:  { height: 130, paddingTop: 14 },
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
  infoBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: Colors.primary + '08',
    borderRadius: 12, padding: 14, margin: 16,
    borderWidth: 1, borderColor: Colors.primary + '20',
  },
  infoText: { flex: 1, fontSize: 12, color: Colors.primary, lineHeight: 17 },
  progressBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.accent + '12',
    borderRadius: 10, padding: 12,
    marginHorizontal: 16, marginBottom: 4,
  },
  progressText: { fontSize: 13, color: Colors.accent, fontWeight: '600' },
  submitWrap: { padding: 16, paddingBottom: 32 },
  submitBtn:  { borderRadius: 14 },
});
