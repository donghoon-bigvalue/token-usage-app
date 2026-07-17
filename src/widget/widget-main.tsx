import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import i18n from "../i18n";
import { applyTheme } from "../theme";
import { getSettings } from "../lib/settings";
import { WidgetApp } from "./WidgetApp";
import "../styles/theme.css";
import "./widget.css";

// Mirrors App's init: the widget follows the same saved theme and language.
function Root() {
  const [locale, setLocale] = useState<"en" | "ko">("en");
  useEffect(() => {
    getSettings().then((s) => {
      applyTheme(s.theme);
      i18n.changeLanguage(s.language);
      setLocale(s.language);
    });
  }, []);
  return <WidgetApp locale={locale} />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
