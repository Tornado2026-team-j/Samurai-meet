import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Header, colors, radius } from "../../components/ui";
import { loadLanguage, subscribeLanguage, type AppLanguage } from "../../services/onboarding";

type LegalDocument = "terms" | "privacy" | "safety";
type LegalContent = { title: string; updated: string; sections: ReadonlyArray<readonly [string, string]> };

const DOCUMENTS: Record<AppLanguage, Record<LegalDocument, LegalContent>> = {
  ja: {
    terms: { title: "利用規約", updated: "最終更新: 2026年8月30日", sections: [
      ["サービスについて", "Samurai Meetは、日本を訪れる方と地域の案内を希望する方をつなぐサービスです。募集内容、日時、待ち合わせ場所を確認し、双方の同意のもとで利用してください。"],
      ["禁止事項", "嫌がらせ、差別、勧誘、金銭の不当な要求、外部連絡先の強要、なりすまし、危険な場所への誘導は禁止します。"],
      ["アカウント", "登録情報は正確に保ち、認証情報を第三者と共有しないでください。違反や安全上の懸念がある場合、利用を制限することがあります。"],
      ["免責と変更", "対面での交流には固有のリスクがあります。安全ガイドを確認し、無理のない範囲で利用してください。本規約は必要に応じて更新されます。"],
    ] },
    privacy: { title: "プライバシー", updated: "最終更新: 2026年8月30日", sections: [
      ["収集する情報", "アカウント情報、プロフィール、募集・応募・チャット・通報、端末情報、現在地を利用した検索情報を、サービス提供と安全確保のために取り扱います。"],
      ["位置情報", "正確な緯度経度は距離判定に使用し、募集カードには施設名・駅名・エリア名などの公開用表示名だけを表示します。"],
      ["本人確認", "本人確認書類は本人確認事業者が処理します。他の利用者には確認結果のみを表示し、書類画像や正確な住所は表示しません。"],
      ["管理", "プロフィールからブロック、通知設定、端末データの初期化、アカウント削除を行えます。法令上必要な場合を除き、目的外で利用しません。"],
    ] },
    safety: { title: "安全ガイド", updated: "最終更新: 2026年8月30日", sections: [
      ["会う前", "相手のプロフィール、本人確認表示、募集内容を確認してください。初回は人通りのある公共の場所を選び、予定を家族や友人に共有してください。"],
      ["会っている間", "個人情報、住所、金銭、外部連絡先を無理に交換しないでください。不安を感じたら案内を中止し、安全な場所へ移動してください。"],
      ["通報とブロック", "募集、プロフィール、チャットから通報できます。緊急時はアプリ内対応を待たず、警察・救急など地域の緊急窓口へ連絡してください。"],
      ["本人確認表示", "本人確認済み表示は判断材料の一つであり、相手の行動や安全を保証するものではありません。"],
    ] },
  },
  en: {
    terms: { title: "Terms of service", updated: "Last updated: August 30, 2026", sections: [
      ["About the service", "Samurai Meet connects people visiting Japan with people who want to show them around their local area. Review the recruitment details, date and time, and meeting place, and use the service with both parties' consent."],
      ["Prohibited conduct", "Harassment, discrimination, solicitation, improper requests for money, pressure to share outside contact details, impersonation, and directing someone to a dangerous place are prohibited."],
      ["Account", "Keep your registration information accurate and do not share authentication credentials with anyone else. We may restrict use when there is a violation or a safety concern."],
      ["Disclaimer and changes", "In-person interactions involve inherent risks. Review the Safety guide and use the service within your comfort level. These Terms may be updated when necessary."],
    ] },
    privacy: { title: "Privacy", updated: "Last updated: August 30, 2026", sections: [
      ["Information we collect", "We handle account information, profiles, recruitments, applications, chats, reports, device information, and search information using your current location to provide the service and help keep it safe."],
      ["Location information", "Precise latitude and longitude are used to determine distance. Recruitment cards show only a public display name such as a facility, station, or area name."],
      ["Identity verification", "An identity-verification provider processes identity documents. Other users see only the verification result; document images and your precise address are not shown."],
      ["Management", "You can block users, manage notifications, reset device data, and delete your account from your profile. We do not use information for unrelated purposes unless required by law."],
    ] },
    safety: { title: "Safety guide", updated: "Last updated: August 30, 2026", sections: [
      ["Before meeting", "Review the other person's profile, verification badge, and recruitment details. For a first meeting, choose a public place with other people around and share your plans with family or friends."],
      ["During the meeting", "Do not feel pressured to exchange personal information, an address, money, or outside contact details. If you feel uncomfortable, end the meeting and move to a safe place."],
      ["Reports and blocking", "You can report a recruitment, profile, or chat. In an emergency, contact local emergency services such as the police or ambulance instead of waiting for an in-app response."],
      ["Verification badge", "A verification badge is only one factor to consider. It does not guarantee another person's behavior or safety."],
    ] },
  },
};

export default function LegalDocumentScreen() {
  const router = useRouter();
  const { document } = useLocalSearchParams<{ document?: string }>();
  const [language, setLanguage] = useState<AppLanguage>("ja");
  const selected: LegalDocument = document === "privacy" || document === "safety" ? document : "terms";
  const content = DOCUMENTS[language][selected];

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeLanguage((nextLanguage) => { if (active) setLanguage(nextLanguage ?? "ja"); });
    void loadLanguage().then((storedLanguage) => { if (active) setLanguage(storedLanguage ?? "ja"); }).catch(() => { if (active) setLanguage("ja"); });
    return () => { active = false; unsubscribe(); };
  }, []);
  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <Header iconName={selected === "safety" ? "health-and-safety" : "description"} onBack={() => router.back()} title={content.title} variant="hero" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.notice}>
          <MaterialIcons color={colors.brand.sky} name="info-outline" size={22} />
          <Text style={styles.noticeText}>{content.updated}</Text>
        </View>
        {content.sections.map(([title, body]) => (
          <View key={title} style={styles.section}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.body}>{body}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface.screen },
  content: { padding: 22, paddingBottom: 48, gap: 14 },
  notice: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: colors.surface.blueSoft },
  noticeText: { color: colors.text.secondary, fontSize: 12, fontWeight: "700" },
  section: { paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.border.subtle },
  title: { color: colors.text.primary, fontSize: 16, fontWeight: "900" },
  body: { marginTop: 8, color: colors.text.secondary, fontSize: 14, lineHeight: 23 },
});
