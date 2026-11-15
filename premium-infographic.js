/* SellerKit Studio: premium photo-overlay compositor.
 * Only draws user-confirmed product claims. Never calls paid APIs.
 * Works with the existing 900x1200 canvas and reused source photograph.
 */
(function(root){
'use strict';
const W=900,H=1200;
const FONT='"Arial", "Helvetica Neue", sans-serif';
function rounded(ctx,x,y,w,h,r,fill,stroke){
 ctx.beginPath();ctx.roundRect(x,y,w,h,r);
 if(fill){ctx.fillStyle=fill;ctx.fill();}
 if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1.5;ctx.stroke();}
}
function line(ctx,x,y,x2,y2,color,width=2){
 ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x2,y2);ctx.lineWidth=width;
 ctx.strokeStyle=color;ctx.stroke();
}
function circle(ctx,x,y,r,fill){ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=fill;ctx.fill();}
function linear(ctx,x,y,x2,y2,stops){
 const g=ctx.createLinearGradient(x,y,x2,y2);for(const [at,c] of stops)g.addColorStop(at,c);return g;
}
function fit(ctx,value,width,desired,min=15,maxLines=3){
 const words=String(value||'').trim().split(/\s+/).filter(Boolean);
 for(let size=desired;size>=min;size--){
  ctx.font=`800 ${size}px ${FONT}`;
  const lines=[];let current='',needSmaller=false;
  for(let word of words){
   if(ctx.measureText(word).width>width){
    if(size>min){needSmaller=true;break;}
    if(current){lines.push(current);current='';}
    let chunk='';for(const char of word){if(chunk&&ctx.measureText(chunk+char).width>width){lines.push(chunk);chunk='';}chunk+=char;}
    current=chunk;continue;
   }
   const candidate=current?current+' '+word:word;
   if(ctx.measureText(candidate).width<=width)current=candidate;
   else{if(current)lines.push(current);current=word;}
  }
  if(needSmaller)continue;
  if(current)lines.push(current);
  if(lines.length<=maxLines)return {size,lines};
 }
 return {size:min,lines:[String(value).slice(0,40)]};
}
function type(ctx,value,x,y,width,{size=38,min=17,color='#fff',weight=800,maxLines=3,step=1.11,align='left',shadow=false,letter=0}={}){
 const str=String(value||'').trim();if(!str)return 0;
 const f=fit(ctx,str,width,size,min,maxLines);const lineHeight=f.size*step;
 ctx.save();ctx.fillStyle=color;ctx.textBaseline='top';ctx.textAlign=align;
 ctx.font=`${weight} ${f.size}px ${FONT}`;
 if(shadow){ctx.shadowColor='rgba(0,0,0,.65)';ctx.shadowBlur=14;ctx.shadowOffsetY=2;}
 for(let i=0;i<f.lines.length;i++){
  const X=align==='right'?x+width:align==='center'?x+width/2:x;
  ctx.fillText(f.lines[i],X,y+i*lineHeight,Math.max(1,width));
 }
 ctx.restore();return f.lines.length*lineHeight;
}
function kicker(ctx,str,x,y,width,color){
 type(ctx,str.toLocaleUpperCase('ru-RU'),x,y,width,{size:18,min:12,maxLines:1,weight:700,color});
}
function heroName(raw,kind){
 const s=String(raw||'').toLocaleUpperCase('ru-RU');
 const patterns={tech:/РОБОТ[-\s]*ПЫЛЕСОС|ПЫЛЕСОС|ОЧКИ|МИКРОФОН|НАУШНИКИ|НАУШНИК|КЛАВИАТУРА|КОФЕМАШИНА|УТЮГ|ФЕН|КОЛОНКА|ТЕЛЕФОН|СМАРТФОН/,kitchen:/СКОВОРОДА|КАСТРЮЛЯ|СОТЕЙНИК|ЧАЙНИК|НОЖИ|НОЖ|ПОСУДА/,editorial:/КОСМЕТИЧКА|СУМКА|ОРГАНАЙЗЕР|РЮКЗАК|КОШЕЛЁК|КОСМЕТИКА|КРЕМ|ПАРФЮМ/};
 const m=s.match(patterns[kind]);
 return m?m[0].replace('-', ' '):s.split(/\s+/).slice(0,3).join(' ');
}
function safeFacts(facts){return (Array.isArray(facts)?facts:[]).map(s=>String(s||'').trim()).filter(Boolean).slice(0,6);}
function metric(raw){
 const s=String(raw||'').trim();
 // Figures must come only from the person's supplied characteristics.
 const m=s.match(/\d+(?:[.,]\d+)?(?:\s*[–-]\s*\d+(?:[.,]\d+)?)?\s*(?:%|Вт|мАч|литр(?:а|ов)?|мл|мин|час(?:ов|а)?|см|мм|м²|кг|дюйм(?:а|ов)?|л|ч|г)(?=$|[\s,;.!?])/iu);
 if(!m)return null;
 return {big:m[0].replace(/\s+/g,' ').replace(/литр(?:а|ов)?$/iu,'л').trim(),label:(s.slice(0,m.index)+' '+s.slice(m.index+m[0].length)).replace(/[,:;]+/g,' ').replace(/\s+/g,' ').trim()};
}
function fact(ctx,raw,x,y,w,{height=112,accent='#65FF4D',mode='dark'}={}){
 const ink=mode==='light'?'#16232B':'#FAFFFD';
 const faint=mode==='light'?'rgba(24,40,46,.62)':'rgba(238,247,240,.75)';
 const solid=mode==='light'?'rgba(255,255,255,.92)':'rgba(8,17,21,.72)';
 const border=mode==='light'?'rgba(24,50,42,.17)':'rgba(255,255,255,.20)';
 rounded(ctx,x,y,w,height,21,solid,border);
 rounded(ctx,x+15,y+14,5,Math.max(32,height-28),3,accent);
 const value=metric(raw);
 if(value){
  const top=height>=125?y+24:y+18;
  const size=value.big.length>9?33:43;
  type(ctx,value.big,x+35,top,w-52,{size,min:20,maxLines:1,color:ink,weight:900});
  if(value.label)type(ctx,value.label,x+36,top+54,w-53,{size:20,min:14,maxLines:2,color:faint,weight:650});
 }else{
  const small=String(raw).length>31;
  type(ctx,raw,x+35,y+(small?20:30),w-51,{size:small?24:29,min:16,maxLines:3,color:ink,weight:750});
 }
}
function verticalTop(ctx,shadeColor='rgba(0,0,0,.83)'){
 ctx.fillStyle=linear(ctx,0,0,0,460,[[0,shadeColor],[.78,'rgba(0,0,0,.18)'],[1,'rgba(0,0,0,0)']]);
 ctx.fillRect(0,0,W,460);
}
function verticalBottom(ctx,h=320){
 ctx.fillStyle=linear(ctx,0,H-h,0,H,[[0,'rgba(0,0,0,0)'],[1,'rgba(0,0,0,.78)']]);ctx.fillRect(0,H-h,W,h);
}
function tech(ctx,title,claims){
 const neon='#8CFF4D';
 // Corner illumination and diagonals are deliberately behind short, confirmed callouts.
 ctx.fillStyle=linear(ctx,0,0,W,H,[[0,'rgba(0,22,14,.52)'],[.48,'rgba(0,0,0,0)'],[1,'rgba(0,42,22,.45)']]);ctx.fillRect(0,0,W,H);
 ctx.save();ctx.globalAlpha=.23;ctx.strokeStyle=neon;ctx.lineWidth=46;
 line(ctx,690,-90,930,270,neon,35);line(ctx,-40,1020,380,1270,neon,29);ctx.restore();
 verticalTop(ctx,'rgba(1,11,12,.86)');verticalBottom(ctx,285);
 rounded(ctx,41,36,96,5,3,neon);kicker(ctx,'SELLERKIT · TECHNOLOGY',42,54,590,'#B2D6BF');
 const hero=heroName(title,'tech');
 let titleBottom=type(ctx,hero,40,107,810,{size:95,min:48,maxLines:2,color:'#FFFFFF',weight:900,step:.98,shadow:true});
 const rest=String(title||'').trim().replace(new RegExp(hero.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'),'').trim();
 if(rest&&rest.length<48)type(ctx,rest,44,115+titleBottom,760,{size:23,min:15,maxLines:2,color:'#D4EEE0',weight:700});
 const f=claims.slice(0,3);
 if(f[0])fact(ctx,f[0],37,378,248,{height:128,accent:neon});
 if(f[1])fact(ctx,f[1],617,486,249,{height:128,accent:neon});
 if(f[2])fact(ctx,f[2],39,1026,354,{height:125,accent:neon});
 if(f.length===0)line(ctx,42,1125,190,1125,neon,5);
 // Deliberate small footer: no pretend manufacturer, warranty or numerical specifications.
 if(f.length>3)type(ctx,f.slice(3,5).join('  ·  '),427,1110,432,{size:19,min:13,maxLines:2,color:'#EAF5ED',weight:700});
}
function cookware(ctx,title,claims){
 const red='#E9404A';
 ctx.fillStyle=linear(ctx,0,0,W,920,[[0,'rgba(16,16,21,.72)'],[.44,'rgba(15,16,20,.15)'],[1,'rgba(3,4,8,.16)']]);ctx.fillRect(0,0,W,920);
 verticalTop(ctx,'rgba(12,13,19,.84)');verticalBottom(ctx,320);
 ctx.fillStyle=linear(ctx,W-70,0,W,0,[[0,'rgba(170,20,29,0)'],[1,'rgba(200,20,32,.34)']]);ctx.fillRect(625,0,275,1200);
 rounded(ctx,40,39,102,5,2,red);kicker(ctx,'ДЕТАЛИ · ПРЕИМУЩЕСТВА',44,60,705,'#D8DDE2');
 const name=heroName(title,'kitchen');
 const size=name.length>13?77:94;
 type(ctx,name,34,112,832,{size,min:40,maxLines:2,color:'#FFFDFB',weight:900,shadow:true,step:.98});
 const f=claims.slice(0,4),measurementIndex=f.findIndex(s=>metric(s));
 let labelOrder=f.filter((_,i)=>i!==measurementIndex);
 if(measurementIndex>=0){
  // Hero numeric badge is only allowed for a provided real measurement.
  fact(ctx,f[measurementIndex],633,817,229,{height:143,accent:red});
 }
 if(labelOrder[0])fact(ctx,labelOrder[0],37,338,257,{height:122,accent:red});
 if(labelOrder[1])fact(ctx,labelOrder[1],38,994,301,{height:128,accent:red});
 if(labelOrder[2])fact(ctx,labelOrder[2],543,1055,318,{height:104,accent:red});
 line(ctx,42,276,120,276,red,5);
}
function editorial(ctx,title,claims){
 const mint='#83CFBA',ink='#FFFFFF';
 ctx.fillStyle=linear(ctx,0,0,W,480,[[0,'rgba(19,32,33,.67)'],[1,'rgba(12,20,21,0)']]);ctx.fillRect(0,0,W,480);
 verticalBottom(ctx,405);
 ctx.save();ctx.globalAlpha=.4;rounded(ctx,36,35,828,1094,30,null,'rgba(255,255,255,.2)');ctx.restore();
 rounded(ctx,48,47,80,5,2,mint);kicker(ctx,'ДЕТАЛИ КОТОРЫЕ ВАЖНЫ',48,68,695,'#D1EEE4');
 const name=heroName(title,'editorial');
 type(ctx,name,43,134,815,{size:93,min:45,maxLines:2,color:ink,weight:900,shadow:true,step:1.03});
 const f=claims.slice(0,5);
 if(f[0])fact(ctx,f[0],44,820,377,{height:130,accent:mint});
 if(f[1])fact(ctx,f[1],446,853,414,{height:130,accent:mint});
 if(f[2])fact(ctx,f[2],44,982,415,{height:131,accent:mint});
 if(f[3])type(ctx,f[3],476,1034,376,{size:22,min:15,maxLines:3,color:'#FBFFFD',weight:750});
}
function draw(ctx,{index,title,claims=[]}={}){
 if(!ctx||![15,16,17].includes(index))return false;
 const safe=safeFacts(claims);
 ctx.save();
 if(index===15)tech(ctx,title,safe);
 else if(index===16)cookware(ctx,title,safe);
 else editorial(ctx,title,safe);
 ctx.restore();return true;
}
root.SellerKitPremium=Object.freeze({draw});
})(window);