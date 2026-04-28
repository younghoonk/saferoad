-- SAFE ROAD - MVP security hardening for RLS
-- Run this after the base schema and v2 schema files.

-- Profiles: users can see themselves, public adjuster directory entries,
-- and users connected through a case/chat/profile send.
DROP POLICY IF EXISTS "Profiles are viewable by all" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_related" ON public.profiles;

CREATE POLICY "profiles_select_related"
  ON public.profiles FOR SELECT
  USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.adjuster_profiles ap
      WHERE ap.id = profiles.id
    )
    OR EXISTS (
      SELECT 1 FROM public.cases c
      WHERE (c.customer_id = auth.uid() AND profiles.id = c.customer_id)
         OR (c.customer_id = profiles.id AND c.customer_id = auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.chat_rooms cr
      WHERE (cr.customer_id = auth.uid() AND profiles.id = cr.adjuster_id)
         OR (cr.adjuster_id = auth.uid() AND profiles.id = cr.customer_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.profile_sends ps
      JOIN public.cases c ON c.id = ps.case_id
      WHERE (c.customer_id = auth.uid() AND profiles.id = ps.adjuster_id)
         OR (ps.adjuster_id = auth.uid() AND profiles.id = c.customer_id)
    )
  );

-- Cases: visible only to owner or directly related adjusters.
DROP POLICY IF EXISTS "Customers see own cases" ON public.cases;
DROP POLICY IF EXISTS "cases_select_related" ON public.cases;

CREATE POLICY "cases_select_related"
  ON public.cases FOR SELECT
  USING (
    customer_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.quotes q
      WHERE q.case_id = cases.id AND q.adjuster_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.profile_sends ps
      WHERE ps.case_id = cases.id AND ps.adjuster_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.chat_rooms cr
      WHERE cr.case_id = cases.id AND cr.adjuster_id = auth.uid()
    )
  );

-- Chat rooms: only participants.
ALTER TABLE public.chat_rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Chat rooms viewable by participants" ON public.chat_rooms;
DROP POLICY IF EXISTS "chat_rooms_select" ON public.chat_rooms;
DROP POLICY IF EXISTS "Customers can create chat rooms" ON public.chat_rooms;
DROP POLICY IF EXISTS "chat_rooms_insert" ON public.chat_rooms;
DROP POLICY IF EXISTS "Participants can update chat rooms" ON public.chat_rooms;
DROP POLICY IF EXISTS "chat_rooms_update" ON public.chat_rooms;

CREATE POLICY "chat_rooms_select"
  ON public.chat_rooms FOR SELECT
  USING (customer_id = auth.uid() OR adjuster_id = auth.uid());

CREATE POLICY "chat_rooms_insert"
  ON public.chat_rooms FOR INSERT
  WITH CHECK (
    customer_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.adjuster_profiles ap
      WHERE ap.id = chat_rooms.adjuster_id
    )
    AND (
      case_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.cases c
        WHERE c.id = chat_rooms.case_id AND c.customer_id = auth.uid()
      )
    )
  );

CREATE POLICY "chat_rooms_update"
  ON public.chat_rooms FOR UPDATE
  USING (customer_id = auth.uid() OR adjuster_id = auth.uid())
  WITH CHECK (customer_id = auth.uid() OR adjuster_id = auth.uid());

-- SECURITY DEFINER helper: validates the caller against chat_rooms while avoiding RLS recursion.
CREATE OR REPLACE FUNCTION public.is_chat_participant(room_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.chat_rooms
      WHERE id = room_id
        AND (customer_id = auth.uid() OR adjuster_id = auth.uid())
    );
$$;

REVOKE ALL ON FUNCTION public.is_chat_participant(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_chat_participant(UUID) TO authenticated;

-- Messages: only chat participants can read/write/update.
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Messages viewable by participants" ON public.messages;
DROP POLICY IF EXISTS "Participants can send messages" ON public.messages;
DROP POLICY IF EXISTS "Participants can mark messages as read" ON public.messages;
DROP POLICY IF EXISTS "messages_select" ON public.messages;
DROP POLICY IF EXISTS "messages_insert" ON public.messages;
DROP POLICY IF EXISTS "messages_update" ON public.messages;

CREATE POLICY "messages_select"
  ON public.messages FOR SELECT
  USING (public.is_chat_participant(chat_room_id));

CREATE POLICY "messages_insert"
  ON public.messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND public.is_chat_participant(chat_room_id)
  );

CREATE POLICY "messages_update"
  ON public.messages FOR UPDATE
  USING (public.is_chat_participant(chat_room_id))
  WITH CHECK (public.is_chat_participant(chat_room_id));

-- Profile sends: case owner and sending adjuster only.
ALTER TABLE public.profile_sends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Profile sends viewable by case owner and adjuster" ON public.profile_sends;
DROP POLICY IF EXISTS "Adjusters can send profiles" ON public.profile_sends;
DROP POLICY IF EXISTS "Customers can update profile send status" ON public.profile_sends;
DROP POLICY IF EXISTS "profile_sends_select_related" ON public.profile_sends;
DROP POLICY IF EXISTS "profile_sends_insert_adjuster" ON public.profile_sends;
DROP POLICY IF EXISTS "profile_sends_update_customer" ON public.profile_sends;

CREATE POLICY "profile_sends_select_related"
  ON public.profile_sends FOR SELECT
  USING (
    adjuster_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.cases c
      WHERE c.id = profile_sends.case_id AND c.customer_id = auth.uid()
    )
  );

CREATE POLICY "profile_sends_insert_adjuster"
  ON public.profile_sends FOR INSERT
  WITH CHECK (
    adjuster_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.user_type = 'adjuster'
    )
  );

CREATE POLICY "profile_sends_update_customer"
  ON public.profile_sends FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.cases c
      WHERE c.id = profile_sends.case_id AND c.customer_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.cases c
      WHERE c.id = profile_sends.case_id AND c.customer_id = auth.uid()
    )
  );
