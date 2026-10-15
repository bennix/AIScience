const { unzipSync, strFromU8 } = require('fflate');
const { XMLParser, XMLValidator } = require('fast-xml-parser');
const path = require('node:path');
const parser = new XMLParser({ignoreAttributes:false,removeNSPrefix:true,parseTagValue:false,processEntities:false});
function xml(value){const text=strFromU8(value);if(/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('Office XML 不允许包含 DTD 或自定义实体');if(XMLValidator.validate(text)!==true)throw new Error('Office XML 格式无效');return parser.parse(text);}
const array=value=>value===undefined?[]:Array.isArray(value)?value:[value];
function texts(value){if(value===null||value===undefined)return '';if(typeof value!=='object')return String(value);const result=[];for(const [key,item]of Object.entries(value)){if(key==='t'||key==='#text')result.push(...array(item).map(v=>typeof v==='object'?texts(v):String(v)));else if(!key.startsWith('@_'))for(const child of array(item))if(typeof child==='object')result.push(texts(child));}return result.filter(Boolean).join(' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'");}
function paragraphs(value){if(!value||typeof value!=='object')return [];const result=[];for(const [key,item]of Object.entries(value)){if(key==='p')result.push(...array(item).map(texts));else if(!key.startsWith('@_'))for(const child of array(item))result.push(...paragraphs(child));}return result;}
function officeEntries(buffer){let total=0,count=0;const entries=unzipSync(new Uint8Array(buffer),{filter:entry=>{if(++count>3000)throw new Error('Office 压缩条目过多');const needed=/^(?:word\/(?:document|footnotes|endnotes|header\d*|footer\d*)\.xml|ppt\/slides\/slide\d+\.xml|xl\/(?:sharedStrings|workbook)\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/worksheets\/[^/]+\.xml)$/.test(entry.name);if(!needed)return false;total+=entry.originalSize;if(entry.originalSize>20000000||total>60000000)throw new Error('Office 解压内容过大，请拆分文件');return true;}});return entries;}
function officeText(buffer,extension){const entries=officeEntries(buffer);let output=[];
  if(extension==='.docx'){if(!entries['word/document.xml'])throw new Error('不是有效的 Word 文档');for(const name of Object.keys(entries).filter(n=>n.startsWith('word/')).sort((a,b)=>(a==='word/document.xml'?-1:b==='word/document.xml'?1:a.localeCompare(b))))output.push(...paragraphs(xml(entries[name])));}
  else if(extension==='.pptx'){for(const name of Object.keys(entries).filter(n=>n.startsWith('ppt/slides/')).sort((a,b)=>Number(a.match(/slide(\d+)/)[1])-Number(b.match(/slide(\d+)/)[1])))output.push(`## Slide ${name.match(/slide(\d+)/)[1]}`, ...paragraphs(xml(entries[name])));}
  else if(extension==='.xlsx'){const strings=entries['xl/sharedStrings.xml']?array(xml(entries['xl/sharedStrings.xml']).sst?.si).map(texts):[];let sheets=[];if(entries['xl/workbook.xml']&&entries['xl/_rels/workbook.xml.rels']){const relations=new Map(array(xml(entries['xl/_rels/workbook.xml.rels']).Relationships?.Relationship).filter(r=>r['@_TargetMode']!=='External').map(r=>[r['@_Id'],path.posix.normalize(path.posix.join('xl',r['@_Target']||''))]));sheets=array(xml(entries['xl/workbook.xml']).workbook?.sheets?.sheet).map(s=>({name:s['@_name'],file:relations.get(s['@_id'])}));}if(!sheets.length)sheets=Object.keys(entries).filter(n=>n.startsWith('xl/worksheets/')).sort().map(file=>({name:file,file}));for(const sheet of sheets){if(!entries[sheet.file])continue;output.push(`## Sheet: ${sheet.name}`);const rows=array(xml(entries[sheet.file]).worksheet?.sheetData?.row);for(const row of rows){const cells=array(row.c).map(cell=>{let value=cell['@_t']==='s'?(strings[Number(cell.v)]||''):cell['@_t']==='inlineStr'?texts(cell.is):String(cell.v??'');if(cell.f!==undefined)value+=` [formula: ${typeof cell.f==='object'?cell.f['#text']||'':cell.f}; stored value only]`;return `${cell['@_r']||''}=${value}`;});output.push(cells.join('\t'));}}}
  else throw new Error('不支持的 Office 格式');const result=output.filter(Boolean).join('\n');if(!result.trim())throw new Error('Office 文档没有可提取文本或单元格');return result;
}
function excelTables(buffer) {
  const entries = officeEntries(buffer);
  const strings = entries['xl/sharedStrings.xml'] ? array(xml(entries['xl/sharedStrings.xml']).sst?.si).map(texts) : [];
  if (!entries['xl/workbook.xml'] || !entries['xl/_rels/workbook.xml.rels']) throw new Error('Excel 工作簿无效');
  const relations = new Map(array(xml(entries['xl/_rels/workbook.xml.rels']).Relationships?.Relationship).filter(r=>r['@_TargetMode']!=='External').map(r=>[r['@_Id'],path.posix.normalize(r['@_Target']?.startsWith('/')?r['@_Target'].slice(1):path.posix.join('xl',r['@_Target']||''))]));
  const sheets = [];
  for (const sheet of array(xml(entries['xl/workbook.xml']).workbook?.sheets?.sheet)) {
    const name=sheet['@_name'], file=relations.get(sheet['@_id']);
    if (!file?.startsWith('xl/worksheets/') || !entries[file]) throw new Error('Excel 工作表路径无效');
    const rawRows=array(xml(entries[file]).worksheet?.sheetData?.row);
    if(rawRows.length>30001)throw new Error('Excel 最多 30,000 行数据');
    const matrix = rawRows.map(raw => {
      const row=[];
      for(const cell of array(raw.c)) {
        const coordinate=String(cell['@_r']||'').match(/^([A-Z]+)\d+$/);
        if(!coordinate)throw new Error('Excel 单元格坐标无效');
        let column=0;for(const char of coordinate[1])column=column*26+char.charCodeAt(0)-64;
        if(column>100)throw new Error('Excel 超过 100 列');
        row[column-1]=cell['@_t']==='s'?(strings[Number(cell.v)]||''):cell['@_t']==='inlineStr'?texts(cell.is):String(cell.v??'');
      }
      return row;
    }).filter(row=>row.some(value=>value!==''));
    if (!matrix.length) continue;
    const width = Math.max(...matrix.map(row => row.length));
    const header = Array.from({length: width}, (_, i) => matrix[0][i] || `未命名列${i+1}`);
    if (new Set(header).size !== header.length) throw new Error('Excel 列名重复，请先修改表头');
    const quote = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    const csv = [header, ...matrix.slice(1).map(row => Array.from({length:width}, (_, i) => row[i] ?? ''))].map(row => row.map(quote).join(',')).join('\n');
    sheets.push({sheetName:name, ...require('./core.cjs').parseDataset(csv)});
  }
  if (!sheets.length || sheets.length > 20 || sheets.reduce((n,s) => n+s.count,0)>30000) throw new Error('Excel 需要 1–20 张数据表，合计最多 30,000 行');
  return sheets;
}
module.exports={officeText,excelTables};
