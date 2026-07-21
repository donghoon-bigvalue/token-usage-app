/**
 * Presentation-only CSS injected at capture time.
 *
 * A browser tab has no window chrome, so these rules put the app back in
 * something window-shaped: a rounded panel with a title bar, floating on a
 * desktop-like backdrop. Nothing here ships in the app — it exists so the
 * README images read as "a desktop app" rather than "a web page".
 */

/**
 * The app inherits `system-ui`, which on this Linux capture host has no Hangul
 * and silently falls back to a CJK font whose Korean glyphs look wrong. Real
 * users get Malgun Gothic / Apple SD Gothic Neo from the same declaration, so
 * pinning a proper Korean face here makes the screenshot *more* faithful, not
 * less.
 */
const FONT = `*, *::before, *::after {
  font-family: "Noto Sans KR", "Noto Sans", system-ui, sans-serif !important;
}`;

const BACKDROP: Record<"dark" | "light", string> = {
  dark: "radial-gradient(120% 130% at 50% 0%, #3d3d45 0%, #17171a 62%)",
  light: "radial-gradient(120% 130% at 50% 0%, #e9eaf0 0%, #c7c9d4 70%)",
};

const SHADOW = "0 26px 64px rgba(0, 0, 0, .5), 0 2px 10px rgba(0, 0, 0, .35)";

/** Window frame for the main app page. */
export function mainFrameCss(theme: "dark" | "light"): string {
  return `${FONT}
body {
  padding: 34px 26px;
  background: ${BACKDROP[theme]};
}
.app {
  position: relative;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: ${SHADOW};
  /* Room at the top for the title bar drawn by ::before. */
  padding: 46px 18px 20px;
  overflow: hidden;
}
.app::before {
  content: "";
  position: absolute;
  inset: 0 0 auto 0;
  height: 32px;
  background: var(--card);
  border-bottom: 1px solid var(--border);
}
/* Three window buttons, drawn with one box and two shadows. */
.app::after {
  content: "";
  position: absolute;
  top: 12px;
  left: 15px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #ff5f57;
  box-shadow: 15px 0 0 #febc2e, 30px 0 0 #28c840;
}`;
}

/** The widget is its own small window: no title bar to fake, just a shadow. */
export function widgetFrameCss(): string {
  return `${FONT}
body {
  padding: 40px;
  background: ${BACKDROP.dark};
}
.widget {
  /* The real window is 260px wide; in a tab nothing constrains it. */
  width: 260px;
  margin: 0 auto;
  box-shadow: ${SHADOW};
}`;
}

/**
 * Tour-only: the widget lives in a separate page, so the recording floats it
 * over the main window in an iframe — the way it actually sits on a desktop.
 */
export function tourWidgetCss(): string {
  return `.tour-widget {
  position: fixed;
  right: 34px;
  bottom: 34px;
  width: 262px;
  border: 0;
  border-radius: 12px;
  box-shadow: ${SHADOW};
  opacity: 0;
  transform: translateY(10px);
  transition: opacity .45s ease, transform .45s ease;
  z-index: 10;
}
.tour-widget.is-shown {
  opacity: 1;
  transform: none;
}`;
}
