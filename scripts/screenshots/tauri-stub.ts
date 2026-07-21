/**
 * A stand-in for the Rust backend.
 *
 * The whole frontend reaches the backend through `window.__TAURI_INTERNALS__`
 * (`@tauri-apps/api` is a thin wrapper over it), so replacing that one object
 * lets the real `index.html` / `widget.html` render fixture data in a plain
 * browser — no cargo build, no Claude/Codex credentials.
 *
 * Injected with Playwright's `addInitScript`, which runs it before the page's
 * own scripts, so the app finds the stub already in place at bootstrap.
 */

/** Where the stub records commands it doesn't implement, read back after capture. */
export const WARNINGS_KEY = "__STUB_UNHANDLED__";

/**
 * Runs in the browser, shipped there via `Function.prototype.toString()`.
 * It therefore closes over *nothing* — every value it needs arrives in
 * `fixtures`, and constants like `WARNINGS_KEY` are spelled out literally.
 */
export function installTauriStub(fixtures: any): void {
  const w = window as any;
  const unhandled: string[] = [];
  w["__STUB_UNHANDLED__"] = unhandled;

  // Settings live in localStorage rather than a closure variable so the main
  // window and the widget iframe — separate documents, one stub each — agree on
  // theme and language, the way they do in the real app.
  const SETTINGS_KEY = "__STUB_SETTINGS__";
  const readSettings = () => {
    const saved = localStorage.getItem(SETTINGS_KEY);
    return saved ? JSON.parse(saved) : { ...fixtures.settings };
  };
  const writeSettings = (next: any) => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    return next;
  };

  const callbacks: Record<number, (payload: unknown) => void> = {};
  let nextId = 1;

  function invoke(cmd: string, args: any) {
    switch (cmd) {
      case "get_usage":
        return Promise.resolve(fixtures.usage);
      case "get_settings":
        return Promise.resolve(readSettings());
      case "set_settings":
        return Promise.resolve(writeSettings({ ...readSettings(), ...(args?.settings ?? {}) }));
      case "get_usage_history":
        return Promise.resolve(fixtures.history);
      // Subscriptions only need to succeed; the fixture never pushes updates.
      case "plugin:event|listen":
        return Promise.resolve(nextId++);
      case "plugin:event|unlisten":
      case "plugin:event|emit":
      case "plugin:event|emit_to":
        return Promise.resolve();
      // The widget toggle and "open main window" have no browser equivalent.
      case "toggle_widget":
      case "show_main":
        return Promise.resolve();
      default:
        // The widget resizes and hides its own window; in a tab that's a no-op
        // and the capture script fixes its width in CSS instead.
        if (cmd.startsWith("plugin:window|") || cmd.startsWith("plugin:webview|")) {
          return Promise.resolve();
        }
        // Anything else is a command added since this stub was written. Record
        // it so the capture fails loudly instead of quietly saving a broken
        // screenshot.
        unhandled.push(cmd);
        return Promise.reject(new Error("stub: unhandled command " + cmd));
    }
  }

  w.__TAURI_INTERNALS__ = {
    invoke,
    transformCallback(callback: (payload: unknown) => void, once: boolean) {
      const id = nextId++;
      callbacks[id] = (payload) => {
        if (once) delete callbacks[id];
        callback(payload);
      };
      return id;
    },
    unregisterCallback(id: number) {
      delete callbacks[id];
    },
    convertFileSrc(path: string) {
      return path;
    },
    // `getCurrentWindow()` reads its label straight off this.
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { windowLabel: "main", label: "main" },
    },
  };

  // Unlistening goes through its own global rather than `invoke`, and React
  // effect cleanup hits it on every unmount.
  w.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener(_event: string, _id: number) {},
  };
}
