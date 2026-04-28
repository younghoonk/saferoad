-- ============================================================
-- SAFE ROAD - 채팅 RLS 정책 완전 수정 v2
-- Supabase SQL Editor에서 실행하세요
--
-- 핵심 변경:
--   messages INSERT 정책에서 chat_rooms 서브쿼리를 완전히 제거
--   → sender_id = auth.uid() 조건만 사용
--   → chat_room_id FK 제약이 채팅방 존재 여부를 보장
-- ============================================================

-- ── 1) messages 기존 정책 전부 삭제 ──────────────────────────
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'messages'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.messages', pol.policyname);
  END LOOP;
END $$;

-- ── 2) chat_rooms 기존 정책 전부 삭제 ────────────────────────
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'chat_rooms'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.chat_rooms', pol.policyname);
  END LOOP;
END $$;

-- ── 3) is_chat_participant 함수 재생성 + 권한 부여 ────────────
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

-- 반드시 GRANT 필요 (없으면 함수 호출 자체가 실패)
GRANT EXECUTE ON FUNCTION public.is_chat_participant(UUID) TO authenticated;

-- ── 4) chat_rooms RLS 재설정 ──────────────────────────────────
ALTER TABLE public.chat_rooms ENABLE ROW LEVEL SECURITY;

-- 참여자만 조회
CREATE POLICY "chat_rooms_select"
  ON public.chat_rooms FOR SELECT
  USING (customer_id = auth.uid() OR adjuster_id = auth.uid());

-- 고객만 생성
CREATE POLICY "chat_rooms_insert"
  ON public.chat_rooms FOR INSERT
  WITH CHECK (customer_id = auth.uid());

-- 참여자만 수정 (last_message 업데이트 등)
CREATE POLICY "chat_rooms_update"
  ON public.chat_rooms FOR UPDATE
  USING (customer_id = auth.uid() OR adjuster_id = auth.uid());

-- ── 5) messages RLS 재설정 ────────────────────────────────────
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- SELECT: SECURITY DEFINER 함수로 참여자만 조회
CREATE POLICY "messages_select"
  ON public.messages FOR SELECT
  USING (public.is_chat_participant(chat_room_id));

-- INSERT: sender_id = 본인이고, 해당 채팅방 참여자인 경우만 허용
CREATE POLICY "messages_insert"
  ON public.messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND public.is_chat_participant(chat_room_id)
  );

-- UPDATE: 읽음 처리 — 참여자만 가능
CREATE POLICY "messages_update"
  ON public.messages FOR UPDATE
  USING (public.is_chat_participant(chat_room_id));

-- ── 확인 쿼리 ─────────────────────────────────────────────────
-- SELECT schemaname, tablename, policyname, cmd, qual, with_check
-- FROM pg_policies
-- WHERE tablename IN ('chat_rooms', 'messages')
-- ORDER BY tablename, policyname;
