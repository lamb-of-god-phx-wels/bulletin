import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageAssetChooser } from "./ImageAssetChooser.js";

afterEach(cleanup);

describe("ImageAssetChooser", () => {
  it("chooses an installed validated asset by opaque portable identity", () => {
    const choose = vi.fn();
    render(<ImageAssetChooser
      assets={[{
        localAssetId: "20000000-0000-4000-8000-000000000002",
        assetRef: "asset:10000000-0000-4000-8000-000000000001",
        displayName: "Sanctuary",
        mediaType: "image/png",
        byteSize: 123,
        pixelWidth: 1200,
        pixelHeight: 800,
        importedAt: "2026-07-13T01:02:03.000Z",
      }]}
      assetUrl={() => "blob:cbb-safe-preview"}
      busy={false}
      importing={false}
      onImport={() => undefined}
      onChoose={choose}
      onCancel={() => undefined}
    />);
    fireEvent.click(screen.getByRole("button", { name: /Sanctuary/u }));
    expect(choose).toHaveBeenCalledWith("asset:10000000-0000-4000-8000-000000000001");
    expect(screen.getByText("1200 × 800 pixels")).toBeTruthy();
  });

  it("keeps an empty library usable by offering native image import", () => {
    const importImage = vi.fn();
    render(<ImageAssetChooser
      assets={[]}
      assetUrl={() => undefined}
      busy={false}
      importing={false}
      onImport={importImage}
      onChoose={() => undefined}
      onCancel={() => undefined}
    />);
    expect(screen.getByText("No validated images are installed yet.")).toBeTruthy();
    expect(screen.getByText("Import a PNG, JPEG, or SVG image to use it in this bulletin.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Import image" }));
    expect(importImage).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toMatch(/quarantine|signed tools/u);
  });
});
