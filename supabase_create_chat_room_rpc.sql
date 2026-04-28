-- ============================================================
-- SAFE ROAD - create_chat_room RPC 함수
-- chat_rooms INSERT RLS 문제를 완전히 우회
-- Supabase SQL Editor에서 실행하세요
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_chat_room(
  p_case_id     UUID,
  p_adjuster_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_room_id UUID;
BEGIN
  -- 인증 확인
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- adjuster_profiles에 해당 사정사가 존재하는지 확인
  IF NOT EXISTS (
    SELECT 1 FROM public.adjuster_profiles WHERE id = p_adjuster_id
  ) THEN
    RAISE EXCEPTION 'adjuster_not_found: %', p_adjuster_id;
  END IF;

  -- INSERT, 이미 존재하면 기존 row 반환
  INSERT INTO public.chat_rooms (case_id, customer_id, adjuster_id)
  VALUES (p_case_id, v_uid, p_adjuster_id)
  ON CONFLICT (case_id, adjuster_id)
  DO UPDATE SET created_at = public.chat_rooms.created_at
  RETURNING id INTO v_room_id;

  RETURN v_room_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_chat_room(UUID, UUID) TO authenticated;
