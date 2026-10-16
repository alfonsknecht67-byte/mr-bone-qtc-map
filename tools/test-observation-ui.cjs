const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
class Element {
  constructor() {this.children=[];this.textContent='';this.value='';this.listeners={};this.dataset={};}
  append(e) {this.children.push(e);}
  replaceChildren() {this.children=[];this.textContent='';}
  addEventListener(k, f) {this.listeners[k]=f;}
}
test('history switches graph and exposes evidence without inserting HTML', async () => {
  const elements = new Map();
  const events = {};
  const document = {
    getElementById: id => {if (!elements.has(id)) elements.set(id,new Element());return elements.get(id);},
    createElement: () => new Element(),
    addEventListener: (k,f) => events[k]=f
  };
  document.getElementById('exchange-window').value='1';
  const latest = {verified_block:100,nodes:[{id:'<img onerror=alert(1)>',balance:5}]};
  const archived = {verified_block:90,nodes:[], balances:{'<img onerror=alert(1)>':2}};
  let renders=[];
  const responses = {
    'data/history/index.json':{snapshots:[{date:'2026-10-15',block:90,file:'data/history/2026-10-15.json'}]},
    'data/history/2026-10-15.json':archived,
    'data/observation.json':{verified_block:100, exchange_candidates:[], exchange_windows:{},whale_balance_changes:[],error:'Awaiting scanner'},
    'data/transactions.json':{verified_block:100,transactions:[{txid:'abc',block:100,timestamp:1,inputs:[],outputs:[{address:'<img onerror=alert(1)>',amount:5}]}],coverage:{count:1,complete:true}}
  };
  const window = {currentMapData:latest,qtcObservation:{networkStats:()=>({block:100,scanner_indexed_block:100,generated_at:new Date().toISOString()}),render:d=>{renders.push(d);window.currentMapData=d;events['qtc:map-loaded']({detail:d});}}};
  const context = {document,window,Date,Number,Map,Promise,console,setInterval:()=>{},fetch:async url=>({ok:true,json:async()=>responses[url]})};
  vm.runInNewContext(fs.readFileSync(__dirname+'/../docs/observation.js','utf8'), context);
  events['qtc:map-loaded']({detail:latest});
  await new Promise(r=>setImmediate(r));
  assert.equal(document.getElementById('snapshot-select').children.length,1);
  document.getElementById('balance-compare-date').value='2026-10-15';
  events['qtc:wallet-selected']({detail:'<img onerror=alert(1)>'});
  await new Promise(r=>setImmediate(r));
  const texts = e=>[e.textContent,...e.children.flatMap(texts)].join('\n');
  assert.match(texts(document.getElementById('observation-wallet')),/change: 3 QTC/);
  assert.match(texts(document.getElementById('observation-wallet')),/TXID: abc/);
  assert.equal(document.getElementById('observation-wallet').children[0].textContent,'<img onerror=alert(1)>');
  document.getElementById('snapshot-select').value='2026-10-15';
  await document.getElementById('snapshot-select').listeners.change();
  assert.equal(renders[0],archived);
  assert.match(document.getElementById('observation-freshness').textContent,/ARCHIVED SNAPSHOT/);
  document.getElementById('snapshot-select').value='';
  await document.getElementById('snapshot-select').listeners.change();
  assert.equal(renders[1],latest);
});
