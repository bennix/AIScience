function activeDataset(project) {
  const file=project.datasets?.find(f=>f.id===project.activeDatasetId)||project.datasets?.[0];
  if(!file)return project.dataset;
  const sheet=file.sheets[file.activeSheet||0];
  return {...sheet,name:file.name+(file.sheets.length>1?` / ${sheet.sheetName}`:'')};
}
function dataSummaries(project) {
  if(!project.datasets?.length)return project.dataset?[summary(project.dataset)]:[];
  return project.datasets.flatMap(file=>file.sheets.map(sheet=>summary({...sheet,name:file.name})));
}
function summary(d){return {name:d.name,sheetName:d.sheetName,count:d.count,columns:d.columns,stats:d.stats};}
module.exports={activeDataset,dataSummaries};
