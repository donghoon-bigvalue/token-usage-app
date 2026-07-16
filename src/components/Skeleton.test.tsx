import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Skeleton } from "./Skeleton";
import { Spinner } from "./Spinner";
import { ProviderCardSkeleton } from "./ProviderCardSkeleton";
import { HistorySkeleton } from "./HistorySkeleton";

describe("Skeleton", () => {
  it("is decorative — the container carries the loading announcement", () => {
    const { container } = render(<Skeleton width="80px" />);
    const el = container.firstChild as HTMLElement;
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.className).toContain("skeleton");
  });

  it("applies the given dimensions", () => {
    const { container } = render(<Skeleton width="50%" height={8} radius={4} />);
    const el = container.firstChild as HTMLElement;
    expect(el.style.width).toBe("50%");
    expect(el.style.height).toBe("8px");
    expect(el.style.borderRadius).toBe("4px");
  });
});

describe("Spinner", () => {
  it("renders whether or not it is spinning, so the button width never shifts", () => {
    const { rerender, container } = render(<Spinner spinning={false} />);
    const el = () => container.firstChild as HTMLElement;
    expect(el().textContent).toBe("↻");
    expect(el().className).not.toContain("spinner--on");

    rerender(<Spinner spinning={true} />);
    expect(el().textContent).toBe("↻");
    expect(el().className).toContain("spinner--on");
  });

  it("is decorative — the button's own label carries the meaning", () => {
    const { container } = render(<Spinner spinning={true} />);
    expect((container.firstChild as HTMLElement).getAttribute("aria-hidden")).toBe("true");
  });

  it("shows a custom idle glyph at rest, and the busy glyph once spinning", () => {
    const { rerender, container } = render(<Spinner spinning={false} idle="⬇" />);
    const el = () => container.firstChild as HTMLElement;
    expect(el().textContent).toBe("⬇");

    rerender(<Spinner spinning={true} idle="⬇" />);
    expect(el().textContent).toBe("↻");
  });
});

describe("ProviderCardSkeleton", () => {
  it("wires the flex-row height modifier classes that theme.css uses to reserve the real text line box", () => {
    // These rows take their height from their children, so without the
    // modifier the card grows when data lands — the shift a skeleton exists
    // to prevent. jsdom has no layout engine, so this can only confirm the
    // modifier classes CSS hangs its `height` rule off are present — not that
    // the pixel heights actually match. Deleting the `height` rule in
    // theme.css would still pass this test; that has to be caught by a
    // browser re-measurement instead.
    const { container } = render(<ProviderCardSkeleton bars={3} />);
    expect(container.querySelector(".provider-card__head--skeleton")).not.toBeNull();
    expect(container.querySelectorAll(".limit-bar__row--skeleton")).toHaveLength(3);
  });
});

describe("HistorySkeleton", () => {
  it("reserves a download-button placeholder, since the real button is otherwise absent", () => {
    // The skeleton previously had no counterpart for `.history-download` at
    // all, so the button's height (plus the gap before it) appeared out of
    // nowhere when data landed. This asserts the placeholder exists.
    const { container } = render(<HistorySkeleton />);
    expect(container.querySelector(".history-skeleton__download")).not.toBeNull();
  });

  it("wires the title, note, and card-row height modifier classes that theme.css uses to reserve the real text line box", () => {
    // Same wiring as ProviderCardSkeleton: these containers take their height
    // from children, so without the modifiers the view grows when the bare
    // skeleton blocks are replaced by real text's taller line box. As above,
    // this only guards the classes' presence, not the pixel values.
    const { container } = render(<HistorySkeleton />);
    expect(container.querySelector(".history-skeleton__title")).not.toBeNull();
    expect(container.querySelector(".history-skeleton__note")).not.toBeNull();
    expect(container.querySelectorAll(".history-skeleton__card-title")).toHaveLength(2);
    expect(container.querySelectorAll(".history-skeleton__card-tokens")).toHaveLength(2);
    expect(container.querySelectorAll(".history-skeleton__card-cost")).toHaveLength(2);
  });
});
