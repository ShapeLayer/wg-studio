export const supportedLocales = ["en", "ko"] as const;
export type Locale = (typeof supportedLocales)[number];
export const fallbackLocale: Locale = "en";
export const localePreferenceKey = "user-locale-preference";

export function matchLocale(
  value: string | null | undefined,
): Locale | undefined {
  const language = value
    ?.trim()
    .replaceAll("_", "-")
    .toLowerCase()
    .split("-")[0];
  return supportedLocales.find((locale) => locale === language);
}
export interface LocaleEnvironment {
  savedLocale?: string | null;
  dateLocale?: string;
  numberLocale?: string;
  language?: string;
  languages?: readonly string[];
}
/** Intl reflects the machine's formatting locale even if browser languages start with en-US. */
export function resolveLocale(environment: LocaleEnvironment): Locale {
  const candidates = [
    environment.savedLocale,
    environment.dateLocale,
    environment.numberLocale,
    environment.language,
    ...(environment.languages || []),
  ];
  for (const candidate of candidates) {
    const locale = matchLocale(candidate);
    if (locale) return locale;
  }
  return fallbackLocale;
}
export function detectLocale(): Locale {
  const environment: LocaleEnvironment = {};
  try {
    if (typeof window !== "undefined")
      environment.savedLocale =
        window.localStorage.getItem(localePreferenceKey);
  } catch {
    /* Storage may be unavailable. */
  }
  try {
    environment.dateLocale = new Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    /* Continue with other signals. */
  }
  try {
    environment.numberLocale = new Intl.NumberFormat().resolvedOptions().locale;
  } catch {
    /* Continue with browser preferences. */
  }
  if (typeof navigator !== "undefined") {
    environment.language = navigator.language;
    environment.languages = navigator.languages;
  }
  return resolveLocale(environment);
}
