import { useEffect, useMemo, useRef, useState } from "react";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { createRecruitmentPreview } from "../../services/recruitment";
import type {
  RecruitmentDistanceKm,
  RecruitmentDraft,
  RecruitmentPreview,
} from "../../types/recruitment";
import { formatTimeRange, shiftTime } from "../../utils/time";

const BLUE = "#5ec5f5";
const YELLOW = "#e7b454";
const TEXT_GRAY = "#535353";
const PLACEHOLDER_GRAY = "#949494";
const BORDER_GRAY = "#d4d4d4";
const COLLAPSED_HEADER_HEIGHT = 156;
const EXPANDED_HEADER_HEIGHT = 653;
const CONFIRMATION_HEADER_HEIGHT = 542;
const EXPANSION_DURATION = 360;

type PreviewStatus = "idle" | "loading" | "success" | "error";

function countryCodeToFlag(countryCode: string): string {
  const normalizedCode = countryCode.trim().toUpperCase();

  if (!/^[A-Z]{2}$/.test(normalizedCode)) {
    return "";
  }

  return String.fromCodePoint(
    ...[...normalizedCode].map((character) => character.charCodeAt(0) + 127397),
  );
}

type StepperProps = {
  decreaseLabel: string;
  increaseLabel: string;
  onDecrease: () => void;
  onIncrease: () => void;
  value: string;
  width: number;
};

function Stepper({
  decreaseLabel,
  increaseLabel,
  onDecrease,
  onIncrease,
  value,
  width,
}: StepperProps) {
  return (
    <View style={[styles.stepper, { width }]}>
      <Pressable
        accessibilityLabel={decreaseLabel}
        accessibilityRole="button"
        hitSlop={4}
        onPress={onDecrease}
        style={({ pressed }) => [styles.stepperAction, pressed && styles.pressed]}
      >
        <MaterialIcons color={YELLOW} name="remove" size={18} />
      </Pressable>

      <Text style={styles.stepperValue}>{value}</Text>

      <Pressable
        accessibilityLabel={increaseLabel}
        accessibilityRole="button"
        hitSlop={4}
        onPress={onIncrease}
        style={({ pressed }) => [styles.stepperAction, pressed && styles.pressed]}
      >
        <MaterialIcons color={YELLOW} name="add" size={18} />
      </Pressable>
    </View>
  );
}

export default function SearchPreferencesScreen() {
  const { query } = useLocalSearchParams<{ query?: string | string[] }>();
  const initialQuery = Array.isArray(query) ? query[0] : query;
  const [description, setDescription] = useState(initialQuery ?? "");
  const [location, setLocation] = useState("");
  const [date, setDate] = useState("");
  const [useCurrentLocation, setUseCurrentLocation] = useState(true);
  const [hour, setHour] = useState(14);
  const [minute, setMinute] = useState(30);
  const [duration, setDuration] = useState(1);
  const [distance, setDistance] = useState<RecruitmentDistanceKm>(3);
  const [isCompactHeaderVisible, setIsCompactHeaderVisible] = useState(true);
  const [isConfirmationVisible, setIsConfirmationVisible] = useState(false);
  const [preview, setPreview] = useState<RecruitmentPreview | null>(null);
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>("idle");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const dateInputRef = useRef<TextInput>(null);
  const previewRequestRef = useRef<AbortController | null>(null);
  const panelHeight = useMemo(
    () => new Animated.Value(COLLAPSED_HEADER_HEIGHT),
    [],
  );
  const compactContentOpacity = useMemo(() => new Animated.Value(1), []);
  const compactContentTranslateY = useMemo(() => new Animated.Value(0), []);
  const contentOpacity = useMemo(() => new Animated.Value(0), []);
  const contentTranslateY = useMemo(() => new Animated.Value(14), []);
  const confirmationOpacity = useMemo(() => new Animated.Value(0), []);
  const confirmationTranslateY = useMemo(() => new Animated.Value(14), []);

  useEffect(() => {
    const animation = Animated.parallel([
      Animated.timing(panelHeight, {
        duration: EXPANSION_DURATION,
        easing: Easing.out(Easing.cubic),
        toValue: EXPANDED_HEADER_HEIGHT,
        useNativeDriver: false,
      }),
      Animated.timing(compactContentOpacity, {
        duration: 120,
        easing: Easing.out(Easing.quad),
        toValue: 0,
        useNativeDriver: false,
      }),
      Animated.timing(compactContentTranslateY, {
        duration: 150,
        easing: Easing.out(Easing.quad),
        toValue: -8,
        useNativeDriver: false,
      }),
      Animated.timing(contentOpacity, {
        delay: 100,
        duration: 240,
        toValue: 1,
        useNativeDriver: false,
      }),
      Animated.timing(contentTranslateY, {
        delay: 100,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        toValue: 0,
        useNativeDriver: false,
      }),
    ]);
    const frame = requestAnimationFrame(() =>
      animation.start(({ finished }) => {
        if (finished) {
          setIsCompactHeaderVisible(false);
        }
      }),
    );

    return () => {
      cancelAnimationFrame(frame);
      animation.stop();
    };
  }, [
    compactContentOpacity,
    compactContentTranslateY,
    contentOpacity,
    contentTranslateY,
    panelHeight,
  ]);

  useEffect(
    () => () => {
      previewRequestRef.current?.abort();
    },
    [],
  );

  const updateMinute = (amount: number) => {
    const nextTime = shiftTime(
      `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
      amount,
    );
    const nextHour = Number(nextTime.slice(0, 2));
    const nextMinute = Number(nextTime.slice(3, 5));

    setHour(nextHour);
    setMinute(nextMinute);
  };

  const createDraft = (): RecruitmentDraft => ({
    activity: description.trim() || "Explore Osaka with a local",
    location: location.trim() || "Osaka,Umeda",
    useCurrentLocation,
    date: date.trim() || "August,25 2026",
    startTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    durationHours: duration,
    distanceKm: distance,
  });

  const loadPreview = async () => {
    previewRequestRef.current?.abort();
    const controller = new AbortController();
    previewRequestRef.current = controller;
    setPreview(null);
    setPreviewError(null);
    setPreviewStatus("loading");

    try {
      const result = await createRecruitmentPreview(createDraft(), controller.signal);

      if (previewRequestRef.current === controller) {
        setPreview(result);
        setPreviewStatus("success");
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }

      if (previewRequestRef.current === controller) {
        setPreviewError("Preview could not be prepared. Please try again.");
        setPreviewStatus("error");
      }
    } finally {
      if (previewRequestRef.current === controller) {
        previewRequestRef.current = null;
      }
    }
  };

  const showConfirmation = () => {
    if (previewStatus === "loading") {
      return;
    }

    Keyboard.dismiss();
    void loadPreview();
    confirmationOpacity.setValue(0);
    confirmationTranslateY.setValue(14);
    setIsConfirmationVisible(true);

    requestAnimationFrame(() => {
      Animated.parallel([
        Animated.timing(panelHeight, {
          duration: 300,
          easing: Easing.out(Easing.cubic),
          toValue: CONFIRMATION_HEADER_HEIGHT,
          useNativeDriver: false,
        }),
        Animated.timing(contentOpacity, {
          duration: 140,
          toValue: 0,
          useNativeDriver: false,
        }),
        Animated.timing(contentTranslateY, {
          duration: 180,
          easing: Easing.out(Easing.quad),
          toValue: -12,
          useNativeDriver: false,
        }),
        Animated.timing(confirmationOpacity, {
          delay: 80,
          duration: 220,
          toValue: 1,
          useNativeDriver: false,
        }),
        Animated.timing(confirmationTranslateY, {
          delay: 80,
          duration: 220,
          easing: Easing.out(Easing.cubic),
          toValue: 0,
          useNativeDriver: false,
        }),
      ]).start();
    });
  };

  const showFilters = () => {
    previewRequestRef.current?.abort();
    Animated.parallel([
      Animated.timing(panelHeight, {
        duration: 300,
        easing: Easing.out(Easing.cubic),
        toValue: EXPANDED_HEADER_HEIGHT,
        useNativeDriver: false,
      }),
      Animated.timing(confirmationOpacity, {
        duration: 140,
        toValue: 0,
        useNativeDriver: false,
      }),
      Animated.timing(confirmationTranslateY, {
        duration: 180,
        easing: Easing.out(Easing.quad),
        toValue: 12,
        useNativeDriver: false,
      }),
      Animated.timing(contentOpacity, {
        delay: 70,
        duration: 220,
        toValue: 1,
        useNativeDriver: false,
      }),
      Animated.timing(contentTranslateY, {
        delay: 70,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        toValue: 0,
        useNativeDriver: false,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        setIsConfirmationVisible(false);
        setPreview(null);
        setPreviewError(null);
        setPreviewStatus("idle");
      }
    });
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      <Animated.View style={[styles.panel, { height: panelHeight }]}>
        <Animated.View
          accessibilityElementsHidden={isConfirmationVisible}
          importantForAccessibility={
            isConfirmationVisible ? "no-hide-descendants" : "auto"
          }
          style={[
            styles.content,
            {
              opacity: contentOpacity,
              pointerEvents: isConfirmationVisible ? "none" : "auto",
              transform: [{ translateY: contentTranslateY }],
            },
          ]}
        >
          <View style={styles.form}>
            <View style={styles.descriptionGroup}>
              <Text style={styles.label}>What would you like to do?</Text>
              <TextInput
                accessibilityLabel="Activity description"
                maxLength={160}
                multiline
                onChangeText={setDescription}
                placeholder="Please tell us more about what you'd like to do or see"
                placeholderTextColor={PLACEHOLDER_GRAY}
                style={[styles.input, styles.descriptionInput]}
                textAlignVertical="top"
                value={description}
              />
            </View>

            <View style={styles.whereGroup}>
              <Text style={styles.label}>Where</Text>
              <View style={[styles.input, styles.locationField]}>
                <MaterialIcons
                  color={PLACEHOLDER_GRAY}
                  name="search"
                  size={27}
                  style={styles.locationSearchIcon}
                />
                <TextInput
                  accessibilityLabel="Location"
                  onChangeText={setLocation}
                  placeholder="Osaka,Umeda"
                  placeholderTextColor={PLACEHOLDER_GRAY}
                  returnKeyType="search"
                  style={styles.locationInput}
                  value={location}
                />
              </View>

              <Pressable
                accessibilityLabel="Use my current location"
                accessibilityRole="checkbox"
                accessibilityState={{ checked: useCurrentLocation }}
                onPress={() => setUseCurrentLocation((current) => !current)}
                style={({ pressed }) => [
                  styles.currentLocation,
                  pressed && styles.pressed,
                ]}
              >
                <MaterialIcons
                  color="#ffffff"
                  name={useCurrentLocation ? "check-box" : "check-box-outline-blank"}
                  size={24}
                />
                <Text style={styles.currentLocationText}>Use my current location</Text>
              </Pressable>
            </View>

            <View style={styles.dateGroup}>
              <Text style={styles.label}>Date</Text>
              <View style={styles.dateRow}>
                <TextInput
                  ref={dateInputRef}
                  accessibilityLabel="Date"
                  onChangeText={setDate}
                  placeholder="August,25 2026"
                  placeholderTextColor={PLACEHOLDER_GRAY}
                  style={[styles.input, styles.dateInput]}
                  value={date}
                />
                <Pressable
                  accessibilityLabel="Open date input"
                  accessibilityRole="button"
                  hitSlop={5}
                  onPress={() => dateInputRef.current?.focus()}
                  style={({ pressed }) => [
                    styles.calendarButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <MaterialIcons color="#ffffff" name="calendar-today" size={25} />
                </Pressable>
              </View>
            </View>

            <View style={styles.startTimeGroup}>
              <Text style={styles.label}>Start Time</Text>
              <View style={styles.timeRow}>
                <Stepper
                  decreaseLabel="Decrease start hour"
                  increaseLabel="Increase start hour"
                  onDecrease={() => setHour((current) => (current + 23) % 24)}
                  onIncrease={() => setHour((current) => (current + 1) % 24)}
                  value={String(hour).padStart(2, "0")}
                  width={92}
                />
                <Text style={styles.timeSeparator}>:</Text>
                <Stepper
                  decreaseLabel="Decrease start minute"
                  increaseLabel="Increase start minute"
                  onDecrease={() => updateMinute(-5)}
                  onIncrease={() => updateMinute(5)}
                  value={String(minute).padStart(2, "0")}
                  width={94}
                />
              </View>
            </View>

            <View style={styles.durationGroup}>
              <Text style={styles.label}>Duration</Text>
              <View style={styles.durationStepper}>
                <Stepper
                  decreaseLabel="Decrease duration"
                  increaseLabel="Increase duration"
                  onDecrease={() => setDuration((current) => Math.max(1, current - 1))}
                  onIncrease={() => setDuration((current) => Math.min(8, current + 1))}
                  value={`${duration}hr`}
                  width={152}
                />
              </View>
            </View>

            <View style={styles.distanceGroup}>
              <Text style={styles.label}>Distance</Text>
              <View style={styles.distanceRow}>
                {[1, 3, 5].map((option) => {
                  const selected = distance === option;

                  return (
                    <Pressable
                      key={option}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      onPress={() => setDistance(option as RecruitmentDistanceKm)}
                      style={({ pressed }) => [
                        styles.distanceButton,
                        selected && styles.distanceButtonSelected,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text
                        style={[
                          styles.distanceText,
                          selected && styles.distanceTextSelected,
                        ]}
                      >
                        {option}km
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <Pressable
              accessibilityRole="button"
              disabled={previewStatus === "loading"}
              onPress={showConfirmation}
              style={({ pressed }) => [
                styles.nextButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.nextText}>NEXT</Text>
            </Pressable>
          </View>
        </Animated.View>

        {isConfirmationVisible && (
          <Animated.View
            style={[
              styles.confirmationContent,
              {
                opacity: confirmationOpacity,
                transform: [{ translateY: confirmationTranslateY }],
              },
            ]}
          >
            <Text style={styles.confirmationTitle}>Is everything correct?</Text>
            <Text style={styles.confirmationExpiry}>
              This post will be visible until {preview?.expiresAt ?? "..."}
            </Text>

            <View style={styles.summaryCard}>
              {previewStatus === "loading" && (
                <View style={styles.previewState}>
                  <ActivityIndicator color={BLUE} size="small" />
                </View>
              )}

              {previewStatus === "error" && (
                <View style={styles.previewState}>
                  <Text style={styles.previewError}>{previewError}</Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void loadPreview()}
                    style={({ pressed }) => [
                      styles.retryButton,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.retryButtonText}>TRY AGAIN</Text>
                  </Pressable>
                </View>
              )}

              {previewStatus === "success" && preview && (
                <>
                  <View style={styles.summaryProfileRow}>
                    {preview.author.avatarUrl ? (
                      <Image
                        accessibilityLabel={`${preview.author.displayName}'s profile image`}
                        source={{ uri: preview.author.avatarUrl }}
                        style={styles.summaryAvatar}
                      />
                    ) : (
                      <MaterialIcons
                        color={BORDER_GRAY}
                        name="account-circle"
                        size={30}
                      />
                    )}
                    <Text numberOfLines={1} style={styles.summaryName}>
                      {preview.author.displayName}
                    </Text>
                    <Text style={styles.summaryFlag}>
                      {countryCodeToFlag(preview.author.countryCode)}
                    </Text>
                  </View>
                  <Text
                    numberOfLines={1}
                    style={[styles.summaryLine, styles.summaryDate]}
                  >
                    <Text style={styles.summaryLabel}>Date</Text>
                    {`   ${preview.conditions.date}`}
                  </Text>
                  <Text style={[styles.summaryLine, styles.summaryTime]}>
                    <Text style={styles.summaryLabel}>Time</Text>
                    {`   ${formatTimeRange(
                      preview.conditions.startTime,
                      preview.conditions.durationHours,
                    )}`}
                  </Text>
                  <View style={styles.summaryTags}>
                    {preview.tags.map((tag) => (
                      <View key={tag} style={styles.summaryTag}>
                        <Text
                          adjustsFontSizeToFit
                          minimumFontScale={0.75}
                          numberOfLines={1}
                          style={styles.summaryTagText}
                        >
                          {tag}
                        </Text>
                      </View>
                    ))}
                  </View>
                </>
              )}
            </View>

            <Pressable
              accessibilityState={{ disabled: previewStatus !== "success" }}
              accessibilityRole="button"
              disabled={previewStatus !== "success"}
              onPress={Keyboard.dismiss}
              style={({ pressed }) => [
                styles.goButton,
                previewStatus !== "success" && styles.buttonDisabled,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.goButtonText}>GO!</Text>
            </Pressable>

            <Pressable
              accessibilityLabel="Back to search filters"
              accessibilityRole="button"
              onPress={showFilters}
              style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
            >
              <MaterialIcons color={YELLOW} name="arrow-back" size={18} />
              <Text style={styles.backButtonText}>BACK</Text>
            </Pressable>
          </Animated.View>
        )}

        {isCompactHeaderVisible && (
          <Animated.View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[
              styles.compactContent,
              {
                opacity: compactContentOpacity,
                transform: [{ translateY: compactContentTranslateY }],
              },
            ]}
          >
            <View style={styles.compactActionRow}>
              <View style={styles.compactSearchField}>
                <MaterialIcons
                  color={PLACEHOLDER_GRAY}
                  name="search"
                  size={22}
                  style={styles.compactSearchIcon}
                />
                <Text style={styles.compactSearchPlaceholder}>
                  What would you like to do?
                </Text>
              </View>
              <View style={styles.compactNotificationIcon}>
                <MaterialIcons color="#ffffff" name="notifications-none" size={30} />
              </View>
              <View style={styles.compactProfileIcon}>
                <MaterialIcons color="#ffffff" name="account-circle" size={30} />
              </View>
            </View>
            <Text style={styles.compactTitle}>Find Your Japan!</Text>
          </Animated.View>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  panel: {
    width: "100%",
    overflow: "hidden",
    backgroundColor: BLUE,
    borderBottomLeftRadius: 50,
    borderBottomRightRadius: 50,
  },
  compactContent: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    pointerEvents: "none",
  },
  compactActionRow: {
    position: "absolute",
    top: 45,
    right: 19,
    left: 19,
    height: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: 19,
  },
  compactSearchField: {
    flex: 1,
    height: 30,
    justifyContent: "center",
    borderRadius: 20,
    backgroundColor: "#ffffff",
  },
  compactSearchIcon: {
    position: "absolute",
    left: 14.2,
  },
  compactSearchPlaceholder: {
    paddingLeft: 45.34,
    color: PLACEHOLDER_GRAY,
    fontSize: 12,
    fontWeight: "400",
    letterSpacing: 0,
    lineHeight: 15,
  },
  compactNotificationIcon: {
    width: 21,
    height: 25,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  compactProfileIcon: {
    width: 24.56,
    height: 25,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  compactTitle: {
    position: "absolute",
    top: 108,
    right: 0,
    left: 0,
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 19,
    textAlign: "center",
  },
  confirmationContent: {
    position: "absolute",
    top: 0,
    right: 0,
    left: 0,
    height: CONFIRMATION_HEADER_HEIGHT,
  },
  confirmationTitle: {
    position: "absolute",
    top: 130,
    right: 0,
    left: 0,
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 18,
    textAlign: "center",
  },
  confirmationExpiry: {
    position: "absolute",
    top: 167,
    right: 0,
    left: 0,
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 19,
    textAlign: "center",
  },
  summaryCard: {
    position: "absolute",
    top: 205,
    alignSelf: "center",
    width: 307,
    maxWidth: "78.72%",
    height: 132,
    borderRadius: 20,
    backgroundColor: "#ffffff",
  },
  summaryProfileRow: {
    position: "absolute",
    top: 7,
    left: 22,
    height: 30,
    flexDirection: "row",
    alignItems: "center",
  },
  summaryAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  summaryName: {
    maxWidth: 178,
    marginLeft: 8,
    color: "#000000",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 19,
  },
  summaryFlag: {
    marginLeft: 12,
    color: "#000000",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 19,
  },
  summaryLine: {
    position: "absolute",
    left: 23,
    right: 23,
    color: TEXT_GRAY,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 15,
  },
  summaryLabel: {
    fontWeight: "900",
  },
  summaryDate: {
    top: 44,
  },
  summaryTime: {
    top: 68,
  },
  summaryTags: {
    position: "absolute",
    top: 95,
    left: 23,
    height: 25,
    flexDirection: "row",
    gap: 21,
  },
  summaryTag: {
    minWidth: 55,
    maxWidth: 100,
    height: 25,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BLUE,
    borderRadius: 5,
    backgroundColor: "#ffffff",
  },
  summaryTagText: {
    color: TEXT_GRAY,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 12,
  },
  previewState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    gap: 10,
  },
  previewError: {
    color: TEXT_GRAY,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 15,
    textAlign: "center",
  },
  retryButton: {
    minWidth: 82,
    height: 25,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BLUE,
    borderRadius: 20,
    backgroundColor: "#ffffff",
  },
  retryButtonText: {
    color: BLUE,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 12,
  },
  goButton: {
    position: "absolute",
    top: 359,
    alignSelf: "center",
    width: 159,
    height: 25,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
    backgroundColor: YELLOW,
    boxShadow: "0 4px 2px rgba(0, 0, 0, 0.25)",
  },
  goButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 18,
  },
  backButton: {
    position: "absolute",
    top: 491,
    left: 30,
    width: 110,
    height: 25,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 20,
    backgroundColor: "#ffffff",
    boxShadow: "0 4px 2px rgba(0, 0, 0, 0.25)",
  },
  backButtonText: {
    color: YELLOW,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 18,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  content: {
    position: "absolute",
    top: 41,
    right: 0,
    left: 0,
    alignItems: "center",
  },
  form: {
    width: 340,
    maxWidth: "87.18%",
    height: 577,
  },
  label: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 18,
    textAlign: "center",
  },
  input: {
    borderRadius: 20,
    backgroundColor: "#ffffff",
    color: TEXT_GRAY,
    fontSize: 13,
    fontWeight: "400",
    letterSpacing: 0,
    boxShadow: "0 4px 4px rgba(0, 0, 0, 0.25)",
  },
  descriptionGroup: {
    position: "absolute",
    top: 0,
    right: 0,
    left: 0,
    height: 82,
  },
  descriptionInput: {
    position: "absolute",
    top: 23,
    width: "100%",
    height: 59,
    paddingTop: 6,
    paddingRight: 6,
    paddingBottom: 6,
    paddingLeft: 6,
  },
  whereGroup: {
    position: "absolute",
    top: 101,
    right: 0,
    left: 0,
    height: 82,
  },
  locationField: {
    position: "absolute",
    top: 28,
    width: "100%",
    height: 34,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: BORDER_GRAY,
  },
  locationSearchIcon: {
    position: "absolute",
    left: 16,
  },
  locationInput: {
    width: "100%",
    height: 34,
    paddingTop: 0,
    paddingRight: 12,
    paddingBottom: 0,
    paddingLeft: 57,
    color: TEXT_GRAY,
    fontSize: 13,
    fontWeight: "400",
    letterSpacing: 0,
  },
  currentLocation: {
    position: "absolute",
    top: 70,
    alignSelf: "center",
    height: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  currentLocationText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 18,
  },
  dateGroup: {
    position: "absolute",
    top: 213,
    right: 0,
    left: 0,
    height: 59,
  },
  dateRow: {
    position: "absolute",
    top: 24,
    alignSelf: "center",
    width: 302,
    height: 35,
    flexDirection: "row",
    alignItems: "center",
  },
  dateInput: {
    width: 259,
    height: 35,
    paddingTop: 0,
    paddingRight: 18,
    paddingBottom: 0,
    paddingLeft: 18,
    borderWidth: 1,
    borderColor: BORDER_GRAY,
  },
  calendarButton: {
    width: 43,
    height: 35,
    alignItems: "center",
    justifyContent: "center",
  },
  startTimeGroup: {
    position: "absolute",
    top: 301,
    right: 0,
    left: 0,
    height: 57,
  },
  timeRow: {
    position: "absolute",
    top: 27,
    alignSelf: "center",
    width: 234,
    height: 30,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  timeSeparator: {
    width: 48,
    color: "#ffffff",
    fontSize: 32,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 32,
    textAlign: "center",
  },
  stepper: {
    height: 29,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 20,
    backgroundColor: "#ffffff",
    boxShadow: "0 4px 4px rgba(0, 0, 0, 0.25)",
  },
  stepperAction: {
    width: 28,
    height: 29,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperValue: {
    color: TEXT_GRAY,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 18,
    textAlign: "center",
  },
  durationGroup: {
    position: "absolute",
    top: 388,
    right: 0,
    left: 0,
    height: 51,
  },
  durationStepper: {
    position: "absolute",
    top: 22,
    alignSelf: "center",
  },
  distanceGroup: {
    position: "absolute",
    top: 469,
    right: 0,
    left: 0,
    height: 53,
  },
  distanceRow: {
    position: "absolute",
    top: 28,
    alignSelf: "center",
    width: 236,
    height: 25,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  distanceButton: {
    width: 70,
    height: 25,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 20,
    backgroundColor: "#ffffff",
  },
  distanceButtonSelected: {
    borderColor: YELLOW,
    backgroundColor: YELLOW,
    boxShadow: "0 4px 2px rgba(0, 0, 0, 0.25)",
  },
  distanceText: {
    color: TEXT_GRAY,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 18,
  },
  distanceTextSelected: {
    color: "#ffffff",
  },
  nextButton: {
    position: "absolute",
    top: 552,
    alignSelf: "center",
    width: 110,
    height: 25,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 20,
    backgroundColor: "#ffffff",
    boxShadow: "0 4px 2px rgba(0, 0, 0, 0.25)",
  },
  nextText: {
    color: YELLOW,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.72,
  },
});
