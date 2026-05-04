import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Card } from '../../components/Card';
import { Colors } from '../../constants';
import { mockAdjusters, mockResolvedCases } from '../../lib/mockData';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';

const { width } = Dimensions.get('window');

interface HomeScreenProps {
  onRegisterCase: () => void;
  onDirectHire: () => void;
  onViewQuotes: () => void;
  onChat: (adjusterId: string, adjusterName?: string) => void;
  onViewReceivedProfiles: () => void;
}

const QUICK_MENU: { icon: string; label: string; color: string; tab: string }[] = [
  { icon: 'document-text',  label: '내 사건',    color: Colors.accent, tab: 'cases'    },
  { icon: 'people',         label: '받은 프로필', color: '#27AE60', tab: 'profiles' },
  { icon: 'chatbubbles',    label: '1:1 채팅',   color: '#E67E22', tab: 'chat'     },
  { icon: 'search',         label: '사정사 검색', color: Colors.primaryLight, tab: 'search'   },
];

export function HomeScreen({ onRegisterCase, onDirectHire, onViewQuotes, onChat, onViewReceivedProfiles }: HomeScreenProps) {
  const { profile, session } = useAuth();
  const insets = useSafeAreaInsets();
  const firstName = profile?.name?.split('')[0] ?? '고객';
  const [receivedCount, setReceivedCount] = useState(0);

  useEffect(() => {
    if (!session) return;
    // 내 사건들에 도착한 프로필 총 수
    supabase
      .from('profile_sends')
      .select('id', { count: 'exact', head: true })
      .then(async ({ count: totalCount }) => {
        // 내 사건 ID 목록 먼저 조회
        const { data: myCases } = await supabase
          .from('cases')
          .select('id')
          .eq('customer_id', session.user.id);
        if (!myCases?.length) return;
        const caseIds = myCases.map((c) => c.id);
        const { count } = await supabase
          .from('profile_sends')
          .select('*', { count: 'exact', head: true })
          .in('case_id', caseIds)
          .eq('status', 'pending');
        setReceivedCount(count ?? 0);
      });
  }, [session]);

  const handleQuickMenu = (tab: string) => {
    if (tab === 'quotes') onViewQuotes();
    else if (tab === 'chat') onChat('', '채팅');
    else if (tab === 'profiles') onViewReceivedProfiles();
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom + 16, 32) }}
        showsVerticalScrollIndicator={false}
      >

        {/* ── 상단 배너 ── */}
        <LinearGradient
          colors={[Colors.primaryDark, Colors.primary, Colors.primaryLight]}
          style={[styles.heroBanner, { paddingTop: insets.top + 12 }]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          {/* 상단 앱바 */}
          <View style={styles.appBar}>
            <View style={styles.logoRow}>
              <Ionicons name="shield-checkmark" size={20} color="rgba(255,255,255,0.9)" />
              <Text style={styles.logoText}>SAFE ROAD</Text>
            </View>
            <View style={styles.appBarRight}>
              <TouchableOpacity style={styles.notifBtn}>
                <Ionicons name="notifications-outline" size={22} color={Colors.white} />
                <View style={styles.notifDot} />
              </TouchableOpacity>
            </View>
          </View>

          {/* 인사말 */}
          <View style={styles.greetingRow}>
            <View>
              <Text style={styles.greetingName}>{profile?.name ?? '회원'}님, 안녕하세요 👋</Text>
              <Text style={styles.greetingDesc}>오늘도 든든한 권리 찾기를 도와드릴게요</Text>
            </View>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarText}>{firstName}</Text>
            </View>
          </View>

          {/* 통계 */}
          <View style={styles.statsRow}>
            {[
              { num: '3,200+', label: '해결 사례' },
              { num: '98%',    label: '고객 만족' },
              { num: '4.8x',   label: '평균 보상' },
            ].map((s, i, arr) => (
              <React.Fragment key={s.label}>
                <View style={styles.statItem}>
                  <Text style={styles.statNum}>{s.num}</Text>
                  <Text style={styles.statLabel}>{s.label}</Text>
                </View>
                {i < arr.length - 1 && <View style={styles.statDivider} />}
              </React.Fragment>
            ))}
          </View>
        </LinearGradient>

        {/* ── 사건 등록 CTA ── */}
        <View style={styles.section}>
          <TouchableOpacity onPress={onRegisterCase} activeOpacity={0.9}>
            <LinearGradient
              colors={[Colors.primaryDark, Colors.primary]}
              style={styles.ctaCard}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              <View style={styles.ctaTextWrap}>
                <View style={styles.ctaNewBadge}>
                  <Text style={styles.ctaNewText}>무료</Text>
                </View>
                <Text style={styles.ctaTitle}>사건 등록하기</Text>
                <Text style={styles.ctaDesc}>전문 손해사정사의 견적을{'\n'}무료로 비교해보세요</Text>
              </View>
              <View style={styles.ctaIconWrap}>
                <View style={styles.ctaIconBg}>
                  <Ionicons name="add" size={28} color={Colors.white} />
                </View>
                <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.5)" />
              </View>
            </LinearGradient>
          </TouchableOpacity>

          {/* 소비자직접선임권 배너 */}
          <TouchableOpacity onPress={onDirectHire} activeOpacity={0.9} style={{ marginTop: 10 }}>
            <LinearGradient
              colors={[Colors.primaryDark, Colors.accent]}
              style={styles.ctaCard}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              <View style={styles.ctaTextWrap}>
                <View style={[styles.ctaNewBadge, { backgroundColor: 'rgba(196,181,253,0.3)' }]}>
                  <Text style={styles.ctaNewText}>내 권리</Text>
                </View>
                <Text style={styles.ctaTitle}>소비자직접선임권</Text>
                <Text style={styles.ctaDesc}>보험사 추천 없이 내가 직접{'\n'}손해사정사를 선임하세요</Text>
              </View>
              <View style={styles.ctaIconWrap}>
                <View style={[styles.ctaIconBg, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
                  <Ionicons name="shield-checkmark" size={26} color={Colors.white} />
                </View>
                <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.5)" />
              </View>
            </LinearGradient>
          </TouchableOpacity>
        </View>

        {/* ── 빠른 메뉴 ── */}
        <View style={styles.section}>
          <View style={styles.quickMenuGrid}>
            {QUICK_MENU.map((item) => (
              <TouchableOpacity
                key={item.label}
                style={styles.quickItem}
                onPress={() => handleQuickMenu(item.tab)}
                activeOpacity={0.8}
              >
                <View style={[styles.quickIconBg, { backgroundColor: item.color + '18' }]}>
                  <Ionicons name={item.icon as any} size={24} color={item.color} />
                </View>
                <Text style={styles.quickLabel}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── 받은 프로필 알림 카드 ── */}
        {receivedCount > 0 && (
          <View style={styles.section}>
            <TouchableOpacity onPress={onViewReceivedProfiles} activeOpacity={0.9}>
              <LinearGradient
                colors={['#27AE60', '#2ECC71']}
                style={styles.profileNoticeCard}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                <View style={styles.profileNoticeLeft}>
                  <View style={styles.profileNoticeBadge}>
                    <Text style={styles.profileNoticeBadgeNum}>{receivedCount}</Text>
                  </View>
                  <View>
                    <Text style={styles.profileNoticeTitle}>
                      {receivedCount}명의 손해사정사가{'\n'}프로필을 보냈어요
                    </Text>
                    <Text style={styles.profileNoticeDesc}>지금 바로 확인해보세요</Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.8)" />
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}

        {/* ── 진행 중인 내 사건 (있을 경우) ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>📋 진행 중인 사건</Text>
          </View>
          <Card style={styles.activeCaseCard}>
            <View style={styles.activeCaseTop}>
              <View style={styles.activeCaseStatus}>
                <View style={styles.statusDot} />
                <Text style={styles.statusText}>진행중</Text>
              </View>
              <Text style={styles.activeCaseDate}>2026.03.28</Text>
            </View>
            <Text style={styles.activeCaseTitle}>교통사고 과실 비율 분쟁</Text>
            <Text style={styles.activeCaseMeta}>삼성화재 · 견적 3건 도착</Text>
            <TouchableOpacity style={styles.viewQuotesBtn} onPress={onViewQuotes}>
              <Text style={styles.viewQuotesBtnText}>견적 비교하기</Text>
              <Ionicons name="arrow-forward" size={14} color={Colors.primary} />
            </TouchableOpacity>
          </Card>
        </View>

        {/* ── 이달의 손해사정사 ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>🏆 이달의 손해사정사</Text>
            <TouchableOpacity>
              <Text style={styles.seeAll}>전체보기</Text>
            </TouchableOpacity>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.hScroll} contentContainerStyle={styles.hScrollContent}>
            {mockAdjusters.map((adj, idx) => (
              <TouchableOpacity
                key={adj.id}
                activeOpacity={0.9}
                onPress={() => onChat(adj.id, adj.name)}
              >
                <Card style={styles.adjCard} padding={14}>
                  {/* 순위 뱃지 */}
                  {idx === 0 && (
                    <View style={styles.rankBadge}>
                      <Ionicons name="trophy" size={10} color="#B7860B" />
                      <Text style={styles.rankText}>1위</Text>
                    </View>
                  )}

                  <View style={styles.adjAvatar}>
                    <Text style={styles.adjAvatarText}>{adj.name[0]}</Text>
                  </View>

                  <View style={styles.adjRating}>
                    <Ionicons name="star" size={10} color="#F4C542" />
                    <Text style={styles.adjRatingText}>{adj.rating}</Text>
                  </View>

                  <Text style={styles.adjName}>{adj.name}</Text>
                  <Text style={styles.adjSpec}>{adj.specialties[0]}</Text>

                  <View style={styles.adjStats}>
                    <Text style={styles.adjStatNum}>{adj.resolvedCases}</Text>
                    <Text style={styles.adjStatLabel}>해결</Text>
                  </View>

                  <TouchableOpacity style={styles.adjContactBtn} onPress={() => onChat(adj.id, adj.name)}>
                    <Text style={styles.adjContactText}>연락하기</Text>
                  </TouchableOpacity>
                </Card>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* ── 해결 사례 ── */}
        <View style={[styles.section, styles.lastSection]}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>✅ 생생한 해결 사례</Text>
            <TouchableOpacity>
              <Text style={styles.seeAll}>전체보기</Text>
            </TouchableOpacity>
          </View>

          {mockResolvedCases.map((item) => (
            <Card key={item.id} style={styles.caseCard}>
              <View style={styles.caseCatRow}>
                <View style={styles.caseCatTag}>
                  <Text style={styles.caseCatText}>{item.category}</Text>
                </View>
                <Text style={styles.caseAdj}>{item.adjusterName} 사정사</Text>
              </View>

              <Text style={styles.caseTitle}>{item.title}</Text>
              <Text style={styles.caseDesc}>{item.description}</Text>

              <View style={styles.amountCompare}>
                <View style={styles.amountBox}>
                  <Text style={styles.amountBoxLabel}>보험사 제시액</Text>
                  <Text style={styles.amountOriginal}>{item.originalAmount}</Text>
                </View>
                <View style={styles.amountArrow}>
                  <Ionicons name="arrow-forward" size={18} color={Colors.success} />
                </View>
                <View style={styles.amountBox}>
                  <Text style={styles.amountBoxLabel}>최종 수령액</Text>
                  <Text style={styles.amountFinal}>{item.resolvedAmount}</Text>
                </View>
              </View>
            </Card>
          ))}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  container: { flex: 1 },

  // 배너
  heroBanner: { paddingTop: 12, paddingBottom: 24, paddingHorizontal: 20 },
  appBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  logoText: { fontSize: 16, fontWeight: '900', color: Colors.white, letterSpacing: 1.5 },
  appBarRight: { flexDirection: 'row', gap: 4 },
  notifBtn: { position: 'relative', padding: 4 },
  notifDot: {
    position: 'absolute', top: 4, right: 4,
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: Colors.danger,
    borderWidth: 1.5, borderColor: Colors.primary,
  },
  greetingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  greetingName: { fontSize: 18, fontWeight: '800', color: Colors.white, marginBottom: 4 },
  greetingDesc: { fontSize: 13, color: 'rgba(255,255,255,0.75)' },
  avatarCircle: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)',
  },
  avatarText: { fontSize: 18, fontWeight: '800', color: Colors.white },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 14, padding: 14,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 18, fontWeight: '800', color: Colors.white },
  statLabel: { fontSize: 11, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  statDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.25)' },

  // 공통
  section: { paddingHorizontal: 16, marginTop: 20 },
  lastSection: { marginBottom: 32 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: Colors.textPrimary },
  seeAll: { fontSize: 13, color: Colors.accent, fontWeight: '600' },

  // CTA 카드
  ctaCard: { borderRadius: 16, padding: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ctaTextWrap: { flex: 1 },
  ctaNewBadge: {
    backgroundColor: Colors.accentLight, alignSelf: 'flex-start',
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, marginBottom: 8,
  },
  ctaNewText: { fontSize: 11, color: Colors.white, fontWeight: '700' },
  ctaTitle: { fontSize: 20, fontWeight: '800', color: Colors.white, marginBottom: 6 },
  ctaDesc: { fontSize: 13, color: 'rgba(255,255,255,0.8)', lineHeight: 19 },
  ctaIconWrap: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  ctaIconBg: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },

  // 빠른 메뉴
  quickMenuGrid: { flexDirection: 'row', justifyContent: 'space-between' },
  quickItem: { alignItems: 'center', flex: 1 },
  quickIconBg: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  quickLabel: { fontSize: 12, fontWeight: '600', color: Colors.textPrimary },

  // 진행 사건
  activeCaseCard: { borderLeftWidth: 4, borderLeftColor: Colors.primary },
  activeCaseTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  activeCaseStatus: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primary },
  statusText: { fontSize: 12, color: Colors.primary, fontWeight: '700' },
  activeCaseDate: { fontSize: 12, color: Colors.textMuted },
  activeCaseTitle: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary, marginBottom: 4 },
  activeCaseMeta: { fontSize: 12, color: Colors.textSecondary, marginBottom: 12 },
  viewQuotesBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    backgroundColor: Colors.primary + '10', borderRadius: 10,
    paddingVertical: 9, borderWidth: 1, borderColor: Colors.primary + '30',
  },
  viewQuotesBtnText: { fontSize: 13, color: Colors.primary, fontWeight: '700' },

  // 이달의 사정사
  hScroll: { marginHorizontal: -16 },
  hScrollContent: { paddingHorizontal: 16, gap: 12 },
  adjCard: { width: 140, alignItems: 'center', position: 'relative' },
  rankBadge: {
    position: 'absolute', top: -8, right: 10,
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: '#FEF9EC', borderRadius: 10,
    paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: '#F4C542',
  },
  rankText: { fontSize: 10, color: '#B7860B', fontWeight: '700' },
  adjAvatar: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  adjAvatarText: { color: Colors.white, fontSize: 20, fontWeight: '700' },
  adjRating: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: '#FEF9EC', borderRadius: 10,
    paddingHorizontal: 6, paddingVertical: 2, marginBottom: 6,
  },
  adjRatingText: { fontSize: 11, fontWeight: '700', color: '#B7860B' },
  adjName: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  adjSpec: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  adjStats: { alignItems: 'center', marginTop: 6 },
  adjStatNum: { fontSize: 14, fontWeight: '800', color: Colors.primary },
  adjStatLabel: { fontSize: 10, color: Colors.textSecondary },
  adjContactBtn: {
    marginTop: 10, width: '100%',
    backgroundColor: Colors.inputBg, borderRadius: 8,
    paddingVertical: 7, alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  adjContactText: { fontSize: 12, color: Colors.primary, fontWeight: '600' },

  // 받은 프로필 알림
  profileNoticeCard: {
    borderRadius: 16, padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  profileNoticeLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  profileNoticeBadge: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)',
  },
  profileNoticeBadgeNum: { fontSize: 18, fontWeight: '900', color: Colors.white },
  profileNoticeTitle: { fontSize: 14, fontWeight: '800', color: Colors.white, lineHeight: 20 },
  profileNoticeDesc: { fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 2 },

  // AI 배너
  aiBanner: { borderRadius: 16, padding: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  aiBannerBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'flex-start',
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2,
    fontSize: 10, color: Colors.white, fontWeight: '700', marginBottom: 8,
    overflow: 'hidden',
  },
  aiBannerTitle: { fontSize: 18, fontWeight: '800', color: Colors.white, marginBottom: 6 },
  aiBannerDesc: { fontSize: 12, color: 'rgba(255,255,255,0.8)', lineHeight: 18 },

  // 해결 사례
  caseCard: { marginBottom: 12 },
  caseCatRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  caseCatTag: {
    backgroundColor: Colors.primary + '12', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  caseCatText: { fontSize: 11, color: Colors.primary, fontWeight: '600' },
  caseAdj: { fontSize: 11, color: Colors.textSecondary },
  caseTitle: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary, marginBottom: 4 },
  caseDesc: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18, marginBottom: 12 },
  amountCompare: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.background, borderRadius: 12, padding: 12,
  },
  amountBox: { flex: 1, alignItems: 'center' },
  amountArrow: { paddingHorizontal: 8 },
  amountBoxLabel: { fontSize: 10, color: Colors.textSecondary, marginBottom: 4 },
  amountOriginal: { fontSize: 14, fontWeight: '700', color: Colors.textSecondary },
  amountFinal: { fontSize: 17, fontWeight: '800', color: Colors.success },
});
