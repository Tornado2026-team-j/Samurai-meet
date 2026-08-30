import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Header, colors, radius } from "../../components/ui";
import type { MatchCategory } from "../../types/match";

const CATEGORIES: Array<{ value: MatchCategory | ""; label: string }> = [
  { value: "", label: "すべて" },
  { value: "Food", label: "Food" },
  { value: "Heritage", label: "Heritage" },
  { value: "Activity", label: "Activity" },
  { value: "Other", label: "Other" },
];
const TIMES = [
  { value: "", label: "指定なし", start: "", end: "" },
  { value: "morning", label: "朝 6–12時", start: "06:00", end: "12:00" },
  { value: "afternoon", label: "昼 12–18時", start: "12:00", end: "18:00" },
  { value: "evening", label: "夜 18–24時", start: "18:00", end: "23:59" },
] as const;

export default function JapaneseFiltersScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ category?: string; time?: string; radius?: string; verified?: string; query?: string; date?: string; sort?: string }>();
  const [category, setCategory] = useState<MatchCategory | "">(CATEGORIES.some((item) => item.value === params.category) ? params.category as MatchCategory : "");
  const [time, setTime] = useState(TIMES.some((item) => item.value === params.time) ? params.time ?? "" : "");
  const [radius, setRadius] = useState(params.radius === "1" || params.radius === "5" ? params.radius : "3");
  const [verified, setVerified] = useState(params.verified === "1");

  const apply = () => router.replace({
    pathname: "/japanese",
    params: {
      ...(params.query ? { query: params.query } : {}),
      ...(params.date ? { date: params.date } : {}),
      ...(params.sort ? { sort: params.sort } : {}),
      ...(category ? { category } : {}),
      ...(time ? { time } : {}),
      radius,
      verified: verified ? "1" : "0",
    },
  });

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <Header iconName="tune" onBack={() => router.back()} title="検索条件" variant="hero" />
      <ScrollView contentContainerStyle={styles.content}>
        <FilterGroup label="カテゴリ">
          <View style={styles.choices}>{CATEGORIES.map((item) => <Choice key={item.label} label={item.label} onPress={() => setCategory(item.value)} selected={category === item.value} />)}</View>
        </FilterGroup>
        <FilterGroup label="時間帯">
          <View style={styles.choices}>{TIMES.map((item) => <Choice key={item.value} label={item.label} onPress={() => setTime(item.value)} selected={time === item.value} />)}</View>
        </FilterGroup>
        <FilterGroup label="検索地点からの距離">
          <View style={styles.choices}>{["1", "3", "5"].map((value) => <Choice key={value} label={`${value}km以内`} onPress={() => setRadius(value)} selected={radius === value} />)}</View>
        </FilterGroup>
        <View style={styles.switchRow}>
          <View><Text style={styles.groupLabel}>本人確認済みのみ</Text><Text style={styles.hint}>確認済みバッジのある募集者に絞ります</Text></View>
          <Switch onValueChange={setVerified} trackColor={{ false: colors.border.default, true: colors.brand.sky }} value={verified} />
        </View>
        <Pressable onPress={apply} style={styles.apply}><MaterialIcons color={colors.text.inverse} name="search" size={21} /><Text style={styles.applyText}>この条件で検索</Text></Pressable>
      </ScrollView>
    </View>
  );
}

function FilterGroup({ children, label }: { children: React.ReactNode; label: string }) {
  return <View style={styles.group}><Text style={styles.groupLabel}>{label}</Text>{children}</View>;
}
function Choice({ label, onPress, selected }: { label: string; onPress: () => void; selected: boolean }) {
  return <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress} style={[styles.choice, selected && styles.choiceSelected]}><Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface.screen },
  content: { padding: 22, paddingBottom: 48, gap: 24 },
  group: { gap: 10 },
  groupLabel: { color: colors.text.primary, fontSize: 15, fontWeight: "900" },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: { minHeight: 42, justifyContent: "center", paddingHorizontal: 15, borderWidth: 1, borderColor: colors.border.default, borderRadius: radius.pill, backgroundColor: colors.surface.default },
  choiceSelected: { borderColor: colors.brand.sky, backgroundColor: colors.surface.blueSoft },
  choiceText: { color: colors.text.secondary, fontSize: 13, fontWeight: "700" },
  choiceTextSelected: { color: colors.brand.sky, fontWeight: "900" },
  switchRow: { minHeight: 64, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14 },
  hint: { marginTop: 4, color: colors.text.muted, fontSize: 11 },
  apply: { minHeight: 50, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: radius.md, backgroundColor: colors.brand.sky },
  applyText: { color: colors.text.inverse, fontSize: 15, fontWeight: "900" },
});
