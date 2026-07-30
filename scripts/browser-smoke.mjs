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
const runtimeErrors = [];
socket.addEventListener('message', message => {
  const value = JSON.parse(message.data);
  if (value.method === 'Runtime.exceptionThrown') runtimeErrors.push(value.params?.exceptionDetails?.exception?.description ?? value.params?.exceptionDetails?.text ?? 'Unknown runtime error');
  if (value.id && pending.has(value.id)) { const { resolve, reject } = pending.get(value.id); pending.delete(value.id); value.error ? reject(new Error(value.error.message)) : resolve(value.result); return; }
  for (const resolve of events.get(value.method) ?? []) resolve(value.params);
  events.delete(value.method);
});
const command = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
const evaluate = async expression => (await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
const wait = async (expression, label, timeout = 8000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  const context = await evaluate(`(()=>{const stack=document.querySelector('.preview-pane .document-stack, .builder-preview .document-stack');const frame=document.querySelector('.preview-pane .page-frame, .builder-preview .page-frame')?.getBoundingClientRect();return {status:document.querySelector('.save-status')?.textContent,heading:document.querySelector('.topbar h1')?.textContent,error:document.querySelector('.error-toast p')?.textContent,viteError:document.querySelector('vite-error-overlay')?.shadowRoot?.textContent?.trim().slice(0,1200),body:document.body.innerText.trim().slice(0,500),rulerToggle:document.querySelector('.ruler-toggle')?.outerHTML,rulers:document.querySelectorAll('.page-rulers').length,rulerFrames:document.querySelectorAll('.page-frame.with-rulers').length,zoom:document.querySelector('select[aria-label="Preview zoom"]')?.value,stack:stack&&{width:stack.clientWidth,height:stack.clientHeight},frame:frame&&{width:frame.width,height:frame.height}}})()`);
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
await command('Runtime.enable');
if (process.env.BULLETIN_DEBUG_RUNTIME === '1') {
  runtimeErrors.length = 0;
  await command('Page.reload');
  await new Promise(resolve => setTimeout(resolve, 1000));
  console.log(JSON.stringify({ runtimeErrors, body: await evaluate('document.body.innerText') }, null, 2));
  socket.close();
  process.exit(runtimeErrors.length ? 1 : 0);
}
if (process.env.BULLETIN_PALETTE_ONLY === '1') {
  await command('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
}
await wait(process.env.BULLETIN_PALETTE_ONLY === '1'
  ? `Boolean(document.querySelector('.sidebar-palette-slot .element-palette'))`
  : process.env.BULLETIN_CHURCH_YEAR_ONLY === '1'
    ? `Boolean(document.querySelector('.app-shell'))`
  : process.env.BULLETIN_PAGE_TEMPLATE_CANVAS_ONLY === '1'
    ? `Boolean(document.querySelector('.app-shell'))`
    : `document.body.textContent.includes('God Loves Sinners')`, 'initial workspace');
if (await evaluate(`document.body.textContent.toLowerCase().includes('browser demo')`)) throw new Error('Browser demo wording remains.');
pass('loads a real persistent local workspace without demo wording');

if (process.env.BULLETIN_PAGE_TEMPLATE_CANVAS_ONLY === '1') {
  await command('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await click('Page Templates');
  await wait(`Boolean(document.querySelector('.page-templates-screen'))`, 'Page Templates screen');
  await evaluate(`Object.defineProperty(crypto,'randomUUID',{configurable:true,value:undefined})`);
  await evaluate(`window.prompt=(()=>{const answers=['Browser canvas regression'];return()=>answers.shift()??null})()`);
  await click('New page template');
  await wait(`Boolean(document.querySelector('.page-layout-choice'))`, 'page layout choice');
  await click('Canvas');
  await wait(`Boolean(document.querySelector('.page-template-designer'))`, 'new canvas page template editor');
  const pageEditor = await evaluate(`(()=>{const design=Array.from(document.querySelectorAll('.page-template-designer button')).find(button=>button.textContent.trim()==='Design');return {canvasLabel:document.querySelector('.page-template-designer .eyebrow')?.textContent,design:Boolean(design),designWidth:design?.getBoundingClientRect().width,canvasBlocks:document.querySelectorAll('.page-template-designer .outline li').length}})()`);
  if (!pageEditor.canvasLabel?.includes('canvas') || !pageEditor.design || pageEditor.designWidth < 55 || pageEditor.canvasBlocks !== 1) throw new Error(`Canvas page editor did not initialize correctly: ${JSON.stringify(pageEditor)}`);
  await evaluate(`Array.from(document.querySelectorAll('.page-template-designer button')).find(button=>button.textContent.trim()==='Design')?.click()`);
  await wait(`Boolean(document.querySelector('.canvas-designer'))`, 'new page canvas designer');
  const canvasViewport = await evaluate(`({zoom:Boolean(document.querySelector('.canvas-designer select[aria-label="Preview zoom"]')),rulers:document.querySelectorAll('.canvas-stage-frame .page-rulers').length,horizontalTicks:document.querySelectorAll('.canvas-stage-frame .ruler-horizontal .ruler-tick').length,verticalTicks:document.querySelectorAll('.canvas-stage-frame .ruler-vertical .ruler-tick').length,legacyLabels:document.querySelectorAll('.canvas-ruler-label').length})`);
  if (!canvasViewport.zoom || canvasViewport.rulers !== 1 || canvasViewport.horizontalTicks !== 29 || canvasViewport.verticalTicks !== 35 || canvasViewport.legacyLabels) throw new Error(`Canvas viewport controls are incomplete: ${JSON.stringify(canvasViewport)}`);
  await evaluate(`Array.from(document.querySelectorAll('.canvas-designer .preview-zoom-presets button')).find(button=>button.textContent.trim()==='100%')?.click()`);
  await wait(`Math.abs(document.querySelector('.canvas-stage').getBoundingClientRect().width-672)<1`, '100% canvas zoom');
  const canvasRulerGeometry = await evaluate(`(()=>{const stage=document.querySelector('.canvas-stage').getBoundingClientRect(),horizontal=document.querySelector('.canvas-stage-frame .ruler-horizontal').getBoundingClientRect(),vertical=document.querySelector('.canvas-stage-frame .ruler-vertical').getBoundingClientRect();return {stage:[stage.width,stage.height],horizontal:horizontal.width,vertical:vertical.height}})()`);
  if (Math.abs(canvasRulerGeometry.horizontal - canvasRulerGeometry.stage[0]) > 1 || Math.abs(canvasRulerGeometry.vertical - canvasRulerGeometry.stage[1]) > 1) throw new Error(`Canvas rulers do not match the page: ${JSON.stringify(canvasRulerGeometry)}`);
  await evaluate(`(()=>{const select=document.querySelector('.canvas-designer select[aria-label="Preview zoom"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'0.5');select.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  await wait(`Math.abs(document.querySelector('.canvas-stage').getBoundingClientRect().width-336)<1`, '50% canvas zoom');
  const initialElements = await evaluate(`document.querySelectorAll('.canvas-stage [data-canvas-element-id]').length`);
  const canvasDrag = await evaluate(`(()=>{const item=Array.from(document.querySelectorAll('.canvas-layers .element-palette-item')).find(button=>button.textContent.includes('Heading')),stage=document.querySelector('.canvas-stage'),a=item.getBoundingClientRect(),b=stage.getBoundingClientRect();return {start:{x:a.left+a.width/2,y:a.top+a.height/2},end:{x:b.left+b.width*.55,y:b.top+b.height*.45}}})()`);
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: canvasDrag.start.x, y: canvasDrag.start.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let step = 1; step <= 8; step++) {
    const ratio = step / 8;
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: canvasDrag.start.x + (canvasDrag.end.x - canvasDrag.start.x) * ratio, y: canvasDrag.start.y + (canvasDrag.end.y - canvasDrag.start.y) * ratio, button: 'left', buttons: 1 });
    await new Promise(resolve => setTimeout(resolve, 35));
  }
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: canvasDrag.end.x, y: canvasDrag.end.y, button: 'left', buttons: 0, clickCount: 1 });
  await wait(`document.querySelectorAll('.canvas-stage [data-canvas-element-id]').length===${initialElements + 1}`, 'canvas page element insertion');
  await choose('Sizing', 'fixed');
  await choose('Vertical alignment', 'top');
  await wait(`(()=>{const box=document.querySelector('.canvas-stage .canvas-native-block'),content=box?.querySelector(':scope > .preview-block'),a=box?.getBoundingClientRect(),b=content?.getBoundingClientRect();return a&&b&&Math.abs(a.top-b.top)<1})()`, 'canvas text top alignment');
  await choose('Vertical alignment', 'middle');
  await wait(`(()=>{const box=document.querySelector('.canvas-stage .canvas-native-block'),content=box?.querySelector(':scope > .preview-block'),a=box?.getBoundingClientRect(),b=content?.getBoundingClientRect();return a&&b&&Math.abs((a.top+a.bottom-b.top-b.bottom)/2)<1})()`, 'canvas text middle alignment');
  await choose('Vertical alignment', 'bottom');
  await wait(`(()=>{const box=document.querySelector('.canvas-stage .canvas-native-block'),content=box?.querySelector(':scope > .preview-block'),a=box?.getBoundingClientRect(),b=content?.getBoundingClientRect();return a&&b&&Math.abs(a.bottom-b.bottom)<1})()`, 'canvas text bottom alignment');
  await click('Format block');
  await wait(`Boolean(document.querySelector('.canvas-formatting-layer .block-formatting-modal'))`, 'canvas native block formatting');
  const formattingSections = await evaluate(`Array.from(document.querySelectorAll('.canvas-formatting-layer .appearance-section > h3')).map(element=>element.textContent)`);
  if (!formattingSections.includes('Typography') || !formattingSections.includes('Fill and border')) throw new Error(`Canvas text formatting is incomplete: ${JSON.stringify(formattingSections)}`);
  await evaluate(`document.querySelector('.canvas-formatting-layer button[aria-label="Close block formatting"]')?.click()`);
  await wait(`!document.querySelector('.canvas-formatting-layer')`, 'canvas formatting close');
  await click('Line');
  await wait(`document.querySelectorAll('.canvas-stage .canvas-line').length===1`, 'canvas line insertion');
  await fill('Weight (pt)', '3');
  await fill('Rotation (°)', '45');
  await wait(`(()=>{const line=document.querySelector('.canvas-stage .canvas-line'),stroke=line?.querySelector('line'),selection=document.querySelector('.canvas-selection.selected');return stroke?.style.strokeWidth==='3pt'&&line.style.transform==='rotate(45deg)'&&selection?.style.transform==='rotate(45deg)'})()`, 'canvas line weight and rotation');
  await evaluate(`document.querySelector('.canvas-designer-toolbar > button.primary')?.click()`);
  await wait(`!document.querySelector('.canvas-designer')`, 'canvas designer close');
  await evaluate(`Array.from(document.querySelectorAll('.page-template-designer header button')).find(button=>button.textContent.includes('Save draft'))?.click()`);
  await wait(`document.querySelector('.template-save-status')?.textContent.includes('Draft saved')`, 'browser canvas page save');
  await evaluate(`Array.from(document.querySelectorAll('.page-template-designer header button')).find(button=>button.textContent.trim()==='Done')?.click()`);
  await wait(`!document.querySelector('.page-template-designer')`, 'page template editor close');
  await evaluate(`(()=>{const card=Array.from(document.querySelectorAll('.page-template-cards article')).find(article=>article.textContent.includes('Browser canvas regression'));card?.querySelector('button')?.click();return Boolean(card)})()`);
  await wait(`Boolean(document.querySelector('.page-template-designer'))`, 'saved canvas page reopen');
  await evaluate(`Array.from(document.querySelectorAll('.page-template-designer button')).find(button=>button.textContent.trim()==='Design')?.click()`);
  await wait(`Boolean(document.querySelector('.canvas-designer'))`, 'saved page canvas reopen');
  const reopenedElements = await evaluate(`document.querySelectorAll('.canvas-stage [data-canvas-element-id]').length`);
  if (reopenedElements !== initialElements + 2) throw new Error(`Browser canvas page lost its elements after save: ${initialElements + 2} expected, ${reopenedElements} found.`);
  await evaluate(`document.querySelector('.canvas-designer-toolbar > button.primary')?.click()`);
  await wait(`!document.querySelector('.canvas-designer')`, 'reopened canvas designer close');
  const publishDisabled = await evaluate(`Array.from(document.querySelectorAll('.page-template-designer header button')).find(button=>button.textContent.includes('Publish version'))?.disabled`);
  if (publishDisabled) throw new Error('A valid browser canvas page cannot be published.');
  await evaluate(`Array.from(document.querySelectorAll('.page-template-designer header button')).find(button=>button.textContent.includes('Publish version'))?.click()`);
  await wait(`document.querySelector('.template-save-status')?.textContent.includes('Published')`, 'browser canvas page publish');
  pass('creates, zooms, formats and vertically aligns text, rotates lines, drag-edits, saves, reopens, and publishes a browser canvas page template');
  if (runtimeErrors.length) throw new Error(`Runtime errors: ${runtimeErrors.join('\\n')}`);
  console.log(`\n${results.length} browser canvas-page checks passed.`);
  socket.close();
  process.exit(0);
}

if (process.env.BULLETIN_PALETTE_ONLY === '1') {
  const compactShell = await evaluate(`(()=>{const slot=document.querySelector('.sidebar-palette-slot')?.getBoundingClientRect(),palette=document.querySelector('.elements-sidebar .element-palette')?.getBoundingClientRect();return {editor:document.querySelector('.app-shell')?.classList.contains('editor-shell'),rail:Boolean(document.querySelector('.navigation-rail')),elements:Boolean(palette),collapse:Boolean(document.querySelector('.elements-sidebar .element-palette > header button')),bottomGap:slot&&palette?slot.bottom-palette.bottom:null}})()`);
  if (!compactShell.editor || !compactShell.rail || !compactShell.elements || compactShell.collapse || Math.abs(compactShell.bottomGap ?? 99) > 1) throw new Error(`Compact editor shell is incomplete: ${JSON.stringify(compactShell)}`);
  pass('shows an icon navigation rail and dedicated non-collapsible Elements sidebar');

  const beforeDrawer = await evaluate(`(()=>{const main=document.querySelector('.main-area').getBoundingClientRect(),elements=document.querySelector('.elements-sidebar').getBoundingClientRect();return {main:{left:main.left,width:main.width},elements:{left:elements.left,width:elements.width}}})()`);
  await evaluate(`document.querySelector('.navigation-toggle')?.click()`);
  await wait(`document.querySelector('.app-shell')?.classList.contains('navigation-open')`, 'navigation drawer open');
  await new Promise(resolve => setTimeout(resolve, 220));
  const afterDrawer = await evaluate(`(()=>{const main=document.querySelector('.main-area').getBoundingClientRect(),elements=document.querySelector('.elements-sidebar').getBoundingClientRect(),drawer=document.querySelector('.navigation-drawer').getBoundingClientRect();return {main:{left:main.left,width:main.width},elements:{left:elements.left,width:elements.width},drawer:{left:drawer.left,width:drawer.width},expanded:document.querySelector('.navigation-toggle')?.getAttribute('aria-expanded')}})()`);
  if (Math.abs(beforeDrawer.main.left - afterDrawer.main.left) > 1 || Math.abs(beforeDrawer.main.width - afterDrawer.main.width) > 1 || Math.abs(beforeDrawer.elements.left - afterDrawer.elements.left) > 1 || Math.abs(beforeDrawer.elements.width - afterDrawer.elements.width) > 1 || Math.abs(afterDrawer.drawer.left) > 1 || Math.abs(afterDrawer.drawer.width - 232) > 1 || afterDrawer.expanded !== 'true') {
    throw new Error(`Navigation drawer shifted the editor shell: ${JSON.stringify({ beforeDrawer, afterDrawer })}`);
  }
  pass('opens the full navigation as a 232px overlay without shifting the workspace');

  await evaluate(`document.querySelector('.navigation-close')?.click()`);
  await wait(`!document.querySelector('.app-shell')?.classList.contains('navigation-open')`, 'navigation close button');
  await evaluate(`document.querySelector('.navigation-toggle')?.click()`);
  await wait(`document.querySelector('.app-shell')?.classList.contains('navigation-open')`, 'navigation drawer reopen');
  await evaluate(`document.querySelector('.navigation-scrim')?.click()`);
  await wait(`!document.querySelector('.app-shell')?.classList.contains('navigation-open')`, 'navigation outside click');
  await evaluate(`document.querySelector('.navigation-toggle')?.click()`);
  await wait(`document.querySelector('.app-shell')?.classList.contains('navigation-open')`, 'navigation drawer escape setup');
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
  await wait(`!document.querySelector('.app-shell')?.classList.contains('navigation-open')`, 'navigation escape');
  pass('closes navigation by its close button, outside click, and Escape');

  await evaluate(`document.querySelector('.navigation-toggle')?.click()`);
  await wait(`document.querySelector('.app-shell')?.classList.contains('navigation-open')`, 'navigation destination setup');
  await evaluate(`Array.from(document.querySelectorAll('.navigation-drawer nav button')).find(button=>button.textContent.includes('Library'))?.click()`);
  await wait(`Boolean(document.querySelector('.static-navigation'))&&!document.querySelector('.navigation-rail')`, 'expanded management navigation');
  await evaluate(`Array.from(document.querySelectorAll('.static-navigation nav button')).find(button=>button.textContent.includes('Templates'))?.click()`);
  await wait(`Boolean(document.querySelector('.navigation-rail'))&&Boolean(document.querySelector('.elements-sidebar .element-palette'))&&!document.querySelector('.template-workbench .element-palette')`, 'template palette portal attachment');
  await evaluate(`document.querySelector('.navigation-toggle')?.click()`);
  await wait(`document.querySelector('.app-shell')?.classList.contains('navigation-open')`, 'template navigation setup');
  await evaluate(`Array.from(document.querySelectorAll('.navigation-drawer nav button')).find(button=>button.textContent.includes('Library'))?.click()`);
  await wait(`Boolean(document.querySelector('.static-navigation'))`, 'return to management navigation');
  await evaluate(`Array.from(document.querySelectorAll('.static-navigation nav button')).find(button=>button.textContent.includes('This week'))?.click()`);
  await wait(`Boolean(document.querySelector('.navigation-rail'))&&Boolean(document.querySelector('.elements-sidebar .element-palette'))`, 'return to compact editor navigation');
  pass('attaches the template palette correctly when entering Templates from expanded navigation');

  await command('Emulation.setDeviceMetricsOverride', { width: 1120, height: 800, deviceScaleFactor: 1, mobile: false });
  const compactWidth = await evaluate(`(()=>{const rail=document.querySelector('.navigation-rail').getBoundingClientRect(),elements=document.querySelector('.elements-sidebar').getBoundingClientRect(),main=document.querySelector('.main-area').getBoundingClientRect();return {rail:rail.width,elements:elements.width,mainLeft:main.left}})()`);
  if (Math.abs(compactWidth.rail - 56) > 1 || Math.abs(compactWidth.elements - 168) > 1 || Math.abs(compactWidth.mainLeft - 224) > 1) throw new Error(`Compact shell widths changed at 1120px: ${JSON.stringify(compactWidth)}`);
  await command('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  pass('preserves compact rail and Elements widths at the narrower desktop layout');

  const initialCount = await evaluate(`document.querySelectorAll('.editor-scroll .palette-sortable-content > .block-editor').length`);
  await evaluate(`document.querySelector('.sidebar-palette-slot .element-palette-item')?.click()`);
  await wait(`document.querySelectorAll('.editor-scroll .palette-sortable-content > .block-editor').length===${initialCount + 1}`, 'palette click append');
  pass('appends a native block by clicking its palette item');

  const drag = await evaluate(`(()=>{const item=document.querySelector('.sidebar-palette-slot .element-palette-item');const target=document.querySelector('.editor-pane [data-editor-block-id]');target.scrollIntoView({block:'center'});const a=item.getBoundingClientRect(),b=target.getBoundingClientRect();return {start:{x:a.left+a.width/2,y:a.top+a.height/2},end:{x:b.left+b.width/2,y:b.top+4},first:target.dataset.editorBlockId}})()`);
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: drag.start.x, y: drag.start.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let step = 1; step <= 8; step++) {
    const ratio = step / 8;
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: drag.start.x + (drag.end.x - drag.start.x) * ratio, y: drag.start.y + (drag.end.y - drag.start.y) * ratio, button: 'left', buttons: 1 });
    await new Promise(resolve => setTimeout(resolve, 35));
  }
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: drag.end.x, y: drag.end.y, button: 'left', buttons: 0, clickCount: 1 });
  await wait(`document.querySelector('.editor-pane [data-editor-block-id]')?.dataset.editorBlockId!==${JSON.stringify(drag.first)}`, 'palette exact-position drop');
  const afterDropCount = await evaluate(`document.querySelectorAll('.editor-scroll .palette-sortable-content > .block-editor').length`);
  if (afterDropCount !== initialCount + 2) throw new Error(`Palette drag inserted ${afterDropCount - initialCount} blocks after one click and one drop.`);
  pass('drops a palette block before the first existing block');

  await evaluate(`(()=>{const page=Array.from(document.querySelectorAll('.editor-pane [data-editor-block-id]')).find(block=>block.querySelector('.block-type')?.textContent.toLowerCase().includes('templatepage'));page.open=true;page.scrollIntoView({block:'center'});return true})()`);
  const editPage = await evaluate(`(()=>{const button=Array.from(document.querySelectorAll('.editor-pane button')).find(button=>button.textContent.trim()==='Edit page overrides');button?.click();return Boolean(button)})()`);
  if (!editPage) throw new Error('Reusable page edit action was not found.');
  await wait(`Boolean(document.querySelector('.page-template-designer'))`, 'page template editor');
  await click('Design');
  await wait(`Boolean(document.querySelector('.canvas-designer'))`, 'canvas designer');
  const canvasState = await evaluate(`({palette:Boolean(document.querySelector('.canvas-layers .element-palette')),layers:Boolean(document.querySelector('.canvas-layer-heading')),native:document.querySelectorAll('.canvas-stage .canvas-native-block').length})`);
  if (!canvasState.palette || !canvasState.layers || !canvasState.native) throw new Error(`Canvas native palette/layers are incomplete: ${JSON.stringify(canvasState)}`);
  pass('shows native canvas elements and layers together');
  if (runtimeErrors.length) throw new Error(`Runtime errors: ${runtimeErrors.join('\\n')}`);
  console.log(`\n${results.length} browser palette checks passed.`);
  socket.close();
  process.exit(0);
}

if (process.env.BULLETIN_CHURCH_YEAR_ONLY === '1') {
  if (await evaluate(`Boolean(document.querySelector('.editor-pane .church-calendar-screen'))`)) throw new Error('Church Calendar management remains in the weekly editor.');
  await click('Church Calendar');
  await wait(`document.querySelector('.church-calendar-screen h2')?.textContent === 'Church Calendar'`, 'dedicated Church Calendar flow');
  const presetCount = await evaluate(`document.querySelectorAll('.church-calendar-grid .calendar-day i').length`);
  await click('Add event');
  await wait(`Boolean(document.querySelector('.calendar-event-editor'))`, 'church event editor');
  await fill('Name', 'Browser Test Festival');
  await fill('Priority', '95');
  await click('Save calendar');
  await wait(`window.bulletin.openWorkspace(localStorage.getItem('bulletin-workspace')).then(workspace=>workspace.library.calendarEvents?.some(event=>event.name==='Browser Test Festival'&&event.priority===95))`, 'saved Church Calendar event');
  if (presetCount < 1) throw new Error('Church Calendar did not render the WELS preset.');
  await click('Templates');
  if (await evaluate(`Boolean(document.querySelector('.template-workbench .church-calendar-screen'))`)) throw new Error('Church Calendar management appears in the template editor.');
  pass('edits synchronized Church Calendar events in a separate full-size flow');
  console.log(`\n${results.length} browser Church Calendar checks passed.`);
  socket.close();
  process.exit(0);
}

if (process.env.BULLETIN_CREATE_FROM_ONLY === '1') {
  await click('New week');
  await wait(`document.querySelector('.create-from-modal button[role="tab"][aria-selected="true"]')?.textContent.includes('Templates')`, 'bulletin template-source chooser');
  await evaluate(`(()=>{const input=document.querySelector('.create-from-modal input[type="date"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'2026-08-09');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  await click('Create a bulletin');
  await wait(`document.querySelector('.editor-pane input[type="date"]')?.value === '2026-08-09'`, 'bulletin created from template');
  await wait(`document.querySelector('.save-status')?.textContent === 'Saved'`, 'saved template-based bulletin');

  await click('New week');
  await evaluate(`document.querySelector('.create-from-tabs button:last-child').click()`);
  await wait(`document.querySelector('.create-from-modal button[role="tab"][aria-selected="true"]')?.textContent.includes('Bulletins')`, 'bulletin-source chooser');
  await evaluate(`(()=>{const input=document.querySelector('.create-from-modal input[type="date"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'2026-08-16');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  await click('Create a bulletin');
  await wait(`document.querySelector('.editor-pane input[type="date"]')?.value === '2026-08-16'`, 'bulletin created from bulletin');
  await wait(`document.querySelector('.save-status')?.textContent === 'Saved'`, 'saved bulletin-based bulletin');

  await click('Templates');
  await click('New template');
  await fill('New template name', 'Browser Template Source');
  await click('Create a template');
  await wait(`document.querySelector('.topbar h1')?.textContent === 'Browser Template Source'`, 'template created from template');

  await click('New template');
  await evaluate(`document.querySelector('.create-from-tabs button:last-child').click()`);
  await fill('New template name', 'Browser Bulletin Source');
  await click('Create a template');
  await wait(`document.querySelector('.topbar h1')?.textContent === 'Browser Bulletin Source'`, 'template created from bulletin');
  const created = await evaluate(`window.bulletin.openWorkspace(localStorage.getItem('bulletin-workspace')).then(workspace=>({bulletins:workspace.bulletins.filter(item=>['2026-08-09','2026-08-16'].includes(item.document.info.date)).length,templates:workspace.templates.filter(item=>['Browser Template Source','Browser Bulletin Source'].includes(item.template.name)).map(item=>item.template.name)}))`);
  if (created.bulletins !== 2 || created.templates.length !== 2) throw new Error(`Create-from records were not persisted: ${JSON.stringify(created)}`);
  pass('creates bulletins and templates from either source type');
  console.log(`\n${results.length} browser create-from checks passed.`);
  socket.close();
  process.exit(0);
}

if (process.env.BULLETIN_PAGE_SETUP_ONLY === '1') {
  if (await evaluate(`Boolean(document.querySelector('.editor-pane .essentials input[type="number"]'))`)) throw new Error('Page margin remains in the weekly essentials card.');
  const weeklySetup = await evaluate(`(()=>{const setup=document.querySelector('.editor-pane .page-setup-card');return {exists:Boolean(setup),open:setup?.open,label:setup?.querySelector('summary h3')?.textContent,margin:setup?.querySelector('input[type="number"]')?.value}})()`);
  if (!weeklySetup.exists || weeklySetup.open || weeklySetup.label !== 'Page setup') throw new Error(`Weekly page setup is not a collapsed separate area: ${JSON.stringify(weeklySetup)}`);
  await evaluate(`document.querySelector('.editor-pane .page-setup-card summary').click()`);
  await wait(`document.querySelector('.editor-pane .page-setup-card')?.open`, 'opened weekly page setup');
  await click('Templates');
  if (await evaluate(`Boolean(Array.from(document.querySelectorAll('.template-workbench .editor-card')).find(card=>card.querySelector(':scope > h2')?.textContent==='Theme')?.querySelector('input[type="number"][max="1.25"]'))`)) throw new Error('Page margin remains in the template Theme card.');
  const templateSetup = await evaluate(`(()=>{const setup=document.querySelector('.template-workbench .page-setup-card');return {exists:Boolean(setup),open:setup?.open,label:setup?.querySelector('summary h3')?.textContent,margin:setup?.querySelector('input[type="number"]')?.value}})()`);
  if (!templateSetup.exists || templateSetup.open || templateSetup.label !== 'Page setup') throw new Error(`Template page setup is not a collapsed separate area: ${JSON.stringify(templateSetup)}`);
  pass('keeps weekly and template margins in separate Page setup areas');
  console.log(`\n${results.length} browser Page setup checks passed.`);
  socket.close();
  process.exit(0);
}

if (process.env.BULLETIN_SORTABLE_ONLY === '1') {
  await evaluate(`(()=>{const blocks=Array.from(document.querySelectorAll('.editor-scroll > .block-editor'));blocks.forEach(block=>block.removeAttribute('open'));const copyright=blocks.find(block=>block.querySelector('.block-type')?.textContent.startsWith('copyright'));copyright?.scrollIntoView({block:'center'});return blocks.length})()`);
  const start = await evaluate(`(()=>{const blocks=Array.from(document.querySelectorAll('.editor-scroll > .block-editor'));const sourceIndex=blocks.findIndex(block=>block.querySelector('.block-type')?.textContent.startsWith('copyright'));if(sourceIndex<2)throw new Error('Copyright block is unavailable for sorting');const source=blocks[sourceIndex];const target=blocks[sourceIndex-2];const handle=source.querySelector('.drag-handle');const handleRect=handle.getBoundingClientRect();const targetRect=target.getBoundingClientRect();return {sourceId:source.dataset.editorBlockId,sourceIndex,start:{x:handleRect.left+handleRect.width/2,y:handleRect.top+handleRect.height/2},target:{x:handleRect.left+handleRect.width/2,y:targetRect.top+targetRect.height*.25}}})()`);
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.start.x, y: start.start.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let step = 1; step <= 6; step += 1) {
    const ratio = step / 6;
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.start.x + (start.target.x - start.start.x) * ratio, y: start.start.y + (start.target.y - start.start.y) * ratio, button: 'left', buttons: 1 });
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  await wait(`Boolean(document.querySelector('.editor-scroll > .block-editor.is-dragging'))`, 'picked-up sortable block');
  const motion = await evaluate(`(()=>{const blocks=Array.from(document.querySelectorAll('.editor-scroll > .block-editor'));return {active:blocks.some(block=>block.classList.contains('is-dragging')&&block.style.transform&&block.style.transform!=='none'),shifted:blocks.some(block=>!block.classList.contains('is-dragging')&&block.style.transform&&block.style.transform!=='none')}})()`);
  if (!motion.active || !motion.shifted) throw new Error(`Sortable blocks did not move together: ${JSON.stringify(motion)}`);
  pass('moves the picked-up block with the pointer while neighboring blocks shift');
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: start.target.x, y: start.target.y, button: 'left', buttons: 0, clickCount: 1 });
  await wait(`Array.from(document.querySelectorAll('.editor-scroll > .block-editor')).findIndex(block=>block.dataset.editorBlockId===${JSON.stringify(start.sourceId)})<${start.sourceIndex}`, 'committed sortable order');
  pass('commits the pointer-selected block order');
  if (await evaluate(`document.querySelector('[data-editor-block-id="${start.sourceId}"]')?.hasAttribute('open')`)) throw new Error('Dragging expanded the copyright block.');
  pass('keeps the dragged copyright block collapsed');
  if (runtimeErrors.length) throw new Error(`Runtime errors: ${runtimeErrors.join('\\n')}`);
  socket.close();
  process.exit(0);
}

if (process.env.BULLETIN_CANVAS_ONLY === '1') {
  if (!await evaluate(`Boolean(document.querySelector('.preview-pane [data-canvas-coordinate-space="fullPage"]'))`)) {
    await command('Runtime.evaluate', { expression: `window.__canvasSetupDone=false;window.__canvasSetupError='';(async()=>{const root=await window.bulletin.createWorkspace('Canvas browser smoke '+Date.now());const workspace=await window.bulletin.openWorkspace(root);const template=workspace.templates.find(item=>item.template.starterBlocks.some(block=>block.type==='canvasCover')).template;const date='2026-07-27';const document={schemaVersion:1,id:'canvas-browser-smoke',revision:0,template:{id:template.id,version:template.version},church:{name:'Canvas Test Church'},info:{title:'Canvas Test',date,churchWeek:'Sunday',series:'Grace'},blocks:structuredClone(template.starterBlocks),updatedAt:new Date().toISOString()};await window.bulletin.saveBulletin(root,'bulletins/2026-07-27/bulletin.json',document,0);localStorage.setItem('bulletin-workspace',root);window.__canvasSetupDone=true;setTimeout(()=>location.reload(),500)})().catch(error=>{window.__canvasSetupError=String(error)});true`, returnByValue: true });
    await new Promise(resolve => setTimeout(resolve, 700));
  }
  await wait(`Boolean(document.querySelector('.preview-pane [data-canvas-coordinate-space="fullPage"]'))`, 'new-workspace canvas preview');
  pass('renders a newly created canvas-cover workspace');
  await command('Runtime.evaluate', { expression: `(()=>{const editor=Array.from(document.querySelectorAll('.editor-pane [data-editor-block-id]')).find(editor=>editor.querySelector('.block-type')?.textContent.startsWith('canvasCover'));editor.setAttribute('open','');const scroll=editor.closest('.editor-scroll');scroll.scrollTop=Math.max(0,editor.offsetTop-scroll.clientHeight/2)})()` });
  pass('opens the canvas cover editor card');
  const openDesigner = await evaluate(`(()=>{const button=Array.from(document.querySelectorAll('.editor-pane button')).find(button=>button.textContent.includes('Open cover designer'));const rect=button.getBoundingClientRect();return [rect.left+rect.width/2,rect.top+rect.height/2]})()`);
  console.log(`Canvas designer action at ${JSON.stringify(openDesigner)}`);
  pass('locates the cover designer action');
  try {
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: openDesigner[0], y: openDesigner[1], button: 'left', clickCount: 1 });
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: openDesigner[0], y: openDesigner[1], button: 'left', clickCount: 1 });
  } catch (error) {
    if (!String(error).includes('Object reference chain is too long')) throw error;
  }
  pass('dispatches the cover designer action');
  const canvasScreenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  pass('captures the cover designer');
  await writeFile('/tmp/bulletin-canvas-designer.png', Buffer.from(canvasScreenshot.data, 'base64'));
  const domRoot = async () => (await command('DOM.getDocument')).root.nodeId;
  const queryAll = async selector => (await command('DOM.querySelectorAll', { nodeId: await domRoot(), selector })).nodeIds;
  const clickNode = async nodeId => {
    await command('DOM.scrollIntoViewIfNeeded', { nodeId });
    const model = (await command('DOM.getBoxModel', { nodeId })).model;
    const x = (model.content[0] + model.content[2] + model.content[4] + model.content[6]) / 4;
    const y = (model.content[1] + model.content[3] + model.content[5] + model.content[7]) / 4;
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  const selections = await queryAll('.canvas-designer .canvas-selection');
  if (!selections.length) throw new Error('Canvas designer has no scene objects.');
  await clickNode(selections[0]);
  const selectedNodes = await queryAll('.canvas-designer .canvas-selection.selected');
  if (!selectedNodes.length) throw new Error('Canvas object selection failed.');
  const toolButtons = await queryAll('.canvas-designer .canvas-tools > button');
  const before = selections.length;
  await clickNode(toolButtons[2]);
  const after = (await queryAll('.canvas-designer .canvas-selection')).length;
  if (after !== before + 1) throw new Error(`Canvas rectangle was not added: ${before} → ${after}`);
  const stageNode = (await queryAll('.canvas-stage'))[0];
  const stageModel = (await command('DOM.getBoxModel', { nodeId: stageNode })).model;
  if (Math.abs(stageModel.width - 672) > 1 || Math.abs(stageModel.height - 816) > 1) throw new Error(`Canvas stage is not 7 × 8.5 inches: ${stageModel.width} × ${stageModel.height}`);
  const doneNode = (await queryAll('.canvas-designer-toolbar > .primary'))[0];
  await clickNode(doneNode);
  await new Promise(resolve => setTimeout(resolve, 150));
  const remainingDesigners = (await queryAll('.canvas-designer')).length;
  const previewCanvases = (await queryAll('.preview-pane [data-canvas-coordinate-space="fullPage"]')).length;
  if (remainingDesigners || !previewCanvases) throw new Error(`Canvas designer did not return to the weekly preview (${remainingDesigners} designers, ${previewCanvases} previews).`);
  pass('adds, designs, and previews an inch-based canvas cover');
  console.log(`\n${results.length} browser canvas checks passed.`);
  socket.close();
  process.exit(0);
}

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

if (process.env.BULLETIN_PREVIEW_NAV_ONLY === '1') {
  const nestedId = await evaluate(`Array.from(document.querySelectorAll('.preview-pane [data-block-id]')).map(element => element.dataset.blockId).find(id => Array.from(document.querySelectorAll('.editor-pane .nested-block-editor')).some(editor => editor.dataset.editorBlockId === id))`);
  if (!nestedId) throw new Error('No nested preview block has a matching weekly editor.');
  await evaluate(`document.querySelector('.preview-pane [data-block-id="${nestedId}"]').click()`);
  await wait(`(()=>{const target=Array.from(document.querySelectorAll('.editor-pane [data-editor-block-id]')).find(element=>element.dataset.editorBlockId===${JSON.stringify(nestedId)});return target?.open&&target.closest('.block-editor')?.open&&target.classList.contains('editor-block-focus')&&document.activeElement===target})()`, 'expanded and highlighted weekly block editor');
  await wait(`!Array.from(document.querySelectorAll('.editor-pane [data-editor-block-id]')).find(element=>element.dataset.editorBlockId===${JSON.stringify(nestedId)})?.classList.contains('editor-block-focus')`, 'temporary weekly editor highlight', 4000);
  await evaluate(`Array.from(document.querySelectorAll('.editor-pane [data-editor-block-id]')).find(element=>element.dataset.editorBlockId===${JSON.stringify(nestedId)}).click()`);
  await wait(`Array.from(document.querySelectorAll('.preview-pane [data-block-id]')).find(element=>element.dataset.blockId===${JSON.stringify(nestedId)})?.classList.contains('preview-block-focus')`, 'highlighted weekly preview block');
  await click('Templates');
  await wait(`Boolean(Array.from(document.querySelectorAll('.builder-preview [data-block-id]')).find(element=>element.dataset.blockId===${JSON.stringify(nestedId)}))`, 'matching nested template preview block');
  await evaluate(`Array.from(document.querySelectorAll('.builder-preview [data-block-id]')).find(element=>element.dataset.blockId===${JSON.stringify(nestedId)}).click()`);
  await wait(`(()=>{const target=Array.from(document.querySelectorAll('.template-workbench [data-editor-block-id]')).find(element=>element.dataset.editorBlockId===${JSON.stringify(nestedId)});return target?.classList.contains('editor-block-focus')&&document.activeElement===target})()`, 'highlighted template block editor');
  await evaluate(`Array.from(document.querySelectorAll('.template-workbench [data-editor-block-id]')).find(element=>element.dataset.editorBlockId===${JSON.stringify(nestedId)}).click()`);
  await wait(`Array.from(document.querySelectorAll('.builder-preview [data-block-id]')).find(element=>element.dataset.blockId===${JSON.stringify(nestedId)})?.classList.contains('preview-block-focus')`, 'highlighted template preview block');
  pass('links nested preview blocks and editors in both directions');
  console.log(`\n${results.length} browser MVP checks passed.`);
  socket.close();
  process.exit(0);
}

if (process.env.BULLETIN_SONG_LINES_ONLY === '1') {
  const libraryLyrics = 'Verse one, line one\nVerse one, line two\n\nVerse two, line one\nVerse two, line two';
  await click('Library'); await click('Add library item');
  await fill('Title', 'Line Break Hymn'); await fill('Stable ID', 'line-break-hymn'); await fill('Structured text', libraryLyrics);
  await click('Save item'); await wait(`document.body.textContent.includes('Line Break Hymn')`, 'saved line-break song');
  const storedLyrics = await evaluate(`window.bulletin.openWorkspace(localStorage.getItem('bulletin-workspace')).then(workspace=>workspace.library.items.find(item=>item.id==='line-break-hymn').content.map(paragraph=>paragraph.children[0].text))`);
  if (storedLyrics.length !== 2 || storedLyrics[0] !== 'Verse one, line one\nVerse one, line two' || storedLyrics[1] !== 'Verse two, line one\nVerse two, line two') throw new Error(`Library song lines were not preserved: ${JSON.stringify(storedLyrics)}`);
  await click('This week'); await choose('Library song', 'line-break-hymn');
  const songBlockId = await evaluate(`Array.from(document.querySelectorAll('.editor-pane select')).find(element=>element.value==='line-break-hymn').closest('[data-editor-block-id]').dataset.editorBlockId`);
  await wait(`(()=>{const song=document.querySelector('.preview-pane [data-block-id="${songBlockId}"]');return song?.querySelector('p')?.textContent==='Verse one, line one\\nVerse one, line two'&&getComputedStyle(song.querySelector('p')).whiteSpace==='pre-line'})()`, 'rendered library lyric lines');
  const weeklyLyrics = 'Weekly line one\nWeekly line two\n\nWeekly second verse';
  await evaluate(`(()=>{const editor=Array.from(document.querySelectorAll('.editor-pane [data-editor-block-id]')).find(element=>element.dataset.editorBlockId===${JSON.stringify(songBlockId)});const textarea=editor.querySelector('textarea[placeholder="Enter song lyrics…"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(textarea,${JSON.stringify(weeklyLyrics)});textarea.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  await wait(`document.querySelector('.preview-pane [data-block-id="${songBlockId}"] p')?.textContent==='Weekly line one\\nWeekly line two'`, 'rendered weekly lyric lines');
  await wait(`document.querySelector('.save-status')?.textContent === 'Saved'`, 'saved weekly lyric lines');
  const weeklyStored = await evaluate(`window.bulletin.openWorkspace(localStorage.getItem('bulletin-workspace')).then(workspace=>workspace.bulletins[0].document.blocks.find(block=>block.id===${JSON.stringify(songBlockId)}).contentOverride.map(paragraph=>paragraph.children[0].text))`);
  if (weeklyStored[0] !== 'Weekly line one\nWeekly line two' || weeklyStored[1] !== 'Weekly second verse') throw new Error(`Weekly song lines were not preserved: ${JSON.stringify(weeklyStored)}`);
  pass('preserves lyric lines in library songs and weekly overrides');
  console.log(`\n${results.length} browser MVP checks passed.`);
  socket.close();
  process.exit(0);
}

if (process.env.BULLETIN_VERSE_NUMBERS_ONLY === '1') {
  const scriptureBlockId = await evaluate(`document.querySelector('.editor-pane .scripture-rich-editor').closest('[data-editor-block-id]').dataset.editorBlockId`);
  const pastedPassage = '16 For God so loved the world\nthat he gave his only Son for 40 days.\n\n17 He came to save.';
  await evaluate(`(()=>{const editor=document.querySelector('.editor-pane .scripture-rich-editor');editor.focus();const selection=getSelection();const range=document.createRange();range.selectNodeContents(editor);selection.removeAllRanges();selection.addRange(range);const clipboardData=new DataTransfer();clipboardData.setData('text/plain',${JSON.stringify(pastedPassage)});editor.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData}));return true})()`);
  await wait(`(()=>{const block=document.querySelector('.preview-pane [data-block-id="${scriptureBlockId}"]');const paragraphs=block?.querySelectorAll(':scope > p:not(.caption):not(.missing)');return paragraphs?.length===2&&paragraphs[0].querySelector('br')&&block.querySelectorAll('.mark-superscript').length===2})()`, 'structured scripture line and paragraph breaks');
  const editProbe = ` Edited without moving either marker ${Date.now()}.`;
  await evaluate(`(()=>{const editor=document.querySelector('.editor-pane .scripture-rich-editor');editor.querySelector('div').append(${JSON.stringify(editProbe)});editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));return true})()`);
  await wait(`(()=>{const block=document.querySelector('.preview-pane [data-block-id="${scriptureBlockId}"]');return block?.textContent.includes(${JSON.stringify(editProbe.trim())})&&block.querySelectorAll('.mark-superscript').length===2&&block.querySelectorAll(':scope > p:not(.caption):not(.missing)').length===2})()`, 'preserved markers while editing surrounding scripture');
  await evaluate(`document.querySelector('.editor-pane .scripture-rich-editor [data-verse-marker]').click()`);
  await fill('Verse number', '18');
  await evaluate(`Array.from(document.querySelectorAll('.scripture-editor-toolbar button')).find(button=>button.textContent.includes('Update verse')).click()`);
  await wait(`document.querySelector('.preview-pane [data-block-id="${scriptureBlockId}"] .mark-superscript')?.textContent==='18'`, 'edited an explicit verse marker');
  await wait(`document.querySelector('.save-status')?.textContent === 'Saved'`, 'saved structured scripture');
  const stored = await evaluate(`window.bulletin.openWorkspace(localStorage.getItem('bulletin-workspace')).then(workspace=>workspace.bulletins[0].document.blocks.find(block=>block.id===${JSON.stringify(scriptureBlockId)}).resolved.content)`);
  const storedRuns = stored.flatMap(paragraph => paragraph.children);
  if (stored.length !== 2 || storedRuns.filter(run => run.type === 'lineBreak').length !== 1 || storedRuns.filter(run => run.marks?.includes('superscript')).map(run => run.text).join(',') !== '18,17' || storedRuns.some(run => run.text === '40' && run.marks?.includes('superscript'))) throw new Error(`Structured scripture was not persisted: ${JSON.stringify(stored)}`);
  pass('preserves scripture newlines and editable superscript verse markers');
  console.log(`\n${results.length} browser MVP checks passed.`);
  socket.close();
  process.exit(0);
}

if (process.env.BULLETIN_RESPONSIVE_ONLY === '1') {
  await wait(`Boolean(document.querySelector('.preview-pane .response-leader')&&document.querySelector('.preview-pane .response-follower'))`, 'leader and follower response rows');
  const weights = await evaluate(`(()=>{const weight=element=>Number.parseInt(getComputedStyle(element).fontWeight,10);const leader=document.querySelector('.preview-pane .response-leader');const follower=document.querySelector('.preview-pane .response-follower');return {leaderLabel:weight(leader.querySelector('.response-reader')),leaderText:weight(leader.querySelector('p')),followerLabel:weight(follower.querySelector('.response-reader')),followerText:weight(follower.querySelector('p')),synthesis:getComputedStyle(follower).fontSynthesisWeight}})()`);
  if (weights.leaderLabel >= 600 || weights.leaderText >= 600 || weights.followerLabel < 600 || weights.followerText < 600 || weights.synthesis === 'none') throw new Error(`Responsive reading weights are incorrect: ${JSON.stringify(weights)}`);
  const responsiveBlockId = await evaluate(`document.querySelector('.editor-pane .response-editor').closest('[data-editor-block-id]').dataset.editorBlockId`);
  const before = await evaluate(`document.querySelectorAll('.preview-pane [data-block-id="${responsiveBlockId}"] .response-row').length`);
  await evaluate(`Array.from(document.querySelector('.editor-pane [data-editor-block-id="${responsiveBlockId}"] .response-add-actions').querySelectorAll('button')).find(button=>button.textContent.includes('Follower')).click()`);
  await wait(`(()=>{const rows=document.querySelectorAll('.preview-pane [data-block-id="${responsiveBlockId}"] .response-row');const added=rows[rows.length-1];return rows.length===${before + 1}&&added?.classList.contains('response-follower')&&added.textContent.includes('New follower response')&&Number.parseInt(getComputedStyle(added.querySelector('p')).fontWeight,10)>=600})()`, 'new follower response');
  await wait(`document.querySelector('.save-status')?.textContent === 'Saved'`, 'saved responsive reading roles');
  const stored = await evaluate(`window.bulletin.openWorkspace(localStorage.getItem('bulletin-workspace')).then(workspace=>workspace.bulletins[0].document.blocks.find(block=>block.id===${JSON.stringify(responsiveBlockId)}).entries.at(-1))`);
  if (stored.role !== 'follower' || stored.reader !== 'C') throw new Error(`Follower role was not persisted: ${JSON.stringify(stored)}`);
  pass('distinguishes regular leaders from bold congregation responses');
  console.log(`\n${results.length} browser MVP checks passed.`);
  socket.close();
  process.exit(0);
}

if (process.env.BULLETIN_WEEKLY_DELETE_ONLY === '1') {
  const blockId = await evaluate(`Array.from(document.querySelectorAll('.editor-pane .block-editor')).find(editor=>editor.querySelector('.block-type')?.textContent.startsWith('heading')&&document.querySelector('.preview-pane [data-block-id="'+editor.dataset.editorBlockId+'"]')).dataset.editorBlockId`);
  await evaluate(`Array.from(document.querySelectorAll('.editor-pane .block-editor')).find(editor=>editor.dataset.editorBlockId===${JSON.stringify(blockId)}).querySelector('button[aria-label^="Remove "]').click()`);
  await wait(`!Array.from(document.querySelectorAll('.editor-pane [data-editor-block-id]')).some(element=>element.dataset.editorBlockId===${JSON.stringify(blockId)})&&!Array.from(document.querySelectorAll('.preview-pane [data-block-id]')).some(element=>element.dataset.blockId===${JSON.stringify(blockId)})`, 'removed weekly block and preview');
  await wait(`document.querySelector('.save-status')?.textContent === 'Saved'`, 'saved weekly block deletion');
  const stored = await evaluate(`window.bulletin.openWorkspace(localStorage.getItem('bulletin-workspace')).then(workspace=>workspace.bulletins[0].document.blocks.some(block=>block.id===${JSON.stringify(blockId)}))`);
  if (stored) throw new Error(`Deleted weekly block remains in storage: ${blockId}`);
  pass('deletes a top-level block from the weekly bulletin');
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
  await evaluate(`(()=>{const block=Array.from(document.querySelectorAll('.block-editor')).find(element=>element.textContent.includes('Opening Hymn'));const button=block?.querySelector('.format-block-button');if(!button)throw new Error('Opening Hymn format button missing');button.click();return true})()`);
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

if (process.env.BULLETIN_DESCRIPTORS_ONLY === '1') {
  await click('Templates');
  const initialCount = await evaluate(`document.querySelectorAll('.outline > li').length`);
  await click('Add block');
  await wait(`document.querySelectorAll('.block-library-modal .built-in-choice').length === 12`, 'pre-packaged JSON block catalog');
  if (!await evaluate(`document.querySelector('.block-library-toolbar.built-in-heading')?.textContent.includes('Pre-packaged blocks') && document.querySelector('.descriptor-source-note')?.textContent.includes('JSON descriptors')`)) throw new Error('The pre-packaged descriptor catalog is not identified in the block library.');
  await evaluate(`(()=>{const choice=Array.from(document.querySelectorAll('.block-library-modal .built-in-choice')).find(element=>element.querySelector('b')?.textContent==='Paragraph');if(!choice)throw new Error('Paragraph descriptor missing');choice.querySelector('.secondary').click();return true})()`);
  await wait(`document.querySelectorAll('.outline > li').length === ${initialCount + 1} && document.querySelector('.builder-preview .document-stack')?.textContent.includes('New paragraph')`, 'paragraph instantiated from descriptor');
  await click('Save draft');
  await wait(`document.querySelector('.template-save-status')?.textContent.includes('Draft saved')`, 'descriptor-backed template save');
  const saved = await evaluate(`window.bulletin.openWorkspace(localStorage.getItem('bulletin-workspace')).then(workspace=>workspace.templates.find(item=>item.template.status==='draft').template.starterBlocks.at(-1))`);
  if (saved?.type !== 'paragraph' || saved.children?.length !== 2 || saved.children[0]?.presentation?.fontWeight !== 'bold' || saved.presentation?.marginIn?.bottom !== 0.16 || saved.layout?.keepTogether !== true || !saved.id.startsWith('paragraph-')) throw new Error(`Descriptor instance was not persisted correctly: ${JSON.stringify(saved)}`);
  pass('loads and instantiates the pre-packaged block catalog from JSON descriptors');
  console.log(`\n${results.length} browser MVP checks passed.`);
  socket.close();
  process.exit(0);
}

if (process.env.BULLETIN_WEEKLY_BLOCKS_ONLY === '1') {
  const initialIds = await evaluate(`Array.from(document.querySelectorAll('.editor-pane > .editor-scroll > [data-editor-block-id]')).map(element=>element.dataset.editorBlockId)`);
  await click('Add block');
  await wait(`Boolean(document.querySelector('.block-library-modal'))`, 'weekly block palette');
  await evaluate(`(()=>{const choice=Array.from(document.querySelectorAll('.block-library-modal .built-in-choice')).find(element=>element.querySelector('b')?.textContent==='Heading');if(!choice)throw new Error('Heading descriptor missing');choice.querySelector('.secondary').click();return true})()`);
  await wait(`document.querySelectorAll('.editor-pane > .editor-scroll > [data-editor-block-id]').length === ${initialIds.length + 1}`, 'weekly block insertion');
  const addedId = await evaluate(`Array.from(document.querySelectorAll('.editor-pane > .editor-scroll > [data-editor-block-id]')).map(element=>element.dataset.editorBlockId).find(id=>!${JSON.stringify(initialIds)}.includes(id))`);
  await wait(`document.querySelector('.editor-pane [data-editor-block-id="${addedId}"]')?.open === true`, 'opened newly inserted weekly block');
  const editedText = `Weekly inserted heading ${Date.now()}`;
  await evaluate(`(()=>{const editor=document.querySelector('.editor-pane [data-editor-block-id="${addedId}"]');const input=Array.from(editor.querySelectorAll('input')).find(element=>element.closest('label')?.textContent.startsWith('Text'));Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(editedText)});input.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  await wait(`document.querySelector('.preview-pane [data-block-id="${addedId}"]')?.textContent.includes(${JSON.stringify(editedText)})`, 'edited inserted weekly block');
  if (await evaluate(`Boolean(document.querySelector('.editor-pane [data-editor-block-id="${addedId}"] button[title="Move up"], .editor-pane [data-editor-block-id="${addedId}"] button[title="Move down"]'))`)) throw new Error('Legacy block move arrows remain.');
  if (!await evaluate(`Boolean(document.querySelector('.editor-pane [data-editor-block-id="${addedId}"] .drag-handle')`)) throw new Error('Inserted weekly block has no drag handle.');
  await wait(`document.querySelector('.save-status')?.textContent === 'Saved'`, 'saved inserted weekly block');
  const stored = await evaluate(`window.bulletin.openWorkspace(localStorage.getItem('bulletin-workspace')).then(workspace=>workspace.bulletins[0].document.blocks.find(block=>block.id===${JSON.stringify(addedId)}))`);
  if (stored?.type !== 'heading' || stored.text !== editedText) throw new Error(`Inserted weekly block was not saved: ${JSON.stringify(stored)}`);
  await evaluate(`document.querySelector('.editor-pane [data-editor-block-id="${addedId}"] button[aria-label^="Remove "]').click()`);
  await wait(`!document.querySelector('.editor-pane [data-editor-block-id="${addedId}"]') && !document.querySelector('.preview-pane [data-block-id="${addedId}"]')`, 'removed weekly block');
  await wait(`document.querySelector('.save-status')?.textContent === 'Saved'`, 'saved weekly block removal');
  const remains = await evaluate(`window.bulletin.openWorkspace(localStorage.getItem('bulletin-workspace')).then(workspace=>workspace.bulletins[0].document.blocks.some(block=>block.id===${JSON.stringify(addedId)}))`);
  if (remains) throw new Error('Removed weekly block remains in storage.');
  pass('adds, edits, reorders, saves, and removes blocks in the weekly workflow');
  console.log(`\n${results.length} browser MVP checks passed.`);
  socket.close();
  process.exit(0);
}

if (process.env.BULLETIN_DESCRIPTOR_IMPORT_ONLY === '1') {
  const firstScriptureId = await evaluate(`Array.from(document.querySelectorAll('.editor-pane [data-editor-block-id]')).find(element=>element.querySelector('.block-type')?.textContent.startsWith('scriptureReading'))?.dataset.editorBlockId`);
  if (!firstScriptureId) throw new Error('No Scripture reading was available for the layout check.');
  await wait(`Boolean(document.querySelector('.preview-pane [data-block-id="${firstScriptureId}"] .scripture-heading-line'))`, 'inline Scripture heading and reference');
  await evaluate(`(()=>{const editor=document.querySelector('.editor-pane [data-editor-block-id="${firstScriptureId}"]');editor.open=true;const select=Array.from(editor.querySelectorAll('select')).find(element=>element.closest('label')?.textContent.startsWith('Heading and reference'));Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'stacked');select.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  await wait(`!document.querySelector('.preview-pane [data-block-id="${firstScriptureId}"] .scripture-heading-line')`, 'stacked Scripture heading and reference');
  await evaluate(`(()=>{const editor=document.querySelector('.editor-pane [data-editor-block-id="${firstScriptureId}"]');const select=Array.from(editor.querySelectorAll('select')).find(element=>element.closest('label')?.textContent.startsWith('Heading and reference'));Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'inline');select.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  await wait(`Boolean(document.querySelector('.preview-pane [data-block-id="${firstScriptureId}"] .scripture-heading-line'))`, 'restored inline Scripture heading and reference');
  await evaluate(`(()=>{const editor=document.querySelector('.editor-pane [data-editor-block-id="${firstScriptureId}"]');const input=Array.from(editor.querySelectorAll('input[type=number]')).find(element=>element.closest('label')?.textContent.startsWith('Space between'));Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'0');input.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  await wait(`getComputedStyle(document.querySelector('.preview-pane [data-block-id="${firstScriptureId}"] .scripture-heading-line')).columnGap === '0px'`, 'zero Scripture heading/reference gap');
  const invalidFile = '/tmp/bulletin-invalid-block.json';
  const validFile = '/tmp/bulletin-valid-block.json';
  await writeFile(invalidFile, '{"schemaVersion":2,"kind":"component","type":"Bad ID"}');
  await writeFile(validFile, JSON.stringify({
    schemaVersion: 2,
    kind: 'component',
    type: 'custom:importedWelcome',
    version: 1,
    name: 'Imported welcome',
    description: 'A validated imported heading.',
    inputSchema: { type: 'object', required: ['message'], properties: { message: { type: 'string' } }, additionalProperties: false },
    template: { type: 'core:text', id: 'message', part: 'message', inputs: { text: { $bind: 'inputs.message', required: true } } },
    defaultStyles: { root: { textAlign: 'center', fontWeight: 'bold' } },
    editor: { icon: '◇', fields: [{ input: 'message', label: 'Message', control: 'text' }] },
    sampleInputs: { message: 'Imported content' }
  }));
  await click('Templates');
  await click('Add block');
  await setFileForButton('Import JSON', invalidFile);
  await wait(`document.querySelector('.descriptor-validation.invalid')?.textContent.includes('validation') && document.querySelector('.descriptor-preview-empty')?.textContent.includes('Preview unavailable')`, 'invalid descriptor feedback');
  if (!await evaluate(`document.querySelector('.descriptor-modal footer .primary')?.disabled === true`)) throw new Error('Invalid descriptor can be imported.');
  await click('Cancel');
  await setFileForButton('Import JSON', validFile);
  await wait(`document.querySelector('.descriptor-validation.valid')?.textContent.includes('Valid component definition') && document.querySelector('.descriptor-document-preview .document-page')?.textContent.includes('Imported content')`, 'valid component preview');
  await click('Import component');
  await wait(`document.querySelector('.workspace-descriptor-choices')?.textContent.includes('Imported welcome')`, 'versioned workspace descriptor');
  const stored = await evaluate(`window.bulletin.openWorkspace(localStorage.getItem('bulletin-workspace')).then(workspace=>workspace.library.componentDefinitions.find(item=>item.type==='custom:importedWelcome'))`);
  if (stored?.version !== 1 || stored.defaultStyles?.root?.fontWeight !== 'bold') throw new Error(`Imported component was not persisted: ${JSON.stringify(stored)}`);
  await evaluate(`(()=>{const card=Array.from(document.querySelectorAll('.workspace-descriptor-choices .block-choice')).find(element=>element.textContent.includes('custom:importedWelcome')&&element.textContent.includes('v1'));card.querySelectorAll('.text-button')[1].click();return true})()`);
  await wait(`document.querySelector('.descriptor-modal footer .primary')?.textContent.includes('Save new version') && document.querySelector('.descriptor-modal textarea')?.value.includes('"version": 2')`, 'JSON descriptor version editor');
  await evaluate(`(()=>{const area=document.querySelector('.descriptor-modal textarea');const value=JSON.parse(area.value);value.sampleInputs.message='Imported content v2';Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(area,JSON.stringify(value,null,2));area.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  await wait(`document.querySelector('.descriptor-document-preview .document-page')?.textContent.includes('Imported content v2')`, 'edited descriptor preview');
  await click('Save new version');
  await wait(`document.querySelectorAll('.workspace-descriptor-choices .block-choice').length === 2`, 'saved second descriptor version');
  await evaluate(`(()=>{const card=Array.from(document.querySelectorAll('.workspace-descriptor-choices .block-choice')).find(element=>element.textContent.includes('custom:importedWelcome')&&element.textContent.includes('v1'));card.querySelector('.danger-text').click();return true})()`);
  await wait(`document.querySelector('.confirmation-modal')?.textContent.includes('Imported welcome v1')`, 'descriptor delete confirmation');
  await evaluate(`document.querySelector('.confirmation-modal .danger').click()`);
  await wait(`document.querySelectorAll('.workspace-descriptor-choices .block-choice').length === 1 && document.querySelector('.workspace-descriptor-choices')?.textContent.includes('v2')`, 'deleted one descriptor version');
  await evaluate(`(()=>{const card=Array.from(document.querySelectorAll('.workspace-descriptor-choices .block-choice')).find(element=>element.querySelector('b')?.textContent==='Imported welcome');card.querySelector('.secondary').click();return true})()`);
  await wait(`document.querySelector('.builder-preview .document-stack')?.textContent.includes('Imported content v2')`, 'imported descriptor template block');
  pass('validates, previews, versions, edits, deletes, saves, and reuses imported JSON blocks');
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

if (process.env.BULLETIN_TEMPLATE_DELETE_ONLY === '1') {
  await click('Templates');
  await wait(`Boolean(document.querySelector('select[aria-label="Template"]')&&document.querySelector('select[aria-label="Template version"]'))`, 'separate template and version selectors');
  const initialFamilies = await evaluate(`document.querySelector('select[aria-label="Template"]').options.length`);
  const temporaryName = `Temporary Delete Template ${Date.now()}`;
  await click('New template');
  await fill('New template name', temporaryName);
  await click('Create from current');
  await wait(`document.querySelector('select[aria-label="Template"]').options.length===${initialFamilies + 1}&&document.querySelector('select[aria-label="Template"]').selectedOptions[0]?.textContent===${JSON.stringify(temporaryName)}`, 'created template family');
  await click('Publish new version');
  await wait(`document.querySelector('select[aria-label="Template version"]').options.length===2&&document.querySelector('.template-save-status')?.textContent.includes('New version published')`, 'published second template version');
  await evaluate(`Array.from(document.querySelectorAll('.builder-actions button')).find(button=>button.textContent.trim()==='Delete version').click()`);
  await wait(`document.querySelector('.confirmation-modal')?.textContent.includes('Other versions will remain available')`, 'delete version confirmation');
  await evaluate(`document.querySelector('.confirmation-modal .danger').click()`);
  await wait(`document.querySelector('select[aria-label="Template version"]').options.length===1&&document.querySelector('select[aria-label="Template"]').selectedOptions[0]?.textContent===${JSON.stringify(temporaryName)}`, 'deleted selected template version');
  await evaluate(`Array.from(document.querySelectorAll('.builder-actions button')).find(button=>button.textContent.trim()==='Delete template').click()`);
  await wait(`document.querySelector('.confirmation-modal')?.textContent.includes('and all 1 version')`, 'delete template family confirmation');
  await evaluate(`document.querySelector('.confirmation-modal .danger').click()`);
  await wait(`document.querySelector('select[aria-label="Template"]').options.length===${initialFamilies}&&!Array.from(document.querySelector('select[aria-label="Template"]').options).some(option=>option.textContent===${JSON.stringify(temporaryName)})`, 'deleted template family');
  const remaining = await evaluate(`window.bulletin.openWorkspace(localStorage.getItem('bulletin-workspace')).then(workspace=>workspace.templates.filter(record=>record.template.name===${JSON.stringify(temporaryName)}).length)`);
  if (remaining !== 0) throw new Error(`Deleted template records remain in storage: ${remaining}`);
  pass('separates template families from versions and deletes either scope');
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
