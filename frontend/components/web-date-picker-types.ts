export type WebDatePickerProps = {
  label: string;
  value: Date;
  minimumDate?: Date;
  maximumDate?: Date;
  cancelLabel: string;
  doneLabel: string;
  onChange: (value: Date) => void;
  onDismiss: () => void;
};
