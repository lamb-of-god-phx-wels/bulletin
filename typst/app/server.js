import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const typstDir = path.resolve(appDir, "..");
const repoRoot = path.resolve(typstDir, "..");
const contentRoot = path.join(typstDir, "content");
const pdfRoot = path.join(typstDir, "pdf");
const publicRoot = path.join(appDir, "public");
const port = Number(process.env.PORT || 5177);

const defaultBulletin = (date = upcomingSundayDate()) => ({
  date,
  metadata: {
    churchSeason: "Second Sunday After Pentecost",
    bulletinDate: "June 7, 2026",
    theme: "God Loves Sinners*",
    sermonSeries: "Say It Out Loud",
    seriesLogo: "../../../assets/sermon_series/say_it_out_loud/logo.png",
    churchLogo: "../../../assets/church/logo.png",
    churchPhoto: "../../../assets/church/ChurchCross.png",
    givingUrl: "https://example.com/give",
  },
  gathering: {
    openingHymn: {
      title: "Hymn Name (CW 000)",
      verses: ["Verse one of the hymn.", "Verse two of the hymn.", "Verse three of the hymn."],
    },
    prayerOfTheDay: "Prayer of the Day text goes here.",
    confession: "Lord God, we have sinned against you in thought, word, and deed. We have not loved you with our whole heart; we have not loved our neighbors as ourselves. We are truly sorry and repent of all our sins. For the sake of your Son, Jesus Christ, have mercy on us and forgive us, that we may delight in your will and walk in your ways, to the glory of your name. Amen.",
  },
  word: {
    readings: [
      { label: "First Reading", reference: "Book Chapter:Verse", summary: "Summary of the reading.", text: "Scripture text goes here." },
      { label: "Gospel Reading", reference: "Book Chapter:Verse", summary: "Summary of the reading.", text: "Scripture text goes here." },
      { label: "Sermon", reference: "Book Chapter:Verse", summary: "", text: "Scripture text goes here." },
    ],
    creed: "Apostles' Creed",
  },
  prayers: {
    prayerOfChurchSpace: "5em",
    closingHymn: {
      title: "Hymn Name (CW 000)",
      verses: ["Verse one of the hymn.", "Verse two of the hymn.", "Verse three of the hymn."],
    },
  },
  announcements: [
    {
      title: "Bible Classes",
      body: "Children's Sunday School - Children meet at the front of church at 10:45am on Sundays after our service and fellowship.\n\nSunday Bible Class - After the children's lesson, there is a 19-minute study.",
    },
    {
      title: "Giving to Lamb of God",
      body: "If you wish to give your offering to Lamb of God online, this QR code is provided for your convenience. Several types of payment are accepted on this secure site.",
      includeGivingQr: true,
    },
    {
      title: "Sunday Fellowship Hosting",
      body: "Thank you to all who have helped with our fellowship hosting this year. Please consider taking your turn in the next few months. The sign-up sheet is in the fellowship hall.",
    },
  ],
  backPage: {
    prayerText: "Your prayer request will be treated with great discretion and shared with a limited group of prayer warriors who will consider it a gift to cover you in prayer. This is also a way to reach the Caring Committee if you need other assistance.",
    copyright: "Opening Hymn, Text: Author; Tune: TUNE NAME, Public Domain\n\nClosing Hymn, Text: Author; Tune: TUNE NAME, Public Domain\n\nScripture taken from THE HOLY BIBLE, NEW INTERNATIONAL VERSION®, NIV® Copyright © 1973, 1978, 1984, 2011 by Biblica, Inc.® Used by permission. All rights reserved worldwide.\n\nOneLicense.net A-730121 & CCLI #1941416",
  },
});

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/api/bulletins" && req.method === "GET") return sendJson(res, await listBulletins());
    if (url.pathname === "/api/bulletin" && req.method === "GET") return sendJson(res, await loadBulletin(requireDate(url)));
    if (url.pathname === "/api/bulletin" && req.method === "POST") return sendJson(res, await saveBulletin(await readJson(req)));
    if (url.pathname === "/api/render" && req.method === "POST") return sendJson(res, await renderSavedBulletin(requireDate(url)));
    if (url.pathname === "/api/build" && req.method === "POST") return sendJson(res, await buildBulletin(requireDate(url)));
    if (url.pathname === "/pdf" && req.method === "GET") return await servePdf(res, requireDate(url));

    return await serveStatic(req, res, url.pathname);
  } catch (error) {
    const status = error.status || 500;
    sendJson(res, { ok: false, error: error.message || "Unexpected server error" }, status);
  }
}).listen(port, () => {
  console.log(`Bulletin GUI running at http://localhost:${port}`);
});

async function listBulletins() {
  await mkdir(contentRoot, { recursive: true });
  const names = await readdir(contentRoot);
  const bulletins = [];
  for (const name of names) {
    if (!isSafeDate(name)) continue;
    const jsonPath = path.join(contentRoot, name, "bulletin.json");
    try {
      await stat(jsonPath);
      const data = JSON.parse(await readFile(jsonPath, "utf8"));
      bulletins.push({ date: name, title: data.metadata?.theme || name });
    } catch {
      bulletins.push({ date: name, title: name });
    }
  }
  return { ok: true, bulletins: bulletins.sort((a, b) => b.date.localeCompare(a.date)) };
}

async function loadBulletin(date) {
  const jsonPath = bulletinJsonPath(date);
  try {
    return { ok: true, bulletin: JSON.parse(await readFile(jsonPath, "utf8")) };
  } catch {
    const bulletin = defaultBulletin(date);
    await saveBulletin(bulletin);
    return { ok: true, bulletin };
  }
}

async function saveBulletin(bulletin) {
  const date = validateDate(bulletin.date);
  const clean = mergeBulletin(defaultBulletin(date), bulletin);
  const dir = contentDir(date);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "bulletin.json"), JSON.stringify(clean, null, 2) + "\n");
  await writeFile(path.join(dir, "bulletin.typ"), renderTypst(clean));
  return { ok: true, bulletin: clean };
}

async function renderSavedBulletin(date) {
  const { bulletin } = await loadBulletin(date);
  await saveBulletin(bulletin);
  return { ok: true };
}

async function buildBulletin(date) {
  await renderSavedBulletin(date);
  const output = await run("bash", ["typst/scripts/build.sh", date], repoRoot);
  return { ok: output.status === 0, status: output.status, output: output.output };
}

async function servePdf(res, date) {
  const pdfPath = path.join(pdfRoot, `${validateDate(date)}.pdf`);
  try {
    await stat(pdfPath);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("PDF not built yet.");
    return;
  }
  res.writeHead(200, { "Content-Type": "application/pdf", "Cache-Control": "no-store" });
  createReadStream(pdfPath).pipe(res);
}

async function serveStatic(req, res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(publicRoot, safePath));
  if (!filePath.startsWith(publicRoot)) throw httpError(403, "Forbidden");
  try {
    const file = await readFile(filePath);
    res.writeHead(200, { "Content-Type": contentType(filePath) });
    res.end(file);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

function renderTypst(data) {
  const meta = data.metadata;
  const readings = data.word.readings || [];
  const announcements = data.announcements || [];
  return `#import "private-data.typ": private
#import "../../styles/bulletin.typ": *
#import "../../templates/bulletin/sections/01-welcome.typ": welcome-page

#show: bulletin-style

#let meta = (
  churchseason: "${typstString(meta.churchSeason)}",
  date: "${typstString(meta.bulletinDate)}",
  theme: "${typstString(meta.theme)}",
  churchname: "Lamb of God Lutheran Church",
  churchslogan: "Reaching Up. Reaching Out. Reaching Across.",
  churchphoto: image("${typstString(meta.churchPhoto)}", height: 1in),
  churchaddress: "599 E. Chandler Blvd., Phoenix, AZ 85048",
  churchwebsite: "MyLambofGod.org",
  churchcalendar: "MyLambofGod.org/calendar",
  churchfacebook: "facebook.com/MyLambofGod",
  churchinstagram: "@LambofGodLutheran",
  pastorname: "Pastor Michael Koepke",
  churchphone: "480-283-8329",
  pastoremail: "Pastor@MyLambofGod.org",
  sermonseries: "${typstString(meta.sermonSeries)}",
  serieslogo: image("${typstString(meta.seriesLogo)}", width: 3in),
  churchlogo: image("${typstString(meta.churchLogo)}", width: 2.25in),
  givingurl: "${typstString(meta.givingUrl)}",
)

#cover-page(meta)
#welcome-page(meta, private)

#theme-bar(meta.theme)
#divider("The Gathering")

#song("Opening Hymn", "${typstString(data.gathering.openingHymn.title)}")
#hymn-verses((${renderVerseArray(data.gathering.openingHymn.verses)}))

#bulletin-heading("Invocation")
#liturgy[
  #minister[The grace of our Lord Jesus Christ and the love of God and the fellowship of the Holy Spirit be with you.]
  #congregation[And also with you.]
]

#bulletin-heading("Prayer of the Day")
#liturgy[
  #minister[${typstMarkup(data.gathering.prayerOfTheDay)}]
  #congregation[Amen.]
]

#bulletin-heading("Confession of Sins")
#liturgy[
  #minister[Let us confess our sins to the Lord our God.]
  #congregation[${typstMarkup(data.gathering.confession)}]
  #minister[Almighty God, in his mercy, has given his Son to die for you and for his sake forgives you all your sins. As a called servant of Christ, I therefore forgive you all your sins in the name of the Father and of the Son and of the Holy Spirit.]
  #congregation[Amen.]
]

#divider("The Word")

${readings.map(renderReading).join("\n")}

#reading("Confession of Faith", "${typstString(data.word.creed)}", "")
#corporate-text[
  I believe in God, the Father almighty, maker of heaven and earth.

  I believe in Jesus Christ, his only Son, our Lord, who was conceived by the Holy Spirit, born of the virgin Mary, suffered under Pontius Pilate, was crucified, died, and was buried. He descended into hell. The third day he rose again from the dead. He ascended into heaven and is seated at the right hand of God the Father almighty. From there he will come to judge the living and the dead.

  I believe in the Holy Spirit, the holy Christian Church, the communion of saints, the forgiveness of sins, the resurrection of the body, and the life everlasting. Amen.
]

#divider("The Prayers")

#bulletin-heading("Prayer of the Church")
#v(${safeLength(data.prayers.prayerOfChurchSpace)})

#bulletin-heading("The Lord's Prayer")
#pad(left: 1.55em)[#strong[Our Father in heaven, hallowed be your name, your kingdom come, your will be done on earth as in heaven. Give us today our daily bread. Forgive us our sins, as we forgive those who sin against us. Lead us not into temptation, but deliver us from evil. For the kingdom, the power, and the glory are yours now and forever. Amen.]]

#bulletin-heading("Blessing")
#liturgy[
  #minister[Brothers and sisters, go in peace.#linebreak()Live in harmony with one another.#linebreak()Serve the Lord with gladness.]
  #minister[The Lord bless you and keep you.#linebreak()The Lord make his face shine on you and be gracious to you.#linebreak()The Lord look on you with favor and give #textcross() you peace.]
  #congregation[Amen.]
]

#song("Closing Hymn", "${typstString(data.prayers.closingHymn.title)}")
#hymn-verses((${renderVerseArray(data.prayers.closingHymn.verses)}))

#pagebreak()

#align(center)[#text(size: 14pt, weight: "bold")[ANNOUNCEMENTS]]

${announcements.map((announcement) => renderAnnouncement(announcement, meta.givingUrl)).join("\n")}

#pagebreak()

#align(center)[#text(size: 14pt, weight: "bold")[REQUESTS FOR PRAYER AND CARE]]

${typstMarkup(data.backPage.prayerText)}

#v(1fr)

#text(size: 9pt)[
${typstMarkup(data.backPage.copyright)}
]
`;
}

function renderReading(item) {
  return `#reading("${typstString(item.label)}", "${typstString(item.reference)}", "${typstString(item.summary)}")
#scripture[
${typstMarkup(item.text)}
]`;
}

function renderAnnouncement(item, givingUrl) {
  const qr = item.includeGivingQr ? `\n\n#giving-qr("${typstString(givingUrl)}")` : "";
  return `#announcement("${typstString(item.title)}")[
${typstMarkup(item.body)}
]${qr}`;
}

function renderVerseArray(verses = []) {
  return verses.map((verse) => `\n  [${typstMarkup(verse)}],`).join("") + "\n";
}

function typstString(value = "") {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function typstMarkup(value = "") {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("#", "\\#")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
    .replaceAll("$", "\\$")
    .replaceAll("*", "\\*")
    .replaceAll("_", "\\_")
    .replaceAll("`", "\\`");
}

function safeLength(value = "5em") {
  const text = String(value).trim();
  return /^\d+(\.\d+)?(pt|em|in|cm|mm)$/.test(text) ? text : "5em";
}

function mergeBulletin(base, update) {
  return {
    ...base,
    ...update,
    metadata: { ...base.metadata, ...update.metadata },
    gathering: {
      ...base.gathering,
      ...update.gathering,
      openingHymn: { ...base.gathering.openingHymn, ...update.gathering?.openingHymn },
    },
    word: { ...base.word, ...update.word },
    prayers: {
      ...base.prayers,
      ...update.prayers,
      closingHymn: { ...base.prayers.closingHymn, ...update.prayers?.closingHymn },
    },
    backPage: { ...base.backPage, ...update.backPage },
  };
}

function run(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("close", (status) => resolve({ status, output }));
  });
}

function requireDate(url) {
  return validateDate(url.searchParams.get("date") || "");
}

function validateDate(date) {
  if (!isSafeDate(date)) throw httpError(400, "Dates must use safe folder names like 06 07 2026.");
  return date;
}

function isSafeDate(date) {
  return /^[A-Za-z0-9 _-]{1,64}$/.test(date) && !date.includes("..") && !date.includes("/") && !date.includes("\\");
}

function contentDir(date) {
  return path.join(contentRoot, validateDate(date));
}

function bulletinJsonPath(date) {
  return path.join(contentDir(date), "bulletin.json");
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return JSON.parse(body || "{}");
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}

function upcomingSundayDate() {
  const date = new Date();
  const day = date.getDay();
  const offset = day === 0 ? 0 : 7 - day;
  date.setDate(date.getDate() + offset);
  return `${String(date.getMonth() + 1).padStart(2, "0")} ${String(date.getDate()).padStart(2, "0")} ${date.getFullYear()}`;
}
