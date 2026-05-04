import React, { useEffect, useState } from 'react';
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
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { Header } from '../../components/Header';
import { Button } from '../../components/Button';
import { Colors } from '../../constants';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';

interface AdjusterProfileEditScreenProps {
  onBack: () => void;
  onSaved: () => void;
}

interface FormState {
  name: string;
  licenseNumber: string;
  yearsExperience: string;
  specialties: string[];
  region: string;
  intro: string;
  profileImageUri: string;
  resolvedCases: string;
  satisfactionRate: string;
}

const SPECIALTIES = ['교통사고', '화재사고', '상해사고', '재산피해', '의료사고', '산업재해'];
const REGIONS = [
  '전국', '서울', '경기', '인천', '부산', '대구', '광주', '대전', '울산',
  '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
];

export function AdjusterProfileEditScreen({ onBack, onSaved }: AdjusterProfileEditScreenProps) {
  const { profile, session, refreshProfile } = useAuth();
  const insets = useSafeAreaInsets();
  const [form, setForm] = useState<FormState>({
    name: profile?.name ?? '',
    licenseNumber: '',
    yearsExperience: '',
    specialties: [],
    region: '전국',
    intro: '',
    profileImageUri: profile?.profile_image ?? '',
    resolvedCases: '',
    satisfactionRate: '',
  });
  const [fetchLoading, setFetchLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!session) return;
    (async () => {
      const { data } = await supabase
        .from('adjuster_profiles')
        .select('license_number, years_experience, specialties, region, intro, resolved_cases, satisfaction_rate')
        .eq('id', session.user.id)
        .single();

      if (data) {
        setForm((prev) => ({
          ...prev,
          licenseNumber: data.license_number ?? '',
          yearsExperience: data.years_experience != null ? String(data.years_experience) : '',
          specialties: data.specialties ?? [],
          region: data.region || '전국',
          intro: data.intro ?? '',
          resolvedCases: data.resolved_cases != null ? String(data.resolved_cases) : '',
          satisfactionRate: data.satisfaction_rate != null ? String(data.satisfaction_rate) : '',
        }));
      }
      setFetchLoading(false);
    })();
  }, [session]);

  const setField = (key: keyof FormState, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const toggleSpecialty = (s: string) => {
    setForm((prev) => ({
      ...prev,
      specialties: prev.specialties.includes(s)
        ? prev.specialties.filter((x) => x !== s)
        : [...prev.specialties, s],
    }));
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('권한 필요', '사진 접근 권한이 필요합니다.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setField('profileImageUri', result.assets[0].uri);
    }
  };

  const uploadProfileImage = async (localUri: string): Promise<string> => {
    if (!session) return '';
    const resp = await fetch(localUri);
    const blob = await resp.blob();
    const buffer = await blob.arrayBuffer();
    const filename = `${session.user.id}/avatar.jpg`;
    const { data, error } = await supabase.storage
      .from('profile-images')
      .upload(filename, buffer, { contentType: 'image/jpeg', upsert: true });
    if (error || !data) return '';
    const { data: urlData } = supabase.storage.from('profile-images').getPublicUrl(data.path);
    return urlData.publicUrl;
  };

  const handleSave = async () => {
    if (!session) return;
    if (!form.name.trim()) { Alert.alert('입력 오류', '이름을 입력해주세요.'); return; }
    if (!form.intro.trim()) { Alert.alert('입력 오류', '한줄 소개를 입력해주세요.'); return; }
    if (form.specialties.length === 0) { Alert.alert('입력 오류', '전문분야를 하나 이상 선택해주세요.'); return; }

    setSaving(true);
    try {
      // 프로필 이미지 업로드 (새 이미지가 선택된 경우)
      let profileImageUrl = form.profileImageUri;
      if (form.profileImageUri.startsWith('file') || form.profileImageUri.startsWith('content')) {
        profileImageUrl = await uploadProfileImage(form.profileImageUri);
      }

      // profiles 테이블 업데이트
      await supabase.from('profiles').update({
        name: form.name.trim(),
        ...(profileImageUrl ? { profile_image: profileImageUrl } : {}),
      }).eq('id', session.user.id);

      // adjuster_profiles 테이블 업데이트
      await supabase.from('adjuster_profiles').update({
        years_experience: parseInt(form.yearsExperience) || 0,
        specialties: form.specialties,
        region: form.region,
        intro: form.intro.trim(),
        resolved_cases: parseInt(form.resolvedCases) || 0,
        satisfaction_rate: parseFloat(form.satisfactionRate) || 100.0,
      }).eq('id', session.user.id);

      await refreshProfile();
      Alert.alert('✅ 저장 완료', '프로필이 업데이트되었습니다.', [
        { text: '확인', onPress: onSaved },
      ]);
    } catch (e: any) {
      Alert.alert('오류', e?.message ?? '저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  };

  if (fetchLoading) {
    return (
      <SafeAreaView style={styles.safe}>
        <Header title="프로필 편집" showBack onBack={onBack} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <Header title="프로필 편집" subtitle="손해사정사 프로필" showBack onBack={onBack} />
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

        {/* 프로필 사진 */}
        <View style={styles.photoSection}>
          <LinearGradient
            colors={[Colors.primaryDark, Colors.primary]}
            style={styles.photoBg}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <TouchableOpacity style={styles.photoWrap} onPress={pickImage} activeOpacity={0.85}>
              {form.profileImageUri ? (
                <Image source={{ uri: form.profileImageUri }} style={styles.photoImg} />
              ) : (
                <View style={styles.photoPlaceholder}>
                  <Text style={styles.photoPlaceholderText}>{(form.name || '?')[0]}</Text>
                </View>
              )}
              <View style={styles.photoEditBadge}>
                <Ionicons name="camera" size={14} color={Colors.white} />
              </View>
            </TouchableOpacity>
            <Text style={styles.photoHint}>프로필 사진을 등록하면 신뢰도가 높아져요</Text>
          </LinearGradient>
        </View>

        {/* 이름 */}
        <View style={styles.formSection}>
          <Text style={styles.label}>이름 <Text style={styles.required}>*</Text></Text>
          <View style={styles.inputWrap}>
            <Ionicons name="person-outline" size={17} color={Colors.textMuted} />
            <TextInput
              style={styles.input}
              value={form.name}
              onChangeText={(v) => setField('name', v)}
              placeholder="이름을 입력하세요"
              placeholderTextColor={Colors.textMuted}
            />
          </View>
        </View>

        {/* 자격증 번호 */}
        <View style={styles.formSection}>
          <Text style={styles.label}>자격증 번호</Text>
          <View style={[styles.inputWrap, styles.inputWrapDisabled]}>
            <Ionicons name="id-card-outline" size={17} color={Colors.textMuted} />
            <TextInput
              style={styles.input}
              value={form.licenseNumber}
              editable={false}
              placeholder="자격증 번호"
              placeholderTextColor={Colors.textMuted}
            />
            <Ionicons name="lock-closed-outline" size={14} color={Colors.textMuted} />
          </View>
          <Text style={styles.hint}>가입 시 등록된 번호로 변경 불가합니다</Text>
        </View>

        {/* 경력 연수 */}
        <View style={styles.formSection}>
          <Text style={styles.label}>경력 연수</Text>
          <View style={styles.rowInputs}>
            <View style={[styles.inputWrap, { flex: 1 }]}>
              <Ionicons name="briefcase-outline" size={17} color={Colors.textMuted} />
              <TextInput
                style={styles.input}
                value={form.yearsExperience}
                onChangeText={(v) => setField('yearsExperience', v.replace(/[^0-9]/g, ''))}
                placeholder="0"
                placeholderTextColor={Colors.textMuted}
                keyboardType="numeric"
                maxLength={2}
              />
              <Text style={styles.unitText}>년</Text>
            </View>
            <View style={[styles.inputWrap, { flex: 1 }]}>
              <Ionicons name="checkmark-circle-outline" size={17} color={Colors.textMuted} />
              <TextInput
                style={styles.input}
                value={form.resolvedCases}
                onChangeText={(v) => setField('resolvedCases', v.replace(/[^0-9]/g, ''))}
                placeholder="0"
                placeholderTextColor={Colors.textMuted}
                keyboardType="numeric"
                maxLength={5}
              />
              <Text style={styles.unitText}>건 해결</Text>
            </View>
          </View>
        </View>

        {/* 고객 만족도 */}
        <View style={styles.formSection}>
          <Text style={styles.label}>고객 만족도</Text>
          <View style={[styles.inputWrap]}>
            <Ionicons name="happy-outline" size={17} color={Colors.textMuted} />
            <TextInput
              style={styles.input}
              value={form.satisfactionRate}
              onChangeText={(v) => setField('satisfactionRate', v.replace(/[^0-9.]/g, ''))}
              placeholder="100"
              placeholderTextColor={Colors.textMuted}
              keyboardType="decimal-pad"
              maxLength={5}
            />
            <Text style={styles.unitText}>%</Text>
          </View>
        </View>

        {/* 전문분야 */}
        <View style={styles.formSection}>
          <Text style={styles.label}>전문분야 <Text style={styles.required}>*</Text></Text>
          <Text style={styles.hint}>중복 선택 가능</Text>
          <View style={styles.chipGrid}>
            {SPECIALTIES.map((s) => {
              const selected = form.specialties.includes(s);
              return (
                <TouchableOpacity
                  key={s}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => toggleSpecialty(s)}
                  activeOpacity={0.8}
                >
                  {selected && (
                    <Ionicons name="checkmark" size={12} color={Colors.primary} style={{ marginRight: 3 }} />
                  )}
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{s}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* 활동 지역 */}
        <View style={styles.formSection}>
          <Text style={styles.label}>활동 지역</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.regionContent}
          >
            {REGIONS.map((r) => {
              const selected = form.region === r;
              return (
                <TouchableOpacity
                  key={r}
                  style={[styles.regionChip, selected && styles.regionChipSelected]}
                  onPress={() => setField('region', r)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.regionText, selected && styles.regionTextSelected]}>{r}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* 한줄 소개 */}
        <View style={styles.formSection}>
          <Text style={styles.label}>한줄 소개 <Text style={styles.required}>*</Text></Text>
          <TextInput
            style={[styles.inputRaw, styles.textArea]}
            value={form.intro}
            onChangeText={(v) => setField('intro', v)}
            placeholder="나를 소개하는 문장을 작성하세요&#10;예: 10년 경력의 교통사고 전문 손해사정사입니다"
            placeholderTextColor={Colors.textMuted}
            multiline
            textAlignVertical="top"
            maxLength={200}
          />
          <Text style={styles.charCount}>{form.intro.length}/200</Text>
        </View>

        {/* 프리뷰 */}
        <View style={styles.previewSection}>
          <Text style={styles.previewTitle}>👁 고객에게 보이는 프로필 미리보기</Text>
          <View style={styles.previewCard}>
            <View style={styles.previewRow}>
              <View style={styles.previewAvatar}>
                {form.profileImageUri ? (
                  <Image source={{ uri: form.profileImageUri }} style={styles.previewAvatarImg} />
                ) : (
                  <Text style={styles.previewAvatarText}>{(form.name || '?')[0]}</Text>
                )}
              </View>
              <View style={styles.previewInfo}>
                <Text style={styles.previewName}>{form.name || '이름'}</Text>
                <Text style={styles.previewLicense}>{form.licenseNumber || '자격증 번호'}</Text>
                <View style={styles.previewTags}>
                  {form.specialties.slice(0, 3).map((s) => (
                    <View key={s} style={styles.previewTag}>
                      <Text style={styles.previewTagText}>{s}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>
            {form.intro ? (
              <Text style={styles.previewIntro} numberOfLines={2}>{form.intro}</Text>
            ) : null}
            <View style={styles.previewStats}>
              {[
                { label: '경력', value: form.yearsExperience ? `${form.yearsExperience}년` : '-' },
                { label: '해결', value: form.resolvedCases ? `${form.resolvedCases}건` : '-' },
                { label: '만족도', value: form.satisfactionRate ? `${form.satisfactionRate}%` : '-' },
                { label: '지역', value: form.region || '전국' },
              ].map((s, i, arr) => (
                <React.Fragment key={s.label}>
                  <View style={styles.previewStatItem}>
                    <Text style={styles.previewStatNum}>{s.value}</Text>
                    <Text style={styles.previewStatLabel}>{s.label}</Text>
                  </View>
                  {i < arr.length - 1 && <View style={styles.previewStatDivider} />}
                </React.Fragment>
              ))}
            </View>
          </View>
        </View>

        <View style={[styles.submitWrap, { paddingBottom: Math.max(insets.bottom + 16, 32) }]}>
          <Button title="프로필 저장하기" onPress={handleSave} loading={saving} size="lg" style={styles.submitBtn} />
        </View>
        <View style={{ height: 40 }} />
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  photoSection: { marginBottom: 8 },
  photoBg: { paddingVertical: 32, alignItems: 'center', gap: 12 },
  photoWrap: { position: 'relative' },
  photoImg: { width: 90, height: 90, borderRadius: 45, borderWidth: 3, borderColor: 'rgba(255,255,255,0.5)' },
  photoPlaceholder: {
    width: 90, height: 90, borderRadius: 45,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.4)',
  },
  photoPlaceholderText: { fontSize: 36, fontWeight: '700', color: Colors.white },
  photoEditBadge: {
    position: 'absolute', bottom: 2, right: 2,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.accent,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.white,
  },
  photoHint: { fontSize: 12, color: 'rgba(255,255,255,0.75)' },

  formSection: {
    backgroundColor: Colors.white,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  label: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary, marginBottom: 10 },
  required: { color: Colors.danger },
  hint: { fontSize: 11, color: Colors.textMuted, marginBottom: 10, marginTop: -4 },
  charCount: { fontSize: 11, color: Colors.textMuted, textAlign: 'right', marginTop: 6 },

  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.inputBg, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 2,
    borderWidth: 1.2, borderColor: Colors.border,
  },
  inputWrapDisabled: { opacity: 0.6 },
  input: { flex: 1, fontSize: 14, color: Colors.textPrimary, paddingVertical: 12 },
  inputRaw: {
    backgroundColor: Colors.inputBg, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, color: Colors.textPrimary,
    borderWidth: 1.2, borderColor: Colors.border,
  },
  textArea: { height: 100, textAlignVertical: 'top' },
  unitText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '600' },

  rowInputs: { flexDirection: 'row', gap: 10 },

  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: 22, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  chipSelected: { borderColor: Colors.primary, backgroundColor: Colors.primary + '10' },
  chipText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' },
  chipTextSelected: { color: Colors.primary, fontWeight: '700' },

  regionContent: { gap: 8, paddingVertical: 2 },
  regionChip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 14, borderWidth: 1.2, borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  regionChipSelected: { borderColor: Colors.primary, backgroundColor: Colors.primary },
  regionText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' },
  regionTextSelected: { color: Colors.white, fontWeight: '700' },

  // 미리보기
  previewSection: {
    margin: 16,
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  previewTitle: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary, marginBottom: 14 },
  previewCard: { gap: 12 },
  previewRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  previewAvatar: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  previewAvatarImg: { width: 52, height: 52, borderRadius: 26 },
  previewAvatarText: { fontSize: 20, fontWeight: '700', color: Colors.white },
  previewInfo: { flex: 1 },
  previewName: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  previewLicense: { fontSize: 11, color: Colors.textSecondary, marginTop: 2, marginBottom: 6 },
  previewTags: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
  previewTag: { backgroundColor: Colors.primary + '12', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  previewTagText: { fontSize: 10, color: Colors.primary, fontWeight: '600' },
  previewIntro: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
  previewStats: {
    flexDirection: 'row',
    backgroundColor: Colors.background,
    borderRadius: 10, padding: 12,
  },
  previewStatItem: { flex: 1, alignItems: 'center' },
  previewStatNum: { fontSize: 13, fontWeight: '800', color: Colors.primary },
  previewStatLabel: { fontSize: 10, color: Colors.textSecondary, marginTop: 2 },
  previewStatDivider: { width: 1, backgroundColor: Colors.border },

  submitWrap: { padding: 16 },
  submitBtn: { borderRadius: 14 },
});
