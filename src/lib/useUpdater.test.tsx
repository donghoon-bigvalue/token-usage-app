import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useUpdater } from "./useUpdater";

vi.mock("./updater", () => ({
  checkForUpdate: vi.fn(),
  installUpdate: vi.fn(),
  relaunchApp: vi.fn(),
  getCurrentVersion: vi.fn().mockResolvedValue("1.0.4"),
}));
vi.mock("./updater-store", () => ({ setDismissedVersion: vi.fn() }));
// 버전 비교는 실제 구현을 쓰고, 네트워크를 타는 정책 조회만 대체한다.
vi.mock("./remote-config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./remote-config")>()),
  fetchForcePolicy: vi.fn().mockResolvedValue(null),
}));

import { checkForUpdate, installUpdate } from "./updater";
import { setDismissedVersion } from "./updater-store";
import { fetchForcePolicy } from "./remote-config";

const info = { version: "1.1.0", notes: "x", update: {} as never };
const policy = { minimumVersion: "1.0.5", messages: { ko: "가", en: "a" } };

/** 현재 버전(1.0.4)이 최소 요구(1.0.5) 미만이 되도록 정책을 켠다. */
const armForce = () =>
  (fetchForcePolicy as ReturnType<typeof vi.fn>).mockResolvedValue(policy);

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
    expect(result.current.state).toEqual({ kind: "available", info, force: undefined });
  });

  it("errors when check throws", async () => {
    (checkForUpdate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useUpdater());
    await act(async () => { await result.current.check(); });
    expect(result.current.state).toEqual({ kind: "error", message: "boom" });
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

  it("does not force when the config repo has no policy", async () => {
    (checkForUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(info);
    const { result } = renderHook(() => useUpdater());
    let forced: boolean | undefined;
    await act(async () => { forced = await result.current.enforce(); });
    expect(forced).toBe(false);
    expect(result.current.state.kind).toBe("idle"); // 확인조차 하지 않는다
  });

  it("does not force when the current version already meets the minimum", async () => {
    (fetchForcePolicy as ReturnType<typeof vi.fn>).mockResolvedValue({
      minimumVersion: "1.0.0", messages: null,
    });
    const { result } = renderHook(() => useUpdater());
    let forced: boolean | undefined;
    await act(async () => { forced = await result.current.enforce(); });
    expect(forced).toBe(false);
    expect(checkForUpdate).not.toHaveBeenCalled();
  });

  it("forces and checks for an update when below the minimum", async () => {
    armForce();
    (checkForUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(info);
    const { result } = renderHook(() => useUpdater());
    let forced: boolean | undefined;
    await act(async () => { forced = await result.current.enforce(); });
    expect(forced).toBe(true);
    expect(result.current.state).toEqual({ kind: "available", info, force: policy });
  });

  it("blocks instead of clearing when forced with no update to install", async () => {
    armForce();
    (checkForUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const { result } = renderHook(() => useUpdater());
    await act(async () => { await result.current.enforce(); });
    expect(result.current.state).toEqual({ kind: "blocked", force: policy });
  });

  it("blocks instead of erroring when a forced check fails", async () => {
    armForce();
    (checkForUpdate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useUpdater());
    await act(async () => { await result.current.enforce(); });
    expect(result.current.state).toEqual({ kind: "blocked", force: policy });
  });

  it("refuses to dismiss a forced update", async () => {
    armForce();
    (checkForUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(info);
    const { result } = renderHook(() => useUpdater());
    await act(async () => { await result.current.enforce(); });
    act(() => { result.current.dismiss(); });
    expect(setDismissedVersion).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ kind: "available", info, force: policy });
  });

  it("keeps the force policy when a forced install fails", async () => {
    armForce();
    (checkForUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(info);
    (installUpdate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("net"));
    const { result } = renderHook(() => useUpdater());
    await act(async () => { await result.current.enforce(); });
    await act(async () => { await result.current.install(); });
    expect(result.current.state).toEqual({ kind: "error", message: "net", force: policy });
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
