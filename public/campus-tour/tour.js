import * as T from './vendor/three.module.min.js';

const renderer = new T.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));
renderer.setSize(innerWidth,innerHeight);
renderer.xr.enabled=true;
document.body.prepend(renderer.domElement);
const scene=new T.Scene(), rig=new T.Group(), camera=new T.PerspectiveCamera(70,innerWidth/innerHeight,.08,480);
scene.add(rig); rig.add(camera);
scene.background=new T.Color(0xb6d9e4); scene.fog=new T.FogExp2(0xcadfe1,.0032);
scene.add(new T.HemisphereLight(0xfffaf0,0xa99e87,1.38));
const sun=new T.DirectionalLight(0xfff8eb,2.0); sun.position.set(-55,85,42);scene.add(sun);
renderer.shadowMap.enabled=true;
renderer.shadowMap.autoUpdate=false;
renderer.shadowMap.needsUpdate=true;
sun.castShadow=true;
Object.assign(sun.shadow.camera,{left:-108,right:108,top:102,bottom:-102,near:.5,far:280});
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.mapSize.set(2048,2048);sun.shadow.normalBias=.055;
// A daylight gradient keeps distant rooflines legible against the horizon.
const sky=new T.Mesh(new T.SphereGeometry(370,32,16),new T.ShaderMaterial({
 side:T.BackSide,depthWrite:false,
 vertexShader:'varying vec3 ray;void main(){ray=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
 fragmentShader:'varying vec3 ray;void main(){float t=smoothstep(-.05,.8,normalize(ray).y);gl_FragColor=vec4(mix(vec3(.83,.88,.88),vec3(.38,.65,.86),t),1.);}'
}));sky.renderOrder=-1;scene.add(sky);
const cube=new T.BoxGeometry(), leaf=new T.IcosahedronGeometry(1,1), round=new T.CylinderGeometry(1,1,1,28);
const batches=new Map(), blocks=[], dummy=new T.Object3D();
function mesh(shape,color,x,y,z,w,h,d,angle=0){
 const key=shape.uuid+color;
 if(!batches.has(key)) batches.set(key,{shape,color,matrices:[]});
 dummy.position.set(x,y,z);dummy.rotation.set(0,angle,0);dummy.scale.set(w,h,d);dummy.updateMatrix();
 batches.get(key).matrices.push(dummy.matrix.clone());
}
const box=(...v)=>mesh(cube,...v);
const wall=0xe5e8e7, trim=0xf4f1e7, glass=0x526a70, roof=0xc96e62;
let seed=48;function random(){seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;}
// Cutout leaf clusters give the roadside trees a fine, irregular canopy at eye level.
const foliagePlane=new T.PlaneGeometry(), foliageColour=0x698150;
const canopy=document.createElement('canvas');canopy.width=canopy.height=192;
const brush=canopy.getContext('2d');
for(let i=0;i<4600;i++){
 const theta=random()*Math.PI*2,r=Math.sqrt(random());
 const edge=1+.09*Math.cos(theta*7)+.065*Math.sin(theta*11);
 const x=96+Math.cos(theta)*78*r*edge,y=96+Math.sin(theta)*74*r*edge;
 const light=Math.floor(37+random()*30+(1-y/192)*17);
 brush.fillStyle='hsl('+Math.floor(72+random()*26)+' 30% '+light+'%)';
 brush.beginPath();brush.ellipse(x,y,1+random()*3.4,1+random()*2.1,theta,0,Math.PI*2);brush.fill();
}
const canopyMap=new T.CanvasTexture(canopy);canopyMap.colorSpace=T.SRGBColorSpace;
function tree(x,z,size=1){
 mesh(round,0x71634f,x,2.1*size,z,.29*size,4.2*size,.28*size);
 for(let i=0;i<7;i++){
  const a=i*2.4,rad=(i%3)*.85*size;
  const cx=x+Math.cos(a)*rad,cz=z+Math.sin(a)*rad;
  for(let j=0;j<2;j++)mesh(foliagePlane,foliageColour,cx,(4.9+random()*1.3)*size,cz,5.2*size,4.3*size,1,a+j*1.57);
 }
}
function building(x,z,w,d,f,top=0xb8b8af,paint=wall){
 const h=f*3.25;
 blocks.push([x-w/2,z-d/2,x+w/2,z+d/2]);
 box(paint,x,h/2,z,w,h,d);box(top,x,h+.13,z,w+.4,.26,d+.4);
 for(let level=0;level<f;level++){
  const y=level*3.25+1.87;
  for(const side of [-1,1]){
   for(let i=1;i<=Math.floor(w/3.3);i++){let xx=x-w/2+i*w/(Math.floor(w/3.3)+1);
    box(glass,xx,y,z+side*(d/2+.045),1.35,1.4,.1);box(trim,xx,y-.78,z+side*(d/2+.13),1.65,.13,.3);}
   for(let i=1;i<=Math.floor(d/3.3);i++)box(glass,x+side*(w/2+.055),y,z-d/2+i*d/(Math.floor(d/3.3)+1),.12,1.35,1.36);
  }
 }
 return h;
}
box(0xbba57c,0,-.18,0,340,.3,320);
box(0x84975f,0,-.06,0,235,.09,216);
box(0xb79e84,0,.001,0,164,.04,99);
for(const x of [-73,-33,25,61])box(0xb6b3a7,x,.04,0,6,.06,101);
for(const z of [-46,28,46])box(0xbcb9ad,-5,.06,z,150,.05,5.6);
// Courtyard wings, canopy and recessed front bays.
// Build each frontage from actual openings, projecting brows and inset bays.
function frontage(x,z,width,floors,bays,maroonEnds){
 const depth=8,height=floors*3.25, bay=width/bays;
 blocks.push([x-width/2,z-depth,x+width/2,z]);
 box(wall,x,height/2,z-depth/2-1,width,height,depth-2);
 for(let row=0;row<floors;row++){
  const base=row*3.25;
  box(wall,x,base+.51,z-.48,width,1.02,.96);
  box(wall,x,base+2.91,z-.48,width,.68,.96);
  for(let i=0;i<bays;i++){
   const cx=x-width/2+(i+.5)*bay, end=i===0||i===bays-1;
   box(wall,cx-bay*.5+.32,base+1.8,z-.5,.64,1.9,1);
   box(maroonEnds&&end?0x78504a:0x3e5155,cx+.27,base+1.8,z-1.3,bay-.55,1.9,.12);
   if(!end){box(0x8e9995,cx+.25,base+1.8,z-1.2,.07,1.6,.1);}
  }
 }
 box(0xb3b0a7,x,height+.15,z-4,width+.35,.3,8.4);
}
function pitched(x,z,w,d,y){
 const slope=.14;
 for(const sign of [-1,1]){
  const sheet=new T.Mesh(cube,new T.MeshStandardMaterial({color:roof,roughness:.85}));
  sheet.scale.set(w,.16,d/2+.16);sheet.position.set(x,y+.35,z+sign*d/4);
  sheet.rotation.x=sign*slope;sheet.castShadow=true;scene.add(sheet);
 }
}
frontage(-3,13.5,44,3,13,false);
for(const x of [-24.5,18.5]){
 box(trim,x,5.4,13.65,2.8,10.8,.85);
 for(let i=-1;i<=1;i++)for(let row=0;row<3;row++)
 box(0x364548,x+i*.56,1.9+row*3.25,14.1,.24,2.12,.08);
 box(0x714943,x+(x<0?2:-2),5.05,13.63,1.4,10.1,.25);
}
building(-3,-19,44,8,4);pitched(-3,-19,44.6,8.6,13.2);
for(const x of [-21,15]){building(x,-5,8,22,4,roof);}
box(0x889859,-3,.09,-5,27,.1,20);
box(0xb9afa4,-3,.12,19,7,.16,12);
box(trim,-3,3.65,15.65,10,.55,5.6);
for(const x of [-7,1])for(const z of [14.7,17.9])box(trim,x,1.8,z,.58,3.6,.58);
box(0xa6a398,-3,10.95,8.1,11,2.3,4.2);
for(const x of [-7,-3,1])box(0x555d5a,x,10.95,10.24,1.7,1.35,.12);
for(const x of [-15,9])box(wall,x,10.65,7,2.2,1.7,2.3);
frontage(-51,12.3,28,4,9,true);
// Covered connecting passage between the academic blocks.
box(0xc3b3a7,-31,5.5,8,12,2.5,2.5);
box(0x765750,-31,6.85,8,12,.24,2.8);
building(-51,-9,28,15,4);building(-52,-32,33,9,6);
for(let i=0;i<9;i++)for(let j=0;j<4;j++)box(0x455462,-63+i*3,13.48,-14+j*3,2.65,.22,2.55);
for(const x of [-60,-42])box(roof,x,13.4,6,7,.32,6);
building(40,-22,19,12,5,roof);building(40,-5,19,12,5,roof);
pitched(40,-22,19.6,12.5,16.45);pitched(40,-5,19.6,12.5,16.45);
building(38,9,15,10,4);building(34,18,8,8,3);
building(-58,39,7,39,3);
building(-94,61,26,15,2,roof);pitched(-94,61,26.6,15.5,6.65);
box(0xc89065,-92,.07,24,29,.12,53);
// Exposed-frame silhouette as shown in the supplied imagery.
blocks.push([65,-27,88,1]);
for(let l=0;l<9;l++)box(0xaaa399,76.5,l*3.05+.2,-13,23,.45,28);
for(let i=0;i<6;i++)for(let j=0;j<6;j++)box(0xa09c92,65.5+i*4.4,12.3,-26.4+j*5.35,.64,24.6,.65);
box(0x837b70,76,11.8,-13,6,23.6,7);
// Stream, bridge, cricket pitch, hard courts, buses and footpaths.
box(0x658986,0,.1,-56,210,.1,7);
for(const x of [-73,25]){box(0xbab7a9,x,.2,-56,6,.42,10);for(const s of [-1,1])box(0x8c948c,x+s*2.9,.85,-56,.15,.75,10);}
mesh(round,0x96a466,28,.02,-84,31,.17,20);
box(0xc6ab80,28,.14,-84,3,.09,13);
function court(x,z){box(0xc18072,x,.07,z,14,.12,23);box(0x568699,x,.15,z,12,.08,21);
 for(const side of [-1,1]){box(trim,x+side*5.6,.21,z,.11,.04,20);box(trim,x,.21,z+side*10,11.3,.04,.11);}box(trim,x,.21,z,11.3,.04,.11);}
court(78,-83);
for(let i=0;i<8;i++){let x=-66+i*4.7;box(0xdbaf54,x,1.15,-76,2.6,2.3,8);box(0x445555,x,1.55,-76,2.64,.85,6.8);}
for(let i=0;i<19;i++){if((-69+i*7.3 < -65 || -69+i*7.3 > 10))tree(-69+i*7.3,36+random()*3,.78+random()*.4);tree(-69+i*7.3,-49,.7+random()*.3);}
for(let i=0;i<10;i++){tree(21,22-i*6.3,.68+random()*.22);tree(-77,34-i*7.6,.7+random()*.3);}
for(let i=0;i<50;i++){let x=random()*240-120;tree(x,93+random()*10,.85+random()*.5);}
// Shaded planted forecourt, with an open view along the entrance path.
for(const x of [-20,-11,8,17]){
 const z=21+random()*2;
 tree(x,z,.84+random()*.25);
 box(0xa69e89,x,.15,z,4.4,.3,3);
 for(let k=0;k<9;k++)mesh(leaf,0x657b47,x-1.8+k*.45,.45,z+.8,.55,.38,.5);
}
box(0x394c50,-3,1.45,13.99,3.6,2.9,.14);
for(const x of [-4.8,-3,-1.2])box(0x8c9999,x,1.45,14.1,.09,2.9,.12);
const paving=document.createElement('canvas');paving.width=paving.height=128;
const ctx=paving.getContext('2d');
ctx.fillStyle='#998e80';ctx.fillRect(0,0,128,128);
for(let row=0;row<8;row++)for(let col=-1;col<5;col++){
 const value=Math.floor(175+random()*25);
 ctx.fillStyle='rgb('+value+','+(value-4)+','+(value-11)+')';
 ctx.fillRect(col*32+(row%2)*16,row*16,31,15);
}
const paveMap=new T.CanvasTexture(paving);paveMap.colorSpace=T.SRGBColorSpace;
paveMap.wrapS=paveMap.wrapT=T.RepeatWrapping;paveMap.repeat.set(38,2);
const path=new T.Mesh(new T.PlaneGeometry(150,5.6),new T.MeshStandardMaterial({map:paveMap,roughness:1}));
path.rotation.x=-Math.PI/2;path.position.set(-5,.095,28);path.receiveShadow=true;scene.add(path);
// Entrance vignette based on the published gate and university marker photographs.
function entranceSign(words,x,y,z,width,height,background,ink){
 const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=256;
 const ctx=canvas.getContext('2d');ctx.fillStyle=background;ctx.fillRect(0,0,1024,256);
 ctx.fillStyle=ink;ctx.textAlign='center';ctx.textBaseline='middle';
 words.forEach((line,i)=>{
  ctx.font=i===0?'bold 86px Georgia':'34px sans-serif';
  ctx.fillText(line,512,words.length===1?128:92+i*94,955);
 });
 const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;
 const sign=new T.Mesh(new T.PlaneGeometry(width,height),new T.MeshBasicMaterial({map:texture}));
 sign.position.set(x,y,z);scene.add(sign);
}
const gateX=-3, gateZ=72;
// The entrance drive meets the frontage road directly opposite the portico.
box(0x676967,gateX,.11,51,10.6,.12,56);
box(0x676967,-5,.12,28,145,.12,5.5);
for(let x=-72;x<66;x+=7){
 if(Math.abs(x-gateX)>7)box(0xe7e1cf,x,.19,28,2.5,.02,.12);
}
entranceSign(['A BLOCK','COMPUTER SCIENCE'],gateX,4.55,13.65,7.6,1.55,'#214b73','#ffffff');
for(const side of [-1,1]){
 const x=gateX+side*7.2;
 blocks.push([x-1.9,gateZ-2.1,x+1.9,gateZ+2.1]);
 box(0xd9c5a7,x,1.65,gateZ,3.8,3.3,4.2);
 box(0xdbc9ae,x,3.42,gateZ,4.45,.27,4.85);
 box(0x826953,x,.28,gateZ,3.92,.56,4.28);
 box(0x4a6265,x,1.82,gateZ+2.13,2.8,1.34,.09);
 for(const dx of [-.94,0,.94])box(0xbbb29f,x+dx,1.82,gateZ+2.2,.07,1.35,.07);
 box(0x4a6265,x-side*1.94,1.82,gateZ,.08,1.34,2.9);
 for(let j=0;j<20;j++)box(j%2?0xd6ad45:0x454542,gateX+side*5.35,.16,gateZ-11+j*.93,.36,.29,.93);
 // Blue gate leaves pulled open along the sides of the driveway.
 const gx=gateX+side*4.95;
 for(let j=0;j<20;j++)box(0x275980,gx,1.55,gateZ-j*.22,.09,3.05,.07);
 for(const y of [.25,1.2,2.8])box(0x2d6389,gx,y,gateZ-2.1,.13,.13,4.4);
 tree(x+side*2,gateZ-5,1.25);
}
entranceSign(['SECURITY OFFICE'],gateX-7.2,2.92,gateZ+2.14,3.25,.49,'#d8c6a6','#443d35');
box(0x998c7b,gateX+14,1.52,gateZ+.8,8.6,3.04,.72);
entranceSign(['ANURAG UNIVERSITY','ANURAG GROUP OF INSTITUTIONS'],gateX+14,1.58,gateZ+1.19,7.95,2.36,'#214b82','#f1ede1');
blocks.push([gateX+9.7,gateZ+.4,gateX+18.3,gateZ+1.2]);
for(let i=0;i<8;i++)mesh(leaf,0x688554,gateX+10.4+i,.47,gateZ+1.8,.58,.5,.44);
// Sports quad, rotated to match the tour's existing front-facing coordinate system.
function playingSurface(x,z,w,d,color){
 box(color,x,.17,z,w,.12,d);
 for(const sign of [-1,1]){
  box(trim,x+sign*(w/2-.35),.25,z,.1,.035,d-.7);
  box(trim,x,.25,z+sign*(d/2-.35),w-.7,.035,.1);
 }
 box(trim,x,.25,z,w-.7,.035,.1);
}
playingSurface(-21,56,19,13,0xba8865);
for(const x of [-31,-11])box(0x696c68,x,1.22,56,.12,2.44,.12);
for(let i=0;i<10;i++)box(trim,-21,1.55+i*.085,56,20,.022,.022);
for(let i=0;i<90;i++)box(trim,-31+i*.225,1.94,56,.016,.8,.016);
playingSurface(-43,56,12,18,0x397890);
for(const z of [47.3,64.7]){
 box(0x606865,-43,1.65,z,.14,3.3,.14);
 box(trim,-43,3.3,z,1.6,.98,.09);
 const hoop=new T.Mesh(new T.TorusGeometry(.29,.035,6,18),new T.MeshStandardMaterial({color:0xba5330}));
 hoop.rotation.x=Math.PI/2;hoop.position.set(-43,3.02,z+Math.sign(56-z)*.35);scene.add(hoop);
}
playingSurface(-43,36,12,12,0xb68b6d);
for(const offset of [-3,3])box(trim,-43,.25,36+offset,11.3,.035,.1);
box(0x84974e,-21,.18,36,19,.12,10);
for(const [name,x,z,h] of [['B BLOCK',-51,12.4,5],['D BLOCK',-51,-1.35,8],['H BLOCK',-52,-27.35,13],['C BLOCK',-58,58.6,6],['E BLOCK',40,1.1,10],['G BLOCK',38,14.1,7]]){
 entranceSign([name],x,h,z,4.5,1,'#28475a','#f8f5e9');
}
for(const [label,x,z] of [['VOLLEYBALL',-30,63],['BASKETBALL',-43,66],['KABADDI',-43,43],['FOOTBALL GROUND',-90,49]]){
 box(0x575a50,x,.9,z,.12,1.8,.12);entranceSign([label],x,1.55,z+.09,3.5,.65,'#405746','#fff');
}
for(const b of batches.values()){
 const leafy=b.shape===foliagePlane;
 const surface=leafy?new T.MeshStandardMaterial({map:canopyMap,color:0xa6b79a,alphaTest:.48,side:T.DoubleSide,roughness:1}):new T.MeshStandardMaterial({color:b.color,roughness:.92});
 if(!leafy){
  // Anchor subtle paint and aggregate variation in metres across repeated meshes.
  surface.onBeforeCompile=shader=>{
   shader.vertexShader='varying vec3 tourWorld;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n tourWorld=(instanceMatrix*vec4(position,1.0)).xyz;');
   shader.fragmentShader='varying vec3 tourWorld; float grain(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,43.149)))*43758.5453);}\n'+shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\n float fine=grain(floor(tourWorld*19.));float fade=1.-smoothstep(6.,26.,distance(cameraPosition,tourWorld));diffuseColor.rgb*=.97+.055*sin(tourWorld.x*.71+sin(tourWorld.z*.48))*cos(tourWorld.y*1.12+tourWorld.z*.19)+fade*.105*(fine-.5);');
  };
 }
 const inst=new T.InstancedMesh(b.shape,surface,b.matrices.length);
 inst.castShadow=true;inst.receiveShadow=true;
 b.matrices.forEach((m,i)=>inst.setMatrixAt(i,m));scene.add(inst);
}
const stops=[
 ['Front gate',gateX,85,0],['A Block - Computer Science',gateX,30,0],['D Block - solar roof',-42,25,.32],['E and G Blocks',25,22,-.58],
 ['Ermulli Vagu',25,-43,0],['Cricket ground',12,-69,-.76],['Sports quad',-13,65,.63],['C Block',-54,66,.25],['Football ground',-80,48,.6],['APJ auditorium',-82,76,.65]];
const $=id=>document.getElementById(id), keys=new Set();
let yaw=0,pitch=0,active=false,last=0,turnReady=true;
const head=new T.Vector3(),direction=new T.Vector3(),quat=new T.Quaternion();
const mode=$('mode'),status=$('status');
const rings=[[gateX,28],[25,28],[25,-42]].map(([x,z])=>{
 const m=new T.Mesh(new T.TorusGeometry(.8,.12,10,32),new T.MeshBasicMaterial({color:0xffbb32}));
 m.position.set(x,1.5,z);scene.add(m);return m;
});
let collected=0,seconds=120,phase=0,finished=false;
function resetRound(){
 collected=0;seconds=120;finished=false;visit(0);$('stops').value='0';
 const survival=mode.value==='survival';$('stops').disabled=survival;
 rings.forEach((m,i)=>m.visible=survival&&i===0);
 $('notice').textContent=survival?'Collect three gold rings before the two-minute timer expires.':'Space to rise, Shift to descend. On Quest, use the right stick vertically.';
 status.textContent='ANURAG UNIVERSITY';
}
mode.onchange=resetRound;
function makeHand(sign){
 const group=new T.Group();
 // Elliptical cross sections form a tapered wrist, broad knuckles and curled fingertips.
 const skin=new T.MeshStandardMaterial({color:0xb58168,roughness:.78});
 const cuff=new T.MeshStandardMaterial({color:0x384c59,roughness:.98});
 const nail=new T.MeshStandardMaterial({color:0xca9986,roughness:.55});
 function contour(rows,material){
  const vertices=[],indices=[],sides=12;
  for(const [x,y,z,w,h] of rows)for(let j=0;j<sides;j++){
   const a=j*Math.PI*2/sides;vertices.push(sign*x+w*Math.cos(a),y+h*Math.sin(a),z);
  }
  for(let i=1;i<rows.length;i++)for(let j=0;j<sides;j++){
   const a=(i-1)*sides+j,b=(i-1)*sides+(j+1)%sides;
   indices.push(a,a+sides,b,b,a+sides,b+sides);
  }
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(vertices,3));
  geometry.setIndex(indices);geometry.computeVertexNormals();material.side=T.DoubleSide;
  group.add(new T.Mesh(geometry,material));
 }
 contour([[.045,-.045,.24,.054,.046],[.025,-.022,.15,.046,.042],[.006,-.006,.065,.036,.031],[.006,-.006,.058,.037,.032]],cuff);
 contour([[.006,-.006,.065,.033,.029],[0,0,.028,.031,.024],[-.003,.002,-.005,.044,.025],[0,.003,-.045,.048,.022],[0,.002,-.068,.044,.019],[0,.001,-.074,.032,.012]],skin);
 for(const [x,len,r] of [[-.032,.079,.011],[-.01,.086,.011],[.012,.078,.0105],[.033,.061,.009]]){
  const z=-.062+Math.abs(x)*.22;
  contour([[x,.002,z,r,.015],[x*1.1,.005,z-len*.35,r,.012],[x*1.19,-.003,z-len*.65,r*.89,.01],[x*1.24,-.014,z-len*.91,r*.77,.008],[x*1.24,-.018,z-len,.001,.001]],skin);
  const tip=new T.Mesh(new T.SphereGeometry(1,8,6),nail);tip.scale.set(r*.53,.002,.0065);tip.position.set(sign*x*1.23,-.003,z-len*.85);tip.rotation.x=-.4;group.add(tip);
 }
 contour([[-.018,-.003,.006,.012,.012],[-.037,-.006,-.012,.019,.017],[-.052,-.012,-.035,.014,.014],[-.058,-.016,-.052,.012,.011],[-.061,-.021,-.064,.002,.003]],skin);
 return group;
}
const hands=[-1,1].map((sign,i)=>{
 const hand=makeHand(sign);camera.add(hand);
 const grip=renderer.xr.getControllerGrip(i);rig.add(grip);
 grip.addEventListener('connected',e=>{grip.clear();grip.add(makeHand(e.data.handedness==='left'?-1:1));});
 grip.addEventListener('disconnected',()=>grip.clear());return hand;
});
function visit(i){const [,x,z,a]=stops[i];rig.position.set(x,0,z);yaw=a;pitch=.12;rig.rotation.y=yaw;camera.position.set(0,1.65,0);camera.rotation.set(pitch,0,0);}
stops.forEach(([name],i)=>$('stops').add(new Option(name,i)));$('stops').onchange=e=>visit(+e.target.value);resetRound();
function blocked(x,z){
 if(x < -112 || x>99 || z < -103 || z>87)return true;
 if(rig.position.y<2 && Math.abs(z+56)<3.8 && Math.min(Math.abs(x+73),Math.abs(x-25))>2.55)return true;
 if(mode.value==='creative' && rig.position.y>=28)return false;
 return blocks.some(([a,b,c,d])=>x>a-.38 && x<c+.38 && z>b-.38 && z<d+.38);
}
function move(dx,dz,h){
 if(!blocked(h.x+dx,h.z)){rig.position.x+=dx;h.x+=dx;}
 if(!blocked(h.x,h.z+dz))rig.position.z+=dz;
}
function setActive(value){active=value;document.body.classList.toggle('active',value);keys.clear();$('hint').textContent=value?'WASD to walk   ·   Mouse or drag to look   ·   Esc to pause':'';}
function beginWalk(){
 if(finished)resetRound();
 setActive(true);
 renderer.domElement.focus();
 try { renderer.domElement.requestPointerLock?.()?.catch(()=>{}); } catch {}
}
renderer.domElement.tabIndex=0;
$('walk').onclick=beginWalk;
renderer.domElement.onclick=()=>{if(!active&&!renderer.xr.isPresenting)beginWalk();};
document.addEventListener('pointerlockchange',()=>setActive(!!document.pointerLockElement));
document.addEventListener('mousemove',e=>{
 if(!active || (!document.pointerLockElement && !(e.buttons & 1)))return;
 yaw-=e.movementX*.002;
 pitch=T.MathUtils.clamp(pitch-e.movementY*.002,-1.25,1.25);
 rig.rotation.y=yaw;camera.rotation.x=pitch;
});
window.onkeydown=e=>{
 if(!active)return;
 if(e.code==='Escape'){document.exitPointerLock?.();setActive(false);return;}
 e.preventDefault();keys.add(e.code);
};
window.onkeyup=e=>keys.delete(e.code);window.onblur=()=>keys.clear();
const vr=$('vr');
async function detect(){let ok=false;try{ok=await navigator.xr?.isSessionSupported('immersive-vr');}catch{}vr.disabled=!ok;vr.textContent=ok?'Enter Meta Quest':'VR · headset required';}
detect();
vr.onclick=async()=>{try{if(finished)resetRound();const session=await navigator.xr.requestSession('immersive-vr',{requiredFeatures:['local-floor']});renderer.xr.setReferenceSpaceType('local-floor');camera.position.y=0;camera.rotation.x=0;await renderer.xr.setSession(session);session.addEventListener('end',()=>{visit(+$('stops').value);});}catch(e){visit(+$('stops').value);$('notice').textContent=e.message;}};
function dead(v){return Math.abs(v)>.17?v:0;}
renderer.setAnimationLoop(time=>{
 const dt=Math.min(.05,(time-last)/1000);last=time;
 const playing=active||renderer.xr.isPresenting,creative=mode.value==='creative';
 let lift=Number(keys.has('Space'))-Number(keys.has('ShiftLeft')||keys.has('ShiftRight'));
 let side=0,forward=0,angle=yaw;
 head.copy(rig.position);
 if(renderer.xr.isPresenting){
  const xrCamera=renderer.xr.getCamera();xrCamera.getWorldPosition(head);xrCamera.getWorldQuaternion(quat);direction.set(0,0,-1).applyQuaternion(quat);angle=Math.atan2(-direction.x,-direction.z);
  for(const input of renderer.xr.getSession().inputSources){
   const axes=input.gamepad?.axes;if(!axes?.length)continue;
   const x=axes[axes.length-2],y=axes[axes.length-1];
   if(input.handedness==='left'){side=dead(x);forward=-dead(y);}
   if(input.handedness==='right'){lift=-dead(y);if(Math.abs(x)>.7&&turnReady){const spin=-Math.sign(x)*Math.PI/6;
    rig.position.sub(head).applyAxisAngle(up,spin).add(head);rig.rotation.y+=spin;turnReady=false;}if(Math.abs(x)<.3)turnReady=true;}
  }
 }else if(active){side=Number(keys.has('KeyD'))-Number(keys.has('KeyA'));forward=Number(keys.has('KeyW'))-Number(keys.has('KeyS'));}
 if(creative&&playing){
 const old=rig.position.y;rig.position.y=T.MathUtils.clamp(old+lift*7*dt,0,65);
 if(lift<0&&blocked(head.x,head.z))rig.position.y=old;
 }
 const speed=dt*(creative?7:4.3)/Math.max(1,Math.hypot(side,forward));
 const inside=renderer.xr.isPresenting&&blocked(head.x,head.z);
 if(!inside)move((side*Math.cos(angle)-forward*Math.sin(angle))*speed,(-side*Math.sin(angle)-forward*Math.cos(angle))*speed,head);
 phase+=Math.hypot(side,forward)*dt*8;
 hands.forEach((hand,i)=>{const sign=i===0?-1:1;
 hand.visible=active&&!renderer.xr.isPresenting;
 hand.position.set(sign*.18,-.174+sign*Math.sin(phase)*.014,-.41+sign*Math.cos(phase)*.025);
 hand.rotation.set(.19,sign*.60,sign*.32);});
 if(playing&&creative)status.textContent='Creative | Altitude '+Math.round(rig.position.y)+' m';
 if(playing&&!creative&&!finished){
 seconds=Math.max(0,seconds-dt);const ring=rings[collected];ring.rotation.y+=dt;
 const distance=Math.hypot(head.x-ring.position.x,head.z-ring.position.z);
 status.textContent='Ring '+(collected+1)+'/3 | '+Math.ceil(distance)+' m | '+Math.ceil(seconds)+' s';
 if(distance<2){ring.visible=false;collected++;if(collected<3)rings[collected].visible=true;}
 if(collected===3||seconds===0){finished=true;status.textContent=collected===3?'All rings collected!':'Time up';
 document.exitPointerLock?.();setActive(false);if(renderer.xr.isPresenting)renderer.xr.getSession().end();}
 }
 renderer.autoClear=true;
 renderer.render(inside?blank:scene,camera);
});
const up=new T.Vector3(0,1,0), blank=new T.Scene();blank.background=new T.Color(0x142025);
onresize=()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);};
