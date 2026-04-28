import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../../components/Card';
import { StatusBadge } from '../../components/StatusBadge';
import { Colors } from '../../constants';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

interface CaseRow {
  id: string;
  title: string;
  accident_type: string;
  insurance_company: string;
  status: 'pending' | 'reviewing' | 'in_progress' | 'resolved';
  images: string[];
  created_at: string;
  quotes_count?: number;
  profiles_count?: number; // 받은 프로필 수
}

type FilterStatus = 'all' | 'pending' | 'reviewing' | 'in_progress' | 'resolved';

const FILTER_OPTIONS: { key: FilterStatus; label: string }[] = [
  { key: 'all',        label: '전체'  },
  { key: 'pending',    label: '대기중' },
  { key: 'reviewing',  label: '검토중' },
  { key: 'in_progress',label: '진행중' },
  { key: 'resolved',   label: '완료'  },
];

interface MyCasesScreenProps {
  onViewQuotes: (caseId: string) => void;
  onViewReceivedProfiles?: (caseId: string) => void;
}

export function MyCasesScreen({ onViewQuotes, onViewReceivedProfiles }: MyCasesScreenProps) {
  const { session } = useAuth();
  const [cases,       setCases]       = useState<CaseRow[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [filter,      setFilter]      = useState<FilterStatus>('all');
  const [errorMsg,    setErrorMsg]    = useState<string | null>(null);

  const fetchCases = useCallback(async () => {
    if (!session) return;
    setErrorMsg(null);

    try {
      // cases 조회
      let query = supabase
        .from('cases')
        .select('id, title, accident_type, insurance_company, status, images, created_at')
        .eq('customer_id', session.user.id)
        .order('created_at', { ascending: false });

      if (filter !== 'all') {
        query = query.eq('status', filter);
      }

      const { data, error } = await query;

      if (error) {
        setErrorMsg(error.message);
        return;
      }

      // 각 사건의 견적 수 + 받은 프로필 수 조회
      const casesWithCount: CaseRow[] = await Promise.all(
        (data ?? []).map(async (c) => {
          const [{ count: qCount }, { count: pCount }] = await Promise.all([
            supabase.from('quotes').select('*', { count: 'exact', head: true }).eq('case_id', c.id),
            supabase.from('profile_sends').select('*', { count: 'exact', head: true }).eq('case_id', c.id),
          ]);
          return { ...c, quotes_count: qCount ?? 0, profiles_count: pCount ?? 0 };
        })
      );

      setCases(casesWithCount);
    } catch (e: any) {
      setErrorMsg(e?.message ?? '데이터를 불러오지 못했습니다.');
    }
  }, [session, filter]);

  // filter 변경 or fetchCases 변경 시 새로 로드
  useEffect(() => {
    setLoading(true);
    fetchCases().finally(() => setLoading(false));
  }, [fetchCases]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchCases();
    setRefreshing(false);
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  // ── 렌더 ─────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe}>
      {/* 헤더 */}
      <View style={styles.headerRow}>
        <Text style={styles.title}>내 사건</Text>
        <View style={styles.headerRight}>
          {!loading && (
            <Text style={styles.caseCount}>{cases.length}건</Text>
          )}
        </View>
      </View>

      {/* 필터 탭 */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterContent}
      >
        {FILTER_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.key}
            style={[styles.filterChip, filter === opt.key && styles.filterChipActive]}
            onPress={() => setFilter(opt.key)}
          >
            <Text style={[styles.filterChipText, filter === opt.key && styles.filterChipTextActive]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* 로딩 */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>사건 목록 불러오는 중...</Text>
        </View>
      ) : errorMsg ? (
        /* 에러 */
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={48} color={Colors.danger} />
          <Text style={styles.errorText}>{errorMsg}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); fetchCases().finally(() => setLoading(false)); }}>
            <Text style={styles.retryBtnText}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      ) : cases.length === 0 ? (
        /* 빈 상태 */
        <View style={styles.center}>
          <View style={styles.emptyIcon}>
            <Ionicons name="folder-open-outline" size={48} color={Colors.textMuted} />
          </View>
          <Text style={styles.emptyTitle}>
            {filter === 'all' ? '등록된 사건이 없어요' : `'${FILTER_OPTIONS.find(o => o.key === filter)?.label}' 상태의 사건이 없어요`}
          </Text>
          <Text style={styles.emptyDesc}>
            사건을 등록하면 전문 손해사정사들이{'\n'}견적을 보내드려요
          </Text>
        </View>
      ) : (
        /* 목록 */
        <ScrollView
          style={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={Colors.primary}
            />
          }
        >
          {cases.map((item) => (
            <Card key={item.id} style={styles.caseCard}>
              {/* 상단: 유형 + 상태 */}
              <View style={styles.caseTop}>
                <View style={styles.categoryTag}>
                  <Text style={styles.categoryText}>{item.accident_type}</Text>
                </View>
                <StatusBadge status={item.status} />
              </View>

              {/* 제목 */}
              <Text style={styles.caseTitle} numberOfLines={2}>{item.title}</Text>
              <Text style={styles.caseInsurance}>{item.insurance_company}</Text>

              {/* 메타 정보 */}
              <View style={styles.caseMeta}>
                <View style={styles.metaItem}>
                  <Ionicons name="calendar-outline" size={13} color={Colors.textSecondary} />
                  <Text style={styles.metaText}>{formatDate(item.created_at)}</Text>
                </View>
                <View style={styles.metaItem}>
                  <Ionicons name="document-text-outline" size={13} color={Colors.textSecondary} />
                  <Text style={styles.metaText}>견적 {item.quotes_count}건</Text>
                </View>
                {item.images.length > 0 && (
                  <View style={styles.metaItem}>
                    <Ionicons name="image-outline" size={13} color={Colors.textSecondary} />
                    <Text style={styles.metaText}>사진 {item.images.length}장</Text>
                  </View>
                )}
              </View>

              {/* 받은 프로필 버튼 */}
              {(item.profiles_count ?? 0) > 0 && onViewReceivedProfiles && (
                <TouchableOpacity
                  style={styles.viewProfilesBtn}
                  onPress={() => onViewReceivedProfiles(item.id)}
                >
                  <Ionicons name="people-outline" size={14} color={Colors.success} />
                  <Text style={styles.viewProfilesBtnText}>
                    받은 프로필 {item.profiles_count}명 확인하기
                  </Text>
                  <Ionicons name="chevron-forward" size={14} color={Colors.success} />
                </TouchableOpacity>
              )}

              {/* 견적 보기 버튼 */}
              {(item.quotes_count ?? 0) > 0 && (
                <TouchableOpacity style={styles.viewQuotesBtn} onPress={() => onViewQuotes(item.id)}>
                  <Text style={styles.viewQuotesBtnText}>견적 보기 ({item.quotes_count}건)</Text>
                  <Ionicons name="chevron-forward" size={14} color={Colors.accent} />
                </TouchableOpacity>
              )}

              {/* 대기중: 안내 문구 */}
              {item.status === 'pending' && (item.quotes_count ?? 0) === 0 && (item.profiles_count ?? 0) === 0 && (
                <View style={styles.pendingNotice}>
                  <Ionicons name="time-outline" size={13} color={Colors.textMuted} />
                  <Text style={styles.pendingNoticeText}>사정사들이 검토 중이에요. 잠시만 기다려주세요.</Text>
                </View>
              )}
            </Card>
          ))}
          <View style={{ height: 32 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  title:       { fontSize: 20, fontWeight: '800', color: Colors.textPrimary },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  caseCount:   { fontSize: 13, color: Colors.textSecondary, fontWeight: '600' },

  filterScroll:  { backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border },
  filterContent: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: Colors.background,
    borderWidth: 1, borderColor: Colors.border,
  },
  filterChipActive:     { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterChipText:       { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' },
  filterChipTextActive: { color: Colors.white, fontWeight: '700' },

  center:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  loadingText: { fontSize: 14, color: Colors.textSecondary },
  errorText:   { fontSize: 14, color: Colors.danger, textAlign: 'center', lineHeight: 20 },
  retryBtn:    { marginTop: 8, backgroundColor: Colors.primary, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  retryBtnText:{ fontSize: 14, color: Colors.white, fontWeight: '700' },

  emptyIcon:  { width: 80, height: 80, borderRadius: 40, backgroundColor: Colors.inputBg, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  emptyDesc:  { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 19 },

  list: { flex: 1, padding: 16 },

  caseCard:      { marginBottom: 12 },
  caseTop:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  categoryTag:   { backgroundColor: Colors.primary + '12', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  categoryText:  { fontSize: 11, color: Colors.primary, fontWeight: '600' },
  caseTitle:     { fontSize: 15, fontWeight: '700', color: Colors.textPrimary, marginBottom: 4 },
  caseInsurance: { fontSize: 12, color: Colors.textSecondary, marginBottom: 10 },
  caseMeta:      { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 12 },
  metaItem:      { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText:      { fontSize: 12, color: Colors.textSecondary },

  viewProfilesBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 9,
    borderTopWidth: 1, borderTopColor: Colors.border,
    backgroundColor: Colors.success + '08',
  },
  viewProfilesBtnText: { fontSize: 13, color: Colors.success, fontWeight: '700' },

  viewQuotesBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 9,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  viewQuotesBtnText: { fontSize: 13, color: Colors.accent, fontWeight: '600' },

  pendingNotice: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.inputBg, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 7,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  pendingNoticeText: { flex: 1, fontSize: 12, color: Colors.textMuted, lineHeight: 17 },
});
