// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  makeSequentialIdPort,
  type CbbDocument,
} from "@cbb/core";
import {
  customInstanceFixture,
  finalizedCustomDefinitionFixture,
} from "../store/testFixtures.js";
import {
  createBulletinFromStarter,
  templateValueDecisionKey,
} from "./documentFactory.js";
import { TemplateValueReview } from "./TemplateValueReview.js";

afterEach(cleanup);

describe("TemplateValueReview", () => {
  it("clears likely weekly content by default and requires an explicit default choice", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <TemplateValueReview
        document={createBulletinFromStarter({
          starterId: "simple-service",
          idPort: makeSequentialIdPort(1),
          publicationDate: "2026-07-13",
        })}
        onCancel={() => undefined}
        onConfirm={onConfirm}
      />,
    );

    const publicationDate = screen.getByLabelText("Use Publication date in the template as") as HTMLSelectElement;
    expect(publicationDate.value).toBe("clear");
    await user.selectOptions(publicationDate, "default");
    expect(screen.getByRole("alert").textContent).toMatch(/specific to one week/u);
    await user.click(screen.getByRole("button", { name: "Create template" }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      [templateValueDecisionKey({ scope: "document", fieldId: "publicationDate" })]: {
        disposition: "default",
      },
    }));
  });

  it("closes on Escape without applying choices", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <TemplateValueReview
        document={createBulletinFromStarter({
          starterId: "simple-service",
          idPort: makeSequentialIdPort(2),
        })}
        onCancel={onCancel}
        onConfirm={() => undefined}
      />,
    );
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("offers only compatible closed Church Profile keys for text and logo values", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const base = createBulletinFromStarter({
      starterId: "simple-service",
      idPort: makeSequentialIdPort(3),
      publicationDate: "2026-07-13",
    });
    render(
      <TemplateValueReview
        document={{
          ...base,
          fieldContract: {
            ...base.fieldContract!,
            fields: [
              ...base.fieldContract!.fields,
              { id: "logo", label: "Logo", type: "assetRef", required: false },
              {
                id: "languageChoice",
                label: "Language choice",
                type: "choice",
                required: false,
                constraints: { choices: [{ id: "en", label: "English" }] },
              },
            ],
          },
          fieldValues: {
            ...base.fieldValues,
            serviceName: { value: "Sunday worship", origin: "manual" },
            logo: {
              value: "asset:00000000-0000-4000-8000-000000000001",
              origin: "manual",
            },
            languageChoice: { value: "en", origin: "manual" },
          },
        }}
        onCancel={() => undefined}
        onConfirm={onConfirm}
      />,
    );

    const serviceAction = screen.getByLabelText(
      "Use Service or gathering title in the template as",
    ) as HTMLSelectElement;
    const logoAction = screen.getByLabelText("Use Logo in the template as") as HTMLSelectElement;
    const choiceAction = screen.getByLabelText(
      "Use Language choice in the template as",
    ) as HTMLSelectElement;
    expect([...choiceAction.options].map((option) => option.value)).not.toContain("profile");

    await user.selectOptions(serviceAction, "profile");
    let profileSelectors = screen.getAllByLabelText("Profile value") as HTMLSelectElement[];
    expect([...profileSelectors[0]!.options].map((option) => option.value)).toEqual([
      "churchName",
      "mailingAddress",
      "locationAddress",
      "phone",
      "email",
      "website",
      "defaultServiceLabel",
    ]);
    expect([...profileSelectors[0]!.options].map((option) => option.value))
      .not.toContain("language");

    await user.selectOptions(logoAction, "profile");
    profileSelectors = screen.getAllByLabelText("Profile value") as HTMLSelectElement[];
    expect([...profileSelectors[1]!.options].map((option) => option.value)).toEqual(["logo"]);

    await user.click(screen.getByRole("button", { name: "Create template" }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      [templateValueDecisionKey({ scope: "document", fieldId: "serviceName" })]: {
        disposition: "profile",
        profileKey: "churchName",
      },
      [templateValueDecisionKey({ scope: "document", fieldId: "logo" })]: {
        disposition: "profile",
        profileKey: "logo",
      },
    }));
  });

  it("uses one scoped choice for conflicting copies of a shared Saved Section field", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const definition = finalizedCustomDefinitionFixture({
      version: 1,
      kind: "customElementDefinition",
      id: "sharedNotice",
      name: "Shared notice",
      fieldContract: {
        id: "95000000-0000-4000-8000-000000000001",
        version: 1,
        name: "Notice fields",
        fields: [{ id: "message", label: "Weekly message", type: "text", required: false }],
      },
      elements: [],
    });
    const document: CbbDocument = {
      version: 2,
      kind: "bulletin",
      name: "Shared notice bulletin",
      page: { typstWidth: "8.5in", typstHeight: "11in" },
      customElementDefinitions: [definition],
      elements: ["First", "Second"].map((value, index) => customInstanceFixture(definition, {
        id: `noticeInstance${index}`,
        type: "customInstance",
        name: `${value} notice`,
        fieldValues: { message: { value, origin: "manual" } },
      })),
    };
    render(
      <TemplateValueReview
        document={document}
        onCancel={() => undefined}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByText("2 inserted copies have different current values.")).toBeTruthy();
    expect(screen.getByText(/choice applies to 2 inserted copies/u)).toBeTruthy();
    expect(screen.getByText(/one shared default and sample/u)).toBeTruthy();
    const action = screen.getByLabelText(
      "Use Shared notice — Weekly message in the template as",
    ) as HTMLSelectElement;
    expect(action.value).toBe("clear");
    expect([...action.options].find((option) => option.value === "default")?.disabled).toBe(true);
    expect([...action.options].find((option) => option.value === "sample")?.disabled).toBe(true);

    await user.click(screen.getByRole("button", { name: "Create template" }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      [templateValueDecisionKey({
        scope: "savedSection",
        definitionId: definition.id,
        fieldId: "message",
      })]: { disposition: "clear" },
    }));
  });

  it("summarizes structured values without showing document data or asset identities", () => {
    const base = createBulletinFromStarter({
      starterId: "simple-service",
      idPort: makeSequentialIdPort(4),
      publicationDate: "2026-07-13",
    });
    const assetRef = "asset:00000000-0000-4000-8000-000000000001";
    render(
      <TemplateValueReview
        document={{
          ...base,
          fieldContract: {
            ...base.fieldContract!,
            fields: [
              ...base.fieldContract!.fields,
              { id: "logo", label: "Logo", type: "assetRef", required: false },
              {
                id: "topics",
                label: "Topics",
                type: "array",
                required: false,
                itemField: { id: "topic", label: "Topic", type: "text", required: true },
              },
              {
                id: "contact",
                label: "Contact details",
                type: "object",
                required: false,
                childFields: [
                  { id: "name", label: "Name", type: "text", required: false },
                  { id: "phone", label: "Phone", type: "text", required: false },
                ],
              },
              { id: "welcome", label: "Welcome", type: "richText", required: false },
            ],
          },
          fieldValues: {
            ...base.fieldValues,
            logo: { value: assetRef, origin: "manual" },
            topics: { value: ["Youth", "Choir"], origin: "manual" },
            contact: { value: { name: "Avery", phone: "555-0100" }, origin: "manual" },
            welcome: {
              value: {
                type: "document",
                blocks: [{
                  type: "paragraph",
                  children: [{ type: "text", text: "Welcome to worship" }],
                }],
              },
              origin: "manual",
            },
          },
        }}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    );

    expect(screen.getByText("Current value: Selected image")).toBeTruthy();
    expect(screen.getByText("Current value: 2 items")).toBeTruthy();
    expect(screen.getByText("Current value: 2 details filled")).toBeTruthy();
    expect(screen.getByText("Current value: Welcome to worship")).toBeTruthy();
    expect(screen.queryByText(assetRef)).toBeNull();
    expect(document.body.textContent).not.toContain('["Youth","Choir"]');
    expect(document.body.textContent).not.toContain('{"name":"Avery"');
  });
});
