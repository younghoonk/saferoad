import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Header } from '../../components/Header';
import { Card } from '../../components/Card';
import { Colors } from '../../constants';
import { supabase } from '../../lib/supabase';
import { mockQuotes } from '../../lib/mockData';

interface QuoteCompareScreenProps {
  onBack: () => void;
  onChat: (adjusterId: string, adjusterName: string) => void;
  caseId?: string;
}

interface QuoteRow {
  id: string;
  case_id: string;
  adjuster_id: string;
  estimated_amount: string;
  description: string;
  timeline: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  adjuster_profiles: {
    license_number: string;
    specialties: string[];
    rating: number;
    review_count: number;
    resolved_cases: number;
    bio: string;
    fee: string;
    profiles: { name: string };
  } | null;
}

export function QuoteCompareScreen({ onBack, onChat, caseId }: QuoteCompareScreenProps) {
  const [quotes, setQuotes] = useState<QuoteRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!caseId) {
      // caseId 없으면 mock 데이터 사용
      setQuotes(
        mockQuotes.map((q) => ({
          id: q.id,
          case_id: q.caseId,
          adjuster_id: q.adjusterId,
          estimated_amount: q.estimatedAmount,
          description: q.description,
          timeline: q.timeline,
          status: q.status,
          created_at: q.createdAt,
          adjuster_profiles: q.adjuster
            ? {
                license_number: q.adjuster.licenseNumber,
                specialties: q.adjuster.specialties,
                rating: q.adjuster.rating,
                review_count: q.adjuster.reviewCount,
                resolved_cases: q.adjuster.resolvedCases,
                bio: q.adjuster.bio,
                fee: q.adjuster.fee ?? '',
                profiles: { name: q.adjuster.name },
              }
            : null,
        }))
      );
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      setError(null);
      const { data, error: err } = await supabase
        .from('quotes')
        .select(`
          *,
          adjuster_profiles(
            license_number, specialties, rating, review_count, resolved_cases, bio, fee,
            profiles(name)
          )
        `)
        .eq('case_id', caseId)
        .order('created_at', { ascending: false });

      if (err) {
        setError(err.message);
      } else {
        setQuotes((data ?? []) as QuoteRow[]);
      }
      setLoading(false);
    })();
  }, [caseId]);

  const handleAccept = (quote: QuoteRow) => {
    const adjName = quote.adjuster_profiles?.profiles?.name ?? '사정사';
    Alert.alert(
      '견적 수락',
      `${adjName} 사정사의 견적을 수락하시겠습니까?`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '수락',
          onPress: async () => {
            setSelectedId(quote.id);
            // Supabase: status 업데이트
            if (caseId) {
              await supabase
                .from('quotes')
                .update({ status: 'accepted' })
                .eq('id', quote.id);
              // 나머지 견적은 rejected
              await supabase
                .from('quotes')
                .update({ status: 'rejected' })
                .eq('case_id', caseId)
                .neq('id', quote.id);
            }
            Alert.alert('수락 완료', '1:1 채팅이 시작됩니다.', [
              { text: '채팅하기', onPress: () => onChat(quote.adjuster_id, adjName) },
            ]);
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <Header
        title="견적 비교"
        subtitle={loading ? '불러오는 중...' : `총 ${quotes.length}개의 견적`}
        showBack
        onBack={onBack}
      />
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        {/* 안내 배너 */}
        <View style={styles.banner}>
          <Ionicons name="information-circle" size={18} color={Colors.accent} />
          <Text style={styles.bannerText}>
            견적을 비교하고 가장 적합한 사정사를 선택하세요. 선택 후 1:1 채팅으로 상세 상담이 가능합니다.
          </Text>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.loadingText}>견적 불러오는 중...</Text>
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Ionicons name="alert-circle-outline" size={48} color={Colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : quotes.length === 0 ? (
          <View style={styles.center}>
            <View style={styles.emptyIcon}>
              <Ionicons name="document-text-outline" size={48} color={Colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>아직 도착한 견적이 없어요</Text>
            <Text style={styles.emptyDesc}>
              전문 손해사정사들이 검토 후{'\n'}견적을 보내드릴 예정이에요
            </Text>
          </View>
        ) : (
          <>
            {/* 정렬 */}
            <View style={styles.sortRow}>
              {['최고 견적순', '빠른 처리순', '평점순'].map((sort) => (
                <TouchableOpacity key={sort} style={styles.sortChip}>
                  <Text style={styles.sortText}>{sort}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* 견적 카드 목록 */}
            <View style={styles.list}>
              {quotes.map((quote, index) => {
                const adj = quote.adjuster_profiles;
                const adjName = adj?.profiles?.name ?? '사정사';
                return (
                  <Card
                    key={quote.id}
                    style={[styles.quoteCard, selectedId === quote.id ? styles.quoteCardSelected : undefined]}
                  >
                    {index === 0 && (
                      <View style={styles.recommendBadge}>
                        <Ionicons name="trophy" size={12} color="#B7860B" />
                        <Text style={styles.recommendText}>최고 견적</Text>
                      </View>
                    )}

                    {/* 사정사 정보 */}
                    <View style={styles.adjusterRow}>
                      <View style={styles.avatar}>
                        <Text style={styles.avatarText}>{adjName[0]}</Text>
                      </View>
                      <View style={styles.adjusterInfo}>
                        <View style={styles.nameRow}>
                          <Text style={styles.adjusterName}>{adjName} 사정사</Text>
                          {adj?.rating != null && (
                            <View style={styles.ratingBadge}>
                              <Ionicons name="star" size={11} color="#F4C542" />
                              <Text style={styles.ratingText}>{adj.rating.toFixed(1)}</Text>
                            </View>
                          )}
                        </View>
                        {adj?.license_number ? (
                          <Text style={styles.adjusterLicense}>{adj.license_number}</Text>
                        ) : null}
                        {adj?.specialties?.length ? (
                          <View style={styles.specialtyRow}>
                            {adj.specialties.map((s) => (
                              <View key={s} style={styles.specialtyTag}>
                                <Text style={styles.specialtyText}>{s}</Text>
                              </View>
                            ))}
                          </View>
                        ) : null}
                      </View>
                    </View>

                    {/* 견적 금액 */}
                    <View style={styles.amountBox}>
                      <Text style={styles.amountLabel}>예상 보상 금액</Text>
                      <Text style={styles.amountValue}>{quote.estimated_amount}</Text>
                    </View>

                    {/* 설명 */}
                    <Text style={styles.quoteDesc}>{quote.description}</Text>

                    {/* 처리 기간 */}
                    <View style={styles.timelineRow}>
                      <Ionicons name="time-outline" size={14} color={Colors.textSecondary} />
                      <Text style={styles.timelineText}>예상 처리 기간: {quote.timeline}</Text>
                    </View>

                    {/* 통계 */}
                    {adj && (
                      <View style={styles.statsRow}>
                        <View style={styles.statItem}>
                          <Text style={styles.statNum}>{adj.resolved_cases ?? '-'}</Text>
                          <Text style={styles.statLabel}>해결 건수</Text>
                        </View>
                        <View style={styles.statDivider} />
                        <View style={styles.statItem}>
                          <Text style={styles.statNum}>{adj.review_count ?? '-'}</Text>
                          <Text style={styles.statLabel}>리뷰</Text>
                        </View>
                        <View style={styles.statDivider} />
                        <View style={styles.statItem}>
                          <Text style={styles.statNum}>{adj.fee ?? '-'}</Text>
                          <Text style={styles.statLabel}>수수료</Text>
                        </View>
                      </View>
                    )}

                    {/* 버튼 */}
                    <View style={styles.btnRow}>
                      <TouchableOpacity
                        style={styles.chatBtn}
                        onPress={() => onChat(quote.adjuster_id, adjName)}
                      >
                        <Ionicons name="chatbubble-outline" size={16} color={Colors.primary} />
                        <Text style={styles.chatBtnText}>채팅 문의</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.acceptBtn, selectedId === quote.id && styles.acceptBtnSelected]}
                        onPress={() => handleAccept(quote)}
                        disabled={quote.status === 'rejected'}
                      >
                        <Text style={styles.acceptBtnText}>
                          {quote.status === 'accepted' || selectedId === quote.id
                            ? '✓ 수락됨'
                            : quote.status === 'rejected'
                            ? '거절됨'
                            : '견적 수락'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </Card>
                );
              })}
            </View>
          </>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  container: { flex: 1 },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: Colors.accent + '12',
    margin: 16,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.accent + '30',
  },
  bannerText: { flex: 1, fontSize: 12, color: Colors.accent, lineHeight: 17 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 48, gap: 12 },
  loadingText: { fontSize: 14, color: Colors.textSecondary },
  errorText: { fontSize: 14, color: Colors.danger, textAlign: 'center' },
  emptyIcon: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: Colors.inputBg,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  emptyDesc: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 19 },
  sortRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 4 },
  sortChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sortText: { fontSize: 12, color: Colors.textSecondary, fontWeight: '500' },
  list: { padding: 16, gap: 12 },
  quoteCard: { position: 'relative', overflow: 'visible' },
  quoteCardSelected: { borderColor: Colors.primary, borderWidth: 2 },
  recommendBadge: {
    position: 'absolute',
    top: -10, left: 16,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#FEF9EC',
    borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: '#F4C542',
  },
  recommendText: { fontSize: 11, color: '#B7860B', fontWeight: '700' },
  adjusterRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 8, marginBottom: 16 },
  avatar: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  avatarText: { color: Colors.white, fontSize: 18, fontWeight: '700' },
  adjusterInfo: { flex: 1 },
  nameRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  adjusterName: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  ratingBadge: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  ratingText: { fontSize: 12, fontWeight: '600', color: Colors.textPrimary },
  adjusterLicense: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  specialtyRow: { flexDirection: 'row', gap: 4, marginTop: 5 },
  specialtyTag: {
    backgroundColor: Colors.primary + '12',
    borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2,
  },
  specialtyText: { fontSize: 10, color: Colors.primary, fontWeight: '600' },
  amountBox: {
    backgroundColor: Colors.primary + '08',
    borderRadius: 12, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: Colors.primary + '20',
  },
  amountLabel: { fontSize: 11, color: Colors.primary, marginBottom: 4, fontWeight: '600' },
  amountValue: { fontSize: 22, fontWeight: '800', color: Colors.primary },
  quoteDesc: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18, marginBottom: 10 },
  timelineRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 14 },
  timelineText: { fontSize: 12, color: Colors.textSecondary },
  statsRow: {
    flexDirection: 'row',
    borderTopWidth: 1, borderTopColor: Colors.border,
    paddingTop: 12, marginBottom: 14,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary },
  statLabel: { fontSize: 10, color: Colors.textSecondary, marginTop: 1 },
  statDivider: { width: 1, backgroundColor: Colors.border },
  btnRow: { flexDirection: 'row', gap: 10 },
  chatBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1.5, borderColor: Colors.primary, borderRadius: 10, paddingVertical: 10,
  },
  chatBtnText: { fontSize: 13, color: Colors.primary, fontWeight: '600' },
  acceptBtn: {
    flex: 2, backgroundColor: Colors.primary, borderRadius: 10,
    paddingVertical: 10, alignItems: 'center',
  },
  acceptBtnSelected: { backgroundColor: Colors.success },
  acceptBtnText: { fontSize: 14, color: Colors.white, fontWeight: '700' },
});
