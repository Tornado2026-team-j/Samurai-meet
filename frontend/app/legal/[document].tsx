import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Header, colors, radius } from "../../components/ui";

const DOCUMENTS = {
  terms: {
    title: "利用規約",
    sections: [
      ["サービスについて", "Samurai Meetは、日本を訪れる方と地域の案内を希望する方をつなぐサービスです。募集内容、日時、待ち合わせ場所を確認し、双方の同意のもとで利用してください。"],
      ["禁止事項", "嫌がらせ、差別、勧誘、金銭の不当な要求、外部連絡先の強要、なりすまし、危険な場所への誘導は禁止します。"],
      ["アカウント", "登録情報は正確に保ち、認証情報を第三者と共有しないでください。違反や安全上の懸念がある場合、利用を制限することがあります。"],
      ["免責と変更", "対面での交流には固有のリスクがあります。安全ガイドを確認し、無理のない範囲で利用してください。本規約は必要に応じて更新されます。"],
    ],
  },
  privacy: {
    title: "プライバシー",
    sections: [
      ["収集する情報", "アカウント情報、プロフィール、募集・応募・チャット・通報、端末情報、現在地を利用した検索情報を、サービス提供と安全確保のために取り扱います。"],
      ["位置情報", "正確な緯度経度は距離判定に使用し、募集カードには施設名・駅名・エリア名などの公開用表示名だけを表示します。"],
      ["本人確認", "本人確認書類は本人確認事業者が処理します。他の利用者には確認結果のみを表示し、書類画像や正確な住所は表示しません。"],
      ["管理", "プロフィールからブロック、通知設定、端末データの初期化、アカウント削除を行えます。法令上必要な場合を除き、目的外で利用しません。"],
    ],
  },
  safety: {
    title: "安全ガイド",
    sections: [
      ["会う前", "相手のプロフィール、本人確認表示、募集内容を確認してください。初回は人通りのある公共の場所を選び、予定を家族や友人に共有してください。"],
      ["会っている間", "個人情報、住所、金銭、外部連絡先を無理に交換しないでください。不安を感じたら案内を中止し、安全な場所へ移動してください。"],
      ["通報とブロック", "募集、プロフィール、チャットから通報できます。緊急時はアプリ内対応を待たず、警察・救急など地域の緊急窓口へ連絡してください。"],
      ["本人確認表示", "本人確認済み表示は判断材料の一つであり、相手の行動や安全を保証するものではありません。"],
    ],
  },
} as const;

export default function LegalDocumentScreen() {
  const router = useRouter();
  const { document } = useLocalSearchParams<{ document?: string }>();
  const selected = document === "privacy" || document === "safety" ? document : "terms";
  const content = DOCUMENTS[selected];
  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <Header iconName={selected === "safety" ? "health-and-safety" : "description"} onBack={() => router.back()} title={content.title} variant="hero" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.notice}>
          <MaterialIcons color={colors.brand.sky} name="info-outline" size={22} />
          <Text style={styles.noticeText}>最終更新: 2026年8月30日</Text>
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
