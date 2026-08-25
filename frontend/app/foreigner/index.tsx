import { useRef, useState } from "react";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";

export default function ForeignerHomeScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<TextInput>(null);

  const openSearchPreferences = () => {
    searchInputRef.current?.blur();
    router.push({
      pathname: "/tabs",
      params: { query },
    });
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <View style={styles.actionRow}>
          <View style={styles.searchField}>
            <MaterialIcons
              color="#949494"
              name="search"
              size={22}
              style={styles.searchIcon}
            />
            <TextInput
              ref={searchInputRef}
              accessibilityLabel="Search"
              onChangeText={setQuery}
              onFocus={openSearchPreferences}
              placeholder="What would you like to do?"
              placeholderTextColor="#949494"
              returnKeyType="search"
              showSoftInputOnFocus={false}
              style={styles.searchInput}
              value={query}
            />
          </View>

          <Pressable
            accessibilityLabel="Notifications"
            accessibilityRole="button"
            hitSlop={8}
            style={styles.notificationButton}
          >
            <MaterialIcons
              color="#ffffff"
              name="notifications-none"
              size={30}
            />
          </Pressable>

          <Pressable
            accessibilityLabel="Profile"
            accessibilityRole="button"
            hitSlop={8}
            style={styles.profileButton}
          >
            <MaterialIcons color="#ffffff" name="account-circle" size={30} />
          </Pressable>
        </View>

        <Text style={styles.title}>Find Your Japan!</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  header: {
    position: "relative",
    width: "100%",
    height: 156,
    backgroundColor: "#5ec5f5",
    borderBottomLeftRadius: 50,
    borderBottomRightRadius: 50,
  },
  actionRow: {
    position: "absolute",
    top: 45,
    left: 19,
    right: 19,
    height: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: 19,
  },
  searchField: {
    flex: 1,
    height: 30,
    justifyContent: "center",
    borderRadius: 20,
    backgroundColor: "#ffffff",
  },
  searchIcon: {
    position: "absolute",
    left: 14.2,
  },
  searchInput: {
    width: "100%",
    height: 30,
    paddingTop: 0,
    paddingRight: 12,
    paddingBottom: 0,
    paddingLeft: 45.34,
    color: "#1f1f1f",
    fontSize: 12,
    fontWeight: "400",
    letterSpacing: 0,
  },
  notificationButton: {
    width: 21,
    height: 25,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  profileButton: {
    width: 24.56,
    height: 25,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  title: {
    position: "absolute",
    top: 108,
    left: 0,
    right: 0,
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 19,
    textAlign: "center",
  },
});
