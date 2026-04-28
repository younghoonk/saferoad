import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants';
import { UserType } from '../types';
import { useAuth } from '../contexts/AuthContext';

import { OnboardingScreen } from '../screens/onboarding/OnboardingScreen';
import { SignUpScreen } from '../screens/onboarding/SignUpScreen';
import { LoginScreen } from '../screens/onboarding/LoginScreen';

import { HomeScreen } from '../screens/customer/HomeScreen';
import { RegisterCaseScreen } from '../screens/customer/RegisterCaseScreen';
import { DirectHireScreen } from '../screens/customer/DirectHireScreen';
import { QuoteCompareScreen } from '../screens/customer/QuoteCompareScreen';
import { ReceivedProfilesScreen } from '../screens/customer/ReceivedProfilesScreen';

import { AdjusterHomeScreen } from '../screens/adjuster/AdjusterHomeScreen';
import { AdjusterProfileEditScreen } from '../screens/adjuster/AdjusterProfileEditScreen';

import { AIAnalysisScreen } from '../screens/shared/AIAnalysisScreen';
import { ChatListScreen } from '../screens/shared/ChatListScreen';
import { ChatScreen } from '../screens/shared/ChatScreen';
import { MyCasesScreen } from '../screens/shared/MyCasesScreen';
import { SearchScreen } from '../screens/shared/SearchScreen';
import { ProfileScreen } from '../screens/shared/ProfileScreen';

type Tab = 'home' | 'search' | 'cases' | 'chat' | 'ai' | 'profile';
type Screen =
  | 'onboarding'
  | 'signup'
  | 'login'
  | 'main'
  | 'register-case'
  | 'direct-hire'
  | 'quote-compare'
  | 'chat-detail'
  | 'received-profiles'
  | 'adjuster-profile-edit'
  | 'ai-analysis';

interface NavItem {
  id: Tab;
  icon: string;
  label: string;
}

const CUSTOMER_NAV_ITEMS: NavItem[] = [
  { id: 'home', icon: 'home', label: '홈' },
  { id: 'search', icon: 'search', label: '검색' },
  { id: 'cases', icon: 'folder', label: '사건' },
  { id: 'chat', icon: 'chatbubbles', label: '채팅' },
  { id: 'profile', icon: 'person', label: '마이' },
];

const ADJUSTER_NAV_ITEMS: NavItem[] = [
  { id: 'home', icon: 'home', label: '홈' },
  { id: 'search', icon: 'search', label: '검색' },
  { id: 'cases', icon: 'folder', label: '사건' },
  { id: 'chat', icon: 'chatbubbles', label: '채팅' },
  { id: 'ai', icon: 'sparkles', label: 'AI' },
  { id: 'profile', icon: 'person', label: '마이' },
];

function SplashScreen() {
  return (
    <View style={splash.container}>
      <Ionicons name="shield-checkmark" size={64} color={Colors.primary} />
      <Text style={splash.title}>SAFE ROAD</Text>
      <ActivityIndicator color={Colors.primary} style={{ marginTop: 32 }} />
    </View>
  );
}

const splash = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.white },
  title: { fontSize: 28, fontWeight: '900', color: Colors.primary, letterSpacing: 3, marginTop: 12 },
});

export function AppNavigator() {
  const { session, profile, loading, signOut } = useAuth();

  const [screen, setScreen] = useState<Screen>('onboarding');
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [signUpUserType, setSignUpUserType] = useState<UserType>('customer');
  const [chatRoomId, setChatRoomId] = useState('');
  const [chatPartnerName, setChatPartnerName] = useState('사정사');
  const [chatPartnerAvatar, setChatPartnerAvatar] = useState<string | null>(null);
  const [quoteCaseId, setQuoteCaseId] = useState<string | undefined>(undefined);
  const [profileCaseId, setProfileCaseId] = useState<string | undefined>(undefined);

  if (loading) return <SplashScreen />;

  const isLoggedIn = !!session && !!profile;
  const goBack = () => setScreen('main');

  const goToChat = (roomId: string, name?: string, avatar?: string | null) => {
    setChatRoomId(roomId);
    setChatPartnerName(name ?? '사정사');
    setChatPartnerAvatar(avatar ?? null);
    setScreen('chat-detail');
  };

  const goToQuotes = (caseId?: string) => {
    setQuoteCaseId(caseId);
    setScreen('quote-compare');
  };

  const goToReceivedProfiles = (caseId?: string) => {
    setProfileCaseId(caseId);
    setScreen('received-profiles');
  };

  if (!isLoggedIn) {
    if (screen === 'signup') {
      return (
        <SignUpScreen
          userType={signUpUserType}
          onBack={() => setScreen('onboarding')}
          onSuccess={() => setScreen('login')}
          onLogin={() => setScreen('login')}
        />
      );
    }

    if (screen === 'login') {
      return (
        <LoginScreen
          onBack={() => setScreen('onboarding')}
          onSuccess={() => {}}
          onSignUp={() => setScreen('onboarding')}
        />
      );
    }

    return (
      <OnboardingScreen
        onSelect={(type) => {
          setSignUpUserType(type);
          setScreen('signup');
        }}
        onLogin={() => setScreen('login')}
      />
    );
  }

  if (screen === 'register-case') {
    return (
      <RegisterCaseScreen
        onBack={goBack}
        onSubmit={() => {
          setScreen('main');
          setActiveTab('cases');
        }}
      />
    );
  }

  if (screen === 'direct-hire') {
    return (
      <DirectHireScreen
        onBack={goBack}
        onSubmit={() => {
          setScreen('main');
          setActiveTab('cases');
        }}
      />
    );
  }

  if (screen === 'quote-compare') {
    return <QuoteCompareScreen onBack={goBack} onChat={goToChat} caseId={quoteCaseId} />;
  }

  if (screen === 'ai-analysis') {
    return <AIAnalysisScreen onBack={goBack} />;
  }

  if (screen === 'chat-detail') {
    return (
      <ChatScreen
        onBack={goBack}
        chatRoomId={chatRoomId}
        partnerName={chatPartnerName}
        partnerAvatar={chatPartnerAvatar}
      />
    );
  }

  if (screen === 'received-profiles') {
    return (
      <ReceivedProfilesScreen
        onBack={goBack}
        onChat={goToChat}
        caseId={profileCaseId}
      />
    );
  }

  if (screen === 'adjuster-profile-edit') {
    return <AdjusterProfileEditScreen onBack={goBack} onSaved={goBack} />;
  }

  const userType = profile.user_type;
  const isAdjuster = userType === 'adjuster';

  const renderTabContent = () => {
    switch (activeTab) {
      case 'home':
        return isAdjuster ? (
          <AdjusterHomeScreen
            onViewCase={() => {}}
            onChat={goToChat}
            onAIAnalysis={() => setActiveTab('ai')}
          />
        ) : (
          <HomeScreen
            onRegisterCase={() => setScreen('register-case')}
            onDirectHire={() => setScreen('direct-hire')}
            onViewQuotes={() => goToQuotes(undefined)}
            onChat={goToChat}
            onViewReceivedProfiles={() => goToReceivedProfiles(undefined)}
          />
        );

      case 'search':
        return <SearchScreen onChat={goToChat} />;

      case 'cases':
        return (
          <MyCasesScreen
            onViewQuotes={(caseId) => goToQuotes(caseId)}
            onViewReceivedProfiles={(caseId) => goToReceivedProfiles(caseId)}
          />
        );

      case 'chat':
        return (
          <ChatListScreen
            onSelectRoom={(roomId, name, avatar) => goToChat(roomId, name, avatar)}
          />
        );

      case 'ai':
        return isAdjuster ? <AIAnalysisScreen onBack={() => setActiveTab('home')} /> : null;

      case 'profile':
        return (
          <ProfileScreen
            onLogout={signOut}
            onEditAdjusterProfile={
              isAdjuster ? () => setScreen('adjuster-profile-edit') : undefined
            }
          />
        );

      default:
        return null;
    }
  };

  const navItems = isAdjuster ? ADJUSTER_NAV_ITEMS : CUSTOMER_NAV_ITEMS;

  return (
    <View style={styles.container}>
      <View style={styles.content}>{renderTabContent()}</View>

      <View style={styles.navBar}>
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          const isAI = item.id === 'ai';

          return (
            <TouchableOpacity
              key={item.id}
              style={styles.navItem}
              onPress={() => {
                setActiveTab(item.id);
                setScreen('main');
              }}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.navIconWrap,
                  isActive && (isAI ? styles.navIconWrapAI : styles.navIconWrapActive),
                ]}
              >
                <Ionicons
                  name={(isActive ? item.icon : `${item.icon}-outline`) as any}
                  size={20}
                  color={isActive ? (isAI ? '#6C3CE1' : Colors.primary) : Colors.textMuted}
                />
              </View>
              <Text
                style={[
                  styles.navLabel,
                  isActive && (isAI ? styles.navLabelAI : styles.navLabelActive),
                ]}
                numberOfLines={1}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { flex: 1 },
  navBar: {
    flexDirection: 'row',
    backgroundColor: Colors.navBg,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 6,
    paddingBottom: Platform.OS === 'ios' ? 22 : 8,
    paddingHorizontal: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 8,
  },
  navItem: { flex: 1, alignItems: 'center', gap: 2, minWidth: 0 },
  navIconWrap: {
    width: 34,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
  },
  navIconWrapActive: { backgroundColor: Colors.primary + '15' },
  navIconWrapAI: { backgroundColor: '#6C3CE115' },
  navLabel: { fontSize: 9, color: Colors.textMuted, fontWeight: '500' },
  navLabelActive: { color: Colors.primary, fontWeight: '700' },
  navLabelAI: { color: '#6C3CE1', fontWeight: '700' },
});
