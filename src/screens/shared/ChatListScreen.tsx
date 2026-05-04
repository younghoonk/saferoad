import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  RefreshControl,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '../../constants';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';

interface ChatListScreenProps {
  onSelectRoom: (roomId: string, partnerName: string, partnerAvatar?: string | null) => void;
}

interface ChatRoomRow {
  id: string;
  case_id: string | null;
  customer_id: string;
  adjuster_id: string;
  last_message: string | null;
  last_message_at: string | null;
  created_at: string;
  unreadCount: number;
  partnerName: string;
  partnerAvatar: string | null;
  caseTitle: string | null;
}

export function ChatListScreen({ onSelectRoom }: ChatListScreenProps) {
  const { session, profile } = useAuth();
  const insets = useSafeAreaInsets();
  const [rooms, setRooms]       = useState<ChatRoomRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const isAdjuster = profile?.user_type === 'adjuster';

  const fetchRooms = useCallback(async () => {
    if (!session) return;
    const uid = session.user.id;

    // 1) 내가 참여한 채팅방 목록
    const { data: roomsData, error } = await supabase
      .from('chat_rooms')
      .select('id, case_id, customer_id, adjuster_id, last_message, last_message_at, created_at')
      .or(`customer_id.eq.${uid},adjuster_id.eq.${uid}`)
      .order('last_message_at', { ascending: false, nullsFirst: false });

    if (error || !roomsData?.length) {
      setRooms([]);
      return;
    }

    const roomIds    = roomsData.map((r) => r.id);
    const partnerIds = roomsData.map((r) => isAdjuster ? r.customer_id : r.adjuster_id);
    const caseIds    = roomsData.map((r) => r.case_id).filter(Boolean) as string[];

    // 2) 상대방 프로필 일괄 조회 (adjuster_profiles.id === profiles.id 이므로 동일하게 사용)
    const { data: profilesData } = await supabase
      .from('profiles')
      .select('id, name, profile_image')
      .in('id', partnerIds);

    const profileMap = new Map(
      (profilesData ?? []).map((p) => [p.id, p])
    );

    // 3) 사건 제목 일괄 조회
    const { data: casesData } = caseIds.length
      ? await supabase.from('cases').select('id, title').in('id', caseIds)
      : { data: [] };

    const caseMap = new Map((casesData ?? []).map((c) => [c.id, c.title]));

    // 4) 읽지 않은 메시지 수 일괄 조회
    const { data: unreadData } = await supabase
      .from('messages')
      .select('chat_room_id')
      .in('chat_room_id', roomIds)
      .eq('read', false)
      .neq('sender_id', uid);

    const unreadByRoom: Record<string, number> = {};
    (unreadData ?? []).forEach((m) => {
      unreadByRoom[m.chat_room_id] = (unreadByRoom[m.chat_room_id] ?? 0) + 1;
    });

    // 5) 조합
    const result: ChatRoomRow[] = roomsData.map((room) => {
      const partnerId   = isAdjuster ? room.customer_id : room.adjuster_id;
      const partnerProf = profileMap.get(partnerId);
      return {
        id:               room.id,
        case_id:          room.case_id,
        customer_id:      room.customer_id,
        adjuster_id:      room.adjuster_id,
        last_message:     room.last_message,
        last_message_at:  room.last_message_at,
        created_at:       room.created_at,
        unreadCount:      unreadByRoom[room.id] ?? 0,
        partnerName:      partnerProf?.name ?? (isAdjuster ? '고객' : '손해사정사'),
        partnerAvatar:    partnerProf?.profile_image ?? null,
        caseTitle:        room.case_id ? (caseMap.get(room.case_id) ?? null) : null,
      };
    });

    setRooms(result);
  }, [session, isAdjuster]);

  useEffect(() => {
    setLoading(true);
    fetchRooms().finally(() => setLoading(false));
  }, [fetchRooms]);

  // 실시간: chat_rooms 변경 시 목록 갱신
  useEffect(() => {
    if (!session) return;
    const ch = supabase
      .channel('chat_list_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_rooms' }, () => {
        fetchRooms();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
        fetchRooms();
      })
      .subscribe();

    channelRef.current = ch;
    return () => { supabase.removeChannel(ch); };
  }, [session, fetchRooms]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchRooms();
    setRefreshing(false);
  };

  const formatTime = (iso: string | null) => {
    if (!iso) return '';
    const d   = new Date(iso);
    const now = new Date();
    const diffMs   = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0)
      return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    if (diffDays === 1) return '어제';
    if (diffDays < 7)  return `${diffDays}일 전`;
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const totalUnread = rooms.reduce((s, r) => s + r.unreadCount, 0);

  const renderRoom = ({ item }: { item: ChatRoomRow }) => (
    <TouchableOpacity
      style={styles.roomItem}
      onPress={() => onSelectRoom(item.id, item.partnerName, item.partnerAvatar)}
      activeOpacity={0.7}
    >
      {/* 아바타 */}
      <View style={styles.avatarWrap}>
        {item.partnerAvatar ? (
          <Image source={{ uri: item.partnerAvatar }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarChar}>{item.partnerName[0]}</Text>
          </View>
        )}
        {item.unreadCount > 0 && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadText}>
              {item.unreadCount > 99 ? '99+' : String(item.unreadCount)}
            </Text>
          </View>
        )}
      </View>

      {/* 내용 */}
      <View style={styles.roomInfo}>
        <View style={styles.roomTopRow}>
          <Text style={[styles.partnerName, item.unreadCount > 0 && styles.partnerNameBold]} numberOfLines={1}>
            {item.partnerName}
          </Text>
          <Text style={styles.timeText}>
            {formatTime(item.last_message_at ?? item.created_at)}
          </Text>
        </View>
        {item.caseTitle ? (
          <Text style={styles.caseTitle} numberOfLines={1}>📁 {item.caseTitle}</Text>
        ) : null}
        <Text
          style={[styles.lastMsg, item.unreadCount > 0 && styles.lastMsgBold]}
          numberOfLines={1}
        >
          {item.last_message ?? '채팅을 시작해보세요'}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <LinearGradient
        colors={[Colors.primaryDark, Colors.primary]}
        style={[styles.header, { paddingTop: insets.top + 16 }]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.headerTitle}>채팅</Text>
            <Text style={styles.headerSub}>
              {loading ? '...' : `${rooms.length}개의 채팅방`}
              {totalUnread > 0 ? ` · 안읽은 ${totalUnread}` : ''}
            </Text>
          </View>
          <View style={styles.headerIcon}>
            <Ionicons name="chatbubbles" size={28} color="rgba(255,255,255,0.4)" />
          </View>
        </View>
      </LinearGradient>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : rooms.length === 0 ? (
        <View style={styles.center}>
          <View style={styles.emptyIcon}>
            <Ionicons name="chatbubbles-outline" size={48} color={Colors.textMuted} />
          </View>
          <Text style={styles.emptyTitle}>아직 채팅방이 없어요</Text>
          <Text style={styles.emptyDesc}>
            손해사정사를 선임하면{'\n'}1:1 채팅이 시작됩니다
          </Text>
        </View>
      ) : (
        <FlatList
          data={rooms}
          keyExtractor={(item) => item.id}
          renderItem={renderRoom}
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom + 16, 32) }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={Colors.primary}
            />
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  header: { paddingTop: 16, paddingBottom: 20, paddingHorizontal: 20 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle: { fontSize: 24, fontWeight: '900', color: Colors.white },
  headerSub:   { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  headerIcon:  { opacity: 0.6 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  emptyIcon: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: Colors.inputBg,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  emptyDesc:  { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 19 },

  roomItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: Colors.white,
    gap: 12,
  },
  separator: { height: 1, backgroundColor: Colors.border, marginLeft: 76 },

  avatarWrap:       { position: 'relative' },
  avatar:           { width: 52, height: 52, borderRadius: 26 },
  avatarPlaceholder: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarChar: { fontSize: 20, fontWeight: '700', color: Colors.white },
  unreadBadge: {
    position: 'absolute', top: -2, right: -4,
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: Colors.danger,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 2, borderColor: Colors.white,
  },
  unreadText: { fontSize: 10, color: Colors.white, fontWeight: '800' },

  roomInfo:   { flex: 1 },
  roomTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 },
  partnerName:     { fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
  partnerNameBold: { fontWeight: '800' },
  timeText:    { fontSize: 11, color: Colors.textMuted },
  caseTitle:   { fontSize: 11, color: Colors.accent, marginBottom: 3 },
  lastMsg:     { fontSize: 13, color: Colors.textSecondary },
  lastMsgBold: { color: Colors.textPrimary, fontWeight: '600' },
});
