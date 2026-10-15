const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { parseDataset } = require('./core.cjs');
const { excelTables } = require('./office.cjs');
async function importData(paths, existing = []) {
  const files=[];let visited=0;
  async function visit(file, depth=0) {
    if(++visited>2000 || depth>10)throw new Error('数据目录过大或层级过深');
    const stat=await fs.lstat(file);
    if(stat.isSymbolicLink())return;
    if(stat.isDirectory()) {for(const name of (await fs.readdir(file)).sort())if(!name.startsWith('.'))await visit(path.join(file,name),depth+1);return;}
    const ext=path.extname(file).toLowerCase();
    if(!['.csv','.xlsx'].includes(ext))return;
    if(stat.size>5000000)throw new Error('每个数据文件最多 5 MB');
    const buffer=await fs.readFile(file), fingerprint=createHash('sha256').update(buffer).digest('hex');
    if([...existing,...files].some(f=>f.fingerprint===fingerprint))return;
    if(existing.length+files.length>=5)throw new Error('每个项目最多 5 个数据文件，请先移除已有文件');
    const sheets=ext==='.csv'?[{sheetName:'CSV',...parseDataset(buffer.toString('utf8'))}]:excelTables(buffer);
    if(JSON.stringify(sheets).length>10000000)throw new Error('解析后数据超过 10 MB，请拆分文件');
    files.push({id:randomUUID(),name:path.basename(file),fingerprint,sheets});
  }
  for(const file of paths)await visit(file);
  if(!files.length)throw new Error('没有新的 CSV / .xlsx 数据文件（旧版 .xls 请另存为 .xlsx）');
  return files;
}
module.exports={importData};
