import { useEffect, useState, type CSSProperties, type ChangeEvent } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import {
  formatRecruitmentISODate,
  parseRecruitmentDateInput,
} from "../services/recruitment";
import { useTheme, useThemeStyles } from "../hooks/useTheme";
import type { ThemeColors } from "./ui/tokens";
import type { WebDatePickerProps } from "./web-date-picker-types";

function formatInputDate(value: Date): string {
  try {
    return formatRecruitmentISODate(value);
  } catch {
    return "";
  }
}

function parseInputDate(value: string): Date | null {
  if (!value) return null;
  try {
    return parseRecruitmentDateInput(value);
  } catch {
    return null;
  }
}

export default function WebDatePicker({
  cancelLabel,
  doneLabel,
  label,
  maximumDate,
  minimumDate,
  onChange,
  onDismiss,
  value,
}: WebDatePickerProps) {
  const { colors, scheme } = useTheme();
  const styles = useThemeStyles(createStyles);
  const [draftValue, setDraftValue] = useState(() => formatInputDate(value));

  useEffect(() => {
    setDraftValue(formatInputDate(value));
  }, [value]);

  const inputStyle: CSSProperties = {
    width: "100%",
    minHeight: 48,
    boxSizing: "border-box",
    padding: "0 14px",
    border: `1px solid ${colors.border.default}`,
    borderRadius: 10,
    color: colors.text.primary,
    backgroundColor: colors.surface.default,
    fontSize: 16,
    colorScheme: scheme,
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    setDraftValue(event.currentTarget.value);
  };

  const commit = () => {
    const parsed = parseInputDate(draftValue);
    if (!parsed) return;
    onChange(parsed);
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={onDismiss}
      transparent
      visible
    >
      <View style={styles.backdrop}>
        <View accessibilityLabel={label} style={styles.card}>
          <Text style={styles.title}>{label}</Text>
          <input
            aria-label={label}
            max={maximumDate ? formatInputDate(maximumDate) : undefined}
            min={minimumDate ? formatInputDate(minimumDate) : undefined}
            onChange={handleInputChange}
            style={inputStyle}
            type="date"
            value={draftValue}
          />
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={onDismiss} style={styles.cancelButton}>
              <Text style={styles.cancelText}>{cancelLabel}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={commit} style={styles.doneButton}>
              <Text style={styles.doneText}>{doneLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
      backgroundColor: colors.overlay.scrim,
    },
    card: {
      width: "100%",
      maxWidth: 360,
      gap: 18,
      padding: 22,
      borderRadius: 20,
      backgroundColor: colors.surface.default,
    },
    title: {
      color: colors.text.primary,
      fontSize: 19,
      fontWeight: "900",
      lineHeight: 25,
    },
    actions: {
      flexDirection: "row",
      gap: 10,
    },
    cancelButton: {
      flex: 1,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border.default,
      borderRadius: 10,
    },
    doneButton: {
      flex: 1,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 10,
      backgroundColor: colors.brand.gold,
    },
    cancelText: {
      color: colors.text.secondary,
      fontSize: 14,
      fontWeight: "800",
    },
    doneText: {
      color: colors.text.onGold,
      fontSize: 14,
      fontWeight: "900",
    },
  });
}
