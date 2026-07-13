// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageReplacementReview } from "./ImageReplacementReview.js";

afterEach(cleanup);

describe("ImageReplacementReview", () => {
  it("defaults to center and retains the old crop only after an explicit preview choice", async () => {
    const confirm = vi.fn();
    const { container } = render(
      <ImageReplacementReview
        source="blob:cbb-new-image"
        displayName="New church photo"
        fit="cover"
        currentFocalPoint={{ x: 0.2, y: 0.8 }}
        destinationAspectRatio={2}
        alt="Church exterior"
        decorative={false}
        onCancel={() => undefined}
        onConfirm={confirm}
      />,
    );
    const center = screen.getByRole("radio", { name: "Start this image at the center" }) as HTMLInputElement;
    const keep = screen.getByRole("radio", { name: "Keep current crop point" }) as HTMLInputElement;
    const preview = container.querySelector<HTMLElement>(".cbb-image-replacement-review__preview");
    expect(preview?.style.aspectRatio).toBe("2");
    expect(preview?.style.minHeight).toBe("0");
    expect(center.checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Apply replacement" }));
    expect(confirm).toHaveBeenLastCalledWith({ x: 0.5, y: 0.5 });

    fireEvent.click(keep);
    expect(keep.checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Apply replacement" }));
    expect(confirm).toHaveBeenLastCalledWith({ x: 0.2, y: 0.8 });
    expect(screen.getByText("Current description: Church exterior")).toBeTruthy();
    const report = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(report.violations).toEqual([]);
  });
});
