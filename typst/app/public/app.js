const canvasSize = { width: 672, height: 816 };
const pxPerIn = 96;
const ptPerPx = 0.75;
const liveBuildDelay = 1200;
const saveDelay = 350;
const pageSetupId = "__page_setup__";
const physicalDataFields = new Set(["cellPadding", "rowGap", "columnGap", "gap"]);

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
  draggingElementType: null,
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
  pageSetupButton: document.querySelector("#pageSetupButton"),
  deleteButton: document.querySelector("#deleteButton"),
  duplicateButton: document.querySelector("#duplicateButton"),
};

els.kindSelect.addEventListener("change", () => safeAction(loadProjectList));
els.projectSelect.addEventListener("change", () => safeAction(() => loadProject(els.kindSelect.value, els.projectSelect.value)));
els.newButton.addEventListener("click", () => safeAction(createProject));
els.saveButton.addEventListener("click", () => safeAction(() => saveNow("Saved.")));
els.buildButton.addEventListener("click", () => safeAction(() => buildNow({ manual: true })));
els.buildOutputToggle.addEventListener("click", toggleBuildOutput);
els.pageSetupButton.addEventListener("click", selectPageSetup);
els.applyAssetButton.addEventListener("click", applySelectedAsset);
els.deleteButton.addEventListener("click", deleteSelected);
els.duplicateButton.addEventListener("click", duplicateSelected);
document.addEventListener("keydown", handleGlobalKeyDown);

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
      state.draggingElementType = entry.type;
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData("application/x-builder-element", entry.type);
      event.dataTransfer.setData("text/plain", entry.type);
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
  const margins = pageMargins(page);
  els.pageCanvas.style.width = `${page.width}px`;
  els.pageCanvas.style.minHeight = `${Math.min(page.height || canvasSize.height, 320)}px`;
  els.pageCanvas.style.padding = `${cssLength(margins.top)} ${cssLength(margins.right)} ${cssLength(margins.bottom)} ${cssLength(margins.left)}`;
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
  const autoWidth = isAutoLength(child.element.width);
  const autoHeight = isAutoLength(child.element.height);
  const wrapper = document.createElement("div");
  wrapper.className = "canvasChild";
  wrapper.classList.toggle("selected", child.id === state.selectedId);
  wrapper.classList.toggle("dragging", child.id === state.draggingId);
  wrapper.dataset.id = child.id;
  wrapper.style.left = cssLength(child.x);
  wrapper.style.top = cssLength(child.y);
  wrapper.style.width = autoWidth ? "fit-content" : cssLength(size.width);
  wrapper.style.height = autoHeight ? "fit-content" : cssLength(size.height);
  if (autoWidth) wrapper.style.maxWidth = cssLength(size.width);
  wrapper.draggable = true;
  wrapper.addEventListener("click", (event) => {
    event.stopPropagation();
    selectElement(child.id);
  });
  wrapper.addEventListener("dragstart", (event) => beginCanvasChildDrag(event, child));
  wrapper.addEventListener("dragend", finishDrag);
  wrapper.append(renderCanvasChildElement(child.element, size, { autoWidth, autoHeight }));
  return wrapper;
}

function renderCanvasChildElement(element, size, { autoWidth = false, autoHeight = false } = {}) {
  const node = document.createElement("div");
  node.className = `canvasChildElement type-${element.type}`;
  node.style.width = autoWidth ? "fit-content" : "100%";
  node.style.height = autoHeight ? "fit-content" : "100%";
  if (autoWidth) node.style.maxWidth = "100%";
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
  if (target.kind === "page") {
    const page = state.project.page || canvasSize;
    const margins = pageMargins(page);
    els.selectionHint.textContent = "Page setup selected.";
    els.inspector.className = "inspector";
    els.inspector.innerHTML = `
      <h3>Editor Page</h3>
      <div class="fieldGrid">
        <label>GUI Width<input data-path="width" data-value-type="page-inch-length" value="${attr(inchValue(page.width))}"></label>
        <label>GUI Height<input data-path="height" data-value-type="page-inch-length" value="${attr(inchValue(page.height))}"></label>
      </div>
      <h3>PDF Page</h3>
      <div class="fieldGrid">
        <label>PDF Width<input data-path="typstWidth" data-value-type="typst-inch-length" value="${attr(inchValue(page.typstWidth || "7in"))}"></label>
        <label>PDF Height<input data-path="typstHeight" data-value-type="typst-inch-length" value="${attr(inchValue(page.typstHeight || "8.5in"))}"></label>
      </div>
      <label>Page Color<input type="color" data-path="background" value="${attr(colorValue(page.background || "#ffffff"))}"></label>
      <h3>Margins</h3>
      <div class="fieldGrid">
        <label>Top<input data-path="margins.top" data-value-type="inch-spacing" value="${attr(inchValue(margins.top))}"></label>
        <label>Right<input data-path="margins.right" data-value-type="inch-spacing" value="${attr(inchValue(margins.right))}"></label>
        <label>Bottom<input data-path="margins.bottom" data-value-type="inch-spacing" value="${attr(inchValue(margins.bottom))}"></label>
        <label>Left<input data-path="margins.left" data-value-type="inch-spacing" value="${attr(inchValue(margins.left))}"></label>
      </div>
      <p class="mutedText">Margins define the content box. Elements and PDF output always stay inside this area.</p>
    `;
    wireInspectorInputs();
    return;
  }
  const element = target.element;

  if (target.kind === "canvasChild") {
    els.selectionHint.textContent = `${element.type} element positioned in canvas.`;
    els.inspector.className = "inspector";
    els.inspector.innerHTML = `
      <h3>Canvas Position</h3>
      <div class="fieldGrid">
        <label>X<input data-path="x" data-value-type="inch-spacing" value="${attr(inchValue(target.wrapper.x))}"></label>
        <label>Y<input data-path="y" data-value-type="inch-spacing" value="${attr(inchValue(target.wrapper.y))}"></label>
      </div>
      <h3>Wrapped Element</h3>
      ${wrappedElementFields(element)}
    `;
    wireInspectorInputs();
    return;
  }

  els.selectionHint.textContent = `${element.type} element selected.`;
  els.inspector.className = "inspector";
  if (element.type === "canvas") {
    els.inspector.innerHTML = `
      <label>Name<input data-path="name" value="${attr(element.name)}"></label>
      <div class="fieldGrid">
        <label>Width<input data-path="width" data-value-type="inch-size" value="${attr(inchValue(element.width))}"></label>
        <label>Height<input data-path="height" data-value-type="inch-size" value="${attr(inchValue(element.height))}"></label>
        <label>Margin<input data-path="margin" data-value-type="inch-spacing" value="${attr(inchValue(element.margin))}"></label>
      </div>
      <p class="mutedText">Canvas children are positioned by selecting them inside the dashed canvas.</p>
    `;
    wireInspectorInputs();
    return;
  }

  els.inspector.innerHTML = `
    <label>Name<input data-path="name" value="${attr(element.name)}"></label>
    <div class="fieldGrid">
      <label>Width<input data-path="width" data-value-type="inch-size" value="${attr(inchValue(element.width))}"></label>
      <label>Height<input data-path="height" data-value-type="inch-size" value="${attr(inchValue(element.height))}"></label>
      <label>Padding<input data-path="padding" data-value-type="inch-spacing" value="${attr(inchValue(element.padding))}"></label>
      <label>Margin<input data-path="margin" data-value-type="inch-spacing" value="${attr(inchValue(element.margin))}"></label>
    </div>
    <h3>Style</h3>
    <label>Font<input data-path="style.font" value="${attr(element.style.font)}"></label>
    <div class="fieldGrid">
      ${fontSizeControl("style.fontSize", element.style.fontSize)}
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

  wireInspectorInputs();
}

function wireInspectorInputs() {
  els.inspector.querySelectorAll("input, textarea, select").forEach((input) => {
    applyInputTooltip(input);
    input.addEventListener("keydown", handleInspectorInputKeyDown);
    input.addEventListener("input", () => updateSelected(input.dataset.path, input.value, input.dataset.valueType || input.type));
  });
  els.inspector.querySelectorAll("[data-font-size-step]").forEach((button) => {
    button.addEventListener("click", handleFontSizeButtonClick);
  });
}

function fontSizeControl(path, value) {
  return `<label>Font Size
    <span class="fontSizeControl">
      <input data-path="${attr(path)}" data-value-type="length" value="${attr(value)}">
      <span class="fontSizeButtons">
        <button type="button" data-font-size-step="1" title="Increase font size" aria-label="Increase font size">&uarr;</button>
        <button type="button" data-font-size-step="-1" title="Decrease font size" aria-label="Decrease font size">&darr;</button>
      </span>
    </span>
  </label>`;
}

function handleFontSizeButtonClick(event) {
  const input = event.currentTarget.closest(".fontSizeControl")?.querySelector("input");
  if (!input) return;
  const nextValue = adjustedFontSize(input.value, Number(event.currentTarget.dataset.fontSizeStep), 1);
  if (nextValue === null) return;
  input.value = nextValue;
  updateSelected(input.dataset.path, input.value, input.dataset.valueType || input.type);
}

function handleInspectorInputKeyDown(event) {
  const input = event.currentTarget;
  if (!input.dataset.path?.endsWith("style.fontSize")) return;
  const direction = event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
  if (!direction || event.metaKey || event.altKey) return;
  const nextValue = adjustedFontSize(input.value, direction, event.ctrlKey ? 5 : 1);
  if (nextValue === null) return;
  event.preventDefault();
  input.value = nextValue;
  updateSelected(input.dataset.path, input.value, input.dataset.valueType || input.type);
}

function adjustedFontSize(value, direction, multiplier) {
  const match = String(value ?? "").trim().match(/^(-?[0-9]+(?:\.[0-9]+)?)(pt|in|cm|mm|em|%)?$/);
  if (!match) return null;
  const unit = match[2] || "";
  const baseStep = unit === "em" || unit === "in" || unit === "cm" ? 0.1 : unit === "%" ? 5 : 1;
  const next = Math.max(0, Number(match[1]) + direction * baseStep * multiplier);
  return `${formatInches(next)}${unit}`;
}

function applyInputTooltip(input) {
  const type = input.dataset.valueType || input.type;
  const help = inputHelpText(type);
  if (!help) return;
  input.title = help;
  if (input.placeholder || input.tagName === "SELECT") return;
  const placeholder = inputPlaceholder(type);
  if (placeholder) input.placeholder = placeholder;
}

function inputHelpText(type) {
  if (type === "inch-size") return "Use inches by default, such as 1.25 or 1.25in. Also accepts %, auto, and fr.";
  if (type === "inch-spacing") return "Use inches by default, such as 0.125 or 0.125in. Also accepts %.";
  if (type === "page-inch-length") return "Use page size in inches, such as 7 or 7in.";
  if (type === "typst-inch-length") return "Use PDF page size in inches, such as 7 or 7in.";
  if (type === "length") return "Use a number or length such as 11, 11pt, 1em, 0.125in, or %.";
  if (type === "integer") return "Use a whole number.";
  if (type === "number") return "Use a number.";
  if (type === "array") return "Enter one item per line.";
  if (type === "boolean") return "Choose true or false.";
  return "";
}

function inputPlaceholder(type) {
  if (type === "inch-size") return "1.25in, 100%, auto";
  if (type === "inch-spacing") return "0.125in or 0.125";
  if (type === "page-inch-length" || type === "typst-inch-length") return "7in";
  if (type === "length") return "11pt or 11";
  return "";
}

function wrappedElementFields(element) {
  const prefix = "element.";
  if (element.type === "canvas") {
    return `
      <label>Name<input data-path="${prefix}name" value="${attr(element.name)}"></label>
      <div class="fieldGrid">
        <label>Width<input data-path="${prefix}width" data-value-type="inch-size" value="${attr(inchValue(element.width))}"></label>
        <label>Height<input data-path="${prefix}height" data-value-type="inch-size" value="${attr(inchValue(element.height))}"></label>
        <label>Margin<input data-path="${prefix}margin" data-value-type="inch-spacing" value="${attr(inchValue(element.margin))}"></label>
      </div>
      <p class="mutedText">This nested canvas has its own children and placement area.</p>
    `;
  }
  return `
    <label>Name<input data-path="${prefix}name" value="${attr(element.name)}"></label>
    <div class="fieldGrid">
      <label>Width<input data-path="${prefix}width" data-value-type="inch-size" value="${attr(inchValue(element.width))}"></label>
      <label>Height<input data-path="${prefix}height" data-value-type="inch-size" value="${attr(inchValue(element.height))}"></label>
      <label>Padding<input data-path="${prefix}padding" data-value-type="inch-spacing" value="${attr(inchValue(element.padding))}"></label>
      <label>Margin<input data-path="${prefix}margin" data-value-type="inch-spacing" value="${attr(inchValue(element.margin))}"></label>
    </div>
    <h3>Style</h3>
    <label>Font<input data-path="${prefix}style.font" value="${attr(element.style.font)}"></label>
    <div class="fieldGrid">
      ${fontSizeControl(`${prefix}style.fontSize`, element.style.fontSize)}
      <label>Weight<select data-path="${prefix}style.fontWeight">${options(["regular", "bold"], element.style.fontWeight)}</select></label>
      <label>Style<select data-path="${prefix}style.fontStyle">${options(["normal", "italic"], element.style.fontStyle)}</select></label>
      <label>Align<select data-path="${prefix}style.align">${options(["left", "center", "right"], element.style.align)}</select></label>
      <label>Color<input type="color" data-path="${prefix}style.color" value="${attr(colorValue(element.style.color))}"></label>
      <label>Background<input data-path="${prefix}style.background" value="${attr(element.style.background)}"></label>
      <label>Border Color<input type="color" data-path="${prefix}style.borderColor" value="${attr(colorValue(element.style.borderColor))}"></label>
      <label>Border Width<input data-path="${prefix}style.borderWidth" data-value-type="length" value="${attr(element.style.borderWidth)}"></label>
    </div>
    <h3>Data</h3>
    ${typeFields(element, prefix)}
  `;
}

function typeFields(element, pathPrefix = "") {
  if (element.type === "pageBreak") return `<p class="mutedText">This element has no data fields.</p>`;
  const dataSchema = schemaForType(element.type)?.properties?.data;
  if (dataSchema?.properties) return schemaDataFields(element, dataSchema, pathPrefix);
  return `<label>Text<textarea data-path="${pathPrefix}data.text">${textarea(element.data.text || "")}</textarea></label>`;
}

function schemaDataFields(element, dataSchema, pathPrefix = "") {
  return Object.entries(dataSchema.properties)
    .map(([key, schema]) => schemaDataField(element, key, schema, dataSchema.required?.includes(key), pathPrefix))
    .join("");
}

function schemaDataField(element, key, schema, required, pathPrefix = "") {
  const path = `${pathPrefix}data.${key}`;
  const label = `${labelForKey(key)}${required ? " *" : ""}`;
  const value = element.data?.[key] ?? "";
  if (physicalDataFields.has(key)) {
    return `<label>${escapeHtml(label)}<input data-path="${attr(path)}" data-value-type="inch-spacing" value="${attr(inchValue(value))}"></label>`;
  }
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
  const targetObject = selectedTargetObject(target);
  const currentValue = getDeep(targetObject, path);
  let nextValue = inputType === "number" || inputType === "integer" ? Number(value) : value;
  if (inputType === "boolean") nextValue = value === "true";
  if (inputType === "array") nextValue = value.split("\n").map((line) => line.trim()).filter(Boolean);
  if (inputType === "length") nextValue = parseLengthInput(value);
  if (inputType === "inch-size") nextValue = parseInchInput(value, { allowAuto: true, allowPercent: true, allowFr: true });
  if (inputType === "inch-spacing") nextValue = parseInchInput(value, { allowPercent: true });
  if (inputType === "page-inch-length") nextValue = parsePageInchInput(value, currentValue);
  if (inputType === "typst-inch-length") nextValue = parseTypstInchInput(value, currentValue);
  if (target.kind === "page") {
    setDeep(state.project.page, path, nextValue);
  } else if (target.kind === "canvasChild") {
    setDeep(target.wrapper, path, nextValue);
    if (target.wrapper.element?.type === "canvas") enforceCanvasSize(target.wrapper.element);
    clampCanvasChild(target.parentCanvas, target.wrapper);
    enforceCanvasSize(target.parentCanvas);
  } else {
    setDeep(target.element, path, nextValue);
    if (target.element.type === "canvas") enforceCanvasSize(target.element);
  }
  renderCanvas();
  scheduleSaveAndMaybeBuild();
}

function addElement(type, index = newElementInsertionIndex()) {
  if (!state.project) return;
  const element = createElement(type);
  state.project.elements.splice(clampIndex(index, state.project.elements.length), 0, element);
  selectElement(element.id);
  scheduleSaveAndMaybeBuild();
}

function newElementInsertionIndex() {
  if (!state.project?.elements?.length || !state.selectedId || state.selectedId === pageSetupId) return state.project?.elements?.length || 0;
  const selectedIndex = state.project.elements.findIndex((element) => element.id === state.selectedId || containsElementId(element, state.selectedId));
  return selectedIndex >= 0 ? selectedIndex + 1 : state.project.elements.length;
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
    borderWidth: 0,
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
  state.draggingElementType = null;
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
  state.draggingElementType = null;
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
  state.draggingElementType = null;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("application/x-builder-layout-child", element.id);
  event.dataTransfer.setData("text/plain", element.name || element.id);
  selectElement(element.id, { renderCanvas: false });
  event.currentTarget.classList.add("dragging");
}

function handleCanvasDragOver(event) {
  const canvasTarget = canvasDropTargetFromEvent(event);
  if (canvasTarget) {
    if (showCanvasFlowDropSlot(event, canvasTarget.element, canvasTarget.surface)) return;
    clearDropSlot();
    handleNestedCanvasDragOver(event, canvasTarget.element, canvasTarget.surface);
    return;
  }
  if (state.draggingType === "layout-child") return;
  event.preventDefault();
  event.dataTransfer.dropEffect = state.draggingId ? "move" : "copy";
  clearCanvasDropMarkers();
  showDropSlot(insertionIndexFromPointer(event.clientY));
}

function handleCanvasDragLeave(event) {
  const rect = els.pageCanvas.getBoundingClientRect();
  const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  if (!inside) clearDropSlot();
}

function handleCanvasDrop(event) {
  event.preventDefault();
  const canvasTarget = canvasDropTargetFromEvent(event);
  if (canvasTarget) {
    if (handleCanvasFlowDrop(event, canvasTarget.element, canvasTarget.surface)) return;
    handleNestedCanvasDrop(event, canvasTarget.element, canvasTarget.surface);
    return;
  }
  const { type, elementId: id, childId } = dragPayload(event);
  if (!type && !id && !childId) return;
  const index = state.dropIndex ?? insertionIndexFromPointer(event.clientY);
  clearDropSlot();
  clearDragState();
  if (id) moveElement(id, index);
  else if (childId) moveCanvasChildToTopLevel(childId, index);
  else if (type) addElement(type, index);
}

function handleNestedCanvasDragOver(event, canvasElement, surface) {
  if (!state.isDragging) return;
  if (showCanvasFlowDropSlot(event, canvasElement, surface)) return;
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = state.draggingType === "palette" ? "copy" : "move";
  clearDropSlot();
  showCanvasDropMarker(surface, canvasElement, event);
}

function handleNestedCanvasDragLeave(event, surface) {
  const rect = surface.getBoundingClientRect();
  const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  if (!inside) clearCanvasDropMarker(surface);
}

function handleNestedCanvasDrop(event, canvasElement, surface) {
  if (handleCanvasFlowDrop(event, canvasElement, surface)) return;
  event.preventDefault();
  event.stopPropagation();
  const { type, elementId, childId, layoutChildId } = dragPayload(event);
  const point = clampedCanvasPoint(event, surface, canvasElement, dragElementFor(type, elementId, childId, layoutChildId));
  clearCanvasDropMarker(surface);
  clearDragState();

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
  const { type, elementId, childId: canvasChildId, layoutChildId } = dragPayload(event);
  const index = layoutInsertionIndex(event, layoutElement);
  clearDragState();

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

function moveCanvasChildToTopLevel(childId, index) {
  const target = canvasChildTarget(childId);
  if (!target) return;
  target.parentCanvas.children = target.parentCanvas.children.filter((child) => child.id !== childId);
  enforceCanvasSize(target.parentCanvas);
  state.project.elements.splice(clampIndex(index, state.project.elements.length), 0, target.element);
  selectElement(target.element.id);
  scheduleSaveAndMaybeBuild();
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
  const { type, elementId, childId, layoutChildId } = dragPayload(event);
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

function clearCanvasDropMarkers() {
  els.pageCanvas.querySelectorAll(".canvasDropMarker").forEach((marker) => marker.remove());
}

function showCanvasFlowDropSlot(event, canvasElement, surface) {
  const index = canvasFlowDropIndex(event, canvasElement);
  if (index === null) return false;
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = state.draggingId ? "move" : "copy";
  clearCanvasDropMarker(surface);
  showDropSlot(index);
  return true;
}

function handleCanvasFlowDrop(event, canvasElement, surface) {
  const index = canvasFlowDropIndex(event, canvasElement);
  if (index === null) return false;
  event.preventDefault();
  event.stopPropagation();
  const { type, elementId: id, childId } = dragPayload(event);
  if (!type && !id && !childId) return true;
  clearCanvasDropMarker(surface);
  clearDropSlot();
  clearDragState();
  if (id) moveElement(id, index);
  else if (childId) moveCanvasChildToTopLevel(childId, index);
  else if (type) addElement(type, index);
  return true;
}

function canvasFlowDropIndex(event, canvasElement) {
  if (state.draggingType === "layout-child") return null;
  const index = elementIndex(canvasElement.id);
  if (index < 0) return null;
  const node = [...els.pageCanvas.querySelectorAll(":scope > .canvasElement")].find((element) => element.dataset.id === canvasElement.id);
  if (!node) return null;
  const rect = node.getBoundingClientRect();
  const edgeSize = Math.min(24, Math.max(12, rect.height * 0.12));
  if (event.clientY <= rect.top + edgeSize) return index;
  if (event.clientY >= rect.bottom - edgeSize) return index + 1;
  return null;
}

function canvasDropTargetFromEvent(event) {
  const canvasNode = event.target.closest?.(".canvasElement.type-canvas");
  if (!canvasNode || !els.pageCanvas.contains(canvasNode)) return null;
  if (state.draggingType === "element" && state.draggingId === canvasNode.dataset.id) return null;
  const element = state.project?.elements.find((item) => item.id === canvasNode.dataset.id);
  const surface = canvasNode.querySelector(":scope > .canvasSurface");
  if (!element || element.type !== "canvas" || !surface) return null;
  return { element, surface };
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
  const canvasBox = effectiveCanvasSize(canvasElement);
  const size = effectiveElementSize(element, canvasBox.width);
  const pageHeight = pageContentBox().height;
  return {
    x: clampNumber(Math.round(event.clientX - rect.left), 0, Math.max(0, canvasBox.width - size.width)),
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
  if (id === canvasElement.id) {
    rejectSelfMove(id);
    return;
  }
  const fromIndex = elementIndex(id);
  if (fromIndex < 0) return;
  const [element] = state.project.elements.splice(fromIndex, 1);
  if (containsElementId(element, canvasElement.id)) {
    state.project.elements.splice(fromIndex, 0, element);
    rejectSelfMove(id);
    return;
  }
  addCanvasChild(canvasElement, element, x, y);
}

function rejectSelfMove(id) {
  selectElement(id);
  setStatus("Cannot move an element into a canvas inside itself.", true);
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
  clearDragState();
  clearDropSlot();
  renderCanvas();
  if (hadDrag && state.buildQueued && els.liveToggle.checked) scheduleSaveAndMaybeBuild();
}

function dragPayload(event) {
  return {
    type: event.dataTransfer.getData("application/x-builder-element") || (state.draggingType === "palette" ? state.draggingElementType : ""),
    elementId: event.dataTransfer.getData("application/x-builder-existing") || (state.draggingType === "element" ? state.draggingId : ""),
    childId: event.dataTransfer.getData("application/x-builder-canvas-child") || (state.draggingType === "canvas-child" ? state.draggingId : ""),
    layoutChildId: event.dataTransfer.getData("application/x-builder-layout-child") || (state.draggingType === "layout-child" ? state.draggingId : ""),
  };
}

function clearDragState() {
  state.isDragging = false;
  state.draggingId = null;
  state.draggingType = null;
  state.draggingElementType = null;
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

function handleGlobalKeyDown(event) {
  if (isTextEntryTarget(event.target)) return;
  if (adjustSelectedWithArrowKey(event)) return;
  if (event.key !== "Delete" || event.ctrlKey || event.metaKey || event.altKey) return;
  if (!state.selectedId) return;
  event.preventDefault();
  deleteSelected();
}

function adjustSelectedWithArrowKey(event) {
  const delta = arrowDelta(event.key);
  if (!delta || event.metaKey || event.altKey) return false;
  const target = selectedTarget();
  if (target?.kind !== "canvasChild") return false;
  const step = event.ctrlKey ? 10 : 1;
  event.preventDefault();
  target.wrapper.x = numericLength(target.wrapper.x) + delta.x * step;
  target.wrapper.y = numericLength(target.wrapper.y) + delta.y * step;
  clampCanvasChild(target.parentCanvas, target.wrapper);
  enforceCanvasSize(target.parentCanvas);
  renderAll();
  scheduleSaveAndMaybeBuild();
  return true;
}

function arrowDelta(key) {
  if (key === "ArrowLeft") return { x: -1, y: 0 };
  if (key === "ArrowRight") return { x: 1, y: 0 };
  if (key === "ArrowUp") return { x: 0, y: -1 };
  if (key === "ArrowDown") return { x: 0, y: 1 };
  return null;
}

function isTextEntryTarget(target) {
  return Boolean(target?.closest?.("input, textarea, select, [contenteditable='true']"));
}

function deleteSelected() {
  if (!state.project || !state.selectedId) return;
  const target = selectedTarget();
  if (target?.kind === "page") return;
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
  if (!target || target.kind === "page") return;
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
  if (state.isDragging) {
    state.saveTimer = window.setTimeout(() => safeAction(() => saveNow(message)), saveDelay);
    return;
  }
  state.project = result.project;
  els.projectName.value = state.project.name;
  syncProjectSelect();
  renderCanvas();
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
  if (state.selectedId === pageSetupId) return { kind: "page", page: state.project.page };
  for (const element of state.project.elements) {
    if (element.id === state.selectedId) return { kind: "element", element };
    const childTarget = nestedTarget(state.selectedId, element);
    if (childTarget) return childTarget;
  }
  return null;
}

function selectPageSetup() {
  state.selectedId = pageSetupId;
  renderAll();
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

function selectedTargetObject(target) {
  if (target.kind === "page") return state.project.page;
  if (target.kind === "canvasChild") return target.wrapper;
  return target.element;
}

function getDeep(object, path) {
  return path.split(".").reduce((target, part) => target?.[part], object);
}

function setDeep(object, path, value) {
  const parts = path.split(".");
  let target = object;
  for (const part of parts.slice(0, -1)) target = target[part] ||= {};
  target[parts.at(-1)] = value;
}

function effectiveCanvasSize(element, baseWidth = pageContentBox().width) {
  const pageHeight = pageContentBox().height;
  const content = canvasContentExtent(element, baseWidth);
  const width = Math.min(baseWidth, Math.max(pixelLength(element.width, baseWidth, baseWidth), content.width));
  const requestedHeight = String(element.height ?? "auto").trim() === "auto" ? 0 : pixelLength(element.height, pageHeight, 0);
  const height = Math.min(pageHeight, Math.max(requestedHeight, content.height, 72));
  return { width, height };
}

function effectiveElementSize(element, baseWidth = pageContentBox().width) {
  if (!element) return { width: 80, height: 48 };
  if (element.type === "canvas") return effectiveCanvasSize(element, baseWidth);
  const fallback = defaultDimensions(element.type);
  const autoFallback = autoElementSizeFallback(element, baseWidth);
  const pageHeight = pageContentBox().height;
  const widthFallback = isAutoLength(element.width) ? autoFallback.width : pixelLength(fallback.width, baseWidth, 120);
  const heightFallback = isAutoLength(element.height) ? autoFallback.height : pixelLength(fallback.height, pageHeight, 80);
  return {
    width: Math.max(1, pixelLength(element.width, baseWidth, widthFallback)),
    height: Math.max(1, pixelLength(element.height, pageHeight, heightFallback)),
  };
}

function autoElementSizeFallback(element, baseWidth) {
  const padding = pixelLength(element.padding, baseWidth, 0) * 2;
  const border = pixelLength(element.style?.borderWidth, baseWidth, 0) * 2;
  const chrome = padding + border;
  if (element.type === "image") return { width: Math.min(baseWidth, 160), height: 110 };
  if (element.type === "music") return { width: Math.min(baseWidth, 220), height: 120 };
  if (element.type === "date") return { width: Math.min(baseWidth, 180), height: 42 };
  if (element.type === "pageBreak") return { width: Math.min(baseWidth, 160), height: 28 };
  const text = element.type === "text" ? String(element.data?.text || element.name || "Text") : element.name || element.type || "Element";
  const longestLine = text.split("\n").reduce((longest, line) => Math.max(longest, line.length), 1);
  const lineCount = Math.max(1, text.split("\n").length);
  const fontSize = pixelLength(element.style?.fontSize, baseWidth, 11);
  return {
    width: clampNumber(Math.ceil(longestLine * fontSize * 0.55 + chrome), 48, baseWidth),
    height: Math.max(24, Math.ceil(lineCount * fontSize * 1.35 + chrome)),
  };
}

function canvasContentExtent(element, baseWidth = pageContentBox().width) {
  const baseHeight = pageContentBox().height;
  return (element.children || []).reduce((extent, child) => {
    const childSize = effectiveElementSize(child.element, baseWidth);
    const childX = pixelLength(child.x, baseWidth, 0);
    const childY = pixelLength(child.y, baseHeight, 0);
    return {
      width: Math.max(extent.width, childX + childSize.width),
      height: Math.max(extent.height, childY + childSize.height),
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
  const pageHeight = pageContentBox().height;
  const canvasBox = effectiveCanvasSize(canvasElement);
  const size = effectiveElementSize(child.element, canvasBox.width);
  child.x = clampNumber(pixelLength(child.x, canvasBox.width, 0), 0, Math.max(0, canvasBox.width - size.width));
  child.y = clampNumber(pixelLength(child.y, pageHeight, 0), 0, Math.max(0, pageHeight - size.height));
}

function pageContentBox(page = state.project?.page || canvasSize) {
  const margins = pageMargins(page);
  const left = pixelLength(margins.left, page.width || canvasSize.width, 0);
  const right = pixelLength(margins.right, page.width || canvasSize.width, 0);
  const top = pixelLength(margins.top, page.height || canvasSize.height, 0);
  const bottom = pixelLength(margins.bottom, page.height || canvasSize.height, 0);
  return {
    width: Math.max(1, (page.width || canvasSize.width) - left - right),
    height: Math.max(1, (page.height || canvasSize.height) - top - bottom),
  };
}

function pageMargins(page = state.project?.page || canvasSize) {
  const margins = page.margins || {};
  return {
    top: margins.top ?? 0,
    right: margins.right ?? margins.outer ?? 0,
    bottom: margins.bottom ?? 0,
    left: margins.left ?? margins.inner ?? 0,
  };
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

function isAutoLength(value) {
  return String(value ?? "").trim() === "auto";
}

function inchValue(value) {
  const text = String(value ?? "").trim();
  if (!text && typeof value !== "number") return "";
  if (text === "auto" || text.endsWith("%") || text.endsWith("fr")) return text;
  const pixels = absolutePixelLength(value);
  return pixels === null ? text : `${formatInches(pixels / pxPerIn)}in`;
}

function parseLengthInput(value) {
  const text = String(value ?? "").trim();
  if (text === "auto" || /^-?[0-9]+(\.[0-9]+)?(pt|in|cm|mm|em|%|fr)$/.test(text)) return text;
  const number = Number(text);
  return Number.isFinite(number) ? number : text;
}

function parseInchInput(value, { allowAuto = false, allowPercent = false, allowFr = false } = {}) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  if (allowAuto && text === "auto") return "auto";
  if (allowPercent && /^-?[0-9]+(\.[0-9]+)?%$/.test(text)) return text;
  if (allowFr && /^-?[0-9]+(\.[0-9]+)?fr$/.test(text)) return text;
  const pixels = inchInputPixels(text);
  return pixels === null ? text : roundLength(pixels);
}

function parsePageInchInput(value, fallback) {
  const pixels = inchInputPixels(value);
  return pixels === null || pixels <= 0 ? fallback : roundLength(pixels);
}

function parseTypstInchInput(value, fallback) {
  const pixels = inchInputPixels(value);
  return pixels === null || pixels <= 0 ? fallback : `${formatInches(pixels / pxPerIn)}in`;
}

function inchInputPixels(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (/^-?[0-9]+(\.[0-9]+)?$/.test(text)) return Number(text) * pxPerIn;
  return absolutePixelLength(text);
}

function absolutePixelLength(value) {
  if (typeof value === "number") return value;
  const text = String(value ?? "").trim();
  if (!text || text === "auto" || text.endsWith("%") || text.endsWith("fr")) return null;
  if (text.endsWith("pt")) return Number.parseFloat(text) / ptPerPx;
  if (text.endsWith("in")) return Number.parseFloat(text) * pxPerIn;
  if (text.endsWith("cm")) return (Number.parseFloat(text) / 2.54) * pxPerIn;
  if (text.endsWith("mm")) return (Number.parseFloat(text) / 25.4) * pxPerIn;
  if (text.endsWith("em")) return Number.parseFloat(text) * 16;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function pixelLength(value, base, fallback = 0) {
  if (typeof value === "number") return value;
  const text = String(value ?? "").trim();
  if (!text || text === "auto") return fallback;
  if (text.endsWith("%")) return (Number.parseFloat(text) / 100) * base;
  if (text.endsWith("fr")) return fallback;
  if (text.endsWith("pt")) return Number.parseFloat(text) / ptPerPx;
  if (text.endsWith("in")) return Number.parseFloat(text) * pxPerIn;
  if (text.endsWith("cm")) return (Number.parseFloat(text) / 2.54) * pxPerIn;
  if (text.endsWith("mm")) return (Number.parseFloat(text) / 25.4) * pxPerIn;
  if (text.endsWith("em")) return Number.parseFloat(text) * 16;
  const number = Number.parseFloat(text);
  return Number.isFinite(number) ? number : fallback;
}

function numericLength(value) {
  const pixels = absolutePixelLength(value);
  if (pixels !== null) return pixels;
  const number = Number.parseFloat(String(value ?? "0"));
  return Number.isFinite(number) ? number : 0;
}

function formatInches(value) {
  return String(roundLength(value)).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function roundLength(value) {
  return Math.round(value * 10000) / 10000;
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
