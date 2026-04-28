-- ============================================================
-- SAFE ROAD - 채팅 RLS 정책 완전 수정
-- Supabase SQL Editor에서 실행하세요
--
-- 문제 원인:
--   messages INSERT 정책이 chat_rooms를 서브쿼리로 조회할 때
--   chat_rooms 자체 RLS가 적용되어 EXISTS가 항상 false 반환
--   → "new row violates row-level security policy for table messages" 오류
--
-- 해결 방법:
--   SECURITY DEFINER 함수를 통해 chat_rooms RLS를 우회하여
--   채팅방 참여 여부를 안전하게 확인
-- ============================================================

-- ── 1) 채팅방 참여 여부 확인 함수 ─────────────────────────────
--    SECURITY DEFINER: 함수 소유자(postgres) 권한으로 실행
--    → chat_rooms RLS를 우회하여 정확한 참여 여부 반환
CREATE OR REPLACE FUNCTION public.is_chat_participant(room_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_rooms
    WHERE id = room_id
      AND (customer_id = auth.uid() OR adjuster_id = auth.uid())
  );
$$;

-- ── 2) chat_rooms RLS 정책 재설정 ─────────────────────────────
ALTER TABLE public.chat_rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Chat rooms viewable by participants"  ON public.chat_rooms;
DROP POLICY IF EXISTS "Customers can create chat rooms"      ON public.chat_rooms;
DROP POLICY IF EXISTS "Participants can update chat rooms"   ON public.chat_rooms;
DROP POLICY IF EXISTS "Participants can delete chat rooms"   ON public.chat_rooms;

-- 참여자(고객 또는 사정사)만 채팅방 조회 가능
CREATE POLICY "Chat rooms viewable by participants"
  ON public.chat_rooms FOR SELECT
  USING (customer_id = auth.uid() OR adjuster_id = auth.uid());

-- 고객만 채팅방 생성 가능 (선임하기 시 생성)
CREATE POLICY "Customers can create chat rooms"
  ON public.chat_rooms FOR INSERT
  WITH CHECK (customer_id = auth.uid());

-- 참여자만 채팅방 수정 가능 (last_message 등 업데이트)
CREATE POLICY "Participants can update chat rooms"
  ON public.chat_rooms FOR UPDATE
  USING (customer_id = auth.uid() OR adjuster_id = auth.uid());

-- ── 3) messages RLS 정책 재설정 ───────────────────────────────
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Messages viewable by participants"      ON public.messages;
DROP POLICY IF EXISTS "Participants can send messages"         ON public.messages;
DROP POLICY IF EXISTS "Participants can mark messages as read" ON public.messages;

-- 참여자만 메시지 조회 가능
-- is_chat_participant 함수로 RLS 우회하여 정확한 조회
CREATE POLICY "Messages viewable by participants"
  ON public.messages FOR SELECT
  USING (public.is_chat_participant(chat_room_id));

-- 참여자만 메시지 전송 가능
-- sender_id가 본인이고, 해당 채팅방 참여자일 때만 허용
CREATE POLICY "Participants can send messages"
  ON public.messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND public.is_chat_participant(chat_room_id)
  );

-- 참여자가 상대방 메시지 읽음 처리 가능
CREATE POLICY "Participants can mark messages as read"
  ON public.messages FOR UPDATE
  USING (public.is_chat_participant(chat_room_id));

-- ── 확인 쿼리 (실행 후 결과 확인) ─────────────────────────────
-- 아래 쿼리로 정책이 올바르게 적용됐는지 확인하세요:
--
-- SELECT schemaname, tablename, policyname, cmd, qual
-- FROM pg_policies
-- WHERE tablename IN ('chat_rooms', 'messages')
-- ORDER BY tablename, policyname;
