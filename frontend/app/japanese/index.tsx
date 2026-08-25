import { useMemo, useState } from "react";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import MatchCard from "../../components/MatchCard";
import { MOCK_MATCHES } from "../../mocks/matches";
import type { MatchCardData } from "../../types/match";

const BLUE = "#5ec5f5";
const YELLOW = "#e7b454";
const TEXT_GRAY = "#535353";
const PLACEHOLDER_GRAY = "#949494";
const BORDER_GRAY = "#d4d4d4";

const CATEGORIES = [
  "すべて",
  "Food",
  "Places",
  "Activity",
  "Other",
] as const;

export default function JapaneseHomeScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<(typeof CATEGORIES)[number]>(
    "すべて",
  );
  const filteredMatches = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();

    return MOCK_MATCHES.filter((match) => {
      const matchesCategory =
        selectedCategory === "すべて" ||
        match.category === selectedCategory;
      const matchesQuery =
        normalizedQuery.length === 0 ||
        match.authorName.toLocaleLowerCase().includes(normalizedQuery) ||
        match.tags.some((tag) => tag.toLocaleLowerCase().includes(normalizedQuery));

      return matchesCategory && matchesQuery;
    });
  }, [query, selectedCategory]);
  const openMatch = (match: MatchCardData) => {
    router.push({
      pathname: "/japanese/matches/[id]",
      params: { id: match.id },
    });
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      <ScrollView
        contentContainerStyle={styles.matchListContent}
        showsVerticalScrollIndicator={false}
        style={styles.matchList}
      >
        {filteredMatches.map((match) => (
          <MatchCard key={match.id} match={match} onOpen={openMatch} />
        ))}

        {filteredMatches.length === 0 && (
          <Text style={styles.emptyText}>該当する募集がありません</Text>
        )}
      </ScrollView>

      <View style={styles.header}>
        <View style={styles.actionRow}>
          <View style={styles.searchField}>
            <MaterialIcons
              color={PLACEHOLDER_GRAY}
              name="search"
              size={22}
              style={styles.searchIcon}
            />
            <TextInput
              accessibilityLabel="キーワードで検索"
              onChangeText={setQuery}
              placeholder="キーワードで検索"
              placeholderTextColor={PLACEHOLDER_GRAY}
              returnKeyType="search"
              style={styles.searchInput}
              value={query}
            />
          </View>

          <Pressable
            accessibilityLabel="通知"
            accessibilityRole="button"
            hitSlop={8}
            style={({ pressed }) => [
              styles.headerIconButton,
              styles.notificationButton,
              pressed && styles.pressed,
            ]}
          >
            <MaterialIcons color="#ffffff" name="notifications-none" size={30} />
          </Pressable>

          <Pressable
            accessibilityLabel="プロフィール"
            accessibilityRole="button"
            hitSlop={8}
            style={({ pressed }) => [
              styles.headerIconButton,
              styles.profileButton,
              pressed && styles.pressed,
            ]}
          >
            <MaterialIcons color="#ffffff" name="account-circle" size={30} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.categoryContent}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.categoryList}
        >
          {CATEGORIES.map((category) => {
            const selected = selectedCategory === category;

            return (
              <Pressable
                key={category}
                accessibilityLabel={`${category}カテゴリ`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setSelectedCategory(category)}
                style={({ pressed }) => [
                  styles.categoryButton,
                  selected && styles.categoryButtonSelected,
                  pressed && styles.pressed,
                ]}
              />
            );
          })}
        </ScrollView>

        <Pressable
          accessibilityLabel="現在地から近い順"
          accessibilityRole="button"
          style={({ pressed }) => [styles.sortRow, pressed && styles.pressed]}
        >
          <MaterialIcons color={TEXT_GRAY} name="swap-vert" size={20} />
          <Text style={styles.sortText}>現在地から近い順</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  matchList: {
    flex: 1,
  },
  matchListContent: {
    minHeight: "100%",
    paddingTop: 221,
    paddingBottom: 32,
    alignItems: "center",
    gap: 28,
  },
  header: {
    position: "absolute",
    top: 0,
    right: 0,
    left: 0,
    height: 193,
    overflow: "hidden",
    borderBottomLeftRadius: 50,
    borderBottomRightRadius: 50,
    backgroundColor: BLUE,
  },
  actionRow: {
    position: "absolute",
    top: 45,
    right: 19,
    left: 19,
    height: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: 19,
  },
  searchField: {
    flex: 1,
    height: 30,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 20,
    backgroundColor: "#ffffff",
  },
  searchIcon: {
    position: "absolute",
    left: 14,
  },
  searchInput: {
    width: "100%",
    height: 30,
    paddingTop: 0,
    paddingRight: 12,
    paddingBottom: 0,
    paddingLeft: 45,
    color: TEXT_GRAY,
    fontSize: 12,
    fontWeight: "400",
    letterSpacing: 0,
  },
  headerIconButton: {
    height: 25,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  notificationButton: {
    width: 21,
  },
  profileButton: {
    width: 24.56,
  },
  categoryList: {
    position: "absolute",
    top: 90,
    right: 0,
    left: 0,
    height: 45,
  },
  categoryContent: {
    paddingLeft: 10,
    paddingRight: 10,
    gap: 13,
  },
  categoryButton: {
    width: 45,
    height: 45,
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 10,
    backgroundColor: "#ffffff",
  },
  categoryButtonSelected: {
    borderColor: YELLOW,
    backgroundColor: YELLOW,
  },
  sortRow: {
    position: "absolute",
    top: 146,
    left: 17,
    height: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  sortText: {
    color: TEXT_GRAY,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0,
    lineHeight: 15,
  },
  emptyText: {
    marginTop: 40,
    color: PLACEHOLDER_GRAY,
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0,
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.72,
  },
});
