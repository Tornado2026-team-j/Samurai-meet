import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useEffect, useMemo, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Header, LoadingSpinner, colors, radius, shadows } from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import { blockUser } from "../../services/chat";
import { getMatch, type MatchParticipant } from "../../services/matching";

function profileDetails(bio: string): { interests: string[]; skills: string[]; note: string } {
  try {
    const value = JSON.parse(bio) as { monsterSeed?: { interestTags?: unknown; skillTags?: unknown; freeText?: unknown } };
    const seed = value.monsterSeed;
    return {
      interests: Array.isArray(seed?.interestTags) ? seed.interestTags.filter((item): item is string => typeof item === "string") : [],
      skills: Array.isArray(seed?.skillTags) ? seed.skillTags.filter((item): item is string => typeof item === "string") : [],
      note: typeof seed?.freeText === "string" ? seed.freeText : "",
    };
  } catch {
    return { interests: [], skills: [], note: bio.trim() };
  }
}

export default function UserProfileScreen() {
  const router = useRouter();
  const { id, matchId } = useLocalSearchParams<{ id?: string; matchId?: string }>();
  const { getCurrentSession, session } = useAuth();
  const [profile, setProfile] = useState<MatchParticipant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blocking, setBlocking] = useState(false);

  useEffect(() => {
    const activeSession = getCurrentSession() ?? session;
    if (!activeSession || !matchId) {
      setLoading(false);
      setError("プロフィールを表示するための情報がありません。");
      return;
    }
    let active = true;
    void getMatch(matchId, activeSession).then((result) => {
      if (!active) return;
      if (id && result.other_user.id !== id) throw new Error("profile mismatch");
      setProfile(result.other_user);
    }).catch(() => {
      if (active) setError("プロフィールを読み込めませんでした。");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [getCurrentSession, id, matchId, session]);

  const details = useMemo(() => profileDetails(profile?.bio ?? ""), [profile?.bio]);

  const block = async () => {
    const activeSession = getCurrentSession() ?? session;
    if (!activeSession || !profile || blocking) return;
    setBlocking(true);
    setError(null);
    try {
      await blockUser(profile.id, activeSession);
      router.replace("/blocked-users");
    } catch {
      setError("ブロックできませんでした。");
    } finally {
      setBlocking(false);
    }
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <Header iconName="person-outline" onBack={() => router.back()} title="プロフィール" variant="hero" />
      <ScrollView contentContainerStyle={styles.content}>
        {loading ? <LoadingSpinner color={colors.brand.sky} size={24} speedMs={680} /> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {profile ? (
          <>
            <View style={styles.hero}>
              <MaterialIcons color={colors.brand.sky} name="account-circle" size={84} />
              <View style={styles.identity}>
                <View style={styles.nameRow}>
                  <Text style={styles.name}>{profile.name}</Text>
                  {profile.identity_status === "verified" ? <MaterialIcons color={colors.brand.sky} name="verified" size={23} /> : null}
                </View>
                <Text style={styles.country}>{profile.nationality_code}</Text>
                <Text style={styles.rating}>♡ {profile.likes_count}</Text>
              </View>
            </View>
            <InfoSection empty="未登録" items={details.interests} title="好きなこと" />
            <InfoSection empty="未登録" items={details.skills} title="得意なこと" />
            {details.note ? <InfoSection empty="" items={[details.note]} title="ひとこと" /> : null}
            <View style={styles.safetyActions}>
              <Pressable onPress={() => router.push({ pathname: "/report", params: { targetType: "user", targetId: profile.id, name: profile.name } })} style={styles.safetyButton}>
                <MaterialIcons color={colors.state.danger} name="outlined-flag" size={20} />
                <Text style={styles.reportText}>通報</Text>
              </Pressable>
              <Pressable disabled={blocking} onPress={() => void block()} style={styles.safetyButton}>
                <MaterialIcons color={colors.state.danger} name="block" size={20} />
                <Text style={styles.reportText}>{blocking ? "処理中" : "ブロック"}</Text>
              </Pressable>
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function InfoSection({ empty, items, title }: { empty: string; items: string[]; title: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.tags}>
        {items.length > 0 ? items.map((item) => <View key={item} style={styles.tag}><Text style={styles.tagText}>{item}</Text></View>) : <Text style={styles.empty}>{empty}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface.screen },
  content: { padding: 22, paddingBottom: 48, gap: 14 },
  hero: { flexDirection: "row", alignItems: "center", gap: 16, padding: 18, borderRadius: radius.lg, backgroundColor: colors.surface.blueSoft },
  identity: { flex: 1 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  name: { flexShrink: 1, color: colors.text.primary, fontSize: 22, fontWeight: "900" },
  country: { marginTop: 4, color: colors.text.subtle, fontSize: 13, fontWeight: "700" },
  rating: { marginTop: 5, color: colors.brand.gold, fontSize: 14, fontWeight: "800" },
  section: { padding: 16, borderWidth: 1, borderColor: colors.border.subtle, borderRadius: radius.lg, backgroundColor: colors.surface.default, ...shadows.card },
  sectionTitle: { marginBottom: 10, color: colors.text.secondary, fontSize: 14, fontWeight: "900" },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  tag: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.surface.goldSoft },
  tagText: { color: colors.text.secondary, fontSize: 13, fontWeight: "700" },
  empty: { color: colors.text.muted, fontSize: 13 },
  safetyActions: { flexDirection: "row", gap: 10, marginTop: 8 },
  safetyButton: { flex: 1, minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: colors.border.danger, borderRadius: radius.md },
  reportText: { color: colors.state.danger, fontSize: 13, fontWeight: "800" },
  error: { color: colors.state.danger, fontSize: 13, fontWeight: "700", textAlign: "center" },
});
