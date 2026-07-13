import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../design-system/index.js";

const STEPS = Object.freeze([
  {
    title: "Fill this week’s content",
    body: "Start in Weekly Content. The template keeps protected layout controls out of the way while you replace dates, headings, and other weekly values.",
  },
  {
    title: "Customize the layout when needed",
    body: "Switch to Customize Layout for structure, page setup, reusable fields, and template tools. Every structural change can be undone while this bulletin is open.",
  },
  {
    title: "Check the generated pages",
    body: "Use the PDF preview beside the editor to review page breaks and select a page item to navigate between the editor and preview.",
  },
] as const);

export interface FirstBulletinTourProps {
  readonly onFinish: () => void;
}

export function FirstBulletinTour({ onFinish }: FirstBulletinTourProps) {
  const titleId = useId();
  const bodyId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState(0);
  const current = STEPS[step]!;

  useEffect(() => {
    titleRef.current?.focus();
  }, [step]);

  return (
    <aside
      className="cbb-first-tour"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
    >
      <div>
        <p className="cbb-eyebrow">First bulletin tour · Step {step + 1} of {STEPS.length}</p>
        <h2 id={titleId} ref={titleRef} tabIndex={-1}>{current.title}</h2>
        <p id={bodyId}>{current.body}</p>
      </div>
      <div className="cbb-first-tour__actions">
        <Button variant="quiet" onClick={onFinish}>Skip tour</Button>
        {step === 0 ? null : <Button onClick={() => setStep((value) => value - 1)}>Back</Button>}
        <Button
          variant="primary"
          onClick={() => {
            if (step === STEPS.length - 1) onFinish();
            else setStep((value) => value + 1);
          }}
        >
          {step === STEPS.length - 1 ? "Finish tour" : "Next"}
        </Button>
      </div>
    </aside>
  );
}
