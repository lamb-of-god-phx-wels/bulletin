import { createElement as h, useId } from "react";
import { Card } from "../design-system/index.js";
import { STARTER_CATALOG, type StarterId } from "./starters.js";

export interface StarterChooserProps {
  readonly selected?: StarterId;
  readonly onSelect: (id: StarterId) => void;
  readonly legend?: string;
  readonly disabled?: boolean;
}

export function StarterChooser({ selected, onSelect, legend = "Choose a starter", disabled = false }: StarterChooserProps) {
  const groupId = useId();
  return h(
    "fieldset",
    { className: "cbb-stack", "aria-describedby": `${groupId}-help`, disabled },
    h("legend", null, legend),
    h("p", { id: `${groupId}-help`, className: "cbb-muted" }, "Every starter works offline and can be changed later."),
    h(
      "div",
      { className: "cbb-card-grid" },
      ...STARTER_CATALOG.map((starter) => {
        const inputId = `${groupId}-${starter.id}`;
        return h(
          Card,
          { key: starter.id, className: "cbb-starter-card" },
          h("input", {
            id: inputId,
            type: "radio",
            name: groupId,
            value: starter.id,
            checked: selected === starter.id,
            onChange: () => onSelect(starter.id),
          }),
          h(
            "label",
            { htmlFor: inputId },
            h("h3", null, starter.name),
            h("p", null, starter.description),
            h("p", { className: "cbb-muted" }, `${starter.outputDescription} · ${starter.requiredItemCount} required items`),
          ),
        );
      }),
    ),
  );
}
