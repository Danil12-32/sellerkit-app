/* SellerKit — local WB/Ozon infographic engine; never makes a paid AI request. */
(function(root){
"use strict";
const NAMES=[
"Крупный товар по центру",
"Иконки и подписи слева",
"Иконки и подписи справа",
"Технологичная колонка",
"Чистый минимализм",
"Тёмный премиум",
"Технологичная инфографика",
"Товар в интерьере",
"Варианты использования",
"Детали и особенности товара",
"Подтверждённые размеры",
"Преимущества вокруг товара",
"Акцентные значки",
"Журнальная композиция",
"Флагманская инфографика"
];
const TEMPLATES=Object.freeze(NAMES.map((name,i)=>Object.freeze({id:"infog-"+i,name})));
const fixes=[
[/настоовьн/gi,"настольн"],[/настолльн/gi,"настольн"],[/настолная/gi,"настольная"],
[/освешени/gi,"освещени"],[/освешает/gi,"освещает"],[/комфортого/gi,"комфортного"],
[/кросовк/gi,"кроссовк"],[/наушнык/gi,"наушник"],[/мармурн/gi,"мраморн"],
[/качественые/gi,"качественные"],[/кроссовкии/gi,"кроссовки"],[/удобнный/gi,"удобный"]];
function correct(s){
 let v=String(s||"").normalize("NFC").replace(/[\t\u00a0]+/g," ").replace(/\s+/g," ").replace(/\s+([,.!?])/g,"$1").trim();
 for(const [re,to] of fixes)v=v.replace(re,match=>match[0]===match[0].toUpperCase()?to[0].toUpperCase()+to.slice(1):to);
 return v;
}
function category(t){
 const s=String(t||"").toLowerCase();
 if(/худи|юбк|куртк|одежд|плать|футбол|рубаш|кофт|свитер|шорт/.test(s))return "fashion";
 if(/кроссов|ботин|кед|обув|туфл/.test(s))return "footwear";
 if(/часы|телефон|наушник|планшет|микрофон|клавиатур|электрон|смартфон|колонк/.test(s))return "tech";
 if(/ламп|светильник|торшер|люстр/.test(s))return "lighting";
 if(/сумк|органайзер|рюкзак|контейнер|коробк/.test(s))return "accessories";
 if(/крем|дух|парфюм|лосьон|косметик/.test(s))return "beauty";
 return "general";
}
function irrelevant(cat,s){
 if(!["fashion","footwear"].includes(cat)&&/\b\d{2}[\s-–]+\d{2}\s*размер|\bразмер[ыа]?\s*\d{2}[\s-–]+\d{2}/i.test(s))return true;
 if(cat==="lighting"&&/мониторинг здоровья|спортивн\w* режим|пульс|носки|размерная сетка|батарея.*7 дней/i.test(s))return true;
 if(cat!=="tech"&&/звонки и уведомления|оперативная память|bluetooth|wi.?fi/i.test(s))return true;
 return false;
}
function prepare(title,claims){
 const t=correct(title),cat=category(t),warnings=[],clean=[];
 if(String(title||"").trim()!==t)warnings.push("Исправлены известные опечатки и пробелы в названии.");
 for(const raw of (Array.isArray(claims)?claims:[])){
  const str=correct(raw);if(!str)continue;
  if(irrelevant(cat,str)){warnings.push("Убрано неподходящее утверждение: "+str);continue;}
  if(str.length>54)warnings.push("Сократи характеристику до 54 символов: "+str);
  if(!clean.some(x=>x.toLowerCase()===str.toLowerCase()))clean.push(str);
 }
 return {title:t,claims:clean.slice(0,6),category:cat,warnings,
  changed:t!==String(title||"").trim()||clean.join("\n")!==(claims||[]).join("\n")};
}
const DICTIONARY=[
[/батаре|заряд|аккумулятор|автоном/i,"battery"],
[/звонк|уведомлен|связи|телефон/i,"phone"],
[/пульс|здоров|сердц|сон\b/i,"heart"],
[/спорт|бег|трениров|активн/i,"run"],
[/свет|освещ|ламп|яркост/i,"light"],
[/интерьер|спальн|гостин|дом|уют/i,"home"],
[/мрамор|камень|материал|ткань|хлопок|фактур/i,"layers"],
[/размер|высот|ширин|длина|габарит/i,"ruler"],
[/влаг|вода|водонепрон/i,"drop"],
[/прочн|защит|крепк|надёжн/i,"shield"],
[/звук|аудио|музык|бас/i,"headphones"],
[/управлен|функц|режим|настройк/i,"settings"],
[/лёгк|вес\b|масса/i,"feather"],
[/комплект|хранен|поставк/i,"box"],
[/дизайн|стиль|элегант|красив/i,"sparkle"],
[/капюш|шнур|ворот|вырез/i,"hood"],
[/карман/i,"pocket"],
[/цвет|расцвет|контраст|блок|палитр/i,"palette"],
[/посадк|крой|фасон|силуэт/i,"hanger"]
];
function iconFor(s){return DICTIONARY.find(v=>v[0].test(s))?.[1]||"check";}
function icon(ctx,id,x,y,size,color){
 ctx.save();ctx.translate(x,y);ctx.scale(size/48,size/48);ctx.strokeStyle=color;ctx.fillStyle=color;
 ctx.lineWidth=3.5;ctx.lineCap="round";ctx.lineJoin="round";
 const path=(...points)=>{ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.stroke();};
 const circ=(x,y,r)=>{ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.stroke();};
 switch(id){
 case "battery":ctx.strokeRect(5,14,35,24);path([44,20],[44,31]);path([22,17],[17,25],[25,25],[20,35]);break;
 case "phone":ctx.beginPath();ctx.moveTo(14,8);ctx.quadraticCurveTo(8,20,20,32);ctx.quadraticCurveTo(32,43,40,34);ctx.lineTo(31,27);ctx.lineTo(26,31);ctx.quadraticCurveTo(19,26,17,19);ctx.lineTo(22,15);ctx.closePath();ctx.stroke();break;
 case "heart":ctx.beginPath();ctx.moveTo(24,40);ctx.bezierCurveTo(9,27,5,18,12,11);ctx.bezierCurveTo(19,4,24,13,24,13);ctx.bezierCurveTo(32,5,40,7,41,16);ctx.bezierCurveTo(43,26,31,35,24,40);ctx.stroke();break;
 case "run":circ(32,9,4);path([27,17],[19,24],[30,28],[39,37]);path([27,17],[38,19]);path([19,24],[10,39]);path([30,28],[20,41]);break;
 case "light":ctx.beginPath();ctx.arc(24,19,13,Math.PI,0);ctx.lineTo(35,26);ctx.lineTo(29,33);ctx.lineTo(19,33);ctx.lineTo(13,26);ctx.closePath();ctx.stroke();path([20,38],[29,38]);path([21,43],[28,43]);break;
 case "home":path([5,23],[24,7],[43,23]);path([11,20],[11,41],[37,41],[37,20]);ctx.strokeRect(20,28,9,13);break;
 case "layers":path([5,17],[24,7],[43,17],[24,27],[5,17]);path([7,27],[24,36],[41,27]);path([7,35],[24,44],[41,35]);break;
 case "ruler":ctx.save();ctx.translate(9,34);ctx.rotate(-.4);ctx.strokeRect(0,0,35,10);for(let i=5;i<=30;i+=5)path([i,0],[i,5]);ctx.restore();break;
 case "drop":ctx.beginPath();ctx.moveTo(24,5);ctx.bezierCurveTo(7,27,10,38,24,42);ctx.bezierCurveTo(39,38,41,27,24,5);ctx.stroke();break;
 case "shield":path([24,5],[41,11],[38,31],[24,43],[10,31],[7,11],[24,5]);break;
 case "headphones":ctx.beginPath();ctx.arc(24,25,17,Math.PI,0);ctx.stroke();ctx.strokeRect(5,24,10,16);ctx.strokeRect(33,24,10,16);break;
 case "settings":circ(24,24,9);for(let i=0;i<8;i++){const a=i*Math.PI/4;path([24+14*Math.cos(a),24+14*Math.sin(a)],[24+21*Math.cos(a),24+21*Math.sin(a)])}break;
 case "feather":ctx.beginPath();ctx.moveTo(8,40);ctx.quadraticCurveTo(6,14,41,7);ctx.quadraticCurveTo(43,36,8,40);ctx.stroke();path([8,40],[35,13]);break;
 case "box":path([5,16],[24,6],[43,16],[24,26],[5,16]);path([5,16],[5,37],[24,45],[24,26]);path([43,16],[43,37],[24,45]);break;
 case "sparkle":path([24,4],[29,19],[44,24],[29,29],[24,44],[19,29],[4,24],[19,19],[24,4]);break;
 case "hood":ctx.beginPath();ctx.moveTo(9,40);ctx.quadraticCurveTo(4,12,24,5);ctx.quadraticCurveTo(44,12,39,40);ctx.stroke();path([16,42],[18,25],[30,25],[32,42]);break;
 case "palette":circ(23,23,19);circ(14,16,2);circ(26,12,2);circ(35,22,2);circ(27,34,2);break;
 case "hanger":ctx.beginPath();ctx.arc(24,13,6,Math.PI,0);ctx.stroke();path([30,13],[30,18],[44,34],[44,39],[4,39],[4,34],[20,18]);break;
 case "pocket":path([8,11],[40,11],[37,40],[11,40],[8,11]);path([14,21],[34,21]);break;
 default:path([8,25],[19,36],[40,12]);
 }
 ctx.restore();
}
function wrap(ctx,str,maxW){
 let lines=[],row="";
 for(const word of String(str||"").trim().split(/\s+/).filter(Boolean)){
  const candidate=row?row+" "+word:word;
  if(ctx.measureText(candidate).width<=maxW){row=candidate;continue;}
  if(row){lines.push(row);row="";}
  if(ctx.measureText(word).width<=maxW){row=word;continue;}
  let chunk="";
  for(const ch of Array.from(word)){
   if(chunk&&ctx.measureText(chunk+ch).width>maxW){lines.push(chunk);chunk=ch;}
   else chunk+=ch;
  }row=chunk;
 }
 if(row)lines.push(row);
 return lines;
}
function text(ctx,value,x,y,w,h,opts={}){
 const {size=30,min=13,maxLines=6,color="#fff",weight=700,align="left",shadow=true}=opts;
 let chosen=null;
 for(let px=Math.floor(size);px>=Math.floor(min);px--){
  ctx.font=weight+" "+px+"px Arial,Helvetica,sans-serif";
  const lines=wrap(ctx,value,w),step=px*1.14;
  if(lines.length<=maxLines&&lines.length*step<=h){chosen={lines,step,px};break;}
 }
 if(!chosen)throw Error("Не помещается текст: "+value+". Укороти перед платной генерацией.");
 ctx.save();ctx.fillStyle=color;ctx.textAlign=align;ctx.textBaseline="top";
 if(shadow){ctx.shadowColor="rgba(0,0,0,.85)";ctx.shadowBlur=8;ctx.shadowOffsetY=2;}
 const X=align==="right"?x+w:align==="center"?x+w/2:x;
 chosen.lines.forEach((line,i)=>ctx.fillText(line,X,y+i*chosen.step));ctx.restore();
}
function round(ctx,x,y,w,h,r,fill){
 ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);
 ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();ctx.fillStyle=fill;ctx.fill();
}
// A fashion cover needs its own design language, not generic bullet overlays.
function fashionLabel(title){
 const raw=String(title||"").trim(), match=raw.match(/худи|свитер|джемпер|кардиган|кофт[аы]|куртк[а-я]*|футболк[а-я]*|плать[а-я]*|рубашк[а-я]*|юбк[а-я]*|шорт[а-я]*|брюк[а-я]*/i);
 if(!match)return {hero:raw.toLocaleUpperCase("ru-RU"),sub:""};
 const noun=match[0].toLocaleUpperCase("ru-RU");
 const rest=(raw.slice(0,match.index)+" "+raw.slice(match.index+match[0].length)).replace(/\s+/g," ").trim().replace(/^с\s+/i,"");
 return {hero:noun,sub:rest.toLocaleUpperCase("ru-RU")};
}
function fashionSticker(ctx,value,x,y,w,h,accent,variant=0){
 const c=String(value||"").trim();if(!c)return;
 const dark="#302824",cream=variant===2?"rgba(255,250,246,.95)":"rgba(255,247,235,.92)";
 ctx.save();ctx.shadowColor="rgba(55,35,28,.25)";ctx.shadowBlur=23;ctx.shadowOffsetY=9;
 round(ctx,x,y,w,h,25,cream);ctx.restore();
 ctx.save();ctx.globalAlpha=.72;ctx.fillStyle=accent;ctx.fillRect(x+17,y+17,57,5);ctx.restore();
 const number=c.match(/(?:\d{1,3}\s*[–-]\s*\d{1,3}|\d{1,3}\s*%|\d+(?:[,.]\d+)?\s*(?:см|мм|кг))/i);
 if(number){
  const n=number[0].replace(/\s+/g," ");
  text(ctx,n,x+21,y+31,w-38,69,{size:57,min:25,maxLines:1,color:dark,weight:800,shadow:false});
  const description=c.replace(number[0],"").replace(/[·:,()]/g," ").trim().toLocaleUpperCase("ru-RU");
  if(description)text(ctx,description,x+22,y+h-44,w-42,38,{size:19,min:12,maxLines:2,color:dark,weight:700,shadow:false});
  return;
 }
 round(ctx,x+17,y+30,61,61,19,"rgba(235,195,202,.34)");
 icon(ctx,iconFor(c),x+28,y+41,39,"#72544F");
 text(ctx,c.toLocaleUpperCase("ru-RU"),x+92,y+27,w-107,h-42,
  {size:27,min:17,maxLines:4,color:dark,weight:800,shadow:false});
}
function fashionHero(ctx,data,index,accent){
 const title=fashionLabel(data.title);
 const g=ctx.createLinearGradient(0,0,0,385);
 g.addColorStop(0,"rgba(249,238,233,.96)");
 g.addColorStop(.42,"rgba(249,238,233,.60)");
 g.addColorStop(1,"rgba(249,238,233,0)");
 ctx.fillStyle=g;ctx.fillRect(0,0,900,385);
 // Big category typography as in a designed marketplace cover.
 const isMinimal=index===4, isDark=index===5, isTech=index===14;
 const headingColor=isDark?"#342621":"#2B2423";
 const width=829;
 text(ctx,title.hero,45,63,width,128,
  {size:113,min:56,maxLines:1,color:headingColor,weight:900,shadow:false});
 if(title.sub) {
  ctx.fillStyle=accent;
  round(ctx,43,201,Math.min(756,Math.max(238,title.sub.length*16+55)),56,24,"rgba(255,224,234,.86)");
  text(ctx,title.sub,58,212,Math.min(732,Math.max(217,title.sub.length*16+36)),39,
   {size:27,min:17,maxLines:2,color:"#2B2423",weight:800,shadow:false});
 }
 const claims=data.claims;
 // Two big feature stickers; use only what the person supplied.
 const placements=(
  index===12?[[22,454,337,158],[541,716,337,158],[47,989,363,142]]:
  index===4? [[22,607,334,156],[547,794,324,156],[35,1028,346,129]]:
  index===0? [[22,491,339,158],[539,768,339,158],[39,1020,349,137]]:
  index===5? [[24,577,346,159],[533,777,343,159],[40,1027,350,135]]:
  index===14?[[26,466,341,162],[536,716,341,162],[40,1019,350,140]]:
  [[25,523,344,158],[535,752,341,158],[43,1018,363,136]]
 );
 claims.slice(0,3).forEach((claim,i)=>{
  const [x,y,w,h]=placements[i];fashionSticker(ctx,claim,x,y,w,h,accent,isMinimal?2:0);
 });
 // If users give more than three claims, these belong on the following informational slides,
 // not as tiny, unreadable text on the hero.
}
const COLORS={lighting:"#E3C190",tech:"#F9A850",fashion:"#EFB5D1",footwear:"#8FDBF8",
accessories:"#B6DCC7",beauty:"#FFC0C0",general:"#CDDFFA"};
function draw(ctx,img,{index=0,title,claims=[],hero=false}={}){
 index=Number(index);if(!Number.isInteger(index)||index<0||index>=15)index=0;
 const data=prepare(title,claims),W=900,H=1200,accent=COLORS[data.category];
 if(data.title.length<3)throw Error("Введи название товара.");
 if(data.title.length>70||data.claims.some(c=>c.length>54))throw Error("Сократи слишком длинные подписи до генерации.");
 const iw=img.naturalWidth||img.width,ih=img.naturalHeight||img.height;
 if(!iw||!ih)throw Error("Фотография недоступна.");
 // Full photo remains intact across free redesigns; no invented camera angles.
 const scale=Math.max(W/iw,H/ih),dw=iw*scale,dh=ih*scale;
 ctx.drawImage(img,(W-dw)/2,(H-dh)/2,dw,dh);
 if(data.category==="fashion"&&hero&&[0,4,5,7,12,14].includes(index)){
  fashionHero(ctx,data,index,accent);
  return {name:TEMPLATES[index].name,prepared:data};
 }
 const shade=(x,y,w,h,start,end,horizontal=false)=>{
  const g=ctx.createLinearGradient(x,y,horizontal?x+w:x,horizontal?y:y+h);
  g.addColorStop(0,start);g.addColorStop(1,end);ctx.fillStyle=g;ctx.fillRect(x,y,w,h);
 };
 const panel=(x,y,w,h,a=.7)=>{ctx.fillStyle="rgba(7,14,23,"+a+")";ctx.fillRect(x,y,w,h);};
 const headline=(x=46,y=73,w=807,h=158,size=59,align="left")=>{
  ctx.fillStyle=accent;ctx.fillRect(align==="right"?x+w-105:x,y-25,105,6);
  text(ctx,data.title,x,y,w,h,{size,min:25,maxLines:3,align});
 };
 const item=(v,x,y,w,h,size=42)=>{
  icon(ctx,iconFor(v),x,y+5,size,accent);
  text(ctx,v,x+size+12,y+5,w-size-14,h-7,{size:Math.min(29,Math.max(18,h*.34)),min:12,maxLines:4});
 };
 const column=(x,y,w,h,values=data.claims,iconSize=43)=>{
  if(!values.length)return;const gap=h/values.length;
  values.forEach((v,i)=>item(v,x,y+i*gap,w,gap-7,iconSize));
 };
 const grid=(x,y,w,h,values=data.claims,cols=2)=>{
  if(!values.length)return;
  cols=Math.min(cols,values.length);const rows=Math.ceil(values.length/cols),cw=w/cols,ch=h/rows;
  values.forEach((v,i)=>item(v,x+(i%cols)*cw+8,y+Math.floor(i/cols)*ch+5,cw-17,ch-10,
   Math.min(40,Math.max(28,ch*.33))));
 };
 const top=()=>{
  shade(0,0,900,265,"rgba(5,13,22,.84)","rgba(5,13,22,0)");
  headline();
 };
 const bottom=(y=921)=>{
  shade(0,y,900,1200-y,"rgba(6,13,21,0)","rgba(5,12,21,.92)");
  grid(35,972,833,219,data.claims,2);
 };
 switch(index){
  case 0: top();bottom();break; // main title plus horizontal icon benefits
  case 1:
   shade(0,0,510,1200,"rgba(4,13,23,.93)","rgba(4,13,23,0)",true);
   headline(40,70,485,165,54);column(38,315,340,746);break;
  case 2:
   shade(370,0,530,1200,"rgba(5,13,22,0)","rgba(5,13,22,.94)",true);
   headline(416,70,442,163,52,"right");column(548,326,320,748);break;
  case 3:
   shade(0,0,520,1200,"rgba(3,15,27,.92)","rgba(3,15,27,0)",true);
   headline(39,69,810,158,61);column(37,300,349,800,data.claims,53);break;
  case 4: top();shade(0,900,900,300,"rgba(13,20,24,0)","rgba(13,20,24,.83)");grid(33,966,833,227,data.claims,2);break;
  case 5:
   shade(0,0,900,285,"rgba(9,11,20,.88)","rgba(9,11,20,0)");
   shade(0,825,900,375,"rgba(6,9,18,0)","rgba(6,9,18,.92)");
   ctx.strokeStyle=accent;ctx.lineWidth=3;ctx.strokeRect(23,22,853,1155);
   headline(52,79,791,149,56);grid(37,958,820,229,data.claims,2);break;
  case 6:
   shade(0,0,525,1200,"rgba(3,15,28,.94)","rgba(3,15,28,0)",true);
   headline(39,72,804,151,63);
   column(35,313,351,663,data.claims.slice(0,4),52);
   if(data.claims.length>4){panel(0,1025,900,175,.76);grid(48,1034,805,155,data.claims.slice(4),2);}
   break;
  case 7: top();shade(0,884,900,316,"rgba(14,14,19,0)","rgba(14,14,19,.88)");grid(32,974,836,215,data.claims,2);break;
  case 8: top();bottom(860);break;
  case 9:
   // Details must refer to real user-supplied facts, not duplicate circular photos
   // pretending to be independent close-up shots.
   shade(0,0,505,1200,"rgba(5,13,22,.9)","rgba(5,13,22,0)",true);
   headline(41,72,816,157,58);
   column(40,330,330,475,data.claims.slice(0,2),45);
   if(data.claims.length>2){
    shade(0,887,900,313,"rgba(5,13,22,0)","rgba(5,13,22,.9)");
    grid(43,971,814,210,data.claims.slice(2),2);
   }
   ctx.fillStyle=accent;ctx.fillRect(41,822,107,5);
   break;
  case 10: top();bottom(851);break;
  case 11:
   top();
   if(data.claims.length<=4){
    const positions=[[38,335],[548,335],[38,942],[548,942]];
    data.claims.forEach((v,i)=>{
     const [xx,yy]=positions[i];round(ctx,xx,yy,323,109,20,"rgba(9,17,27,.7)");
     item(v,xx+13,yy+16,297,75,39);
    });
   }else bottom(850);
   break;
  case 12:
   top();
   data.claims.slice(0,3).forEach((v,i)=>{
    const x=i%2?530:35,y=286+Math.floor(i/2)*135;
    round(ctx,x,y,334,108,20,"rgba(6,14,23,.71)");item(v,x+13,y+14,312,79,41);
   });
   if(data.claims.length>3){panel(0,943,900,257,.73);grid(37,978,831,206,data.claims.slice(3),2);}
   break;
  case 13:
   shade(0,0,490,1200,"rgba(5,11,19,.95)","rgba(5,11,19,0)",true);
   headline(40,86,490,173,52);column(37,343,356,750);break;
  case 14:
   shade(0,0,900,245,"rgba(2,8,17,.88)","rgba(2,8,17,0)");
   shade(0,0,511,1200,"rgba(2,9,18,.94)","rgba(2,9,18,0)",true);
   headline(38,76,817,162,65);column(34,330,323,691,data.claims.slice(0,5),49);
   if(data.claims.length>5){round(ctx,33,1058,458,102,18,"rgba(6,14,21,.74)");item(data.claims[5],44,1071,433,76,39);}
   break;
 }
 return {name:TEMPLATES[index].name,prepared:data};
}
root.SellerKitInfographic=Object.freeze({TEMPLATES,prepare,category,iconFor,draw});
})(window);
