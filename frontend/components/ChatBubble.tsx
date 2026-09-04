import { useState } from "react";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Button, radius, typography } from "./ui";
import type { ThemeColors } from "./ui/tokens";
import { useTheme, useThemeStyles } from "../hooks/useTheme";

type ChatBubbleProps = {
  text: string;
  createdAt: string;
  mine: boolean;
  translatedText?: string | null;
  translationMode?: "below" | "inline";
  showOriginal?: boolean;
  translationLoading?: boolean;
  originalLabel?: string;
  translatedLabel?: string;
  translationLoadingLabel?: string;
  encryptedFallback?: boolean;
  translateLabel: string;
  editedAt?: string;
  editedLabel?: string;
  editLabel?: string;
  deleteLabel?: string;
  reportLabel?: string;
  imageUri?: string | null;
  imageLoading?: boolean;
  imageLabel?: string;
  imageRetryLabel?: string;
  onRetryImage?: () => void;
  onTranslate?: () => void;
  onToggleTranslation?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
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
  translationMode = "below",
  showOriginal = false,
  translationLoading = false,
  originalLabel = "Original",
  translatedLabel = "Translate",
  translationLoadingLabel = "Translating…",
  translateLabel,
  editedAt,
  editedLabel = "edited",
  editLabel,
  deleteLabel,
  reportLabel,
  imageUri = null,
  imageLoading = false,
  imageLabel,
  imageRetryLabel,
  onRetryImage,
  onTranslate,
  onToggleTranslation,
  onEdit,
  onDelete,
  onReport,
}: ChatBubbleProps) {
  const { colors } = useTheme();
  const styles = useThemeStyles(createStyles);
  const [actionsVisible, setActionsVisible] = useState(false);
  const canReport = !mine && !!onReport && !!reportLabel;
  const canTranslate = !!onTranslate && !!translateLabel;
  const canEdit = mine && !!onEdit && !!editLabel;
  const canDelete = mine && !!onDelete && !!deleteLabel;
  const inlineTranslationVisible = translationMode === "inline" && !!translatedText && !showOriginal;
  const visibleText = inlineTranslationVisible ? translatedText ?? text : text;
  const canToggleTranslation = !!onToggleTranslation || !!onTranslate;

  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowOther]}>
      <View style={[styles.cluster, mine ? styles.clusterMine : styles.clusterOther]}>
        <View style={styles.timestampRow}>
          <Text style={styles.timestamp}>{formatClock(createdAt)}</Text>
          {editedAt ? <Text style={styles.editedLabel}>({editedLabel})</Text> : null}
        </View>
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
              {visibleText}
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
        {actionsVisible && (canTranslate || canEdit || canDelete || canReport) ? (
          <View style={[styles.actionRow, mine ? styles.actionRowMine : styles.actionRowOther]}>
            {canTranslate ? (
              <Button
                accessibilityLabel={translateLabel}
                iconLeft={<MaterialIcons color={colors.text.secondary} name="translate" size={18} />}
                onPress={() => {
                  onTranslate?.();
                  setActionsVisible(false);
                }}
                size="sm"
                style={styles.smallAction}
                textStyle={styles.smallActionText}
                variant="secondary"
              >
                {translateLabel}
              </Button>
            ) : null}
            {canEdit ? (
              <Button
                accessibilityLabel={editLabel}
                iconLeft={<MaterialIcons color={colors.text.secondary} name="edit" size={18} />}
                onPress={() => {
                  onEdit?.();
                  setActionsVisible(false);
                }}
                size="sm"
                style={styles.smallAction}
                textStyle={styles.smallActionText}
                variant="secondary"
              >
                {editLabel}
              </Button>
            ) : null}
            {canDelete ? (
              <Button
                accessibilityLabel={deleteLabel}
                iconLeft={<MaterialIcons color={colors.state.danger} name="delete-outline" size={18} />}
                onPress={() => {
                  onDelete?.();
                  setActionsVisible(false);
                }}
                size="sm"
                style={[styles.smallAction, styles.deleteAction]}
                textStyle={[styles.smallActionText, styles.deleteActionText]}
                variant="secondary"
              >
                {deleteLabel}
              </Button>
            ) : null}
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
        {translationMode === "inline" && (translatedText || translationLoading) ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={translationLoading ? translationLoadingLabel : showOriginal ? translatedLabel : originalLabel}
            disabled={!canToggleTranslation}
            onPress={() => (onToggleTranslation ?? onTranslate)?.()}
            style={({ pressed }) => [styles.translationToggle, (translationLoading || !canToggleTranslation) && styles.translationToggleDisabled, pressed && styles.pressedBubble]}
          >
            <MaterialIcons color={colors.brand.gold} name={translationLoading ? "hourglass-empty" : "translate"} size={15} />
            <Text style={styles.translationToggleText}>
              {translationLoading ? translationLoadingLabel : showOriginal ? translatedLabel : originalLabel}
            </Text>
          </Pressable>
        ) : null}
        {translationMode !== "inline" && translatedText ? (
          <Text style={[styles.translation, mine ? styles.translationMine : styles.translationOther]}>
            {translatedText}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
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
    color: colors.text.muted,
    ...typography.small,
    lineHeight: 15,
  },
  timestampRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 8,
  },
  editedLabel: {
    color: colors.text.muted,
    ...typography.caption,
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
    backgroundColor: colors.surface.subtle,
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
    color: colors.text.primary,
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
    flexWrap: "wrap",
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
  deleteAction: {
    borderColor: colors.border.danger,
  },
  deleteActionText: {
    color: colors.state.danger,
  },
  translationToggle: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 5,
    marginTop: 6,
    paddingHorizontal: 8,
    borderRadius: radius.pill,
  },
  translationToggleDisabled: {
    opacity: 0.7,
  },
  translationToggleText: {
    color: colors.brand.gold,
    ...typography.captionStrong,
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
}
