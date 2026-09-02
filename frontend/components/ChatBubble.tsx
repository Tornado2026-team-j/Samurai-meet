import { useState } from "react";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Button, colors, radius, typography } from "./ui";

type ChatBubbleProps = {
  text: string;
  createdAt: string;
  mine: boolean;
  translatedText?: string | null;
  encryptedFallback?: boolean;
  translateLabel: string;
  reportLabel?: string;
  imageUri?: string | null;
  imageLoading?: boolean;
  imageLabel?: string;
  imageRetryLabel?: string;
  onRetryImage?: () => void;
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
  imageUri = null,
  imageLoading = false,
  imageLabel,
  imageRetryLabel,
  onRetryImage,
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
          accessibilityLabel={imageUri ? imageLabel : undefined}
          style={({ pressed }) => [
            styles.bubble,
            mine ? styles.bubbleMine : styles.bubbleOther,
            pressed && styles.pressedBubble,
          ]}
        >
          {imageUri ? (
            <Image accessibilityLabel={imageLabel} resizeMode="contain" source={{ uri: imageUri }} style={styles.attachmentImage} />
          ) : imageLoading ? (
            <View style={styles.imageLoading}>
              <ActivityIndicator color={mine ? colors.text.inverse : colors.brand.sky} size="small" />
              <Text style={[styles.messageText, mine ? styles.messageTextMine : styles.messageTextOther]}>
                {imageLabel ?? text}
              </Text>
            </View>
          ) : encryptedFallback ? (
            <View style={styles.encryptedLine}>
              <MaterialIcons color={mine ? colors.text.inverse : colors.text.muted} name="lock" size={16} />
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
        {!imageUri && !imageLoading && onRetryImage ? (
          <Pressable
            accessibilityRole="button"
            onPress={onRetryImage}
            style={({ pressed }) => [styles.retryAttachment, pressed && styles.pressedBubble]}
          >
            <Text style={styles.retryAttachmentText}>{imageRetryLabel ?? text}</Text>
          </Pressable>
        ) : null}
        {actionsVisible ? (
          <View style={[styles.actionRow, mine ? styles.actionRowMine : styles.actionRowOther]}>
            <Button
              accessibilityLabel={translateLabel}
              iconLeft={<MaterialIcons color={colors.text.secondary} name="translate" size={18} />}
              onPress={() => {
                onTranslate();
                setActionsVisible(false);
              }}
              size="sm"
              style={styles.smallAction}
              textStyle={styles.smallActionText}
              variant="secondary"
            >
              {translateLabel}
            </Button>
            {canReport ? (
              <Button
                accessibilityLabel={reportLabel}
                iconLeft={<MaterialIcons color={colors.text.muted} name="outlined-flag" size={18} />}
                onPress={() => {
                  onReport?.();
                  setActionsVisible(false);
                }}
                size="sm"
                style={[styles.smallAction, styles.reportAction]}
                textStyle={styles.smallActionText}
                variant="secondary"
              >
                {reportLabel}
              </Button>
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
    color: colors.text.muted,
    ...typography.small,
    lineHeight: 15,
  },
  bubble: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderRadius: radius["2xl"],
  },
  bubbleMine: {
    borderTopRightRadius: radius.sm,
    backgroundColor: colors.brand.sky,
  },
  bubbleOther: {
    borderTopLeftRadius: radius.sm,
    backgroundColor: "#f4f4f4",
  },
  pressedBubble: {
    opacity: 0.9,
  },
  messageText: {
    ...typography.bodyStrong,
  },
  messageTextMine: {
    color: colors.text.inverse,
  },
  messageTextOther: {
    color: "#30343b",
  },
  encryptedLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  imageLoading: {
    minWidth: 120,
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  attachmentImage: {
    width: 240,
    height: 220,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  retryAttachment: {
    alignSelf: "flex-start",
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  retryAttachmentText: {
    color: colors.brand.sky,
    ...typography.captionStrong,
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
    borderColor: colors.border.subtle,
    borderRadius: radius.pill,
    backgroundColor: colors.surface.default,
  },
  smallActionText: {
    color: colors.text.secondary,
    ...typography.captionStrong,
  },
  reportAction: {
    paddingHorizontal: 12,
  },
  translation: {
    maxWidth: "100%",
    marginTop: 8,
    color: colors.brand.gold,
    ...typography.captionStrong,
    lineHeight: 19,
  },
  translationMine: {
    textAlign: "right",
  },
  translationOther: {
    textAlign: "left",
  },
});
