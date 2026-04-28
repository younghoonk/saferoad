import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from './Card';
import { Colors } from '../constants';
import { Adjuster } from '../types';

interface AdjusterCardProps {
  adjuster: Adjuster;
  onPress?: () => void;
  compact?: boolean;
}

export function AdjusterCard({ adjuster, onPress, compact = false }: AdjusterCardProps) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.9}>
      <Card style={styles.card}>
        <View style={styles.row}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{adjuster.name[0]}</Text>
          </View>
          <View style={styles.info}>
            <View style={styles.nameRow}>
              <Text style={styles.name}>{adjuster.name}</Text>
              <View style={styles.ratingRow}>
                <Ionicons name="star" size={12} color="#F4C542" />
                <Text style={styles.rating}>{adjuster.rating}</Text>
              </View>
            </View>
            <Text style={styles.license}>{adjuster.licenseNumber}</Text>
            <View style={styles.tags}>
              {adjuster.specialties.map((s) => (
                <View key={s} style={styles.tag}>
                  <Text style={styles.tagText}>{s}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
        {!compact && (
          <>
            <Text style={styles.bio}>{adjuster.bio}</Text>
            <View style={styles.stats}>
              <View style={styles.stat}>
                <Text style={styles.statNum}>{adjuster.resolvedCases}</Text>
                <Text style={styles.statLabel}>해결 건수</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.stat}>
                <Text style={styles.statNum}>{adjuster.reviewCount}</Text>
                <Text style={styles.statLabel}>리뷰</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.stat}>
                <Text style={styles.statNum}>{adjuster.fee}</Text>
                <Text style={styles.statLabel}>수수료</Text>
              </View>
            </View>
          </>
        )}
      </Card>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: { color: Colors.white, fontSize: 18, fontWeight: '700' },
  info: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  rating: { fontSize: 13, fontWeight: '600', color: Colors.textPrimary },
  license: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 },
  tag: {
    backgroundColor: Colors.inputBg,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tagText: { fontSize: 11, color: Colors.primary, fontWeight: '500' },
  bio: { fontSize: 13, color: Colors.textSecondary, marginTop: 12, lineHeight: 18 },
  stats: {
    flexDirection: 'row',
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  stat: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 14, fontWeight: '700', color: Colors.primary },
  statLabel: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  divider: { width: 1, backgroundColor: Colors.border },
});
