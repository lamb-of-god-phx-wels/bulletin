// @vitest-environment jsdom

import { createElement as h } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApplicationShell } from "./ApplicationShell.js";

afterEach(() => cleanup());

describe("ApplicationShell", () => {
  it("provides named navigation, a skip target, current-page state, and keyboard activation", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const { rerender } = render(h(ApplicationShell, {
      currentRoute: "thisWeek",
      onNavigate,
      statusMessage: "All changes saved",
      children: h("section", null, h("h1", null, "This Week"), h("p", null, "Ready to begin.")),
    }));

    expect(screen.getByRole("navigation", { name: "Primary" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "This Week" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Skip to main content" }).getAttribute("href")).toBe("#cbb-main-content");

    const templates = screen.getByRole("button", { name: "Templates" });
    templates.focus();
    await user.keyboard("{Enter}");
    expect(onNavigate).toHaveBeenCalledWith("templates");

    rerender(h(ApplicationShell, {
      currentRoute: "templates",
      onNavigate,
      statusMessage: "All changes saved",
      children: h("section", null, h("h1", null, "Templates")),
    }));
    expect(document.activeElement).toBe(screen.getByRole("main"));
  });

  it("has no automated landmark, naming, or form accessibility violations", async () => {
    const { container } = render(h(ApplicationShell, {
      currentRoute: "help",
      onNavigate: () => undefined,
      children: h("section", { "aria-labelledby": "help-title" }, h("h1", { id: "help-title" }, "Help")),
    }));
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});
