import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants';
import { UserType } from '../../types';

const { width } = Dimensions.get('window');

interface OnboardingScreenProps {
  onSelect: (type: UserType) => void;
  onLogin: () => void;
}

export function OnboardingScreen({ onSelect, onLogin }: OnboardingScreenProps) {
  const [selected, setSelected] = useState<UserType | null>(null);

  const handleSelect = (type: UserType) => {
    setSelected(type);
  };

  const handleStart = () => {
    if (selected) onSelect(selected);
  };

  return (
    <LinearGradient
      colors={[Colors.primaryDark, Colors.primary, Colors.primaryLight]}
      style={styles.container}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
    >
      <SafeAreaView style={styles.safe}>
        {/* 로고 */}
        <View style={styles.header}>
          <Text style={styles.logo}>SAFE ROAD</Text>
          <Text style={styles.tagline}>보험 분쟁, 전문가와 함께 해결하세요</Text>
        </View>

        {/* 아이콘 */}
        <View style={styles.shieldContainer}>
          <View style={styles.shieldBg}>
            <Ionicons name="shield-checkmark" size={72} color={Colors.white} />
          </View>
        </View>

        {/* 카드 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>시작하기</Text>
          <Text style={styles.cardSubtitle}>어떤 역할로 이용하시나요?</Text>

          <View style={styles.options}>
            {/* 고객 */}
            <TouchableOpacity
              style={[styles.option, selected === 'customer' && styles.optionSelected]}
              onPress={() => handleSelect('customer')}
              activeOpacity={0.85}
            >
              <View style={[styles.optionIcon, selected === 'customer' && styles.optionIconSelected]}>
                <Ionicons
                  name="person"
                  size={28}
                  color={selected === 'customer' ? Colors.white : Colors.primary}
                />
              </View>
              <Text style={[styles.optionTitle, selected === 'customer' && styles.optionTitleSelected]}>
                고객
              </Text>
              <Text style={styles.optionDesc}>
                보험 분쟁 해결이{'\n'}필요해요
              </Text>
              {selected === 'customer' && (
                <View style={styles.checkIcon}>
                  <Ionicons name="checkmark-circle" size={20} color={Colors.primary} />
                </View>
              )}
            </TouchableOpacity>

            {/* 손해사정사 */}
            <TouchableOpacity
              style={[styles.option, selected === 'adjuster' && styles.optionSelected]}
              onPress={() => handleSelect('adjuster')}
              activeOpacity={0.85}
            >
              <View style={[styles.optionIcon, selected === 'adjuster' && styles.optionIconSelected]}>
                <Ionicons
                  name="briefcase"
                  size={28}
                  color={selected === 'adjuster' ? Colors.white : Colors.primary}
                />
              </View>
              <Text style={[styles.optionTitle, selected === 'adjuster' && styles.optionTitleSelected]}>
                손해사정사
              </Text>
              <Text style={styles.optionDesc}>
                전문가로 사건을{'\n'}수임하고 싶어요
              </Text>
              {selected === 'adjuster' && (
                <View style={styles.checkIcon}>
                  <Ionicons name="checkmark-circle" size={20} color={Colors.primary} />
                </View>
              )}
            </TouchableOpacity>
          </View>

          {/* 시작하기 버튼 */}
          <TouchableOpacity
            style={[styles.startBtn, !selected && styles.startBtnDisabled]}
            onPress={handleStart}
            disabled={!selected}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={selected ? [Colors.primary, Colors.primaryLight] : [Colors.border, Colors.border]}
              style={styles.startBtnGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              <Text style={[styles.startBtnText, !selected && styles.startBtnTextDisabled]}>
                {selected
                  ? `${selected === 'customer' ? '고객' : '손해사정사'}으로 회원가입`
                  : '유형을 선택해주세요'}
              </Text>
              {selected && (
                <Ionicons name="arrow-forward" size={18} color={Colors.white} />
              )}
            </LinearGradient>
          </TouchableOpacity>

          {/* 로그인 링크 */}
          <View style={styles.loginRow}>
            <Text style={styles.loginText}>이미 계정이 있으신가요? </Text>
            <TouchableOpacity onPress={onLogin} activeOpacity={0.7}>
              <Text style={styles.loginLink}>로그인</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.terms}>
            가입 시{' '}
            <Text style={styles.termsLink}>이용약관</Text> 및{' '}
            <Text style={styles.termsLink}>개인정보처리방침</Text>에 동의합니다
          </Text>
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { alignItems: 'center', marginBottom: 24 },
  logo: {
    fontSize: 32,
    fontWeight: '900',
    color: Colors.white,
    letterSpacing: 3,
  },
  tagline: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 8,
  },
  shieldContainer: { marginBottom: 24 },
  shieldBg: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: width - 32,
    backgroundColor: Colors.white,
    borderRadius: 28,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 10,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  cardSubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 20,
  },
  options: { flexDirection: 'row', gap: 12 },
  option: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: Colors.border,
    padding: 16,
    alignItems: 'center',
    position: 'relative',
  },
  optionSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.inputBg,
  },
  optionIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  optionIconSelected: {
    backgroundColor: Colors.primary,
  },
  optionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  optionTitleSelected: { color: Colors.primary },
  optionDesc: {
    fontSize: 12,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 17,
  },
  checkIcon: { position: 'absolute', top: 8, right: 8 },
  startBtn: { marginTop: 20, borderRadius: 14, overflow: 'hidden' },
  startBtnDisabled: { opacity: 0.7 },
  startBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    paddingHorizontal: 24,
  },
  startBtnText: { fontSize: 16, fontWeight: '700', color: Colors.white },
  startBtnTextDisabled: { color: Colors.textMuted },
  loginRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
  },
  loginText: { fontSize: 14, color: Colors.textSecondary },
  loginLink: { fontSize: 14, color: Colors.primary, fontWeight: '700' },
  terms: { fontSize: 11, color: Colors.textMuted, textAlign: 'center', marginTop: 14 },
  termsLink: { color: Colors.accent, textDecorationLine: 'underline' },
});
