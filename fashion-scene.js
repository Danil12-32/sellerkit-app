/* SellerKit Studio — fashion art direction. Free local variations never invoke the paid API.
   Person masking runs in the user's browser. If unavailable, a framed-photo layout is used. */
(function(root){
"use strict";
const CDN="https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747/";
let loader=null, lastKey="", lastResult=null;
function load(){
 if(root.SelfieSegmentation)return Promise.resolve();
 if(loader)return loader;
 loader=new Promise((resolve,reject)=>{
  const el=document.createElement("script");el.src=CDN+"selfie_segmentation.js";
  el.crossOrigin="anonymous";el.onload=()=>root.SelfieSegmentation?resolve():reject(new Error("Masking library unavailable"));
  el.onerror=()=>reject(new Error("Masking library blocked"));
  document.head.append(el);
 }).catch(e=>{loader=null;throw e;});
 return loader;
}
function canvas(w,h){const c=document.createElement("canvas");c.width=w;c.height=h;return c;}
function box(mask){
 const c=mask.getContext("2d",{willReadFrequently:true});
 const w=mask.width,h=mask.height,bytes=c.getImageData(0,0,w,h).data;
 let minX=w,minY=h,maxX=0,maxY=0,count=0,total=0;
 for(let y=0;y<h;y+=5)for(let x=0;x<w;x+=5){
  const a=bytes[(y*w+x)*4+3];total++;
  if(a>145){count++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
 }
 if(count/total<.065||count/total>.82||maxX-minX<40||maxY-minY<80)return null;
 const pad=7;
 return {x:Math.max(0,minX-pad),y:Math.max(0,minY-pad),w:Math.min(w-1,maxX+pad)-Math.max(0,minX-pad),h:Math.min(h-1,maxY+pad)-Math.max(0,minY-pad)};
}
async function extract(img,key){
 const id=String(key||"").length+":"+String(key||"").slice(-180);
 if(lastKey===id)return lastResult;
 try{
  await Promise.race([load(),new Promise((_,reject)=>setTimeout(()=>reject(Error("timeout")),11000))]);
  const w=540,h=Math.max(480,Math.round(540*img.naturalHeight/img.naturalWidth));
  const input=canvas(w,h),src=input.getContext("2d");src.drawImage(img,0,0,w,h);
  const selfie=new root.SelfieSegmentation({locateFile:file=>CDN+file});
  selfie.setOptions({modelSelection:0,selfieMode:false});
  let completed=false;
  const result=await Promise.race([
   new Promise((resolve,reject)=>{
    selfie.onResults(res=>{
     if(completed)return;completed=true;
     try{
      const out=canvas(w,h),g=out.getContext("2d");
      g.drawImage(res.segmentationMask,0,0,w,h);
      g.globalCompositeOperation="source-in";g.drawImage(input,0,0,w,h);
      g.globalCompositeOperation="source-over";
      const bounds=box(out);
      resolve(bounds?{layer:out,bounds,mode:"cutout"}:null);
     }catch(e){reject(e);}
    });
    selfie.send({image:input}).catch(reject);
   }),
   new Promise((_,reject)=>setTimeout(()=>reject(Error("segmentation timeout")),14000))
  ]);
  if(typeof selfie.close==="function")selfie.close();
  lastKey=id;lastResult=result;return result;
 }catch(e){lastKey=id;lastResult=null;return null;}
}
function rr(ctx,x,y,w,h,r,fill){
 ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=fill;ctx.fill();
}
function fit(ctx,str,maxWidth,size=40,min=18,maxLines=4){
 let found=null;
 for(let px=size;px>=min;px--){
  ctx.font="800 "+px+"px Arial, sans-serif";
  const words=String(str||"").split(/\s+/).filter(Boolean),lines=[];let row="";
  for(const word of words){
   const next=row?row+" "+word:word;
   if(ctx.measureText(next).width<=maxWidth){row=next;continue;}
   if(row)lines.push(row);
   row=word;
  }
  if(row)lines.push(row);
  if(lines.length<=maxLines&&lines.every(v=>ctx.measureText(v).width<=maxWidth)){found={px,lines};break;}
 }
 if(!found)return null;
 return found;
}
function label(ctx,str,x,y,w,opts={}){
 const f=fit(ctx,str,w,opts.size||35,opts.min||16,opts.lines||3);
 if(!f)return;
 ctx.save();ctx.textBaseline="top";ctx.fillStyle=opts.color||"#281F1B";
 ctx.font="800 "+f.px+"px Arial,sans-serif";
 f.lines.forEach((line,i)=>ctx.fillText(line,x,y+i*f.px*1.12));ctx.restore();
 return f.lines.length*f.px*1.12;
}
function numberFrom(value){
 return String(value).match(/(?:\d{1,3}\s*[–-]\s*\d{1,3}|\d{1,3}\s*%|\d+(?:[,.]\d+)?\s*(?:см|мм|кг|г))/i);
}
function badge(ctx,str,x,y,w,h,theme="light"){
 if(!str)return;
 const dark=theme!=="light",p=dark?"rgba(22,26,29,.93)":"rgba(255,250,244,.94)",ink=dark?"#FFFFFF":"#272421";
 ctx.save();ctx.shadowColor="rgba(20,15,12,.18)";ctx.shadowBlur=26;ctx.shadowOffsetY=12;
 rr(ctx,x,y,w,h,23,p);ctx.restore();
 rr(ctx,x+19,y+23,47,5,2,dark?"#DEB48C":"#D29A99");
 const n=numberFrom(str);
 if(n){
  label(ctx,n[0],x+20,y+37,w-38,{size:51,min:25,lines:1,color:ink});
  const sub=String(str).replace(n[0],"").replace(/^[\s:,—-]+/,"").trim();
  if(sub)label(ctx,sub,x+21,y+h-40,w-38,{size:21,min:14,lines:2,color:ink});
 }else label(ctx,str,x+21,y+40,w-42,{size:29,min:18,lines:3,color:ink});
}
function bg(ctx,index){
 const W=900,H=1200;
 const grad=ctx.createLinearGradient(index===19?900:0,0,index===20?0:900,1200);
 const colors=index===19?["#f7dde2","#faeee7","#dcc4bd"]:index===20?["#26292b","#5b4d49","#b39a83"]:["#f6e9d7","#e8d5bf","#fbf4ea"];
 colors.forEach((c,i)=>grad.addColorStop(i/2,c));
 ctx.fillStyle=grad;ctx.fillRect(0,0,W,H);
 ctx.save();ctx.globalAlpha=index===20?.08:.12;
 ctx.strokeStyle=index===20?"#FFFFFF":"#5E453A";ctx.lineWidth=1;
 for(let n=0;n<17;n++){ctx.beginPath();ctx.moveTo(n*65-140,0);ctx.lineTo(n*65+450,1200);ctx.stroke();}
 ctx.restore();
 const shine=ctx.createRadialGradient(index===20?780:680,400,20,450,620,810);
 shine.addColorStop(0,"rgba(255,255,255,.55)");shine.addColorStop(1,"rgba(255,255,255,0)");
 ctx.fillStyle=shine;ctx.fillRect(0,0,W,H);
 rr(ctx,index===19?38:45,250,index===19?824:808,905,33,
  index===20?"rgba(255,255,255,.08)":"rgba(255,255,255,.13)");
}
function subject(ctx,img,mask,index){
 if(mask){
  const {layer,bounds}=mask;
  const region=index===19?{x:226,y:260,w:722,h:955}:index===20?{x:-62,y:276,w:740,h:970}:{x:155,y:262,w:760,h:955};
  const scale=Math.min(region.w/bounds.w,region.h/bounds.h);
  const w=bounds.w*scale,h=bounds.h*scale;
  const x=region.x+(region.w-w)/2,y=region.y+(region.h-h);
  ctx.save();ctx.shadowColor="rgba(40,25,20,.21)";ctx.shadowBlur=44;ctx.shadowOffsetY=22;
  ctx.drawImage(layer,bounds.x,bounds.y,bounds.w,bounds.h,x,y,w,h);ctx.restore();
 }else{
  // Honest fallback: present the entire photograph as a visible frame.
  // Never pretend that the background behind a person was replaced.
  const region=index===19?{x:259,y:277,w:590,h:826}:index===20?{x:32,y:287,w:620,h:833}:{x:200,y:300,w:640,h:840};
  const iw=img.naturalWidth||img.width,ih=img.naturalHeight||img.height;
  const scale=Math.max(region.w/iw,region.h/ih);
  ctx.save();ctx.shadowColor="rgba(30,17,15,.3)";ctx.shadowBlur=38;ctx.shadowOffsetY=16;
  rr(ctx,region.x-7,region.y-7,region.w+14,region.h+14,27,"rgba(255,255,255,.8)");ctx.restore();
  ctx.save();ctx.beginPath();ctx.roundRect(region.x,region.y,region.w,region.h,22);ctx.clip();
  ctx.drawImage(img,region.x+(region.w-iw*scale)/2,region.y+(region.h-ih*scale)/2,iw*scale,ih*scale);
  ctx.restore();
 }
}
function draw(ctx,img,{index=18,title="",claims=[],mask=null}={}){
 const raw=String(title).trim();
 const m=raw.match(/худи|свитер|джемпер|кофт[а-я]*|куртк[а-я]*|футболк[а-я]*|плать[а-я]*|брюк[а-я]*|шорт[а-я]*/i);
 const big=(m?m[0]:raw).toLocaleUpperCase("ru-RU");
 const extra=(m?raw.replace(m[0],"").trim(): "").replace(/^женск[а-я]*\b/i,"").trim();
 bg(ctx,index);
 const ink=index===20?"#F7F1E8":"#332923",light=index!==20;
 // Large headline is painted BEFORE the subject, so it never sits on the model's face.
 label(ctx,big,47,77,810,{size:144,min:60,lines:1,color:ink});
 if(extra)label(ctx,extra.toUpperCase(),53,226,700,{size:26,min:17,lines:2,color:ink});
 ctx.save();ctx.fillStyle=index===19?"#DF9EA8":index===20?"#C2AB92":"#B69972";
 ctx.fillRect(51,205,118,8);ctx.restore();
 subject(ctx,img,mask,index);
 const c=claims.slice(0,3);
 const pos=index===19?[[35,452,248,154],[35,714,258,155],[43,974,313,147]]:
   index===20?[[615,456,268,154],[603,731,284,154],[600,970,282,145]]:
   [[22,450,254,151],[632,691,250,158],[37,986,338,154]];
 c.forEach((v,i)=>badge(ctx,String(v).toUpperCase(),...pos[i],light?"light":"dark"));
 // Hairlines and product-style editorial details.
 ctx.fillStyle=light?"rgba(74,45,36,.5)":"rgba(255,255,255,.5)";
 ctx.fillRect(46,1171,808,2);
}
root.SellerKitFashion=Object.freeze({extract,draw});
})(window);
