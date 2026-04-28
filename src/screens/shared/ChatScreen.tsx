import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Header } from '../../components/Header';
import { Colors } from '../../constants';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';

interface ChatScreenProps {
  onBack: () => void;
  chatRoomId: string;       // '' 이면 미연결 상태
  partnerName: string;
  partnerAvatar?: string | null;
}

interface MsgRow {
  id: string;
  chat_room_id: string;
  sender_id: string;
  content: string;
  attachments: { name: string; url: string; type: 'image' | 'document'; size: number }[];
  read: boolean;
  created_at: string;
}

export function ChatScreen({ onBack, chatRoomId, partnerName, partnerAvatar }: ChatScreenProps) {
  const { session } = useAuth();
  const uid = session?.user.id ?? '';

  const [messages,       setMessages]       = useState<MsgRow[]>([]);
  const [inputText,      setInputText]      = useState('');
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [sending,        setSending]        = useState(false);
  const [loadingMsgs,    setLoadingMsgs]    = useState(true);

  const flatListRef = useRef<FlatList>(null);
  const channelRef  = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ── 초기 메시지 로드 ───────────────────────────────────────────
  const fetchMessages = useCallback(async () => {
    if (!chatRoomId) { setLoadingMsgs(false); return; }
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('chat_room_id', chatRoomId)
      .order('created_at', { ascending: true });

    if (!error && data) {
      setMessages(data as MsgRow[]);
    }
    setLoadingMsgs(false);
  }, [chatRoomId]);

  useEffect(() => {
    setLoadingMsgs(true);
    fetchMessages();
  }, [fetchMessages]);

  // ── 읽음 처리 ──────────────────────────────────────────────────
  useEffect(() => {
    if (!chatRoomId || !uid) return;
    supabase
      .from('messages')
      .update({ read: true })
      .eq('chat_room_id', chatRoomId)
      .eq('read', false)
      .neq('sender_id', uid)
      .then(() => {});
  }, [chatRoomId, uid]);

  // ── Realtime 구독 ──────────────────────────────────────────────
  useEffect(() => {
    if (!chatRoomId) return;

    const ch = supabase
      .channel(`chat:${chatRoomId}`)
      .on(
        'postgres_changes',
        {
          event:  'INSERT',
          schema: 'public',
          table:  'messages',
          filter: `chat_room_id=eq.${chatRoomId}`,
        },
        (payload) => {
          const newMsg = payload.new as MsgRow;
          setMessages((prev) => {
            // 내가 보낸 메시지는 이미 낙관적 업데이트로 추가됨 → 중복 방지
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
          // 상대방 메시지 자동 읽음
          if (newMsg.sender_id !== uid) {
            supabase
              .from('messages')
              .update({ read: true })
              .eq('id', newMsg.id)
              .then(() => {});
          }
          setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 80);
        }
      )
      .subscribe();

    channelRef.current = ch;
    return () => { supabase.removeChannel(ch); };
  }, [chatRoomId, uid]);

  // ── 스크롤 최하단 ─────────────────────────────────────────────
  useEffect(() => {
    if (!loadingMsgs && messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 100);
    }
  }, [loadingMsgs]);

  // ── 메시지 전송 ───────────────────────────────────────────────
  const sendMessage = async (content: string, attachments: MsgRow['attachments'] = []) => {
    if (!content.trim() && attachments.length === 0) return;
    if (!chatRoomId || !uid) return;

    setSending(true);
    const optimisticId = `optimistic-${Date.now()}`;
    const optimistic: MsgRow = {
      id:           optimisticId,
      chat_room_id: chatRoomId,
      sender_id:    uid,
      content:      content.trim() || '📎 첨부파일',
      attachments,
      read:         false,
      created_at:   new Date().toISOString(),
    };

    // 낙관적 업데이트
    setMessages((prev) => [...prev, optimistic]);
    setInputText('');
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 80);

    // RLS 우회: SECURITY DEFINER RPC 함수 사용
    const { data, error } = await supabase.rpc('send_message', {
      p_chat_room_id: chatRoomId,
      p_content:      content.trim() || '📎 첨부파일',
      p_attachments:  attachments.length > 0 ? attachments : [],
    });

    if (error) {
      // 낙관적 메시지 제거 후 에러 표시
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      Alert.alert('전송 실패', error.message);
    } else if (data) {
      // 낙관적 메시지를 실제 메시지로 교체 (RPC가 chat_rooms 업데이트까지 처리)
      setMessages((prev) => prev.map((m) => m.id === optimisticId ? data as MsgRow : m));
    }
    setSending(false);
  };

  const handleSend = () => sendMessage(inputText);

  // ── 파일 첨부 ─────────────────────────────────────────────────
  const attachDocument = async () => {
    setShowAttachMenu(false);
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*', 'application/msword'],
      copyToCacheDirectory: true,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      await sendMessage(`📎 ${asset.name}`, [{
        name: asset.name, url: asset.uri, type: 'document', size: asset.size ?? 0,
      }]);
    }
  };

  const attachImage = async () => {
    setShowAttachMenu(false);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      await sendMessage('📷 이미지', [{
        name: '이미지.jpg', url: asset.uri, type: 'image', size: 0,
      }]);
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
  };

  // ── 날짜 구분선 ───────────────────────────────────────────────
  const renderMessage = ({ item, index }: { item: MsgRow; index: number }) => {
    const isMine   = item.sender_id === uid;
    const prevItem = index > 0 ? messages[index - 1] : null;
    const showDate = !prevItem ||
      new Date(item.created_at).toDateString() !== new Date(prevItem.created_at).toDateString();
    const hasAttach = item.attachments?.length > 0;

    return (
      <>
        {showDate && (
          <View style={styles.dateSeparator}>
            <View style={styles.dateLine} />
            <Text style={styles.dateText}>{formatDate(item.created_at)}</Text>
            <View style={styles.dateLine} />
          </View>
        )}
        <View style={[styles.msgRow, isMine && styles.msgRowMine]}>
          {!isMine && (
            <View style={styles.avatarSmall}>
              {partnerAvatar ? (
                <Image source={{ uri: partnerAvatar }} style={styles.avatarSmallImg} />
              ) : (
                <Text style={styles.avatarSmallText}>{partnerName[0]}</Text>
              )}
            </View>
          )}
          <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleOther]}>
            {hasAttach && (
              <View style={[styles.attachRow, isMine && styles.attachRowMine]}>
                <Ionicons
                  name={item.attachments[0].type === 'image' ? 'image-outline' : 'document-outline'}
                  size={20}
                  color={isMine ? Colors.white : Colors.primary}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.attachName, isMine && { color: Colors.white }]}>
                    {item.attachments[0].name}
                  </Text>
                  {item.attachments[0].size > 0 && (
                    <Text style={[styles.attachSize, isMine && { color: 'rgba(255,255,255,0.7)' }]}>
                      {(item.attachments[0].size / 1024).toFixed(1)} KB
                    </Text>
                  )}
                </View>
              </View>
            )}
            {item.content && !item.content.startsWith('📎') && !item.content.startsWith('📷') && (
              <Text style={[styles.bubbleText, isMine && styles.bubbleTextMine]}>
                {item.content}
              </Text>
            )}
          </View>
          <View style={styles.msgMeta}>
            {isMine && (
              <Text style={styles.readMark}>{item.read ? '읽음' : ''}</Text>
            )}
            <Text style={styles.timeText}>{formatTime(item.created_at)}</Text>
          </View>
        </View>
      </>
    );
  };

  // ── 미연결 상태 ───────────────────────────────────────────────
  if (!chatRoomId) {
    return (
      <SafeAreaView style={styles.safe}>
        <Header title={partnerName ? `${partnerName} 사정사` : '채팅'} showBack onBack={onBack} />
        <View style={styles.center}>
          <Ionicons name="chatbubbles-outline" size={56} color={Colors.textMuted} />
          <Text style={styles.noRoomTitle}>채팅방이 없습니다</Text>
          <Text style={styles.noRoomDesc}>사건을 등록하고 손해사정사를{'\n'}선임하면 채팅이 시작됩니다</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <Header
        title={`${partnerName}`}
        subtitle="1:1 채팅"
        showBack
        onBack={onBack}
        rightElement={
          <TouchableOpacity>
            <Ionicons name="ellipsis-vertical" size={20} color={Colors.primary} />
          </TouchableOpacity>
        }
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {loadingMsgs ? (
          <View style={styles.center}>
            <ActivityIndicator color={Colors.primary} />
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderMessage}
            contentContainerStyle={styles.msgList}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
            ListEmptyComponent={
              <View style={styles.emptyChat}>
                <Text style={styles.emptyChatText}>첫 메시지를 보내보세요 👋</Text>
              </View>
            }
          />
        )}

        {/* 첨부 메뉴 */}
        {showAttachMenu && (
          <View style={styles.attachMenu}>
            {[
              { label: '문서 첨부', icon: 'document-outline',  color: Colors.accent,   bg: Colors.accent + '20',   onPress: attachDocument },
              { label: '사진 첨부', icon: 'image-outline',     color: Colors.success,  bg: Colors.success + '20',  onPress: attachImage },
              { label: '카메라',   icon: 'camera-outline',    color: '#9B59B6',        bg: '#9B59B620',             onPress: () => { setShowAttachMenu(false); Alert.alert('준비 중', '카메라 기능은 준비 중입니다.'); } },
            ].map((opt) => (
              <TouchableOpacity key={opt.label} style={styles.attachOpt} onPress={opt.onPress}>
                <View style={[styles.attachIconWrap, { backgroundColor: opt.bg }]}>
                  <Ionicons name={opt.icon as any} size={22} color={opt.color} />
                </View>
                <Text style={styles.attachLabel}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* 입력창 */}
        <View style={styles.inputBar}>
          <TouchableOpacity
            style={styles.attachBtn}
            onPress={() => setShowAttachMenu((v) => !v)}
          >
            <Ionicons
              name={showAttachMenu ? 'close' : 'add-circle-outline'}
              size={26}
              color={Colors.primary}
            />
          </TouchableOpacity>
          <TextInput
            style={styles.textInput}
            placeholder="메시지를 입력하세요..."
            placeholderTextColor={Colors.textMuted}
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={500}
          />
          <TouchableOpacity
            style={[styles.sendBtn, inputText.trim() && !sending && styles.sendBtnActive]}
            onPress={handleSend}
            disabled={!inputText.trim() || sending}
          >
            {sending ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <Ionicons
                name="send"
                size={18}
                color={inputText.trim() ? Colors.white : Colors.textMuted}
              />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  noRoomTitle: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  noRoomDesc:  { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 19 },

  msgList: { padding: 16, gap: 4, paddingBottom: 8 },

  dateSeparator: {
    flexDirection: 'row', alignItems: 'center',
    gap: 8, marginVertical: 12,
  },
  dateLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dateText: { fontSize: 11, color: Colors.textMuted, fontWeight: '500' },

  msgRow:     { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginVertical: 3 },
  msgRowMine: { flexDirection: 'row-reverse' },

  avatarSmall: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  avatarSmallImg:  { width: 32, height: 32, borderRadius: 16 },
  avatarSmallText: { color: Colors.white, fontSize: 13, fontWeight: '700' },

  bubble: { maxWidth: '72%', borderRadius: 16, padding: 11 },
  bubbleMine: {
    backgroundColor: Colors.primary,
    borderBottomRightRadius: 4,
  },
  bubbleOther: {
    backgroundColor: Colors.white,
    borderBottomLeftRadius: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  bubbleText:     { fontSize: 14, color: Colors.textPrimary, lineHeight: 19 },
  bubbleTextMine: { color: Colors.white },

  attachRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.primary + '15',
    borderRadius: 10, padding: 8,
  },
  attachRowMine: { backgroundColor: 'rgba(255,255,255,0.2)' },
  attachName: { fontSize: 13, fontWeight: '600', color: Colors.primary },
  attachSize: { fontSize: 11, color: Colors.textSecondary },

  msgMeta:  { alignItems: 'flex-end', gap: 2 },
  readMark: { fontSize: 10, color: Colors.primary, fontWeight: '600' },
  timeText: { fontSize: 10, color: Colors.textMuted },

  emptyChat:     { alignItems: 'center', paddingTop: 60 },
  emptyChatText: { fontSize: 14, color: Colors.textMuted },

  attachMenu: {
    flexDirection: 'row', backgroundColor: Colors.white,
    padding: 16, gap: 20,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  attachOpt:     { alignItems: 'center', gap: 6 },
  attachIconWrap: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  attachLabel:   { fontSize: 11, color: Colors.textSecondary },

  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    padding: 10, paddingBottom: 16,
    backgroundColor: Colors.white,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  attachBtn: { padding: 4 },
  textInput: {
    flex: 1, backgroundColor: Colors.inputBg,
    borderRadius: 20, paddingHorizontal: 14,
    paddingTop: 10, paddingBottom: 10,
    fontSize: 14, color: Colors.textPrimary,
    maxHeight: 100, borderWidth: 1, borderColor: Colors.border,
  },
  sendBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnActive: { backgroundColor: Colors.primary },
});
