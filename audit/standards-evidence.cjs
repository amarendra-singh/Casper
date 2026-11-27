const fs = require('fs');
const path = require('path');
const lint = JSON.parse(fs.readFileSync(path.join(__dirname, 'eslint-results.json'), 'utf8'));
const sum = rows => rows.reduce((a, r) => ({files:a.files+1, errors:a.errors+r.errorCount, warnings:a.warnings+r.warningCount}), {files:0,errors:0,warnings:0});
const prod = lint.filter(r => !/[/\\]tests[/\\]|\.test\./.test(r.filePath));
const rgb = [0x9a,0x9a,0x9f].map(v=>v/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);
const lum = rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;
const escape = v => (v===null||v===undefined)?'':String(v).includes(',')?`"${v}"`:String(v);
const evidence = {
  eslint:{all:sum(lint),production:sum(prod),productionErrors:prod.flatMap(r=>r.messages.filter(m=>m.severity===2).map(m=>({file:r.filePath,line:m.line,rule:m.ruleId,message:m.message})))},
  mutedContrastOnWhite:Number((1.05/(lum+0.05)).toFixed(2)),
  date:{localInstant:'2026-10-04T01:00:00+05:30',actualDefault:new Date('2026-10-04T01:00:00+05:30').toISOString().slice(0,10),expectedLocalDate:'2026-10-04'},
  csvExamples:['ACME, "North"','Line 1\nLine 2'].map(input=>({input,actual:escape(input)}))
};
fs.writeFileSync(path.join(__dirname,'standards-evidence.json'),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence,null,2));
