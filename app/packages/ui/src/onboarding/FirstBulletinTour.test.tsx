// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FirstBulletinTour } from "./FirstBulletinTour.js";

afterEach(cleanup);

describe("FirstBulletinTour", () => {
  it("walks through the editor in task language and finishes", async () => {
    const user = userEvent.setup();
    const finish = vi.fn();
    render(<FirstBulletinTour onFinish={finish} />);
    expect(screen.getByRole("heading", { name: "Fill this week’s content" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Customize the layout when needed" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Finish tour" }));
    expect(finish).toHaveBeenCalledOnce();
  });

  it("is immediately skippable", async () => {
    const user = userEvent.setup();
    const finish = vi.fn();
    render(<FirstBulletinTour onFinish={finish} />);
    await user.click(screen.getByRole("button", { name: "Skip tour" }));
    expect(finish).toHaveBeenCalledOnce();
  });
});
