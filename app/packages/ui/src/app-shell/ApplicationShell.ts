import { createElement as h, useEffect, useRef, type ReactNode } from "react";
import { LiveRegion } from "../design-system/index.js";

export type AppRoute =
  | "thisWeek"
  | "bulletins"
  | "templates"
  | "churchLibrary"
  | "settings"
  | "help";

export interface ApplicationShellProps {
  readonly currentRoute: AppRoute;
  readonly onNavigate: (route: AppRoute) => void;
  readonly children: ReactNode;
  readonly workspaceName?: string;
  readonly headerActions?: ReactNode;
  readonly statusMessage?: string;
  readonly alertMessage?: string;
  readonly theme?: "system" | "light" | "dark";
  /** Changes when the routed main view changes without changing the primary route. */
  readonly focusKey?: string;
}

const NAV_ITEMS: readonly {
  readonly route: AppRoute;
  readonly label: string;
  readonly utility?: boolean;
}[] = Object.freeze([
  { route: "thisWeek", label: "This Week" },
  { route: "bulletins", label: "Bulletins" },
  { route: "templates", label: "Templates" },
  { route: "churchLibrary", label: "Church Library" },
  { route: "settings", label: "Settings", utility: true },
  { route: "help", label: "Help" },
]);

export function ApplicationShell({
  currentRoute,
  onNavigate,
  children,
  workspaceName = "Your bulletin library",
  headerActions,
  statusMessage,
  alertMessage,
  theme = "system",
  focusKey,
}: ApplicationShellProps) {
  const mainRef = useRef<HTMLElement>(null);
  const effectiveFocusKey = focusKey ?? currentRoute;
  const previousFocusKey = useRef(effectiveFocusKey);

  useEffect(() => {
    if (previousFocusKey.current === effectiveFocusKey) return;
    previousFocusKey.current = effectiveFocusKey;
    mainRef.current?.focus();
  }, [effectiveFocusKey]);

  return h(
    "div",
    { className: "cbb-app-shell cbb-theme", "data-cbb-theme": theme },
    h("a", { className: "cbb-skip-link", href: "#cbb-main-content" }, "Skip to main content"),
    h("header", { className: "cbb-app-header" },
      h("div", null,
        h("p", { className: "cbb-app-brand" }, "Church Bulletin Builder"),
        h("span", { className: "cbb-app-workspace" }, workspaceName),
      ),
      headerActions,
    ),
    h("nav", { className: "cbb-primary-nav", "aria-label": "Primary" },
      h("ul", { className: "cbb-primary-nav__list" }, ...NAV_ITEMS.map((item) => h("li", {
        key: item.route,
        className: item.utility === true ? "cbb-primary-nav__item--utility" : undefined,
      }, h("button", {
        className: "cbb-primary-nav__button",
        type: "button",
        "aria-current": item.route === currentRoute ? "page" : undefined,
        onClick: () => onNavigate(item.route),
      }, item.label)))),
    ),
    h("main", { ref: mainRef, id: "cbb-main-content", className: "cbb-app-main", tabIndex: -1 }, children),
    h(LiveRegion, { message: statusMessage ?? "", priority: "polite" }),
    h(LiveRegion, { message: alertMessage ?? "", priority: "assertive" }),
  );
}

export const APPLICATION_NAVIGATION = NAV_ITEMS;
