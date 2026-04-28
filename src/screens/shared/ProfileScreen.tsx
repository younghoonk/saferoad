import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Card } from '../../components/Card';
import { Colors } from '../../constants';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';

interface ProfileScreenProps {
  onLogout: () => void;
  onEditAdjusterProfile?: () => void;
}

const MENU_ITEMS = [
  { icon: 'person-outline', label: '프로필 수정', section: 'account' },
  { icon: 'notifications-outline', label: '알림 설정', section: 'account' },
  { icon: 'lock-closed-outline', label: '비밀번호 변경', section: 'account' },
  { icon: 'document-text-outline', label: '이용약관', section: 'info' },
  { icon: 'shield-outline', label: '개인정보처리방침', section: 'info' },
  { icon: 'help-circle-outline', label: '고객센터', section: 'info' },
  { icon: 'star-outline', label: '앱 평가하기', section: 'info' },
];

interface CaseStats {
  inProgress: number;
  resolved: number;
  chatRooms: number;
}

export function ProfileScreen({ onLogout, onEditAdjusterProfile }: ProfileScreenProps) {
  const { profile, session } = useAuth();
  const isAdjuster = profile?.user_type === 'adjuster';
  const [stats, setStats] = useState<CaseStats>({ inProgress: 0, resolved: 0, chatRooms: 0 });

  useEffect(() => {
    if (!session) return;
    const uid = session.user.id;

    Promise.all([
      supabase.from('cases').select('status').eq('customer_id', uid),
      supabase.from('chat_rooms').select('id', { count: 'exact', head: true }).or(`customer_id.eq.${uid},adjuster_id.eq.${uid}`),
    ]).then(([casesRes, chatRes]) => {
      const cases = casesRes.data ?? [];
      setStats({
        inProgress: cases.filter((c) => ['pending', 'reviewing', 'in_progress'].includes(c.status)).length,
        resolved: cases.filter((c) => c.status === 'resolved').length,
        chatRooms: chatRes.count ?? 0,
      });
    });
  }, [session]);

  const handleLogout = () => {
    Alert.alert('로그아웃', '로그아웃하시겠습니까?', [
      { text: '취소', style: 'cancel' },
      { text: '로그아웃', style: 'destructive', onPress: onLogout },
    ]);
  };

  const displayName = profile?.name ?? '사용자';
  const displayEmail = session?.user.email ?? '';
  const avatarChar = displayName[0] ?? '?';

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        {/* 프로필 헤더 */}
        <LinearGradient
          colors={[Colors.primary, Colors.primaryLight]}
          style={styles.profileHeader}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <View style={styles.avatarLarge}>
            <Text style={styles.avatarLargeText}>{avatarChar}</Text>
          </View>
          <Text style={styles.profileName}>{displayName}</Text>
          <Text style={styles.profileEmail}>{displayEmail}</Text>
          {profile?.phone ? <Text style={styles.profilePhone}>{profile.phone}</Text> : null}
          <View style={styles.userTypeBadge}>
            <Ionicons
              name={isAdjuster ? 'briefcase' : 'person'}
              size={11}
              color={Colors.white}
            />
            <Text style={styles.userTypeText}>
              {isAdjuster ? '손해사정사' : '고객'}
            </Text>
          </View>
          {isAdjuster && onEditAdjusterProfile && (
            <TouchableOpacity style={styles.editProfileBtn} onPress={onEditAdjusterProfile}>
              <Ionicons name="create-outline" size={14} color={Colors.white} />
              <Text style={styles.editProfileText}>프로필 편집</Text>
            </TouchableOpacity>
          )}
        </LinearGradient>

        {/* 통계 */}
        <View style={styles.statsCard}>
          <View style={styles.statItem}>
            <Text style={styles.statNum}>{stats.inProgress}</Text>
            <Text style={styles.statLabel}>진행 사건</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statNum}>{stats.resolved}</Text>
            <Text style={styles.statLabel}>완료 사건</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statNum}>{stats.chatRooms}</Text>
            <Text style={styles.statLabel}>채팅방</Text>
          </View>
        </View>

        {/* 계정 메뉴 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>계정</Text>
          <Card style={styles.menuCard} padding={0}>
            {MENU_ITEMS.filter((m) => m.section === 'account').map((item, i, arr) => (
              <TouchableOpacity
                key={item.label}
                style={[styles.menuItem, i < arr.length - 1 && styles.menuItemBorder]}
              >
                <View style={styles.menuLeft}>
                  <View style={styles.menuIconBg}>
                    <Ionicons name={item.icon as any} size={18} color={Colors.primary} />
                  </View>
                  <Text style={styles.menuLabel}>{item.label}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
              </TouchableOpacity>
            ))}
          </Card>
        </View>

        {/* 앱 정보 메뉴 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>앱 정보</Text>
          <Card style={styles.menuCard} padding={0}>
            {MENU_ITEMS.filter((m) => m.section === 'info').map((item, i, arr) => (
              <TouchableOpacity
                key={item.label}
                style={[styles.menuItem, i < arr.length - 1 && styles.menuItemBorder]}
              >
                <View style={styles.menuLeft}>
                  <View style={styles.menuIconBg}>
                    <Ionicons name={item.icon as any} size={18} color={Colors.primary} />
                  </View>
                  <Text style={styles.menuLabel}>{item.label}</Text>
                </View>
                {item.label === '앱 평가하기' ? (
                  <View style={styles.ratingStars}>
                    {[1, 2, 3, 4, 5].map((s) => (
                      <Ionicons key={s} name="star" size={10} color="#F4C542" />
                    ))}
                  </View>
                ) : (
                  <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
                )}
              </TouchableOpacity>
            ))}
          </Card>
        </View>

        {/* 로그아웃 */}
        <View style={styles.section}>
          <Card style={styles.menuCard} padding={0}>
            <TouchableOpacity style={styles.menuItem} onPress={handleLogout}>
              <View style={styles.menuLeft}>
                <View style={[styles.menuIconBg, { backgroundColor: Colors.danger + '15' }]}>
                  <Ionicons name="log-out-outline" size={18} color={Colors.danger} />
                </View>
                <Text style={[styles.menuLabel, { color: Colors.danger }]}>로그아웃</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={Colors.danger} />
            </TouchableOpacity>
          </Card>
        </View>

        {/* 버전 */}
        <Text style={styles.version}>SAFE ROAD v1.0.0</Text>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  container: { flex: 1 },
  profileHeader: {
    alignItems: 'center',
    paddingTop: 32,
    paddingBottom: 28,
    gap: 6,
  },
  avatarLarge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  avatarLargeText: { color: Colors.white, fontSize: 32, fontWeight: '700' },
  profileName: { fontSize: 20, fontWeight: '800', color: Colors.white },
  profileEmail: { fontSize: 13, color: 'rgba(255,255,255,0.75)' },
  profilePhone: { fontSize: 13, color: 'rgba(255,255,255,0.65)' },
  userTypeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: 6, backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)',
  },
  userTypeText: { fontSize: 12, color: Colors.white, fontWeight: '600' },
  editProfileBtn: {
    marginTop: 8,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  editProfileText: { fontSize: 13, color: Colors.white, fontWeight: '600' },
  statsCard: {
    flexDirection: 'row',
    backgroundColor: Colors.white,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 22, fontWeight: '800', color: Colors.primary },
  statLabel: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  statDivider: { width: 1, backgroundColor: Colors.border },
  section: { padding: 16, paddingBottom: 4 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary, marginBottom: 10 },
  menuCard: {},
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  menuItemBorder: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  menuLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  menuIconBg: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: Colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuLabel: { fontSize: 14, color: Colors.textPrimary, fontWeight: '500' },
  ratingStars: { flexDirection: 'row', gap: 1 },
  version: { textAlign: 'center', fontSize: 12, color: Colors.textMuted, marginTop: 8 },
});
