import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { UserType } from '../types';

interface Profile {
  id: string;
  name: string;
  email: string;
  phone: string;
  user_type: UserType;
  profile_image?: string | null;
}

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signUp: (params: SignUpParams) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

export interface SignUpParams {
  name: string;
  email: string;
  password: string;
  phone: string;
  userType: UserType;
  licenseNumber?: string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  // 앱 시작 시 세션 복원
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchProfile(session.user.id);
      else setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) fetchProfile(session.user.id);
      else { setProfile(null); setLoading(false); }
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (!error && data) setProfile(data as Profile);
    setLoading(false);
  };

  const signUp = async (params: SignUpParams): Promise<{ error: string | null }> => {
    const { name, email, password, phone, userType, licenseNumber } = params;

    const { data, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name,
          phone,
          user_type:      userType,
          license_number: licenseNumber ?? '',
        },
      },
    });

    if (authError) return { error: authError.message };
    if (!data.user) return { error: '회원가입 중 오류가 발생했습니다.' };

    // 이메일 확인이 비활성화된 경우 session이 즉시 반환됨
    // → 직접 profiles 삽입 (트리거 미설치 환경에서도 동작)
    // 이메일 확인이 활성화된 경우 → Supabase 트리거(handle_new_user)가 처리
    if (data.session) {
      const { error: profileErr } = await supabase.from('profiles').upsert(
        { id: data.user.id, name, phone, user_type: userType },
        { onConflict: 'id' }
      );
      if (profileErr) {
        console.error('profiles upsert error:', profileErr.message);
        return { error: '프로필 저장 실패: ' + profileErr.message };
      }

      if (userType === 'adjuster') {
        const { error: adjErr } = await supabase.from('adjuster_profiles').upsert(
          { id: data.user.id, license_number: licenseNumber ?? '', specialties: [] },
          { onConflict: 'id' }
        );
        if (adjErr) {
          console.error('adjuster_profiles upsert error:', adjErr.message);
        }
      }
    }

    return { error: null };
  };

  const signIn = async (email: string, password: string): Promise<{ error: string | null }> => {
    const { data: authData, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.message.includes('Invalid login credentials'))
        return { error: '이메일 또는 비밀번호가 올바르지 않습니다.' };
      if (error.message.includes('Email not confirmed'))
        return { error: '이메일 인증이 필요합니다. 메일함을 확인해주세요.' };
      return { error: error.message };
    }
    // 로그인 직후 프로필 즉시 로드 → AppNavigator가 바로 메인으로 전환
    if (authData?.user) {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authData.user.id)
        .single();
      if (!profileData) {
        await supabase.auth.signOut();
        return { error: '계정 프로필을 찾을 수 없습니다. 다시 회원가입해주세요.' };
      }
      setProfile(profileData as Profile);
    }
    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setSession(null);
  };

  const refreshProfile = async () => {
    if (session?.user.id) await fetchProfile(session.user.id);
  };

  return (
    <AuthContext.Provider value={{ session, profile, loading, signUp, signIn, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
