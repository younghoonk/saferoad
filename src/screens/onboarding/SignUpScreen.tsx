import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Button } from '../../components/Button';
import { Colors } from '../../constants';
import { UserType } from '../../types';
import { useAuth } from '../../contexts/AuthContext';

interface SignUpScreenProps {
  userType: UserType;
  onBack: () => void;
  onSuccess: () => void;
  onLogin: () => void;
}

interface FormState {
  name: string;
  email: string;
  password: string;
  passwordConfirm: string;
  phone: string;
  licenseNumber: string;
}

interface FormErrors {
  name?: string;
  email?: string;
  password?: string;
  passwordConfirm?: string;
  phone?: string;
  licenseNumber?: string;
}

export function SignUpScreen({ userType, onBack, onSuccess, onLogin }: SignUpScreenProps) {
  const { signUp } = useAuth();
  const insets = useSafeAreaInsets();
  const [form, setForm] = useState<FormState>({
    name: '',
    email: '',
    password: '',
    passwordConfirm: '',
    phone: '',
    licenseNumber: '',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  const isAdjuster = userType === 'adjuster';

  const setField = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length <= 3) return digits;
    if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
  };

  const validate = (): boolean => {
    const newErrors: FormErrors = {};
    if (!form.name.trim()) newErrors.name = '이름을 입력해주세요';
    if (!form.email.trim()) {
      newErrors.email = '이메일을 입력해주세요';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      newErrors.email = '올바른 이메일 형식이 아닙니다';
    }
    if (!form.password) {
      newErrors.password = '비밀번호를 입력해주세요';
    } else if (form.password.length < 8) {
      newErrors.password = '비밀번호는 8자 이상이어야 합니다';
    }
    if (form.password !== form.passwordConfirm) {
      newErrors.passwordConfirm = '비밀번호가 일치하지 않습니다';
    }
    if (!form.phone.trim()) {
      newErrors.phone = '전화번호를 입력해주세요';
    } else if (form.phone.replace(/\D/g, '').length < 10) {
      newErrors.phone = '올바른 전화번호를 입력해주세요';
    }
    if (isAdjuster && !form.licenseNumber.trim()) {
      newErrors.licenseNumber = '손해사정사 자격번호를 입력해주세요';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      const { error } = await signUp({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        phone: form.phone,
        userType,
        licenseNumber: form.licenseNumber.trim() || undefined,
      });

      if (error) {
        Alert.alert('회원가입 실패', error);
        return;
      }

      // Supabase 기본 설정은 이메일 인증 필요 → 인증 없이 바로 로그인되는 경우도 있음
      Alert.alert(
        '🎉 회원가입 완료!',
        `환영합니다, ${form.name}님!\n\n이메일 인증 후 로그인해주세요.\n(Supabase 대시보드에서 이메일 인증을 비활성화하면 바로 입장 가능합니다)`,
        [{ text: '로그인하기', onPress: onLogin }]
      );
    } finally {
      setLoading(false);
    }
  };

  const passwordStrength = (): { level: number; label: string; color: string } => {
    const p = form.password;
    if (!p) return { level: 0, label: '', color: Colors.border };
    let score = 0;
    if (p.length >= 8) score++;
    if (/[A-Z]/.test(p)) score++;
    if (/[0-9]/.test(p)) score++;
    if (/[^A-Za-z0-9]/.test(p)) score++;
    if (score <= 1) return { level: 1, label: '약함', color: Colors.danger };
    if (score === 2) return { level: 2, label: '보통', color: Colors.warning };
    return { level: 3, label: '강함', color: Colors.success };
  };

  const strength = passwordStrength();

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* 헤더 */}
        <LinearGradient
          colors={[Colors.primaryDark, Colors.primary]}
          style={[styles.header, { paddingTop: insets.top + 16 }]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <TouchableOpacity style={styles.backBtn} onPress={onBack}>
            <Ionicons name="chevron-back" size={24} color={Colors.white} />
          </TouchableOpacity>
          <View style={styles.headerContent}>
            <View style={styles.typeBadge}>
              <Ionicons name={isAdjuster ? 'briefcase' : 'person'} size={14} color={Colors.white} />
              <Text style={styles.typeBadgeText}>{isAdjuster ? '손해사정사' : '고객'}</Text>
            </View>
            <Text style={styles.headerTitle}>회원가입</Text>
            <Text style={styles.headerSubtitle}>
              {isAdjuster ? '전문가 계정으로 사건을 수임하세요' : '지금 바로 시작해보세요'}
            </Text>
          </View>
        </LinearGradient>

        <ScrollView
          style={styles.form}
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom + 16, 32) }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* 이름 */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>이름 <Text style={styles.required}>*</Text></Text>
            <View style={[styles.inputWrap, errors.name ? styles.inputError : null]}>
              <Ionicons name="person-outline" size={18} color={Colors.textMuted} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="홍길동"
                placeholderTextColor={Colors.textMuted}
                value={form.name}
                onChangeText={(v) => setField('name', v)}
                returnKeyType="next"
              />
            </View>
            {errors.name ? <Text style={styles.errorText}>{errors.name}</Text> : null}
          </View>

          {/* 이메일 */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>이메일 <Text style={styles.required}>*</Text></Text>
            <View style={[styles.inputWrap, errors.email ? styles.inputError : null]}>
              <Ionicons name="mail-outline" size={18} color={Colors.textMuted} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="example@email.com"
                placeholderTextColor={Colors.textMuted}
                value={form.email}
                onChangeText={(v) => setField('email', v.trim())}
                keyboardType="email-address"
                autoCapitalize="none"
                returnKeyType="next"
              />
            </View>
            {errors.email ? <Text style={styles.errorText}>{errors.email}</Text> : null}
          </View>

          {/* 전화번호 */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>전화번호 <Text style={styles.required}>*</Text></Text>
            <View style={[styles.inputWrap, errors.phone ? styles.inputError : null]}>
              <Ionicons name="call-outline" size={18} color={Colors.textMuted} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="010-0000-0000"
                placeholderTextColor={Colors.textMuted}
                value={form.phone}
                onChangeText={(v) => setField('phone', formatPhone(v))}
                keyboardType="phone-pad"
                maxLength={13}
                returnKeyType="next"
              />
            </View>
            {errors.phone ? <Text style={styles.errorText}>{errors.phone}</Text> : null}
          </View>

          {/* 자격번호 (손해사정사 전용) */}
          {isAdjuster && (
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>손해사정사 자격번호 <Text style={styles.required}>*</Text></Text>
              <View style={[styles.inputWrap, errors.licenseNumber ? styles.inputError : null]}>
                <Ionicons name="id-card-outline" size={18} color={Colors.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="ADJ-0000-0000"
                  placeholderTextColor={Colors.textMuted}
                  value={form.licenseNumber}
                  onChangeText={(v) => setField('licenseNumber', v)}
                  autoCapitalize="characters"
                  returnKeyType="next"
                />
              </View>
              {errors.licenseNumber ? <Text style={styles.errorText}>{errors.licenseNumber}</Text> : null}
            </View>
          )}

          {/* 비밀번호 */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>비밀번호 <Text style={styles.required}>*</Text></Text>
            <View style={[styles.inputWrap, errors.password ? styles.inputError : null]}>
              <Ionicons name="lock-closed-outline" size={18} color={Colors.textMuted} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="8자 이상 입력"
                placeholderTextColor={Colors.textMuted}
                value={form.password}
                onChangeText={(v) => setField('password', v)}
                secureTextEntry={!showPassword}
                returnKeyType="next"
              />
              <TouchableOpacity onPress={() => setShowPassword((v) => !v)} style={styles.eyeBtn}>
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
            {form.password.length > 0 && (
              <View style={styles.strengthRow}>
                <View style={styles.strengthBars}>
                  {[1, 2, 3].map((i) => (
                    <View
                      key={i}
                      style={[styles.strengthBar, { backgroundColor: i <= strength.level ? strength.color : Colors.border }]}
                    />
                  ))}
                </View>
                <Text style={[styles.strengthLabel, { color: strength.color }]}>{strength.label}</Text>
              </View>
            )}
            {errors.password ? <Text style={styles.errorText}>{errors.password}</Text> : null}
          </View>

          {/* 비밀번호 확인 */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>비밀번호 확인 <Text style={styles.required}>*</Text></Text>
            <View style={[styles.inputWrap, errors.passwordConfirm ? styles.inputError : null]}>
              <Ionicons name="lock-closed-outline" size={18} color={Colors.textMuted} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="비밀번호 재입력"
                placeholderTextColor={Colors.textMuted}
                value={form.passwordConfirm}
                onChangeText={(v) => setField('passwordConfirm', v)}
                secureTextEntry={!showPasswordConfirm}
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
              />
              <TouchableOpacity onPress={() => setShowPasswordConfirm((v) => !v)} style={styles.eyeBtn}>
                <Ionicons name={showPasswordConfirm ? 'eye-off-outline' : 'eye-outline'} size={18} color={Colors.textMuted} />
              </TouchableOpacity>
              {form.passwordConfirm.length > 0 && form.password === form.passwordConfirm && (
                <Ionicons name="checkmark-circle" size={18} color={Colors.success} style={{ marginLeft: 4 }} />
              )}
            </View>
            {errors.passwordConfirm ? <Text style={styles.errorText}>{errors.passwordConfirm}</Text> : null}
          </View>

          {/* 제출 */}
          <View style={styles.submitSection}>
            <Button title="회원가입" onPress={handleSubmit} loading={loading} size="lg" style={styles.submitBtn} />
            <View style={styles.loginRow}>
              <Text style={styles.loginText}>이미 계정이 있으신가요? </Text>
              <TouchableOpacity onPress={onLogin}>
                <Text style={styles.loginLink}>로그인</Text>
              </TouchableOpacity>
            </View>
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
  header: { paddingTop: 16, paddingBottom: 28, paddingHorizontal: 20 },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  headerContent: { gap: 6 },
  typeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignSelf: 'flex-start', borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  typeBadgeText: { fontSize: 12, color: Colors.white, fontWeight: '600' },
  headerTitle: { fontSize: 26, fontWeight: '900', color: Colors.white },
  headerSubtitle: { fontSize: 14, color: 'rgba(255,255,255,0.75)' },
  form: { flex: 1, padding: 18 },
  fieldGroup: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary, marginBottom: 8 },
  required: { color: Colors.danger },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.white, borderRadius: 14,
    borderWidth: 1.2, borderColor: Colors.border,
    paddingHorizontal: 14, paddingVertical: 2,
  },
  inputError: { borderColor: Colors.danger },
  inputIcon: { marginRight: 8 },
  input: { flex: 1, fontSize: 15, color: Colors.textPrimary, paddingVertical: 13 },
  eyeBtn: { padding: 4 },
  errorText: { fontSize: 12, color: Colors.danger, marginTop: 5, marginLeft: 2 },
  strengthRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  strengthBars: { flexDirection: 'row', gap: 4 },
  strengthBar: { width: 36, height: 4, borderRadius: 2 },
  strengthLabel: { fontSize: 12, fontWeight: '600' },
  submitSection: { marginTop: 8 },
  submitBtn: { borderRadius: 14 },
  loginRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 20 },
  loginText: { fontSize: 14, color: Colors.textSecondary },
  loginLink: { fontSize: 14, color: Colors.primary, fontWeight: '700' },
});
