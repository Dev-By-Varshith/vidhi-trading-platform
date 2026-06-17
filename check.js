const fs=require('fs'); 
const js=fs.readFileSync('worker.js', 'utf8'); 
const m=js.match(/\"{3}/); 
if (m) console.log(js.substring(m.index-20, m.index+40)); 
else console.log('NOT FOUND');
