const canvasSize = { width: 672, height: 816 };
const liveBuildDelay = 1200;
const saveDelay = 350;

const state = {
  project: null,
  assets: [],
  schemas: [],
  elementSchemas: [],
  selectedId: null,
  saveTimer: null,
  buildTimer: null,
  buildRunning: false,
  buildQueued: false,
  isDragging: false,
  draggingId: null,
  draggingType: null,
  dropIndex: null,
};

const els = {
  kindSelect: document.querySelector("#kindSelect"),
  projectSelect: document.querySelector("#projectSelect"),
  projectName: document.querySelector("#projectName"),
  newButton: document.querySelector("#newButton"),
  saveButton: document.querySelector("#saveButton"),
  buildButton: document.querySelector("#buildButton"),
  liveToggle: document.querySelector("#liveToggle"),
  palette: document.querySelector("#palette"),
  assetSelect: document.querySelector("#assetSelect"),
  applyAssetButton: document.querySelector("#applyAssetButton"),
  inspector: document.querySelector("#inspector"),
  selectionHint: document.querySelector("#selectionHint"),
  pageCanvas: document.querySelector("#pageCanvas"),
  statusText: document.querySelector("#statusText"),
  pdfFrame: document.querySelector("#pdfFrame"),
  buildOutput: document.querySelector("#buildOutput"),
  buildOutputToggle: document.querySelector("#buildOutputToggle"),
  deleteButton: document.querySelector("#deleteButton"),
  duplicateButton: document.querySelector("#duplicateButton"),
};

els.kindSelect.addEventListener("change", () => safeAction(loadProjectList));
els.projectSelect.addEventListener("change", () => safeAction(() => loadProject(els.kindSelect.value, els.projectSelect.value)));
els.newButton.addEventListener("click", () => safeAction(createProject));
els.saveButton.addEventListener("click", () => safeAction(() => saveNow("Saved.")));
els.buildButton.addEventListener("click", () => safeAction(() => buildNow({ manual: true })));
els.buildOutputToggle.addEventListener("click", toggleBuildOutput);
els.applyAssetButton.addEventListener("click", applySelectedAsset);
els.deleteButton.addEventListener("click", deleteSelected);
els.duplicateButton.addEventListener("click", duplicateSelected);

els.pageCanvas.addEventListener("dragover", handleCanvasDragOver);
els.pageCanvas.addEventListener("dragleave", handleCanvasDragLeave);
els.pageCanvas.addEventListener("drop", handleCanvasDrop);

els.pageCanvas.addEventListener("pointerdown", (event) => {
  if (event.target === els.pageCanvas) selectElement(null);
});

init();

async function init() {
  await safeAction(loadSchemas);
  await safeAction(loadAssets);
  await safeAction(loadProjectList);
}

async function loadSchemas() {
  const result = await api("/api/schemas");
  state.schemas = result.schemas;
  state.elementSchemas = result.schemas
    .map((entry) => ({ ...entry, type: entry.schema?.properties?.type?.const }))
    .filter((entry) => entry.type)
    .sort((a, b) => schemaOrder(a.type) - schemaOrder(b.type));
  renderPalette();
}

function renderPalette() {
  els.palette.innerHTML = "";
  for (const entry of state.elementSchemas) {
    const button = document.createElement("button");
    button.type = "button";
    button.draggable = true;
    button.dataset.add = entry.type;
    button.innerHTML = `<span>${escapeHtml(paletteTitle(entry))}</span><small>${escapeHtml(paletteDescription(entry))}</small>`;
    button.addEventListener("click", () => addElement(entry.type));
    button.addEventListener("dragstart", (event) => {
      state.isDragging = true;
      state.draggingId = null;
      state.draggingType = "palette";
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData("application/x-builder-element", entry.type);
    });
    button.addEventListener("dragend", finishDrag);
    els.palette.append(button);
  }
  if (state.elementSchemas.length === 0) {
    els.palette.innerHTML = '<p class="mutedText">No element schemas found.</p>';
  }
}

async function loadProjectList() {
  const kind = els.kindSelect.value;
  const result = await api(`/api/projects?kind=${encodeURIComponent(kind)}`);
  els.projectSelect.innerHTML = "";
  for (const project of result.projects) {
    const option = document.createElement("option");
    option.value = project.name;
    option.textContent = `${project.name} (${project.elementCount})`;
    els.projectSelect.append(option);
  }
  if (result.projects.length > 0) {
    await loadProject(kind, result.projects[0].name);
  } else {
    const fallbackName = kind === "bulletin" ? upcomingSundayName() : "Starter Template";
    await createProject(fallbackName);
  }
}

async function loadProject(kind, name) {
  if (!name) return;
  setStatus("Loading project...");
  const result = await api(`/api/project?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(name)}`);
  state.project = result.project;
  state.selectedId = state.project.elements[0]?.id || null;
  els.projectName.value = state.project.name;
  syncProjectSelect();
  renderAll();
  setStatus("Project loaded. Drag elements or edit properties; changes autosave.");
  setPdfPreview(false);
  if (els.liveToggle.checked) scheduleLiveBuild("Loading preview... live PDF will rebuild shortly.");
}

async function createProject(nameFromCaller) {
  const kind = els.kindSelect.value;
  const proposed = typeof nameFromCaller === "string" ? nameFromCaller : window.prompt("Project name", kind === "bulletin" ? upcomingSundayName() : "New Template");
  if (!proposed) return;
  const result = await api("/api/projects", {
    method: "POST",
    body: JSON.stringify({ kind, name: proposed }),
  });
  state.project = result.project;
  state.selectedId = state.project.elements[0]?.id || null;
  els.projectName.value = state.project.name;
  await refreshProjectOptions(state.project.name);
  renderAll();
  setStatus("Project created.");
}

async function loadAssets() {
  const result = await api("/api/assets");
  state.assets = result.assets;
  els.assetSelect.innerHTML = "";
  for (const asset of state.assets) {
    const option = document.createElement("option");
    option.value = asset.path;
    option.textContent = asset.path;
    els.assetSelect.append(option);
  }
}

function renderAll() {
  renderCanvas();
  renderInspector();
}

function renderCanvas() {
  if (!state.project) return;
  const page = state.project.page || canvasSize;
  els.pageCanvas.style.width = `${page.width}px`;
  els.pageCanvas.style.minHeight = `${Math.min(page.height || canvasSize.height, 320)}px`;
  els.pageCanvas.style.background = page.background || "#ffffff";
  els.pageCanvas.innerHTML = "";
  for (const element of state.project.elements) {
    els.pageCanvas.append(renderElement(element));
  }
  if (state.dropIndex !== null) showDropSlot(state.dropIndex);
}

function renderElement(element) {
  const node = document.createElement("div");
  node.className = `canvasElement type-${element.type}`;
  node.classList.toggle("selected", element.id === state.selectedId);
  node.classList.toggle("dragging", element.id === state.draggingId);
  node.dataset.id = element.id;
  const canvasBox = element.type === "canvas" ? effectiveCanvasSize(element) : null;
  node.style.width = cssLength(canvasBox?.width ?? element.width);
  node.style.height = cssLength(canvasBox?.height ?? element.height);
  node.style.margin = cssLength(element.margin);
  node.style.padding = element.type === "canvas" || element.type === "pageBreak" ? "0px" : cssLength(element.padding);
  node.style.color = element.style.color;
  node.style.background = element.style.background === "transparent" ? "transparent" : element.style.background;
  node.style.border = element.type === "canvas" || element.type === "pageBreak" ? "" : `${cssLength(element.style.borderWidth)} solid ${element.style.borderColor}`;
  node.style.fontFamily = `${element.style.font}, Calibri, sans-serif`;
  node.style.fontSize = cssLength(element.style.fontSize);
  node.style.fontWeight = element.style.fontWeight === "regular" ? "400" : element.style.fontWeight;
  node.style.fontStyle = element.style.fontStyle;
  node.style.textAlign = element.style.align;

  appendElementContent(node, element);

  node.draggable = true;
  node.addEventListener("click", (event) => {
    event.stopPropagation();
    selectElement(element.id);
  });
  node.addEventListener("dragstart", (event) => beginElementDrag(event, element.id));
  node.addEventListener("dragend", finishDrag);
  return node;
}

function appendElementContent(node, element) {
  if (element.type === "pageBreak") node.append(renderPageBreakElement());
  else if (element.type === "canvas") node.append(renderCanvasElement(element));
  else if (element.type === "image") node.append(renderImageElement(element));
  else if (element.type === "grid") node.append(renderGridElement(element));
  else if (element.type === "stack") node.append(renderStackElement(element));
  else if (element.type === "music") node.append(renderMusicElement(element));
  else if (element.type === "date") node.textContent = renderDateText(element);
  else node.textContent = element.data.text || "";
}

function renderCanvasElement(element) {
  const surface = document.createElement("div");
  surface.className = "canvasSurface";
  surface.dataset.canvasId = element.id;
  surface.addEventListener("dragover", (event) => handleNestedCanvasDragOver(event, element, surface));
  surface.addEventListener("dragleave", (event) => handleNestedCanvasDragLeave(event, surface));
  surface.addEventListener("drop", (event) => handleNestedCanvasDrop(event, element, surface));
  for (const child of element.children || []) {
    surface.append(renderCanvasChild(child, element));
  }
  if (!element.children?.length) {
    const empty = document.createElement("div");
    empty.className = "canvasEmptyHint";
    empty.textContent = "Drop elements here for exact placement";
    surface.append(empty);
  }
  return surface;
}

function renderPageBreakElement() {
  const marker = document.createElement("div");
  marker.className = "pageBreakElement";
  marker.textContent = "Page Break";
  return marker;
}

function renderCanvasChild(child, parentCanvas) {
  const size = effectiveElementSize(child.element, effectiveCanvasSize(parentCanvas).width);
  const wrapper = document.createElement("div");
  wrapper.className = "canvasChild";
  wrapper.classList.toggle("selected", child.id === state.selectedId);
  wrapper.classList.toggle("dragging", child.id === state.draggingId);
  wrapper.dataset.id = child.id;
  wrapper.style.left = cssLength(child.x);
  wrapper.style.top = cssLength(child.y);
  wrapper.style.width = cssLength(size.width);
  wrapper.style.height = cssLength(size.height);
  wrapper.draggable = true;
  wrapper.addEventListener("click", (event) => {
    event.stopPropagation();
    selectElement(child.id);
  });
  wrapper.addEventListener("dragstart", (event) => beginCanvasChildDrag(event, child));
  wrapper.addEventListener("dragend", finishDrag);
  wrapper.append(renderCanvasChildElement(child.element, size));
  return wrapper;
}

function renderCanvasChildElement(element, size) {
  const node = document.createElement("div");
  node.className = `canvasChildElement type-${element.type}`;
  node.style.width = `${size.width}px`;
  node.style.height = `${size.height}px`;
  node.style.padding = element.type === "canvas" ? "0px" : cssLength(element.padding);
  node.style.color = element.style.color;
  node.style.background = element.style.background === "transparent" ? "transparent" : element.style.background;
  node.style.border = element.type === "canvas" ? "" : `${cssLength(element.style.borderWidth)} solid ${element.style.borderColor}`;
  node.style.fontFamily = `${element.style.font}, Calibri, sans-serif`;
  node.style.fontSize = cssLength(element.style.fontSize);
  node.style.fontWeight = element.style.fontWeight === "regular" ? "400" : element.style.fontWeight;
  node.style.fontStyle = element.style.fontStyle;
  node.style.textAlign = element.style.align;
  appendElementContent(node, element);
  return node;
}

function renderImageElement(element) {
  const img = document.createElement("img");
  img.alt = element.name;
  img.src = `/asset?path=${encodeURIComponent(element.data.path || "assets/church/logo.png")}`;
  img.style.objectFit = element.data.fit || "contain";
  return img;
}

function renderGridElement(element) {
  const grid = document.createElement("div");
  grid.className = "gridElement";
  const columns = Math.max(1, Number(element.data.columns || 2));
  grid.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
  grid.style.gap = cssLength(element.data.cellPadding || 6);
  grid.addEventListener("dragover", (event) => handleLayoutDragOver(event, element));
  grid.addEventListener("drop", (event) => handleLayoutDrop(event, element));
  const rows = Math.max(1, Number(element.data.rows || 2), Math.ceil((element.children?.length || 0) / columns));
  const total = Math.max(1, rows * columns);
  for (let index = 0; index < total; index++) {
    const cell = document.createElement("div");
    cell.className = "gridCell";
    cell.dataset.layoutIndex = String(index);
    const child = element.children?.[index];
    if (child) cell.append(renderLayoutChild(child, element));
    else cell.append(renderLayoutEmptyHint("Drop element"));
    grid.append(cell);
  }
  return grid;
}

function renderStackElement(element) {
  const stack = document.createElement("div");
  stack.className = "stackElement";
  stack.style.flexDirection = element.data.direction === "horizontal" ? "row" : "column";
  stack.style.gap = cssLength(element.data.gap || 8);
  stack.addEventListener("dragover", (event) => handleLayoutDragOver(event, element));
  stack.addEventListener("drop", (event) => handleLayoutDrop(event, element));
  for (const child of element.children || []) {
    stack.append(renderLayoutChild(child, element));
  }
  if (!element.children?.length) stack.append(renderLayoutEmptyHint("Drop elements here"));
  return stack;
}

function renderLayoutChild(element, parentLayout) {
  const node = document.createElement("div");
  node.className = "layoutChild";
  node.classList.toggle("selected", element.id === state.selectedId);
  node.classList.toggle("dragging", element.id === state.draggingId);
  node.dataset.id = element.id;
  node.draggable = true;
  node.addEventListener("click", (event) => {
    event.stopPropagation();
    selectElement(element.id);
  });
  node.addEventListener("dragstart", (event) => beginLayoutChildDrag(event, element));
  node.addEventListener("dragend", finishDrag);
  node.append(renderLayoutChildElement(element));
  return node;
}

function renderLayoutChildElement(element) {
  const node = document.createElement("div");
  const size = element.type === "canvas" ? effectiveCanvasSize(element) : null;
  node.className = `layoutChildElement type-${element.type}`;
  node.style.width = cssLength(size?.width ?? element.width);
  node.style.height = cssLength(size?.height ?? element.height);
  node.style.padding = element.type === "canvas" || element.type === "pageBreak" ? "0px" : cssLength(element.padding);
  node.style.color = element.style.color;
  node.style.background = element.style.background === "transparent" ? "transparent" : element.style.background;
  node.style.border = element.type === "canvas" || element.type === "pageBreak" ? "" : `${cssLength(element.style.borderWidth)} solid ${element.style.borderColor}`;
  node.style.fontFamily = `${element.style.font}, Calibri, sans-serif`;
  node.style.fontSize = cssLength(element.style.fontSize);
  node.style.fontWeight = element.style.fontWeight === "regular" ? "400" : element.style.fontWeight;
  node.style.fontStyle = element.style.fontStyle;
  node.style.textAlign = element.style.align;
  appendElementContent(node, element);
  return node;
}

function renderLayoutEmptyHint(text) {
  const hint = document.createElement("div");
  hint.className = "layoutEmptyHint";
  hint.textContent = text;
  return hint;
}

function renderMusicElement(element) {
  const box = document.createElement("div");
  box.className = "musicElement";
  box.innerHTML = `<strong>${escapeHtml(element.data.title || "Music / Lead Sheet")}</strong><span>${escapeHtml(element.data.notes || "Import support TBD")}</span>`;
  return box;
}

function renderInspector() {
  const target = selectedTarget();
  if (!target) {
    els.selectionHint.textContent = "Select an element to edit its properties.";
    els.inspector.className = "inspectorEmpty";
    els.inspector.textContent = "No element selected.";
    return;
  }
  const element = target.element;

  if (target.kind === "canvasChild") {
    els.selectionHint.textContent = `${element.type} element positioned in canvas.`;
    els.inspector.className = "inspector";
    els.inspector.innerHTML = `
      <div class="fieldGrid">
        <label>X<input data-path="x" data-value-type="length" value="${attr(target.wrapper.x)}"></label>
        <label>Y<input data-path="y" data-value-type="length" value="${attr(target.wrapper.y)}"></label>
      </div>
    `;
    els.inspector.querySelectorAll("input, textarea, select").forEach((input) => {
      input.addEventListener("input", () => updateSelected(input.dataset.path, input.value, input.dataset.valueType || input.type));
    });
    return;
  }

  els.selectionHint.textContent = `${element.type} element selected.`;
  els.inspector.className = "inspector";
  if (element.type === "canvas") {
    els.inspector.innerHTML = `
      <label>Name<input data-path="name" value="${attr(element.name)}"></label>
      <div class="fieldGrid">
        <label>Width<input data-path="width" data-value-type="length" value="${attr(element.width)}"></label>
        <label>Height<input data-path="height" data-value-type="length" value="${attr(element.height)}"></label>
        <label>Margin<input data-path="margin" data-value-type="length" value="${attr(element.margin)}"></label>
      </div>
      <p class="mutedText">Canvas children are positioned by selecting them inside the dashed canvas.</p>
    `;
    els.inspector.querySelectorAll("input, textarea, select").forEach((input) => {
      input.addEventListener("input", () => updateSelected(input.dataset.path, input.value, input.dataset.valueType || input.type));
    });
    return;
  }

  els.inspector.innerHTML = `
    <label>Name<input data-path="name" value="${attr(element.name)}"></label>
    <div class="fieldGrid">
      <label>Width<input data-path="width" data-value-type="length" value="${attr(element.width)}"></label>
      <label>Height<input data-path="height" data-value-type="length" value="${attr(element.height)}"></label>
      <label>Padding<input data-path="padding" data-value-type="length" value="${attr(element.padding)}"></label>
      <label>Margin<input data-path="margin" data-value-type="length" value="${attr(element.margin)}"></label>
    </div>
    <h3>Style</h3>
    <label>Font<input data-path="style.font" value="${attr(element.style.font)}"></label>
    <div class="fieldGrid">
      <label>Font Size<input data-path="style.fontSize" data-value-type="length" value="${attr(element.style.fontSize)}"></label>
      <label>Weight<select data-path="style.fontWeight">${options(["regular", "bold"], element.style.fontWeight)}</select></label>
      <label>Style<select data-path="style.fontStyle">${options(["normal", "italic"], element.style.fontStyle)}</select></label>
      <label>Align<select data-path="style.align">${options(["left", "center", "right"], element.style.align)}</select></label>
      <label>Color<input type="color" data-path="style.color" value="${attr(colorValue(element.style.color))}"></label>
      <label>Background<input data-path="style.background" value="${attr(element.style.background)}"></label>
      <label>Border Color<input type="color" data-path="style.borderColor" value="${attr(colorValue(element.style.borderColor))}"></label>
      <label>Border Width<input data-path="style.borderWidth" data-value-type="length" value="${attr(element.style.borderWidth)}"></label>
    </div>
    <h3>Data</h3>
    ${typeFields(element)}
  `;

  els.inspector.querySelectorAll("input, textarea, select").forEach((input) => {
    input.addEventListener("input", () => updateSelected(input.dataset.path, input.value, input.dataset.valueType || input.type));
  });
}

function typeFields(element) {
  if (element.type === "pageBreak") return `<p class="mutedText">This element has no data fields.</p>`;
  const dataSchema = schemaForType(element.type)?.properties?.data;
  if (dataSchema?.properties) return schemaDataFields(element, dataSchema);
  return `<label>Text<textarea data-path="data.text">${textarea(element.data.text || "")}</textarea></label>`;
}

function schemaDataFields(element, dataSchema) {
  return Object.entries(dataSchema.properties)
    .map(([key, schema]) => schemaDataField(element, key, schema, dataSchema.required?.includes(key)))
    .join("");
}

function schemaDataField(element, key, schema, required) {
  const path = `data.${key}`;
  const label = `${labelForKey(key)}${required ? " *" : ""}`;
  const value = element.data?.[key] ?? "";
  if (Array.isArray(schema.enum)) {
    return `<label>${escapeHtml(label)}<select data-path="${attr(path)}">${options(schema.enum, value)}</select></label>`;
  }
  if (schema.type === "integer" || schema.type === "number") {
    return `<label>${escapeHtml(label)}<input type="number" data-path="${attr(path)}" data-value-type="${schema.type}" value="${attr(value)}"></label>`;
  }
  if (schema.type === "array") {
    return `<label>${escapeHtml(label)}<textarea data-path="${attr(path)}" data-value-type="array">${textarea(Array.isArray(value) ? value.join("\n") : value)}</textarea></label>`;
  }
  if (schema.format === "date") {
    return `<label>${escapeHtml(label)}<input type="date" data-path="${attr(path)}" value="${attr(value)}"></label>`;
  }
  if (schema.type === "boolean") {
    return `<label>${escapeHtml(label)}<select data-path="${attr(path)}" data-value-type="boolean">${options(["false", "true"], String(Boolean(value)))}</select></label>`;
  }
  const multiline = key === "text" || key === "notes" || key === "caption" || schema.type === "object";
  if (multiline) return `<label>${escapeHtml(label)}<textarea data-path="${attr(path)}">${textarea(value)}</textarea></label>`;
  return `<label>${escapeHtml(label)}<input data-path="${attr(path)}" value="${attr(value)}"></label>`;
}

function updateSelected(path, value, inputType) {
  const target = selectedTarget();
  if (!target) return;
  let nextValue = inputType === "number" || inputType === "integer" ? Number(value) : value;
  if (inputType === "boolean") nextValue = value === "true";
  if (inputType === "array") nextValue = value.split("\n").map((line) => line.trim()).filter(Boolean);
  if (inputType === "length") nextValue = parseLengthInput(value);
  if (target.kind === "canvasChild") {
    setDeep(target.wrapper, path, nextValue);
    clampCanvasChild(target.parentCanvas, target.wrapper);
  } else {
    setDeep(target.element, path, nextValue);
    if (target.element.type === "canvas") enforceCanvasSize(target.element);
  }
  renderCanvas();
  scheduleSaveAndMaybeBuild();
}

function addElement(type, index = state.project?.elements.length || 0) {
  if (!state.project) return;
  const element = createElement(type);
  state.project.elements.splice(clampIndex(index, state.project.elements.length), 0, element);
  selectElement(element.id);
  scheduleSaveAndMaybeBuild();
}

function createElement(type) {
  const schema = schemaForType(type);
  const defaults = defaultElementValues(type, schema);
  const base = {
    id: `el_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    name: paletteTitle({ type, schema }),
    width: defaults.width,
    height: defaults.height,
    margin: 0,
    padding: type === "canvas" || type === "pageBreak" ? 0 : 8,
    style: defaults.style,
    schema: [],
    data: defaults.data,
  };
  if (type === "canvas" || type === "grid" || type === "stack") base.children = [];
  return base;
}

function schemaForType(type) {
  return state.elementSchemas.find((entry) => entry.type === type)?.schema || null;
}

function schemaOrder(type) {
  return { text: 10, image: 20, grid: 30, stack: 40, canvas: 50, date: 60, music: 70, pageBreak: 80 }[type] ?? 100;
}

function paletteTitle(entry) {
  if (entry.type === "text") return "Textbox";
  return String(entry.schema?.title || titleCase(entry.type)).replace(/ Element$/, "");
}

function paletteDescription(entry) {
  const description = entry.schema?.description || "";
  if (entry.type === "text") return "Styled text with schema data";
  if (entry.type === "grid") return "Rows, columns, and child layout";
  if (entry.type === "stack") return "Vertical or horizontal flow";
  if (entry.type === "canvas") return "Fine placement within a flow block";
  if (entry.type === "date") return "Formatted date display";
  if (entry.type === "music") return "Lead sheet placeholder";
  if (entry.type === "pageBreak") return "Start the next PDF page";
  return description.split(".")[0] || "Schema-backed element";
}

function defaultElementValues(type, schema) {
  const dimensions = defaultDimensions(type);
  return {
    ...dimensions,
    style: defaultStyle(type),
    data: defaultData(type, schema),
  };
}

function defaultDimensions(type) {
  if (type === "image") return { width: "100%", height: 110 };
  if (type === "grid") return { width: "100%", height: "auto" };
  if (type === "stack") return { width: "100%", height: "auto" };
  if (type === "canvas") return { width: "100%", height: "auto" };
  if (type === "music") return { width: "100%", height: 120 };
  if (type === "date") return { width: "100%", height: 42 };
  if (type === "pageBreak") return { width: "100%", height: 28 };
  return { width: "100%", height: 90 };
}

function defaultStyle(type) {
  return {
    font: "Calibri",
    fontSize: 11,
    fontWeight: "regular",
    fontStyle: "normal",
    color: "#251d18",
    background: "transparent",
    borderColor: "#d8cdbd",
    borderWidth: type === "image" || type === "canvas" || type === "pageBreak" ? 0 : 1,
    align: "left",
  };
}

function defaultData(type, schema) {
  const data = fallbackData(type);
  const properties = schema?.properties?.data?.properties || {};
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (data[key] === undefined) data[key] = defaultValueForProperty(type, key, propertySchema);
  }
  return data;
}

function fallbackData(type) {
  if (type === "image") return { path: state.assets[0]?.path || "assets/church/logo.png", fit: "contain" };
  if (type === "grid") return { rows: 2, columns: 2, cellPadding: 6 };
  if (type === "stack") return { direction: "vertical", gap: 8 };
  if (type === "date") return { value: todayIsoDate(), format: "MMMM d, yyyy", locale: "en-US", prefix: "", suffix: "" };
  if (type === "music") return { title: "Music / Lead Sheet", notes: "Import support TBD" };
  if (type === "canvas") return {};
  if (type === "pageBreak") return {};
  return { text: "Text element" };
}

function defaultValueForProperty(type, key, schema) {
  if (schema.default !== undefined) return structuredClone(schema.default);
  if (schema.type === "array") return [];
  if (schema.type === "integer" || schema.type === "number") return 0;
  if (schema.type === "boolean") return false;
  if (schema.format === "date") return todayIsoDate();
  if (key === "path" && type === "image") return state.assets[0]?.path || "assets/church/logo.png";
  return "";
}

function renderDateText(element) {
  const data = element.data || {};
  const formatted = formatDate(data.value, data.format, data.locale);
  return `${data.prefix || ""}${formatted}${data.suffix || ""}`;
}

function formatDate(value, format = "MMMM d, yyyy", locale = "en-US") {
  const date = value ? new Date(`${value}T00:00:00`) : new Date();
  if (Number.isNaN(date.getTime())) return String(value || "");
  if (format === "MM/dd/yyyy") return new Intl.DateTimeFormat(locale, { month: "2-digit", day: "2-digit", year: "numeric" }).format(date);
  if (format === "EEEE, MMMM d, yyyy") return new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(date);
  if (format === "MMM d, yyyy") return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric" }).format(date);
  return new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", year: "numeric" }).format(date);
}

function beginElementDrag(event, id) {
  event.stopPropagation();
  const element = state.project?.elements.find((item) => item.id === id);
  state.isDragging = true;
  state.draggingId = id;
  state.draggingType = "element";
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("application/x-builder-existing", id);
  event.dataTransfer.setData("text/plain", element?.name || id);
  selectElement(id, { renderCanvas: false });
  event.currentTarget.classList.add("dragging");
}

function beginCanvasChildDrag(event, child) {
  event.stopPropagation();
  state.isDragging = true;
  state.draggingId = child.id;
  state.draggingType = "canvas-child";
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("application/x-builder-canvas-child", child.id);
  event.dataTransfer.setData("text/plain", child.element?.name || child.id);
  selectElement(child.id, { renderCanvas: false });
  event.currentTarget.classList.add("dragging");
}

function beginLayoutChildDrag(event, element) {
  event.stopPropagation();
  state.isDragging = true;
  state.draggingId = element.id;
  state.draggingType = "layout-child";
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("application/x-builder-layout-child", element.id);
  event.dataTransfer.setData("text/plain", element.name || element.id);
  selectElement(element.id, { renderCanvas: false });
  event.currentTarget.classList.add("dragging");
}

function handleCanvasDragOver(event) {
  if (state.draggingType === "canvas-child" || state.draggingType === "layout-child") return;
  event.preventDefault();
  event.dataTransfer.dropEffect = state.draggingId ? "move" : "copy";
  showDropSlot(insertionIndexFromPointer(event.clientY));
}

function handleCanvasDragLeave(event) {
  const rect = els.pageCanvas.getBoundingClientRect();
  const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  if (!inside) clearDropSlot();
}

function handleCanvasDrop(event) {
  event.preventDefault();
  const type = event.dataTransfer.getData("application/x-builder-element");
  const id = event.dataTransfer.getData("application/x-builder-existing");
  if (!type && !id) return;
  const index = state.dropIndex ?? insertionIndexFromPointer(event.clientY);
  clearDropSlot();
  state.isDragging = false;
  state.draggingId = null;
  state.draggingType = null;
  if (id) moveElement(id, index);
  else if (type) addElement(type, index);
}

function handleNestedCanvasDragOver(event, canvasElement, surface) {
  if (!state.isDragging) return;
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = state.draggingType === "palette" ? "copy" : "move";
  showCanvasDropMarker(surface, canvasElement, event);
}

function handleNestedCanvasDragLeave(event, surface) {
  const rect = surface.getBoundingClientRect();
  const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  if (!inside) clearCanvasDropMarker(surface);
}

function handleNestedCanvasDrop(event, canvasElement, surface) {
  event.preventDefault();
  event.stopPropagation();
  const type = event.dataTransfer.getData("application/x-builder-element");
  const elementId = event.dataTransfer.getData("application/x-builder-existing");
  const childId = event.dataTransfer.getData("application/x-builder-canvas-child");
  const layoutChildId = event.dataTransfer.getData("application/x-builder-layout-child");
  const point = clampedCanvasPoint(event, surface, canvasElement, dragElementFor(type, elementId, childId, layoutChildId));
  clearCanvasDropMarker(surface);
  state.isDragging = false;
  state.draggingId = null;
  state.draggingType = null;

  if (type) addCanvasChild(canvasElement, createElement(type), point.x, point.y);
  else if (elementId) moveTopLevelElementIntoCanvas(elementId, canvasElement, point.x, point.y);
  else if (childId) moveCanvasChild(childId, canvasElement, point.x, point.y);
  else if (layoutChildId) moveLayoutChildIntoCanvas(layoutChildId, canvasElement, point.x, point.y);
}

function handleLayoutDragOver(event, layoutElement) {
  if (!state.isDragging) return;
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = state.draggingType === "palette" ? "copy" : "move";
}

function handleLayoutDrop(event, layoutElement) {
  event.preventDefault();
  event.stopPropagation();
  const type = event.dataTransfer.getData("application/x-builder-element");
  const elementId = event.dataTransfer.getData("application/x-builder-existing");
  const canvasChildId = event.dataTransfer.getData("application/x-builder-canvas-child");
  const layoutChildId = event.dataTransfer.getData("application/x-builder-layout-child");
  const index = layoutInsertionIndex(event, layoutElement);
  state.isDragging = false;
  state.draggingId = null;
  state.draggingType = null;

  if (type) insertLayoutChild(layoutElement, createElement(type), index);
  else if (elementId) moveTopLevelElementIntoLayout(elementId, layoutElement, index);
  else if (canvasChildId) moveCanvasChildIntoLayout(canvasChildId, layoutElement, index);
  else if (layoutChildId) moveLayoutChild(layoutChildId, layoutElement, index);
}

function insertionIndexFromPointer(clientY) {
  if (!state.project) return 0;
  const nodes = [...els.pageCanvas.querySelectorAll(".canvasElement")].filter((node) => node.dataset.id !== state.draggingId);
  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return elementIndex(node.dataset.id);
  }
  return state.project.elements.length;
}

function showDropSlot(index) {
  if (!state.project) return;
  state.dropIndex = clampIndex(index, state.project.elements.length);
  let slot = els.pageCanvas.querySelector(".dropSlot");
  if (!slot) {
    slot = document.createElement("div");
    slot.className = "dropSlot";
  }
  slot.textContent = state.draggingId ? "Move here" : "Drop here";
  els.pageCanvas.insertBefore(slot, elementNodeAtOrAfter(state.dropIndex));
}

function clearDropSlot() {
  state.dropIndex = null;
  els.pageCanvas.querySelector(".dropSlot")?.remove();
}

function elementNodeAtOrAfter(index) {
  return [...els.pageCanvas.querySelectorAll(".canvasElement")]
    .filter((node) => node.dataset.id !== state.draggingId)
    .find((node) => elementIndex(node.dataset.id) >= index) || null;
}

function moveElement(id, targetIndex) {
  if (!state.project) return;
  const fromIndex = elementIndex(id);
  if (fromIndex < 0) return;
  const [element] = state.project.elements.splice(fromIndex, 1);
  const adjustedIndex = fromIndex < targetIndex ? targetIndex - 1 : targetIndex;
  state.project.elements.splice(clampIndex(adjustedIndex, state.project.elements.length), 0, element);
  selectElement(id);
  scheduleSaveAndMaybeBuild();
}

function layoutInsertionIndex(event, layoutElement) {
  const layoutNode = event.currentTarget;
  if (layoutElement.type === "grid") {
    const cell = event.target.closest?.(".gridCell");
    if (cell && layoutNode.contains(cell)) return clampIndex(cell.dataset.layoutIndex, layoutElement.children?.length || 0);
    return layoutElement.children?.length || 0;
  }
  const nodes = [...layoutNode.querySelectorAll(":scope > .layoutChild")].filter((node) => node.dataset.id !== state.draggingId);
  const horizontal = layoutElement.data?.direction === "horizontal";
  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    const pointer = horizontal ? event.clientX : event.clientY;
    const middle = horizontal ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
    if (pointer < middle) return layoutChildIndex(layoutElement, node.dataset.id);
  }
  return layoutElement.children?.length || 0;
}

function insertLayoutChild(layoutElement, element, index) {
  layoutElement.children ||= [];
  layoutElement.children.splice(clampIndex(index, layoutElement.children.length), 0, element);
  selectElement(element.id);
  scheduleSaveAndMaybeBuild();
}

function moveTopLevelElementIntoLayout(id, layoutElement, index) {
  if (id === layoutElement.id) return;
  const fromIndex = elementIndex(id);
  if (fromIndex < 0) return;
  const [element] = state.project.elements.splice(fromIndex, 1);
  if (containsElementId(element, layoutElement.id)) {
    state.project.elements.splice(fromIndex, 0, element);
    return;
  }
  insertLayoutChild(layoutElement, element, index);
}

function moveCanvasChildIntoLayout(childId, layoutElement, index) {
  const target = canvasChildTarget(childId);
  if (!target || containsElementId(target.element, layoutElement.id)) return;
  target.parentCanvas.children = target.parentCanvas.children.filter((child) => child.id !== childId);
  enforceCanvasSize(target.parentCanvas);
  insertLayoutChild(layoutElement, target.element, index);
}

function moveLayoutChild(childId, layoutElement, index) {
  const target = layoutChildTarget(childId);
  if (!target || containsElementId(target.element, layoutElement.id)) return;
  const fromIndex = layoutChildIndex(target.parentLayout, childId);
  target.parentLayout.children = target.parentLayout.children.filter((child) => child.id !== childId);
  const adjustedIndex = target.parentLayout === layoutElement && fromIndex < index ? index - 1 : index;
  insertLayoutChild(layoutElement, target.element, adjustedIndex);
}

function layoutChildIndex(layoutElement, id) {
  return layoutElement.children?.findIndex((child) => child.id === id) ?? -1;
}

function showCanvasDropMarker(surface, canvasElement, event) {
  const type = event.dataTransfer.getData("application/x-builder-element");
  const elementId = event.dataTransfer.getData("application/x-builder-existing");
  const childId = event.dataTransfer.getData("application/x-builder-canvas-child");
  const layoutChildId = event.dataTransfer.getData("application/x-builder-layout-child");
  const dragElement = dragElementFor(type, elementId, childId, layoutChildId);
  const point = clampedCanvasPoint(event, surface, canvasElement, dragElement);
  const size = effectiveElementSize(dragElement, effectiveCanvasSize(canvasElement).width);
  let marker = surface.querySelector(":scope > .canvasDropMarker");
  if (!marker) {
    marker = document.createElement("div");
    marker.className = "canvasDropMarker";
    surface.append(marker);
  }
  marker.style.left = cssLength(point.x);
  marker.style.top = cssLength(point.y);
  marker.style.width = cssLength(size.width);
  marker.style.height = cssLength(size.height);
}

function clearCanvasDropMarker(surface) {
  surface.querySelector(":scope > .canvasDropMarker")?.remove();
}

function dragElementFor(type, elementId, childId, layoutChildId) {
  if (type) return draftElement(type);
  if (elementId) return state.project?.elements.find((element) => element.id === elementId) || draftElement("text");
  if (childId) return canvasChildTarget(childId)?.element || draftElement("text");
  if (layoutChildId) return layoutChildTarget(layoutChildId)?.element || draftElement("text");
  return draftElement("text");
}

function draftElement(type) {
  const defaults = defaultElementValues(type, schemaForType(type));
  return {
    id: "draft",
    type,
    name: paletteTitle({ type, schema: schemaForType(type) }),
    width: defaults.width,
    height: defaults.height,
    margin: 0,
    padding: type === "canvas" || type === "pageBreak" ? 0 : 8,
    style: defaults.style,
    schema: [],
    data: defaults.data,
    children: type === "canvas" || type === "grid" || type === "stack" ? [] : undefined,
  };
}

function clampedCanvasPoint(event, surface, canvasElement, element) {
  const rect = surface.getBoundingClientRect();
  const size = effectiveElementSize(element, effectiveCanvasSize(canvasElement).width);
  const pageHeight = state.project?.page?.height || canvasSize.height;
  return {
    x: Math.max(0, Math.round(event.clientX - rect.left)),
    y: clampNumber(Math.round(event.clientY - rect.top), 0, Math.max(0, pageHeight - size.height)),
  };
}

function addCanvasChild(canvasElement, element, x, y) {
  const child = createCanvasChild(element, x, y);
  canvasElement.children ||= [];
  canvasElement.children.push(child);
  clampCanvasChild(canvasElement, child);
  enforceCanvasSize(canvasElement);
  selectElement(child.id);
  scheduleSaveAndMaybeBuild();
}

function moveTopLevelElementIntoCanvas(id, canvasElement, x, y) {
  if (id === canvasElement.id) return;
  const fromIndex = elementIndex(id);
  if (fromIndex < 0) return;
  const [element] = state.project.elements.splice(fromIndex, 1);
  addCanvasChild(canvasElement, element, x, y);
}

function moveCanvasChild(childId, canvasElement, x, y) {
  const target = canvasChildTarget(childId);
  if (!target || containsElementId(target.element, canvasElement.id)) return;
  target.parentCanvas.children = target.parentCanvas.children.filter((child) => child.id !== childId);
  target.wrapper.x = x;
  target.wrapper.y = y;
  canvasElement.children ||= [];
  canvasElement.children.push(target.wrapper);
  clampCanvasChild(canvasElement, target.wrapper);
  enforceCanvasSize(target.parentCanvas);
  enforceCanvasSize(canvasElement);
  selectElement(target.wrapper.id);
  scheduleSaveAndMaybeBuild();
}

function moveLayoutChildIntoCanvas(childId, canvasElement, x, y) {
  const target = layoutChildTarget(childId);
  if (!target || containsElementId(target.element, canvasElement.id)) return;
  target.parentLayout.children = target.parentLayout.children.filter((child) => child.id !== childId);
  addCanvasChild(canvasElement, target.element, x, y);
}

function createCanvasChild(element, x = 0, y = 0) {
  return {
    id: `wrap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    x,
    y,
    element,
  };
}

function cloneElementWithNewIds(element) {
  const clone = structuredClone(element);
  refreshElementIds(clone);
  return clone;
}

function refreshElementIds(element) {
  element.id = `el_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  if (element.type === "canvas") {
    for (const child of element.children || []) {
      child.id = `wrap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      refreshElementIds(child.element);
    }
  } else if (isLayoutElement(element)) {
    for (const child of element.children || []) refreshElementIds(child);
  }
}

function finishDrag() {
  const hadDrag = state.isDragging || state.draggingId;
  state.isDragging = false;
  state.draggingId = null;
  state.draggingType = null;
  clearDropSlot();
  renderCanvas();
  if (hadDrag && state.buildQueued && els.liveToggle.checked) scheduleSaveAndMaybeBuild();
}

function elementIndex(id) {
  return state.project?.elements.findIndex((element) => element.id === id) ?? -1;
}

function updateSelectionClasses() {
  els.pageCanvas.querySelectorAll(".canvasElement, .canvasChild, .layoutChild").forEach((node) => {
    node.classList.toggle("selected", node.dataset.id === state.selectedId);
  });
}

function selectElement(id, { renderCanvas = true } = {}) {
  state.selectedId = id;
  if (renderCanvas) renderAll();
  else {
    updateSelectionClasses();
    renderInspector();
  }
}

function deleteSelected() {
  if (!state.project || !state.selectedId) return;
  const target = selectedTarget();
  if (target?.kind === "canvasChild") {
    target.parentCanvas.children = target.parentCanvas.children.filter((child) => child.id !== target.wrapper.id);
    enforceCanvasSize(target.parentCanvas);
    state.selectedId = target.parentCanvas.id;
    renderAll();
    scheduleSaveAndMaybeBuild();
    return;
  }
  if (target?.kind === "layoutChild") {
    target.parentLayout.children = target.parentLayout.children.filter((child) => child.id !== target.element.id);
    state.selectedId = target.parentLayout.id;
    renderAll();
    scheduleSaveAndMaybeBuild();
    return;
  }
  state.project.elements = state.project.elements.filter((element) => element.id !== state.selectedId);
  state.selectedId = state.project.elements[0]?.id || null;
  renderAll();
  scheduleSaveAndMaybeBuild();
}

function duplicateSelected() {
  const target = selectedTarget();
  if (!target) return;
  if (target.kind === "canvasChild") {
    const clone = structuredClone(target.wrapper);
    clone.id = `wrap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    clone.x = numericLength(clone.x) + 18;
    clone.y = numericLength(clone.y) + 18;
    clone.element = cloneElementWithNewIds(clone.element);
    clone.element.name = `${clone.element.name} Copy`;
    target.parentCanvas.children.push(clone);
    clampCanvasChild(target.parentCanvas, clone);
    enforceCanvasSize(target.parentCanvas);
    selectElement(clone.id);
    scheduleSaveAndMaybeBuild();
    return;
  }
  if (target.kind === "layoutChild") {
    const clone = cloneElementWithNewIds(target.element);
    clone.name = `${clone.name} Copy`;
    const index = layoutChildIndex(target.parentLayout, target.element.id);
    target.parentLayout.children.splice(index + 1, 0, clone);
    selectElement(clone.id);
    scheduleSaveAndMaybeBuild();
    return;
  }
  const clone = cloneElementWithNewIds(target.element);
  clone.name = `${clone.name} Copy`;
  state.project.elements.splice(elementIndex(target.element.id) + 1, 0, clone);
  selectElement(clone.id);
  scheduleSaveAndMaybeBuild();
}

function applySelectedAsset() {
  const element = selectedElement();
  if (!element || element.type !== "image") return setStatus("Select an image element first.", true);
  element.data.path = els.assetSelect.value;
  renderAll();
  scheduleSaveAndMaybeBuild();
}

function scheduleSaveAndMaybeBuild() {
  if (!state.project) return;
  window.clearTimeout(state.saveTimer);
  state.saveTimer = window.setTimeout(() => safeAction(() => saveNow("Autosaved.")), saveDelay);
  if (els.liveToggle.checked) {
    scheduleLiveBuild("Editing... live PDF will rebuild shortly.");
  } else {
    setStatus("Editing... autosave pending.");
  }
}

function scheduleLiveBuild(message) {
  window.clearTimeout(state.buildTimer);
  setStatus(message);
  state.buildTimer = window.setTimeout(() => safeAction(() => buildNow({ live: true })), liveBuildDelay);
}

async function saveNow(message = "Saved.") {
  if (!state.project) return;
  if (state.isDragging) {
    state.saveTimer = window.setTimeout(() => safeAction(() => saveNow(message)), saveDelay);
    return;
  }
  state.project.name = els.projectName.value.trim() || state.project.name;
  const result = await api("/api/project", {
    method: "PUT",
    body: JSON.stringify(state.project),
  });
  state.project = result.project;
  els.projectName.value = state.project.name;
  syncProjectSelect();
  setStatus(message);
}

async function buildNow({ manual = false, live = false } = {}) {
  if (!state.project) return;
  if (live && state.isDragging) {
    state.buildQueued = true;
    return;
  }
  if (live && state.buildRunning) {
    state.buildQueued = true;
    return;
  }
  if (live) state.buildQueued = false;
  if (manual) window.clearTimeout(state.buildTimer);
  state.buildRunning = true;
  const buildProject = projectSnapshot();
  try {
    if (!live) await saveNow("Saved for build.");
    setStatus(live ? "Live PDF build running in the background..." : "Building PDF...");
    els.buildOutput.textContent = live ? "Live build started..." : "Build started...";
    const result = live
      ? await api("/api/project/live-preview", { method: "POST", body: JSON.stringify(buildProject) }, false)
      : await api(`/api/project/build?kind=${encodeURIComponent(buildProject.kind)}&name=${encodeURIComponent(buildProject.name)}`, { method: "POST" }, false);
    els.buildOutput.textContent = result.output || "Build finished.";
    if (result.ok) {
      setStatus(live ? "Live PDF updated." : "PDF built.");
      if (live && result.preview) setPreviewPdf(result.preview);
      else setPdfPreview(true, buildProject.name);
    } else {
      setStatus(`Build failed with status ${result.status}.`, true);
    }
  } finally {
    state.buildRunning = false;
    if (state.buildQueued && els.liveToggle.checked && !state.isDragging) {
      state.buildQueued = false;
      scheduleSaveAndMaybeBuild();
    }
  }
}

function projectSnapshot() {
  const snapshot = structuredClone(state.project);
  snapshot.name = els.projectName.value.trim() || snapshot.name;
  return snapshot;
}

function setPdfPreview(refresh, name = state.project?.name) {
  if (!state.project) return;
  const url = `/pdf?name=${encodeURIComponent(name)}${refresh ? `&t=${Date.now()}` : ""}`;
  els.pdfFrame.src = url;
}

function setPreviewPdf(name) {
  els.pdfFrame.src = `/preview-pdf?name=${encodeURIComponent(name)}&t=${Date.now()}`;
}

function toggleBuildOutput() {
  const visible = !els.buildOutput.hidden;
  els.buildOutput.hidden = visible;
  els.buildOutput.parentElement.classList.toggle("showBuildOutput", !visible);
  els.buildOutputToggle.textContent = visible ? "Show Build Details" : "Hide Build Details";
  els.buildOutputToggle.setAttribute("aria-pressed", String(!visible));
}

async function refreshProjectOptions(selectedName) {
  const result = await api(`/api/projects?kind=${encodeURIComponent(els.kindSelect.value)}`);
  els.projectSelect.innerHTML = "";
  for (const project of result.projects) {
    const option = document.createElement("option");
    option.value = project.name;
    option.textContent = `${project.name} (${project.elementCount})`;
    els.projectSelect.append(option);
  }
  els.projectSelect.value = selectedName;
}

function syncProjectSelect() {
  const exists = [...els.projectSelect.options].some((option) => option.value === state.project.name);
  if (!exists) refreshProjectOptions(state.project.name);
  else els.projectSelect.value = state.project.name;
}

function selectedElement() {
  return selectedTarget()?.element || null;
}

function selectedTarget() {
  if (!state.project?.elements || !state.selectedId) return null;
  for (const element of state.project.elements) {
    if (element.id === state.selectedId) return { kind: "element", element };
    const childTarget = nestedTarget(state.selectedId, element);
    if (childTarget) return childTarget;
  }
  return null;
}

function nestedTarget(id, element) {
  return canvasChildTarget(id, element) || layoutChildTarget(id, element);
}

function canvasChildTarget(id, rootElement) {
  const roots = rootElement ? [rootElement] : state.project?.elements || [];
  for (const element of roots) {
    if (element.type === "canvas") {
      for (const wrapper of element.children || []) {
        if (wrapper.id === id) return { kind: "canvasChild", wrapper, element: wrapper.element, parentCanvas: element };
        const nested = nestedTarget(id, wrapper.element);
        if (nested) return nested;
      }
    } else if (isLayoutElement(element)) {
      for (const child of element.children || []) {
        const nested = canvasChildTarget(id, child);
        if (nested) return nested;
      }
    }
  }
  return null;
}

function layoutChildTarget(id, rootElement) {
  const roots = rootElement ? [rootElement] : state.project?.elements || [];
  for (const element of roots) {
    if (isLayoutElement(element)) {
      for (const child of element.children || []) {
        if (child.id === id) return { kind: "layoutChild", element: child, parentLayout: element };
        const nested = nestedTarget(id, child);
        if (nested) return nested;
      }
    } else if (element.type === "canvas") {
      for (const wrapper of element.children || []) {
        const nested = layoutChildTarget(id, wrapper.element);
        if (nested) return nested;
      }
    }
  }
  return null;
}

function isLayoutElement(element) {
  return element?.type === "grid" || element?.type === "stack";
}

function containsElementId(element, id) {
  if (!element) return false;
  if (element.id === id) return true;
  if (element.type === "canvas") return (element.children || []).some((child) => child.id === id || containsElementId(child.element, id));
  if (isLayoutElement(element)) return (element.children || []).some((child) => containsElementId(child, id));
  return false;
}

function setDeep(object, path, value) {
  const parts = path.split(".");
  let target = object;
  for (const part of parts.slice(0, -1)) target = target[part] ||= {};
  target[parts.at(-1)] = value;
}

function effectiveCanvasSize(element, baseWidth = state.project?.page?.width || canvasSize.width) {
  const pageHeight = state.project?.page?.height || canvasSize.height;
  const content = canvasContentExtent(element, baseWidth);
  const width = Math.max(pixelLength(element.width, baseWidth, baseWidth), content.width);
  const requestedHeight = String(element.height ?? "auto").trim() === "auto" ? 0 : pixelLength(element.height, pageHeight, 0);
  const height = Math.min(pageHeight, Math.max(requestedHeight, content.height, 72));
  return { width, height };
}

function effectiveElementSize(element, baseWidth = state.project?.page?.width || canvasSize.width) {
  if (!element) return { width: 80, height: 48 };
  if (element.type === "canvas") return effectiveCanvasSize(element, baseWidth);
  const fallback = defaultDimensions(element.type);
  return {
    width: Math.max(1, pixelLength(element.width, baseWidth, pixelLength(fallback.width, baseWidth, 120))),
    height: Math.max(1, pixelLength(element.height, canvasSize.height, pixelLength(fallback.height, canvasSize.height, 80))),
  };
}

function canvasContentExtent(element, baseWidth = state.project?.page?.width || canvasSize.width) {
  return (element.children || []).reduce((extent, child) => {
    const childSize = effectiveElementSize(child.element, baseWidth);
    return {
      width: Math.max(extent.width, numericLength(child.x) + childSize.width),
      height: Math.max(extent.height, numericLength(child.y) + childSize.height),
    };
  }, { width: 0, height: 0 });
}

function enforceCanvasSize(element) {
  if (element.type !== "canvas") return;
  const content = canvasContentExtent(element);
  if (typeof element.width === "number" && element.width < content.width) element.width = content.width;
  if (typeof element.height === "number" && element.height < content.height) element.height = content.height;
}

function clampCanvasChild(canvasElement, child) {
  const pageHeight = state.project?.page?.height || canvasSize.height;
  const size = effectiveElementSize(child.element, effectiveCanvasSize(canvasElement).width);
  child.x = Math.max(0, numericLength(child.x));
  child.y = clampNumber(numericLength(child.y), 0, Math.max(0, pageHeight - size.height));
}

function cssLength(value) {
  if (typeof value === "number") return `${value}px`;
  const text = String(value ?? "0").trim();
  if (text === "auto") return text;
  if (/^-?[0-9]+(\.[0-9]+)?(pt|in|cm|mm|em|%)$/.test(text)) return text;
  if (/^-?[0-9]+(\.[0-9]+)?fr$/.test(text)) return "auto";
  const number = Number(text);
  return Number.isFinite(number) ? `${number}px` : "0px";
}

function parseLengthInput(value) {
  const text = String(value ?? "").trim();
  if (text === "auto" || /^-?[0-9]+(\.[0-9]+)?(pt|in|cm|mm|em|%|fr)$/.test(text)) return text;
  const number = Number(text);
  return Number.isFinite(number) ? number : text;
}

function pixelLength(value, base, fallback = 0) {
  if (typeof value === "number") return value;
  const text = String(value ?? "").trim();
  if (!text || text === "auto") return fallback;
  if (text.endsWith("%")) return (Number.parseFloat(text) / 100) * base;
  if (text.endsWith("fr")) return fallback;
  const number = Number.parseFloat(text);
  return Number.isFinite(number) ? number : fallback;
}

function numericLength(value) {
  if (typeof value === "number") return value;
  const number = Number.parseFloat(String(value ?? "0"));
  return Number.isFinite(number) ? number : 0;
}

async function api(path, options = {}, throwOnAppError = true) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const result = await response.json();
  if ((!response.ok || result.ok === false) && throwOnAppError) throw new Error(result.error || "Request failed");
  return result;
}

async function safeAction(action) {
  try {
    await action();
  } catch (error) {
    setStatus(error.message || "Something went wrong.", true);
  }
}

function setStatus(message, error = false) {
  els.statusText.textContent = message;
  els.statusText.classList.toggle("error", error);
}

function upcomingSundayName() {
  const date = new Date();
  const day = date.getDay();
  date.setDate(date.getDate() + (day === 0 ? 0 : 7 - day));
  return `${String(date.getMonth() + 1).padStart(2, "0")} ${String(date.getDate()).padStart(2, "0")} ${date.getFullYear()}`;
}

function todayIsoDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function titleCase(value) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function labelForKey(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function options(values, selected) {
  return values.map((value) => `<option value="${attr(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`).join("");
}

function colorValue(value) {
  return /^#[0-9A-Fa-f]{6}$/.test(value) ? value : "#ffffff";
}

function attr(value) {
  return escapeHtml(String(value ?? ""));
}

function textarea(value) {
  return escapeHtml(String(value ?? ""));
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function clampIndex(value, length) {
  const number = Number(value);
  return Math.max(0, Math.min(length, Number.isFinite(number) ? Math.round(number) : length));
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
