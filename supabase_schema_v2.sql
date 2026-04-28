-- SAFE ROAD Schema v2 Update
-- Supabase SQL Editor에서 실행

-- ── cases 테이블 region 컬럼 추가 ─────────────────────────────
ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS region TEXT DEFAULT '전국';

-- ── adjuster_profiles 컬럼 추가 ────────────────────────────────
ALTER TABLE public.adjuster_profiles
  ADD COLUMN IF NOT EXISTS years_experience INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS region TEXT DEFAULT '전국',
  ADD COLUMN IF NOT EXISTS intro TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS satisfaction_rate DECIMAL(4,1) DEFAULT 100.0;

-- ── profile_sends 테이블 ────────────────────────────────────────
-- 손해사정사가 특정 사건에 자신의 프로필을 전송한 기록
CREATE TABLE IF NOT EXISTS public.profile_sends (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id UUID REFERENCES public.cases(id) ON DELETE CASCADE NOT NULL,
  adjuster_id UUID REFERENCES public.adjuster_profiles(id) ON DELETE CASCADE NOT NULL,
  message TEXT DEFAULT '',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(case_id, adjuster_id)
);

-- RLS
ALTER TABLE public.profile_sends ENABLE ROW LEVEL SECURITY;

-- 사건 소유자(고객)와 해당 사정사만 조회 가능
DROP POLICY IF EXISTS "Profile sends viewable by case owner and adjuster" ON public.profile_sends;
CREATE POLICY "Profile sends viewable by case owner and adjuster" ON public.profile_sends
  FOR SELECT USING (
    adjuster_id = auth.uid() OR
    EXISTS (SELECT 1 FROM public.cases WHERE id = case_id AND customer_id = auth.uid())
  );

-- 사정사만 전송 가능
DROP POLICY IF EXISTS "Adjusters can send profiles" ON public.profile_sends;
CREATE POLICY "Adjusters can send profiles" ON public.profile_sends
  FOR INSERT WITH CHECK (
    adjuster_id = auth.uid() AND
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND user_type = 'adjuster')
  );

-- 고객이 수락/거절 업데이트 가능
DROP POLICY IF EXISTS "Customers can update profile send status" ON public.profile_sends;
CREATE POLICY "Customers can update profile send status" ON public.profile_sends
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.cases WHERE id = case_id AND customer_id = auth.uid())
  );

-- Realtime
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.profile_sends;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Storage: 프로필 이미지 버킷 ────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-images', 'profile-images', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Authenticated users can upload profile images" ON storage.objects;
CREATE POLICY "Authenticated users can upload profile images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'profile-images');

DROP POLICY IF EXISTS "Profile images are publicly readable" ON storage.objects;
CREATE POLICY "Profile images are publicly readable"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'profile-images');

DROP POLICY IF EXISTS "Users can update own profile images" ON storage.objects;
CREATE POLICY "Users can update own profile images"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'profile-images' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users can delete own profile images" ON storage.objects;
CREATE POLICY "Users can delete own profile images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'profile-images' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ── chat_rooms RLS 정책 ─────────────────────────────────────────
ALTER TABLE public.chat_rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Chat rooms viewable by participants"  ON public.chat_rooms;
DROP POLICY IF EXISTS "Customers can create chat rooms"      ON public.chat_rooms;
DROP POLICY IF EXISTS "Participants can update chat rooms"   ON public.chat_rooms;

CREATE POLICY "Chat rooms viewable by participants"
  ON public.chat_rooms FOR SELECT USING (
    customer_id = auth.uid() OR adjuster_id = auth.uid()
  );

CREATE POLICY "Customers can create chat rooms"
  ON public.chat_rooms FOR INSERT WITH CHECK (customer_id = auth.uid());

CREATE POLICY "Participants can update chat rooms"
  ON public.chat_rooms FOR UPDATE USING (
    customer_id = auth.uid() OR adjuster_id = auth.uid()
  );

-- ── messages UPDATE 정책 (읽음 처리) ───────────────────────────
DROP POLICY IF EXISTS "Participants can mark messages as read" ON public.messages;

CREATE POLICY "Participants can mark messages as read"
  ON public.messages FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.chat_rooms
      WHERE id = chat_room_id
        AND (customer_id = auth.uid() OR adjuster_id = auth.uid())
    )
  );
