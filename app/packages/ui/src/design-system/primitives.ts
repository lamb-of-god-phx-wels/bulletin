import {
  createElement as h,
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";

function classes(...values: readonly (string | undefined)[]): string {
  return values.filter((value): value is string => value !== undefined && value.length > 0).join(" ");
}

export type ButtonVariant = "default" | "primary" | "danger" | "quiet";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "default", className, type = "button", ...props },
  ref,
) {
  return h("button", {
    ...props,
    ref,
    type,
    className: classes("cbb-button", `cbb-button--${variant}`, className),
  });
});

export interface CardProps extends HTMLAttributes<HTMLElement> {
  readonly as?: "article" | "section" | "div";
}

export function Card({ as = "div", className, ...props }: CardProps) {
  return h(as, { ...props, className: classes("cbb-card", className) });
}

export interface BannerProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  readonly tone?: "info" | "success" | "warning" | "danger";
  readonly title: string;
  readonly children?: ReactNode;
}

export function Banner({ tone = "info", title, children, className, ...props }: BannerProps) {
  const role = tone === "danger" ? "alert" : "status";
  const symbol = tone === "success" ? "✓" : tone === "warning" ? "!" : tone === "danger" ? "×" : "i";
  return h(
    "div",
    { ...props, role, className: classes("cbb-banner", `cbb-banner--${tone}`, className) },
    h("span", { "aria-hidden": "true" }, symbol),
    h("div", null, h("strong", null, title), children === undefined ? null : h("div", null, children)),
  );
}

export function VisuallyHidden({ children }: { readonly children: ReactNode }) {
  return h("span", { className: "cbb-visually-hidden" }, children);
}

export interface LiveRegionProps {
  readonly message?: string;
  readonly priority?: "polite" | "assertive";
}

export function LiveRegion({ message = "", priority = "polite" }: LiveRegionProps) {
  return h("div", {
    className: "cbb-visually-hidden",
    role: priority === "assertive" ? "alert" : "status",
    "aria-live": priority,
    "aria-atomic": "true",
  }, message);
}

export function PageHeader({ title, description, actions }: {
  readonly title: string;
  readonly description?: string;
  readonly actions?: ReactNode;
}) {
  return h(
    "header",
    { className: "cbb-page-header" },
    h("div", null, h("h1", null, title), description === undefined ? null : h("p", null, description)),
    actions,
  );
}
