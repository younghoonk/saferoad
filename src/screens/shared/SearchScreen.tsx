import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AdjusterCard } from '../../components/AdjusterCard';
import { Colors } from '../../constants';
import { supabase } from '../../lib/supabase';
import { Adjuster } from '../../types';

const CATEGORIES = ['전체', '교통사고', '화재사고', '상해사고', '재산피해', '의료사고', '산업재해'];

interface SearchScreenProps {
  onChat: (adjusterId: string, adjusterName: string) => void;
}

interface AdjusterRow {
  id: string;
  license_number: string;
  specialties: string[];
  rating: number;
  review_count: number;
  resolved_cases: number;
  bio: string;
  fee: string;
  profiles: {
    id: string;
    name: string;
    email: string;
    phone: string;
  };
}

function mapToAdjuster(row: AdjusterRow): Adjuster {
  return {
    id: row.id,
    email: row.profiles?.email ?? '',
    name: row.profiles?.name ?? '사정사',
    userType: 'adjuster',
    phone: row.profiles?.phone ?? '',
    licenseNumber: row.license_number,
    specialties: row.specialties ?? [],
    rating: row.rating ?? 5.0,
    reviewCount: row.review_count ?? 0,
    resolvedCases: row.resolved_cases ?? 0,
    bio: row.bio ?? '',
    fee: row.fee ?? '',
    createdAt: '',
  };
}

export function SearchScreen({ onChat }: SearchScreenProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('전체');
  const [adjusters, setAdjusters] = useState<Adjuster[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAdjusters = useCallback(async () => {
    const { data, error } = await supabase
      .from('adjuster_profiles')
      .select(`
        id, license_number, specialties, rating, review_count, resolved_cases, bio, fee,
        profiles!inner(id, name, email, phone)
      `)
      .order('rating', { ascending: false });

    if (!error && data) {
      setAdjusters((data as AdjusterRow[]).map(mapToAdjuster));
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchAdjusters().finally(() => setLoading(false));
  }, [fetchAdjusters]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchAdjusters();
    setRefreshing(false);
  };

  const filtered = adjusters.filter((a) => {
    const matchQuery =
      !query || a.name.includes(query) || a.specialties.some((s) => s.includes(query));
    const matchCategory = category === '전체' || a.specialties.includes(category);
    return matchQuery && matchCategory;
  });

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.searchHeader}>
        <Text style={styles.title}>사정사 검색</Text>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={18} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="이름, 전문 분야 검색"
            placeholderTextColor={Colors.textMuted}
            value={query}
            onChangeText={setQuery}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')}>
              <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.categoryScroll}
        contentContainerStyle={styles.categoryContent}
      >
        {CATEGORIES.map((cat) => (
          <TouchableOpacity
            key={cat}
            style={[styles.categoryChip, category === cat && styles.categoryChipSelected]}
            onPress={() => setCategory(cat)}
          >
            <Text style={[styles.categoryText, category === cat && styles.categoryTextSelected]}>
              {cat}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>사정사 목록 불러오는 중...</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.primary} />
          }
        >
          <Text style={styles.resultCount}>총 {filtered.length}명의 전문가</Text>
          {filtered.length === 0 && !loading && (
            <View style={styles.emptyWrap}>
              <Ionicons name="people-outline" size={48} color={Colors.textMuted} />
              <Text style={styles.emptyText}>
                {adjusters.length === 0
                  ? '등록된 손해사정사가 없습니다'
                  : '검색 결과가 없습니다'}
              </Text>
            </View>
          )}
          {filtered.map((adjuster) => (
            <AdjusterCard
              key={adjuster.id}
              adjuster={adjuster}
              onPress={() => onChat(adjuster.id, adjuster.name)}
            />
          ))}
          <View style={{ height: 32 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  searchHeader: {
    padding: 16,
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  title: { fontSize: 20, fontWeight: '800', color: Colors.textPrimary, marginBottom: 12 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.inputBg,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchInput: { flex: 1, fontSize: 14, color: Colors.textPrimary },
  categoryScroll: {
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  categoryContent: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  categoryChipSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  categoryText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' },
  categoryTextSelected: { color: Colors.white, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: Colors.textSecondary },
  list: { flex: 1, padding: 16 },
  resultCount: { fontSize: 13, color: Colors.textSecondary, marginBottom: 12 },
  emptyWrap: { alignItems: 'center', paddingVertical: 48, gap: 12 },
  emptyText: { fontSize: 15, color: Colors.textSecondary },
});
