const buttons=[...document.querySelectorAll('[data-chart-layout]')];
const query=window.matchMedia('(max-width: 760px)');
const key='qtc-chart-layout-v1';
let choice='auto';
try{const saved=localStorage.getItem(key);if(['auto','mobile','desktop'].includes(saved))choice=saved;}catch{}
function apply(){
  const mobile=choice==='mobile'||(choice==='auto'&&query.matches);
  document.body.classList.toggle('layout-mobile',mobile);
  document.body.classList.toggle('layout-desktop',choice==='desktop');
  for(const button of buttons)button.setAttribute('aria-pressed',String(button.dataset.chartLayout===choice));
  document.getElementById('layout-status').textContent=(choice==='auto'?'Auto · ':'')+(mobile?'Mobile layout':'Desktop layout');
  document.dispatchEvent(new CustomEvent('chartlayoutchange'));
}
for(const button of buttons)button.addEventListener('click',()=>{choice=button.dataset.chartLayout;try{localStorage.setItem(key,choice);}catch{}apply();});
query.addEventListener('change',()=>{if(choice==='auto')apply();});
apply();
