const { activeDataset, dataSummaries } = require('./data-context.cjs');
const { importData } = require('./datasets.cjs');
const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, nativeImage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const os = require('node:os');
const { EMBEDDING_MODELS, MODELS, BASE_URL, INVITE_URL, bounded, parseDataset, latexDocument, buildMessages, parseRevision } = require('./core.cjs');
const { officeText } = require('./office.cjs');
const { LocalRAG, embed } = require('./rag.cjs');
const { AttachmentStore, validateAttachmentIds, MAX_BYTES } = require('./attachments.cjs');
const { CodeReferences, CODE_TOOLS } = require('./code-reference.cjs');
const { hasMath, mathDigest, verifyMath } = require('./math-verification.cjs');
const { formalDigest, validateFormal, formalStatus, verifyFormal, setupFormal } = require('./formal-proof.cjs');
const { LANGUAGES } = require('./languages.cjs');
const { ResearchEnvironment } = require('./environment.cjs');
let attachments, codeReferences;
let rag, ragBusy = false;
let mathChecks = {}, mathController, formalChecks = {}, formalFreezes = {}, formalBusy = false;
let environment, quitting = false;
let win, active, config = {}, projects = [], saveQueue = Promise.resolve();
const rendererURL = require('node:url').pathToFileURL(path.join(__dirname, '../src/index.html')).href;
if (!app.requestSingleInstanceLock()) app.quit();
const dataPath = name => path.join(app.getPath('userData'), name);
async function atomic(file, value) { const tmp = `${file}.${randomUUID()}.tmp`; await fs.writeFile(tmp, JSON.stringify(value), { mode: 0o600 }); await fs.rename(tmp, file); }
async function read(file, fallback) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw new Error('本地数据读取失败，请保留数据文件后检查'); } }
function ipc(name, handler) { ipcMain.handle(name, async (event, ...args) => { if (event.sender !== win.webContents || event.senderFrame?.url !== rendererURL || event.senderFrame !== event.sender.mainFrame) throw new Error('IPC 来源无效'); return handler(...args); }); }
async function checkMathematics({projectId,title,content,force=false,allowPlainText=false}) {
  bounded(content,200000,'文稿');bounded(title,500,'标题');requireFormalProof(projectId,content);if(config.mathGate===false)return {status:'disabled',approved:true,reviews:[],notice:'数学联合验证已关闭'};
  const project=projects.find(p=>p.id===projectId);if(!project)throw new Error('项目不存在');const formal=project.formal;const kernelEvidence=formal?formalChecks[formalDigest({statement:formal.statement,proof:formal.proof,mathlib:!!formal.mathlib})]:null;const dataSummary={statistics:dataSummaries(project),formalEvidence:kernelEvidence?.accepted?{statement:kernelEvidence.statement,proof:kernelEvidence.proof,axioms:kernelEvidence.axioms,toolchain:kernelEvidence.toolchain,digest:kernelEvidence.digest}:null};const digest=mathDigest({title,content,dataSummary});
  if(!force&&mathChecks[digest]?.approved)return mathChecks[digest];
  if(mathController)throw new Error('数学联合验证正在进行，请稍候');const apiKey=key();const controller=new AbortController();mathController=controller;
  try{const check=await verifyMath({title,content,dataSummary,apiKey,signal:controller.signal});mathChecks[digest]=check;mathChecks=Object.fromEntries(Object.entries(mathChecks).slice(-100));await atomic(dataPath('math-checks.json'),mathChecks);return check;}finally{if(mathController===controller)mathController=null;}
}
function requireFormalProof(projectId,content){const project=projects.find(p=>p.id===projectId);if(!project)throw new Error('项目不存在');const proof=project.formal;if(!proof?.required&&!/形式化证明|formal(?:ly)? (?:proof|proven|verified)|kernel.checked/i.test(content))return;const freeze=formalFreezes[projectId];if(!proof?.semanticConfirmed||!freeze||freeze.statement!==proof.statement)throw new Error('报告涉及形式化证明：请冻结命题并人工确认语义一致，再完成 Lean 内核验证');const digest=formalDigest({statement:proof.statement,proof:proof.proof,mathlib:!!proof.mathlib});if(!formalChecks[digest]?.accepted)throw new Error('Lean 内核未接受当前冻结命题的证明，不能将其作为已通过的形式化证明写入报告');}
function secureStorageAvailable() { return safeStorage.isEncryptionAvailable() && !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'); }
function key() { if (!config.key) throw new Error('请在设置页保存 ZenMux API Key'); if (!secureStorageAvailable()) throw new Error('系统加密存储不可用'); return safeStorage.decryptString(Buffer.from(config.key, 'base64')); }
function safeURL(value) { const u = new URL(value); if (u.protocol !== 'https:' || u.username || u.password) throw new Error('仅允许 HTTPS 链接'); const allowed = ['zenmux.ai','doi.org','pubmed.ncbi.nlm.nih.gov','europepmc.org','www.ebi.ac.uk','arxiv.org','www.biorxiv.org','www.medrxiv.org']; if (!allowed.includes(u.hostname)) throw new Error('该外部链接不在科研来源白名单中'); return u.href; }
async function requestJSON(url) { const response = await fetch(url, { signal: AbortSignal.timeout(25000), redirect: 'error' }); if (!response.ok) throw new Error(`论文检索服务返回 HTTP ${response.status}`); return response.json(); }
function timeoutProcess(command, args, options = {}, timeout = 60000) { return new Promise((resolve, reject) => { const p = spawn(command, args, { ...options, shell: false, env: { ...process.env, openin_any: 'p', openout_any: 'p' } }); let output = ''; const append = b => { output = (output + b.toString()).slice(-12000); }; p.stdout.on('data', append); p.stderr.on('data', append); const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('运行超时，请检查本地环境')); }, timeout); p.on('error', e => { clearTimeout(timer); reject(e); }); p.on('close', code => { clearTimeout(timer); resolve({ code, output }); }); }); }
async function compiler() { for (const executable of ['/Library/TeX/texbin/xelatex','/usr/local/texlive/2026/bin/universal-darwin/xelatex','xelatex']) { try { const r = await timeoutProcess(executable, ['--version'], {}, 5000); if (r.code === 0) return executable; } catch {} } return null; }
app.whenReady().then(async () => {
  config = await read(dataPath('settings.json'), {}); mathChecks = await read(dataPath('math-checks.json'), {});formalChecks=await read(dataPath('formal-checks.json'),{});formalFreezes=await read(dataPath('formal-freezes.json'),{}); projects = await read(dataPath('projects.json'), []);
  win = new BrowserWindow({ width: 1460, height: 960, minWidth: 1060, minHeight: 740, title: 'Science Workbench', icon: path.join(__dirname, '../assets/icon.png'), titleBarStyle: 'hiddenInset', backgroundColor: '#f5f3ed', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (url !== rendererURL) event.preventDefault(); });
  win.webContents.session.setPermissionRequestHandler((_, __, callback) => callback(false));
  win.webContents.session.setPermissionCheckHandler(() => false);
  win.webContents.session.on('will-download', event => event.preventDefault());
  codeReferences = new CodeReferences(await read(dataPath('code-references.json'), []));
  ipc('add-code-reference', async ({projectId,directory}) => {
    if(!projects.some(p=>p.id===projectId))throw new Error('项目不存在');
    if(!directory){const result=await dialog.showOpenDialog(win,{properties:['openDirectory']});if(result.canceled)return null;directory=result.filePaths[0];}
    if(typeof directory!=='string')throw new Error('目录路径无效');directory=directory.trim().replace(/^['"]|['"]$/g,'');if(directory.startsWith('file://'))directory=require('node:url').fileURLToPath(directory);if(directory==='~'||directory.startsWith('~/'))directory=path.join(os.homedir(),directory.slice(2));
    const reference=await codeReferences.add(directory);await atomic(dataPath('code-references.json'),codeReferences.references);return reference;
  });
  attachments = new AttachmentStore(dataPath('attachments'),nativeImage);
  ipc('attach-files', async remaining => {
    if(!Number.isInteger(remaining)||remaining<1||remaining>6)throw new Error('每条消息最多 6 个附件');
    const result=await dialog.showOpenDialog(win,{properties:['openFile','multiSelections'],filters:[{name:'图像与科研文件',extensions:['png','jpg','jpeg','webp','gif','pdf','docx','xlsx','pptx','doc','xls','ppt','txt','md','csv','json','tex','py','r','yaml','yml','log']}]});
    if(result.canceled)return [];if(result.filePaths.length>remaining)throw new Error(`本次最多还能添加 ${remaining} 个附件`);
    const created=[];try{for(const file of result.filePaths){if((await fs.stat(file)).size>MAX_BYTES)throw new Error('单个附件不能超过 20 MB');created.push(await attachments.create(path.basename(file),await fs.readFile(file)));}return created;}catch(e){await Promise.all(created.map(a=>attachments.remove(a.id)));throw e;}
  });
  ipc('paste-attachment', async ({name,bytes}) => {if(!(bytes instanceof Uint8Array)||bytes.byteLength>MAX_BYTES)throw new Error('剪贴板文件过大或格式无效');return attachments.create(name,bytes);});
  ipc('remove-attachment', async id => {validateAttachmentIds([id]);if(projects.some(p=>[...(p.draftAttachments||[]),...(p.messages||[]).flatMap(m=>m.attachments||[]),...(p.guides||[]).flatMap(g=>g.attachments||[])].some(a=>a.id===id)))return false;await attachments.remove(id);return true;});
  rag = new LocalRAG(dataPath('rag-index'), { baseURL: BASE_URL });
  environment = new ResearchEnvironment(app.getPath('userData'), status => { if (!win.isDestroyed()) win.webContents.send('env-status', status); });
  await environment.initialize();
  ipc('save-notebook', async ({projectId, messageId}) => {
    const project = projects.find(p => p.id === projectId);
    if (!project || !/^[a-zA-Z0-9-]{1,80}$/.test(projectId)) throw new Error('项目不存在');
    const message = project.messages.find(m => m.id === messageId && m.role === 'assistant');
    if (!message) throw new Error('研究回复不存在');
    const blocks = [...message.content.matchAll(/```(?:python|py)\s*\n([\s\S]*?)```/g)].map(m => m[1]);
    const cells = [{cell_type:'markdown',metadata:{},source:['# AI 辅助研究记录\n代码未经执行，请审查后再运行。\n\n'+message.content]},...blocks.map(code => ({cell_type:'code',execution_count:null,metadata:{},outputs:[],source:[code]}))];
    const folder = path.join(app.getPath('userData'),'research-files',projectId); await fs.mkdir(folder,{recursive:true,mode:0o700});
    const file = path.join(folder,`research-${Date.now()}-${randomUUID().slice(0,8)}.ipynb`);
    await fs.writeFile(file,JSON.stringify({cells,metadata:{kernelspec:{display_name:'Python 3',language:'python',name:'python3'}},nbformat:4,nbformat_minor:5},null,2),{mode:0o600});
    return {file,codeCells:blocks.length};
  });
  ipc('env-status', () => environment.status);
  ipc('env-start', projectId => { if (!projects.some(p => p.id === projectId)) throw new Error('项目不存在'); return environment.start(projectId, activeDataset(projects.find(p => p.id === projectId)), projects.find(p => p.id === projectId).datasets); });
  ipc('env-stop', () => environment.stop());
  ipc('env-open', () => { if (environment.status.phase !== 'ready' || !environment.current?.url) throw new Error('环境尚未就绪'); return shell.openExternal(environment.current.url); });
  ipc('formal-status',()=>formalStatus());
  ipc('formal-freeze',async({projectId,statement,unfreeze=false})=>{if(!projects.some(p=>p.id===projectId))throw new Error('项目不存在');if(unfreeze)delete formalFreezes[projectId];else{validateFormal({statement,proof:'by\n  trivial'});formalFreezes[projectId]={statement,frozenAt:new Date().toISOString()};}await atomic(dataPath('formal-freezes.json'),formalFreezes);return formalFreezes[projectId]||null;});
  ipc('formal-setup',async mathlib=>{if(formalBusy)throw new Error('形式化工具任务正在运行');if(typeof mathlib!=='boolean')throw new Error('环境选项无效');formalBusy=true;try{return await setupFormal({mathlib,onOutput:text=>{if(!win.isDestroyed())win.webContents.send('formal-progress',text.slice(-1000));}});}finally{formalBusy=false;}});
  ipc('verify-formal',async projectId=>{if(formalBusy)throw new Error('形式化工具任务正在运行');const proof=projects.find(p=>p.id===projectId)?.formal;const frozen=formalFreezes[projectId];if(!proof||!frozen||proof.statement!==frozen.statement)throw new Error('请先冻结 Lean 命题，候选证明不能修改它');formalBusy=true;try{const check=await verifyFormal({statement:frozen.statement,proof:proof.proof,mathlib:!!proof.mathlib},dataPath('formal-work'));formalChecks[check.digest]=check;await atomic(dataPath('formal-checks.json'),formalChecks);return check;}finally{formalBusy=false;}});
  ipc('verify-math', request=>checkMathematics(request));
  ipc('load', () => ({ projects, settings: { model: config.model || MODELS[0], hasKey: !!config.key, mathGate:config.mathGate!==false, check: config.check || null, encryptionAvailable: secureStorageAvailable(), baseURL: BASE_URL, models: MODELS, languages: LANGUAGES, embeddingModels: EMBEDDING_MODELS, embeddingModel: config.embeddingModel || EMBEDDING_MODELS[0], inviteURL: INVITE_URL } }));
  ipc('save', value => { bounded(JSON.stringify(value), 65_000_000, '项目数据'); if (!Array.isArray(value) || value.length > 100) throw new Error('项目数量无效'); saveQueue = saveQueue.catch(() => {}).then(async () => { await atomic(dataPath('projects.json'), value); projects = value; return true; }); return saveQueue; });
  ipc('settings', async value => { if (!value || !MODELS.includes(value.model)) throw new Error('请选择支持的模型'); if (value.embeddingModel && !EMBEDDING_MODELS.includes(value.embeddingModel)) throw new Error('Embedding 模型无效'); if(value.mathGate!==undefined&&typeof value.mathGate!=='boolean')throw new Error('数学门槛设置无效'); const next = { ...config, mathGate:value.mathGate??config.mathGate??true, model: value.model, embeddingModel: value.embeddingModel || config.embeddingModel || EMBEDDING_MODELS[0] }; if (value.removeKey) { delete next.key; delete next.check; } else if (value.apiKey) { bounded(value.apiKey, 2000, 'API Key'); if (!value.apiKey.trim()) throw new Error('API Key 不能为空白'); if (!secureStorageAvailable()) throw new Error('系统加密存储不可用，不会明文保存密钥'); next.key = safeStorage.encryptString(value.apiKey.trim()).toString('base64'); } if (next.key !== config.key || next.model !== config.model || next.embeddingModel !== config.embeddingModel) delete next.check; await atomic(dataPath('settings.json'), next); config = next; return { hasKey: !!config.key, model: config.model, embeddingModel: config.embeddingModel, mathGate:config.mathGate!==false, check: config.check || null }; });
  ipc('check-api', async () => {
    const apiKey = key(); const checkedKey = config.key; const checkedModel = config.model; const checkedEmbedding = config.embeddingModel; const check = { at: new Date().toISOString(), model: config.model, embeddingModel: config.embeddingModel };
    const attempts = await Promise.allSettled([
      (async () => { const r = await fetch(`${BASE_URL}/chat/completions`, {method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:config.model,messages:[{role:'user',content:'Reply OK.'}],max_tokens:16,stream:false}),signal:AbortSignal.timeout(45000),redirect:'error'});if(!r.ok)throw new Error(`HTTP ${r.status}：${({401:'密钥无效或已失效',402:'余额或付费权限不足',403:'无权访问此模型',404:'模型或接口路径不存在',429:'频率或配额限制'})[r.status] || '请求失败，请检查模型兼容性或服务状态'}`);const data=await r.json();if(!data.choices?.[0]?.message?.content && !data.choices?.[0]?.message?.reasoning_content)throw new Error('未返回有效 completion');return '聊天接口可用'; })(),
      (async () => { const vectors=await embed({baseURL:BASE_URL,apiKey,model:config.embeddingModel||EMBEDDING_MODELS[0],input:['research connection check']});return `Embedding 可用 · ${vectors[0].length} 维`; })()
    ]);
    ['chat','embedding'].forEach((name,i)=>{const r=attempts[i];check[name]={ok:r.status==='fulfilled',message:r.status==='fulfilled'?r.value:String(r.reason.message).replaceAll(apiKey,'[REDACTED]')};});
    if(config.key!==checkedKey||config.model!==checkedModel||config.embeddingModel!==checkedEmbedding)throw new Error('设置已改变，请重新检测当前配置');
    config.check=check;await atomic(dataPath('settings.json'),config);return check;
  });
  ipc('rag-index', async projectId => { if (ragBusy) throw new Error('索引任务正在运行');const project=projects.find(p=>p.id===projectId);if(!project)throw new Error('项目不存在');ragBusy=true;try{return await rag.index(project,{apiKey:key(),model:config.embeddingModel||EMBEDDING_MODELS[0]});}finally{ragBusy=false;} });
  ipc('import-document', async projectId => {
    if(!projects.some(p=>p.id===projectId))throw new Error('项目不存在');const result=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'科研资料',extensions:['pdf','txt','md','csv','json','docx','xlsx','pptx']}]});if(result.canceled)return null;
    const file=result.filePaths[0];if((await fs.stat(file)).size>20_000_000)throw new Error('资料不能超过 20 MB');let content;
    if(path.extname(file).toLowerCase()==='.pdf'){const { PDFParse }=require('pdf-parse');const parser=new PDFParse({data:await fs.readFile(file)});try{content=(await parser.getText()).text;}finally{await parser.destroy();}}else if(['.docx','.xlsx','.pptx'].includes(path.extname(file).toLowerCase()))content=officeText(await fs.readFile(file),path.extname(file).toLowerCase());else content=await fs.readFile(file,'utf8');
    if(!content?.trim())throw new Error('未提取到文本。扫描版 PDF 需要先做 OCR');if(content.length>200000)throw new Error('资料文本超过 20 万字符，请拆分后导入');return {id:`D${randomUUID().slice(0,8)}`,name:path.basename(file),content,importedAt:new Date().toISOString()};
  });
  ipc('paper-fulltext', async ({projectId,paperId}) => {const paper=projects.find(p=>p.id===projectId)?.papers.find(p=>p.id===paperId);if(!paper?.pmcid||!/^PMC\d+$/.test(paper.pmcid))throw new Error('该条目没有可请求的 PMC 全文标识，请自行导入有权使用的 PDF');const response=await fetch(`https://www.ebi.ac.uk/europepmc/webservices/rest/${paper.pmcid}/fullTextXML`,{signal:AbortSignal.timeout(30000),redirect:'error'});if(!response.ok)throw new Error(`开放全文不可用 (HTTP ${response.status})；仍可索引摘要`);const xml=await response.text();const content=xml.replace(/<\/p>|<\/title>|<\/sec>/g,'\n\n').replace(/<[^>]*>/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&#(\d+);/g,(_,n)=>{const code=Number(n);return code<=0x10ffff?String.fromCodePoint(code):'';});if(content.length>200000)throw new Error('全文超过 20 万字符，请拆分后导入');return content;});
  ipc('open-link', url => shell.openExternal(safeURL(bounded(url, 3000))));
  ipc('search', async ({ query, source }) => {
    bounded(query, 1000); if (!query.trim()) throw new Error('请输入检索词');
    if (source === 'crossref') {
      const u = new URL('https://api.crossref.org/works'); u.searchParams.set('query', query); u.searchParams.set('rows', '12');
      const data = await requestJSON(u); return data.message.items.map(p => ({ id: p.DOI, title: p.title?.[0] || 'Untitled', authors: (p.author || []).slice(0, 6).map(a => `${a.given || ''} ${a.family || ''}`.trim()).join(', '), year: p.published?.['date-parts']?.[0]?.[0] || '', doi: p.DOI || '', url: `https://doi.org/${p.DOI}`, abstract: String(p.abstract || '').replace(/<[^>]*>/g, ''), source: 'Crossref' }));
    }
    if (source !== 'europepmc') throw new Error('未知论文来源');
    const u = new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search'); u.searchParams.set('query', query); u.searchParams.set('format', 'json'); u.searchParams.set('resultType', 'core'); u.searchParams.set('pageSize', '12');
    const data = await requestJSON(u); return (data.resultList?.result || []).map(p => ({ id: `${p.source}:${p.id}`, pmcid: p.pmcid || '', title: p.title, authors: p.authorString || '', year: p.pubYear || '', doi: p.doi || '', url: p.doi ? `https://doi.org/${p.doi}` : `https://europepmc.org/article/${encodeURIComponent(p.source)}/${encodeURIComponent(p.id)}`, abstract: String(p.abstractText || '').replace(/<[^>]*>/g, ''), source: 'Europe PMC' }));
  });
  ipc('semantic-search', async ({projectId,query}) => {
    bounded(query,2000); if (!query.trim()) throw new Error('请输入研究问题');
    const project = projects.find(p => p.id === projectId); if (!project) throw new Error('项目不存在');
    const papers = (project.papers || []).slice(0,30); if (!papers.length) throw new Error('请先收藏论文');
    const apiKey = key(); const model = config.embeddingModel || EMBEDDING_MODELS[0];
    try {
      const response = await fetch(`${BASE_URL}/embeddings`,{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model,input:[query,...papers.map(p => `${p.title}\n${p.abstract || ''}`.slice(0,8000))]}),signal:AbortSignal.timeout(60000),redirect:'error'});
      if(!response.ok)throw new Error(`Embedding 返回 HTTP ${response.status}；请核对密钥、模型权限和 OpenAI-compatible embeddings 接口支持。`);
      const payload=await response.json(); const rows=payload.data;
      if(!Array.isArray(rows)||rows.length!==papers.length+1)throw new Error('Embedding 返回的向量数量无效');
      const vectors=new Array(rows.length); for(const row of rows){if(!Number.isInteger(row.index)||row.index<0||row.index>=rows.length||vectors[row.index]||!Array.isArray(row.embedding)||!row.embedding.length||row.embedding.length>20000||!row.embedding.every(Number.isFinite))throw new Error('Embedding 返回格式无效');vectors[row.index]=row.embedding;}
      const queryVector=vectors[0],norm=v=>Math.sqrt(v.reduce((n,x)=>n+x*x,0));if(!queryVector||!norm(queryVector))throw new Error('Embedding 查询向量无效');
      return papers.map((paper,i)=>{const v=vectors[i+1];if(!v||v.length!==queryVector.length||!norm(v))throw new Error('Embedding 维度不一致或零向量');return {id:paper.id,score:v.reduce((sum,x,j)=>sum+x*queryVector[j],0)/(norm(v)*norm(queryVector))};}).sort((a,b)=>b.score-a.score);
    }catch(e){throw new Error(e.message.replaceAll(apiKey,'[REDACTED]'));}
  });
  ipc('generate', async request => {
    if (active) throw new Error('已有研究任务正在生成，请等待或停止');
    if (!MODELS.includes(request.model)) throw new Error('模型无效');
    validateAttachmentIds(request.attachmentIds || []);
    const apiKey = key(); const controller = new AbortController(); active = controller; const timer = setTimeout(() => controller.abort(), 180000);
    try {
      if(request.rag){const stored=projects.find(p=>p.id===request.project.id);if(!stored)throw new Error('项目不存在');const retrieved=await rag.retrieve(stored,request.prompt,{apiKey,model:config.embeddingModel||EMBEDDING_MODELS[0],signal:controller.signal});request.project={...request.project,retrieved};win.webContents.send('rag-evidence',{id:request.id,retrieved});}
      const attachmentContent=await attachments.content(request.attachmentIds || []);
      let remainingHistoryAttachments=6-(request.attachmentIds||[]).length;
      const historyMessages=structuredClone(request.project.messages||[]);historyMessages.forEach(m=>delete m.attachmentContent);
      for(const message of [...historyMessages].reverse()){if(message.role!=='user'||!message.attachments?.length||remainingHistoryAttachments<1)continue;const ids=message.attachments.slice(0,remainingHistoryAttachments).map(a=>a.id);message.attachmentContent=await attachments.content(ids);remainingHistoryAttachments-=ids.length;}
      const storedProject=projects.find(p=>p.id===request.project.id);
      const allowedReferences=(storedProject?.codeReferences||[]).map(r=>r.id).filter(id=>codeReferences.references.some(r=>r.id===id));
      const messages = buildMessages({...request,project:{...request.project,codeReferences:allowedReferences.map(id=>codeReferences.reference(id)),messages:historyMessages},attachmentContent});
      let content='';
      for(let round=0;round<9;round++){
      const roundCalls=new Map();let roundContent='';
      const response = await fetch(`${BASE_URL}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: request.model, messages, stream: true, max_tokens: 7000, ...(allowedReferences.length?{tools:CODE_TOOLS,tool_choice:round===8?'none':'auto'}:{}) }), signal: controller.signal, redirect: 'error' });
      if (!response.ok) throw new Error(`ZenMux 返回 HTTP ${response.status}。请检查余额、密钥、模型权限，以及当前模型对图像/原生文件与工具调用的支持。旧版 Office 文件需要供应商原生文件支持；可改存为 DOCX/XLSX/PPTX 后重试。`);
      const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
      function line(raw) { if (!raw.startsWith('data:')) return; const data = raw.slice(5).trim(); if (!data || data === '[DONE]') return; let event; try { event = JSON.parse(data); } catch { throw new Error('模型返回了无法解析的流式数据'); } if (event.error) throw new Error('模型服务报告错误，请检查模型可用性'); const messageDelta=event.choices?.[0]?.delta;for(const call of messageDelta?.tool_calls||[]){if(!Number.isInteger(call.index)||call.index<0||call.index>10)throw new Error('代码工具调用数量无效');const current=roundCalls.get(call.index)||{id:'',type:'function',function:{name:'',arguments:''}};if(call.id)current.id=call.id;if(call.function?.name)current.function.name+=call.function.name;if(call.function?.arguments)current.function.arguments+=call.function.arguments;if(current.function.arguments.length>20000)throw new Error('工具参数过长');roundCalls.set(call.index,current);} const delta = messageDelta?.content; if (typeof delta === 'string') { content += delta; roundContent+=delta; if (content.length > 300000) throw new Error('输出超过长度上限'); win.webContents.send('ai-chunk', { id: request.id, delta }); } }
      while (true) { const { value, done } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); if (buffer.length > 1_000_000) throw new Error('模型响应帧过大'); let i; while ((i = buffer.indexOf('\n')) !== -1) { line(buffer.slice(0, i).replace(/\r$/, '')); buffer = buffer.slice(i + 1); } }
      buffer += decoder.decode(); if (buffer.trim()) line(buffer.replace(/\r$/, ''));
      if(roundCalls.size){
        const calls=[...roundCalls.values()];messages.push({role:'assistant',content:roundContent||null,tool_calls:calls});
        for(const call of calls){if(controller.signal.aborted)throw new Error('任务已停止');let result;try{result=await codeReferences.invoke(call.function.name,JSON.parse(call.function.arguments),allowedReferences);}catch(e){result={error:e.message};}messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result)});win.webContents.send('code-evidence',{id:request.id,tool:call.function.name,result});}
        continue;
      }
      if (!content) throw new Error('模型未返回文本内容'); if(request.mode==='revision')parseRevision(content); return content;
      }
      throw new Error('本轮代码参考读取已到上限，请分阶段继续研究');
    } catch (e) { if (controller.signal.aborted) throw new Error('任务已停止或超过 3 分钟时限；当前输出尚未完成'); throw new Error(e.message.replaceAll(apiKey, '[REDACTED]')); }
    finally { clearTimeout(timer); if (active === controller) active = null; }
  });
  ipc('cancel', () => { active?.abort(); mathController?.abort(); return true; });
  ipc('import-csv', async ({projectId, directory=false}={}) => {
    const project=projects.find(p=>p.id===projectId);if(!project)throw new Error('项目不存在');
    const result=await dialog.showOpenDialog(win,{properties:directory?['openDirectory']:['openFile','multiSelections'],filters:[{name:'科研数据 CSV / Excel',extensions:['csv','xlsx']}]});
    if(result.canceled)return null;
    return importData(result.filePaths,project.datasets|| (project.dataset?[project.dataset]:[]));
  });
  ipc('environment', async () => {
    const result = await dialog.showOpenDialog(win, { title: '选择科研计算环境的导出目录', properties: ['openDirectory', 'createDirectory'] }); if (result.canceled) return null;
    const folder = path.join(result.filePaths[0], `science-environment-${Date.now()}`); await fs.mkdir(folder, { mode: 0o700 });
    const files = {
      'requirements.txt': 'numpy==2.2.6\npandas==2.2.3\nmatplotlib==3.10.3\nscipy==1.15.3\njupyterlab==4.6.4\n',
      'Dockerfile': 'FROM python:3.11-slim\nWORKDIR /research\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nRUN useradd -m scientist && chown scientist /research\nUSER scientist\nEXPOSE 8888\nCMD ["jupyter", "lab", "--ip=0.0.0.0", "--no-browser"]\n',
      'README.md': '# 科研计算环境\n\n此目录仅包含环境配置，尚未安装依赖或运行实验。需 Python 3.11。\n\n## 本地\n```sh\npython3.11 -m venv .venv\nsource .venv/bin/activate\npython -m pip install -r requirements.txt\npython -m jupyter lab\n```\n\n## Docker\n```sh\ndocker build -t science-notebook .\ndocker run --rm -p 127.0.0.1:8888:8888 --cap-drop=ALL --security-opt=no-new-privileges science-notebook\n```\n\n保留 Jupyter 的默认 token 登录。环境构建需要网络；固定版本不保证无漏洞或长期可用。只执行审查过的代码。\n',
      'research.ipynb': JSON.stringify({ cells: [{ cell_type: 'markdown', metadata: {}, source: ['# 可复现研究记录\n', '记录问题、假说、数据来源、对照与统计计划。下方为待执行环境自检，不是实验结果。'] }, { cell_type: 'code', execution_count: null, metadata: {}, outputs: [], source: ['import sys\n', 'import numpy as np\n', 'import pandas as pd\n', 'import matplotlib.pyplot as plt\n', 'print(sys.version)\n'] }], metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' } }, nbformat: 4, nbformat_minor: 5 }, null, 2)
    };
    for (const [name, value] of Object.entries(files)) await fs.writeFile(path.join(folder, name), value, { mode: 0o600 });
    return { folder, files: Object.keys(files) };
  });
  ipc('export', async request => {
    if (!['markdown','latex','pdf'].includes(request.kind)) throw new Error('导出类型无效');
    bounded(JSON.stringify(request), 500000, '导出内容');
    const title = bounded(request.title, 500); const content = bounded(request.content, 200000);const mathCheck=await checkMathematics({projectId:request.projectId,title,content,allowPlainText:true});win.webContents.send('math-status',mathCheck);if(!mathCheck.approved)throw new Error('数学联合验证未通过，报告导出已阻止。请查看两模型意见并修改后重新验证。'); const extension = request.kind === 'markdown' ? 'md' : request.kind === 'pdf' ? 'pdf' : 'tex';
    const result = await dialog.showSaveDialog(win, { defaultPath: `${title.replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 60) || 'research'}.${extension}`, filters: [{ name: extension.toUpperCase(), extensions: [extension] }] }); if (result.canceled) return null;
    if (request.kind === 'markdown') { const refs = (request.papers || []).map((p, i) => `[${p.citationId || `P${i + 1}` }] ${p.title}. ${p.authors}. ${p.year}. ${p.doi ? `https://doi.org/${p.doi}` : p.url}`).join('\n\n'); await fs.writeFile(result.filePath, `# ${title}\n\n> AI 辅助研究草稿，需作者核验。\n\n${content}\n\n## References / 参考文献\n\n${refs}\n\n${(request.documents || []).map(d => `[${d.id}] 本地导入资料：${d.name}`).join('\n\n')}`, { mode: 0o600 }); return { file: result.filePath }; }
    const tex = latexDocument(request);
    if (request.kind === 'latex') { await fs.writeFile(result.filePath, tex, { mode: 0o600 }); return { file: result.filePath }; }
    const engine = await compiler(); if (!engine) throw new Error('未找到 XeLaTeX。请先导出 .tex，再安装 MacTeX / TeX Live（需 xeCJK、pgfplots）。');
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'science-paper-'));
    try { await fs.writeFile(path.join(folder, 'paper.tex'), tex); for (let i = 0; i < 2; i++) { const r = await timeoutProcess(engine, ['-no-shell-escape','-interaction=nonstopmode','-halt-on-error','paper.tex'], { cwd: folder }); if (r.code !== 0) throw new Error(`LaTeX 编译失败。请导出 .tex 检查字体与 TeX 组件。\n${r.output.slice(-2000)}`); } await fs.copyFile(path.join(folder, 'paper.pdf'), result.filePath); await fs.writeFile(result.filePath.replace(/\.pdf$/i, '') + '.tex', tex, { mode: 0o600 }); return { file: result.filePath }; }
    finally { await fs.rm(folder, { recursive: true, force: true }); }
  });
  await win.loadFile(path.join(__dirname, '../src/index.html'));
});
app.on('web-contents-created', (_, contents) => { contents.on('will-attach-webview', event => event.preventDefault()); });
app.on('before-quit', event => { active?.abort();mathController?.abort(); if (environment?.current && !quitting) { event.preventDefault(); environment.stop().then(() => { quitting = true; app.quit(); }).catch(() => { quitting = true; app.quit(); }); } });
app.on('window-all-closed', () => app.quit());
