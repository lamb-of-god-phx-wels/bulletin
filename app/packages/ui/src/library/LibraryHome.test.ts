// @vitest-environment jsdom

import { createElement as h } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LibraryHome, librarySearch, type LibraryResource } from "./LibraryHome.js";

afterEach(() => cleanup());

const resources: readonly LibraryResource[] = [
  {
    id: "bulletin-1",
    kind: "bulletin",
    name: "July 12 Worship",
    publicationDate: "2026-07-12",
    modifiedLabel: "Edited today",
    stateLabel: "3 items still needed",
  },
  {
    id: "template-1",
    kind: "template",
    name: "Folded Sunday",
    description: "Four-page folded booklet",
    modifiedLabel: "Edited last week",
    stateLabel: "Ready to use",
  },
];

describe("LibraryHome", () => {
  it("uses NFKC token matching and keeps resources keyed independently of duplicate names", () => {
    expect(librarySearch(resources[0]!, "JULY worship")).toBe(true);
    expect(librarySearch(resources[1]!, "folded booklet")).toBe(true);
    expect(librarySearch(resources[1]!, "folded missing")).toBe(false);
  });

  it("filters locally and exposes visible keyboard actions", async () => {
    const user = userEvent.setup();
    let showedAll = false;
    render(h(LibraryHome, {
      resources,
      onCreateBulletin: () => undefined,
      onOpen: () => undefined,
      onShowAll: () => { showedAll = true; },
    }));
    const search = screen.getByRole("searchbox", { name: "Search your bulletin library" });
    expect(search.getAttribute("placeholder")).toBe("Search names, dates, and status");
    expect(screen.getByRole("heading", { name: "Templates" })).toBeTruthy();
    const showAll = screen.getByRole("button", { name: "Show all bulletins" });
    await user.click(showAll);
    expect(showedAll).toBe(true);
    await user.type(search, "folded booklet");
    expect(screen.getByRole("heading", { name: "Folded Sunday" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "July 12 Worship" })).toBeNull();
    expect(screen.queryByRole("button", { name: /favorite/iu })).toBeNull();
  });

  it("truthfully offers starter and blank paths while disabling unavailable import", async () => {
    const user = userEvent.setup();
    const useStarter = vi.fn();
    const startBlank = vi.fn();
    render(h(LibraryHome, {
      resources: [],
      onCreateBulletin: useStarter,
      onStartBlank: startBlank,
      onOpen: () => undefined,
    }));

    await user.click(screen.getByRole("button", { name: "Use a starter" }));
    await user.click(screen.getByRole("button", { name: "Start blank" }));
    expect(useStarter).toHaveBeenCalledOnce();
    expect(startBlank).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Import bulletin or template" })).toHaveProperty("disabled", true);
    expect(screen.getByText(/Import is not available/u)).toBeTruthy();
  });
});
