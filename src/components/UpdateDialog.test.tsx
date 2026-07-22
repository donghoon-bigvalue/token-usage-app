import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import i18n from "../i18n";
import { UpdateDialog } from "./UpdateDialog";
import type { UpdaterState } from "../lib/useUpdater";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
import { openUrl } from "@tauri-apps/plugin-opener";

const info = { version: "1.1.0", notes: "release notes", forced: false, update: {} as never };
const forcedInfo = { ...info, notes: "<!-- force-update -->", forced: true };
const RELEASES_URL = "https://github.com/donghoon-bigvalue/token-usage-app/releases";

describe("UpdateDialog", () => {
  // 어서션이 한국어 문구를 기대하므로, 앱 전역 기본값인 "en"과 무관하게
  // 이 스위트에서는 활성 언어를 명시적으로 "ko"로 고정한다.
  beforeEach(() => {
    i18n.changeLanguage("ko");
    vi.clearAllMocks();
  });

  it("renders nothing when idle", () => {
    const { container } = render(
      <UpdateDialog state={{ kind: "idle" }} onInstall={() => {}} onDismiss={() => {}} onRelaunch={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows version and buttons when available", () => {
    const onInstall = vi.fn();
    const onDismiss = vi.fn();
    render(
      <UpdateDialog state={{ kind: "available", info }} onInstall={onInstall} onDismiss={onDismiss} onRelaunch={() => {}} />
    );
    expect(screen.getByText(/1\.1\.0/)).toBeInTheDocument();
    screen.getByRole("button", { name: "자동 업데이트" }).click();
    screen.getByRole("button", { name: "다음에 하기" }).click();
    expect(onInstall).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("opens the releases page from the release-notes link", () => {
    render(
      <UpdateDialog state={{ kind: "available", info }} onInstall={() => {}} onDismiss={() => {}} onRelaunch={() => {}} />
    );
    screen.getByRole("link", { name: "릴리스 노트" }).click();
    expect(openUrl).toHaveBeenCalledWith(
      "https://github.com/donghoon-bigvalue/token-usage-app/releases"
    );
  });

  it("shows progress while downloading", () => {
    const state: UpdaterState = { kind: "downloading", info, fraction: 0.42 };
    render(<UpdateDialog state={state} onInstall={() => {}} onDismiss={() => {}} onRelaunch={() => {}} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
  });

  it("hides the dismiss button and leads to the releases page when forced", () => {
    render(
      <UpdateDialog state={{ kind: "available", info: forcedInfo }} onInstall={() => {}} onDismiss={() => {}} onRelaunch={() => {}} />
    );
    expect(screen.getByRole("dialog", { name: "업데이트가 필요해요" })).toBeInTheDocument();
    expect(screen.getByText(/1\.1\.0/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "다음에 하기" })).toBeNull();
    screen.getByRole("button", { name: "다운로드 페이지 열기" }).click();
    expect(openUrl).toHaveBeenCalledWith(RELEASES_URL);
  });

  it("still offers the in-app install when forced", () => {
    const onInstall = vi.fn();
    render(
      <UpdateDialog state={{ kind: "available", info: forcedInfo }} onInstall={onInstall} onDismiss={() => {}} onRelaunch={() => {}} />
    );
    screen.getByRole("button", { name: "자동 업데이트" }).click();
    expect(onInstall).toHaveBeenCalledOnce();
  });

  it("keeps a forced error dialog closed-off", () => {
    render(
      <UpdateDialog
        state={{ kind: "error", message: "net", forced: true }}
        onInstall={() => {}}
        onDismiss={() => {}}
        onRelaunch={() => {}}
      />
    );
    expect(screen.queryByRole("button", { name: "다음에 하기" })).toBeNull();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
    screen.getByRole("button", { name: "다운로드 페이지 열기" }).click();
    expect(openUrl).toHaveBeenCalledWith(RELEASES_URL);
  });

  it("keeps the dismiss button on a normal error", () => {
    const onDismiss = vi.fn();
    render(
      <UpdateDialog
        state={{ kind: "error", message: "net", forced: false }}
        onInstall={() => {}}
        onDismiss={onDismiss}
        onRelaunch={() => {}}
      />
    );
    screen.getByRole("button", { name: "다음에 하기" }).click();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("offers restart when installed", () => {
    const onRelaunch = vi.fn();
    render(<UpdateDialog state={{ kind: "installed" }} onInstall={() => {}} onDismiss={() => {}} onRelaunch={onRelaunch} />);
    screen.getByRole("button", { name: "지금 재시작" }).click();
    expect(onRelaunch).toHaveBeenCalledOnce();
  });
});
