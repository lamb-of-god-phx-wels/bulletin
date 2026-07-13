import { createElement as h, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { PageHeader } from "../design-system/index.js";
import { HELP_ARTICLES, searchHelp } from "./articles.js";

export function HelpCenter() {
  const searchId = useId();
  const articleHeadingRef = useRef<HTMLHeadingElement>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const results = useMemo(() => searchHelp(deferredQuery), [deferredQuery]);
  const [selectedId, setSelectedId] = useState(HELP_ARTICLES[0]?.id ?? "");
  const [focusRequest, setFocusRequest] = useState(0);
  const selected = results.find((article) => article.id === selectedId) ?? results[0];

  useEffect(() => {
    if (focusRequest > 0) articleHeadingRef.current?.focus();
  }, [focusRequest, selected?.id]);

  return h("div", null,
    h(PageHeader, {
      title: "Help",
      description: "Searchable guidance is installed with the app and works without an internet connection.",
    }),
    h("div", { className: "cbb-help-layout" },
      h("aside", { "aria-label": "Help topics", className: "cbb-stack" },
        h("div", { className: "cbb-field" },
          h("label", { htmlFor: searchId }, "Search help"),
          h("input", {
            id: searchId,
            className: "cbb-search",
            type: "search",
            value: query,
            onChange: (event: { currentTarget: { value: string } }) => setQuery(event.currentTarget.value),
          }),
        ),
        h("p", { role: "status", "aria-live": "polite", className: "cbb-muted" }, `${results.length} ${results.length === 1 ? "topic" : "topics"}`),
        results.length === 0
          ? h("p", null, "No help topic matches every search word. Try fewer words.")
          : h("ul", { className: "cbb-help-results" }, ...results.map((article) => h("li", { key: article.id },
              h("button", {
                type: "button",
                "aria-current": article.id === selected?.id ? "true" : undefined,
                "aria-controls": "cbb-help-article",
                onClick: () => {
                  setSelectedId(article.id);
                  setFocusRequest((value) => value + 1);
                },
              }, article.title),
            ))),
      ),
      selected === undefined
        ? h("section", { id: "cbb-help-article", className: "cbb-help-article" }, h("h2", null, "No matching topic"), h("p", null, "Try a broader search."))
        : h("article", { id: "cbb-help-article", className: "cbb-help-article", "aria-labelledby": `help-${selected.id}` },
            h("h2", { ref: articleHeadingRef, id: `help-${selected.id}`, tabIndex: -1 }, selected.title),
            h("p", { className: "cbb-muted" }, selected.summary),
            ...selected.paragraphs.map((paragraph, index) => h("p", { key: index }, paragraph)),
          ),
    ),
  );
}
