const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const hash = text => createHash('sha256').update(text).digest('hex');
function chunksFor(project) {
  const sources = [...(project.papers || []).slice(0,60).map((p,i)=>({id:p.citationId||`P${i+1}`,title:p.title,url:p.url,content:`${p.title}\n${p.authors || ''}\n${p.fullText || p.abstract || ''}`})),...(project.documents || []).map(d=>({id:d.id,title:d.name,content:d.content,url:null}))];
  if(project.notes?.trim())sources.push({id:'NOTES',title:'研究者笔记（未经外部核验）',content:project.notes,url:null});
  const chunks=[];
  for(const source of sources){const text=source.content.replace(/\r\n/g,'\n');for(let start=0,index=1;start<text.length;start+=1000,index++){const content=text.slice(start,start+1200);chunks.push({id:`${source.id}:C${index}`,sourceId:source.id,title:source.title,url:source.url,start,end:Math.min(start+1200,text.length),content,hash:hash(content)});if(chunks.length>300)throw new Error('资料超过 300 个片段，请减少资料后重新索引');if(start+1200>=text.length)break;}}
  return chunks;
}
function validateVectors(data,count) {
  if(!Array.isArray(data)||data.length!==count)throw new Error('Embedding 返回数量无效');
  const vectors=new Array(count);
  for(const row of data){if(!Number.isInteger(row.index)||row.index<0||row.index>=count||vectors[row.index]||!Array.isArray(row.embedding)||!row.embedding.length||row.embedding.length>20000||!row.embedding.every(Number.isFinite)||!row.embedding.some(v=>v!==0))throw new Error('Embedding 返回向量格式无效');vectors[row.index]=row.embedding;}
  if(vectors.some(v=>v.length!==vectors[0].length))throw new Error('Embedding 维度不一致');return vectors;
}
function cosine(a,b){if(a.length!==b.length)throw new Error('Embedding 维度不一致，请重新建立索引');const dot=a.reduce((n,x,i)=>n+x*b[i],0),na=Math.sqrt(a.reduce((n,x)=>n+x*x,0)),nb=Math.sqrt(b.reduce((n,x)=>n+x*x,0));return dot/(na*nb);}
async function embed(options){
  const {fetch:fetcher=fetch,baseURL,apiKey,model,input,signal}=options;
  async function request(values, single=false){
    try{
      const r=await fetcher(`${baseURL}/embeddings`,{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model,input:single?values[0]:values,encoding_format:'float'}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000),redirect:'error'});
      if(!r.ok)throw new Error(`Embedding HTTP ${r.status}：请在设置检测 Key 与 Embedding 模型权限`);
      const body=await r.json();
      if(body.error)throw new Error(`Embedding 接口错误：${String(body.error.message||body.error.code||'未知错误').slice(0,400)}`);
      if(Array.isArray(body.data)&&body.data.length!==values.length&&values.length>1)return null;
      if(!Array.isArray(body.data)&&values.length>1)return null;
      if(!Array.isArray(body.data))throw new Error('Embedding 响应缺少 data 向量列表；请在设置切换 Embedding 模型并检测可用性');
      return validateVectors(body.data.map(row=>single&&row.index===undefined?{...row,index:0}:row),values.length);
    }catch(e){throw new Error(String(e.message).replaceAll(apiKey,'[REDACTED]'));}
  }
  // Some upstream providers return only one vector for a batch. Never assign
  // that vector to every chunk: retry each text separately and validate it.
  if(model.startsWith('google/')){
    const vectors=[];for(const text of input)vectors.push(...await request([text],true));return vectors;
  }
  const vectors=await request(input);if(vectors)return vectors;
  const singles=[];for(const text of input)singles.push(...await request([text],true));return singles;
}
class LocalRAG {
  constructor(folder,options){this.folder=folder;this.options=options;}
  file(projectId){if(!/^[\w-]{1,80}$/.test(projectId))throw new Error('项目 ID 无效');return path.join(this.folder,`${projectId}.json`);}
  async read(projectId){try{return JSON.parse(await fs.readFile(this.file(projectId),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw new Error('本地索引读取失败，请重建索引');}}
  async index(project,credentials,onProgress=()=>{}){const chunks=chunksFor(project);if(!chunks.length)throw new Error('请先收藏论文、添加笔记或导入资料');const options={...this.options,...credentials};const old=await this.read(project.id);const previous=new Map(old?.model===options.model?old.chunks.map(c=>[c.hash,c.vector]):[]);let downloaded=0;onProgress({completed:0,total:chunks.length});const missing=chunks.filter(c=>!previous.has(c.hash));for(let i=0;i<missing.length;i+=16){const batch=missing.slice(i,i+16);const vectors=await embed({...options,input:batch.map(c=>c.content)});batch.forEach((c,j)=>previous.set(c.hash,vectors[j]));downloaded+=batch.length;onProgress({completed:chunks.length-missing.length+downloaded,total:chunks.length});}const result={model:options.model,createdAt:new Date().toISOString(),fingerprint:hash(JSON.stringify(chunks.map(c=>[c.id,c.hash]))),chunks:chunks.map(c=>({...c,vector:previous.get(c.hash)}))};await fs.mkdir(this.folder,{recursive:true,mode:0o700});const file=this.file(project.id),tmp=`${file}.tmp`;await fs.writeFile(tmp,JSON.stringify(result),{mode:0o600});await fs.rename(tmp,file);return {count:chunks.length,embedded:downloaded,model:result.model,createdAt:result.createdAt};}
  async prune(project){
    const index=await this.read(project.id);if(!index)return null;
    const chunks=chunksFor(project),current=new Map(chunks.map(c=>[c.id,c.hash]));
    index.chunks=index.chunks.filter(c=>current.get(c.id)===c.hash);
    if(!index.chunks.length){await fs.rm(this.file(project.id),{force:true});return null;}
    const complete=index.chunks.length===chunks.length;
    if(complete)index.fingerprint=hash(JSON.stringify(chunks.map(c=>[c.id,c.hash])));
    const file=this.file(project.id),tmp=`${file}.tmp`;await fs.writeFile(tmp,JSON.stringify(index),{mode:0o600});await fs.rename(tmp,file);
    return complete?{count:index.chunks.length,embedded:0,model:index.model,createdAt:index.createdAt}:null;
  }
  async retrieve(project,query,credentials){const index=await this.read(project.id);if(!index)throw new Error('尚未建立 RAG 索引，请在“论文与证据”中建立索引');if(index.model!==credentials.model)throw new Error('Embedding 模型已更改，请重建 RAG 索引');const chunks=chunksFor(project);if(index.fingerprint!==hash(JSON.stringify(chunks.map(c=>[c.id,c.hash]))))throw new Error('项目资料已变化，请更新 RAG 索引');const [vector]=await embed({...this.options,...credentials,input:[query]});const focus=project.papers?.find(p=>p.id===project.focusPaperId)?.citationId;return index.chunks.filter(c=>!focus||c.sourceId===focus).map(c=>({id:c.id,sourceId:c.sourceId,title:c.title,url:c.url,start:c.start,end:c.end,content:c.content,score:cosine(vector,c.vector)})).sort((a,b)=>b.score-a.score).slice(0,6);}
}
module.exports={LocalRAG,chunksFor,cosine,validateVectors,embed};
