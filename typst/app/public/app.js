const canvasSize = { width: 672, height: 816 };
const liveBuildDelay = 1200;
const saveDelay = 350;

const state = {
  project: null,
  assets: [],
  selectedId: null,
  saveTimer: null,
  buildTimer: null,
  buildRunning: false,
  buildQueued: false,
};

const els = {
  kindSelect: document.querySelector("#kindSelect"),
  projectSelect: document.querySelector("#projectSelect"),
  projectName: document.querySelector("#projectName"),
  newButton: document.querySelector("#newButton"),
  saveButton: document.querySelector("#saveButton"),
  buildButton: document.querySelector("#buildButton"),
  liveToggle: document.querySelector("#liveToggle"),
  assetSelect: document.querySelector("#assetSelect"),
  applyAssetButton: document.querySelector("#applyAssetButton"),
  inspector: document.querySelector("#inspector"),
  selectionHint: document.querySelector("#selectionHint"),
  pageCanvas: document.querySelector("#pageCanvas"),
  statusText: document.querySelector("#statusText"),
  pdfFrame: document.querySelector("#pdfFrame"),
  buildOutput: document.querySelector("#buildOutput"),
  deleteButton: document.querySelector("#deleteButton"),
  duplicateButton: document.querySelector("#duplicateButton"),
};

els.kindSelect.addEventListener("change", () => safeAction(loadProjectList));
els.projectSelect.addEventListener("change", () => safeAction(() => loadProject(els.kindSelect.value, els.projectSelect.value)));
els.newButton.addEventListener("click", () => safeAction(createProject));
els.saveButton.addEventListener("click", () => safeAction(() => saveNow("Saved.")));
els.buildButton.addEventListener("click", () => safeAction(() => buildNow({ manual: true })));
els.applyAssetButton.addEventListener("click", applySelectedAsset);
els.deleteButton.addEventListener("click", deleteSelected);
els.duplicateButton.addEventListener("click", duplicateSelected);

document.querySelectorAll("[data-add]").forEach((button) => {
  button.addEventListener("click", () => addElement(button.dataset.add));
  button.addEventListener("dragstart", (event) => {
    event.dataTransfer.setData("application/x-builder-element", button.dataset.add);
  });
});

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
  await safeAction(loadAssets);
  await safeAction(loadProjectList);
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
  node.style.left = `${element.x}px`;
  node.style.top = `${element.y}px`;
  node.style.width = `${element.width}px`;
  node.style.height = `${element.height}px`;
  node.style.padding = `${element.padding}px`;
  node.style.color = element.style.color;
  node.style.background = element.style.background === "transparent" ? "transparent" : element.style.background;
  node.style.border = `${element.style.borderWidth}px solid ${element.style.borderColor}`;
  node.style.fontFamily = `${element.style.font}, Calibri, sans-serif`;
  node.style.fontSize = `${element.style.fontSize}px`;
  node.style.fontWeight = element.style.fontWeight === "regular" ? "400" : element.style.fontWeight;
  node.style.fontStyle = element.style.fontStyle;
  node.style.textAlign = element.style.align;

  if (element.type === "image") node.append(renderImageElement(element));
  else if (element.type === "grid") node.append(renderGridElement(element));
  else if (element.type === "stack") node.append(renderStackElement(element));
  else if (element.type === "music") node.append(renderMusicElement(element));
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
  grid.style.gap = `${element.data.cellPadding || 6}px`;
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
  stack.style.gap = `${element.data.gap || 8}px`;
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
      <label>X<input type="number" data-path="x" value="${element.x}"></label>
      <label>Y<input type="number" data-path="y" value="${element.y}"></label>
      <label>Width<input type="number" data-path="width" value="${element.width}"></label>
      <label>Height<input type="number" data-path="height" value="${element.height}"></label>
      <label>Padding<input type="number" data-path="padding" value="${element.padding}"></label>
      <label>Margin<input type="number" data-path="margin" value="${element.margin}"></label>
    </div>
    <h3>Style</h3>
    <label>Font<input data-path="style.font" value="${attr(element.style.font)}"></label>
    <div class="fieldGrid">
      <label>Font Size<input type="number" data-path="style.fontSize" value="${element.style.fontSize}"></label>
      <label>Weight<select data-path="style.fontWeight">${options(["regular", "bold"], element.style.fontWeight)}</select></label>
      <label>Style<select data-path="style.fontStyle">${options(["normal", "italic"], element.style.fontStyle)}</select></label>
      <label>Align<select data-path="style.align">${options(["left", "center", "right"], element.style.align)}</select></label>
      <label>Color<input type="color" data-path="style.color" value="${attr(colorValue(element.style.color))}"></label>
      <label>Background<input data-path="style.background" value="${attr(element.style.background)}"></label>
      <label>Border Color<input type="color" data-path="style.borderColor" value="${attr(colorValue(element.style.borderColor))}"></label>
      <label>Border Width<input type="number" data-path="style.borderWidth" value="${element.style.borderWidth}"></label>
    </div>
    <h3>Data</h3>
    ${typeFields(element)}
  `;

  els.inspector.querySelectorAll("input, textarea, select").forEach((input) => {
    input.addEventListener("input", () => updateSelected(input.dataset.path, input.value, input.type));
  });
}

function typeFields(element) {
  if (element.type === "image") {
    return `
      <label>Asset Path<input data-path="data.path" value="${attr(element.data.path || "")}"></label>
      <label>Fit<select data-path="data.fit">${options(["contain", "cover"], element.data.fit || "contain")}</select></label>
    `;
  }
  if (element.type === "grid") {
    return `
      <div class="fieldGrid">
        <label>Rows<input type="number" data-path="data.rows" value="${element.data.rows || 2}"></label>
        <label>Columns<input type="number" data-path="data.columns" value="${element.data.columns || 2}"></label>
        <label>Cell Padding<input type="number" data-path="data.cellPadding" value="${element.data.cellPadding || 6}"></label>
      </div>
      <label>Cells<textarea data-path="data.cells">${textarea((element.data.cells || []).join("\n"))}</textarea></label>
    `;
  }
  if (element.type === "stack") {
    return `
      <div class="fieldGrid">
        <label>Direction<select data-path="data.direction">${options(["vertical", "horizontal"], element.data.direction || "vertical")}</select></label>
        <label>Gap<input type="number" data-path="data.gap" value="${element.data.gap || 8}"></label>
      </div>
      <label>Items<textarea data-path="data.items">${textarea((element.data.items || []).join("\n"))}</textarea></label>
    `;
  }
  if (element.type === "music") {
    return `
      <label>Title<input data-path="data.title" value="${attr(element.data.title || "")}"></label>
      <label>Notes<textarea data-path="data.notes">${textarea(element.data.notes || "")}</textarea></label>
    `;
  }
  return `<label>Text<textarea data-path="data.text">${textarea(element.data.text || "")}</textarea></label>`;
}

function updateSelected(path, value, inputType) {
  const element = selectedElement();
  if (!element) return;
  let nextValue = inputType === "number" ? Number(value) : value;
  if (path === "data.cells" || path === "data.items") nextValue = value.split("\n").map((line) => line.trim()).filter(Boolean);
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
  const base = {
    id: `el_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    name: titleCase(type),
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y)),
    width: type === "music" ? 300 : type === "image" ? 180 : 220,
    height: type === "music" ? 120 : type === "image" ? 110 : 90,
    margin: 0,
    padding: 8,
    style: {
      font: "Calibri",
      fontSize: 11,
      fontWeight: "regular",
      fontStyle: "normal",
      color: "#251d18",
      background: type === "text" ? "#ffffff" : "transparent",
      borderColor: "#d8cdbd",
      borderWidth: type === "image" ? 0 : 1,
      align: "left",
    },
    schema: [],
    data: {},
  };
  if (type === "image") base.data = { path: state.assets[0]?.path || "assets/church/logo.png", fit: "contain" };
  else if (type === "grid") base.data = { rows: 2, columns: 2, cellPadding: 6, cells: ["Cell 1", "Cell 2", "Cell 3", "Cell 4"] };
  else if (type === "stack") base.data = { direction: "vertical", gap: 8, items: ["First item", "Second item"] };
  else if (type === "music") base.data = { title: "Music / Lead Sheet", notes: "Import support TBD" };
  else base.data = { text: "Text element" };
  return base;
}

function beginDrag(event, id) {
  event.preventDefault();
  event.stopPropagation();
  selectElement(id);
  const element = selectedElement();
  const start = { x: event.clientX, y: event.clientY, elX: element.x, elY: element.y };
  const onMove = (moveEvent) => {
    const page = state.project.page || canvasSize;
    element.x = clamp(start.elX + moveEvent.clientX - start.x, 0, page.width - element.width);
    element.y = clamp(start.elY + moveEvent.clientY - start.y, 0, page.height - element.height);
    renderCanvas();
  };
  const onUp = () => {
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
    window.clearTimeout(state.buildTimer);
    setStatus("Editing... live PDF will rebuild shortly.");
    state.buildTimer = window.setTimeout(() => safeAction(() => buildNow({ live: true })), liveBuildDelay);
  } else {
    setStatus("Editing... autosave pending.");
  }
}

async function saveNow(message = "Saved.") {
  if (!state.project) return;
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
  if (live && state.buildRunning) {
    state.buildQueued = true;
    return;
  }
  if (manual) window.clearTimeout(state.buildTimer);
  state.buildRunning = true;
  try {
    await saveNow(live ? "Autosaved for live build." : "Saved for build.");
    setStatus(live ? "Live PDF build running..." : "Building PDF...");
    els.buildOutput.textContent = live ? "Live build started..." : "Build started...";
    const result = await api(`/api/project/build?kind=${encodeURIComponent(state.project.kind)}&name=${encodeURIComponent(state.project.name)}`, { method: "POST" }, false);
    els.buildOutput.textContent = result.output || "Build finished.";
    if (result.ok) {
      setStatus(live ? "Live PDF updated." : "PDF built.");
      setPdfPreview(true);
    } else {
      setStatus(`Build failed with status ${result.status}.`, true);
    }
  } finally {
    state.buildRunning = false;
    if (state.buildQueued && els.liveToggle.checked) {
      state.buildQueued = false;
      scheduleSaveAndMaybeBuild();
    }
  }
}

function setPdfPreview(refresh) {
  if (!state.project) return;
  const url = `/pdf?name=${encodeURIComponent(state.project.name)}${refresh ? `&t=${Date.now()}` : ""}`;
  els.pdfFrame.src = url;
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

function titleCase(value) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
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
