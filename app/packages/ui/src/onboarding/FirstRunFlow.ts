import { createElement as h, useEffect, useId, useRef, useState } from "react";
import { Button, PageHeader } from "../design-system/index.js";
import type { FirstRunContactValues, FirstRunDraft, FirstRunStep } from "./persistence.js";
import { StarterChooser } from "./StarterChooser.js";
import type { StarterId } from "./starters.js";

export type PreferredOutput = "fullSheet" | "foldedBooklet" | "other";

export interface FirstRunResult extends FirstRunContactValues {
  readonly preferredOutput: PreferredOutput;
  readonly starterId: StarterId;
  readonly createPracticeBulletin: boolean;
}

export interface FirstRunFlowProps {
  readonly onComplete: (result: FirstRunResult) => void;
  readonly onSkip: () => void;
  readonly onProgress?: (draft: FirstRunDraft) => void;
  readonly initialValue?: FirstRunDraft;
  readonly onUseStarter?: () => void;
  readonly onStartBlank?: () => void;
  readonly onChooseWorkspaceLocation?: () => void;
  readonly onImportLogo?: () => Promise<{
    readonly assetRef: string;
    readonly displayName: string;
  } | undefined>;
  readonly busy?: boolean;
}

const MAX_PROFILE_TEXT = 120;

function cleanOptionalText(value: string): string | undefined {
  const normalized = value.normalize("NFC").trim();
  return normalized.length === 0 ? undefined : normalized;
}

function cleanContactValues(values: {
  readonly churchName: string;
  readonly mailingAddress: string;
  readonly locationAddress: string;
  readonly phone: string;
  readonly email: string;
  readonly website: string;
}): FirstRunContactValues {
  const result: {
    churchName?: string;
    mailingAddress?: string;
    locationAddress?: string;
    phone?: string;
    email?: string;
    website?: string;
  } = {};
  for (const key of Object.keys(values) as (keyof typeof values)[]) {
    const cleaned = cleanOptionalText(values[key]);
    if (cleaned !== undefined) result[key] = cleaned;
  }
  return result;
}

export function FirstRunFlow({
  onComplete,
  onSkip,
  onProgress,
  initialValue,
  onUseStarter,
  onStartBlank,
  onChooseWorkspaceLocation,
  onImportLogo,
  busy = false,
}: FirstRunFlowProps) {
  const formId = useId();
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const progressMounted = useRef(false);
  const [step, setStep] = useState<FirstRunStep>(initialValue?.step ?? 0);
  const [churchName, setChurchName] = useState(initialValue?.churchName ?? "");
  const [mailingAddress, setMailingAddress] = useState(initialValue?.mailingAddress ?? "");
  const [locationAddress, setLocationAddress] = useState(initialValue?.locationAddress ?? "");
  const [phone, setPhone] = useState(initialValue?.phone ?? "");
  const [email, setEmail] = useState(initialValue?.email ?? "");
  const [website, setWebsite] = useState(initialValue?.website ?? "");
  const [logo, setLogo] = useState(initialValue?.logo);
  const [logoName, setLogoName] = useState(initialValue?.logo === undefined ? "" : "Imported logo");
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState("");
  const [preferredOutput, setPreferredOutput] = useState<PreferredOutput>(initialValue?.preferredOutput ?? "fullSheet");
  const [starterId, setStarterId] = useState<StarterId>(initialValue?.starterId ?? "simple-service");
  const [createPracticeBulletin, setCreatePracticeBulletin] = useState(initialValue?.createPracticeBulletin ?? true);
  const stepCount = 3;
  const stepTitles = [
    "Tell us about your weekly bulletin",
    "Choose a starter",
    "Ready for your first bulletin",
  ] as const;
  const stepTitle = stepTitles[step];

  useEffect(() => {
    stepHeadingRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (!progressMounted.current) {
      progressMounted.current = true;
      return;
    }
    const contacts = cleanContactValues({
      churchName,
      mailingAddress,
      locationAddress,
      phone,
      email,
      website,
    });
    onProgress?.({
      version: 1,
      disposition: "inProgress",
      step,
      ...contacts,
      ...(logo === undefined ? {} : { logo }),
      preferredOutput,
      starterId,
      createPracticeBulletin,
    });
  }, [
    churchName,
    createPracticeBulletin,
    email,
    locationAddress,
    logo,
    mailingAddress,
    onProgress,
    phone,
    preferredOutput,
    starterId,
    step,
    website,
  ]);

  const contactDetailsPresent = [mailingAddress, locationAddress, phone, email, website]
    .some((value) => value.length > 0);
  const content = step === 0
    ? h(
        "div",
        { className: "cbb-stack" },
        h("div", { className: "cbb-field" },
          h("label", { htmlFor: `${formId}-name` }, "Church or congregation name (optional)"),
          h("input", {
            id: `${formId}-name`,
            value: churchName,
            maxLength: MAX_PROFILE_TEXT,
            disabled: busy,
            autoComplete: "organization",
            onChange: (event: { currentTarget: { value: string } }) => setChurchName(event.currentTarget.value),
          }),
          h("span", { className: "cbb-field__hint" }, "Saved only in this bulletin library’s Church Profile."),
        ),
        onImportLogo === undefined ? null : h("div", { className: "cbb-field" },
          h("span", null, "Church logo (optional)"),
          h("div", { className: "cbb-cluster" },
            h(Button, {
              disabled: busy || logoBusy,
              onClick: () => {
                setLogoBusy(true);
                setLogoError("");
                void onImportLogo().then((selected) => {
                  if (selected === undefined) return;
                  setLogo(selected.assetRef);
                  setLogoName(selected.displayName);
                }).catch((error: unknown) => {
                  setLogoError(error instanceof Error ? error.message : "That logo could not be imported safely.");
                }).finally(() => setLogoBusy(false));
              },
            }, logoBusy ? "Importing logo…" : logo === undefined ? "Import logo" : "Replace logo"),
            logo === undefined ? null : h(Button, {
              variant: "quiet",
              disabled: busy || logoBusy,
              onClick: () => {
                setLogo(undefined);
                setLogoName("");
              },
            }, "Remove logo"),
          ),
          logo === undefined ? null : h("span", { className: "cbb-field__hint", role: "status" }, `${logoName} is selected for Church Profile.`),
          logoError.length === 0 ? null : h("span", { className: "cbb-field__error", role: "alert" }, logoError),
        ),
        h("details", { open: contactDetailsPresent || undefined },
          h("summary", null, "Contact details (optional)"),
          h("div", { className: "cbb-stack" },
            h("div", { className: "cbb-field" },
              h("label", { htmlFor: `${formId}-mailing-address` }, "Mailing address"),
              h("input", {
                id: `${formId}-mailing-address`,
                value: mailingAddress,
                maxLength: MAX_PROFILE_TEXT,
                disabled: busy,
                autoComplete: "street-address",
                onChange: (event: { currentTarget: { value: string } }) => setMailingAddress(event.currentTarget.value),
              }),
            ),
            h("div", { className: "cbb-field" },
              h("label", { htmlFor: `${formId}-location-address` }, "Worship location address"),
              h("input", {
                id: `${formId}-location-address`,
                value: locationAddress,
                maxLength: MAX_PROFILE_TEXT,
                disabled: busy,
                onChange: (event: { currentTarget: { value: string } }) => setLocationAddress(event.currentTarget.value),
              }),
            ),
            h("div", { className: "cbb-field" },
              h("label", { htmlFor: `${formId}-phone` }, "Phone"),
              h("input", {
                id: `${formId}-phone`,
                type: "tel",
                value: phone,
                maxLength: MAX_PROFILE_TEXT,
                disabled: busy,
                autoComplete: "tel",
                onChange: (event: { currentTarget: { value: string } }) => setPhone(event.currentTarget.value),
              }),
            ),
            h("div", { className: "cbb-field" },
              h("label", { htmlFor: `${formId}-email` }, "Email"),
              h("input", {
                id: `${formId}-email`,
                type: "email",
                value: email,
                maxLength: MAX_PROFILE_TEXT,
                disabled: busy,
                autoComplete: "email",
                onChange: (event: { currentTarget: { value: string } }) => setEmail(event.currentTarget.value),
              }),
            ),
            h("div", { className: "cbb-field" },
              h("label", { htmlFor: `${formId}-website` }, "Website"),
              h("input", {
                id: `${formId}-website`,
                type: "url",
                value: website,
                maxLength: MAX_PROFILE_TEXT,
                disabled: busy,
                autoComplete: "url",
                placeholder: "https://example.org",
                onChange: (event: { currentTarget: { value: string } }) => setWebsite(event.currentTarget.value),
              }),
            ),
          ),
        ),
        h("fieldset", { className: "cbb-field", disabled: busy },
          h("legend", null, "What do you usually make?"),
          ...([
            ["fullSheet", "Full sheet"],
            ["foldedBooklet", "Folded booklet"],
            ["other", "Another page style"],
          ] as const).map(([value, label]) => h("label", { key: value, className: "cbb-choice-row" },
            h("input", {
              type: "radio",
              name: `${formId}-output`,
              value,
              checked: preferredOutput === value,
              onChange: () => setPreferredOutput(value),
            }),
            label,
          )),
        ),
        onChooseWorkspaceLocation === undefined ? null : h("details", null,
          h("summary", null, "Advanced"),
          h("p", null, "The recommended location is private to your computer account and works without setup."),
          h(Button, { variant: "quiet", disabled: busy || logoBusy, onClick: onChooseWorkspaceLocation }, "Choose another location"),
          h("p", { className: "cbb-field__hint" }, "On first launch, choose an empty folder. The app will restart with that folder as this bulletin library."),
        ),
      )
    : step === 1
      ? h(StarterChooser, { selected: starterId, onSelect: setStarterId, legend: "Bulletin starter", disabled: busy })
      : h(
          "div",
          { className: "cbb-stack" },
          h("p", null, "We can open a practice bulletin and show the steps from editing through checking the PDF preview."),
          h("label", { className: "cbb-choice-row" },
            h("input", {
              type: "checkbox",
              checked: createPracticeBulletin,
              disabled: busy,
              onChange: (event: { currentTarget: { checked: boolean } }) => setCreatePracticeBulletin(event.currentTarget.checked),
            }),
            "Create a practice bulletin and show the tour",
          ),
          h("p", { className: "cbb-muted" }, "Nothing is sent online. You can remove the practice bulletin when you finish."),
        );

  return h(
    "section",
    { className: "cbb-onboarding", "aria-labelledby": `${formId}-title`, "aria-busy": busy || logoBusy },
    h(PageHeader, {
      title: "Set up your bulletin library",
      description: "A short, optional setup. Every answer can be changed later.",
      actions: onUseStarter === undefined && onStartBlank === undefined
        ? undefined
        : h("div", { className: "cbb-cluster" },
            onUseStarter === undefined
              ? null
              : h(Button, { variant: "primary", disabled: busy || logoBusy, onClick: onUseStarter }, "Use a starter"),
            onStartBlank === undefined
              ? null
              : h(Button, { disabled: busy || logoBusy, onClick: onStartBlank }, "Start blank"),
          ),
    }),
    h("span", { id: `${formId}-title`, className: "cbb-visually-hidden" }, "Set up your bulletin library"),
    h("label", { htmlFor: `${formId}-progress`, className: "cbb-muted" }, `Step ${step + 1} of ${stepCount}`),
    h("progress", {
      id: `${formId}-progress`,
      className: "cbb-onboarding__progress",
      max: stepCount,
      value: step + 1,
    }, `${step + 1} of ${stepCount}`),
    h("p", {
      className: "cbb-visually-hidden",
      role: "status",
      "aria-live": "polite",
      "aria-atomic": "true",
    }, `Step ${step + 1} of ${stepCount}: ${stepTitle}`),
    h("form", {
      onSubmit: (event: { preventDefault: () => void }) => {
        event.preventDefault();
        if (busy || logoBusy) return;
        if (step < stepCount - 1) {
          setStep((step + 1) as FirstRunStep);
          return;
        }
        const contacts = cleanContactValues({
          churchName,
          mailingAddress,
          locationAddress,
          phone,
          email,
          website,
        });
        onComplete({
          ...contacts,
          ...(logo === undefined ? {} : { logo }),
          preferredOutput,
          starterId,
          createPracticeBulletin,
        });
      },
    },
      h("div", { key: step, className: "cbb-stack" },
        h("h2", { ref: stepHeadingRef, tabIndex: -1 }, stepTitle),
        content,
      ),
      h("div", { className: "cbb-onboarding__actions" },
        h(Button, { variant: "quiet", disabled: busy || logoBusy, onClick: onSkip }, "Skip setup"),
        h("div", { className: "cbb-cluster" },
          step === 0 ? null : h(Button, { disabled: busy || logoBusy, onClick: () => setStep((step - 1) as FirstRunStep) }, "Back"),
          h(Button, { variant: "primary", type: "submit", disabled: busy || logoBusy },
            busy ? "Saving setup…" : step === stepCount - 1 ? "Finish setup" : "Continue"),
        ),
      ),
    ),
  );
}
