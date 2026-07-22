import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useUpdater } from "./useUpdater";

vi.mock("./updater", () => ({
  checkForUpdate: vi.fn(),
  installUpdate: vi.fn(),
  relaunchApp: vi.fn(),
}));
vi.mock("./updater-store", () => ({ setDismissedVersion: vi.fn() }));

import { checkForUpdate, installUpdate } from "./updater";
import { setDismissedVersion } from "./updater-store";

const info = { version: "1.1.0", notes: "x", forced: false, update: {} as never };
const forcedInfo = { ...info, notes: "<!-- force-update -->", forced: true };

beforeEach(() => vi.clearAllMocks());

describe("useUpdater", () => {
  it("goes checking -> upToDate when no update", async () => {
    (checkForUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const { result } = renderHook(() => useUpdater());
    await act(async () => { await result.current.check(); });
    expect(result.current.state.kind).toBe("upToDate");
  });

  it("goes to available when an update exists", async () => {
    (checkForUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(info);
    const { result } = renderHook(() => useUpdater());
    await act(async () => { await result.current.check(); });
    expect(result.current.state).toEqual({ kind: "available", info });
  });

  it("errors when check throws", async () => {
    (checkForUpdate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useUpdater());
    await act(async () => { await result.current.check(); });
    expect(result.current.state).toEqual({ kind: "error", message: "boom", forced: false });
  });

  it("dismiss records the version and returns to idle", async () => {
    (checkForUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(info);
    const { result } = renderHook(() => useUpdater());
    await act(async () => { await result.current.check(); });
    act(() => { result.current.dismiss(); });
    expect(setDismissedVersion).toHaveBeenCalledWith("1.1.0");
    expect(result.current.state.kind).toBe("idle");
  });

  it("install transitions downloading -> installed", async () => {
    (checkForUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(info);
    (installUpdate as ReturnType<typeof vi.fn>).mockImplementation(
      async (_i, onProgress) => { onProgress?.(0.5); }
    );
    const { result } = renderHook(() => useUpdater());
    await act(async () => { await result.current.check(); });
    await act(async () => { await result.current.install(); });
    await waitFor(() => expect(result.current.state.kind).toBe("installed"));
  });

  it("dismiss twice only records once", async () => {
    (checkForUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(info);
    const { result } = renderHook(() => useUpdater());
    await act(async () => { await result.current.check(); });
    act(() => { result.current.dismiss(); });
    act(() => { result.current.dismiss(); });
    expect(setDismissedVersion).toHaveBeenCalledTimes(1);
  });

  it("refuses to dismiss a forced update", async () => {
    (checkForUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(forcedInfo);
    const { result } = renderHook(() => useUpdater());
    await act(async () => { await result.current.check(); });
    act(() => { result.current.dismiss(); });
    expect(setDismissedVersion).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ kind: "available", info: forcedInfo });
  });

  it("keeps the forced flag when a forced install fails", async () => {
    (checkForUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(forcedInfo);
    (installUpdate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("net"));
    const { result } = renderHook(() => useUpdater());
    await act(async () => { await result.current.check(); });
    await act(async () => { await result.current.install(); });
    expect(result.current.state).toEqual({ kind: "error", message: "net", forced: true });
  });

  it("does not reinstall after a completed install", async () => {
    (checkForUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(info);
    (installUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { result } = renderHook(() => useUpdater());
    await act(async () => { await result.current.check(); });
    await act(async () => { await result.current.install(); });
    await act(async () => { await result.current.install(); });
    expect(installUpdate).toHaveBeenCalledTimes(1);
    expect(result.current.state.kind).toBe("installed");
  });
});
