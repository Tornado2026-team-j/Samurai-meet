import { useMemo, useState } from "react";
import { MaterialIcons } from "@expo/vector-icons";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
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
const MAX_TAGS_PER_CATEGORY = 5;
const MIN_TOTAL_TAGS = 3;
const FREE_TEXT_LIMIT = 150;

const COUNTRY_CODES = "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" ");

type CountryOption = {
  code: string;
  name: string;
  fallbackName: string;
  searchText: string;
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

const ENGLISH_COUNTRY_NAMES: Record<string, string> = {
  AD: "Andorra", AE: "United Arab Emirates", AF: "Afghanistan", AG: "Antigua and Barbuda",
  AI: "Anguilla", AL: "Albania", AM: "Armenia", AO: "Angola", AQ: "Antarctica",
  AR: "Argentina", AS: "American Samoa", AT: "Austria", AU: "Australia", AW: "Aruba",
  AX: "Aland Islands", AZ: "Azerbaijan", BA: "Bosnia and Herzegovina", BB: "Barbados",
  BD: "Bangladesh", BE: "Belgium", BF: "Burkina Faso", BG: "Bulgaria", BH: "Bahrain",
  BI: "Burundi", BJ: "Benin", BL: "Saint Barthelemy", BM: "Bermuda", BN: "Brunei",
  BO: "Bolivia", BQ: "Caribbean Netherlands", BR: "Brazil", BS: "Bahamas", BT: "Bhutan",
  BV: "Bouvet Island", BW: "Botswana", BY: "Belarus", BZ: "Belize", CA: "Canada",
  CC: "Cocos Islands", CD: "Congo - Kinshasa", CF: "Central African Republic",
  CG: "Congo - Brazzaville", CH: "Switzerland", CI: "Cote d'Ivoire", CK: "Cook Islands",
  CL: "Chile", CM: "Cameroon", CN: "China", CO: "Colombia", CR: "Costa Rica",
  CU: "Cuba", CV: "Cape Verde", CW: "Curacao", CX: "Christmas Island", CY: "Cyprus",
  CZ: "Czechia", DE: "Germany", DJ: "Djibouti", DK: "Denmark", DM: "Dominica",
  DO: "Dominican Republic", DZ: "Algeria", EC: "Ecuador", EE: "Estonia", EG: "Egypt",
  EH: "Western Sahara", ER: "Eritrea", ES: "Spain", ET: "Ethiopia", FI: "Finland",
  FJ: "Fiji", FK: "Falkland Islands", FM: "Micronesia", FO: "Faroe Islands",
  FR: "France", GA: "Gabon", GB: "United Kingdom", GD: "Grenada", GE: "Georgia",
  GF: "French Guiana", GG: "Guernsey", GH: "Ghana", GI: "Gibraltar", GL: "Greenland",
  GM: "Gambia", GN: "Guinea", GP: "Guadeloupe", GQ: "Equatorial Guinea", GR: "Greece",
  GS: "South Georgia and South Sandwich Islands", GT: "Guatemala", GU: "Guam",
  GW: "Guinea-Bissau", GY: "Guyana", HK: "Hong Kong", HM: "Heard and McDonald Islands",
  HN: "Honduras", HR: "Croatia", HT: "Haiti", HU: "Hungary", ID: "Indonesia",
  IE: "Ireland", IL: "Israel", IM: "Isle of Man", IN: "India",
  IO: "British Indian Ocean Territory", IQ: "Iraq", IR: "Iran", IS: "Iceland",
  IT: "Italy", JE: "Jersey", JM: "Jamaica", JO: "Jordan", JP: "Japan", KE: "Kenya",
  KG: "Kyrgyzstan", KH: "Cambodia", KI: "Kiribati", KM: "Comoros",
  KN: "Saint Kitts and Nevis", KP: "North Korea", KR: "South Korea", KW: "Kuwait",
  KY: "Cayman Islands", KZ: "Kazakhstan", LA: "Laos", LB: "Lebanon", LC: "Saint Lucia",
  LI: "Liechtenstein", LK: "Sri Lanka", LR: "Liberia", LS: "Lesotho", LT: "Lithuania",
  LU: "Luxembourg", LV: "Latvia", LY: "Libya", MA: "Morocco", MC: "Monaco",
  MD: "Moldova", ME: "Montenegro", MF: "Saint Martin", MG: "Madagascar",
  MH: "Marshall Islands", MK: "North Macedonia", ML: "Mali", MM: "Myanmar",
  MN: "Mongolia", MO: "Macao", MP: "Northern Mariana Islands", MQ: "Martinique",
  MR: "Mauritania", MS: "Montserrat", MT: "Malta", MU: "Mauritius", MV: "Maldives",
  MW: "Malawi", MX: "Mexico", MY: "Malaysia", MZ: "Mozambique", NA: "Namibia",
  NC: "New Caledonia", NE: "Niger", NF: "Norfolk Island", NG: "Nigeria",
  NI: "Nicaragua", NL: "Netherlands", NO: "Norway", NP: "Nepal", NR: "Nauru",
  NU: "Niue", NZ: "New Zealand", OM: "Oman", PA: "Panama", PE: "Peru",
  PF: "French Polynesia", PG: "Papua New Guinea", PH: "Philippines", PK: "Pakistan",
  PL: "Poland", PM: "Saint Pierre and Miquelon", PN: "Pitcairn Islands",
  PR: "Puerto Rico", PS: "Palestine", PT: "Portugal", PW: "Palau", PY: "Paraguay",
  QA: "Qatar", RE: "Reunion", RO: "Romania", RS: "Serbia", RU: "Russia", RW: "Rwanda",
  SA: "Saudi Arabia", SB: "Solomon Islands", SC: "Seychelles", SD: "Sudan",
  SE: "Sweden", SG: "Singapore", SH: "Saint Helena", SI: "Slovenia",
  SJ: "Svalbard and Jan Mayen", SK: "Slovakia", SL: "Sierra Leone", SM: "San Marino",
  SN: "Senegal", SO: "Somalia", SR: "Suriname", SS: "South Sudan",
  ST: "Sao Tome and Principe", SV: "El Salvador", SX: "Sint Maarten", SY: "Syria",
  SZ: "Eswatini", TC: "Turks and Caicos Islands", TD: "Chad",
  TF: "French Southern Territories", TG: "Togo", TH: "Thailand", TJ: "Tajikistan",
  TK: "Tokelau", TL: "Timor-Leste", TM: "Turkmenistan", TN: "Tunisia", TO: "Tonga",
  TR: "Turkey", TT: "Trinidad and Tobago", TV: "Tuvalu", TW: "Taiwan", TZ: "Tanzania",
  UA: "Ukraine", UG: "Uganda", UM: "U.S. Outlying Islands", US: "United States",
  UY: "Uruguay", UZ: "Uzbekistan", VA: "Vatican City", VC: "Saint Vincent and the Grenadines",
  VE: "Venezuela", VG: "British Virgin Islands", VI: "U.S. Virgin Islands",
  VN: "Vietnam", VU: "Vanuatu", WF: "Wallis and Futuna", WS: "Samoa", YE: "Yemen",
  YT: "Mayotte", ZA: "South Africa", ZM: "Zambia", ZW: "Zimbabwe",
};

function countryCodeToFlag(countryCode: string): string {
  const normalizedCode = countryCode.trim().toUpperCase();

  if (!/^[A-Z]{2}$/.test(normalizedCode)) return "";

  return String.fromCodePoint(
    ...[...normalizedCode].map((character) => character.charCodeAt(0) + 127397),
  );
}

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
    fallbackName: ENGLISH_COUNTRY_NAMES[code] ?? code,
    name: displayNames?.of(code) ?? FALLBACK_COUNTRY_NAMES[language][code] ?? ENGLISH_COUNTRY_NAMES[code] ?? code,
    searchText: [
      code,
      displayNames?.of(code),
      FALLBACK_COUNTRY_NAMES.ja[code],
      FALLBACK_COUNTRY_NAMES.en[code],
      ENGLISH_COUNTRY_NAMES[code],
    ].filter(Boolean).join(" ").toLocaleLowerCase(),
  })).sort(compareCountryNames);
  const japan = options.find((country) => country.code === "JP");

  return japan ? [japan, ...options.filter((country) => country.code !== "JP")] : options;
}

type TagOption = {
  id: string;
  ja: string;
  en: string;
};

const SKILL_TAGS: TagOption[] = [
  { id: "english_conversation", ja: "英語で話す", en: "Speaking English" },
  { id: "photography", ja: "写真を撮る", en: "Taking photos" },
  { id: "directions", ja: "道案内", en: "Giving directions" },
  { id: "food_guiding", ja: "グルメ案内", en: "Food guiding" },
  { id: "history", ja: "歴史を説明する", en: "Explaining history" },
  { id: "cafe_hunting", ja: "カフェ探し", en: "Finding cafes" },
  { id: "hidden_spots", ja: "穴場紹介", en: "Hidden spots" },
  { id: "shopping", ja: "買い物に付き合う", en: "Shopping together" },
  { id: "conversation", ja: "人と話す", en: "Conversation" },
  { id: "planning", ja: "スケジュールを考える", en: "Planning routes" },
  { id: "other", ja: "その他", en: "Other" },
];

const INTEREST_TAGS: TagOption[] = [
  { id: "food", ja: "グルメ", en: "Food" },
  { id: "cafes", ja: "カフェ", en: "Cafes" },
  { id: "shrines_temples", ja: "神社・寺", en: "Shrines and temples" },
  { id: "anime", ja: "アニメ", en: "Anime" },
  { id: "games", ja: "ゲーム", en: "Games" },
  { id: "fashion", ja: "ファッション", en: "Fashion" },
  { id: "music", ja: "音楽", en: "Music" },
  { id: "nature", ja: "自然", en: "Nature" },
  { id: "night_views", ja: "夜景", en: "Night views" },
  { id: "walking", ja: "散歩", en: "Walking" },
  { id: "traditional_culture", ja: "伝統文化", en: "Traditional culture" },
  { id: "photos", ja: "写真", en: "Photography" },
  { id: "other", ja: "その他", en: "Other" },
];

function tagLabel(tag: TagOption, language: AppLanguage): string {
  return language === "ja" ? tag.ja : tag.en;
}

function toggleTag(tags: string[], tagID: string): string[] {
  if (tags.includes(tagID)) return tags.filter((tag) => tag !== tagID);
  if (tags.length >= MAX_TAGS_PER_CATEGORY) return tags;
  return [...tags, tagID];
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
        monsterTitle: "得意なこと・好きなこと",
        monsterDescription: "あなたらしいモンスターの作成や、案内内容とのマッチングに使用します。",
        skillTags: "得意なことを選んでください",
        interestTags: "好きなことを選んでください",
        freeText: "選択肢だけでは伝わらない好きなこと・得意なことがあれば、少しだけ書いてください。",
        freeTextPlaceholder: "例：路地裏の小さな喫茶店や、写真映えする散歩道を探すのが好きです。",
        submit: "はじめる",
        countryTitle: "国籍を選択",
        countrySearch: "国名で検索",
        noCountries: "該当する国がありません",
        close: "閉じる",
        tagLimit: "各カテゴリ最大5個まで選択できます",
        required: "表示名・国籍・タグを合計3つ以上入力してください",
      }
    : {
        name: "Display name",
        namePlaceholder: "e.g. Rina Tanaka",
        nationality: "Nationality",
        nationalityPlaceholder: "Choose a country",
        monsterTitle: "Skills and Interests",
        monsterDescription: "Used to create your personal monster and match you with guide requests.",
        skillTags: "Choose what you are good at",
        interestTags: "Choose what you like",
        freeText: "Add anything your selected tags do not fully explain.",
        freeTextPlaceholder: "e.g. I enjoy finding quiet local cafes and photogenic walking routes.",
        submit: "Get started",
        countryTitle: "Choose your nationality",
        countrySearch: "Search countries",
        noCountries: "No countries found",
        close: "Close",
        tagLimit: "Choose up to 5 in each category",
        required: "Enter a display name, nationality, and at least 3 tags",
      };
  const [name, setName] = useState(initialProfile?.name ?? "");
  const [nationalityCode, setNationalityCode] = useState(
    initialProfile?.nationalityCode ?? "",
  );
  const [skillTags, setSkillTags] = useState(initialProfile?.monsterSeed?.skillTags ?? []);
  const [interestTags, setInterestTags] = useState(initialProfile?.monsterSeed?.interestTags ?? []);
  const [freeText, setFreeText] = useState(initialProfile?.monsterSeed?.freeText ?? "");
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
      (country) => country.searchText.includes(normalizedQuery),
    );
  }, [countries, countryQuery, language]);
  const totalSelectedTags = skillTags.length + interestTags.length;
  const valid =
    name.trim().length > 0 &&
    nationalityCode.length === 2 &&
    totalSelectedTags >= MIN_TOTAL_TAGS;

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
        monsterSeed: {
          skillTags,
          interestTags,
          freeText: freeText.trim(),
        },
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
          {selectedCountry ? (
            <View style={styles.selectedCountry}>
              <Text style={styles.selectedFlag}>{countryCodeToFlag(selectedCountry.code)}</Text>
              <Text numberOfLines={1} style={styles.selectText}>{selectedCountry.name}</Text>
            </View>
          ) : (
            <Text style={styles.placeholderText}>{copy.nationalityPlaceholder}</Text>
          )}
          <MaterialIcons color={TEXT_GRAY} name="keyboard-arrow-down" size={24} />
        </Pressable>
      </View>

      <View style={styles.monsterSection}>
        <View style={styles.monsterHeader}>
          <Text style={styles.monsterTitle}>{copy.monsterTitle}</Text>
          <Text style={styles.monsterDescription}>{copy.monsterDescription}</Text>
        </View>

        <TagGroup
          language={language}
          onToggle={(tagID) => setSkillTags((current) => toggleTag(current, tagID))}
          options={SKILL_TAGS}
          selectedTags={skillTags}
          title={copy.skillTags}
        />

        <TagGroup
          language={language}
          onToggle={(tagID) => setInterestTags((current) => toggleTag(current, tagID))}
          options={INTEREST_TAGS}
          selectedTags={interestTags}
          title={copy.interestTags}
        />

        <Text style={styles.tagHint}>{copy.tagLimit}</Text>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{copy.freeText}</Text>
          <TextInput
            accessibilityLabel={copy.freeText}
            maxLength={FREE_TEXT_LIMIT}
            multiline
            onChangeText={setFreeText}
            placeholder={copy.freeTextPlaceholder}
            placeholderTextColor="#949494"
            style={[styles.input, styles.freeTextInput]}
            textAlignVertical="top"
            value={freeText}
          />
          <Text style={styles.counter}>{freeText.length}/{FREE_TEXT_LIMIT}</Text>
        </View>
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
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBackdrop}
        >
          <Pressable
            accessibilityLabel={copy.close}
            onPress={() => setCountryPickerVisible(false)}
            style={styles.backdropDismissArea}
          />
          <View style={styles.countrySheet}>
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
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
                onChangeText={setCountryQuery}
                placeholder={copy.countrySearch}
                placeholderTextColor="#949494"
                style={styles.countrySearchInput}
                value={countryQuery}
              />
            </View>
            <FlatList
              data={filteredCountries}
              keyboardShouldPersistTaps="handled"
              keyExtractor={(country) => country.code}
              ListEmptyComponent={<Text style={styles.noCountries}>{copy.noCountries}</Text>}
              renderItem={({ item: country }) => {
                const selected = country.code === nationalityCode;
                return (
                  <Pressable
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
                    <Text style={styles.countryFlag}>{countryCodeToFlag(country.code)}</Text>
                    <View style={styles.countryCopy}>
                      <Text numberOfLines={1} style={styles.countryName}>{country.name}</Text>
                      {country.fallbackName !== country.name ? (
                        <Text numberOfLines={1} style={styles.countrySubname}>{country.fallbackName}</Text>
                      ) : null}
                    </View>
                    {selected ? (
                      <MaterialIcons color={YELLOW} name="check-circle" size={22} />
                    ) : null}
                  </Pressable>
                );
              }}
              showsVerticalScrollIndicator={false}
              style={styles.countryList}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function TagGroup({
  language,
  onToggle,
  options,
  selectedTags,
  title,
}: {
  language: AppLanguage;
  onToggle: (tagID: string) => void;
  options: TagOption[];
  selectedTags: string[];
  title: string;
}) {
  const maxReached = selectedTags.length >= MAX_TAGS_PER_CATEGORY;

  return (
    <View style={styles.tagGroup}>
      <Text style={styles.tagGroupTitle}>{title}</Text>
      <View style={styles.tagGrid}>
        {options.map((tag) => {
          const selected = selectedTags.includes(tag.id);
          const disabled = maxReached && !selected;

          return (
            <Pressable
              key={tag.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected, disabled }}
              disabled={disabled}
              onPress={() => onToggle(tag.id)}
              style={({ pressed }) => [
                styles.tagChip,
                selected && styles.tagChipSelected,
                disabled && styles.tagChipDisabled,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.tagChipText, selected && styles.tagChipTextSelected]}>
                {tagLabel(tag, language)}
              </Text>
              {selected ? <MaterialIcons color="#ffffff" name="check" size={15} /> : null}
            </Pressable>
          );
        })}
      </View>
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
  monsterSection: {
    gap: 14,
    paddingTop: 2,
  },
  monsterHeader: {
    gap: 5,
  },
  monsterTitle: {
    color: TEXT_GRAY,
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: 0,
  },
  monsterDescription: {
    color: MUTED_GRAY,
    fontSize: 12,
    lineHeight: 18,
    letterSpacing: 0,
  },
  tagGroup: {
    gap: 9,
  },
  tagGroupTitle: {
    color: TEXT_GRAY,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0,
  },
  tagGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tagChip: {
    minHeight: 36,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 18,
    backgroundColor: "#ffffff",
  },
  tagChipSelected: {
    borderColor: YELLOW,
    backgroundColor: YELLOW,
  },
  tagChipDisabled: {
    opacity: 0.45,
  },
  tagChipText: {
    color: TEXT_GRAY,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0,
  },
  tagChipTextSelected: {
    color: "#ffffff",
  },
  tagHint: {
    marginTop: -3,
    color: MUTED_GRAY,
    fontSize: 11,
    letterSpacing: 0,
  },
  freeTextInput: {
    height: 94,
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
  selectedCountry: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  selectedFlag: {
    width: 26,
    color: TEXT_GRAY,
    fontSize: 20,
    letterSpacing: 0,
    textAlign: "center",
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
  backdropDismissArea: {
    flex: 1,
  },
  countrySheet: {
    width: "100%",
    height: "76%",
    maxHeight: 640,
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
  countryList: {
    flex: 1,
  },
  countryOption: {
    minHeight: 58,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER_GRAY,
  },
  countryOptionSelected: {
    backgroundColor: "#fff9ec",
  },
  countryFlag: {
    width: 30,
    color: TEXT_GRAY,
    fontSize: 22,
    letterSpacing: 0,
    textAlign: "center",
  },
  countryCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  countryName: {
    color: TEXT_GRAY,
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: 0,
  },
  countrySubname: {
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
