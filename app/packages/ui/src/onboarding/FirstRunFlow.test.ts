// @vitest-environment jsdom

import { createElement as h } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FirstRunFlow } from "./FirstRunFlow.js";

afterEach(() => cleanup());

describe("FirstRunFlow", () => {
  it("is skippable and never strands a keyboard user in an empty starter chooser", async () => {
    const user = userEvent.setup();
    const onSkip = vi.fn();
    const onComplete = vi.fn();
    render(h(FirstRunFlow, { onComplete, onSkip }));

    expect(screen.getByRole("button", { name: "Skip setup" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Choose a starter" }));
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    expect(screen.getByRole("radio", { name: /Folded letter booklet/u })).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: /Folded letter booklet/u }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Ready for your first bulletin" }));
    await user.click(screen.getByRole("button", { name: "Finish setup" }));

    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
      starterId: "folded-letter",
      preferredOutput: "fullSheet",
      createPracticeBulletin: true,
    }));
  });

  it("announces and focuses each step without automated accessibility violations", async () => {
    const user = userEvent.setup();
    const { container } = render(h(FirstRunFlow, {
      onComplete: () => undefined,
      onSkip: () => undefined,
    }));

    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Tell us about your weekly bulletin" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("status").textContent).toContain("Step 2 of 3: Choose a starter");

    const report = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(report.violations).toEqual([]);
  });

  it("keeps alternate workspace location under an explicitly named Advanced section", async () => {
    const user = userEvent.setup();
    const onChooseWorkspaceLocation = vi.fn();
    render(h(FirstRunFlow, {
      onComplete: () => undefined,
      onSkip: () => undefined,
      onChooseWorkspaceLocation,
    }));
    await user.click(screen.getByText("Advanced"));
    await user.click(screen.getByRole("button", { name: "Choose another location" }));
    expect(onChooseWorkspaceLocation).toHaveBeenCalledOnce();
  });

  it("imports an optional managed logo and includes only its asset identity in progress and completion", async () => {
    const user = userEvent.setup();
    const onProgress = vi.fn();
    const onComplete = vi.fn();
    const onImportLogo = vi.fn(async () => ({
      assetRef: "asset:40000000-0000-4000-8000-000000000004",
      displayName: "Church mark",
    }));
    render(h(FirstRunFlow, {
      onComplete,
      onSkip: () => undefined,
      onProgress,
      onImportLogo,
    }));

    await user.click(screen.getByRole("button", { name: "Import logo" }));
    expect(await screen.findByText("Church mark is selected for Church Profile.")).toBeTruthy();
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({
      logo: "asset:40000000-0000-4000-8000-000000000004",
    }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Finish setup" }));
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
      logo: "asset:40000000-0000-4000-8000-000000000004",
    }));
    expect(JSON.stringify(onComplete.mock.calls)).not.toMatch(/\/home|file:\/\//u);
  });

  it("keeps setup navigation disabled until a managed logo import settles", async () => {
    const user = userEvent.setup();
    let finishImport: ((value: { assetRef: string; displayName: string }) => void) | undefined;
    const onImportLogo = vi.fn(() => new Promise<{ assetRef: string; displayName: string }>((resolve) => {
      finishImport = resolve;
    }));
    render(h(FirstRunFlow, {
      onComplete: () => undefined,
      onSkip: () => undefined,
      onImportLogo,
    }));

    await user.click(screen.getByRole("button", { name: "Import logo" }));
    expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Skip setup" })).toHaveProperty("disabled", true);
    finishImport?.({
      assetRef: "asset:40000000-0000-4000-8000-000000000004",
      displayName: "Church mark",
    });
    expect(await screen.findByText("Church mark is selected for Church Profile.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty("disabled", false);
  });

  it("restores a durable step and bounded Church Profile answers, then emits later progress", async () => {
    const user = userEvent.setup();
    const onProgress = vi.fn();
    render(h(FirstRunFlow, {
      onComplete: () => undefined,
      onSkip: () => undefined,
      onProgress,
      initialValue: {
        version: 1,
        disposition: "inProgress",
        step: 1,
        churchName: "Lamb of God",
        mailingAddress: "2210 E. Indian School Road",
        preferredOutput: "foldedBooklet",
        starterId: "folded-letter",
        createPracticeBulletin: false,
      },
    }));

    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Choose a starter" }));
    expect(screen.getByRole("radio", { name: /Folded letter booklet/u })).toHaveProperty("checked", true);
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Church or congregation name (optional)")).toHaveProperty("value", "Lamb of God");
    expect(screen.getByLabelText("Mailing address")).toHaveProperty("value", "2210 E. Indian School Road");
    await user.type(screen.getByLabelText("Phone"), "602-555-0100");
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({
      disposition: "inProgress",
      step: 0,
      churchName: "Lamb of God",
      phone: "602-555-0100",
      preferredOutput: "foldedBooklet",
      starterId: "folded-letter",
      createPracticeBulletin: false,
    }));
  });
});
