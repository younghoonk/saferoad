-- ============================================================
-- SAFE ROAD - send_message RPC 함수
-- messages 테이블 RLS 문제를 완전히 우회하는 해결책
-- Supabase SQL Editor에서 실행하세요
--
-- 원리: SECURITY DEFINER 함수는 RLS를 완전히 우회하며
--       함수 내부에서 직접 참여자 검증을 수행합니다.
-- ============================================================

CREATE OR REPLACE FUNCTION public.send_message(
  p_chat_room_id UUID,
  p_content      TEXT,
  p_attachments  JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_msg RECORD;
BEGIN
  -- 인증 확인
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- 채팅방 참여자 확인 (디버그: 실제 값 포함)
  IF NOT EXISTS (
    SELECT 1 FROM public.chat_rooms
    WHERE id = p_chat_room_id
      AND (customer_id = v_uid OR adjuster_id = v_uid)
  ) THEN
    RAISE EXCEPTION 'not_a_participant: uid=%, room_id=%, room_exists=%',
      v_uid,
      p_chat_room_id,
      (SELECT EXISTS(SELECT 1 FROM public.chat_rooms WHERE id = p_chat_room_id));
  END IF;

  -- 메시지 삽입
  INSERT INTO public.messages (chat_room_id, sender_id, content, attachments, read)
  VALUES (p_chat_room_id, v_uid, p_content, p_attachments, false)
  RETURNING * INTO v_msg;

  -- chat_rooms 마지막 메시지 업데이트
  UPDATE public.chat_rooms
  SET last_message    = p_content,
      last_message_at = v_msg.created_at
  WHERE id = p_chat_room_id;

  RETURN row_to_json(v_msg)::JSONB;
END;
$$;

-- 인증된 사용자에게 실행 권한 부여
GRANT EXECUTE ON FUNCTION public.send_message(UUID, TEXT, JSONB) TO authenticated;
