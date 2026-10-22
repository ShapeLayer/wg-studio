import { t } from "../i18n/index.ts";
import { strToU8, zipSync } from "fflate";
import QRCode from "qrcode";

export type ExportFormat = "conf" | "qr" | "exclude";
export interface ExportDocument {
  id: number;
  name: string;
  text: string;
}
export interface ExportSelection extends ExportDocument {
  format: ExportFormat;
}

function uniqueFilename(
  name: string,
  extension: string,
  used: Set<string>,
): string {
  const stem =
    name
      .replace(/\.(conf|txt|svg)$/i, "")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/^[. ]+|[. ]+$/g, "") || "config";
  let candidate = `${stem}.${extension}`,
    count = 2;
  while (used.has(candidate.toLowerCase()))
    candidate = `${stem} (${count++}).${extension}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

export async function exportFiles(
  selections: readonly ExportSelection[],
): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = Object.create(null);
  const used = new Set<string>();
  for (const selection of selections) {
    if (selection.format === "exclude") continue;
    const extension = selection.format === "qr" ? "svg" : "conf";
    const filename = uniqueFilename(selection.name, extension, used);
    if (selection.format === "conf") files[filename] = strToU8(selection.text);
    else {
      try {
        if (!selection.text) throw new Error("empty config");
        const svg = await QRCode.toString(selection.text, {
          type: "svg",
          errorCorrectionLevel: "M",
          margin: 4,
        });
        files[filename] = strToU8(svg);
      } catch {
        throw new Error(
          t("couldNotGenerateAQrCodeTheConfigurationMay", {
            v0: selection.name,
          }),
        );
      }
    }
  }
  if (!Object.keys(files).length)
    throw new Error(t("selectAtLeastOneConfigurationToSave"));
  return files;
}

export async function exportZip(
  selections: readonly ExportSelection[],
): Promise<Uint8Array> {
  return zipSync(await exportFiles(selections), { level: 6 });
}
