import { Marked } from '../node_modules/marked/lib/marked.esm.js';
import katex from '../node_modules/katex/dist/katex.mjs';

function escaped(text) { return text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function httpsURL(value) { try { const url=new URL(value.replace(/\\([_%&#{}])/g,'$1'));return url.protocol==='https:'&&!url.username&&!url.password?url.href:null; } catch { return null; } }
function group(src,start) { if(src[start]!=='{')return null;let depth=1;for(let i=start+1;i<src.length;i++){if(src[i]==='\\'){i++;continue;}if(src[i]==='{')depth++;if(src[i]==='}'&&!--depth)return{value:src.slice(start+1,i),end:i+1};}return null; }
function linkToken(src) {
  const command=src.startsWith('\\href{')?'href':src.startsWith('\\url{')?'url':null;if(!command)return;
  const address=group(src,command.length+1),label=address&&(command==='url'?address:group(src,address.end));
  if(!address||!label)return{type:'texLink',raw:src,pending:true};
  return{type:'texLink',raw:src.slice(0,label.end),label:label.value.replace(/\\([{}%_&#$])/g,'$1'),url:httpsURL(address.value)};
}
function mathToken(src, block) {
  const delimiters=block?[['$$','$$',true],['\\[','\\]',true]]:[['$$','$$',true],['\\[','\\]',true],['\\(','\\)',false],['$','$',false]];
  for(const[left,right,display]of delimiters){
    if(!src.startsWith(left))continue;
    if(left==='$'&&(/^\s/.test(src.slice(1))||src.startsWith('$$')))return;
    for(let end=left.length;(end=src.indexOf(right,end))!==-1;end+=right.length){
      let slashes=0;for(let i=end-1;i>=0&&src[i]==='\\';i--)slashes++;
      if(slashes%2)continue;
      if(left==='$'&&(/\s/.test(src[end-1])||/\d/.test(src[end+1]||'')||src.slice(1,end).includes('\n')))continue;
      return {type:block?'mathBlock':'mathInline',raw:src.slice(0,end+right.length),tex:src.slice(left.length,end),display};
    }
    // An unfinished streamed formula stays readable until its closing delimiter arrives.
    return {type:block?'mathBlock':'mathInline',raw:src,tex:null,display};
  }
}
export function renderMarkdown(el,text) {
  const formulas=[],prefix=crypto.randomUUID();
  const renderer=token=>{if(token.tex===null)return `<${token.display?'pre':'span'} class="math-pending">${escaped(token.raw)}</${token.display?'pre':'span'}>`;const index=formulas.push(token)-1;return `<${token.display?'div':'span'} data-formula="${prefix}-${index}"></${token.display?'div':'span'}>`;};
  const parser=new Marked({extensions:[{name:'mathBlock',level:'block',start:src=>src.search(/\$\$|\\\[/),tokenizer:src=>mathToken(src,true),renderer},{name:'mathInline',level:'inline',start:src=>src.search(/\$|\\\(|\\\[/),tokenizer:src=>mathToken(src,false),renderer},{name:'texLink',level:'inline',start:src=>src.search(/\\(?:href|url)\{/),tokenizer:linkToken,renderer:token=>token.pending?'<span class="math-pending">正在生成链接…</span>':token.url?`<a href="${escaped(token.url)}">${escaped(token.label)}</a>`:`${escaped(token.label)}<span class="math-error">（链接已拦截：仅支持 HTTPS）</span>`}]});
  el.innerHTML=DOMPurify.sanitize(parser.parse(text||''),{FORBID_TAGS:['img','svg','math','style','iframe','form','input','button'],FORBID_ATTR:['style']});
  formulas.forEach((formula,index)=>{
    const slot=el.querySelector(`[data-formula="${prefix}-${index}"]`);if(!slot)return;
    let blocked=false;try{if(formula.tex.length>8000)throw Error('Formula too long');katex.render(formula.tex,slot,{displayMode:formula.display,throwOnError:true,trust:context=>{if(['\\href','\\url'].includes(context.command)&&httpsURL(context.url))return true;blocked=true;throw Error('Untrusted TeX command');},strict:'warn',maxExpand:1000,maxSize:20,macros:{},output:'htmlAndMathml'});}
    catch{slot.replaceChildren();const code=document.createElement('code');code.className='math-error';code.textContent=blocked?'[已拦截不安全链接或 HTML 指令]':formula.raw;code.title='公式暂无法渲染，已保留原始内容。';slot.append(code);}
  });
}
