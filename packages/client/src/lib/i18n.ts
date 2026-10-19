import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "@/locales/en.json";
import hi from "@/locales/hi.json";
import es from "@/locales/es.json";
import fr from "@/locales/fr.json";
import de from "@/locales/de.json";
import ar from "@/locales/ar.json";
import pt from "@/locales/pt.json";
import ja from "@/locales/ja.json";
import zh from "@/locales/zh.json";

export const SUPPORTED_LANGUAGES = ["en", "hi", "es", "fr", "de", "ar", "pt", "ja", "zh"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const RTL_LANGUAGES = new Set<SupportedLanguage>(["ar"]);
const STORAGE_KEY = "empcloud-language";

function getSavedLanguage(): SupportedLanguage {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as SupportedLanguage | null;
    return saved && SUPPORTED_LANGUAGES.includes(saved) ? saved : "en";
  } catch {
    return "en";
  }
}

function applyDocumentLanguage(language: string) {
  const normalized = language.split("-")[0] as SupportedLanguage;
  document.documentElement.lang = normalized;
  document.documentElement.dir = RTL_LANGUAGES.has(normalized) ? "rtl" : "ltr";
}

const savedLanguage = getSavedLanguage();

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    hi: { translation: hi },
    es: { translation: es },
    fr: { translation: fr },
    de: { translation: de },
    ar: { translation: ar },
    pt: { translation: pt },
    ja: { translation: ja },
    zh: { translation: zh },
  },
  lng: savedLanguage,
  fallbackLng: "en",
  supportedLngs: [...SUPPORTED_LANGUAGES],
  interpolation: { escapeValue: false },
  returnNull: false,
});

applyDocumentLanguage(savedLanguage);

i18n.on("languageChanged", (language) => {
  const normalized = language.split("-")[0] as SupportedLanguage;
  try {
    localStorage.setItem(STORAGE_KEY, normalized);
  } catch {
    // Storage may be unavailable in privacy-restricted browser contexts.
  }
  applyDocumentLanguage(normalized);
});

export default i18n;
