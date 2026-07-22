const endpoint = process.env.BULLETIN_CDP ?? 'http://127.0.0.1:9223';
const targets = await (await fetch(`${endpoint}/json`)).json();
const target = targets.find(item => item.type === 'page');
if (!target) throw new Error('No Chromium page target found.');

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let sequence = 0;
const pending = new Map();
const events = new Map();
socket.addEventListener('message', message => {
  const value = JSON.parse(message.data);
  if (value.id && pending.has(value.id)) { const { resolve, reject } = pending.get(value.id); pending.delete(value.id); value.error ? reject(new Error(value.error.message)) : resolve(value.result); return; }
  for (const resolve of events.get(value.method) ?? []) resolve(value.params);
  events.delete(value.method);
});
const command = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
const evaluate = async expression => (await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
const wait = async (expression, label, timeout = 8000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  const context = await evaluate(`({status:document.querySelector('.save-status')?.textContent,heading:document.querySelector('.topbar h1')?.textContent,error:document.querySelector('.error-toast p')?.textContent,rulerToggle:document.querySelector('.ruler-toggle')?.outerHTML,rulers:document.querySelectorAll('.page-rulers').length,rulerFrames:document.querySelectorAll('.page-frame.with-rulers').length})`);
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(context)}`);
};
const buttonExpression = text => `Array.from(document.querySelectorAll('button')).find(element => element.textContent.trim().includes(${JSON.stringify(text)}))`;
const click = text => evaluate(`(()=>{const element=${buttonExpression(text)};if(!element)throw new Error(${JSON.stringify(`Button not found: ${text}`)});element.click();return true})()`);
const pointerClick = async text => {
  const point = await evaluate(`(()=>{const element=${buttonExpression(text)};if(!element)throw new Error(${JSON.stringify(`Button not found: ${text}`)});const rect=element.getBoundingClientRect();const hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);return {x:rect.left+rect.width/2,y:rect.top+rect.height/2,hit:hit?.textContent?.trim(),disabled:element.disabled}})()`);
  if (point.disabled) throw new Error(`${text} is disabled.`);
  if (!point.hit?.includes(text)) throw new Error(`${text} is covered by “${point.hit ?? 'nothing'}”.`);
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
};
const fill = (label, value) => evaluate(`(()=>{const label=Array.from(document.querySelectorAll('label')).find(element=>element.firstChild?.textContent?.trim()===${JSON.stringify(label)}||element.textContent.trim().startsWith(${JSON.stringify(label)}));if(!label)throw new Error(${JSON.stringify(`Field not found: ${label}`)});const element=label.querySelector('input,textarea');const prototype=element instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(element,${JSON.stringify(value)});element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
const choose = (label, value) => evaluate(`(()=>{const label=Array.from(document.querySelectorAll('label')).find(element=>element.textContent.trim().startsWith(${JSON.stringify(label)}));if(!label)throw new Error(${JSON.stringify(`Select not found: ${label}`)});const element=label.querySelector('select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(element,${JSON.stringify(value)});element.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
const setFileForButton = async (buttonText, file) => {
  await click(buttonText);
  await wait(`Boolean(document.querySelector('input[type=file]'))`, `${buttonText} file input`);
  const { root } = await command('DOM.getDocument');
  const { nodeId } = await command('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' });
  if (!nodeId) throw new Error(`File input was not found for ${buttonText}.`);
  await command('DOM.setFileInputFiles', { files: [file], nodeId });
};

const results = [];
const pass = message => { results.push(message); console.log(`✓ ${message}`); };

await command('Emulation.clearDeviceMetricsOverride');
await wait(`document.body.textContent.includes('God Loves Sinners')`, 'initial workspace');
if (await evaluate(`document.body.textContent.toLowerCase().includes('browser demo')`)) throw new Error('Browser demo wording remains.');
pass('loads a real persistent local workspace without demo wording');

if (process.env.BULLETIN_GUIDES_ONLY === '1') {
  if (await evaluate(`document.querySelector('.guide-toggle')?.getAttribute('aria-pressed') === 'true'`)) await click('Guides on');
  await click('Guides off');
  await wait(`document.querySelectorAll('.page-guides').length === document.querySelectorAll('.page-frame').length`, 'weekly margin guides');
  const weeklyGuide = await evaluate(`(()=>{const page=document.querySelector('.document-page').getBoundingClientRect();const guide=document.querySelector('.page-guides').getBoundingClientRect();const content=document.querySelector('.document-page > .page-content > :first-child').getBoundingClientRect();return {pageLeft:page.left,pageTop:page.top,pageRight:page.right,pageBottom:page.bottom,guideLeft:guide.left,guideTop:guide.top,guideRight:guide.right,guideBottom:guide.bottom,contentLeft:content.left,contentTop:content.top}})()`);
  if (Math.abs(weeklyGuide.guideLeft - weeklyGuide.contentLeft) > 1 || Math.abs(weeklyGuide.guideTop - weeklyGuide.contentTop) > 1 || Math.abs((weeklyGuide.guideLeft - weeklyGuide.pageLeft) - (weeklyGuide.pageRight - weeklyGuide.guideRight)) > 1 || Math.abs((weeklyGuide.guideTop - weeklyGuide.pageTop) - (weeklyGuide.pageBottom - weeklyGuide.guideBottom)) > 1) throw new Error(`Weekly guides do not align with the content margin: ${JSON.stringify(weeklyGuide)}`);
  await click('Templates');
  await wait(`Boolean(document.querySelector('.builder-preview .page-guides'))`, 'template margin guides');
  await fill('Page margin (inches)', '0.5');
  await wait(`(()=>{const page=document.querySelector('.builder-preview .document-page')?.getBoundingClientRect();const guide=document.querySelector('.builder-preview .page-guides')?.getBoundingClientRect();if(!page||!guide)return false;const inch=page.width/7;return Math.abs((guide.left-page.left)/inch-.5)<.01&&Math.abs((guide.top-page.top)/inch-.5)<.01})()`, 'half-inch guide alignment');
  if (await evaluate(`document.querySelector('.ruler-toggle')?.getAttribute('aria-pressed') === 'true'`)) await click('Rulers on');
  await wait(`!document.querySelector('.page-rulers') && Boolean(document.querySelector('.page-guides'))`, 'guides without rulers');
  await click('Guides on');
  await wait(`!document.querySelector('.page-guides')`, 'hidden guides');
  if (await evaluate(`localStorage.getItem('bulletin-show-guides') !== 'false'`)) throw new Error('Hidden guide preference was not saved.');
  await click('Guides off');
  await wait(`Boolean(document.querySelector('.builder-preview .page-guides'))`, 'restored guides');
  if (await evaluate(`localStorage.getItem('bulletin-show-guides') !== 'true'`)) throw new Error('Visible guide preference was not saved.');
  pass('renders optional margin guides in weekly and template previews');
  console.log(`\n${results.length} browser MVP checks passed.`);
  socket.close();
  process.exit(0);
}

if (process.env.BULLETIN_RULERS_ONLY === '1') {
  if (!await evaluate(`document.querySelector('.ruler-toggle')?.getAttribute('aria-pressed') === 'true'`)) await click('Rulers off');
  await wait(`document.querySelectorAll('.ruler-horizontal .ruler-tick').length === document.querySelectorAll('.page-frame').length * 29`, 'horizontal ruler ticks');
  const ruler = await evaluate(`(()=>{const frame=document.querySelector('.page-frame');const page=frame.querySelector('.document-page');const ticks=frame.querySelectorAll('.ruler-horizontal .ruler-tick');const vertical=frame.querySelectorAll('.ruler-vertical .ruler-tick');return {pageWidth:page.getBoundingClientRect().width,pageHeight:page.getBoundingClientRect().height,frameHeight:frame.getBoundingClientRect().height,quarter:ticks[1].getBoundingClientRect().left-ticks[0].getBoundingClientRect().left,horizontal:ticks.length,vertical:vertical.length,lastLabel:vertical[vertical.length-1].textContent}})()`);
  if (ruler.horizontal !== 29 || ruler.vertical !== 35 || ruler.lastLabel !== '8.5' || Math.abs(ruler.quarter - ruler.pageWidth / 28) > .25 || Math.abs(ruler.pageHeight - ruler.frameHeight) > .25 || Math.abs(ruler.pageHeight / ruler.pageWidth - 8.5 / 7) > .001) throw new Error(`Ruler or page measurements are inaccurate: ${JSON.stringify(ruler)}`);
  const hoverPoint = await evaluate(`(()=>{const page=document.querySelector('.page-frame .document-page');const bounds=page.getBoundingClientRect();const point={x:bounds.left+38,y:bounds.top+73,offsetX:38,offsetY:73};page.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:point.x,clientY:point.y}));return point})()`);
  await wait(`document.querySelector('.page-frame')?.classList.contains('tracking-cursor')`, 'ruler crosshair');
  const crosshair = await evaluate(`(()=>{const frame=document.querySelector('.page-frame').getBoundingClientRect();const vertical=document.querySelector('.crosshair-vertical').getBoundingClientRect();const horizontal=document.querySelector('.crosshair-horizontal').getBoundingClientRect();return {verticalX:vertical.left,verticalTop:vertical.top,verticalBottom:vertical.bottom,horizontalY:horizontal.top,horizontalLeft:horizontal.left,horizontalRight:horizontal.right,frameLeft:frame.left,frameTop:frame.top,frameRight:frame.right,frameBottom:frame.bottom}})()`);
  if (Math.abs(crosshair.verticalX - (crosshair.frameLeft + hoverPoint.offsetX)) > 1 || Math.abs(crosshair.horizontalY - (crosshair.frameTop + hoverPoint.offsetY)) > 1 || Math.abs(crosshair.verticalTop - (crosshair.frameTop - 23)) > 1 || Math.abs(crosshair.verticalBottom - crosshair.frameBottom) > 1 || Math.abs(crosshair.horizontalLeft - (crosshair.frameLeft - 23)) > 1 || Math.abs(crosshair.horizontalRight - crosshair.frameRight) > 1) throw new Error(`Crosshair does not reach the rulers accurately: ${JSON.stringify({ hoverPoint, crosshair })}`);
  await evaluate(`(()=>{const page=document.querySelector('.page-frame .document-page');page.dispatchEvent(new PointerEvent('pointerout',{bubbles:true,relatedTarget:document.body}));return true})()`);
  await wait(`!document.querySelector('.page-frame')?.classList.contains('tracking-cursor')`, 'hidden crosshair after leaving page');
  await command('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
  const compactRuler = await evaluate(`(()=>{const frame=document.querySelector('.page-frame');const page=frame.querySelector('.document-page');const ticks=frame.querySelectorAll('.ruler-horizontal .ruler-tick');return {pageWidth:page.getBoundingClientRect().width,pageHeight:page.getBoundingClientRect().height,frameHeight:frame.getBoundingClientRect().height,quarter:ticks[1].getBoundingClientRect().left-ticks[0].getBoundingClientRect().left}})()`);
  if (Math.abs(compactRuler.quarter - compactRuler.pageWidth / 28) > .25 || Math.abs(compactRuler.pageHeight - compactRuler.frameHeight) > .25 || Math.abs(compactRuler.pageHeight / compactRuler.pageWidth - 8.5 / 7) > .001) throw new Error(`Responsive ruler or page measurements are inaccurate: ${JSON.stringify(compactRuler)}`);
  const compactHover = await evaluate(`(()=>{const page=document.querySelector('.page-frame .document-page');const bounds=page.getBoundingClientRect();const point={x:bounds.left+31,y:bounds.top+47,offsetX:31,offsetY:47};page.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:point.x,clientY:point.y}));return point})()`);
  await wait(`document.querySelector('.page-frame')?.classList.contains('tracking-cursor')`, 'compact ruler crosshair');
  const compactCrosshair = await evaluate(`({x:document.querySelector('.crosshair-vertical').getBoundingClientRect().left,y:document.querySelector('.crosshair-horizontal').getBoundingClientRect().top})`);
  const compactFrame = await evaluate(`(()=>{const bounds=document.querySelector('.page-frame').getBoundingClientRect();return {left:bounds.left,top:bounds.top}})()`);
  if (Math.abs(compactCrosshair.x - (compactFrame.left + compactHover.offsetX)) > 1 || Math.abs(compactCrosshair.y - (compactFrame.top + compactHover.offsetY)) > 1) throw new Error(`Compact crosshair does not track the cursor accurately: ${JSON.stringify({ compactHover, compactCrosshair, compactFrame })}`);
  await command('Emulation.clearDeviceMetricsOverride');
  await click('Rulers on');
  await wait(`!document.querySelector('.page-rulers') && !document.querySelector('.page-crosshairs') && !document.querySelector('.page-frame.with-rulers')`, 'hidden rulers, crosshairs, and spacing');
  if (await evaluate(`localStorage.getItem('bulletin-show-rulers') !== 'false'`)) throw new Error('Hidden ruler preference was not saved.');
  await click('Templates');
  await wait(`document.querySelector('.ruler-toggle')?.textContent.includes('off') && !document.querySelector('.page-rulers')`, 'hidden template rulers');
  await click('Rulers off');
  await wait(`Boolean(document.querySelector('.builder-preview .page-rulers'))`, 'visible template rulers');
  if (await evaluate(`localStorage.getItem('bulletin-show-rulers') !== 'true'`)) throw new Error('Visible ruler preference was not saved.');
  for (const margin of [0, .25, .5]) {
    await fill('Page margin (inches)', String(margin));
    await wait(`(()=>{const pageElement=document.querySelector('.builder-preview .document-page');const page=pageElement?.getBoundingClientRect();const content=document.querySelector('.builder-preview .document-page > .page-content > :first-child')?.getBoundingClientRect();if(!page||!content)return false;const inches=page.width/7;return Math.abs((content.left-page.left)/inches-${margin})<.01&&Math.abs((content.top-page.top)/inches-${margin})<.01&&getComputedStyle(pageElement).paddingLeft==='0px'})()`, `${margin} inch template margin alignment`);
  }
  pass('renders optional, accurate 7 × 8.5 inch rulers');
  console.log(`\n${results.length} browser MVP checks passed.`);
  socket.close();
  process.exit(0);
}

if (process.env.BULLETIN_DELETE_ONLY === '1') {
  await pointerClick('Delete');
  await wait(`Boolean(document.querySelector('.confirmation-modal'))`, 'in-app delete confirmation');
  await pointerClick('Delete bulletin');
  await wait(`document.body.textContent.includes('No bulletins yet')`, 'empty bulletin state');
  const remaining = await evaluate(`window.bulletin.openWorkspace(localStorage.getItem('bulletin-workspace')).then(workspace => workspace.bulletins.length)`);
  if (remaining !== 0) throw new Error(`Deleted bulletin remains in browser storage (${remaining} records).`);
  pass('deletes a bulletin without recreating it');
  console.log(`\n${results.length} browser MVP checks passed.`);
  socket.close();
  process.exit(0);
}

if (process.env.BULLETIN_LIBRARY_DELETE_ONLY === '1') {
  await click('Library'); await click('Add library item');
  await fill('Title', 'Temporary Song'); await fill('Stable ID', 'temporary-song'); await fill('Structured text', 'Temporary lyrics.');
  await click('Save item'); await wait(`document.body.textContent.includes('Temporary Song')`, 'saved temporary library item');
  await pointerClick('Delete'); await wait(`Boolean(document.querySelector('.confirmation-modal'))`, 'library delete confirmation');
  await pointerClick('Delete item'); await wait(`!document.body.textContent.includes('Temporary Song')`, 'removed library item');
  const remaining = await evaluate(`window.bulletin.openWorkspace(localStorage.getItem('bulletin-workspace')).then(workspace => workspace.library.items.length)`);
  if (remaining !== 0) throw new Error(`Deleted library item remains in storage (${remaining} records).`);
  pass('deletes a versioned library item');
  console.log(`\n${results.length} browser MVP checks passed.`);
  socket.close();
  process.exit(0);
}

if (process.env.BULLETIN_LIBRARY_EDIT_ONLY === '1') {
  await click('Library'); await click('Add library item');
  await fill('Title', 'Original Song'); await fill('Stable ID', 'editable-song'); await fill('Structured text', 'Original lyrics.');
  await click('Save item'); await wait(`document.body.textContent.includes('Original Song')`, 'original library item');
  await pointerClick('Edit'); await fill('Title', 'Edited Song'); await fill('Structured text', 'Updated lyrics.');
  await click('Save new version'); await wait(`document.body.textContent.includes('Edited Song') && document.body.textContent.includes('version 2')`, 'edited library version');
  const versions = await evaluate(`window.bulletin.openWorkspace(localStorage.getItem('bulletin-workspace')).then(workspace => workspace.library.items.filter(item => item.id === 'editable-song').map(item => ({version:item.version,title:item.title})))`);
  if (versions.length !== 2 || versions[0].title !== 'Original Song' || versions[1].title !== 'Edited Song') throw new Error(`Library edit did not preserve version history: ${JSON.stringify(versions)}`);
  pass('edits a library item by creating a new version');
  console.log(`\n${results.length} browser MVP checks passed.`);
  socket.close();
  process.exit(0);
}

if (process.env.BULLETIN_PAGINATION_ONLY === '1') {
  const longLyrics = Array.from({ length: 40 }, (_, index) => `Verse ${index + 1} ${'lyrics '.repeat(45)}`).join('\n\n');
  await click('Library'); await click('Add library item');
  await fill('Title', 'Long Pagination Song'); await fill('Stable ID', 'long-pagination-song'); await fill('Structured text', longLyrics);
  await click('Save item'); await wait(`document.body.textContent.includes('Long Pagination Song')`, 'long song library item');
  await click('This week'); await choose('Library song', 'long-pagination-song');
  await wait(`document.querySelectorAll('.document-page').length > 4`, 'paginated long song');
  const overflow = await evaluate(`Array.from(document.querySelectorAll('.page-content')).map((element, index) => ({page:index + 1, scroll:element.scrollHeight, client:element.clientHeight})).filter(page => page.scroll > page.client + 1)`);
  if (overflow.length) throw new Error(`Rendered content overflows pages: ${JSON.stringify(overflow)}`);
  pass('keeps oversized structured content inside rendered page bounds');
  console.log(`\n${results.length} browser MVP checks passed.`);
  socket.close();
  process.exit(0);
}

await wait(`Array.from(document.querySelectorAll('.missing-template-content')).some(element=>element.parentElement?.textContent.includes("Lord's Prayer"))`, 'hidden missing template content repair UI');
pass('surfaces hidden template content when its library item is missing');

await pointerClick('Print / Save PDF'); await wait(`Boolean(document.querySelector('.export-issues-modal'))`, 'export checklist');
if (!await evaluate(`document.querySelector('.export-issues-modal')?.textContent.includes("Lord's Prayer")`)) throw new Error('Export checklist did not identify the missing template content.');
await click('Back to editor');
pass('shows a complete export checklist instead of failing silently');

await click('Change workspace'); await wait(`Boolean(document.querySelector('.workspace-modal'))`, 'workspace picker');
await fill('New workspace name', 'Smoke Workspace'); await click('Create workspace');
await wait(`document.querySelector('.sidebar-bottom span')?.textContent.toLowerCase().includes('smoke workspace')`, 'new workspace selection');
await wait(`document.querySelector('.save-status')?.textContent.includes('Saved')`, 'initial bulletin autosave');
pass('creates, selects, and autosaves a new workspace');

if (process.env.BULLETIN_EXPORT_ONLY === '1') {
  await pointerClick('Print / Save PDF');
  await wait(`Boolean(document.querySelector('.export-issues-modal'))`, 'export warning checklist');
  await pointerClick('Export anyway');
  const printStarted = Date.now(); let printTarget;
  while (Date.now() - printStarted < 8000) {
    const nextTargets = await (await fetch(`${endpoint}/json`)).json();
    printTarget = nextTargets.find(item => item.type === 'page' && item.url.includes('print=1'));
    if (printTarget) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!printTarget) throw new Error('Clicking Print / Save PDF did not open the browser print preview.');
  await wait(`Boolean(document.querySelector('.print-controls'))`, 'rendered print preview');
  await wait(`!Array.from(document.querySelectorAll('.print-controls button')).find(element => element.textContent.includes('Print / Save as PDF'))?.disabled`, 'ready print action');
  pass('opens the browser print preview from a real pointer click');
  console.log(`\n${results.length} browser MVP checks passed.`);
  socket.close();
  process.exit(0);
}

await setFileForButton('Choose custom cover', new URL('../tests/fixtures/smoke-cover.svg', import.meta.url).pathname);
await wait(`${buttonExpression('Replace smoke-cover.svg')} !== undefined`, 'custom cover import');
pass('imports and persists a custom cover');

await click('Library'); await click('Add library item');
await fill('Title', 'Smoke Hymn'); await fill('Stable ID', 'smoke-hymn'); await fill('Structured text', 'Verse one text.\n\nVerse two text.');
await click('Save item'); await wait(`Array.from(document.querySelectorAll('.library-group article')).some(element=>element.textContent.includes('Smoke Hymn'))`, 'library item save');
pass('adds a versioned library item');

await click('This week'); await choose('Library song', 'smoke-hymn'); await choose('Presentation', 'asset');
await setFileForButton('Choose music image or PDF', new URL('../tests/fixtures/smoke-cover.svg', import.meta.url).pathname);
await wait(`${buttonExpression('Replace smoke-cover.svg')} !== undefined`, 'music asset import');
pass('selects a library song and imports a music asset');

await fill('Reference', 'John 3:16'); await click('Import passage');
await wait(`Boolean(document.querySelector('.lookup-status.success, .lookup-status.error'))`, 'Bible Gateway import feedback', 60000);
if (await evaluate(`Boolean(document.querySelector('.lookup-status.error'))`) && !await evaluate(`Boolean(document.querySelector('.error-toast'))`)) throw new Error('Global error feedback toast was not shown.');
pass('Bible Gateway import returns visible, actionable feedback');

await click('Templates'); await wait(`${buttonExpression('Save draft')} !== undefined`, 'template controls');
await fill('Page margin (inches)', '0.65');
await wait(`document.querySelector('.builder-preview .document-stack')?.getAttribute('style')?.includes('--page-margin: 0.65in')`, 'live template margin preview');
await click('Save draft');
await wait(`document.querySelector('.template-save-status')?.textContent.includes('Draft saved')`, 'template draft save');
await click('Publish new version');
await wait(`document.querySelector('.template-save-status')?.textContent.includes('New version published')`, 'template publish');
pass('saves a template draft and publishes a new version');

await click('This week'); await click('New week');
await wait(`document.querySelector('.save-status')?.textContent.includes('Saved')`, 'new bulletin save');
await wait(`document.querySelectorAll('.recent button').length >= 2`, 'recent bulletin refresh');
pass('creates, saves, and lists a new bulletin');

await click('Change workspace'); await wait(`Boolean(document.querySelector('.workspace-modal'))`, 'workspace picker reopening');
if (!await evaluate(`Array.from(document.querySelectorAll('.workspace-list button')).some(element=>element.textContent.includes('Lamb of God'))`)) throw new Error('Original workspace missing from picker.');
pass('reopens the workspace picker and lists persisted workspaces');

await evaluate(`document.querySelector('.workspace-modal header button')?.click()`);
await evaluate(`(()=>{void window.bulletin.openWorkspace(localStorage.getItem('bulletin-workspace')).then(workspace=>window.bulletin.exportPdf(workspace.root,workspace.bulletins[0].path,workspace.bulletins[0].document));return true})()`);
const printStarted = Date.now(); let printTarget;
while (Date.now() - printStarted < 8000) { const nextTargets = await (await fetch(`${endpoint}/json`)).json(); printTarget = nextTargets.find(item => item.type === 'page' && item.url.includes('print=1')); if (printTarget) break; await new Promise(resolve => setTimeout(resolve, 100)); }
if (!printTarget) throw new Error('Browser print preview did not open.');
pass('opens a dedicated browser print preview');

console.log(`\n${results.length} browser MVP checks passed.`);
socket.close();
