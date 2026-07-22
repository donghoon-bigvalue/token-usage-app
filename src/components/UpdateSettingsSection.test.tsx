import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "../i18n";
import i18n from "../i18n";
import { UpdateSettingsSection } from "./UpdateSettingsSection";

vi.mock("../lib/updater", () => ({
  checkForUpdate: vi.fn(),
  installUpdate: vi.fn(),
  relaunchApp: vi.fn(),
  getCurrentVersion: vi.fn().mockResolvedValue("1.0.4"),
}));
vi.mock("../lib/updater-store", () => ({ setDismissedVersion: vi.fn() }));

import { checkForUpdate } from "../lib/updater";

beforeEach(() => {
  vi.clearAllMocks();
  i18n.changeLanguage("ko");
});
afterEach(() => i18n.changeLanguage("en"));

describe("UpdateSettingsSection", () => {
  it("shows the current version", async () => {
    render(<UpdateSettingsSection />);
    await waitFor(() => expect(screen.getByText(/1\.0\.4/)).toBeInTheDocument());
  });

  it("says up to date when no update", async () => {
    (checkForUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    render(<UpdateSettingsSection />);
    screen.getByRole("button", { name: "업데이트 확인" }).click();
    await waitFor(() =>
      expect(screen.getByText("최신 버전을 사용 중입니다.")).toBeInTheDocument()
    );
  });

  it("shows an update when available", async () => {
    (checkForUpdate as ReturnType<typeof vi.fn>).mockResolvedValue({
      version: "1.1.0", notes: "", update: {},
    });
    render(<UpdateSettingsSection />);
    screen.getByRole("button", { name: "업데이트 확인" }).click();
    await waitFor(() =>
      expect(screen.getByText(/업데이트가 있습니다 \(v1\.1\.0\)/)).toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: "자동 업데이트" })).toBeInTheDocument();
  });
});
