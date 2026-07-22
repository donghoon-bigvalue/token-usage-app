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

const info = { version: "1.1.0", notes: "x", update: {} as never };

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
});
