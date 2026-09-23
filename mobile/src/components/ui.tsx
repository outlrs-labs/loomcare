import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export const colors = { green: '#164B42', lime: '#E3EECB', ink: '#213D37', muted: '#6E7B74', bg: '#F5F6F2', line: '#E2E7DF', red: '#AB413E', amber: '#946222', white: '#FFFFFF' };

export function Screen({ children, refreshing, onRefresh }: { children: ReactNode; refreshing?: boolean; onRefresh?: () => void }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.screen} refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export const Title = ({ children, sub }: { children: ReactNode; sub?: string }) => (
  <View style={styles.titleBlock}>
    <Text style={styles.title} accessibilityRole="header">{children}</Text>
    {sub ? <Text style={styles.muted}>{sub}</Text> : null}
  </View>
);

export const Card = ({ children, tone }: { children: ReactNode; tone?: 'alert' | 'dark' }) => <View style={[styles.card, tone === 'alert' && styles.alertCard, tone === 'dark' && styles.darkCard]}>{children}</View>;
export const Muted = ({ children }: { children: ReactNode }) => <Text style={styles.muted}>{children}</Text>;
export const Strong = ({ children, light }: { children: ReactNode; light?: boolean }) => <Text style={[styles.strong, light && { color: colors.white }]}>{children}</Text>;
export const Row = ({ children }: { children: ReactNode }) => <View style={styles.row}>{children}</View>;

export function Pill({ label, tone = 'ok' }: { label: string; tone?: 'ok' | 'warn' | 'alert' | 'quiet' }) {
  const palette = { ok: ['#EFF3E8', '#4F7A3A'], warn: ['#FBF1DF', colors.amber], alert: ['#F9EAE7', colors.red], quiet: ['#F0F1ED', '#7E877D'] }[tone];
  return <Text style={[styles.pill, { backgroundColor: palette[0], color: palette[1] }]}>{label}</Text>;
}

export function Button({ label, onPress, kind = 'primary', busy, disabled }: { label: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger' | 'light'; busy?: boolean; disabled?: boolean }) {
  const style = { primary: styles.primary, secondary: styles.secondary, danger: styles.danger, light: styles.light }[kind];
  const textColor = kind === 'secondary' || kind === 'light' ? colors.green : colors.white;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: disabled || busy }} disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [styles.button, style, (pressed || disabled) && { opacity: 0.7 }]}>
      {busy ? <ActivityIndicator color={textColor} /> : <Text style={[styles.buttonText, { color: textColor }]}>{label}</Text>}
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor="#A4AA9F" style={styles.input} accessibilityLabel={label} {...props} />
    </View>
  );
}

export function Choice<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void }) {
  return (
    <View style={styles.choice}>
      {options.map((option) => (
        <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ selected: option.value === value }} onPress={() => onChange(option.value)} style={[styles.choiceItem, option.value === value && styles.choiceActive]}>
          <Text style={[styles.choiceText, option.value === value && { color: colors.white }]}>{option.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export const Notice = ({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' | 'alert' }) => (
  <View style={[styles.notice, tone === 'warn' && styles.noticeWarn, tone === 'alert' && styles.noticeAlert]}>
    <Text style={[styles.noticeText, tone === 'alert' && { color: colors.red }, tone === 'warn' && { color: colors.amber }]}>{children}</Text>
  </View>
);

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  screen: { padding: 20, paddingBottom: 48, gap: 14 },
  titleBlock: { gap: 6, marginBottom: 4 },
  title: { fontSize: 28, fontWeight: '700', color: colors.ink, letterSpacing: -0.8 },
  muted: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  strong: { fontSize: 17, fontWeight: '600', color: colors.ink },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  card: { backgroundColor: colors.white, borderRadius: 18, borderWidth: 1, borderColor: colors.line, padding: 18, gap: 10 },
  alertCard: { borderColor: '#EED3CB', backgroundColor: '#FDF4F2' },
  darkCard: { backgroundColor: colors.green, borderColor: colors.green },
  pill: { fontSize: 12, fontWeight: '600', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, overflow: 'hidden' },
  button: { minHeight: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  primary: { backgroundColor: colors.green },
  secondary: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line },
  danger: { backgroundColor: colors.red },
  light: { backgroundColor: colors.lime },
  buttonText: { fontSize: 16, fontWeight: '600' },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '600', color: colors.ink },
  input: { minHeight: 50, borderWidth: 1, borderColor: '#DCE2D6', borderRadius: 12, paddingHorizontal: 14, fontSize: 16, color: colors.ink, backgroundColor: colors.white },
  choice: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choiceItem: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  choiceActive: { backgroundColor: colors.green, borderColor: colors.green },
  choiceText: { fontSize: 14, fontWeight: '600', color: colors.ink },
  notice: { borderRadius: 12, padding: 14, backgroundColor: '#F2F4E9', borderWidth: 1, borderColor: '#E5E8D8' },
  noticeWarn: { backgroundColor: '#FCF4E6', borderColor: '#F0DFC4' },
  noticeAlert: { backgroundColor: '#F9E9E5', borderColor: '#EED3CB' },
  noticeText: { fontSize: 14, lineHeight: 20, color: '#5E6B4E' },
});
