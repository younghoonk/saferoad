import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Button } from '../../components/Button';
import { Colors } from '../../constants';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';

interface LoginScreenProps {
  onBack: () => void;
  onSuccess: () => void;
  onSignUp: () => void;
}

export function LoginScreen({ onBack, onSuccess, onSignUp }: LoginScreenProps) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState('');

  const validate = (): boolean => {
    let valid = true;
    setEmailError('');
    setPasswordError('');
    if (!email.trim()) {
      setEmailError('이메일을 입력해주세요');
      valid = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError('올바른 이메일 형식이 아닙니다');
      valid = false;
    }
    if (!password) {
      setPasswordError('비밀번호를 입력해주세요');
      valid = false;
    }
    return valid;
  };

  const handleLogin = async () => {
    if (!validate()) return;
    setLoginError('');
    setLoading(true);
    try {
      const { error } = await signIn(email.trim(), password);
      if (error) {
        setLoginError(error);
        return;
      }
      onSuccess();
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      Alert.alert('비밀번호 찾기', '이메일을 먼저 입력해주세요.');
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
    if (error) {
      Alert.alert('오류', error.message);
    } else {
      Alert.alert('이메일 발송', `${email}으로 재설정 링크를 보냈습니다.\n메일함을 확인해주세요.`);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* 헤더 */}
        <LinearGradient
          colors={[Colors.primaryDark, Colors.primary]}
          style={styles.header}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <TouchableOpacity style={styles.backBtn} onPress={onBack}>
            <Ionicons name="chevron-back" size={24} color={Colors.white} />
          </TouchableOpacity>
          <View style={styles.logoRow}>
            <View style={styles.logoIcon}>
              <Ionicons name="shield-checkmark" size={32} color={Colors.white} />
            </View>
            <Text style={styles.logoText}>SAFE ROAD</Text>
          </View>
          <Text style={styles.headerTitle}>로그인</Text>
          <Text style={styles.headerSubtitle}>계정에 로그인하여 계속하세요</Text>
        </LinearGradient>

        <ScrollView style={styles.form} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {/* 이메일 */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>이메일</Text>
            <View style={[styles.inputWrap, emailError ? styles.inputError : null]}>
              <Ionicons name="mail-outline" size={18} color={Colors.textMuted} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="example@email.com"
                placeholderTextColor={Colors.textMuted}
                value={email}
                onChangeText={(v) => { setEmail(v.trim()); setEmailError(''); }}
                keyboardType="email-address"
                autoCapitalize="none"
                returnKeyType="next"
              />
              {email.length > 0 && (
                <TouchableOpacity onPress={() => setEmail('')}>
                  <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>
            {emailError ? <Text style={styles.errorText}>{emailError}</Text> : null}
          </View>

          {/* 비밀번호 */}
          <View style={styles.fieldGroup}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>비밀번호</Text>
              <TouchableOpacity onPress={handleForgotPassword}>
                <Text style={styles.forgotText}>비밀번호 찾기</Text>
              </TouchableOpacity>
            </View>
            <View style={[styles.inputWrap, passwordError ? styles.inputError : null]}>
              <Ionicons name="lock-closed-outline" size={18} color={Colors.textMuted} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="비밀번호 입력"
                placeholderTextColor={Colors.textMuted}
                value={password}
                onChangeText={(v) => { setPassword(v); setPasswordError(''); }}
                secureTextEntry={!showPassword}
                returnKeyType="done"
                onSubmitEditing={handleLogin}
              />
              <TouchableOpacity onPress={() => setShowPassword((v) => !v)} style={styles.eyeBtn}>
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
            {passwordError ? <Text style={styles.errorText}>{passwordError}</Text> : null}
          </View>

          <Button title="로그인" onPress={handleLogin} loading={loading} size="lg" style={styles.loginBtn} />

          {loginError ? (
            <View style={styles.loginErrorBox}>
              <Ionicons name="alert-circle-outline" size={16} color={Colors.danger} />
              <Text style={styles.loginErrorText}>{loginError}</Text>
            </View>
          ) : null}

          {/* 구분선 */}
          <View style={styles.dividerRow}>
            <View style={styles.divider} />
            <Text style={styles.dividerText}>또는</Text>
            <View style={styles.divider} />
          </View>

          {/* 소셜 로그인 (UI only) */}
          <View style={styles.socialRow}>
            {[
              { label: '카카오', bg: '#FEE500', text: 'K', textColor: '#3C1E1E' },
              { label: '네이버', bg: '#03C75A', text: 'N', textColor: '#fff' },
              { label: '구글',  bg: '#fff',    text: 'G', textColor: '#4285F4', border: true },
            ].map((s) => (
              <TouchableOpacity
                key={s.label}
                style={styles.socialBtn}
                onPress={() => Alert.alert('준비 중', `${s.label} 로그인 준비 중입니다.`)}
              >
                <View style={[
                  styles.socialIcon,
                  { backgroundColor: s.bg },
                  s.border ? { borderWidth: 1, borderColor: Colors.border } : null,
                ]}>
                  <Text style={[styles.socialIconText, { color: s.textColor }]}>{s.text}</Text>
                </View>
                <Text style={styles.socialBtnText}>{s.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.signUpRow}>
            <Text style={styles.signUpText}>아직 계정이 없으신가요? </Text>
            <TouchableOpacity onPress={onSignUp}>
              <Text style={styles.signUpLink}>회원가입</Text>
            </TouchableOpacity>
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
  header: { paddingTop: 16, paddingBottom: 32, paddingHorizontal: 20, gap: 8 },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  logoText: { fontSize: 20, fontWeight: '900', color: Colors.white, letterSpacing: 2 },
  headerTitle: { fontSize: 26, fontWeight: '900', color: Colors.white },
  headerSubtitle: { fontSize: 14, color: 'rgba(255,255,255,0.75)' },
  form: { flex: 1, padding: 20 },
  fieldGroup: { marginBottom: 16 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  label: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary, marginBottom: 8 },
  forgotText: { fontSize: 13, color: Colors.accent, fontWeight: '600' },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.white, borderRadius: 12,
    borderWidth: 1.5, borderColor: Colors.border,
    paddingHorizontal: 14, paddingVertical: 2,
  },
  inputError: { borderColor: Colors.danger },
  inputIcon: { marginRight: 8 },
  input: { flex: 1, fontSize: 15, color: Colors.textPrimary, paddingVertical: 13 },
  eyeBtn: { padding: 4 },
  errorText: { fontSize: 12, color: Colors.danger, marginTop: 5, marginLeft: 2 },
  loginBtn: { borderRadius: 14, marginTop: 4 },
  loginErrorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.danger + '10',
    borderWidth: 1, borderColor: Colors.danger + '30',
    borderRadius: 10, padding: 12, marginTop: 10,
  },
  loginErrorText: { flex: 1, fontSize: 13, color: Colors.danger, fontWeight: '500' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 24 },
  divider: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: { fontSize: 13, color: Colors.textMuted },
  socialRow: { flexDirection: 'row', justifyContent: 'center', gap: 24 },
  socialBtn: { alignItems: 'center', gap: 6 },
  socialIcon: {
    width: 52, height: 52, borderRadius: 26,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08, shadowRadius: 4, elevation: 2,
  },
  socialIconText: { fontSize: 18, fontWeight: '900' },
  socialBtnText: { fontSize: 12, color: Colors.textSecondary },
  signUpRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 28 },
  signUpText: { fontSize: 14, color: Colors.textSecondary },
  signUpLink: { fontSize: 14, color: Colors.primary, fontWeight: '700' },
});
