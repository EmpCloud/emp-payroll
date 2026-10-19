import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Check } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { getNotifications, type Notification } from "@/components/ui/NotificationBell";
import { useTranslation } from "react-i18next";

type Filter = "all" | "unread";

export function NotificationsPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage || i18n.language;
  const navigate = useNavigate();
  const [items, setItems] = useState<Notification[]>(() => getNotifications(t, language));
  const [filter, setFilter] = useState<Filter>("all");

  const visible = useMemo(
    () => (filter === "unread" ? items.filter((n) => !n.read) : items),
    [items, filter],
  );

  const unreadCount = items.filter((n) => !n.read).length;

  useEffect(() => {
    setItems(getNotifications(t, language));
  }, [language, t]);

  function markOneAsRead(id: string) {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }

  function markAllAsRead() {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  function handleClick(n: Notification) {
    markOneAsRead(n.id);
    if (n.link) navigate(n.link);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("notificationsPage.title")}
        description={t("notificationsPage.description")}
        actions={
          unreadCount > 0 ? (
            <Button variant="outline" size="sm" onClick={markAllAsRead}>
              <Check className="h-4 w-4" /> {t("notificationsPage.markAllRead")}
            </Button>
          ) : null
        }
      />

      {/* Filter tabs */}
      <div className="flex items-center gap-2 border-b border-gray-200">
        <button
          onClick={() => setFilter("all")}
          className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
            filter === "all"
              ? "border-brand-600 text-brand-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          {t("notificationsPage.tabs.all", { count: items.length })}
        </button>
        <button
          onClick={() => setFilter("unread")}
          className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
            filter === "unread"
              ? "border-brand-600 text-brand-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          {t("notificationsPage.tabs.unread", { count: unreadCount })}
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 bg-white px-6 py-16 text-center">
          <Bell className="h-10 w-10 text-gray-300" />
          <h3 className="mt-3 text-sm font-medium text-gray-900">
            {filter === "unread"
              ? t("notificationsPage.empty.noUnread")
              : t("notificationsPage.empty.none")}
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            {filter === "unread"
              ? t("notificationsPage.empty.caughtUp")
              : t("notificationsPage.empty.updatesHere")}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {visible.map((n) => {
            const Icon = n.icon;
            return (
              <li key={n.id}>
                <button
                  onClick={() => handleClick(n)}
                  className={`flex w-full items-start gap-4 px-5 py-4 text-left transition-colors hover:bg-gray-50 ${
                    !n.read ? "bg-brand-50/30" : ""
                  }`}
                >
                  <div
                    className={`mt-0.5 rounded-full p-2 ${
                      !n.read ? "bg-brand-100" : "bg-gray-100"
                    }`}
                  >
                    <Icon className={`h-5 w-5 ${!n.read ? "text-brand-600" : "text-gray-400"}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p
                        className={`text-sm ${
                          !n.read ? "font-semibold text-gray-900" : "font-medium text-gray-700"
                        }`}
                      >
                        {n.title}
                      </p>
                      <span className="shrink-0 text-xs text-gray-400">{n.time}</span>
                    </div>
                    <p className="mt-1 text-sm text-gray-500">{n.description}</p>
                  </div>
                  {!n.read && <span className="bg-brand-500 mt-2 h-2 w-2 shrink-0 rounded-full" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
