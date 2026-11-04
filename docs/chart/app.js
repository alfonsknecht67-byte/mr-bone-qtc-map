import {identity,ticker,candles,currentHistory,depth,latestTrade,indicators,freshness,defaultSettings,settings} from './core.mjs';
import {createAnalysis} from './analysis.mjs';
import {createOrderBook} from './orderbook.mjs';
const $=id=>document.getElementById(id), fmt=(v,d=4)=>Number(v).toLocaleString('en-US',{maximumFractionDigits:d}), stamp=t=>new Date(t).toISOString().replace('T',' ').replace(/\.\d+Z$/,' UTC');
const API='https://safetrade.com/api/v2/trade/public';
const feeds=Object.fromEntries(['ticker','candles','book','trades'].map(k=>[k,{at:0,error:null}]));
let period=60,epoch=0,verified=false,busy=false,failures=0,lastCandles=0,nextTimer,rows=[],lastTrade=null,charts=[],series={},rangeLock=false,analysis,indicatorSettings={...defaultSettings},orderUI,bookLimit=50,pendingBookRefresh=false;
const options={layout:{background:{type:'solid',color:'#101722'},textColor:'#8292a9',fontSize:10},grid:{vertLines:{color:'#1c2635'},horzLines:{color:'#1c2635'}},rightPriceScale:{borderColor:'#263244',minimumWidth:68},timeScale:{borderColor:'#263244',timeVisible:true,secondsVisible:false},crosshair:{mode:0},localization:{locale:'en-US'}};
function chart(id){const el=$(id),c=LightweightCharts.createChart(el,{...options,width:el.clientWidth,height:el.clientHeight});new ResizeObserver(()=>{if(el.clientWidth)c.resize(el.clientWidth,el.clientHeight);}).observe(el);charts.push(c);return c;}
try{
  const price=chart('pricechart'),vol=chart('volumechart'),rsi=chart('rsichart'),macd=chart('macdchart'),atr=chart('atrchart'),stoch=chart('stochchart');
  series.price=price.addCandlestickSeries({upColor:'#36d5ac',downColor:'#f27082',wickUpColor:'#36d5ac',wickDownColor:'#f27082',borderVisible:false,priceFormat:{type:'price',precision:4,minMove:.0001}});
  series.volume=vol.addHistogramSeries({priceFormat:{type:'volume'}});
  for(const [key,c,color] of [['ema20',price,'#e6bd69'],['ema50',price,'#bc8fea'],['upper',price,'#669bd6'],['middle',price,'#597387'],['lower',price,'#669bd6'],['rsi',rsi,'#bc8fea'],['macd',macd,'#669bd6'],['signal',macd,'#e6bd69']])series[key]=c.addLineSeries({color,lineWidth:1,priceLineVisible:false,lastValueVisible:false});
  series.hist=macd.addHistogramSeries({priceLineVisible:false,lastValueVisible:false});
  series.close=price.addLineSeries({color:'#b1c0d1',lineWidth:1,visible:false,priceFormat:{type:'price',precision:4,minMove:.0001}});
  for(const [key,c,color] of [['sma',price,'#b1c0d1'],['vwap',price,'#97b4bc'],['atr',atr,'#b1c0d1'],['stochK',stoch,'#b1c0d1'],['stochD',stoch,'#9b99ae']])series[key]=c.addLineSeries({color,lineWidth:1,priceLineVisible:false,lastValueVisible:false,visible:['atr','stochK','stochD'].includes(key)});
  for(const n of [30,70])series.rsi.createPriceLine({price:n,color:'#5b4b73',lineWidth:1,lineStyle:2,axisLabelVisible:true,title:''});
  for(const c of charts)c.timeScale().subscribeVisibleLogicalRangeChange(range=>{if(rangeLock||!range)return;rangeLock=true;for(const other of charts)if(other!==c)other.timeScale().setVisibleLogicalRange(range);rangeLock=false;});
  price.subscribeCrosshairMove(p=>{const bar=rows.find(r=>r.time===p.time);if(bar)$('hover').textContent=`${stamp(p.time*1000)} · O ${fmt(bar.open)}  H ${fmt(bar.high)}  L ${fmt(bar.low)}  C ${fmt(bar.close)} USDT`;});
  const dc=LightweightCharts.createChart($('depthchart'),{...options,width:$('depthchart').clientWidth,height:140,timeScale:{visible:false},handleScroll:false,handleScale:false,localization:{timeFormatter:t=>fmt(t/1e8)}});
  new ResizeObserver(()=>dc.resize($('depthchart').clientWidth,$('depthchart').clientHeight)).observe($('depthchart'));
  series.biddepth=dc.addAreaSeries({lineColor:'#36d5ac',topColor:'#36d5ac33',bottomColor:'#36d5ac05',lineWidth:1,priceLineVisible:false,lastValueVisible:false});series.askdepth=dc.addAreaSeries({lineColor:'#f27082',topColor:'#f2708233',bottomColor:'#f2708205',lineWidth:1,priceLineVisible:false,lastValueVisible:false});series.depthChart=dc;
  $('fit').onclick=()=>price.timeScale().fitContent();
}catch(e){$('notice').textContent='Chart library could not load. Reload the page to retry.';throw e;}
function visibility(){for(const k of ['ema20','ema50'])series[k].applyOptions({visible:$('ema').checked});for(const k of ['upper','middle','lower'])series[k].applyOptions({visible:$('bb').checked});$('rsipane').hidden=!$('rsi').checked;$('macdpane').hidden=!$('macd').checked;}
for(const id of ['ema','bb','rsi','macd'])$(id).onchange=visibility;visibility();
$('booktoggle').onclick=()=>{const hide=!$('orderpanel').hidden;$('orderpanel').hidden=hide;document.querySelector('.workspace').classList.toggle('no-book',hide);$('booktoggle').textContent=hide?'Show order book':'Hide order book';$('booktoggle').setAttribute('aria-expanded',String(!hide));};
async function get(path){const response=await fetch(API+path,{signal:AbortSignal.timeout(10000),credentials:'omit',cache:'no-store'});if(!response.ok)throw Error(`SafeTrade HTTP ${response.status}`);if(!response.headers.get('content-type')?.includes('application/json'))throw Error('Non-JSON response from exchange');return response.json();}
function renderTicker(v){$('price').textContent=fmt(v.last)+' USDT';$('change').textContent=v.change;$('change').className=v.change.startsWith('-')?'negative':'positive';$('highlow').textContent=fmt(v.high)+' / '+fmt(v.low);$('basevolume').textContent=fmt(v.base,2)+' QTC';$('quotevolume').textContent=fmt(v.quote,2)+' USDT';analysis?.price(v.last);}
function renderCandles(data){
  rows=data;series.price.setData(data);series.close.setData(data.map(r=>({time:r.time,value:r.close})));
  series.volume.setData(data.map(r=>({time:r.time,value:r.volume,color:r.close>=r.open?'#36d5ac77':'#f2708277'})));
  const calc=indicators(data,period,indicatorSettings);
  for(const key of Object.keys(calc)){const values=new Map(calc[key].map(r=>[r.time,r.value]));series[key].setData(data.map(r=>values.has(r.time)?{time:r.time,value:values.get(r.time),...(key==='hist'?{color:values.get(r.time)>=0?'#36d5ac88':'#f2708288'}:{})}:{time:r.time}));}
  $('empty').hidden=true;$('barstamp').textContent='Latest candle open: '+stamp(data.at(-1).time*1000);
  $('rsivalue').textContent=calc.rsi.length?fmt(calc.rsi.at(-1).value,2):'Insufficient consecutive candles';$('macdvalue').textContent=calc.macd.length?fmt(calc.macd.at(-1).value,6):'Insufficient consecutive candles';
  if(!lastCandles)charts[0].timeScale().fitContent();lastCandles=Date.now();analysis?.update();
}
function renderBook(book,requested=20){
  orderUI.render(book,requested);
  // Keep the depth plot focused on the nearest 20 levels; the tables contain the full fetched snapshot.
  for(const side of ['asks','bids']){let cumulative=0;const points=book[side].slice(0,20).map(r=>({time:Math.round(r.price*1e8),value:(cumulative+=r.size)}));const unique=[...new Map(points.map(r=>[r.time,r])).values()].sort((a,b)=>a.time-b.time);series[side==='bids'?'biddepth':'askdepth'].setData(unique);}
  $('spread').textContent=book.bids.length&&book.asks.length?fmt(book.asks[0].price-book.bids[0].price)+' USDT':'Unavailable';const bids=book.bids.slice(0,20),asks=book.asks.slice(0,20);$('depthprices').textContent=bids.length&&asks.length?`Price axis: ${fmt(bids.at(-1).price)} – ${fmt(asks.at(-1).price)} USDT / QTC`:'Price axis: USDT / QTC';series.depthChart.timeScale().fitContent();
}
async function load(key,path,parse,render,version){try{const raw=await get(path);const value=parse(raw);if(version!==epoch)return;render(value);feeds[key]={at:Date.now(),error:null};}catch(e){if(version!==epoch)return;feeds[key].error=e.message;if(key==='ticker')analysis?.resetAlertBaseline();}}
async function poll(){if(busy||document.hidden)return;clearTimeout(nextTimer);busy=true;const version=epoch;
  try{if(!verified){const [currency,market]=await Promise.all([get('/currencies/qtc'),get('/markets/qtcusdt')]);identity(currency,market);verified=true;$('integrity').textContent='Verified identity: Qubitcoin (qtc) / USDT · SafeTrade public API.';}
    const requestedBookLimit=bookLimit;
    const jobs=[load('ticker','/tickers/qtcusdt',ticker,renderTicker,version),load('book','/markets/qtcusdt/depth?limit='+requestedBookLimit,depth,b=>renderBook(b,requestedBookLimit),version),load('trades','/markets/qtcusdt/trades?limit=1',latestTrade,t=>{lastTrade=t;$('tradetime').textContent=stamp(t*1000);},version)];
    if(Date.now()-lastCandles>=60000){const start=Math.floor(Date.now()/1000)-period*60*300;jobs.push(load('candles',`/markets/qtcusdt/k-line?period=${period}&time_from=${start}&limit=500`,r=>candles(r,period),renderCandles,version));}
    await Promise.all(jobs);failures=Object.values(feeds).some(f=>f.error)?Math.min(failures+1,4):0;
  }catch(e){for(const f of Object.values(feeds))f.error=e.message;$('integrity').textContent='Market identity could not be verified. No unverified data will be shown.';failures=Math.min(failures+1,4);}
  finally{busy=false;status();if(version!==epoch||pendingBookRefresh){pendingBookRefresh=false;queueMicrotask(poll);}else nextTimer=setTimeout(poll,Math.min(120000,15000*2**failures));}
}
function status(){const now=Date.now(),market=freshness(feeds.ticker,now,45000),cs=rows.length&&!currentHistory(rows,period,now/1000)?'Stale history':freshness(feeds.candles,now,150000),bs=freshness(feeds.book,now,45000),ts=freshness(feeds.trades,now,45000),paused=document.hidden,offline=!navigator.onLine;const healthy=!paused&&!offline&&[market,cs,bs,ts].every(s=>s==='Connected');
  $('connection').textContent=offline?'○ Offline':paused?'○ Paused · tab hidden':healthy?'● Connected · polling':market==='Connecting'?'○ Connecting':'○ Data incomplete / stale';$('connection').style.color=healthy?'#36d5ac':'#e6bd69';
  $('received').textContent='Ticker checked: '+(feeds.ticker.at?stamp(feeds.ticker.at):'—');$('candlestatus').textContent=`Candles: ${cs}${feeds.candles.at?' · checked '+stamp(feeds.candles.at):''}`;$('bookstatus').textContent=`${offline?'Offline':paused?'Paused':bs}${feeds.book.at?' · '+stamp(feeds.book.at):''}`;orderUI?.status(`${offline?'Offline':paused?'Paused':bs}${feeds.book.at?' · checked '+stamp(feeds.book.at):''}`);
  $('tradeage').textContent=lastTrade?`${fmt(Math.max(0,(now/1000-lastTrade)/60),1)} min since last trade${now/1000-lastTrade>300?' · quiet / older market activity':''} · feed ${ts}`:`Trade feed: ${ts}`;
  const errors=Object.entries(feeds).filter(([,f])=>f.error).map(([k,f])=>`${k}: ${f.error}`).join('; ');
  $('notice').classList.toggle('ok',healthy);$('notice').textContent=offline?'Offline. Previous values, if any, are retained and are not current.':paused?'Updates paused while this tab is hidden.':healthy?'Connected to SafeTrade · verified public snapshots · not a streaming feed.':errors?`Data unavailable or stale. ${errors}. Browser access can be blocked by CORS or exchange protection. No substitute prices are used.`:cs==='Stale history'?'Historical candles only: the latest returned candle is older than two selected intervals. The exchange may have no recent trades. No missing bars are fabricated.':'Waiting for validated SafeTrade responses. Previous values may be stale.';
  document.body.classList.toggle('is-stale',!healthy);for(const [id,s] of [['pricechart',cs],['volumechart',cs],['rsichart',cs],['macdchart',cs],['orderpanel',bs]])$(id).setAttribute('aria-label',s+' data');
}
for(const b of document.querySelectorAll('[data-period]')){b.setAttribute('aria-pressed',String(Number(b.dataset.period)===period));b.onclick=()=>{period=Number(b.dataset.period);epoch++;lastCandles=0;rows=[];feeds.candles={at:0,error:null};for(const key of ['price','volume','ema20','ema50','upper','middle','lower','rsi','macd','signal','hist','sma','vwap','atr','stochK','stochD','close'])series[key].setData([]);$('rsivalue').textContent='—';$('macdvalue').textContent='—';$('barstamp').textContent='Latest candle open: —';$('empty').hidden=false;$('periodlabel').textContent='· '+b.textContent;analysis?.changedInterval();for(const other of document.querySelectorAll('[data-period]')){other.classList.toggle('selected',other===b);other.setAttribute('aria-pressed',String(other===b));}status();poll();};}
orderUI=createOrderBook(size=>{bookLimit=size;if(busy)pendingBookRefresh=true;else poll();});
analysis=createAnalysis({
  chart:charts[0], candle:series.price, close:series.close, series, charts,
  rows:()=>rows, period:()=>period,
  fresh:()=>!document.hidden&&navigator.onLine&&!feeds.candles.error&&Date.now()-feeds.candles.at<150000&&currentHistory(rows,period),
  receipt:()=>feeds.candles.at,
  getPublic:path=>{if(!verified)throw Error('Market identity is not verified yet');return get(path);},
  getSettings:()=>indicatorSettings,
  setSettings:next=>{indicatorSettings=settings(next);if(rows.length)renderCandles(rows);},
});
function applyLayoutInteraction(){const mobile=document.body.classList.contains('layout-mobile')||(!document.body.classList.contains('layout-desktop')&&window.matchMedia('(max-width: 760px)').matches);for(const c of charts)c.applyOptions({handleScroll:{vertTouchDrag:!mobile}});}
document.addEventListener('chartlayoutchange',applyLayoutInteraction);applyLayoutInteraction();
document.addEventListener('visibilitychange',()=>{status();if(!document.hidden)poll();else clearTimeout(nextTimer);});window.addEventListener('online',poll);window.addEventListener('offline',status);setInterval(status,1000);poll();


