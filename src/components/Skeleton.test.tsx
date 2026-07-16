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
});

describe("ProviderCardSkeleton", () => {
  it("reserves the real text line box on its flex rows", () => {
    // These rows take their height from their children, so without the
    // modifier the card grows when data lands — the shift a skeleton exists
    // to prevent. jsdom can't see the pixels; this guards the wiring the CSS
    // hangs off.
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
    expect(container.querySelector(".history-download--skeleton")).not.toBeNull();
  });

  it("reserves the real text line box on its title, note, and card rows", () => {
    // Same wiring as ProviderCardSkeleton: these containers take their height
    // from children, so without the modifiers the view grows when the bare
    // skeleton blocks are replaced by real text's taller line box.
    const { container } = render(<HistorySkeleton />);
    expect(container.querySelector(".history-title--skeleton")).not.toBeNull();
    expect(container.querySelector(".history-note--skeleton")).not.toBeNull();
    expect(container.querySelectorAll(".history-card-title--skeleton")).toHaveLength(2);
    expect(container.querySelectorAll(".history-card-tokens--skeleton")).toHaveLength(2);
    expect(container.querySelectorAll(".history-card-cost--skeleton")).toHaveLength(2);
  });
});
