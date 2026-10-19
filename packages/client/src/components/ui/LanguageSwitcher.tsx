import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SupportedLanguage } from "@/lib/i18n";

const LANGUAGES: Array<{ code: SupportedLanguage; label: string; short: string }> = [
  { code: "en", label: "English", short: "EN" },
  { code: "hi", label: "हिन्दी", short: "HI" },
  { code: "es", label: "Español", short: "ES" },
  { code: "fr", label: "Français", short: "FR" },
  { code: "de", label: "Deutsch", short: "DE" },
  { code: "ar", label: "العربية", short: "AR" },
  { code: "pt", label: "Português", short: "PT" },
  { code: "ja", label: "日本語", short: "JA" },
  { code: "zh", label: "中文", short: "ZH" },
];

export function LanguageSwitcher({ showCode = true }: { showCode?: boolean }) {
  const { t, i18n } = useTranslation();
  const activeCode = (i18n.resolvedLanguage || i18n.language || "en").split("-")[0];
  const active = LANGUAGES.find((item) => item.code === activeCode) || LANGUAGES[0];

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={t("language.change")}
          title={t("language.change")}
          className="focus-visible:ring-brand-500 flex min-h-9 min-w-9 items-center justify-center gap-1.5 rounded-lg px-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          <Globe className="h-4 w-4" aria-hidden="true" />
          {showCode && <span className="text-xs font-semibold">{active.short}</span>}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          collisionPadding={12}
          aria-label={t("language.menuLabel")}
          className="z-[100] min-w-48 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl dark:border-gray-700 dark:bg-gray-900"
        >
          <DropdownMenu.RadioGroup
            value={active.code}
            onValueChange={(value) => void i18n.changeLanguage(value)}
          >
            {LANGUAGES.map((item) => (
              <DropdownMenu.RadioItem
                key={item.code}
                value={item.code}
                className="focus:bg-brand-50 focus:text-brand-700 data-[state=checked]:bg-brand-50 data-[state=checked]:text-brand-700 flex cursor-pointer select-none items-center gap-2.5 px-3 py-2 text-sm text-gray-700 outline-none hover:bg-gray-50 data-[state=checked]:font-semibold dark:text-gray-200 dark:hover:bg-gray-800"
              >
                <span className="w-7 text-center text-xs font-bold text-gray-400">
                  {item.short}
                </span>
                <span className="flex-1">{item.label}</span>
                <DropdownMenu.ItemIndicator>
                  <Check className="h-4 w-4" aria-hidden="true" />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
