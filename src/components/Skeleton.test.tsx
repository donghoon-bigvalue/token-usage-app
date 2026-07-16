import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Skeleton } from "./Skeleton";
import { Spinner } from "./Spinner";

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
