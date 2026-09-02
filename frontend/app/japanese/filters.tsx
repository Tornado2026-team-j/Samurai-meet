import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { Header, colors, radius } from "../../components/ui";
import {
  formatRecruitmentISODate,
  JST_TIME_ZONE,
  parseRecruitmentDateInput,
} from "../../services/recruitment";
import {
  MAX_RECRUITMENT_SEARCH_RANGE_DAYS,
  validateRecruitmentSearchDateRange,
  type RecruitmentSearchDateRangeError,
} from "../../services/matching";
import { type MatchCategory } from "../../types/match";

const CATEGORIES: { value: MatchCategory | ""; label: string }[] = [
  { value: "", label: "すべて" },
  { value: "Food", label: "Food" },
  { value: "Places", label: "Places" },
  { value: "Activity", label: "Activity" },
  { value: "Other", label: "Other" },
];
const TIMES = [
  { value: "", label: "指定なし", start: "", end: "" },
  { value: "morning", label: "朝 6–12時", start: "06:00", end: "12:00" },
  { value: "afternoon", label: "昼 12–18時", start: "12:00", end: "18:00" },
  { value: "evening", label: "夜 18–24時", start: "18:00", end: "23:59" },
] as const;

type DateField = "from" | "to";

const SEARCH_DAY_MS = 24 * 60 * 60 * 1000;

function dateRangeErrorMessage(error: RecruitmentSearchDateRangeError): string {
  switch (error) {
    case "search_date_range_requires_both":
      return "開始日と終了日を両方指定してください。";
    case "search_date_range_invalid":
      return "日付を正しく指定してください。";
    case "search_date_range_reversed":
      return "終了日は開始日以降を指定してください。";
    case "search_date_range_too_long":
      return `検索期間は${MAX_RECRUITMENT_SEARCH_RANGE_DAYS}日差以内で指定してください。`;
  }
}

function datePickerBounds(field: DateField, availableFrom: string, availableTo: string): { minimumDate?: Date; maximumDate?: Date } {
  const otherValue = field === "from" ? availableTo : availableFrom;
  if (!otherValue) return {};

  let otherDate: Date;
  try {
    otherDate = parseRecruitmentDateInput(otherValue);
  } catch {
    return {};
  }

  if (field === "from") {
    return {
      minimumDate: new Date(otherDate.getTime() - MAX_RECRUITMENT_SEARCH_RANGE_DAYS * SEARCH_DAY_MS),
      maximumDate: otherDate,
    };
  }
  return {
    minimumDate: otherDate,
    maximumDate: new Date(otherDate.getTime() + MAX_RECRUITMENT_SEARCH_RANGE_DAYS * SEARCH_DAY_MS),
  };
}

export default function JapaneseFiltersScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ category?: string; time?: string; radius?: string; query?: string; date?: string; sort?: string; availableFrom?: string; availableTo?: string }>();
  const [category, setCategory] = useState<MatchCategory | "">(CATEGORIES.some((item) => item.value === params.category) ? params.category as MatchCategory : "");
  const [time, setTime] = useState(TIMES.some((item) => item.value === params.time) ? params.time ?? "" : "");
  const [radius, setRadius] = useState(params.radius === "1" || params.radius === "5" ? params.radius : "3");
  const [availableFrom, setAvailableFrom] = useState(params.availableFrom ?? "");
  const [availableTo, setAvailableTo] = useState(params.availableTo ?? "");
  const [datePickerField, setDatePickerField] = useState<DateField | null>(null);
  const [pickerDate, setPickerDate] = useState(() => new Date());
  const [dateError, setDateError] = useState<string | null>(null);
  const pickerBounds = datePickerField ? datePickerBounds(datePickerField, availableFrom, availableTo) : {};

  const apply = () => {
    const rangeError = validateRecruitmentSearchDateRange(availableFrom, availableTo);
    if (rangeError) {
      setDateError(dateRangeErrorMessage(rangeError));
      return;
    }

    setDateError(null);
    router.replace({
      pathname: "/japanese",
      params: {
        ...(params.query ? { query: params.query } : {}),
        ...(params.date ? { date: params.date } : {}),
        ...(params.sort ? { sort: params.sort } : {}),
        ...(availableFrom ? { availableFrom } : {}),
        ...(availableTo ? { availableTo } : {}),
        ...(category ? { category } : {}),
        ...(time ? { time } : {}),
        radius,
      },
    });
  };

  const openDatePicker = (field: DateField) => {
    Keyboard.dismiss();
    const currentValue = field === "from" ? availableFrom : availableTo;
    let nextDate = new Date();
    try {
      nextDate = parseRecruitmentDateInput(currentValue);
    } catch {
      // Empty and legacy-invalid filter values open on the current date.
    }
    const bounds = datePickerBounds(field, availableFrom, availableTo);
    if (bounds.minimumDate && nextDate.getTime() < bounds.minimumDate.getTime()) nextDate = bounds.minimumDate;
    if (bounds.maximumDate && nextDate.getTime() > bounds.maximumDate.getTime()) nextDate = bounds.maximumDate;
    setPickerDate(nextDate);
    setDatePickerField(field);
  };

  const closeDatePicker = () => setDatePickerField(null);

  const commitDate = (value: Date) => {
    if (!datePickerField) return;

    let nextDate: string;
    try {
      nextDate = formatRecruitmentISODate(value);
    } catch {
      return;
    }

    if (datePickerField === "from") {
      setAvailableFrom(nextDate);
    } else {
      setAvailableTo(nextDate);
    }
    setDateError(null);
    closeDatePicker();
  };

  const handleDatePickerChange = (event: DateTimePickerEvent, value?: Date) => {
    if (event.type === "dismissed") {
      closeDatePicker();
      return;
    }
    if (!value) return;

    if (Platform.OS === "android") {
      commitDate(value);
      return;
    }

    setPickerDate(value);
  };

  const clearDate = (field: DateField) => {
    if (field === "from") {
      setAvailableFrom("");
    } else {
      setAvailableTo("");
    }
    setDateError(null);
  };

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
        <FilterGroup label="募集日（期間）">
          <Text style={styles.hint}>OS標準の日付選択で指定（開始日・終了日必須、最大31日差）</Text>
          <View style={styles.dateRow}>
            <DateFilterField
              label="開始日"
              onClear={() => clearDate("from")}
              onPress={() => openDatePicker("from")}
              value={availableFrom}
            />
            <Text style={styles.dateSeparator}>〜</Text>
            <DateFilterField
              label="終了日"
              onClear={() => clearDate("to")}
              onPress={() => openDatePicker("to")}
              value={availableTo}
            />
          </View>
          {dateError ? <Text accessibilityRole="alert" style={styles.validationText}>{dateError}</Text> : null}
        </FilterGroup>
        <FilterGroup label="検索地点からの距離">
          <View style={styles.choices}>{["1", "3", "5"].map((value) => <Choice key={value} label={`${value}km以内`} onPress={() => setRadius(value)} selected={radius === value} />)}</View>
        </FilterGroup>
        <Pressable
          accessibilityLabel="本人確認済みのみ"
          accessibilityRole="checkbox"
          accessibilityState={{ checked: false, disabled: true }}
          disabled
          style={[styles.switchRow, styles.disabledRow]}
        >
          <View style={styles.checkboxCopy}>
            <View style={styles.checkboxLabelRow}>
              <MaterialIcons color={colors.text.muted} name="check-box-outline-blank" size={22} />
              <Text style={styles.groupLabel}>本人確認済みのみ</Text>
              <Text style={styles.comingSoon}>Coming Soon</Text>
            </View>
            <Text style={styles.hint}>確認済みバッジのある募集者に絞ります</Text>
          </View>
        </Pressable>
        <Pressable onPress={apply} style={styles.apply}><MaterialIcons color={colors.text.inverse} name="search" size={21} /><Text style={styles.applyText}>この条件で検索</Text></Pressable>
      </ScrollView>

      {Platform.OS !== "ios" && datePickerField ? (
        <DateTimePicker
          display="default"
          maximumDate={pickerBounds.maximumDate}
          mode="date"
          minimumDate={pickerBounds.minimumDate}
          onChange={handleDatePickerChange}
          timeZoneName={JST_TIME_ZONE}
          value={pickerDate}
        />
      ) : null}

      {Platform.OS === "ios" && datePickerField ? (
        <Modal
          animationType="slide"
          onRequestClose={closeDatePicker}
          transparent
          visible
        >
          <View style={styles.modalBackdrop}>
            <Pressable
              accessibilityLabel="日付選択を閉じる"
              onPress={closeDatePicker}
              style={StyleSheet.absoluteFillObject}
            />
            <View style={[styles.pickerSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
              <View style={styles.pickerHeader}>
                <Pressable accessibilityRole="button" onPress={closeDatePicker} style={styles.pickerHeaderButton}>
                  <Text style={styles.pickerCancelText}>キャンセル</Text>
                </Pressable>
                <Text style={styles.pickerTitle}>{datePickerField === "from" ? "開始日" : "終了日"}</Text>
                <Pressable accessibilityRole="button" onPress={() => commitDate(pickerDate)} style={styles.pickerHeaderButton}>
                  <Text style={styles.pickerDoneText}>完了</Text>
                </Pressable>
              </View>
              <DateTimePicker
                accentColor={colors.brand.sky}
                display="spinner"
                locale="ja-JP"
                maximumDate={pickerBounds.maximumDate}
                mode="date"
                minimumDate={pickerBounds.minimumDate}
                onChange={handleDatePickerChange}
                style={styles.nativePicker}
                themeVariant="light"
                timeZoneName={JST_TIME_ZONE}
                value={pickerDate}
              />
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

function FilterGroup({ children, label }: { children: React.ReactNode; label: string }) {
  return <View style={styles.group}><Text style={styles.groupLabel}>{label}</Text>{children}</View>;
}
function Choice({ label, onPress, selected }: { label: string; onPress: () => void; selected: boolean }) {
  return <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress} style={[styles.choice, selected && styles.choiceSelected]}><Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text></Pressable>;
}

function DateFilterField({
  label,
  onClear,
  onPress,
  value,
}: {
  label: string;
  onClear: () => void;
  onPress: () => void;
  value: string;
}) {
  return (
    <View style={styles.dateFieldWrap}>
      <Pressable
        accessibilityLabel={`${label}を選択`}
        accessibilityRole="button"
        accessibilityValue={{ text: value || "未指定" }}
        onPress={onPress}
        style={({ pressed }) => [styles.dateField, pressed && styles.pressed]}
      >
        <MaterialIcons color={colors.text.muted} name="calendar-today" size={18} />
        <Text numberOfLines={1} style={[styles.dateFieldText, !value && styles.dateFieldPlaceholder]}>
          {value ? `${label} ${value}` : `${label}を選択`}
        </Text>
      </Pressable>
      {value ? (
        <Pressable
          accessibilityLabel={`${label}をクリア`}
          accessibilityRole="button"
          hitSlop={4}
          onPress={onClear}
          style={({ pressed }) => [styles.clearDateButton, pressed && styles.pressed]}
        >
          <MaterialIcons color={colors.text.muted} name="close" size={17} />
        </Pressable>
      ) : null}
    </View>
  );
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
  switchRow: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 14 },
  disabledRow: { opacity: 0.62 },
  checkboxCopy: { flex: 1, gap: 4 },
  checkboxLabelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  comingSoon: { color: colors.text.muted, fontSize: 11, fontWeight: "800" },
  hint: { marginTop: 4, color: colors.text.muted, fontSize: 11 },
  validationText: { color: colors.state.danger, fontSize: 12, fontWeight: "800" },
  dateRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  dateFieldWrap: { flex: 1, minWidth: 0, position: "relative" },
  dateField: { minHeight: 48, paddingHorizontal: 10, paddingRight: 34, flexDirection: "row", alignItems: "center", gap: 7, borderWidth: 1, borderColor: colors.border.default, borderRadius: radius.md, backgroundColor: colors.surface.default },
  dateFieldText: { flex: 1, color: colors.text.primary, fontSize: 12, fontWeight: "700" },
  dateFieldPlaceholder: { color: colors.text.muted, fontWeight: "600" },
  clearDateButton: { position: "absolute", top: 2, right: 2, bottom: 2, width: 32, alignItems: "center", justifyContent: "center" },
  dateSeparator: { color: colors.text.secondary, fontWeight: "900" },
  apply: { minHeight: 50, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: radius.md, backgroundColor: colors.brand.sky },
  applyText: { color: colors.text.inverse, fontSize: 15, fontWeight: "900" },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0, 0, 0, 0.28)" },
  pickerSheet: { minHeight: 286, paddingTop: 8, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: colors.surface.default },
  pickerHeader: { height: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 },
  pickerHeaderButton: { minWidth: 72, height: 40, alignItems: "center", justifyContent: "center" },
  pickerTitle: { flex: 1, color: colors.text.primary, fontSize: 16, fontWeight: "900", textAlign: "center" },
  pickerCancelText: { color: colors.text.primary, fontSize: 14, fontWeight: "700" },
  pickerDoneText: { color: colors.brand.sky, fontSize: 14, fontWeight: "900" },
  nativePicker: { alignSelf: "center", width: "100%", height: 216 },
  pressed: { opacity: 0.72 },
});
