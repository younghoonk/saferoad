-- ============================================================
-- SAFE ROAD - Supabase SQL Editor에서 실행하세요
-- ============================================================

-- 1) profiles 테이블 (없으면 생성)
CREATE TABLE IF NOT EXISTS public.profiles (
  id           UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  name         TEXT NOT NULL DEFAULT '',
  phone        TEXT DEFAULT '',
  user_type    TEXT NOT NULL DEFAULT 'customer'
                 CHECK (user_type IN ('customer', 'adjuster')),
  profile_image TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 2) adjuster_profiles 테이블 (없으면 생성)
CREATE TABLE IF NOT EXISTS public.adjuster_profiles (
  id              UUID REFERENCES public.profiles(id) ON DELETE CASCADE PRIMARY KEY,
  license_number  TEXT UNIQUE NOT NULL DEFAULT '',
  specialties     TEXT[] NOT NULL DEFAULT '{}',
  rating          DECIMAL(3,1) DEFAULT 5.0,
  review_count    INT DEFAULT 0,
  resolved_cases  INT DEFAULT 0,
  bio             TEXT DEFAULT '',
  fee             TEXT
);

-- 3) cases 테이블 (없으면 생성)
CREATE TABLE IF NOT EXISTS public.cases (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id       UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  title             TEXT NOT NULL,
  accident_type     TEXT NOT NULL,
  insurance_company TEXT NOT NULL,
  description       TEXT NOT NULL,
  images            TEXT[] DEFAULT '{}',
  status            TEXT DEFAULT 'pending'
                      CHECK (status IN ('pending', 'reviewing', 'in_progress', 'resolved')),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 4) 핵심: 신규 유저 → profiles/adjuster_profiles 자동 생성 트리거
--    signUp 시 email 미인증이라도 auth.users 행은 즉시 생성됨
--    → SECURITY DEFINER 함수가 RLS 우회해서 안전하게 삽입
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- profiles 삽입
  INSERT INTO public.profiles (id, name, phone, user_type)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'name',         ''),
    COALESCE(new.raw_user_meta_data->>'phone',        ''),
    COALESCE(new.raw_user_meta_data->>'user_type', 'customer')
  )
  ON CONFLICT (id) DO NOTHING;

  -- 손해사정사면 adjuster_profiles도 삽입
  IF new.raw_user_meta_data->>'user_type' = 'adjuster' THEN
    INSERT INTO public.adjuster_profiles (id, license_number, specialties)
    VALUES (
      new.id,
      COALESCE(new.raw_user_meta_data->>'license_number', ''),
      '{}'
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;

  RETURN new;
END;
$$;

-- 기존 트리거 제거 후 재생성
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 5) RLS 활성화 및 정책
-- ============================================================
ALTER TABLE public.profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.adjuster_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cases            ENABLE ROW LEVEL SECURITY;

-- profiles: 전체 읽기 / 본인만 삽입·수정
DROP POLICY IF EXISTS "Profiles are viewable by all"  ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile"  ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile"  ON public.profiles;

CREATE POLICY "Profiles are viewable by all"
  ON public.profiles FOR SELECT USING (true);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- adjuster_profiles: 전체 읽기 / 본인만 삽입·수정
ALTER TABLE public.adjuster_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Adjuster profiles are viewable by all" ON public.adjuster_profiles;
DROP POLICY IF EXISTS "Adjusters can insert own profile"      ON public.adjuster_profiles;
DROP POLICY IF EXISTS "Adjusters can update own profile"      ON public.adjuster_profiles;

CREATE POLICY "Adjuster profiles are viewable by all"
  ON public.adjuster_profiles FOR SELECT USING (true);

CREATE POLICY "Adjusters can insert own profile"
  ON public.adjuster_profiles FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Adjusters can update own profile"
  ON public.adjuster_profiles FOR UPDATE USING (auth.uid() = id);

-- cases: 고객은 본인 사건, 사정사는 전체 조회
DROP POLICY IF EXISTS "Customers see own cases"       ON public.cases;
DROP POLICY IF EXISTS "Customers can create cases"    ON public.cases;
DROP POLICY IF EXISTS "Customers can update own cases" ON public.cases;

CREATE POLICY "Customers see own cases"
  ON public.cases FOR SELECT USING (
    customer_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND user_type = 'adjuster'
    )
  );

CREATE POLICY "Customers can create cases"
  ON public.cases FOR INSERT
  WITH CHECK (customer_id = auth.uid());

CREATE POLICY "Customers can update own cases"
  ON public.cases FOR UPDATE USING (customer_id = auth.uid());

-- ============================================================
-- 6) Storage 버킷 (case-images)
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('case-images', 'case-images', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Authenticated users can upload case images" ON storage.objects;
DROP POLICY IF EXISTS "Case images are publicly readable"          ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own case images"           ON storage.objects;

CREATE POLICY "Authenticated users can upload case images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'case-images');

CREATE POLICY "Case images are publicly readable"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'case-images');

CREATE POLICY "Users can delete own case images"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'case-images'
    AND (storage.foldername(name))[1] = auth.uid()::text);
