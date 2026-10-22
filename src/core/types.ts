export type SectionType = "Interface" | "Peer";

// Raw lines and editable fields share their source ordering for lossless imports.
export interface ConfigField {
  key: string;
  value: string;
  raw?: never;
  comment?: string;
  original?: string;
}
export interface RawLine {
  raw: string;
  key?: never;
  value?: never;
  comment?: never;
  original?: never;
}
export type ConfigLine = ConfigField | RawLine;
export interface ConfigSection {
  type: SectionType;
  header?: string;
  fields: ConfigLine[];
}
export interface ConfigModel {
  preamble: { raw: string }[];
  sections: ConfigSection[];
}
export interface Point {
  x: number;
  y: number;
}
export interface Camera extends Point {
  scale: number;
}
export interface KeyDocument {
  id: number;
  model: ConfigModel;
  error?: string;
}
export interface ConfigDocument extends KeyDocument, Point {
  internalId: string;
  name: string;
  selected: number;
  text: string;
  saved: string | null;
  history: { text: string; selected: number }[];
  future: { text: string; selected: number }[];
  handle: LocalFileHandle | null;
}
export interface LocalFileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{
    write(data: string): Promise<void>;
    close(): Promise<void>;
  }>;
}
export interface FilePickerOptions {
  multiple?: boolean;
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}
export interface KeyConnection {
  source: number;
  target: number;
  section: number;
  peer: number;
  key: string;
}
export type CanvasGesture =
  | {
      type: "pan";
      pointer: number;
      startX: number;
      startY: number;
      camera: Camera;
      id: number | null;
    }
  | {
      type: "card";
      pointer: number;
      startX: number;
      startY: number;
      camera: Camera;
      id: number;
      x: number;
      y: number;
    }
  | { type: "pinch"; camera: Camera; mid: Point; distance: number };
