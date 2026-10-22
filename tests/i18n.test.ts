import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveLocale,
  matchLocale,
  localePreferenceKey,
} from "../src/i18n/locale.ts";
import { en } from "../src/i18n/en.ts";
import { ko } from "../src/i18n/ko.ts";
import { getLocale, setLocale, t, th } from "../src/i18n/index.ts";
import {
  parse,
  serialize,
  validate,
  newConfig,
} from "../src/core/wireguard.ts";

const koreanMachine = {
  language: "en-US",
  languages: ["en-US", "en", "ko", "ja"],
  dateLocale: "ko",
  numberLocale: "ko",
  savedLocale: null,
};

test("machine formatting locale takes precedence over English browser preferences", () => {
  assert.equal(resolveLocale(koreanMachine), "ko");
  assert.equal(resolveLocale({ ...koreanMachine, dateLocale: "ko-KR" }), "ko");
});
test("an explicit saved preference overrides all machine signals", () => {
  assert.equal(localePreferenceKey, "user-locale-preference");
  assert.equal(resolveLocale({ ...koreanMachine, savedLocale: "en" }), "en");
  assert.equal(
    resolveLocale({ dateLocale: "en-US", savedLocale: "ko-KR" }),
    "ko",
  );
});
test("unsupported saved preferences are ignored and unsupported environments fall back to English", () => {
  assert.equal(resolveLocale({ ...koreanMachine, savedLocale: "fr" }), "ko");
  assert.equal(
    resolveLocale({ dateLocale: "fr", numberLocale: "ja", languages: ["de"] }),
    "en",
  );
  assert.equal(resolveLocale({}), "en");
});
test("missing or unsupported Intl locales continue through number and browser locales", () => {
  assert.equal(
    resolveLocale({
      dateLocale: "ja",
      numberLocale: "ko-KR",
      language: "en-US",
    }),
    "ko",
  );
  assert.equal(
    resolveLocale({ language: "ko-KR", languages: ["en-US"] }),
    "ko",
  );
  assert.equal(
    resolveLocale({ language: "fr", languages: ["ja", "ko", "en"] }),
    "ko",
  );
  assert.equal(matchLocale("KO_kr"), "ko");
  assert.equal(matchLocale("en-GB"), "en");
  assert.equal(matchLocale("unknown"), undefined);
});
test("both catalogs cover the same messages and interpolation parameters", () => {
  assert.deepEqual(Object.keys(ko).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en) as (keyof typeof en)[]) {
    assert.ok(en[key].trim(), key);
    assert.ok(ko[key].trim(), key);
    const params = (text: string) =>
      [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    assert.deepEqual(params(en[key]), params(ko[key]), key);
  }
});
test("switching language translates errors without changing user configuration or key values", () => {
  const initial = getLocale();
  try {
    const source =
      "# 사용자 설정\n[Interface]\nPrivateKey = dummy:abcdef1\nAddress = 10.0.0.1/24\n";
    const model = parse(source);
    setLocale("en", false);
    assert.match(validate(newConfig())[0], /PrivateKey is empty/);
    setLocale("ko", false);
    assert.match(validate(newConfig())[0], /PrivateKey가 비어/);
    assert.equal(serialize(model), source);
    setLocale("en", false);
    assert.equal(
      t("appliedTo", { v0: "server.conf", v1: "dummy:abcdef1" }),
      "Applied dummy:abcdef1 to server.conf",
    );
    assert.equal(
      th("configurationCard", { v0: '<img src=x onerror="alert(1)">' }),
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt; configuration card",
    );
  } finally {
    setLocale(initial, false);
  }
});

test("storage failures do not prevent explicit language switching", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const initial = getLocale();
  const browser = new EventTarget();
  Object.defineProperty(browser, "localStorage", {
    get() {
      throw new Error("Storage blocked");
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: browser,
  });
  try {
    setLocale("en");
    assert.equal(getLocale(), "en");
    setLocale("ko");
    assert.equal(getLocale(), "ko");
    assert.equal(t("cancel"), "취소");
  } finally {
    setLocale(initial, false);
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
