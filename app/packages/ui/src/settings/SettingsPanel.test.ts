// @vitest-environment jsdom

import { createElement as h, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_UI_SETTINGS, SettingsPanel } from "./SettingsPanel.js";

afterEach(() => cleanup());

function ControlledSettings(props: { readonly onSave: () => void }) {
  const [value, setValue] = useState(DEFAULT_UI_SETTINGS);
  return h(SettingsPanel, { value, onChange: setValue, onSave: props.onSave });
}

describe("SettingsPanel", () => {
  it("uses labeled controls and emits complete immutable settings values", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(h(SettingsPanel, { value: DEFAULT_UI_SETTINGS, onChange }));
    await user.selectOptions(screen.getByRole("combobox", { name: "App theme" }), "dark");
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_UI_SETTINGS, theme: "dark" });

    await user.click(screen.getByRole("checkbox", { name: /Update PDF preview while editing/u }));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_UI_SETTINGS, livePreview: false });
  });

  it("shows inline contract errors and never offers invalid settings to Save", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(h(ControlledSettings, { onSave }));
    const save = screen.getByRole("button", { name: "Save settings" }) as HTMLButtonElement;

    const grid = screen.getByLabelText("Snap grid size");
    fireEvent.change(grid, { target: { value: "1em" } });
    expect(screen.getByText(/positive physical length/u)).toBeTruthy();
    fireEvent.change(grid, { target: { value: "0in" } });
    const gridError = screen.getByText(/positive physical length/u);
    expect(grid.getAttribute("aria-invalid")).toBe("true");
    expect(grid.getAttribute("aria-describedby")).toContain(gridError.id);
    expect(save.disabled).toBe(true);

    fireEvent.change(grid, { target: { value: "0.25in" } });
    const filename = screen.getByLabelText("PDF filename pattern");
    fireEvent.change(filename, { target: { value: "" } });
    expect(screen.getByText("Enter a PDF filename pattern.")).toBeTruthy();
    fireEvent.change(filename, { target: { value: "a".repeat(241) } });
    expect(screen.getByText(/240 characters or fewer/u)).toBeTruthy();
    fireEvent.change(filename, { target: { value: "../Sunday.pdf" } });
    const filenameError = screen.getByText(/path separators/u);
    expect(filename.getAttribute("aria-invalid")).toBe("true");
    expect(filename.getAttribute("aria-describedby")).toContain(filenameError.id);
    expect(save.disabled).toBe(true);

    fireEvent.change(filename, { target: { value: "Sunday bulletin" } });
    const timeZone = screen.getByLabelText("Display time zone");
    fireEvent.change(timeZone, { target: { value: "Mars/Olympus" } });
    const timeZoneError = screen.getByText(/not available on this computer/u);
    expect(timeZone.getAttribute("aria-invalid")).toBe("true");
    expect(timeZone.getAttribute("aria-describedby")).toContain(timeZoneError.id);
    expect(save.disabled).toBe(true);

    await user.click(save);
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(timeZone, { target: { value: "America/Phoenix" } });
    expect(save.disabled).toBe(false);
    await user.click(save);
    expect(onSave).toHaveBeenCalledOnce();
  });
});
