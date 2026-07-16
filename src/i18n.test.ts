import { describe, it, expect } from "vitest";
import i18n from "./i18n";

describe("i18n", () => {
  it("has english label for claude session", () => {
    expect(i18n.getFixedT("en")("window.claude_session")).toBe("Current session");
  });
  it("has korean label for codex weekly", () => {
    expect(i18n.getFixedT("ko")("window.codex_weekly")).toBe("주간 한도");
  });
  it("has loading keys in both locales", () => {
    expect(i18n.getFixedT("en")("app.loading")).toBe("Loading");
    expect(i18n.getFixedT("ko")("app.loading")).toBe("불러오는 중");
  });
  it("has load-failure keys in both locales", () => {
    expect(i18n.getFixedT("en")("app.loadFailed")).toBe("Couldn't load usage");
    expect(i18n.getFixedT("ko")("app.loadFailed")).toBe("사용량을 불러오지 못했어요");
  });
});
