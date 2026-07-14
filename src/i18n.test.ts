import { describe, it, expect } from "vitest";
import i18n from "./i18n";

describe("i18n", () => {
  it("has english label for claude session", () => {
    expect(i18n.getFixedT("en")("window.claude_session")).toBe("Current session");
  });
  it("has korean label for codex weekly", () => {
    expect(i18n.getFixedT("ko")("window.codex_weekly")).toBe("주간 한도");
  });
});
