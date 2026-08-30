import { useState } from "react";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Pressable, StyleSheet, Text, View } from "react-native";

const BLUE = "#5ec5f5";
const YELLOW = "#e7b454";
const TEXT_GRAY = "#535353";
const MUTED_GRAY = "#949494";
const BORDER_GRAY = "#e4e4e4";

type ChatBubbleProps = {
  text: string;
  createdAt: string;
  mine: boolean;
  translatedText?: string | null;
  encryptedFallback?: boolean;
  translateLabel: string;
  reportLabel?: string;
  onTranslate: () => void;
  onReport?: () => void;
};

function formatClock(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  });
}

export default function ChatBubble({
  text,
  createdAt,
  encryptedFallback = false,
  mine,
  translatedText,
  translateLabel,
  reportLabel,
  onTranslate,
  onReport,
}: ChatBubbleProps) {
  const [actionsVisible, setActionsVisible] = useState(false);
  const canReport = !mine && !!onReport && !!reportLabel;

  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowOther]}>
      <View style={[styles.cluster, mine ? styles.clusterMine : styles.clusterOther]}>
        <Text style={styles.timestamp}>{formatClock(createdAt)}</Text>
        <Pressable
          accessibilityRole="button"
          onLongPress={() => setActionsVisible(true)}
          onPress={() => setActionsVisible((visible) => !visible)}
          style={({ pressed }) => [
            styles.bubble,
            mine ? styles.bubbleMine : styles.bubbleOther,
            pressed && styles.pressedBubble,
          ]}
        >
          {encryptedFallback ? (
            <View style={styles.encryptedLine}>
              <MaterialIcons color={mine ? "#ffffff" : MUTED_GRAY} name="lock" size={16} />
              <Text style={[styles.messageText, mine ? styles.messageTextMine : styles.messageTextOther]}>
                {text}
              </Text>
            </View>
          ) : (
            <Text style={[styles.messageText, mine ? styles.messageTextMine : styles.messageTextOther]}>
              {text}
            </Text>
          )}
        </Pressable>
        {actionsVisible ? (
          <View style={[styles.actionRow, mine ? styles.actionRowMine : styles.actionRowOther]}>
            <Pressable
              accessibilityLabel={translateLabel}
              accessibilityRole="button"
              onPress={() => {
                onTranslate();
                setActionsVisible(false);
              }}
              style={({ pressed }) => [styles.smallAction, pressed && styles.pressed]}
            >
              <MaterialIcons color={TEXT_GRAY} name="translate" size={18} />
              <Text style={styles.smallActionText}>{translateLabel}</Text>
            </Pressable>
            {canReport ? (
              <Pressable
                accessibilityLabel={reportLabel}
                accessibilityRole="button"
                onPress={() => {
                  onReport?.();
                  setActionsVisible(false);
                }}
                style={({ pressed }) => [styles.smallAction, styles.reportAction, pressed && styles.pressed]}
              >
                <MaterialIcons color={MUTED_GRAY} name="outlined-flag" size={18} />
                <Text style={styles.smallActionText}>{reportLabel}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {translatedText ? (
          <Text style={[styles.translation, mine ? styles.translationMine : styles.translationOther]}>
            {translatedText}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    width: "100%",
    marginTop: 18,
  },
  rowMine: {
    alignItems: "flex-end",
  },
  rowOther: {
    alignItems: "flex-start",
  },
  cluster: {
    maxWidth: "82%",
  },
  clusterMine: {
    alignItems: "flex-end",
  },
  clusterOther: {
    alignItems: "flex-start",
  },
  timestamp: {
    marginBottom: 8,
    color: MUTED_GRAY,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 15,
  },
  bubble: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderRadius: 20,
  },
  bubbleMine: {
    borderTopRightRadius: 8,
    backgroundColor: BLUE,
  },
  bubbleOther: {
    borderTopLeftRadius: 8,
    backgroundColor: "#f4f4f4",
  },
  pressedBubble: {
    opacity: 0.9,
  },
  messageText: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 24,
  },
  messageTextMine: {
    color: "#ffffff",
  },
  messageTextOther: {
    color: "#30343b",
  },
  encryptedLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  actionRowMine: {
    justifyContent: "flex-end",
  },
  actionRowOther: {
    justifyContent: "flex-start",
  },
  smallAction: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: BORDER_GRAY,
    borderRadius: 16,
    backgroundColor: "#ffffff",
  },
  smallActionText: {
    color: TEXT_GRAY,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0,
    lineHeight: 17,
  },
  reportAction: {
    paddingHorizontal: 12,
  },
  translation: {
    maxWidth: "100%",
    marginTop: 8,
    color: YELLOW,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0,
    lineHeight: 19,
  },
  translationMine: {
    textAlign: "right",
  },
  translationOther: {
    textAlign: "left",
  },
  pressed: {
    opacity: 0.72,
  },
});
