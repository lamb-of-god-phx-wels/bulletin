import { writeFile } from 'node:fs/promises';

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
  const context = await evaluate(`(()=>{const stack=document.querySelector('.preview-pane .document-stack, .builder-preview .document-stack');const frame=document.querySelector('.preview-pane .page-frame, .builder-preview .page-frame')?.getBoundingClientRect();return {status:document.querySelector('.save-status')?.textContent,heading:document.querySelector('.topbar h1')?.textContent,error:document.querySelector('.error-toast p')?.textContent,rulerToggle:document.querySelector('.ruler-toggle')?.outerHTML,rulers:document.querySelectorAll('.page-rulers').length,rulerFrames:document.querySelectorAll('.page-frame.with-rulers').length,zoom:document.querySelector('select[aria-label="Preview zoom"]')?.value,stack:stack&&{width:stack.clientWidth,height:stack.clientHeight},frame:frame&&{width:frame.width,height:frame.height}}})()`);
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

if (process.env.BULLETIN_EXAMPLE_ONLY === '1') {
  await wait('document.querySelectorAll(".preview-pane .document-page").length > 0 && Array.from(document.querySelectorAll(".preview-pane img")).every(image=>image.complete)', 'rendered example bulletin');
  const result = await evaluate('({pages:document.querySelectorAll(".preview-pane .document-page").length,missing:Array.from(document.querySelectorAll(".preview-pane .missing")).map(element=>element.textContent),titles:Array.from(document.querySelectorAll(".preview-pane .document-page")).map(page=>page.textContent.trim().slice(0,80)),images:document.querySelectorAll(".preview-pane img").length})');
  const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile('/tmp/bulletin-example-render.png', Buffer.from(screenshot.data, 'base64'));
  console.log(JSON.stringify(result, null, 2));
  socket.close();
  process.exit(result.pages === 12 && result.missing.length === 0 ? 0 : 1);
}

if (process.env.BULLETIN_ZOOM_ONLY === '1') {
  await wait(`(()=>{const stack=document.querySelector('.preview-pane .document-stack');const frame=document.querySelector('.preview-pane .page-frame')?.getBoundingClientRect();if(!stack||!frame)return false;return frame.width<=stack.clientWidth-94+1&&frame.height<=stack.clientHeight-131+1&&(Math.abs(frame.width-(stack.clientWidth-94))<1||Math.abs(frame.height-(stack.clientHeight-131))<1)})()`, 'default fit-to-page zoom');
  const initialWidth = await evaluate(`document.querySelector('.preview-pane .page-frame').getBoundingClientRect().width`);
  await evaluate(`(()=>{const element=document.querySelector('.preview-pane select[aria-label="Preview zoom"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(element,'1');element.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  await wait(`Math.abs(document.querySelector('.preview-pane .page-frame').getBoundingClientRect().width - 672) < .1`, '100 percent weekly preview');
  if (initialWidth >= 672) throw new Error(`The initial preview was not scaled down: ${initialWidth}`);
  if (await evaluate(`localStorage.getItem('bulletin-preview-zoom') !== '1'`)) throw new Error('Preview zoom preference was not saved.');
  await evaluate(`document.querySelector('.preview-pane .document-stack').dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:100}))`);
  await wait(`document.querySelector('.preview-pane select[aria-label="Preview zoom"]')?.value === '0.85'`, 'control-scroll zoom out');
  await evaluate(`document.querySelector('.preview-pane .document-stack').dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:-100}))`);
  await wait(`document.querySelector('.preview-pane select[aria-label="Preview zoom"]')?.value === '1'`, 'control-scroll zoom in');
  await click('Templates');
  await wait(`document.querySelector('.builder-preview select[aria-label="Preview zoom"]')?.value === '1' && Math.abs(document.querySelector('.builder-preview .page-frame').getBoundingClientRect().height - 816) < .1`, 'shared template preview zoom');
  await evaluate(`document.querySelector('.builder-preview button[aria-label="Zoom out"]').click()`);
  await wait(`document.querySelector('.builder-preview select[aria-label="Preview zoom"]')?.value === '0.85' && Math.abs(document.querySelector('.builder-preview .page-frame').getBoundingClientRect().width - 571.2) < .1`, 'zoom-out control');
  await click('Fit to width');
  await wait(`(()=>{const stack=document.querySelector('.builder-preview .document-stack');const frame=document.querySelector('.builder-preview .page-frame');return Math.abs(frame.getBoundingClientRect().width-(stack.clientWidth-94))<1})()`, 'fit-to-width preset');
  await click('Fit to page');
  await wait(`(()=>{const stack=document.querySelector('.builder-preview .document-stack');const frame=document.querySelector('.builder-preview .page-frame').getBoundingClientRect();return frame.width<=stack.clientWidth-94+1&&frame.height<=stack.clientHeight-131+1&&(Math.abs(frame.width-(stack.clientWidth-94))<1||Math.abs(frame.height-(stack.clientHeight-131))<1)})()`, 'fit-to-page preset');
  await click('100%');
  await wait(`document.querySelector('.builder-preview select[aria-label="Preview zoom"]')?.value === '1' && Math.abs(document.querySelector('.builder-preview .page-frame').getBoundingClientRect().width - 672) < .1`, '100 percent preset');
  await click('Fit to page');
  const persistedZoom = await evaluate(`localStorage.getItem('bulletin-preview-zoom')`);
  await evaluate(`setTimeout(() => location.reload(), 0); true`);
  await new Promise(resolve => setTimeout(resolve, 500));
  await wait(`document.body.textContent.includes('God Loves Sinners') && document.querySelector('.preview-pane select[aria-label="Preview zoom"]')?.value === ${JSON.stringify(persistedZoom)}`, 'restored preview zoom after reload');
  pass('zooms weekly and template previews while preserving page proportions');
  console.log(`\n${results.length} browser MVP checks passed.`);
  socket.close();
  process.exit(0);
}

if (process.env.BULLETIN_MARGIN_ONLY === '1') {
  await fill('Page margin (inches)', '0.65');
  await wait(`document.querySelector('.preview-pane .document-stack')?.style.getPropertyValue('--page-margin') === '0.65in'`, 'weekly page margin preview');
  await wait(`document.querySelector('.save-status')?.textContent === 'Saved'`, 'weekly page margin autosave');
  const stored = await evaluate(`window.bulletin.openWorkspace(localStorage.getItem('bulletin-workspace')).then(workspace=>workspace.bulletins.find(item=>item.document.id==='bulletin-2026-06-07').document.layout?.marginIn)`);
  if (stored !== 0.65) throw new Error(`Weekly page margin was not persisted: ${stored}`);
  await click('Use template margin');
  await wait(`document.querySelector('.preview-pane .document-stack')?.style.getPropertyValue('--page-margin') === '0.3in'`, 'restored template page margin');
  pass('overrides and restores page margins for one bulletin');
  console.log(`\n${results.length} browser MVP checks passed.`);
  socket.close();
  process.exit(0);
}

if (process.env.BULLETIN_NESTED_TEXT_ONLY === '1') {
  await wait(`Boolean(Array.from(document.querySelectorAll('.nested-block-editor textarea')).find(element=>element.value==='Welcome'))`, 'structured church information text blocks');
  await evaluate(`(()=>{const input=Array.from(document.querySelectorAll('.nested-block-editor textarea')).find(element=>element.value==='Welcome');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Welcome to Worship');input.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  await wait(`Array.from(document.querySelectorAll('.preview-pane .church-info .paragraph-header')).some(element=>element.textContent==='Welcome to Worship')`, 'edited nested header text block');
  await evaluate(`(()=>{const input=Array.from(document.querySelectorAll('.nested-block-editor textarea')).find(element=>element.value==='Welcome to Worship');input.closest('.nested-block-editor').querySelector(':scope > summary .format-block-button').click();return true})()`);
  await wait(`Boolean(document.querySelector('.block-formatting-modal'))`, 'nested block formatter');
  await evaluate(`(()=>{const select=Array.from(document.querySelectorAll('.block-formatting-modal label')).find(element=>element.textContent.startsWith('Style')).querySelector('select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'italic');select.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  await click('Apply formatting');
  await wait(`(()=>{const heading=Array.from(document.querySelectorAll('.preview-pane .church-info .paragraph-header')).find(element=>element.textContent==='Welcome to Worship');return heading?.closest('.block-presentation')?.style.fontStyle==='italic'})()`, 'nested header formatting preserved');
  await wait(`document.querySelector('.save-status')?.textContent === 'Saved'`, 'nested block autosave');
  const nested = await evaluate(`window.bulletin.openWorkspace(localStorage.getItem('bulletin-workspace')).then(workspace=>workspace.bulletins[0].document.blocks.find(block=>block.type==='churchInfo').children).then(children=>children.map(child=>({id:child.id,type:child.type,children:child.children})))`);
  const heading = nested.find(child => child.id === 'church-welcome')?.children.find(child=>child.role==='header');
  if (nested.length !== 4 || heading?.type !== 'richText' || heading?.content?.[0]?.children?.[0]?.text !== 'Welcome to Worship' || heading?.presentation?.fontStyle !== 'italic') throw new Error(`Nested church information was flattened or lost formatting: ${JSON.stringify(nested)}`);
  await click('Templates');
  await wait(`Boolean(Array.from(document.querySelectorAll('.nested-outline textarea')).find(element=>element.value==='Welcome'))`, 'template paragraph text controls');
  await evaluate(`(()=>{const input=Array.from(document.querySelectorAll('.nested-outline textarea')).find(element=>element.value==='Welcome');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Template Welcome');input.dispatchEvent(new Event('input',{bubbles:true}));input.closest('li').querySelector('.format-block-button').click();return true})()`);
  await fill('Space after (in)', '0'); await click('Apply formatting');
  await evaluate(`(()=>{const input=Array.from(document.querySelectorAll('.nested-outline textarea')).find(element=>element.value.startsWith('Thank you for joining'));input.closest('li').querySelector('.format-block-button').click();return true})()`);
  await fill('Space before (in)', '0'); await click('Apply formatting');
  await wait(`(()=>{const header=Array.from(document.querySelectorAll('.builder-preview .paragraph-header')).find(element=>element.textContent==='Template Welcome')?.closest('.block-presentation');const body=header?.parentElement?.querySelector('.paragraph-body')?.closest('.block-presentation');if(!header||!body)return false;return Math.abs(body.getBoundingClientRect().top-header.getBoundingClientRect().bottom)<.5})()`, 'zero-gap paragraph header and body');
  pass('edits nested church-information elements without losing structure or formatting');
  console.log(`\n${results.length} browser MVP checks passed.`);
  socket.close();
  process.exit(0);
}

if (process.env.BULLETIN_BLOCK_FORMATTING_ONLY === '1') {
  await click('Fine-tune layout'); await wait(`Boolean(document.querySelector('.weekly-block-picker'))`, 'weekly all-block formatting picker');
  const pickerCounts = await evaluate(`({choices:document.querySelectorAll('.weekly-block-picker > div > button').length,blocks:window.bulletin.openWorkspace(localStorage.getItem('bulletin-workspace')).then(workspace=>workspace.bulletins[0].document.blocks.length)})`);
  if (pickerCounts.choices < 10) throw new Error(`Weekly formatter does not expose all blocks: ${JSON.stringify(pickerCounts)}`);
  await evaluate(`(()=>{const button=Array.from(document.querySelectorAll('.weekly-block-picker > div > button')).find(element=>element.textContent.includes('Opening Hymn'));if(!button)throw new Error('Opening Hymn formatting choice missing');button.click();return true})()`);
  await wait(`Boolean(document.querySelector('.block-formatting-modal'))`, 'weekly block formatting modal');
  await fill('Width (%)', '70'); await fill('Left padding (in)', '0.2');
  await evaluate(`(()=>{const field=Array.from(document.querySelectorAll('.block-formatting-modal .segmented-field')).find(element=>element.querySelector('legend')?.textContent==='Text alignment');Array.from(field.querySelectorAll('button')).find(element=>element.textContent==='Right').click();return true})()`);
  await evaluate(`document.querySelector('.block-formatting-modal input[type="checkbox"]').click()`);
  await click('Apply formatting');
  await wait(`(()=>{const wrapper=document.querySelector('.preview-pane .song')?.closest('.block-presentation');return wrapper?.style.width==='70%'&&wrapper?.style.paddingLeft==='0.2in'&&wrapper?.style.textAlign==='right'})()`, 'weekly song formatting render');
  await wait(`document.querySelector('.save-status')?.textContent === 'Saved'`, 'weekly formatting autosave');
  const weeklyOverride = await evaluate(`window.bulletin.openWorkspace(localStorage.getItem('bulletin-workspace')).then(workspace=>workspace.bulletins[0].document.blocks.find(block=>block.id==='opening-hymn')).then(block=>({presentation:block.presentation,layout:block.layout}))`);
  if (weeklyOverride.presentation?.widthPercent !== 70 || weeklyOverride.layout?.pageBreakBefore !== true) throw new Error(`Weekly formatting was not persisted: ${JSON.stringify(weeklyOverride)}`);
  await click('Templates');
  await evaluate(`(()=>{const row=Array.from(document.querySelectorAll('.outline > li')).find(element=>element.querySelector('.outline-main b')?.textContent==='Opening Hymn');if(!row)throw new Error('Template song row missing');row.querySelector('.format-block-button').click();return true})()`);
  await wait(`document.querySelector('.block-formatting-modal .eyebrow')?.textContent==='Template formatting'`, 'template block formatting modal');
  await fill('Width (%)', '80');
  await evaluate(`(()=>{const field=Array.from(document.querySelectorAll('.block-formatting-modal .segmented-field')).find(element=>element.querySelector('legend')?.textContent==='Place block');Array.from(field.querySelectorAll('button')).find(element=>element.textContent==='Center').click();return true})()`);
  await click('Apply formatting');
  await wait(`(()=>{const wrapper=document.querySelector('.builder-preview .song')?.closest('.block-presentation');return wrapper?.style.width==='80%'&&wrapper?.style.marginLeft==='auto'&&wrapper?.style.marginRight==='auto'})()`, 'template song formatting render');
  await click('Save draft'); await wait(`document.querySelector('.template-save-status')?.textContent.includes('Draft saved')`, 'formatted template save');
  const templateOverride = await evaluate(`window.bulletin.openWorkspace(localStorage.getItem('bulletin-workspace')).then(workspace=>workspace.templates.find(item=>item.template.status==='draft')?.template.starterBlocks.find(block=>block.id==='opening-hymn')?.presentation)`);
  if (templateOverride?.widthPercent !== 80 || templateOverride?.placement !== 'center') throw new Error(`Template formatting was not persisted: ${JSON.stringify(templateOverride)}`);
  pass('formats built-in blocks independently in template and weekly workflows');
  console.log(`\n${results.length} browser MVP checks passed.`);
  socket.close();
  process.exit(0);
}

if (process.env.BULLETIN_CUSTOM_BLOCKS_ONLY === '1') {
  await click('Templates');
  await click('Add block'); await wait(`Boolean(document.querySelector('.block-library-modal'))`, 'first-class block library');
  if (!await evaluate(`document.querySelector('.block-library-modal')?.textContent.includes('Scripture reading')`)) throw new Error('Built-in blocks are missing from the block library.');
  await click('Create custom block'); await wait(`Boolean(document.querySelector('.custom-block-designer'))`, 'separate custom block designer');
  await fill('Block name', 'Service invitation');
  await fill('Field label', 'Service time');
  await fill('Placeholder', 'serviceTime');
  await fill('Default value', '9:00 AM');
  await click('Add binding');
  await evaluate(`(()=>{const element=document.querySelectorAll('.binding-row')[1].querySelectorAll('input')[0];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,'Sermon title');element.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  await evaluate(`(()=>{const element=document.querySelectorAll('.binding-row')[1].querySelectorAll('input')[1];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,'sermonTitle');element.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  await evaluate(`(()=>{const element=document.querySelectorAll('.binding-row')[1].querySelector('select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(element,'info.title');element.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  await fill('Content layout', 'Worship begins at {{serviceTime}}.\n\nToday: {{sermonTitle}}');
  await fill('Width (%)', '60');
  await evaluate(`(()=>{const field=Array.from(document.querySelectorAll('.segmented-field')).find(element=>element.querySelector('legend')?.textContent==='Text alignment');const button=Array.from(field.querySelectorAll('button')).find(element=>element.textContent==='Center');button.click();return true})()`);
  await click('Create block'); await wait(`document.querySelectorAll('.custom-choices .block-choice').length === 1`, 'saved reusable block definition');
  await evaluate(`document.querySelector('.custom-choices .block-choice .secondary').click()`);
  await wait(`document.querySelector('.builder-preview .document-stack')?.textContent.includes('Worship begins at 9:00 AM.') && document.querySelector('.builder-preview .document-stack')?.textContent.includes('Today: Sermon title')`, 'bound custom block preview');
  const renderedStyle = await evaluate(`(()=>{const block=Array.from(document.querySelectorAll('.builder-preview .custom-block')).at(-1);return {width:block.style.width,textAlign:block.style.textAlign}})()`);
  if (renderedStyle.width !== '60%' || renderedStyle.textAlign !== 'center') throw new Error(`Custom layout controls were not rendered: ${JSON.stringify(renderedStyle)}`);
  await click('Add block'); await pointerClick('Edit'); await fill('Block name', 'Service invitation updated'); await click('Save changes');
  await wait(`document.querySelector('.custom-choices .block-choice b')?.textContent === 'Service invitation updated'`, 'edited reusable block');
  await evaluate(`document.querySelector('.custom-choices .block-choice .secondary').click()`);
  await wait(`document.querySelectorAll('.outline .outline-main b').length > 1 && Array.from(document.querySelectorAll('.outline .outline-main b')).filter(element=>element.textContent==='Service invitation updated').length === 2`, 'reused custom block');
  await click('Add block'); await pointerClick('Edit'); await click('Delete from block library'); await click('Delete reusable block');
  await wait(`document.querySelector('.block-library-empty')?.textContent.includes('No custom blocks')`, 'deleted reusable block definition');
  await evaluate(`document.querySelector('button[aria-label="Close block library"]').click()`);
  await wait(`!document.querySelector('.block-library-modal') && document.querySelector('.builder-preview .document-stack')?.textContent.includes('Service invitation updated')`, 'preserved template snapshots after definition deletion');
  await click('Publish new version');
  await wait(`document.querySelector('.template-save-status')?.textContent.includes('New version published')`, 'custom block template publication');
  await click('This week'); await click('New week');
  await wait(`Array.from(document.querySelectorAll('.block-editor h3')).some(element=>element.textContent==='Service invitation updated')`, 'custom block weekly editor');
  await fill('Service time', '10:30 AM');
  await wait(`document.querySelector('.preview-pane .document-stack')?.textContent.includes('Worship begins at 10:30 AM.')`, 'custom weekly value preview');
  const savedBlocks = await evaluate(`window.bulletin.openWorkspace(localStorage.getItem('bulletin-workspace')).then(workspace=>workspace.templates.find(item=>item.template.version===2)?.template.starterBlocks.filter(block=>block.type==='custom'))`);
  if (savedBlocks?.length !== 2 || savedBlocks[0].name !== 'Service invitation updated' || savedBlocks[0].style?.widthPercent !== 60) throw new Error(`Custom blocks were not persisted correctly: ${JSON.stringify(savedBlocks)}`);
  pass('creates, edits, deletes, reuses, styles, publishes, and weekly-edits first-class blocks');
  console.log(`\n${results.length} browser MVP checks passed.`);
  socket.close();
  process.exit(0);
}

if (process.env.BULLETIN_GUIDES_ONLY === '1') {
  if (await evaluate(`document.querySelector('.guide-toggle')?.getAttribute('aria-pressed') === 'true'`)) await click('Guides');
  await click('Guides');
  await wait(`document.querySelectorAll('.page-guides').length === document.querySelectorAll('.page-frame').length`, 'weekly margin guides');
  const weeklyGuide = await evaluate(`(()=>{const page=document.querySelector('.document-page').getBoundingClientRect();const guide=document.querySelector('.page-guides').getBoundingClientRect();const content=document.querySelector('.document-page > .page-content > :first-child').getBoundingClientRect();return {pageLeft:page.left,pageTop:page.top,pageRight:page.right,pageBottom:page.bottom,guideLeft:guide.left,guideTop:guide.top,guideRight:guide.right,guideBottom:guide.bottom,contentLeft:content.left,contentTop:content.top}})()`);
  if (Math.abs(weeklyGuide.guideLeft - weeklyGuide.contentLeft) > 1 || Math.abs(weeklyGuide.guideTop - weeklyGuide.contentTop) > 1 || Math.abs((weeklyGuide.guideLeft - weeklyGuide.pageLeft) - (weeklyGuide.pageRight - weeklyGuide.guideRight)) > 1 || Math.abs((weeklyGuide.guideTop - weeklyGuide.pageTop) - (weeklyGuide.pageBottom - weeklyGuide.guideBottom)) > 1) throw new Error(`Weekly guides do not align with the content margin: ${JSON.stringify(weeklyGuide)}`);
  await click('Templates');
  await wait(`Boolean(document.querySelector('.builder-preview .page-guides'))`, 'template margin guides');
  await fill('Page margin (inches)', '0.5');
  await wait(`(()=>{const page=document.querySelector('.builder-preview .document-page')?.getBoundingClientRect();const guide=document.querySelector('.builder-preview .page-guides')?.getBoundingClientRect();if(!page||!guide)return false;const inch=page.width/7;return Math.abs((guide.left-page.left)/inch-.5)<.01&&Math.abs((guide.top-page.top)/inch-.5)<.01})()`, 'half-inch guide alignment');
  if (await evaluate(`document.querySelector('.ruler-toggle')?.getAttribute('aria-pressed') === 'true'`)) await click('Rulers');
  await wait(`!document.querySelector('.page-rulers') && Boolean(document.querySelector('.page-guides'))`, 'guides without rulers');
  await click('Guides');
  await wait(`!document.querySelector('.page-guides')`, 'hidden guides');
  if (await evaluate(`localStorage.getItem('bulletin-show-guides') !== 'false'`)) throw new Error('Hidden guide preference was not saved.');
  await click('Guides');
  await wait(`Boolean(document.querySelector('.builder-preview .page-guides'))`, 'restored guides');
  if (await evaluate(`localStorage.getItem('bulletin-show-guides') !== 'true'`)) throw new Error('Visible guide preference was not saved.');
  pass('renders optional margin guides in weekly and template previews');
  console.log(`\n${results.length} browser MVP checks passed.`);
  socket.close();
  process.exit(0);
}

if (process.env.BULLETIN_TEMPLATES_ONLY === '1') {
  await click('Templates');
  await click('New template');
  await fill('New template name', 'Festival Service');
  await click('Create from current');
  await wait(`document.querySelector('.topbar h1')?.textContent === 'Festival Service'`, 'new template selection');
  const created = await evaluate(`window.bulletin.openWorkspace(localStorage.getItem('bulletin-workspace')).then(workspace=>workspace.templates.filter(item=>item.template.id==='festival-service').map(item=>({path:item.path,version:item.template.version,status:item.template.status})))`);
  if (created.length !== 1 || created[0].version !== 1 || created[0].status !== 'draft') throw new Error(`New template was not saved as its own family: ${JSON.stringify(created)}`);
  await click('Publish new version');
  await wait(`document.querySelector('.template-save-status')?.textContent.includes('New version published')`, 'new template publication');
  await wait(`document.querySelectorAll('select[aria-label="Template and version"] option').length === 3`, 'template version options');
  const versions = await evaluate(`window.bulletin.openWorkspace(localStorage.getItem('bulletin-workspace')).then(workspace=>workspace.templates.filter(item=>item.template.id==='festival-service').map(item=>({version:item.template.version,status:item.template.status})).sort((a,b)=>a.version-b.version))`);
  if (versions.length !== 2 || versions[0].status !== 'draft' || versions[1].version !== 2 || versions[1].status !== 'published') throw new Error(`Template version history is incorrect: ${JSON.stringify(versions)}`);
  await click('This week');
  await wait(`document.querySelector('.topbar h1')?.textContent === 'God Loves Sinners'`, 'referenced weekly template');
  await click('New week');
  await wait(`Boolean(document.querySelector('.new-bulletin-modal'))`, 'new bulletin template picker');
  const choices = await evaluate(`Array.from(document.querySelectorAll('.template-choice-list > button b')).map(element=>element.textContent)`);
  if (choices.length !== 2 || !choices.includes('Lamb of God Weekly') || !choices.includes('Festival Service')) throw new Error(`New bulletin template choices are incorrect: ${JSON.stringify(choices)}`);
  await click('Festival Service');
  await wait(`!document.querySelector('.new-bulletin-modal') && document.querySelector('.topbar h1')?.textContent === 'Sermon title'`, 'festival bulletin');
  await wait(`document.querySelector('.save-status')?.textContent === 'Saved'`, 'festival bulletin save');
  const bulletinTemplate = await evaluate(`window.bulletin.openWorkspace(localStorage.getItem('bulletin-workspace')).then(workspace=>workspace.bulletins.find(item=>item.document.info.title==='Sermon title')?.document.template)`);
  if (bulletinTemplate?.id !== 'festival-service' || bulletinTemplate.version !== 2) throw new Error(`New bulletin did not retain its selected template: ${JSON.stringify(bulletinTemplate)}`);
  await click('God Loves Sinners');
  await click('Templates');
  await wait(`document.querySelector('select[aria-label="Template and version"] option:checked')?.textContent.includes('Lamb of God Weekly')`, 'original bulletin template selection');
  pass('creates, versions, selects, and links multiple templates');
  console.log(`\n${results.length} browser MVP checks passed.`);
  socket.close();
  process.exit(0);
}

if (process.env.BULLETIN_RULERS_ONLY === '1') {
  if (!await evaluate(`document.querySelector('.ruler-toggle')?.getAttribute('aria-pressed') === 'true'`)) await click('Rulers');
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
  await click('Rulers');
  await wait(`!document.querySelector('.page-rulers') && !document.querySelector('.page-crosshairs') && !document.querySelector('.page-frame.with-rulers')`, 'hidden rulers, crosshairs, and spacing');
  if (await evaluate(`localStorage.getItem('bulletin-show-rulers') !== 'false'`)) throw new Error('Hidden ruler preference was not saved.');
  await click('Templates');
  await wait(`document.querySelector('.ruler-toggle')?.getAttribute('aria-pressed') === 'false' && !document.querySelector('.page-rulers')`, 'hidden template rulers');
  await click('Rulers');
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

if (process.env.BULLETIN_LIBRARY_VERSIONS_ONLY === '1') {
  await click('Library'); await click('Add library item');
  await fill('Title', 'Original Grouped Song'); await fill('Stable ID', 'grouped-song'); await fill('Structured text', 'Original lyrics.');
  await click('Save item');
  await wait(`document.querySelectorAll('.library-group article').length === 1 && document.querySelectorAll('select[aria-label="Version for grouped-song"] option').length === 1`, 'single grouped library item');
  await pointerClick('Edit'); await fill('Title', 'Revised Grouped Song'); await fill('Structured text', 'Revised lyrics.');
  await click('Save new version');
  await wait(`document.querySelectorAll('.library-group article').length === 1 && document.querySelectorAll('select[aria-label="Version for grouped-song"] option').length === 2 && document.querySelector('select[aria-label="Version for grouped-song"]')?.value === '2' && document.querySelector('.library-group article b')?.textContent === 'Revised Grouped Song'`, 'grouped version history');
  await evaluate(`(()=>{const select=document.querySelector('select[aria-label="Version for grouped-song"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'1');select.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  await wait(`document.querySelector('.library-group article b')?.textContent === 'Original Grouped Song'`, 'selected earlier library version');
  await pointerClick('Edit');
  await wait(`document.querySelector('.library-form input')?.value === 'Original Grouped Song' && document.querySelector('.library-form .helper')?.textContent.includes('version 1')`, 'edit selected library version');
  await click('Cancel'); await pointerClick('Delete');
  await wait(`document.querySelector('.confirmation-modal')?.textContent.includes('version 1')`, 'delete selected library version confirmation');
  await pointerClick('Delete item');
  await wait(`document.querySelectorAll('.library-group article').length === 1 && document.querySelectorAll('select[aria-label="Version for grouped-song"] option').length === 1 && document.querySelector('.library-group article b')?.textContent === 'Revised Grouped Song'`, 'remaining grouped library version');
  const remaining = await evaluate(`window.bulletin.openWorkspace(localStorage.getItem('bulletin-workspace')).then(workspace=>workspace.library.items.map(item=>({id:item.id,version:item.version,title:item.title})))`);
  if (remaining.length !== 1 || remaining[0].version !== 2) throw new Error(`Selected library version was not deleted correctly: ${JSON.stringify(remaining)}`);
  pass('groups library items with an inline version selector');
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
