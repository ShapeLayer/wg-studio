import type { FilePickerOptions, LocalFileHandle } from "./types.ts";
declare global {
  interface Window {
    showOpenFilePicker?: (
      options: FilePickerOptions,
    ) => Promise<LocalFileHandle[]>;
    showSaveFilePicker?: (
      options: FilePickerOptions,
    ) => Promise<LocalFileHandle>;
  }
}
