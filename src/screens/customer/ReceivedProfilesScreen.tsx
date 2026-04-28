import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  Alert,
  Image,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Card } from '../../components/Card';
import { Colors } from '../../constants';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

interface ReceivedProfilesScreenProps {
  onBack: () => void;
  onChat: (adjusterId: string, adjusterName: string) => void;
  caseId?: string; // 특정 사건 지정 시
}

interface ProfileSendRow {
  id: string;
  case_id: string;
  adjuster_id: string;
  message: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  adjuster_profiles: {
    license_number: string;
    specialties: string[];
    rating: number;
    review_count: number;
    resolved_cases: number;
    years_experience: number;
    region: string;
    intro: string;
    satisfaction_rate: number;
    profiles: {
      name: string;
      profile_image: string | null;
    };
  } | null;
  cases: {
    id: string;
    title: string;
    accident_type: string;
    insurance_company: string;
  } | null;
}

interface GroupedSends {
  caseId: string;
  caseTitle: string;
  accidentType: string;
  insuranceCompany: string;
  sends: ProfileSendRow[];
}

export function ReceivedProfilesScreen({ onBack, onChat, caseId }: ReceivedProfilesScreenProps) {
  const { session, profile } = useAuth();
  const [groups, setGroups] = useState<GroupedSends[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSends = useCallback(async () => {
    if (!session) return;
    setError(null);

    let query = supabase
      .from('profile_sends')
      .select(`
        *,
        adjuster_profiles(
          license_number, specialties, rating, review_count, resolved_cases,
          years_experience, region, intro, satisfaction_rate,
          profiles!inner(name, profile_image)
        ),
        cases!inner(id, title, accident_type, insurance_company, customer_id)
      `)
      .order('created_at', { ascending: false });

    if (caseId) {
      query = query.eq('case_id', caseId);
    }

    const { data, error: err } = await query;

    if (err) {
      setError(err.message);
      return;
    }

    const rows = (data ?? []) as ProfileSendRow[];
    // Filter: only rows where case belongs to current user
    const mine = rows.filter((r) => (r.cases as any)?.customer_id === session.user.id);

    // Group by case
    const map = new Map<string, GroupedSends>();
    for (const row of mine) {
      const c = row.cases!;
      if (!map.has(row.case_id)) {
        map.set(row.case_id, {
          caseId: c.id,
          caseTitle: c.title,
          accidentType: c.accident_type,
          insuranceCompany: c.insurance_company,
          sends: [],
        });
      }
      map.get(row.case_id)!.sends.push(row);
    }
    setGroups(Array.from(map.values()));
  }, [session, caseId]);

  useEffect(() => {
    setLoading(true);
    fetchSends().finally(() => setLoading(false));
  }, [fetchSends]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchSends();
    setRefreshing(false);
  };

  const handleAccept = async (send: ProfileSendRow) => {
    const name = send.adjuster_profiles?.profiles?.name ?? '사정사';
    Alert.alert(
      '선임하기',
      `${name} 사정사를 선임하시겠습니까?\n선임 후 1:1 채팅이 시작됩니다.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '선임하기',
          onPress: async () => {
            if (!session) return;

            // 해당 send 수락 + 같은 사건 다른 send 거절
            await supabase.from('profile_sends').update({ status: 'accepted' }).eq('id', send.id);
            await supabase.from('profile_sends')
              .update({ status: 'rejected' })
              .eq('case_id', send.case_id)
              .neq('id', send.id);

            // 사건 상태 in_progress로 변경
            await supabase.from('cases').update({ status: 'in_progress' }).eq('id', send.case_id);

            // ── 채팅방 생성: SECURITY DEFINER RPC 사용 (RLS 우회) ──
            const { data: roomId, error: roomErr } = await supabase
              .rpc('create_chat_room', {
                p_case_id:     send.case_id,
                p_adjuster_id: send.adjuster_id,
              });

            if (roomErr) {
              if (roomErr.message.includes('adjuster_not_found')) {
                Alert.alert('오류', '사정사 정보를 찾을 수 없습니다.');
              } else if (roomErr.message.includes('not_authenticated')) {
                Alert.alert('오류', '로그인이 필요합니다.');
              } else {
                Alert.alert('채팅방 생성 실패', roomErr.message);
              }
              return;
            }

            if (!roomId) {
              Alert.alert('오류', '채팅방 ID를 받지 못했습니다.');
              return;
            }

            onChat(roomId as string, name);
            await fetchSends();
          },
        },
      ]
    );
  };

  const totalCount = groups.reduce((sum, g) => sum + g.sends.length, 0);

  return (
    <SafeAreaView style={styles.safe}>
      {/* 헤더 */}
      <View style={styles.headerBar}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Ionicons name="chevron-back" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitle}>받은 프로필</Text>
          {!loading && (
            <Text style={styles.headerSub}>{totalCount}명의 사정사가 프로필을 보냈어요</Text>
          )}
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>프로필 불러오는 중...</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={48} color={Colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : groups.length === 0 ? (
        <View style={styles.center}>
          <View style={styles.emptyIcon}>
            <Ionicons name="people-outline" size={48} color={Colors.textMuted} />
          </View>
          <Text style={styles.emptyTitle}>아직 도착한 프로필이 없어요</Text>
          <Text style={styles.emptyDesc}>
            전문 손해사정사들이 검토 후{'\n'}프로필을 보내드릴 예정이에요
          </Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.primary} />
          }
        >
          {groups.map((group) => (
            <View key={group.caseId} style={styles.groupSection}>
              {/* 사건 요약 바 */}
              <View style={styles.caseSummaryBar}>
                <View style={styles.caseSummaryLeft}>
                  <View style={styles.caseTypeTag}>
                    <Text style={styles.caseTypeText}>{group.accidentType}</Text>
                  </View>
                  <Text style={styles.caseSummaryTitle} numberOfLines={1}>{group.caseTitle}</Text>
                </View>
                <View style={styles.caseSendsBadge}>
                  <Text style={styles.caseSendsCount}>{group.sends.length}명</Text>
                </View>
              </View>

              {/* 프로필 카드 목록 */}
              {group.sends.map((send, idx) => {
                const adj = send.adjuster_profiles;
                const adjName = adj?.profiles?.name ?? '사정사';
                const profileImage = adj?.profiles?.profile_image;
                const isAccepted = send.status === 'accepted';
                const isRejected = send.status === 'rejected';

                return (
                  <Card
                    key={send.id}
                    style={[
                      styles.profileCard,
                      isAccepted && styles.profileCardAccepted,
                      isRejected && styles.profileCardRejected,
                    ]}
                  >
                    {/* 베스트 추천 뱃지 */}
                    {idx === 0 && group.sends.length > 1 && (
                      <View style={styles.bestBadge}>
                        <Ionicons name="trophy" size={11} color="#B7860B" />
                        <Text style={styles.bestBadgeText}>최고 평점</Text>
                      </View>
                    )}

                    {/* 수락됨 뱃지 */}
                    {isAccepted && (
                      <View style={styles.acceptedBadge}>
                        <Ionicons name="checkmark-circle" size={13} color={Colors.success} />
                        <Text style={styles.acceptedBadgeText}>선임됨</Text>
                      </View>
                    )}

                    {/* 사정사 정보 */}
                    <View style={styles.adjRow}>
                      <View style={styles.adjAvatarWrap}>
                        {profileImage ? (
                          <Image source={{ uri: profileImage }} style={styles.adjAvatarImg} />
                        ) : (
                          <View style={styles.adjAvatar}>
                            <Text style={styles.adjAvatarText}>{adjName[0]}</Text>
                          </View>
                        )}
                        {adj?.rating != null && (
                          <View style={styles.ratingBadge}>
                            <Ionicons name="star" size={9} color="#F4C542" />
                            <Text style={styles.ratingText}>{adj.rating.toFixed(1)}</Text>
                          </View>
                        )}
                      </View>
                      <View style={styles.adjInfo}>
                        <View style={styles.adjNameRow}>
                          <Text style={styles.adjName}>{adjName} 사정사</Text>
                          {adj?.review_count ? (
                            <Text style={styles.reviewCount}>리뷰 {adj.review_count}</Text>
                          ) : null}
                        </View>
                        <Text style={styles.adjLicense}>{adj?.license_number ?? ''}</Text>
                        {adj?.specialties?.length ? (
                          <View style={styles.tagRow}>
                            {adj.specialties.map((s) => (
                              <View key={s} style={styles.specialtyTag}>
                                <Text style={styles.specialtyTagText}>{s}</Text>
                              </View>
                            ))}
                          </View>
                        ) : null}
                      </View>
                    </View>

                    {/* 한줄 소개 */}
                    {adj?.intro ? (
                      <Text style={styles.intro} numberOfLines={2}>{adj.intro}</Text>
                    ) : null}

                    {/* 통계 */}
                    <View style={styles.statsRow}>
                      {[
                        { icon: 'briefcase-outline',     label: '경력',    value: adj?.years_experience != null ? `${adj.years_experience}년` : '-' },
                        { icon: 'checkmark-circle-outline', label: '해결',  value: adj?.resolved_cases != null ? `${adj.resolved_cases}건` : '-' },
                        { icon: 'happy-outline',          label: '만족도',  value: adj?.satisfaction_rate != null ? `${adj.satisfaction_rate}%` : '-' },
                        { icon: 'location-outline',       label: '지역',    value: adj?.region || '-' },
                      ].map((s) => (
                        <View key={s.label} style={styles.statItem}>
                          <Ionicons name={s.icon as any} size={14} color={Colors.primary} />
                          <Text style={styles.statValue}>{s.value}</Text>
                          <Text style={styles.statLabel}>{s.label}</Text>
                        </View>
                      ))}
                    </View>

                    {/* 사정사 메시지 */}
                    {send.message ? (
                      <View style={styles.messageBox}>
                        <Ionicons name="chatbubble-ellipses-outline" size={13} color={Colors.accent} />
                        <Text style={styles.messageText}>{send.message}</Text>
                      </View>
                    ) : null}

                    {/* 버튼 */}
                    {!isRejected && (
                      <View style={styles.btnRow}>
                        <TouchableOpacity
                          style={styles.chatBtn}
                          onPress={() => onChat(send.adjuster_id, adjName)}
                        >
                          <Ionicons name="chatbubble-outline" size={15} color={Colors.primary} />
                          <Text style={styles.chatBtnText}>채팅하기</Text>
                        </TouchableOpacity>
                        {!isAccepted && (
                          <TouchableOpacity
                            style={styles.hireBtn}
                            onPress={() => handleAccept(send)}
                          >
                            <Ionicons name="person-add-outline" size={15} color={Colors.white} />
                            <Text style={styles.hireBtnText}>선임하기</Text>
                          </TouchableOpacity>
                        )}
                        {isAccepted && (
                          <View style={styles.hireBtnAccepted}>
                            <Ionicons name="checkmark-circle" size={15} color={Colors.success} />
                            <Text style={styles.hireBtnAcceptedText}>선임 완료</Text>
                          </View>
                        )}
                      </View>
                    )}
                  </Card>
                );
              })}
            </View>
          ))}
          <View style={{ height: 32 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.inputBg,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: Colors.textPrimary },
  headerSub: { fontSize: 12, color: Colors.accent, fontWeight: '600', marginTop: 1 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  loadingText: { fontSize: 14, color: Colors.textSecondary },
  errorText: { fontSize: 14, color: Colors.danger, textAlign: 'center' },
  emptyIcon: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: Colors.inputBg,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  emptyDesc: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 19 },

  groupSection: { marginTop: 8 },

  caseSummaryBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.primary + '0A',
    paddingHorizontal: 16, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: Colors.primary + '20',
    borderBottomWidth: 1, borderBottomColor: Colors.primary + '20',
    marginBottom: 8,
  },
  caseSummaryLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  caseTypeTag: {
    backgroundColor: Colors.primary + '18', borderRadius: 7,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  caseTypeText: { fontSize: 11, color: Colors.primary, fontWeight: '600' },
  caseSummaryTitle: { flex: 1, fontSize: 13, fontWeight: '700', color: Colors.textPrimary },
  caseSendsBadge: {
    backgroundColor: Colors.primary, borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 3,
  },
  caseSendsCount: { fontSize: 12, color: Colors.white, fontWeight: '700' },

  profileCard: { marginHorizontal: 16, marginBottom: 12, position: 'relative', overflow: 'visible' },
  profileCardAccepted: { borderColor: Colors.success, borderWidth: 2 },
  profileCardRejected: { opacity: 0.5 },

  bestBadge: {
    position: 'absolute', top: -10, left: 14,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#FEF9EC', borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: '#F4C542',
  },
  bestBadgeText: { fontSize: 10, color: '#B7860B', fontWeight: '700' },
  acceptedBadge: {
    position: 'absolute', top: -10, right: 14,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#E8F8EF', borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: Colors.success + '50',
  },
  acceptedBadgeText: { fontSize: 10, color: Colors.success, fontWeight: '700' },

  adjRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 8, marginBottom: 12 },
  adjAvatarWrap: { alignItems: 'center', gap: 4 },
  adjAvatar: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  adjAvatarImg: { width: 52, height: 52, borderRadius: 26 },
  adjAvatarText: { fontSize: 20, fontWeight: '700', color: Colors.white },
  ratingBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: '#FEF9EC', borderRadius: 8,
    paddingHorizontal: 5, paddingVertical: 2,
  },
  ratingText: { fontSize: 10, fontWeight: '700', color: '#B7860B' },
  adjInfo: { flex: 1 },
  adjNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  adjName: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  reviewCount: { fontSize: 11, color: Colors.textSecondary },
  adjLicense: { fontSize: 11, color: Colors.textSecondary, marginTop: 2, marginBottom: 6 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  specialtyTag: {
    backgroundColor: Colors.primary + '12', borderRadius: 6,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  specialtyTagText: { fontSize: 10, color: Colors.primary, fontWeight: '600' },

  intro: {
    fontSize: 13, color: Colors.textSecondary, lineHeight: 18,
    marginBottom: 12,
  },

  statsRow: {
    flexDirection: 'row',
    backgroundColor: Colors.background,
    borderRadius: 10, padding: 10,
    marginBottom: 12,
  },
  statItem: { flex: 1, alignItems: 'center', gap: 3 },
  statValue: { fontSize: 12, fontWeight: '700', color: Colors.textPrimary },
  statLabel: { fontSize: 10, color: Colors.textSecondary },

  messageBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 7,
    backgroundColor: Colors.accent + '0D',
    borderRadius: 10, padding: 10, marginBottom: 12,
    borderWidth: 1, borderColor: Colors.accent + '25',
  },
  messageText: { flex: 1, fontSize: 12, color: Colors.accent, lineHeight: 17 },

  btnRow: { flexDirection: 'row', gap: 10 },
  chatBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1.5, borderColor: Colors.primary, borderRadius: 10, paddingVertical: 10,
  },
  chatBtnText: { fontSize: 13, color: Colors.primary, fontWeight: '600' },
  hireBtn: {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 10,
  },
  hireBtnText: { fontSize: 13, color: Colors.white, fontWeight: '700' },
  hireBtnAccepted: {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.success + '15', borderRadius: 10, paddingVertical: 10,
    borderWidth: 1, borderColor: Colors.success + '40',
  },
  hireBtnAcceptedText: { fontSize: 13, color: Colors.success, fontWeight: '700' },
});
