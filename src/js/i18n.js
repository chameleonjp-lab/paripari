import * as ja from "./locales/ja.js";
import * as en from "./locales/en.js";
import * as es from "./locales/es.js";
import * as ptBR from "./locales/pt-BR.js";
import * as zhHans from "./locales/zh-Hans.js";
import * as fr from "./locales/fr.js";
import * as de from "./locales/de.js";
import * as ko from "./locales/ko.js";
import * as ru from "./locales/ru.js";
import * as it from "./locales/it.js";
import * as zhHant from "./locales/zh-Hant.js";
import * as id from "./locales/id.js";
import * as tr from "./locales/tr.js";
import * as vi from "./locales/vi.js";
import * as th from "./locales/th.js";

export const LANGUAGE_KEY = "paripari.language.v1";
export const catalogs = {
  ja: ja.catalog,
  en: en.catalog,
  es: es.catalog,
  "pt-BR": ptBR.catalog,
  "zh-Hans": zhHans.catalog,
  fr: fr.catalog,
  de: de.catalog,
  ko: ko.catalog,
  ru: ru.catalog,
  it: it.catalog,
  "zh-Hant": zhHant.catalog,
  id: id.catalog,
  tr: tr.catalog,
  vi: vi.catalog,
  th: th.catalog,
};
export const languages = [
  ["ja", "日本語"],
  ["en", "English"],
  ["es", "Español"],
  ["pt-BR", "Português (Brasil)"],
  ["zh-Hans", "简体中文"],
  ["fr", "Français"],
  ["de", "Deutsch"],
  ["ko", "한국어"],
  ["ru", "Русский"],
  ["it", "Italiano"],
  ["zh-Hant", "繁體中文"],
  ["id", "Bahasa Indonesia"],
  ["tr", "Türkçe"],
  ["vi", "Tiếng Việt"],
  ["th", "ไทย"],
];
let language = "en";
const messages = new Map();
export function languageFromTag(tag) {
  if (typeof tag !== "string") return null;
  const normalized = tag.trim().replaceAll("_", "-").toLowerCase();
  if (normalized === "zh" || normalized.startsWith("zh-")) {
    if (normalized.split("-").includes("hans")) return "zh-Hans";
    if (
      normalized.split("-").includes("hant") ||
      /-(tw|hk|mo)(-|$)/.test(normalized)
    )
      return "zh-Hant";
    return "zh-Hans";
  }
  if (normalized === "pt" || normalized.startsWith("pt-")) return "pt-BR";
  return (
    languages.find(([code]) => code.toLowerCase() === normalized)?.[0] ??
    languages.find(([code]) => code === normalized.split("-")[0])?.[0] ??
    null
  );
}
export function chooseLanguage(saved, browserLanguages = []) {
  const selected = languageFromTag(saved);
  if (selected) return selected;
  for (const tag of browserLanguages) {
    const code = languageFromTag(tag);
    if (code) return code;
  }
  return "en";
}
export function getLanguage() {
  return language;
}
export function t(key, params = {}) {
  const catalog = catalogs[language];
  const template = Object.hasOwn(catalog, key)
    ? catalog[key]
    : Object.hasOwn(catalogs.en, key)
      ? catalogs.en[key]
      : key;
  return String(template).replace(/\{([A-Za-z]+)\}/g, (match, name) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}
export function formatNumber(value) {
  const locale =
    language === "zh-Hans"
      ? "zh-CN"
      : language === "zh-Hant"
        ? "zh-TW"
        : language;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(
    value,
  );
}
export function setMessage(element, key, params = {}) {
  if (!element) return;
  if (key) {
    messages.set(element, { key, params });
    element.textContent = t(key, params);
  } else {
    messages.delete(element);
    element.textContent = "";
  }
}
export function renderLanguage(root = globalThis.document) {
  if (!root) return;
  root.documentElement.lang = language;
  root.title = t("pageTitle");
  for (const element of root.querySelectorAll("[data-i18n]"))
    element.textContent = t(element.dataset.i18n);
  for (const attr of ["aria-label", "placeholder"])
    for (const element of root.querySelectorAll(`[data-i18n-${attr}]`))
      element.setAttribute(attr, t(element.getAttribute(`data-i18n-${attr}`)));
  for (const [element, { key, params }] of messages) {
    if (element.isConnected) element.textContent = t(key, params);
    else messages.delete(element);
  }
  const selector = root.getElementById("language");
  if (selector) selector.value = language;
}
export function setLanguage(
  code,
  { persist = true, storage, root = globalThis.document } = {},
) {
  language = languageFromTag(code) ?? "en";
  if (persist)
    try {
      (storage ?? globalThis.localStorage)?.setItem(LANGUAGE_KEY, language);
    } catch {
      /* In-memory choice still works. */
    }
  renderLanguage(root);
  root?.dispatchEvent(new Event("paripari:language"));
}
export function initLanguage(root = globalThis.document) {
  let saved = null;
  try {
    saved = globalThis.localStorage?.getItem(LANGUAGE_KEY);
  } catch {}
  const selector = root.getElementById("language");
  for (const [value, label] of languages) {
    const option = root.createElement("option");
    option.value = value;
    option.textContent = label;
    selector.append(option);
  }
  selector.addEventListener("change", () => setLanguage(selector.value));
  setLanguage(chooseLanguage(saved, globalThis.navigator?.languages ?? []), {
    persist: false,
    root,
  });
}
