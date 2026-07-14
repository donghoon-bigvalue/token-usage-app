import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "../i18n";
import { SettingsPanel } from "./SettingsPanel";
import type { Settings } from "../lib/types";

const wrap = (ui: React.ReactNode) => <I18nextProvider i18n={i18n}>{ui}</I18nextProvider>;
const s: Settings = { language: "en", theme: "system", refresh_interval_secs: 60, notify_thresholds: [80, 100] };

describe("SettingsPanel", () => {
  it("emits language change", () => {
    const onChange = vi.fn();
    render(wrap(<SettingsPanel settings={s} onChange={onChange} onClose={() => {}} />));
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "ko" } });
    expect(onChange).toHaveBeenCalledWith({ ...s, language: "ko" });
  });

  it("emits theme change", () => {
    const onChange = vi.fn();
    render(wrap(<SettingsPanel settings={s} onChange={onChange} onClose={() => {}} />));
    fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "dark" } });
    expect(onChange).toHaveBeenCalledWith({ ...s, theme: "dark" });
  });
});
