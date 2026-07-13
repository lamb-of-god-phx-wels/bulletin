// @vitest-environment jsdom

import { createElement as h } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import { HelpCenter } from "./HelpCenter.js";

afterEach(cleanup);

describe("HelpCenter", () => {
  it("relates each topic to the article and focuses the chosen article heading", async () => {
    const user = userEvent.setup();
    render(h(HelpCenter));

    const topic = screen.getByRole("button", { name: "Create and test a template" });
    expect(topic.getAttribute("aria-controls")).toBe("cbb-help-article");
    await user.click(topic);

    const heading = screen.getByRole("heading", { name: "Create and test a template" });
    expect(document.activeElement).toBe(heading);
    expect(topic.getAttribute("aria-current")).toBe("true");
  });

  it("has no automated landmark, naming, or form accessibility violations", async () => {
    const { container } = render(h(HelpCenter));
    const report = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(report.violations).toEqual([]);
  });

  it("describes only the rich-text formatting the direct editor supports", async () => {
    const user = userEvent.setup();
    render(h(HelpCenter));
    await user.click(screen.getByRole("button", { name: "Edit and format text" }));

    expect(screen.getByText(/headings, bold, italic, bulleted or numbered lists, and block quotes/u))
      .toBeTruthy();
    expect(screen.queryByText(/lists, and links/u)).toBeNull();
  });
});
