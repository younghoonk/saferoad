import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';

const REGION_FILTERS       = ['전체', '서울', '경기', '인천', '부산', '대구', '광주', '대전', '경남', '경북', '충남', '충북', '전남', '전북', '강원', '제주', '전국'];
const ACCIDENT_TYPE_FILTERS = ['전체', '교통사고', '화재사고', '상해사고', '재산피해', '의료사고', '산업재해', '소비자직접선임권', '기타'];
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Card } from '../../components/Card';
import { StatusBadge } from '../../components/StatusBadge';
import { Button } from '../../components/Button';
import { Colors } from '../../constants';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';

// ── 타입 ──────────────────────────────────────────────────────
interface CaseRequest {
  id: string;
  title: string;
  accident_type: string;
  insurance_company: string;
  created_at: string;
  existing_bids: number;
  urgent: boolean;
}

interface ActiveCase {
  id: string;
  case_id: string;
  title: string;
  customer_name: string;
  status: 'pending' | 'reviewing' | 'in_progress' | 'resolved';
  created_at: string;
  chat_room_id: string | null;
}

interface AdjusterStats {
  activeCases: number;
  rating: number;
  resolvedCases: number;
}

interface AdjusterHomeScreenProps {
  onViewCase: (caseId: string) => void;
  onChat: (adjusterId: string, adjusterName?: string) => void;
  onAIAnalysis: (mode?: 'denial-analysis' | 'assessment-draft' | 'closing-report') => void;
}

// ── 프로필 전송 모달 ───────────────────────────────────────────
interface SendProfileModalProps {
  caseId: string;
  caseTitle: string;
  adjusterProfileId: string;
  onClose: () => void;
  onSuccess: () => void;
}

function SendProfileModal({
  caseId,
  caseTitle,
  adjusterProfileId,
  onClose,
  onSuccess,
}: SendProfileModalProps) {
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSend = async () => {
    setLoading(true);
    const { error } = await supabase.from('profile_sends').insert({
      case_id:    caseId,
      adjuster_id: adjusterProfileId,
      message:    message.trim(),
      status:     'pending',
    });
    setLoading(false);

    if (error) {
      if (error.code === '23505') {
        Alert.alert('이미 전송됨', '이 사건에 이미 프로필을 전송했습니다.');
      } else {
        Alert.alert('전송 실패', error.message);
      }
      return;
    }
    Alert.alert('✅ 프로필 전송 완료', '의뢰인에게 내 프로필이 전달되었습니다.', [
      { text: '확인', onPress: onSuccess },
    ]);
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>프로필 전송</Text>
            <TouchableOpacity onPress={onClose} style={styles.modalCloseBtn}>
              <Ionicons name="close" size={22} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.modalCaseBanner}>
            <Ionicons name="folder-open-outline" size={16} color={Colors.primary} />
            <Text style={styles.modalCaseTitle} numberOfLines={1}>{caseTitle}</Text>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            style={styles.modalBody}
            contentContainerStyle={{ paddingBottom: Math.max(insets.bottom + 16, 32) }}
          >
            <View style={styles.infoBox}>
              <Ionicons name="information-circle-outline" size={16} color={Colors.accent} />
              <Text style={styles.infoText}>
                등록된 프로필 정보(전문분야, 경력, 소개 등)가 의뢰인에게 전달됩니다.
              </Text>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>한마디 메시지 (선택)</Text>
              <TextInput
                style={[styles.formInput, styles.formTextArea]}
                placeholder="예: 교통사고 전문으로 최대 보상을 도와드리겠습니다."
                placeholderTextColor={Colors.textMuted}
                value={message}
                onChangeText={setMessage}
                multiline
                textAlignVertical="top"
                maxLength={200}
              />
              <Text style={styles.charCount}>{message.length}/200</Text>
            </View>

            <Button
              title="프로필 전송하기"
              onPress={handleSend}
              loading={loading}
              size="lg"
              style={styles.submitBtn}
            />
            <View style={{ height: 8 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── 메인 화면 ─────────────────────────────────────────────────
export function AdjusterHomeScreen({ onViewCase, onChat, onAIAnalysis }: AdjusterHomeScreenProps) {
  const { profile, session } = useAuth();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<'requests' | 'active'>('requests');

  // 사정사 profile id (adjuster_profiles 테이블의 id = profile.id)
  const adjusterProfileId = session?.user.id ?? '';

  const [newRequests,  setNewRequests]  = useState<CaseRequest[]>([]);
  const [activeCases,  setActiveCases]  = useState<ActiveCase[]>([]);
  const [adjStats,     setAdjStats]     = useState<AdjusterStats>({ activeCases: 0, rating: 5.0, resolvedCases: 0 });
  const [loading,            setLoading]            = useState(true);
  const [regionFilter,      setRegionFilter]       = useState('전체');
  const [accidentTypeFilter, setAccidentTypeFilter] = useState('전체');

  // 견적 제출 모달
  const [selectedCase, setSelectedCase] = useState<{ id: string; title: string } | null>(null);

  const fetchData = useCallback(async () => {
    if (!adjusterProfileId) return;

    // 1) 내가 이미 프로필을 전송한 case_id 목록
    const { data: mySends } = await supabase
      .from('profile_sends')
      .select('case_id')
      .eq('adjuster_id', adjusterProfileId);

    const mySentCaseIds = (mySends ?? []).map((s) => s.case_id);

    // 2) 신규 요청: pending 사건 중 내가 아직 프로필 안 보낸 것
    let pendingQuery = supabase
      .from('cases')
      .select('id, title, accident_type, insurance_company, region, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    // 지역 필터 적용
    if (regionFilter !== '전체') {
      pendingQuery = pendingQuery.eq('region', regionFilter);
    }
    // 사고유형 필터 적용
    if (accidentTypeFilter !== '전체') {
      pendingQuery = pendingQuery.eq('accident_type', accidentTypeFilter);
    }

    const { data: allPending } = await pendingQuery;

    const filtered = (allPending ?? []).filter(
      (c) => !mySentCaseIds.includes(c.id)
    );

    // 각 사건의 현재 프로필 전송 수
    const withBidCount: CaseRequest[] = await Promise.all(
      filtered.map(async (c) => {
        const { count } = await supabase
          .from('profile_sends')
          .select('*', { count: 'exact', head: true })
          .eq('case_id', c.id);

        const createdAt = new Date(c.created_at);
        const diffH = (Date.now() - createdAt.getTime()) / 3600000;
        return {
          ...c,
          existing_bids: count ?? 0,
          urgent: diffH < 3,
        };
      })
    );
    setNewRequests(withBidCount);

    // 3) 진행 중: 내가 프로필 전송한 사건들
    const { data: sentCases } = await supabase
      .from('profile_sends')
      .select('id, case_id, status, cases(id, title, status, created_at, customer_id)')
      .eq('adjuster_id', adjusterProfileId);

    const casesFromSends = (sentCases ?? []).filter((q: any) => q.cases);
    const sentCaseIds = casesFromSends.map((q: any) => q.case_id);

    // 각 사건의 채팅방 ID 조회
    const chatRoomMap = new Map<string, string>();
    if (sentCaseIds.length > 0) {
      const { data: chatRoomsData } = await supabase
        .from('chat_rooms')
        .select('id, case_id')
        .in('case_id', sentCaseIds)
        .eq('adjuster_id', adjusterProfileId);
      (chatRoomsData ?? []).forEach((r) => chatRoomMap.set(r.case_id, r.id));
    }

    const active: ActiveCase[] = casesFromSends.map((q: any) => ({
      id: q.id,
      case_id: q.case_id,
      title: q.cases.title,
      customer_name: '의뢰인',
      status: q.cases.status,
      created_at: q.cases.created_at,
      chat_room_id: chatRoomMap.get(q.case_id) ?? null,
    }));
    setActiveCases(active);

    // 4) 내 사정사 통계
    const { data: adjProfile } = await supabase
      .from('adjuster_profiles')
      .select('rating, resolved_cases')
      .eq('id', adjusterProfileId)
      .single();

    setAdjStats({
      activeCases: active.filter((c) => ['in_progress', 'reviewing'].includes(c.status)).length,
      rating: adjProfile?.rating ?? 5.0,
      resolvedCases: adjProfile?.resolved_cases ?? 0,
    });
  }, [adjusterProfileId, regionFilter, accidentTypeFilter]);

  useEffect(() => {
    setLoading(true);
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

  const formatTimeAgo = (iso: string) => {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
    return `${Math.floor(diff / 86400)}일 전`;
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
          <View style={styles.appBar}>
            <View style={styles.logoRow}>
              <Ionicons name="shield-checkmark" size={20} color="rgba(255,255,255,0.9)" />
              <Text style={styles.logoText}>SAFE ROAD</Text>
            </View>
            <TouchableOpacity style={styles.notifBtn}>
              <Ionicons name="notifications-outline" size={22} color={Colors.white} />
            </TouchableOpacity>
          </View>

          <View style={styles.greetingRow}>
            <View>
              <View style={styles.adjBadge}>
                <Ionicons name="briefcase" size={12} color="#F4C542" />
                <Text style={styles.adjBadgeText}>손해사정사</Text>
              </View>
              <Text style={styles.greetingName}>{profile?.name ?? '전문가'}님, 안녕하세요 👋</Text>
              <Text style={styles.greetingDesc}>오늘도 의뢰인의 권리를 찾아드리세요</Text>
            </View>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarText}>{(profile?.name ?? '전')[0]}</Text>
            </View>
          </View>

          <View style={styles.myStats}>
            {[
              { icon: 'folder-open',      num: String(adjStats.activeCases), label: '진행 사건',  color: '#6FB3F5' },
              { icon: 'star',             num: adjStats.rating.toFixed(1),   label: '평점',       color: '#F4C542' },
              { icon: 'checkmark-circle', num: String(adjStats.resolvedCases), label: '완료 건수', color: '#5DD9A4' },
              { icon: 'document-text',    num: String(newRequests.length),   label: '신규 요청',  color: '#FF9F6B' },
            ].map((s, i, arr) => (
              <React.Fragment key={s.label}>
                <View style={styles.myStatItem}>
                  <Ionicons name={s.icon as any} size={16} color={s.color} />
                  <Text style={styles.myStatNum}>{s.num}</Text>
                  <Text style={styles.myStatLabel}>{s.label}</Text>
                </View>
                {i < arr.length - 1 && <View style={styles.myStatDivider} />}
              </React.Fragment>
            ))}
          </View>
        </LinearGradient>

        {/* ── 빠른 액션 ── */}
        <View style={styles.section}>
          <View style={styles.quickActions}>
            {[
              { icon: 'search',        label: '사건 검색',  color: Colors.accent, bg: Colors.accent + '12' },
              { icon: 'chatbubbles',   label: '채팅',       color: '#27AE60', bg: '#E9F7EF' },
              { icon: 'document-text', label: '계약서',     color: Colors.primaryLight, bg: Colors.primary + '10' },
              { icon: 'stats-chart',   label: '수익 현황',  color: '#E67E22', bg: '#FDF2E4' },
            ].map((item) => (
              <TouchableOpacity key={item.label} style={styles.quickActionItem} activeOpacity={0.8}>
                <View style={[styles.quickActionIcon, { backgroundColor: item.bg }]}>
                  <Ionicons name={item.icon as any} size={22} color={item.color} />
                </View>
                <Text style={styles.quickActionLabel}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── AI 면책분석 배너 (사정사 전용) ── */}
        <View style={styles.section}>
          <TouchableOpacity onPress={() => onAIAnalysis('denial-analysis')} activeOpacity={0.9}>
            <LinearGradient
              colors={[Colors.primaryDark, Colors.primary, Colors.accent]}
              style={styles.aiBanner}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <View style={styles.aiBannerLeft}>
                <View style={styles.aiBannerBadge}>
                  <Ionicons name="sparkles" size={11} color="#C4B5FD" />
                  <Text style={styles.aiBannerBadgeText}>사정사 전용</Text>
                </View>
                <Text style={styles.aiBannerTitle}>AI 면책공문 분석</Text>
                <Text style={styles.aiBannerDesc}>
                  면책 이유 분석 · 반박 논거 생성{'\n'}AI 사정서 초안 자동 작성
                </Text>
              </View>
              <View style={styles.aiBannerRight}>
                <View style={styles.aiBannerIconCircle}>
                  <Ionicons name="sparkles" size={28} color={Colors.white} />
                </View>
                <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.5)" />
              </View>
            </LinearGradient>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onAIAnalysis('closing-report')} activeOpacity={0.9} style={styles.aiBannerSpacing}>
            <LinearGradient
              colors={[Colors.accent, Colors.primary, Colors.primaryDark]}
              style={styles.aiBanner}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <View style={styles.aiBannerLeft}>
                <View style={styles.aiBannerBadge}>
                  <Ionicons name="clipboard-outline" size={11} color="#C4B5FD" />
                  <Text style={styles.aiBannerBadgeText}>보험사 제출용</Text>
                </View>
                <Text style={styles.aiBannerTitle}>종결보고서 작성</Text>
                <Text style={styles.aiBannerDesc}>
                  진단서 · 조사자료 · 손해자료 분석{'\n'}보험사 제출용 보고서 초안 작성
                </Text>
              </View>
              <View style={styles.aiBannerRight}>
                <View style={styles.aiBannerIconCircle}>
                  <Ionicons name="clipboard-outline" size={28} color={Colors.white} />
                </View>
                <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.5)" />
              </View>
            </LinearGradient>
          </TouchableOpacity>
        </View>

        {/* ── 지역 필터 ── */}
        <View style={styles.regionFilterSection}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.regionFilterRow}
          >
            {REGION_FILTERS.map((r) => (
              <TouchableOpacity
                key={r}
                style={[styles.regionFilterChip, regionFilter === r && styles.regionFilterChipActive]}
                onPress={() => {
                  setRegionFilter(r);
                  setLoading(true);
                }}
                activeOpacity={0.7}
              >
                <Text style={[styles.regionFilterText, regionFilter === r && styles.regionFilterTextActive]}>
                  {r}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* ── 사고유형 필터 ── */}
        <View style={styles.regionFilterSection}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.regionFilterRow}
          >
            {ACCIDENT_TYPE_FILTERS.map((t) => (
              <TouchableOpacity
                key={t}
                style={[
                  styles.typeFilterChip,
                  accidentTypeFilter === t && styles.typeFilterChipActive,
                  t === '소비자직접선임권' && accidentTypeFilter !== t && styles.typeFilterChipSpecial,
                ]}
                onPress={() => {
                  setAccidentTypeFilter(t);
                  setLoading(true);
                }}
                activeOpacity={0.7}
              >
                <Text style={[
                  styles.typeFilterText,
                  accidentTypeFilter === t && styles.typeFilterTextActive,
                  t === '소비자직접선임권' && accidentTypeFilter !== t && styles.typeFilterTextSpecial,
                ]}>
                  {t}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* ── 탭: 신규 요청 / 진행 중 ── */}
        <View style={styles.section}>
          <View style={styles.tabBar}>
            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'requests' && styles.tabBtnActive]}
              onPress={() => setActiveTab('requests')}
            >
              <Text style={[styles.tabBtnText, activeTab === 'requests' && styles.tabBtnTextActive]}>
                신규 사건 요청
              </Text>
              <View style={styles.tabCount}>
                <Text style={styles.tabCountText}>{newRequests.length}</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'active' && styles.tabBtnActive]}
              onPress={() => setActiveTab('active')}
            >
              <Text style={[styles.tabBtnText, activeTab === 'active' && styles.tabBtnTextActive]}>
                진행 중인 사건
              </Text>
              <View style={[styles.tabCount, { backgroundColor: Colors.success + '20' }]}>
                <Text style={[styles.tabCountText, { color: Colors.success }]}>
                  {activeCases.length}
                </Text>
              </View>
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={Colors.primary} />
              <Text style={styles.loadingText}>불러오는 중...</Text>
            </View>
          ) : activeTab === 'requests' ? (
            <View style={styles.tabContent}>
              {newRequests.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Ionicons name="folder-open-outline" size={40} color={Colors.textMuted} />
                  <Text style={styles.emptyText}>새로운 사건 요청이 없습니다</Text>
                </View>
              ) : (
                newRequests.map((req) => (
                  <Card key={req.id} style={styles.requestCard}>
                    <View style={styles.requestTop}>
                      <View style={styles.requestTagRow}>
                        <View style={styles.requestTypTag}>
                          <Text style={styles.requestTypeText}>{req.accident_type}</Text>
                        </View>
                        {req.urgent && (
                          <View style={styles.urgentTag}>
                            <Ionicons name="flash" size={10} color={Colors.danger} />
                            <Text style={styles.urgentText}>긴급</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.requestPosted}>{formatTimeAgo(req.created_at)}</Text>
                    </View>

                    <Text style={styles.requestTitle}>{req.title}</Text>
                    <Text style={styles.requestInsurance}>{req.insurance_company}</Text>

                    <View style={styles.requestBottom}>
                      <View style={styles.bidInfo}>
                        <Ionicons name="people-outline" size={13} color={Colors.textSecondary} />
                        <Text style={styles.bidInfoText}>프로필 {req.existing_bids}명 전송</Text>
                      </View>
                      <TouchableOpacity
                        style={styles.bidBtn}
                        onPress={() => setSelectedCase({ id: req.id, title: req.title })}
                      >
                        <Text style={styles.bidBtnText}>프로필 전송</Text>
                        <Ionicons name="arrow-forward" size={13} color={Colors.white} />
                      </TouchableOpacity>
                    </View>
                  </Card>
                ))
              )}
            </View>
          ) : (
            <View style={styles.tabContent}>
              {activeCases.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Ionicons name="document-text-outline" size={40} color={Colors.textMuted} />
                  <Text style={styles.emptyText}>진행 중인 사건이 없습니다</Text>
                </View>
              ) : (
                activeCases.map((c) => (
                  <Card key={c.id} style={styles.activeCard}>
                    <View style={styles.activeTop}>
                      <StatusBadge status={c.status} />
                    </View>
                    <Text style={styles.activeTitle}>{c.title}</Text>
                    <Text style={styles.activeCustomer}>의뢰인: {c.customer_name}</Text>
                    <View style={styles.activeBtnRow}>
                      <TouchableOpacity
                        style={styles.activeChatBtn}
                        onPress={() => {
                          if (c.chat_room_id) {
                            onChat(c.chat_room_id, c.customer_name);
                          } else {
                            Alert.alert('채팅 불가', '고객이 선임을 수락한 후 채팅이 가능합니다.');
                          }
                        }}
                      >
                        <Ionicons name="chatbubble-outline" size={14} color={Colors.primary} />
                        <Text style={styles.activeChatBtnText}>채팅</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.activeDetailBtn}
                        onPress={() => onViewCase(c.case_id)}
                      >
                        <Text style={styles.activeDetailBtnText}>상세보기</Text>
                      </TouchableOpacity>
                    </View>
                  </Card>
                ))
              )}
            </View>
          )}
        </View>

        <View style={{ height: 16 }} />
      </ScrollView>

      {/* 프로필 전송 모달 */}
      {selectedCase && (
        <SendProfileModal
          caseId={selectedCase.id}
          caseTitle={selectedCase.title}
          adjusterProfileId={adjusterProfileId}
          onClose={() => setSelectedCase(null)}
          onSuccess={() => {
            setSelectedCase(null);
            setLoading(true);
            fetchData().finally(() => setLoading(false));
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  container: { flex: 1 },

  heroBanner: { paddingTop: 12, paddingBottom: 24, paddingHorizontal: 20 },
  appBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  logoText: { fontSize: 16, fontWeight: '900', color: Colors.white, letterSpacing: 1.5 },
  notifBtn: { padding: 4 },
  greetingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  adjBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(244,197,66,0.2)', alignSelf: 'flex-start',
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 6,
    borderWidth: 1, borderColor: 'rgba(244,197,66,0.4)',
  },
  adjBadgeText: { fontSize: 11, color: '#F4C542', fontWeight: '700' },
  greetingName: { fontSize: 18, fontWeight: '800', color: Colors.white, marginBottom: 4 },
  greetingDesc: { fontSize: 13, color: 'rgba(255,255,255,0.75)' },
  avatarCircle: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)',
  },
  avatarText: { fontSize: 18, fontWeight: '800', color: Colors.white },
  myStats: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14, padding: 14,
  },
  myStatItem: { flex: 1, alignItems: 'center', gap: 3 },
  myStatNum: { fontSize: 15, fontWeight: '800', color: Colors.white },
  myStatLabel: { fontSize: 10, color: 'rgba(255,255,255,0.7)' },
  myStatDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.2)' },

  regionFilterSection: { marginTop: 16, paddingVertical: 4 },
  regionFilterRow: { paddingHorizontal: 16, gap: 8 },
  regionFilterChip: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1.5,
    borderColor: Colors.border, backgroundColor: Colors.white,
  },
  regionFilterChipActive: { borderColor: Colors.primary, backgroundColor: Colors.primary },
  regionFilterText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' },
  regionFilterTextActive: { color: Colors.white, fontWeight: '700' },

  typeFilterChip: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1.5,
    borderColor: Colors.border, backgroundColor: Colors.white,
  },
  typeFilterChipActive: { borderColor: Colors.primary, backgroundColor: Colors.primary },
  typeFilterChipSpecial: { borderColor: Colors.accent + '50', backgroundColor: Colors.accent + '08' },
  typeFilterText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' },
  typeFilterTextActive: { color: Colors.white, fontWeight: '700' },
  typeFilterTextSpecial: { color: Colors.accent, fontWeight: '600' },

  section: { paddingHorizontal: 16, marginTop: 20 },
  quickActions: { flexDirection: 'row', justifyContent: 'space-between' },
  quickActionItem: { flex: 1, alignItems: 'center' },
  quickActionIcon: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  quickActionLabel: { fontSize: 12, fontWeight: '600', color: Colors.textPrimary },

  // AI 배너
  aiBanner: {
    borderRadius: 16, padding: 20,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  aiBannerSpacing: { marginTop: 12 },
  aiBannerLeft: { flex: 1 },
  aiBannerBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(196,181,253,0.25)', alignSelf: 'flex-start',
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 8,
    borderWidth: 1, borderColor: 'rgba(196,181,253,0.4)',
  },
  aiBannerBadgeText: { fontSize: 11, color: '#C4B5FD', fontWeight: '700' },
  aiBannerTitle: { fontSize: 19, fontWeight: '800', color: Colors.white, marginBottom: 6 },
  aiBannerDesc: { fontSize: 12, color: 'rgba(255,255,255,0.8)', lineHeight: 18 },
  aiBannerRight: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  aiBannerIconCircle: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },

  tabBar: { flexDirection: 'row', marginBottom: 12, gap: 8 },
  tabBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10,
    borderRadius: 12, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  tabBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '08' },
  tabBtnText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  tabBtnTextActive: { color: Colors.primary },
  tabCount: {
    backgroundColor: Colors.primary + '18', borderRadius: 10,
    paddingHorizontal: 6, paddingVertical: 1,
  },
  tabCountText: { fontSize: 11, fontWeight: '700', color: Colors.primary },
  tabContent: { gap: 12 },

  center: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  loadingText: { fontSize: 13, color: Colors.textSecondary },
  emptyBox: { alignItems: 'center', paddingVertical: 32, gap: 10 },
  emptyText: { fontSize: 14, color: Colors.textSecondary },

  requestCard: {},
  requestTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  requestTagRow: { flexDirection: 'row', gap: 6 },
  requestTypTag: { backgroundColor: Colors.primary + '12', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  requestTypeText: { fontSize: 11, color: Colors.primary, fontWeight: '600' },
  urgentTag: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.danger + '12', borderRadius: 8,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  urgentText: { fontSize: 11, color: Colors.danger, fontWeight: '700' },
  requestPosted: { fontSize: 11, color: Colors.textMuted },
  requestTitle: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary, marginBottom: 4 },
  requestInsurance: { fontSize: 12, color: Colors.textSecondary, marginBottom: 12 },
  requestBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bidInfo: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bidInfoText: { fontSize: 12, color: Colors.textSecondary },
  bidBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.primary, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  bidBtnText: { fontSize: 13, color: Colors.white, fontWeight: '700' },

  activeCard: {},
  activeTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  activeTitle: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary, marginBottom: 4 },
  activeCustomer: { fontSize: 12, color: Colors.textSecondary, marginBottom: 12 },
  activeBtnRow: { flexDirection: 'row', gap: 8 },
  activeChatBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    borderWidth: 1.5, borderColor: Colors.primary, borderRadius: 10, paddingVertical: 9,
  },
  activeChatBtnText: { fontSize: 13, color: Colors.primary, fontWeight: '600' },
  activeDetailBtn: {
    flex: 2, backgroundColor: Colors.primary, borderRadius: 10,
    paddingVertical: 9, alignItems: 'center',
  },
  activeDetailBtnText: { fontSize: 13, color: Colors.white, fontWeight: '700' },

  infoBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: Colors.accent + '10', borderRadius: 10, padding: 12, marginBottom: 16,
    borderWidth: 1, borderColor: Colors.accent + '25',
  },
  infoText: { flex: 1, fontSize: 12, color: Colors.accent, lineHeight: 17 },

  // 프로필 전송 모달
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalSheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '90%',
  },
  modalHeader: {
    alignItems: 'center', padding: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    position: 'relative',
  },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border, marginBottom: 12 },
  modalTitle: { fontSize: 17, fontWeight: '800', color: Colors.textPrimary },
  modalCloseBtn: { position: 'absolute', right: 16, top: 20 },
  modalCaseBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.primary + '08',
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  modalCaseTitle: { flex: 1, fontSize: 13, color: Colors.primary, fontWeight: '600' },
  modalBody: { padding: 16 },
  formGroup: { marginBottom: 16 },
  formLabel: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary, marginBottom: 8 },
  required: { color: Colors.danger },
  formInput: {
    backgroundColor: Colors.inputBg,
    borderRadius: 12, padding: 14,
    fontSize: 14, color: Colors.textPrimary,
    borderWidth: 1, borderColor: Colors.border,
  },
  formTextArea: { height: 120, paddingTop: 14 },
  charCount: { fontSize: 11, color: Colors.textMuted, textAlign: 'right', marginTop: 4 },
  submitBtn: { borderRadius: 14, marginTop: 8 },
});
