export const canvas = {
  width: 672,
  height: 816,
  typstWidth: "7in",
  typstHeight: "8.5in",
};

export function createDefaultProject({ kind = "bulletin", name = "Untitled" } = {}) {
  return {
    version: 1,
    kind,
    name,
    page: {
      width: canvas.width,
      height: canvas.height,
      typstWidth: canvas.typstWidth,
      typstHeight: canvas.typstHeight,
      background: "#fffaf1",
    },
    elements: [
      textElement({
        name: "Season and Date",
        width: 596,
        height: 42,
        text: "Second Sunday After Pentecost    June 7, 2026",
        fontSize: 18,
        fontWeight: "bold",
        font: "Eras Demi ITC",
      }),
      textElement({
        name: "Welcome Text",
        width: 596,
        height: 78,
        text: "Add bulletin sections by dragging elements from the palette. Reorder the flow by dragging elements between slots.",
        fontSize: 11,
        background: "#ffffff",
        borderColor: "#d8cdbd",
        borderWidth: 1,
      }),
      imageElement({
        name: "Series Logo",
        width: 288,
        height: 150,
        path: "assets/sermon_series/say_it_out_loud/logo.png",
      }),
      textElement({
        name: "Theme",
        width: 500,
        height: 68,
        text: "GOD LOVES SINNERS*",
        font: "Eras Demi ITC",
        fontSize: 24,
        fontWeight: "bold",
        align: "center",
      }),
      imageElement({
        name: "Church Logo",
        width: 216,
        height: 82,
        path: "assets/church/logo.png",
      }),
    ],
  };
}

export function createElement(type, overrides = {}) {
  if (type === "text") return textElement(overrides);
  if (type === "image") return imageElement(overrides);
  if (type === "grid") return gridElement(overrides);
  if (type === "stack") return stackElement(overrides);
  if (type === "canvas") return canvasElement(overrides);
  if (type === "music") return musicElement(overrides);
  return textElement(overrides);
}

function baseElement(type, overrides = {}) {
  return {
    id: overrides.id || nextId(),
    type,
    name: overrides.name || titleCase(type),
    width: overrides.width ?? 220,
    height: overrides.height ?? 90,
    margin: overrides.margin ?? 0,
    padding: overrides.padding ?? 8,
    style: {
      font: overrides.font || "Calibri",
      fontSize: overrides.fontSize ?? 11,
      fontWeight: overrides.fontWeight || "regular",
      fontStyle: overrides.fontStyle || "normal",
      color: overrides.color || "#251d18",
      background: overrides.background || "transparent",
      borderColor: overrides.borderColor || "#d8cdbd",
      borderWidth: overrides.borderWidth ?? 0,
      align: overrides.align || "left",
    },
    schema: overrides.schema || [],
    data: overrides.data || {},
  };
}

function textElement(overrides = {}) {
  return {
    ...baseElement("text", overrides),
    data: {
      text: overrides.text || overrides.data?.text || "Text element",
    },
  };
}

function imageElement(overrides = {}) {
  return {
    ...baseElement("image", { width: 180, height: 110, ...overrides }),
    data: {
      path: overrides.path || overrides.data?.path || "assets/church/logo.png",
      fit: overrides.fit || overrides.data?.fit || "contain",
    },
  };
}

function gridElement(overrides = {}) {
  return {
    ...baseElement("grid", { width: 260, height: 140, ...overrides }),
    data: {
      rows: overrides.rows ?? overrides.data?.rows ?? 2,
      columns: overrides.columns ?? overrides.data?.columns ?? 2,
      cellPadding: overrides.cellPadding ?? overrides.data?.cellPadding ?? 6,
      cells: overrides.cells || overrides.data?.cells || ["Cell 1", "Cell 2", "Cell 3", "Cell 4"],
    },
  };
}

function stackElement(overrides = {}) {
  return {
    ...baseElement("stack", { width: 260, height: 160, ...overrides }),
    data: {
      direction: overrides.direction || overrides.data?.direction || "vertical",
      gap: overrides.gap ?? overrides.data?.gap ?? 8,
      items: overrides.items || overrides.data?.items || ["First item", "Second item", "Third item"],
    },
  };
}

function canvasElement(overrides = {}) {
  return {
    ...baseElement("canvas", { width: "100%", height: "auto", padding: 0, borderWidth: 0, ...overrides }),
    data: {},
    children: overrides.children || [],
  };
}

function musicElement(overrides = {}) {
  return {
    ...baseElement("music", { width: 300, height: 120, ...overrides }),
    data: {
      title: overrides.title || overrides.data?.title || "Music / Lead Sheet",
      notes: overrides.notes || overrides.data?.notes || "Import support TBD",
    },
  };
}

function nextId() {
  return `el_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function titleCase(value) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
