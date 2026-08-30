import type { PropsWithChildren } from "react";
import {
  Keyboard,
  TouchableWithoutFeedback,
  View,
  type ViewProps,
} from "react-native";
import { dismissKeyboardForTap } from "./keyboard-dismissal";

export type DismissKeyboardViewProps = PropsWithChildren<ViewProps>;

/**
 * Dismisses the keyboard for taps outside native input responders.
 * ScrollViews containing this view should use keyboardShouldPersistTaps="handled"
 * so a TextInput keeps the keyboard when it is tapped.
 */
export default function DismissKeyboardView({ children, ...viewProps }: DismissKeyboardViewProps) {
  const dismissKeyboard = () => {
    dismissKeyboardForTap(Keyboard, "outside");
  };

  return (
    <TouchableWithoutFeedback onPress={dismissKeyboard}>
      <View {...viewProps}>{children}</View>
    </TouchableWithoutFeedback>
  );
}
