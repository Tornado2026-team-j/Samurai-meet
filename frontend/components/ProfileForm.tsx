import { useMemo, useState } from "react";
import { MaterialIcons } from "@expo/vector-icons";
import { getLocales } from "expo-localization";
import {
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { MONSTER_INPUT_LIMITS, type AppLanguage, type LocalProfile } from "../services/onboarding-contract";
import { resolveDefaultNationalityCode } from "../services/device-locale";
import DismissKeyboardView from "./DismissKeyboardView";
import { Button, colors, opacity, radius, typography } from "./ui";

const MAX_INTEREST_ITEMS = MONSTER_INPUT_LIMITS?.interestMax ?? 2;
const MAX_SKILL_ITEMS = MONSTER_INPUT_LIMITS?.skillMax ?? 2;
const JAPANESE_ITEM_LIMIT = MONSTER_INPUT_LIMITS?.jaItemCharacters ?? 15;
const ENGLISH_ITEM_LIMIT = MONSTER_INPUT_LIMITS?.enItemCharacters ?? 30;

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

type ProfileFormProps = {
  initialProfile?: LocalProfile | null;
  language: AppLanguage;
  onSubmit: (profile: LocalProfile) => Promise<void>;
  submitLabel?: string;
};

const LEGACY_TAG_LABELS: Record<string, Record<AppLanguage, string>> = {
  english_conversation: { ja: "英語で話す", en: "Speaking English" },
  photography: { ja: "写真を撮る", en: "Taking photos" },
  directions: { ja: "道案内", en: "Giving directions" },
  food_guiding: { ja: "グルメ案内", en: "Food guiding" },
  history: { ja: "歴史を説明する", en: "Explaining history" },
  cafe_hunting: { ja: "カフェ探し", en: "Finding cafes" },
  hidden_spots: { ja: "穴場紹介", en: "Hidden spots" },
  shopping: { ja: "買い物に付き合う", en: "Shopping together" },
  conversation: { ja: "人と話す", en: "Conversation" },
  planning: { ja: "スケジュールを考える", en: "Planning routes" },
  other: { ja: "その他", en: "Other" },
  food: { ja: "グルメ", en: "Food" },
  cafes: { ja: "カフェ", en: "Cafes" },
  shrines_temples: { ja: "神社・寺", en: "Shrines and temples" },
  anime: { ja: "アニメ", en: "Anime" },
  games: { ja: "ゲーム", en: "Games" },
  fashion: { ja: "ファッション", en: "Fashion" },
  music: { ja: "音楽", en: "Music" },
  nature: { ja: "自然", en: "Nature" },
  night_views: { ja: "夜景", en: "Night views" },
  walking: { ja: "散歩", en: "Walking" },
  traditional_culture: { ja: "伝統文化", en: "Traditional culture" },
  photos: { ja: "写真", en: "Photography" },
};

function normalizeProfileItems(items: string[] | undefined, language: AppLanguage, maxItems: number): string[] {
  return (items ?? [])
    .map((item) => LEGACY_TAG_LABELS[item]?.[language] ?? item)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function createInitialItems(items: string[] | undefined, language: AppLanguage, maxItems: number, minItems: number): string[] {
  const normalized = normalizeProfileItems(items, language, maxItems);
  while (normalized.length < minItems) normalized.push("");
  return normalized;
}

function defaultNationalityCode(language: AppLanguage): string {
  try {
    return resolveDefaultNationalityCode(language, COUNTRY_CODES, getLocales());
  } catch {
    return resolveDefaultNationalityCode(language, COUNTRY_CODES, []);
  }
}

function sanitizeMonsterItem(value: string): string {
  return value.replace(/[\r\n,、]/gu, "").trimStart();
}

function normalizedDuplicateKey(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

function hasDuplicateItems(items: string[]): boolean {
  const seen = new Set<string>();
  for (const item of items.map(normalizedDuplicateKey).filter(Boolean)) {
    if (seen.has(item)) return true;
    seen.add(item);
  }
  return false;
}

export default function ProfileForm({
  initialProfile,
  language,
  onSubmit,
  submitLabel,
}: ProfileFormProps) {
  const itemLimit = language === "ja" ? JAPANESE_ITEM_LIMIT : ENGLISH_ITEM_LIMIT;
  const copy = language === "ja"
    ? {
        name: "表示名",
        namePlaceholder: "例：田中 梨菜",
        nationality: "国籍",
        nationalityPlaceholder: "国を選択",
        monsterTitle: "あなたらしさを教えてください",
        monsterDescription: "入力した内容をもとに、あなただけのモンスターを作ります。一つの欄には、一つのことを短い言葉で入力してください。",
        interests: "好きなこと（1〜2個）",
        skills: "得意なこと（0〜2個）",
        interestPlaceholder: "例：カフェ巡り",
        skillPlaceholder: "例：写真を撮ること",
        addOneMore: "＋ もう1つ追加",
        remove: "削除",
        submit: "この内容でモンスターを作る",
        countryTitle: "国籍を選択",
        countrySearch: "国名で検索",
        noCountries: "該当する国がありません",
        close: "閉じる",
        required: "表示名・国籍・好きなことを1つ以上入力してください",
        duplicate: "同じ内容は登録できません",
        invalidSeparator: "改行・カンマ区切りでの複数入力はできません",
        overLimit: `${itemLimit}文字以内で入力してください`,
        submitError: "プロフィールを保存できませんでした。時間をおいて再試行してください。",
      }
    : {
        name: "Display name",
        namePlaceholder: "e.g. Rina Tanaka",
        nationality: "Nationality",
        nationalityPlaceholder: "Choose a country",
        monsterTitle: "Tell us what makes you you",
        monsterDescription: "We will create your personal monster from these details. Add one short thing in each field.",
        interests: "Things you like (1-2)",
        skills: "Things you are good at (0-2)",
        interestPlaceholder: "e.g. Cafe hopping",
        skillPlaceholder: "e.g. Taking photos",
        addOneMore: "+ Add one more",
        remove: "Remove",
        submit: "Create my monster",
        countryTitle: "Choose your nationality",
        countrySearch: "Search countries",
        noCountries: "No countries found",
        close: "Close",
        required: "Enter a display name, nationality, and at least one thing you like",
        duplicate: "Duplicate entries cannot be used",
        invalidSeparator: "Use one field per item. New lines and commas are not allowed",
        overLimit: `Keep each item within ${itemLimit} characters`,
        submitError: "Could not save your profile. Please try again.",
      };
  const [name, setName] = useState(initialProfile?.name ?? "");
  const [nationalityCode, setNationalityCode] = useState(() => {
    const storedCode = initialProfile?.nationalityCode?.trim().toUpperCase();
    return storedCode || defaultNationalityCode(language);
  });
  const [interestItems, setInterestItems] = useState(() =>
    createInitialItems(initialProfile?.monsterSeed?.interestTags, language, MAX_INTEREST_ITEMS, 1),
  );
  const [skillItems, setSkillItems] = useState(() =>
    createInitialItems(initialProfile?.monsterSeed?.skillTags, language, MAX_SKILL_ITEMS, 0),
  );
  const [separatorError, setSeparatorError] = useState<string | null>(null);
  const [countryPickerVisible, setCountryPickerVisible] = useState(false);
  const [countryQuery, setCountryQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
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
  const cleanedInterestItems = interestItems.map((item) => item.trim()).filter(Boolean);
  const cleanedSkillItems = skillItems.map((item) => item.trim()).filter(Boolean);
  const allMonsterItems = [...cleanedInterestItems, ...cleanedSkillItems];
  const duplicateError = hasDuplicateItems(allMonsterItems);
  const lengthError = [...interestItems, ...skillItems].some((item) => item.trim().length > itemLimit);
  const valid =
    name.trim().length > 0 &&
    nationalityCode.length === 2 &&
    cleanedInterestItems.length >= 1 &&
    !duplicateError &&
    !lengthError;

  const updateInterestItem = (index: number, value: string) => {
    if (/[\r\n,、]/u.test(value)) {
      setSeparatorError(copy.invalidSeparator);
    } else {
      setSeparatorError(null);
    }
    setInterestItems((current) => current.map((item, itemIndex) => (
      itemIndex === index ? sanitizeMonsterItem(value) : item
    )));
  };

  const updateSkillItem = (index: number, value: string) => {
    if (/[\r\n,、]/u.test(value)) {
      setSeparatorError(copy.invalidSeparator);
    } else {
      setSeparatorError(null);
    }
    setSkillItems((current) => current.map((item, itemIndex) => (
      itemIndex === index ? sanitizeMonsterItem(value) : item
    )));
  };

  const addInterestItem = () => {
    setInterestItems((current) => current.length >= MAX_INTEREST_ITEMS ? current : [...current, ""]);
  };

  const addSkillItem = () => {
    setSkillItems((current) => current.length >= MAX_SKILL_ITEMS ? current : [...current, ""]);
  };

  const removeInterestItem = (index: number) => {
    setInterestItems((current) => {
      if (current.length <= 1) return current;
      return current.filter((_item, itemIndex) => itemIndex !== index);
    });
  };

  const removeSkillItem = (index: number) => {
    setSkillItems((current) => current.filter((_item, itemIndex) => itemIndex !== index));
  };

  const closeCountryPicker = () => {
    Keyboard.dismiss();
    setCountryPickerVisible(false);
  };

  const openCountryPicker = () => {
    Keyboard.dismiss();
    setCountryPickerVisible(true);
  };

  const selectCountry = (countryCode: string) => {
    Keyboard.dismiss();
    setNationalityCode(countryCode);
    setCountryQuery("");
    setCountryPickerVisible(false);
  };

  const submit = async () => {
    Keyboard.dismiss();
    if (!valid || submitting) {
      setShowValidation(true);
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit({
        name: name.trim(),
        nationalityCode,
        monsterSeed: {
          skillTags: cleanedSkillItems,
          interestTags: cleanedInterestItems,
          freeText: "",
        },
        completed: true,
        identityVerificationChoice:
          initialProfile?.identityVerificationChoice ?? null,
      });
    } catch {
      setSubmitError(copy.submitError);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DismissKeyboardView style={styles.form}>
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>{copy.name}</Text>
        <TextInput
          accessibilityLabel={copy.name}
          autoCapitalize="words"
          maxLength={50}
          onChangeText={setName}
          placeholder={copy.namePlaceholder}
          placeholderTextColor={colors.text.muted}
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
          onPress={openCountryPicker}
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
          <MaterialIcons color={colors.text.secondary} name="keyboard-arrow-down" size={24} />
        </Pressable>
      </View>

      <View style={styles.monsterSection}>
        <View style={styles.monsterHeader}>
          <Text style={styles.monsterTitle}>{copy.monsterTitle}</Text>
          <Text style={styles.monsterDescription}>{copy.monsterDescription}</Text>
        </View>

        <MonsterItemGroup
          addLabel={copy.addOneMore}
          itemLimit={itemLimit}
          items={interestItems}
          onAdd={addInterestItem}
          onChange={updateInterestItem}
          onRemove={removeInterestItem}
          placeholder={copy.interestPlaceholder}
          required
          removeLabel={copy.remove}
          showValidation={showValidation}
          title={copy.interests}
        />

        <MonsterItemGroup
          addLabel={copy.addOneMore}
          itemLimit={itemLimit}
          items={skillItems}
          onAdd={addSkillItem}
          onChange={updateSkillItem}
          onRemove={removeSkillItem}
          placeholder={copy.skillPlaceholder}
          removableFirstItem
          removeLabel={copy.remove}
          showValidation={showValidation}
          title={copy.skills}
        />

        {separatorError ? (
          <Text accessibilityRole="alert" style={styles.validation}>
            {separatorError}
          </Text>
        ) : null}
        {duplicateError ? (
          <Text accessibilityRole="alert" style={styles.validation}>
            {copy.duplicate}
          </Text>
        ) : null}
        {lengthError ? (
          <Text accessibilityRole="alert" style={styles.validation}>
            {copy.overLimit}
          </Text>
        ) : null}
      </View>

      {showValidation && !valid && !duplicateError && !lengthError ? (
        <Text accessibilityRole="alert" style={styles.validation}>
          {copy.required}
        </Text>
      ) : null}

      {submitError ? (
        <Text accessibilityRole="alert" style={styles.validation}>
          {submitError}
        </Text>
      ) : null}

      <View style={styles.fixedSubmitSpacer} />
      <View style={styles.fixedSubmit}>
        <Button
          disabled={submitting}
          fullWidth
          iconRight={
            <MaterialIcons
              color={colors.text.inverse}
              name="auto-awesome"
              size={20}
            />
          }
          loading={submitting}
          onPress={() => void submit()}
          size="lg"
          style={styles.submitButton}
          textStyle={styles.submitText}
        >
          {submitLabel ?? copy.submit}
        </Button>
      </View>

      <Modal
        animationType="slide"
        onRequestClose={closeCountryPicker}
        presentationStyle="overFullScreen"
        transparent
        visible={countryPickerVisible}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBackdrop}
        >
          <Pressable
            accessibilityLabel={copy.close}
            onPress={closeCountryPicker}
            style={styles.backdropDismissArea}
          />
          <View style={styles.countrySheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{copy.countryTitle}</Text>
              <Pressable
                accessibilityLabel={copy.close}
                accessibilityRole="button"
                hitSlop={8}
                onPress={closeCountryPicker}
                style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
              >
                <MaterialIcons color={colors.text.secondary} name="close" size={24} />
              </Pressable>
            </View>
            <View style={styles.countrySearchField}>
              <MaterialIcons color={colors.text.subtle} name="search" size={21} />
              <TextInput
                accessibilityLabel={copy.countrySearch}
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
                onChangeText={setCountryQuery}
                placeholder={copy.countrySearch}
                placeholderTextColor={colors.text.muted}
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
                    onPress={() => selectCountry(country.code)}
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
                      <MaterialIcons color={colors.brand.gold} name="check-circle" size={22} />
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
    </DismissKeyboardView>
  );
}

function MonsterItemGroup({
  addLabel,
  itemLimit,
  items,
  onAdd,
  onChange,
  onRemove,
  placeholder,
  removableFirstItem = false,
  required = false,
  removeLabel,
  showValidation,
  title,
}: {
  addLabel: string;
  itemLimit: number;
  items: string[];
  onAdd: () => void;
  onChange: (index: number, value: string) => void;
  onRemove: (index: number) => void;
  placeholder: string;
  removableFirstItem?: boolean;
  required?: boolean;
  removeLabel: string;
  showValidation: boolean;
  title: string;
}) {
  const canAdd = items.length < 2;

  return (
    <View style={styles.itemGroup}>
      <Text style={styles.itemGroupTitle}>{title}</Text>
      {items.map((item, index) => {
        const count = item.trim().length;
        const overLimit = count > itemLimit;
        const showEmptyError = showValidation && required && index === 0 && count === 0;

        return (
          <View key={index} style={styles.monsterItemRow}>
            <View style={styles.monsterInputWrap}>
              <TextInput
                accessibilityLabel={`${title} ${index + 1}`}
                autoCapitalize="sentences"
                autoCorrect={false}
                blurOnSubmit
                multiline={false}
                onChangeText={(value) => onChange(index, value)}
                placeholder={placeholder}
                placeholderTextColor={colors.text.muted}
                returnKeyType="done"
                style={[
                  styles.input,
                  styles.monsterItemInput,
                  (overLimit || showEmptyError) && styles.inputError,
                ]}
                value={item}
              />
              <Text style={[styles.itemCounter, overLimit && styles.counterError]}>
                {count} / {itemLimit}
              </Text>
            </View>
            <View style={styles.removeItemSlot}>
              {index > 0 || removableFirstItem ? (
                <Pressable
                  accessibilityLabel={removeLabel}
                  accessibilityRole="button"
                  onPress={() => onRemove(index)}
                  style={({ pressed }) => [styles.removeItemButton, pressed && styles.pressed]}
                >
                  <MaterialIcons color={colors.text.subtle} name="close" size={18} />
                </Pressable>
              ) : null}
            </View>
          </View>
        );
      })}
      {canAdd ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAdd}
          style={({ pressed }) => [styles.addItemButton, pressed && styles.pressed]}
        >
          <Text style={styles.addItemText}>{addLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    width: "100%",
    position: "relative",
    gap: 16,
  },
  fieldGroup: {
    gap: 7,
  },
  label: {
    color: colors.text.secondary,
    ...typography.caption,
  },
  input: {
    width: "100%",
    minHeight: 52,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radius.sm,
    backgroundColor: colors.surface.default,
    color: colors.text.secondary,
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
    color: colors.text.secondary,
    ...typography.subheading,
    fontSize: 17,
    fontWeight: "800",
  },
  monsterDescription: {
    color: colors.text.subtle,
    ...typography.small,
    fontWeight: "400",
    lineHeight: 18,
  },
  itemGroup: {
    gap: 9,
  },
  itemGroupTitle: {
    color: colors.text.secondary,
    ...typography.caption,
  },
  monsterItemRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  monsterInputWrap: {
    flex: 1,
    minWidth: 0,
  },
  removeItemSlot: {
    width: 36,
    height: 36,
    flexShrink: 0,
  },
  monsterItemInput: {
    paddingRight: 72,
  },
  inputError: {
    borderColor: colors.state.danger,
    backgroundColor: "#fff8f8",
  },
  itemCounter: {
    position: "absolute",
    right: 12,
    top: 18,
    color: colors.text.subtle,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0,
  },
  counterError: {
    color: colors.state.danger,
  },
  addItemButton: {
    minHeight: 36,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  addItemText: {
    color: colors.brand.gold,
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0,
  },
  removeItemButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: 18,
    backgroundColor: colors.surface.default,
  },
  select: {
    width: "100%",
    minHeight: 52,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radius.sm,
    backgroundColor: colors.surface.default,
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
    color: colors.text.secondary,
    fontSize: 20,
    letterSpacing: 0,
    textAlign: "center",
  },
  selectText: {
    flex: 1,
    color: colors.text.secondary,
    fontSize: 15,
    letterSpacing: 0,
  },
  placeholderText: {
    flex: 1,
    color: colors.text.muted,
    fontSize: 15,
    letterSpacing: 0,
  },
  validation: {
    color: colors.state.danger,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0,
  },
  fixedSubmitSpacer: {
    height: 86,
  },
  fixedSubmit: {
    position: "absolute",
    right: 0,
    bottom: 0,
    left: 0,
    paddingTop: 12,
    paddingHorizontal: 0,
    backgroundColor: "rgba(255, 255, 255, 0.94)",
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
    borderRadius: radius.sm,
  },
  submitText: {
    color: colors.text.inverse,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: colors.overlay.sheet,
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
    backgroundColor: colors.surface.default,
  },
  sheetHeader: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sheetTitle: {
    color: colors.text.secondary,
    ...typography.heading,
    fontWeight: "800",
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
    borderColor: colors.border.default,
    borderRadius: radius.sm,
    backgroundColor: colors.surface.default,
  },
  countrySearchInput: {
    flex: 1,
    minHeight: 44,
    padding: 0,
    color: colors.text.secondary,
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
    borderBottomColor: colors.border.default,
  },
  countryOptionSelected: {
    backgroundColor: "#fff9ec",
  },
  countryFlag: {
    width: 30,
    color: colors.text.secondary,
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
    color: colors.text.secondary,
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: 0,
  },
  countrySubname: {
    color: colors.text.subtle,
    fontSize: 12,
    letterSpacing: 0,
  },
  noCountries: {
    paddingVertical: 30,
    color: colors.text.subtle,
    fontSize: 14,
    letterSpacing: 0,
    textAlign: "center",
  },
  disabled: {
    opacity: opacity.disabled,
  },
  pressed: {
    opacity: opacity.pressed,
  },
});
