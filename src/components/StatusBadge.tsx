import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../constants';

type Status = 'pending' | 'reviewing' | 'in_progress' | 'resolved';

const STATUS_MAP: Record<Status, { label: string; color: string; bg: string }> = {
  pending: { label: '대기중', color: Colors.warning, bg: '#FEF9EC' },
  reviewing: { label: '검토중', color: Colors.accent, bg: '#EBF4FF' },
  in_progress: { label: '진행중', color: Colors.primaryLight, bg: '#EEF1FB' },
  resolved: { label: '완료', color: Colors.success, bg: '#E9F7EF' },
};

interface StatusBadgeProps {
  status: Status;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const { label, color, bg } = STATUS_MAP[status];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.text, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
  },
});
