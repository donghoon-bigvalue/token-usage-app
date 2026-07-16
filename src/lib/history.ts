import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { UsageHistory } from "./types";

export function getUsageHistory(refresh = false): Promise<UsageHistory> {
  return invoke<UsageHistory>("get_usage_history", { refresh });
}

/**
 * Prompt for a save location and write the usage workbook there.
 * Returns false if the user cancels the dialog; rejects if the export fails,
 * so the caller can show the reason rather than failing silently.
 */
export async function downloadUsageXlsx(): Promise<boolean> {
  const path = await save({
    defaultPath: "token-usage.xlsx",
    filters: [{ name: "Excel", extensions: ["xlsx"] }],
  });
  if (!path) return false;
  await invoke("export_usage_xlsx", { path });
  return true;
}
