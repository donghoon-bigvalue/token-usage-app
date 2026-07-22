import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";

export type UpdateInfo = {
  version: string;
  notes: string;
  /** 릴리스 노트에 강제 업데이트 마커가 있어 닫을 수 없는 팝업을 띄워야 하는 릴리스. */
  forced: boolean;
  update: Update;
};

// 강제 업데이트 신호는 릴리스 노트 본문에 실어 보낸다 — latest.json의 notes는
// 릴리스 워크플로가 CHANGELOG의 해당 버전 섹션을 그대로 옮긴 값이라,
// CHANGELOG에 마커 한 줄을 넣는 것만으로 배포 경로 변경 없이 전달된다.
// `<!-- force-update -->`는 GitHub 릴리스 페이지에 렌더되지 않아 권장 형태.
const FORCE_MARKER = /<!--\s*force[-_ ]?update\s*-->|\[\s*force[-_ ]?update\s*\]/i;

/** 릴리스 노트에 강제 업데이트 마커가 들어 있는지. */
export function isForcedUpdate(notes: string): boolean {
  return FORCE_MARKER.test(notes);
}

/** 업데이트가 있으면 정규화된 정보를, 없으면 null을 반환. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const update = await check();
  if (!update) return null;
  const notes = update.body ?? "";
  return { version: update.version, notes, forced: isForcedUpdate(notes), update };
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
