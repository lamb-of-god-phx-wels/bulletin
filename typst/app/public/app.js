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

els.pageCanvas.addEventListener("dragover", (event) => event.preventDefault());
els.pageCanvas.addEventListener("drop", (event) => {
  event.preventDefault();
  const type = event.dataTransfer.getData("application/x-builder-element");
  if (!type) return;
  const point = canvasPoint(event);
  addElement(type, point.x, point.y);
});

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
      event.dataTransfer.setData("application/x-builder-element", entry.type);
    });
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
  els.pageCanvas.style.height = `${page.height}px`;
  els.pageCanvas.style.background = page.background || "#fffaf1";
  els.pageCanvas.innerHTML = "";
  for (const element of state.project.elements) {
    els.pageCanvas.append(renderElement(element));
  }
}

function renderElement(element) {
  const node = document.createElement("div");
  node.className = `canvasElement type-${element.type}`;
  node.classList.toggle("selected", element.id === state.selectedId);
  node.dataset.id = element.id;
  node.style.left = cssLength(element.x);
  node.style.top = cssLength(element.y);
  node.style.width = cssLength(element.width);
  node.style.height = cssLength(element.height);
  node.style.padding = cssLength(element.padding);
  node.style.color = element.style.color;
  node.style.background = element.style.background === "transparent" ? "transparent" : element.style.background;
  node.style.border = `${cssLength(element.style.borderWidth)} solid ${element.style.borderColor}`;
  node.style.fontFamily = `${element.style.font}, Calibri, sans-serif`;
  node.style.fontSize = cssLength(element.style.fontSize);
  node.style.fontWeight = element.style.fontWeight === "regular" ? "400" : element.style.fontWeight;
  node.style.fontStyle = element.style.fontStyle;
  node.style.textAlign = element.style.align;

  if (element.type === "image") node.append(renderImageElement(element));
  else if (element.type === "grid") node.append(renderGridElement(element));
  else if (element.type === "stack") node.append(renderStackElement(element));
  else if (element.type === "music") node.append(renderMusicElement(element));
  else if (element.type === "date") node.textContent = renderDateText(element);
  else node.textContent = element.data.text || "";

  node.addEventListener("pointerdown", (event) => beginDrag(event, element.id));
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
  grid.style.gridTemplateColumns = `repeat(${element.data.columns || 2}, 1fr)`;
  grid.style.gap = cssLength(element.data.cellPadding || 6);
  const total = Math.max(1, (element.data.rows || 2) * (element.data.columns || 2));
  for (let index = 0; index < total; index++) {
    const cell = document.createElement("div");
    cell.textContent = element.data.cells?.[index] || "";
    grid.append(cell);
  }
  return grid;
}

function renderStackElement(element) {
  const stack = document.createElement("div");
  stack.className = "stackElement";
  stack.style.flexDirection = element.data.direction === "horizontal" ? "row" : "column";
  stack.style.gap = cssLength(element.data.gap || 8);
  for (const item of element.data.items || []) {
    const child = document.createElement("div");
    child.textContent = item;
    stack.append(child);
  }
  return stack;
}

function renderMusicElement(element) {
  const box = document.createElement("div");
  box.className = "musicElement";
  box.innerHTML = `<strong>${escapeHtml(element.data.title || "Music / Lead Sheet")}</strong><span>${escapeHtml(element.data.notes || "Import support TBD")}</span>`;
  return box;
}

function renderInspector() {
  const element = selectedElement();
  if (!element) {
    els.selectionHint.textContent = "Select an element to edit its properties.";
    els.inspector.className = "inspectorEmpty";
    els.inspector.textContent = "No element selected.";
    return;
  }

  els.selectionHint.textContent = `${element.type} element selected.`;
  els.inspector.className = "inspector";
  els.inspector.innerHTML = `
    <label>Name<input data-path="name" value="${attr(element.name)}"></label>
    <div class="fieldGrid">
      <label>X<input data-path="x" data-value-type="length" value="${attr(element.x)}"></label>
      <label>Y<input data-path="y" data-value-type="length" value="${attr(element.y)}"></label>
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
  const element = selectedElement();
  if (!element) return;
  let nextValue = inputType === "number" || inputType === "integer" ? Number(value) : value;
  if (inputType === "boolean") nextValue = value === "true";
  if (inputType === "array") nextValue = value.split("\n").map((line) => line.trim()).filter(Boolean);
  if (inputType === "length") nextValue = parseLengthInput(value);
  setDeep(element, path, nextValue);
  renderCanvas();
  scheduleSaveAndMaybeBuild();
}

function addElement(type, x = 80, y = 80) {
  if (!state.project) return;
  const element = createElement(type, x, y);
  state.project.elements.push(element);
  selectElement(element.id);
  scheduleSaveAndMaybeBuild();
}

function createElement(type, x, y) {
  const schema = schemaForType(type);
  const defaults = defaultElementValues(type, schema);
  const base = {
    id: `el_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    name: paletteTitle({ type, schema }),
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y)),
    width: defaults.width,
    height: defaults.height,
    margin: 0,
    padding: 8,
    style: defaults.style,
    schema: [],
    data: defaults.data,
  };
  return base;
}

function schemaForType(type) {
  return state.elementSchemas.find((entry) => entry.type === type)?.schema || null;
}

function schemaOrder(type) {
  return { text: 10, image: 20, grid: 30, stack: 40, date: 50, music: 60 }[type] ?? 100;
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
  if (entry.type === "date") return "Formatted date display";
  if (entry.type === "music") return "Lead sheet placeholder";
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
  if (type === "image") return { width: 180, height: 110 };
  if (type === "grid") return { width: 260, height: 140 };
  if (type === "stack") return { width: 260, height: 160 };
  if (type === "music") return { width: 300, height: 120 };
  if (type === "date") return { width: 220, height: 42 };
  return { width: 220, height: 90 };
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
    borderWidth: type === "image" ? 0 : 1,
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
  if (type === "grid") return { rows: 2, columns: 2, cellPadding: 6, cells: ["Cell 1", "Cell 2", "Cell 3", "Cell 4"] };
  if (type === "stack") return { direction: "vertical", gap: 8, items: ["First item", "Second item"] };
  if (type === "date") return { value: todayIsoDate(), format: "MMMM d, yyyy", locale: "en-US", prefix: "", suffix: "" };
  if (type === "music") return { title: "Music / Lead Sheet", notes: "Import support TBD" };
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

function beginDrag(event, id) {
  event.preventDefault();
  event.stopPropagation();
  state.isDragging = true;
  selectElement(id);
  const element = selectedElement();
  const start = { x: event.clientX, y: event.clientY, elX: element.x, elY: element.y };
  const onMove = (moveEvent) => {
    const page = state.project.page || canvasSize;
    const width = pixelLength(element.width, page.width);
    const height = pixelLength(element.height, page.height);
    const x = pixelLength(start.elX, page.width) + moveEvent.clientX - start.x;
    const y = pixelLength(start.elY, page.height) + moveEvent.clientY - start.y;
    element.x = clamp(x, 0, page.width - width);
    element.y = clamp(y, 0, page.height - height);
    renderCanvas();
  };
  const onUp = () => {
    state.isDragging = false;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    renderInspector();
    scheduleSaveAndMaybeBuild();
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function selectElement(id) {
  state.selectedId = id;
  renderAll();
}

function deleteSelected() {
  if (!state.project || !state.selectedId) return;
  state.project.elements = state.project.elements.filter((element) => element.id !== state.selectedId);
  state.selectedId = state.project.elements[0]?.id || null;
  renderAll();
  scheduleSaveAndMaybeBuild();
}

function duplicateSelected() {
  const element = selectedElement();
  if (!element) return;
  const clone = structuredClone(element);
  clone.id = `el_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  clone.name = `${clone.name} Copy`;
  clone.x += 18;
  clone.y += 18;
  state.project.elements.push(clone);
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
  return state.project?.elements.find((element) => element.id === state.selectedId) || null;
}

function setDeep(object, path, value) {
  const parts = path.split(".");
  let target = object;
  for (const part of parts.slice(0, -1)) target = target[part] ||= {};
  target[parts.at(-1)] = value;
}

function canvasPoint(event) {
  const rect = els.pageCanvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
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

function pixelLength(value, base) {
  if (typeof value === "number") return value;
  const text = String(value ?? "0").trim();
  if (text.endsWith("%")) return (Number.parseFloat(text) / 100) * base;
  const number = Number.parseFloat(text);
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}
