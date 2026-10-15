const {zipSync,strToU8}=require('fflate');
function workbook(){return Buffer.from(zipSync(Object.fromEntries(Object.entries({
 'xl/workbook.xml':'<workbook><sheets><sheet name="实验一" r:id="r1"/><sheet name="实验二" r:id="r2"/></sheets></workbook>',
 'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="r1" Target="/xl/worksheets/sheet1.xml"/><Relationship Id="r2" Target="worksheets/sheet2.xml"/></Relationships>',
 'xl/sharedStrings.xml':'<sst><si><t>measure</t></si></sst>',
 'xl/worksheets/sheet1.xml':'<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>result</t></is></c></row><row><c r="A2"><v>2</v></c><c r="C2"><f>A2*2</f><v>4</v></c></row><row><c r="A3"><v>3</v></c><c r="C3"><f>A3*2</f></c></row></sheetData></worksheet>',
 'xl/worksheets/sheet2.xml':'<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>value</t></is></c></row><row><c r="A2"><v>7</v></c></row></sheetData></worksheet>'
 }).map(([key,value])=>[key,strToU8(value)]))));}
module.exports={workbook};
