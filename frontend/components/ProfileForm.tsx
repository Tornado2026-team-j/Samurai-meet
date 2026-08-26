import { useMemo, useState } from "react";
import { MaterialIcons } from "@expo/vector-icons";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { AppLanguage, LocalProfile } from "../services/onboarding";

const YELLOW = "#e7b454";
const TEXT_GRAY = "#535353";
const MUTED_GRAY = "#7d7d7d";
const BORDER_GRAY = "#d4d4d4";

const COUNTRY_CODES = "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" ");

type CountryOption = {
  code: string;
  name: string;
};

type RegionDisplayNames = {
  of: (code: string) => string | undefined;
};

type RegionDisplayNamesConstructor = new (
  locales: string[],
  options: { type: "region" },
) => RegionDisplayNames;

const FALLBACK_COUNTRY_NAMES: Record<AppLanguage, Record<string, string>> = {
  ja: {
    AU: "オーストラリア",
    BR: "ブラジル",
    CA: "カナダ",
    CN: "中国",
    DE: "ドイツ",
    ES: "スペイン",
    FR: "フランス",
    GB: "イギリス",
    HK: "香港",
    ID: "インドネシア",
    IN: "インド",
    IT: "イタリア",
    JP: "日本",
    KR: "韓国",
    MX: "メキシコ",
    MY: "マレーシア",
    PH: "フィリピン",
    SG: "シンガポール",
    TH: "タイ",
    TW: "台湾",
    US: "アメリカ",
    VN: "ベトナム",
  },
  en: {
    AU: "Australia",
    BR: "Brazil",
    CA: "Canada",
    CN: "China",
    DE: "Germany",
    ES: "Spain",
    FR: "France",
    GB: "United Kingdom",
    HK: "Hong Kong",
    ID: "Indonesia",
    IN: "India",
    IT: "Italy",
    JP: "Japan",
    KR: "South Korea",
    MX: "Mexico",
    MY: "Malaysia",
    PH: "Philippines",
    SG: "Singapore",
    TH: "Thailand",
    TW: "Taiwan",
    US: "United States",
    VN: "Vietnam",
  },
};

function getRegionDisplayNames(language: AppLanguage): RegionDisplayNames | null {
  const intl = globalThis.Intl as
    | (typeof Intl & { DisplayNames?: RegionDisplayNamesConstructor })
    | undefined;
  const DisplayNames = intl?.DisplayNames;

  if (typeof DisplayNames !== "function") {
    return null;
  }

  try {
    return new DisplayNames([language], { type: "region" });
  } catch {
    return null;
  }
}

function compareCountryNames(first: CountryOption, second: CountryOption): number {
  if (first.name === second.name) return 0;
  return first.name > second.name ? 1 : -1;
}

function createCountryOptions(language: AppLanguage): CountryOption[] {
  const displayNames = getRegionDisplayNames(language);
  const options = COUNTRY_CODES.map((code) => ({
    code,
    name: displayNames?.of(code) ?? FALLBACK_COUNTRY_NAMES[language][code] ?? code,
  })).sort(compareCountryNames);
  const japan = options.find((country) => country.code === "JP");

  return japan ? [japan, ...options.filter((country) => country.code !== "JP")] : options;
}

type ProfileFormProps = {
  initialProfile?: LocalProfile | null;
  language: AppLanguage;
  onSubmit: (profile: LocalProfile) => Promise<void>;
};

export default function ProfileForm({
  initialProfile,
  language,
  onSubmit,
}: ProfileFormProps) {
  const copy = language === "ja"
    ? {
        name: "表示名",
        namePlaceholder: "例：田中 梨菜",
        nationality: "国籍",
        nationalityPlaceholder: "国を選択",
        bio: "自己紹介（任意）",
        bioPlaceholder: "好きなことや、一緒に楽しみたいこと",
        submit: "はじめる",
        countryTitle: "国籍を選択",
        countrySearch: "国名または国コードで検索",
        noCountries: "該当する国がありません",
        close: "閉じる",
        required: "表示名と国籍を入力してください",
      }
    : {
        name: "Display name",
        namePlaceholder: "e.g. Rina Tanaka",
        nationality: "Nationality",
        nationalityPlaceholder: "Choose a country",
        bio: "About you (optional)",
        bioPlaceholder: "What you enjoy and would like to share",
        submit: "Get started",
        countryTitle: "Choose your nationality",
        countrySearch: "Search by country or code",
        noCountries: "No countries found",
        close: "Close",
        required: "Enter a display name and nationality",
      };
  const [name, setName] = useState(initialProfile?.name ?? "");
  const [nationalityCode, setNationalityCode] = useState(
    initialProfile?.nationalityCode ?? "",
  );
  const [bio, setBio] = useState(initialProfile?.bio ?? "");
  const [countryPickerVisible, setCountryPickerVisible] = useState(false);
  const [countryQuery, setCountryQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const countries = useMemo(() => createCountryOptions(language), [language]);
  const selectedCountry = useMemo(
    () => countries.find((country) => country.code === nationalityCode),
    [countries, nationalityCode],
  );
  const filteredCountries = useMemo(() => {
    const normalizedQuery = countryQuery.trim().toLocaleLowerCase(language);
    if (!normalizedQuery) return countries;

    return countries.filter(
      (country) =>
        country.code.toLocaleLowerCase().includes(normalizedQuery) ||
        country.name.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [countries, countryQuery, language]);
  const valid = name.trim().length > 0 && nationalityCode.length === 2;

  const submit = async () => {
    if (!valid || submitting) {
      setShowValidation(true);
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        nationalityCode,
        bio: bio.trim(),
        completed: true,
        identityVerificationChoice:
          initialProfile?.identityVerificationChoice ?? null,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.form}>
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>{copy.name}</Text>
        <TextInput
          accessibilityLabel={copy.name}
          autoCapitalize="words"
          maxLength={50}
          onChangeText={setName}
          placeholder={copy.namePlaceholder}
          placeholderTextColor="#949494"
          returnKeyType="next"
          style={styles.input}
          value={name}
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>{copy.nationality}</Text>
        <Pressable
          accessibilityLabel={copy.nationality}
          accessibilityRole="button"
          onPress={() => setCountryPickerVisible(true)}
          style={({ pressed }) => [styles.select, pressed && styles.pressed]}
        >
          <Text style={selectedCountry ? styles.selectText : styles.placeholderText}>
            {selectedCountry
              ? `${selectedCountry.name} (${selectedCountry.code})`
              : copy.nationalityPlaceholder}
          </Text>
          <MaterialIcons color={TEXT_GRAY} name="keyboard-arrow-down" size={24} />
        </Pressable>
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>{copy.bio}</Text>
        <TextInput
          accessibilityLabel={copy.bio}
          maxLength={160}
          multiline
          onChangeText={setBio}
          placeholder={copy.bioPlaceholder}
          placeholderTextColor="#949494"
          style={[styles.input, styles.bioInput]}
          textAlignVertical="top"
          value={bio}
        />
        <Text style={styles.counter}>{bio.length}/160</Text>
      </View>

      {showValidation && !valid ? (
        <Text accessibilityRole="alert" style={styles.validation}>
          {copy.required}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        disabled={submitting}
        onPress={() => void submit()}
        style={({ pressed }) => [
          styles.submitButton,
          submitting && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.submitText}>{submitting ? "..." : copy.submit}</Text>
        {!submitting ? <MaterialIcons color="#ffffff" name="arrow-forward" size={20} /> : null}
      </Pressable>

      <Modal
        animationType="slide"
        onRequestClose={() => setCountryPickerVisible(false)}
        transparent
        visible={countryPickerVisible}
      >
        <Pressable
          accessibilityLabel={copy.close}
          onPress={() => setCountryPickerVisible(false)}
          style={styles.modalBackdrop}
        >
          <Pressable onPress={() => undefined} style={styles.countrySheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{copy.countryTitle}</Text>
              <Pressable
                accessibilityLabel={copy.close}
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => setCountryPickerVisible(false)}
                style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
              >
                <MaterialIcons color={TEXT_GRAY} name="close" size={24} />
              </Pressable>
            </View>
            <View style={styles.countrySearchField}>
              <MaterialIcons color={MUTED_GRAY} name="search" size={21} />
              <TextInput
                accessibilityLabel={copy.countrySearch}
                autoCapitalize="characters"
                onChangeText={setCountryQuery}
                placeholder={copy.countrySearch}
                placeholderTextColor="#949494"
                style={styles.countrySearchInput}
                value={countryQuery}
              />
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {filteredCountries.map((country) => {
                const selected = country.code === nationalityCode;
                return (
                  <Pressable
                    key={country.code}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => {
                      setNationalityCode(country.code);
                      setCountryQuery("");
                      setCountryPickerVisible(false);
                    }}
                    style={({ pressed }) => [
                      styles.countryOption,
                      selected && styles.countryOptionSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.countryName}>{country.name}</Text>
                    <Text style={styles.countryCode}>{country.code}</Text>
                    {selected ? (
                      <MaterialIcons color={YELLOW} name="check-circle" size={22} />
                    ) : null}
                  </Pressable>
                );
              })}
              {filteredCountries.length === 0 ? (
                <Text style={styles.noCountries}>{copy.noCountries}</Text>
              ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    width: "100%",
    gap: 16,
  },
  fieldGroup: {
    gap: 7,
  },
  label: {
    color: TEXT_GRAY,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0,
  },
  input: {
    width: "100%",
    minHeight: 52,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 8,
    backgroundColor: "#ffffff",
    color: TEXT_GRAY,
    fontSize: 15,
    letterSpacing: 0,
  },
  bioInput: {
    height: 88,
    paddingTop: 14,
    paddingBottom: 22,
  },
  counter: {
    position: "absolute",
    right: 10,
    bottom: 8,
    color: MUTED_GRAY,
    fontSize: 11,
    letterSpacing: 0,
  },
  select: {
    width: "100%",
    minHeight: 52,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 8,
    backgroundColor: "#ffffff",
  },
  selectText: {
    flex: 1,
    color: TEXT_GRAY,
    fontSize: 15,
    letterSpacing: 0,
  },
  placeholderText: {
    flex: 1,
    color: "#949494",
    fontSize: 15,
    letterSpacing: 0,
  },
  validation: {
    color: "#b42318",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0,
  },
  submitButton: {
    width: "100%",
    minHeight: 54,
    marginTop: 2,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    borderRadius: 8,
    backgroundColor: YELLOW,
  },
  submitText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(31, 31, 31, 0.35)",
  },
  countrySheet: {
    width: "100%",
    maxHeight: "70%",
    paddingTop: 18,
    paddingHorizontal: 20,
    paddingBottom: 28,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: "#ffffff",
  },
  sheetHeader: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sheetTitle: {
    color: TEXT_GRAY,
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 0,
  },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  countrySearchField: {
    minHeight: 46,
    marginBottom: 8,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 8,
    backgroundColor: "#ffffff",
  },
  countrySearchInput: {
    flex: 1,
    minHeight: 44,
    padding: 0,
    color: TEXT_GRAY,
    fontSize: 14,
    letterSpacing: 0,
  },
  countryOption: {
    minHeight: 52,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER_GRAY,
  },
  countryOptionSelected: {
    backgroundColor: "#fff9ec",
  },
  countryName: {
    flex: 1,
    color: TEXT_GRAY,
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: 0,
  },
  countryCode: {
    width: 40,
    color: MUTED_GRAY,
    fontSize: 12,
    letterSpacing: 0,
  },
  noCountries: {
    paddingVertical: 30,
    color: MUTED_GRAY,
    fontSize: 14,
    letterSpacing: 0,
    textAlign: "center",
  },
  disabled: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.72,
  },
});
