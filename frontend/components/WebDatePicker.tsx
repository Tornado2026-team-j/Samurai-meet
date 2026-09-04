import type { WebDatePickerProps } from "./web-date-picker-types";

export type { WebDatePickerProps } from "./web-date-picker-types";

// The native bundle resolves this file. Web resolves WebDatePicker.web.tsx
// instead, keeping DOM-only elements out of native builds.
export default function WebDatePicker(_props: WebDatePickerProps): null {
  return null;
}
