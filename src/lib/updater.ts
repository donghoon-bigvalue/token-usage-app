import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";

export type UpdateInfo = {
  version: string;
  notes: string;
  update: Update;
};

/** 업데이트가 있으면 정규화된 정보를, 없으면 null을 반환. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const update = await check();
  if (!update) return null;
  return { version: update.version, notes: update.body ?? "", update };
}

/** 다운로드+설치. onProgress는 0..1 진행률(총 크기 불명이면 -1)을 콜백. */
export async function installUpdate(
  info: UpdateInfo,
  onProgress?: (fraction: number) => void
): Promise<void> {
  let downloaded = 0;
  let total: number | null = null;
  await info.update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? null;
        onProgress?.(total ? 0 : -1);
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress?.(total ? downloaded / total : -1);
        break;
      case "Finished":
        onProgress?.(1);
        break;
    }
  });
}

export async function relaunchApp(): Promise<void> {
  await relaunch();
}

export function getCurrentVersion(): Promise<string> {
  return getVersion();
}
