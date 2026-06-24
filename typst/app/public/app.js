let bulletin = null;
let activePanel = "metadata";
let liveTimer = null;
let liveBuildRunning = false;
let liveBuildQueued = false;

const liveDelayMs = 1400;

const form = document.querySelector("#editorForm");
const dateInput = document.querySelector("#dateInput");
const statusText = document.querySelector("#statusText");
const buildOutput = document.querySelector("#buildOutput");
const pdfFrame = document.querySelector("#pdfFrame");
const openPdfLink = document.querySelector("#openPdfLink");
const livePreviewToggle = document.querySelector("#livePreviewToggle");

document.querySelector("#loadButton").addEventListener("click", () => safeAction(() => loadBulletin(dateInput.value.trim())));
document.querySelector("#saveButton").addEventListener("click", () => safeAction(() => saveCurrent()));
document.querySelector("#buildButton").addEventListener("click", () => safeAction(() => buildCurrent({ manual: true })));
document.querySelector("#addReadingButton").addEventListener("click", addReading);
document.querySelector("#addAnnouncementButton").addEventListener("click", addAnnouncement);
livePreviewToggle.addEventListener("change", () => {
  if (livePreviewToggle.checked) {
    scheduleLiveBuild("Live preview enabled. Rebuilding after edits settle...");
  } else {
    clearLiveTimer();
    setStatus("Live preview paused. Use Build PDF when ready.");
  }
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => showPanel(tab.dataset.panel));
});

form.addEventListener("input", () => {
  if (!bulletin) return;
  collectForm();
  scheduleLiveBuild();
});

init();

async function init() {
  const date = defaultDateFolder();
  dateInput.value = date;
  await loadBulletin(date);
}

async function loadBulletin(date) {
  if (!date) return setStatus("Enter a date folder first.", true);
  setStatus("Loading bulletin...");
  const result = await api(`/api/bulletin?date=${encodeURIComponent(date)}`);
  bulletin = result.bulletin;
  dateInput.value = bulletin.date;
  renderForm();
  setPreview();
  setStatus("Bulletin loaded. Edits will rebuild the preview after a short pause.");
}

async function saveCurrent({ silent = false } = {}) {
  if (!bulletin) return;
  collectForm();
  if (!silent) setStatus("Saving and rendering Typst...");
  const result = await api("/api/bulletin", {
    method: "POST",
    body: JSON.stringify(bulletin),
  });
  bulletin = result.bulletin;
  if (!silent) setStatus("Saved. Typst source was regenerated.");
}

async function buildCurrent({ manual = false, live = false } = {}) {
  if (!bulletin) return;
  if (live && liveBuildRunning) {
    liveBuildQueued = true;
    return;
  }

  if (manual) clearLiveTimer();
  if (live) liveBuildRunning = true;

  try {
    await saveCurrent({ silent: live });
    setStatus(live ? "Live preview building PDF..." : "Building PDF...");
    buildOutput.textContent = live ? "Live build started..." : "Building...";
    const response = await fetch(`/api/build?date=${encodeURIComponent(bulletin.date)}`, { method: "POST" });
    const result = await response.json();
    buildOutput.textContent = result.output || "Build finished.";
    if (result.ok) {
      setStatus(live ? "Live preview updated." : "PDF built successfully.");
      setPreview(true);
    } else {
      setStatus(`Build failed with status ${result.status}.`, true);
    }
  } finally {
    if (live) {
      liveBuildRunning = false;
      if (liveBuildQueued && livePreviewToggle.checked) {
        liveBuildQueued = false;
        scheduleLiveBuild("More edits detected. Rebuilding again after a short pause...");
      }
    }
  }
}

function renderForm() {
  setField("metadata.bulletinDate", bulletin.metadata.bulletinDate);
  setField("metadata.churchSeason", bulletin.metadata.churchSeason);
  setField("metadata.sermonSeries", bulletin.metadata.sermonSeries);
  setField("metadata.theme", bulletin.metadata.theme);
  setField("metadata.givingUrl", bulletin.metadata.givingUrl);
  setField("metadata.seriesLogo", bulletin.metadata.seriesLogo);
  setField("gathering.openingHymn.title", bulletin.gathering.openingHymn.title);
  setField("gathering.openingHymn.verses", bulletin.gathering.openingHymn.verses.join("\n\n"));
  setField("gathering.prayerOfTheDay", bulletin.gathering.prayerOfTheDay);
  setField("gathering.confession", bulletin.gathering.confession);
  setField("prayers.prayerOfChurchSpace", bulletin.prayers.prayerOfChurchSpace);
  setField("prayers.closingHymn.title", bulletin.prayers.closingHymn.title);
  setField("prayers.closingHymn.verses", bulletin.prayers.closingHymn.verses.join("\n\n"));
  setField("backPage.prayerText", bulletin.backPage.prayerText);
  setField("backPage.copyright", bulletin.backPage.copyright);
  renderReadings();
  renderAnnouncements();
}

function collectForm() {
  bulletin.date = dateInput.value.trim();
  bulletin.metadata.bulletinDate = getField("metadata.bulletinDate");
  bulletin.metadata.churchSeason = getField("metadata.churchSeason");
  bulletin.metadata.sermonSeries = getField("metadata.sermonSeries");
  bulletin.metadata.theme = getField("metadata.theme");
  bulletin.metadata.givingUrl = getField("metadata.givingUrl");
  bulletin.metadata.seriesLogo = getField("metadata.seriesLogo");
  bulletin.gathering.openingHymn.title = getField("gathering.openingHymn.title");
  bulletin.gathering.openingHymn.verses = splitParagraphs(getField("gathering.openingHymn.verses"));
  bulletin.gathering.prayerOfTheDay = getField("gathering.prayerOfTheDay");
  bulletin.gathering.confession = getField("gathering.confession");
  bulletin.prayers.prayerOfChurchSpace = getField("prayers.prayerOfChurchSpace");
  bulletin.prayers.closingHymn.title = getField("prayers.closingHymn.title");
  bulletin.prayers.closingHymn.verses = splitParagraphs(getField("prayers.closingHymn.verses"));
  bulletin.backPage.prayerText = getField("backPage.prayerText");
  bulletin.backPage.copyright = getField("backPage.copyright");

  bulletin.word.readings = [...document.querySelectorAll("[data-reading]")].map((card) => ({
    label: card.querySelector("[data-field='label']").value,
    reference: card.querySelector("[data-field='reference']").value,
    summary: card.querySelector("[data-field='summary']").value,
    text: card.querySelector("[data-field='text']").value,
  }));

  bulletin.announcements = [...document.querySelectorAll("[data-announcement]")].map((card) => ({
    title: card.querySelector("[data-field='title']").value,
    body: card.querySelector("[data-field='body']").value,
    includeGivingQr: card.querySelector("[data-field='includeGivingQr']").checked,
  }));
}

function renderReadings() {
  const root = document.querySelector("#readings");
  root.innerHTML = "";
  bulletin.word.readings.forEach((reading, index) => {
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.reading = String(index);
    card.innerHTML = `
      <div class="cardHeader">
        <h3>Reading ${index + 1}</h3>
        <button class="smallDanger" type="button">Remove</button>
      </div>
      <div class="grid2">
        <label>Label<input data-field="label"></label>
        <label>Reference<input data-field="reference"></label>
      </div>
      <label>Summary<input data-field="summary"></label>
      <label>Text<textarea data-field="text"></textarea></label>
    `;
    card.querySelector("[data-field='label']").value = reading.label || "";
    card.querySelector("[data-field='reference']").value = reading.reference || "";
    card.querySelector("[data-field='summary']").value = reading.summary || "";
    card.querySelector("[data-field='text']").value = reading.text || "";
    card.querySelector("button").addEventListener("click", () => {
      bulletin.word.readings.splice(index, 1);
      renderReadings();
      collectForm();
      scheduleLiveBuild();
    });
    root.append(card);
  });
}

function renderAnnouncements() {
  const root = document.querySelector("#announcements");
  root.innerHTML = "";
  bulletin.announcements.forEach((announcement, index) => {
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.announcement = String(index);
    card.innerHTML = `
      <div class="cardHeader">
        <h3>Announcement ${index + 1}</h3>
        <button class="smallDanger" type="button">Remove</button>
      </div>
      <label>Title<input data-field="title"></label>
      <label>Body<textarea data-field="body"></textarea></label>
      <label class="checkbox"><span><input data-field="includeGivingQr" type="checkbox"> Include giving QR placeholder after this announcement</span></label>
    `;
    card.querySelector("[data-field='title']").value = announcement.title || "";
    card.querySelector("[data-field='body']").value = announcement.body || "";
    card.querySelector("[data-field='includeGivingQr']").checked = Boolean(announcement.includeGivingQr);
    card.querySelector("button").addEventListener("click", () => {
      bulletin.announcements.splice(index, 1);
      renderAnnouncements();
      collectForm();
      scheduleLiveBuild();
    });
    root.append(card);
  });
}

function addReading() {
  collectForm();
  bulletin.word.readings.push({ label: "Reading", reference: "Book Chapter:Verse", summary: "", text: "" });
  renderReadings();
  scheduleLiveBuild();
}

function addAnnouncement() {
  collectForm();
  bulletin.announcements.push({ title: "New Announcement", body: "", includeGivingQr: false });
  renderAnnouncements();
  scheduleLiveBuild();
}

function scheduleLiveBuild(message = "Editing... live preview will rebuild shortly.") {
  if (!bulletin || !livePreviewToggle.checked) return;
  clearLiveTimer();
  setStatus(message);
  liveTimer = window.setTimeout(() => {
    liveTimer = null;
    safeAction(() => buildCurrent({ live: true }));
  }, liveDelayMs);
}

function clearLiveTimer() {
  if (!liveTimer) return;
  window.clearTimeout(liveTimer);
  liveTimer = null;
}

function showPanel(name) {
  activePanel = name;
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.panel === name));
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === `panel-${name}`));
}

function setField(name, value) {
  const field = form.elements[name];
  if (field) field.value = value || "";
}

function getField(name) {
  return form.elements[name]?.value || "";
}

function splitParagraphs(value) {
  return value.split(/\n\s*\n/g).map((item) => item.trim()).filter(Boolean);
}

function setPreview(refresh = false) {
  if (!bulletin) return;
  const url = `/pdf?date=${encodeURIComponent(bulletin.date)}${refresh ? `&t=${Date.now()}` : ""}`;
  pdfFrame.src = url;
  openPdfLink.href = url;
}

function setStatus(message, error = false) {
  statusText.textContent = message;
  statusText.style.color = error ? "#8b2115" : "";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const result = await response.json();
  if (!response.ok || result.ok === false) throw new Error(result.error || "Request failed");
  return result;
}

async function safeAction(action) {
  try {
    await action();
  } catch (error) {
    setStatus(error.message || "Something went wrong.", true);
  }
}

function defaultDateFolder() {
  const date = new Date();
  const day = date.getDay();
  date.setDate(date.getDate() + (day === 0 ? 0 : 7 - day));
  return `${String(date.getMonth() + 1).padStart(2, "0")} ${String(date.getDate()).padStart(2, "0")} ${date.getFullYear()}`;
}
