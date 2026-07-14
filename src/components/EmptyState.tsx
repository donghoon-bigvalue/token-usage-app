import { useTranslation } from "react-i18next";

export function EmptyState({ providerName }: { providerName: string }) {
  const { t } = useTranslation();
  return <div className="empty-state">{t("provider.connect", { name: providerName })}</div>;
}
