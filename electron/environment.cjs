const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const net = require('node:net');
const { execFile } = require('node:child_process');
const inspectProcess = require('node:util').promisify(execFile);
const REQUIREMENTS = 'numpy==2.2.6\npandas==2.2.3\nmatplotlib==3.10.3\nscipy==1.15.3\njupyterlab==4.6.4\n';
class ResearchEnvironment {
  constructor(base, emit) { this.base = base; this.emit = emit; this.current = null; this.status = { phase: 'idle', message: '尚未创建托管环境' }; }
  update(phase,message,extra={}) { this.status = { phase,message,projectId:this.current?.projectId,...extra }; this.emit(this.status); }
  async initialize() { const root=path.join(this.base,'environments');await fs.mkdir(root,{recursive:true,mode:0o700});for(const entry of await fs.readdir(root))if(/^env-[\w-]+$/.test(entry)){const folder=path.join(root,entry);try{const record=JSON.parse(await fs.readFile(path.join(folder,'runtime.json'),'utf8'));if(Number.isInteger(record.pid)&&record.pid>1){const {stdout}=await inspectProcess('/bin/ps',['-p',String(record.pid),'-o','command='],{timeout:3000});if(stdout.includes(path.join(folder,'bin','python'))&&stdout.includes('jupyter')){try{process.kill(-record.pid,'SIGTERM');}catch{}await new Promise(r=>setTimeout(r,500));try{const check=await inspectProcess('/bin/ps',['-p',String(record.pid),'-o','command='],{timeout:3000});if(check.stdout.includes(path.join(folder,'bin','python')))process.kill(-record.pid,'SIGKILL');}catch{}}}}catch{}await fs.rm(folder,{recursive:true,force:true});} }
  process(command,args,options={}) {
    const state=this.current;
    return new Promise((resolve,reject)=>{
      if(state.stopped)return reject(new Error('环境准备已取消'));
      const p=spawn(command,args,{cwd:options.cwd,detached:true,shell:false,env:{HOME:process.env.HOME,PATH:'/opt/homebrew/bin:/usr/bin:/bin',TMPDIR:process.env.TMPDIR||'/tmp',LANG:'en_US.UTF-8',PYTHONNOUSERSITE:'1',PIP_DISABLE_PIP_VERSION_CHECK:'1'}});
      state.child=p;let output='';let timer;
      const append=data=>{output=(output+data.toString()).slice(-5000);if(options.server)state.serverLog=output;};p.stdout.on('data',append);p.stderr.on('data',append);
      if(!options.server)timer=setTimeout(()=>{try{process.kill(-p.pid,'SIGKILL');}catch{}},300000);
      p.on('error',e=>{clearTimeout(timer);if(state.child===p)state.child=null;reject(e);});
      p.on('close',code=>{clearTimeout(timer);if(state.child===p)state.child=null;if(options.server){if(!state.stopped)this.update('error','Jupyter 已退出，请回收环境后重试');return;}if(state.stopped)return reject(new Error('环境准备已取消'));if(code!==0)return reject(new Error(`环境命令失败 (${code})：${output.slice(-1500)}`));resolve(output);});
      if(options.server)resolve(p);
    });
  }
  async start(projectId, dataset, dataFiles = []) {
    if(this.current)throw new Error('请先回收当前托管环境');
    if(typeof projectId!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(projectId))throw new Error('项目标识无效');
    const folder=await fs.mkdtemp(path.join(this.base,'environments','env-'));
    const state={projectId,folder,stopped:false,child:null};this.current=state;
    const job=(async()=>{
      try {
        this.update('creating','正在创建项目专属 Python 3.11 虚拟环境…');
        let python;
        for(const candidate of ['/opt/homebrew/bin/python3.11','/usr/local/bin/python3.11','python3.11']){try{await this.process(candidate,['--version']);python=candidate;break;}catch(e){if(state.stopped)throw e;}}
        if(!python)throw new Error('未找到 Python 3.11，请安装 Python 3.11 后重试');
        await this.process(python,['-m','venv',folder]);
        await fs.writeFile(path.join(folder,'requirements.txt'),REQUIREMENTS,{mode:0o600});
        const executable=path.join(folder,'bin','python');
        this.update('installing','正在安装固定版本科研依赖，首次启动需要下载，最长约 5 分钟…');
        await this.process(executable,['-m','pip','install','--requirement',path.join(folder,'requirements.txt')]);
        const workspace=path.join(this.base,'research-files',projectId);await fs.mkdir(workspace,{recursive:true,mode:0o700});
        try{await fs.writeFile(path.join(workspace,'README.md'),'# 科研文件\n\n此目录在环境回收后保留。Notebook 请保存到这里。实验结果需注明数据与方法。\n',{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
        if (dataset?.rows && dataset?.columns) {
          const quote = value => '"' + String(value ?? '').replaceAll('"','""') + '"';
          const csv = [dataset.columns.map(quote).join(','), ...dataset.rows.map(row => dataset.columns.map(column => quote(row[column])).join(','))].join('\n');
          await fs.writeFile(path.join(workspace,'dataset.csv'), csv, { mode: 0o600 });
        }
        const manifest=[];
        for(const [fileIndex,file] of dataFiles.entries())for(const [sheetIndex,sheet] of file.sheets.entries()){
          const relative=`data/file-${fileIndex+1}/sheet-${sheetIndex+1}.csv`;
          await fs.mkdir(path.dirname(path.join(workspace,relative)),{recursive:true,mode:0o700});
          const quote=value=>'"'+String(value??'').replaceAll('"','""')+'"';
          await fs.writeFile(path.join(workspace,relative),[sheet.columns,...sheet.rows.map(row=>sheet.columns.map(c=>row[c]))].map(row=>row.map(quote).join(',')).join('\n'),{mode:0o600});
          manifest.push({name:file.name,sheet:sheet.sheetName,path:relative});
        }
        await fs.writeFile(path.join(workspace,'datasets.json'),JSON.stringify(manifest,null,2),{mode:0o600});
        const notebook = { cells: [{cell_type:'markdown',metadata:{},source:['# 科研计算记录\n记录数据来源、假说、对照、运行环境和统计计划。代码需要研究者审查后执行。']},{cell_type:'code',metadata:{},execution_count:null,outputs:[],source:[dataFiles.length ? "import json\nimport pandas as pd\nwith open('datasets.json') as f: sources = json.load(f)\ntables = {(s['name'], s['sheet']): pd.read_csv(s['path']) for s in sources}\n{k: v.describe() for k, v in tables.items()}" : dataset ? "import pandas as pd\ndata = pd.read_csv('dataset.csv')\ndata.describe()" : "import sys\nimport numpy as np\nimport pandas as pd\nimport matplotlib.pyplot as plt\nprint(sys.version)"]}],metadata:{kernelspec:{display_name:'Python 3',language:'python',name:'python3'}},nbformat:4,nbformat_minor:5};
        try { await fs.writeFile(path.join(workspace,'research.ipynb'),JSON.stringify(notebook,null,2),{flag:'wx',mode:0o600}); } catch(e) { if(e.code!=='EEXIST') throw e; }
        const port=await new Promise((resolve,reject)=>{const server=net.createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
        const token=randomBytes(32).toString('hex');state.token=token;state.url=`http://127.0.0.1:${port}/lab?token=${token}`;
        const jupyterConfig=path.join(folder,'jupyter.json');await fs.writeFile(jupyterConfig,JSON.stringify({IdentityProvider:{token},ServerApp:{ip:'127.0.0.1',port,port_retries:0,open_browser:false,root_dir:workspace,allow_remote_access:false}}),{mode:0o600});
        this.update('starting','正在启动本地 Jupyter…',{workspace});await this.process(executable,['-m','jupyterlab',`--config=${jupyterConfig}`],{cwd:workspace,server:true});await fs.writeFile(path.join(folder,'runtime.json'),JSON.stringify({pid:state.child.pid}),{mode:0o600});
        for(let i=0;i<240;i++){
          if(state.stopped)throw new Error('已取消启动');
          try{const response=await fetch(`http://127.0.0.1:${port}/api/status`,{headers:{Authorization:`token ${token}`},signal:AbortSignal.timeout(1000)});if(response.ok){this.update('ready','Jupyter 已启动。断开且空闲 15 分钟后自动回收；研究文件保留。',{workspace});
          const readyAt=Date.now();state.idleTimer=setInterval(async()=>{if(state.stopped||this.current!==state)return;try{const r=await fetch(`http://127.0.0.1:${port}/api/status`,{headers:{Authorization:`token ${token}`},signal:AbortSignal.timeout(3000)});const health=await r.json();const k=await fetch(`http://127.0.0.1:${port}/api/kernels`,{headers:{Authorization:`token ${token}`},signal:AbortSignal.timeout(3000)});const kernels=await k.json();const latest=Math.max(readyAt,Date.parse(health.last_activity)||0,...kernels.map(k=>Date.parse(k.last_activity)||0));if(health.connections===0&&kernels.every(k=>k.execution_state==='idle')&&Date.now()-latest>15*60000)await this.stop();}catch{}},60000);state.idleTimer.unref();return this.status;}}catch{}
          await new Promise(resolve=>setTimeout(resolve,250));
        }
        throw new Error('Jupyter 未能就绪，请检查端口和依赖。'+(state.serverLog||'').replaceAll(state.token,'[REDACTED]').replace(/token=[^\s&]+/g,'token=[REDACTED]').slice(-1800));
      }catch(e){if(!state.stopped)this.update('error',e.message);await this.clean(state);throw e;}
    })();state.job=job;return job;
  }
  async kill(state) {
    const child=state.child;if(!child?.pid)return;
    await new Promise(resolve=>{let settled=false;let timer;const done=()=>{if(settled)return;settled=true;clearTimeout(timer);resolve();};child.once('close',done);try{process.kill(-child.pid,'SIGTERM');}catch{done();return;}timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}done();},2000);});
  }
  async clean(state) {clearInterval(state.idleTimer);await this.kill(state);await fs.rm(state.folder,{recursive:true,force:true});if(this.current===state)this.current=null;}
  async stop() {const state=this.current;if(!state)return this.status;state.stopped=true;this.update('stopping','正在关闭计算进程并回收临时环境…');await this.kill(state);await state.job?.catch(()=>{});await this.clean(state);this.update('idle','已回收虚拟环境；研究文件与 Notebook 保留。');return this.status;}
}
module.exports={ResearchEnvironment,REQUIREMENTS};
