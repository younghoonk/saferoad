-- SAFE ROAD Supabase Schema

-- Users (extends auth.users)
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  user_type TEXT NOT NULL CHECK (user_type IN ('customer', 'adjuster')),
  profile_image TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Adjuster profiles
CREATE TABLE public.adjuster_profiles (
  id UUID REFERENCES public.profiles(id) ON DELETE CASCADE PRIMARY KEY,
  license_number TEXT UNIQUE NOT NULL,
  specialties TEXT[] NOT NULL DEFAULT '{}',
  rating DECIMAL(3,1) DEFAULT 5.0,
  review_count INT DEFAULT 0,
  resolved_cases INT DEFAULT 0,
  bio TEXT,
  fee TEXT
);

-- Cases
CREATE TABLE public.cases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  accident_type TEXT NOT NULL,
  insurance_company TEXT NOT NULL,
  description TEXT NOT NULL,
  images TEXT[] DEFAULT '{}',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'reviewing', 'in_progress', 'resolved')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Quotes
CREATE TABLE public.quotes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id UUID REFERENCES public.cases(id) ON DELETE CASCADE NOT NULL,
  adjuster_id UUID REFERENCES public.adjuster_profiles(id) ON DELETE CASCADE NOT NULL,
  estimated_amount TEXT NOT NULL,
  description TEXT NOT NULL,
  timeline TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chat Rooms
CREATE TABLE public.chat_rooms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id UUID REFERENCES public.cases(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  adjuster_id UUID REFERENCES public.adjuster_profiles(id) ON DELETE CASCADE NOT NULL,
  last_message TEXT,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(case_id, adjuster_id)
);

-- Messages
CREATE TABLE public.messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_room_id UUID REFERENCES public.chat_rooms(id) ON DELETE CASCADE NOT NULL,
  sender_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  content TEXT NOT NULL,
  attachments JSONB DEFAULT '[]',
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Resolved Cases (showcase)
CREATE TABLE public.resolved_cases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id UUID REFERENCES public.cases(id),
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  original_amount TEXT NOT NULL,
  resolved_amount TEXT NOT NULL,
  description TEXT NOT NULL,
  adjuster_name TEXT NOT NULL,
  resolved_at DATE NOT NULL,
  is_public BOOLEAN DEFAULT TRUE
);

-- RLS Policies
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.adjuster_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resolved_cases ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read all, update own
CREATE POLICY "Profiles are viewable by all" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Cases: customers see own, adjusters see all
CREATE POLICY "Customers see own cases" ON public.cases FOR SELECT USING (
  customer_id = auth.uid() OR
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND user_type = 'adjuster')
);
CREATE POLICY "Customers can create cases" ON public.cases FOR INSERT WITH CHECK (customer_id = auth.uid());
CREATE POLICY "Customers can update own cases" ON public.cases FOR UPDATE USING (customer_id = auth.uid());

-- Quotes: adjusters create, customers see their case quotes
CREATE POLICY "Quotes viewable by case owner and adjuster" ON public.quotes FOR SELECT USING (
  adjuster_id = auth.uid() OR
  EXISTS (SELECT 1 FROM public.cases WHERE id = case_id AND customer_id = auth.uid())
);
CREATE POLICY "Adjusters can create quotes" ON public.quotes FOR INSERT WITH CHECK (adjuster_id = auth.uid());

-- Messages: only chat participants
CREATE POLICY "Messages viewable by participants" ON public.messages FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.chat_rooms
    WHERE id = chat_room_id AND (customer_id = auth.uid() OR adjuster_id = auth.uid())
  )
);
CREATE POLICY "Participants can send messages" ON public.messages FOR INSERT WITH CHECK (
  sender_id = auth.uid() AND
  EXISTS (
    SELECT 1 FROM public.chat_rooms
    WHERE id = chat_room_id AND (customer_id = auth.uid() OR adjuster_id = auth.uid())
  )
);

-- Resolved cases: public read
CREATE POLICY "Resolved cases are public" ON public.resolved_cases FOR SELECT USING (is_public = TRUE);

-- Realtime for messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_rooms;

-- ── Storage: 사건 이미지 버킷 ──────────────────────────────────
-- Supabase 대시보드 Storage 탭에서 직접 생성하거나 아래 SQL 실행
INSERT INTO storage.buckets (id, name, public)
VALUES ('case-images', 'case-images', true)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: 로그인 사용자만 업로드, 전체 공개 다운로드
CREATE POLICY "Authenticated users can upload case images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'case-images');

CREATE POLICY "Case images are publicly readable"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'case-images');

CREATE POLICY "Users can delete own case images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'case-images' AND (storage.foldername(name))[1] = auth.uid()::text);
