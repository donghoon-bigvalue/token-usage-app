import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { UsageHistory } from "./types";

export function getUsageHistory(refresh = false): Promise<UsageHistory> {
  return invoke<UsageHistory>("get_usage_history", { refresh });
}

/**
 * Prompt for a save location and write the usage CSV there.
 * Returns false if the user cancels the dialog.
 */
export async function downloadUsageCsv(): Promise<boolean> {
  const path = await save({
    defaultPath: "token-usage.csv",
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (!path) return false;
  await invoke("export_usage_csv", { path });
  return true;
}
