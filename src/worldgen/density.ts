import {DENSITY_JSON,NOISE_SETTINGS} from './data.generated';
import {NormalNoise,BlendedNoise} from './noise';
import {PositionalRandomFactory,Xoroshiro128PlusPlus} from './random';
export interface DensityContext{x:number;y:number;z:number;}
export type Density=(p:DensityContext)=>number;
/** Compiles the bundled Minecraft density JSON (generated from the vanilla data pack). Blend values and beardifier are explicit stubs. */
export class DensityFunctionCompiler{
 private definitions=new Map<string,any>();private compiled=new Map<string,Density>();private noises=new Map<string,NormalNoise>();
 /** RandomState.random: Xoroshiro(seed).forkPositional(), shared by every noise and BlendedNoise. */
 private readonly factory:PositionalRandomFactory;
 /** RandomState.random (root positional factory); also used by the surface system. */
 get rootFactory():PositionalRandomFactory{return this.factory;}
 /** RandomState.getOrCreateRandomFactory(name) = random.fromHashOf(name).forkPositional(). */
 randomFactoryFor(name:string):PositionalRandomFactory{return this.factory.fromHashOf(name).forkPositional();}
 constructor(private readonly seed:number){this.factory=Xoroshiro128PlusPlus.fromSeed(BigInt(seed)).forkPositional();for(const [n,j] of Object.entries(DENSITY_JSON))this.definitions.set('minecraft:'+n,j);}
 compileRoot(name='minecraft:overworld/final_density'):Density{return this.compileRef(name);}
 compileRef(name:string):Density{
  if(this.compiled.has(name))return this.compiled.get(name)!;const v=this.definitions.get(name);
  if(v===undefined){if(name==='minecraft:zero')return()=>0;if(name==='minecraft:y')return p=>p.y;if(name.startsWith('minecraft:overworld/caves/'))return()=>1e6;if(name==='minecraft:beardifier'||name==='minecraft:blend_offset')return()=>0;if(name==='minecraft:blend_alpha')return()=>1;if(name==='minecraft:blend_density')return p=>p.y;throw new Error('Unknown density function: '+name);}
  const f=this.compile(v);this.compiled.set(name,f);return f;
 }
 private compile(v:any):Density{
  if(typeof v==='number')return()=>v;if(typeof v==='string')return this.compileRef(v);if(!v||typeof v!=='object')return()=>0;
  const t=String(v.type??'').replace(/^minecraft:/,''),c=(k:string)=>this.compile(v[k]),input=()=>c('input');
  switch(t){
   case'constant':return()=>Number(v.argument??v.value??0);
   case'y':return p=>p.y;
   case'zero':return()=>0;
   case'cache':case'cache_2d':case'cache_once':return this.cacheNode(v.input,input());
   case'interpolated':return this.interpolate(input(),Number(v.cell_size_xz??4),Number(v.cell_size_y??8));
   case'noise':{const n=this.getNoise(String(v.noise).replace(/^minecraft:/,'')),sx=Number(v.xz_scale??1),sy=Number(v.y_scale??1),shx=v.shift_x?c('shift_x'):()=>0,shz=v.shift_z?c('shift_z'):()=>0;return p=>n.sample(p.x*sx+shx(p),p.y*sy,p.z*sx+shz(p));}
   case'shift_a':{const n=this.getNoise(String(v.noise).replace(/^minecraft:/,''));return p=>n.sample(p.x*.25,0,p.z*.25)*4;}
   case'shift_b':{const n=this.getNoise(String(v.noise).replace(/^minecraft:/,''));return p=>n.sample(p.z*.25,p.x*.25,0)*4;}
   case'shift':{const n=this.getNoise(String(v.noise).replace(/^minecraft:/,''));return p=>n.sample(p.x*.25,p.y*.25,p.z*.25)*4;}
   case'blend_density':return input();case'blend_alpha':return()=>1;case'blend_offset':case'beardifier':return()=>0;
   case'old_blended_noise':{const b=new BlendedNoise(this.factory.fromHashOf('minecraft:terrain'),Number(v.xz_scale??.25),Number(v.y_scale??.125),Number(v.xz_factor??80),Number(v.y_factor??160),Number(v.smear_scale_multiplier??8));return p=>b.sample(p.x,p.y,p.z);}
   case'spline':return this.compileSpline(v.spline);
   case'find_top_surface':{const dens=c('density'),ub=c('upper_bound'),lb=Number(v.lower_bound??0),ch=Math.max(1,Number(v.cell_height??8));return p=>{const top=Math.floor(ub(p)/ch)*ch;if(top<=lb)return lb;for(let y=top;y>=lb;y-=ch)if(dens({x:p.x,y,z:p.z})>0)return y;return lb;};}
   case'distance_to_point':return p=>Math.hypot(p.x-Number(v.x??0),p.y-Number(v.y??0),p.z-Number(v.z??0));
   case'slice':{const y=Number(v.y??0),f=input();return p=>f({...p,y});}
   case'gradient':{const a=Number(v.from_coordinate),b=Number(v.to_coordinate),lo=Number(v.from_value),hi=Number(v.to_value),axis=String(v.axis??'y');return p=>{const x=axis==='x'?p.x:axis==='z'?p.z:p.y;return a===b?lo:lo+(hi-lo)*Math.max(0,Math.min(1,(x-a)/(b-a)));};}
   case'abs':{const f=input();return p=>Math.abs(f(p));}case'square':{const f=input();return p=>f(p)**2;}case'cube':{const f=input();return p=>f(p)**3;}
   case'sqrt':{const f=input();return p=>Math.sqrt(Math.max(0,f(p)));}case'half_negative':{const f=input();return p=>f(p)<0?f(p)*.5:f(p);}
   case'quarter_negative':{const f=input();return p=>f(p)<0?f(p)*.25:f(p);}case'reciprocal':{const f=input();return p=>1/f(p);}
   case'negate':{const f=input();return p=>-f(p);}case'squeeze':{const f=input();return p=>{const x=Math.max(-1,Math.min(1,f(p)));return x/2-x*x*x/24;};}
   case'sign':{const f=input();return p=>Math.sign(f(p));}
   case'add':{const a=this.compile(v.argument1??v.left),b=this.compile(v.argument2??v.right);return p=>a(p)+b(p);}
   case'sub':{const a=this.compile(v.argument1??v.left),b=this.compile(v.argument2??v.right);return p=>a(p)-b(p);}
   case'mul':{const a=this.compile(v.argument1??v.left),b=this.compile(v.argument2??v.right);return p=>a(p)*b(p);}
   case'div':{const a=this.compile(v.argument1??v.left),b=this.compile(v.argument2??v.right);return p=>a(p)/b(p);}
   case'min':{const a=this.compile(v.argument1??v.left),b=this.compile(v.argument2??v.right);return p=>Math.min(a(p),b(p));}
   case'max':{const a=this.compile(v.argument1??v.left),b=this.compile(v.argument2??v.right);return p=>Math.max(a(p),b(p));}
   case'pow':{const f=input(),n=Number(v.power??2);return p=>Math.pow(f(p),n);}
   case'clamp':{const f=input(),lo=Number(v.min_inclusive??v.min??-1),hi=Number(v.max_exclusive??v.max??1);return p=>Math.max(lo,Math.min(hi,f(p)));}
   case'round':{const f=input();return p=>Math.round(f(p));}
   case'lerp':{const a=c('alpha'),b=c('first'),d=c('second');return p=>{const q=a(p),f=b(p);return f+(d(p)-f)*q;};}
   case'range_choice':{const f=input(),a=c('when_in_range'),b=c('when_out_of_range'),lo=Number(v.min_inclusive),hi=Number(v.max_exclusive);return p=>{const q=f(p);return q>=lo&&q<hi?a(p):b(p);};}
   case'interval_select':{const f=input(),th=(v.thresholds as number[]).map(Number),fs=(v.functions as any[]).map(x=>this.compile(x));return p=>{const q=f(p);for(let i=0;i<th.length;i++)if(q<th[i])return fs[i](p);return fs[fs.length-1](p);};}
   case'gradient_clamp':case'gradient_repeat':case'gradient_mirror':{const f=input(),period=Math.max(1,Number(v.period??1));return p=>{let q=f(p);q=t==='gradient_clamp'?Math.max(0,Math.min(1,q)):t==='gradient_repeat'?((q%period)+period)%period:1-Math.abs(((q%(2*period))+2*period)%(2*period)-period);return q;};}
   case'end_outer_islands':return p=>Math.max(0,1-Math.hypot(p.x/2,p.z/2)/100)*.5;
   default:throw new Error('Unsupported density function: '+t);
  }
 }
 /** True when the node's value cannot depend on y (so it can be cached per (x,z) column like vanilla's flat/2D caches). Unknown nodes are treated as y-dependent. */
 private yFreeMemo=new Map<string,boolean>();
 private yFree(v:any):boolean{
  if(typeof v==='number')return true;
  if(typeof v==='string'){
   const d=this.definitions.get(v);
   if(d===undefined){if(v==='minecraft:y'||v==='minecraft:blend_density')return false;return v==='minecraft:zero'||v==='minecraft:blend_alpha'||v==='minecraft:blend_offset'||v==='minecraft:beardifier'||v.startsWith('minecraft:overworld/caves/');}
   const hit=this.yFreeMemo.get(v);if(hit!==undefined)return hit;this.yFreeMemo.set(v,false);const r=this.yFree(d);this.yFreeMemo.set(v,r);return r;
  }
  if(!v||typeof v!=='object')return true;
  const t=String(v.type??'').replace(/^minecraft:/,''),f=(k:string)=>this.yFree(v[k]);
  switch(t){
   case'constant':case'zero':case'blend_alpha':case'blend_offset':case'beardifier':case'end_outer_islands':case'shift_a':case'shift_b':case'slice':return true;
   case'noise':return Number(v.y_scale??1)===0&&(!v.shift_x||f('shift_x'))&&(!v.shift_z||f('shift_z'));
   case'cache':case'cache_2d':case'cache_once':case'interpolated':case'blend_density':case'abs':case'square':case'cube':case'sqrt':case'half_negative':case'quarter_negative':case'reciprocal':case'negate':case'squeeze':case'sign':case'pow':case'clamp':case'round':case'gradient_clamp':case'gradient_repeat':case'gradient_mirror':return f('input');
   case'gradient':{const a=String(v.axis??'y');return a==='x'||a==='z';}
   case'add':case'sub':case'mul':case'div':case'min':case'max':return this.yFree(v.argument1??v.left)&&this.yFree(v.argument2??v.right);
   case'lerp':return f('alpha')&&f('first')&&f('second');
   case'range_choice':return f('input')&&f('when_in_range')&&f('when_out_of_range');
   case'interval_select':return f('input')&&(v.functions as any[]).every(x=>this.yFree(x));
   case'spline':return this.splineYFree(v.spline);
   case'find_top_surface':return f('upper_bound');
   default:return false;
  }
 }
 private splineYFree(sp:any):boolean{
  if(typeof sp==='number')return true;if(sp&&sp.spline)sp=sp.spline;if(!sp||!Array.isArray(sp.points)||!sp.points.length)return true;
  return this.yFree(sp.coordinate)&&(sp.points as any[]).every(q=>this.splineYFree(q.value));
 }
 /** Vanilla FlatCache/Cache2D: y-independent inputs are evaluated once per (x,z) column; anything else keeps the one-slot memo. */
 private cacheNode(raw:any,f:Density):Density{
  if(!this.yFree(raw))return this.memo(f);
  const m=new Map<number,number>(),L=16777216;
  return p=>{const x=p.x,z=p.z;if(!(x>-L&&x<L&&z>-L&&z<L&&x===Math.floor(x)&&z===Math.floor(z)))return f(p);
   const k=(x+L)*33554432+(z+L);let v=m.get(k);if(v===undefined){v=f(p);if(m.size>=16384)m.clear();m.set(k,v);}return v;};
 }
 private memo(f:Density):Density{let px=NaN,py=NaN,pz=NaN,pv=0;return p=>{if(p.x===px&&p.y===py&&p.z===pz)return pv;const v=f(p);px=p.x;py=p.y;pz=p.z;pv=v;return v;};}
 private interpolate(f:Density,sx:number,sy:number):Density{
  const cache=new Map<string,number>();return p=>{const bx=Math.floor(p.x/sx),by=Math.floor(p.y/sy),bz=Math.floor(p.z/sx),tx=p.x/sx-bx,ty=p.y/sy-by,tz=p.z/sx-bz;
   if(tx===0&&ty===0&&tz===0)return f({x:bx*sx,y:by*sy,z:bz*sx});
   const at=(x:number,y:number,z:number)=>{const k=x+','+y+','+z;let n=cache.get(k);if(n===undefined){n=f({x:x*sx,y:y*sy,z:z*sx});if(cache.size>=65536)cache.clear();cache.set(k,n);}return n;},l=(a:number,b:number,t:number)=>a+(b-a)*t;
   const a=l(at(bx,by,bz),at(bx+1,by,bz),tx),b=l(at(bx,by,bz+1),at(bx+1,by,bz+1),tx),c=l(at(bx,by+1,bz),at(bx+1,by+1,bz),tx),d=l(at(bx,by+1,bz+1),at(bx+1,by+1,bz+1),tx);return l(l(a,b,tz),l(c,d,tz),ty);};
 }
 /** Vanilla RandomState.getOrCreateNoise: NormalNoise seeded from random.fromHashOf('minecraft:<name>'). */
 getNoise(name:string):NormalNoise{
  if(this.noises.has(name))return this.noises.get(name)!;const key=Object.keys(NOISE_SETTINGS).find(k=>k===name||k.endsWith('/'+name)),s=key?NOISE_SETTINGS[key]:undefined;
  if(!s||!key)throw new Error('Missing noise settings: '+name);const n=new NormalNoise(this.factory.fromHashOf('minecraft:'+key),s);this.noises.set(name,n);return n;
 }
 /** Compiles a CubicSpline.Multipoint once. A nested value is either a number or another {coordinate,points} spline. */
 private compileSpline(sp:any):Density{
  if(typeof sp==='number')return()=>sp;if(sp&&sp.spline)sp=sp.spline;
  if(!sp||!Array.isArray(sp.points)||!sp.points.length)return()=>0;
  const coord=this.compile(sp.coordinate),pts=(sp.points as any[]).map(q=>({x:Number(q.location),d:Number(q.derivative??0),v:this.compileSpline(q.value)})),last=pts.length-1;
  return p=>{
   const x=coord(p);let lo=0,hi=pts.length;while(lo<hi){const m=(lo+hi)>>1;if(x<pts[m].x)hi=m;else lo=m+1;}const start=lo-1;
   const ext=(i:number)=>{const q=pts[i],y=q.v(p);return q.d===0?y:y+q.d*(x-q.x);};
   if(start<0)return ext(0);if(start===last)return ext(last);
   const q=pts[start],r=pts[start+1],dx=r.x-q.x,t=(x-q.x)/dx,y1=q.v(p),y2=r.v(p),A=q.d*dx-(y2-y1),B=-r.d*dx+(y2-y1);
   return y1+(y2-y1)*t+t*(1-t)*(A+(B-A)*t);
  };
 }
}
export class XZMemoizedDensity{
 private cache=new Map<string,number>();constructor(private readonly fn:Density){}
 sample(p:DensityContext):number{const k=p.x+','+p.z;let v=this.cache.get(k);if(v===undefined){v=this.fn(p);this.cache.set(k,v);}return v;}clear(){this.cache.clear();}
}
/** Lazy 5×49×5 cell-corner cache: 4×8 interpolation spacing, 384-block dimension. */
export class ChunkDensitySampler{
 private values=new Float64Array(5*49*5);private ready=new Uint8Array(5*49*5);
 constructor(private root:Density,private originX:number,private originZ:number,private minY=-64){}
 private index(x:number,y:number,z:number){return(y*5+z)*5+x;}
 corner(x:number,y:number,z:number){const i=this.index(x,y,z);if(!this.ready[i]){this.values[i]=this.root({x:this.originX+x*4,y:this.minY+y*8,z:this.originZ+z*4});this.ready[i]=1;}return this.values[i];}
 sample(x:number,y:number,z:number):number{const rx=Math.max(0,Math.min(15.999999,x-this.originX)),rz=Math.max(0,Math.min(15.999999,z-this.originZ)),gx=rx/4,gz=rz/4,gy=Math.max(0,Math.min(383.999999,y-this.minY))/8,ix=Math.floor(gx),iz=Math.floor(gz),iy=Math.floor(gy),tx=gx-ix,tz=gz-iz,ty=gy-iy,l=(a:number,b:number,t:number)=>a+(b-a)*t;
  const a=l(this.corner(ix,iy,iz),this.corner(ix+1,iy,iz),tx),b=l(this.corner(ix,iy,iz+1),this.corner(ix+1,iy,iz+1),tx),c=l(this.corner(ix,iy+1,iz),this.corner(ix+1,iy+1,iz),tx),d=l(this.corner(ix,iy+1,iz+1),this.corner(ix+1,iy+1,iz+1),tx);return l(l(a,b,tz),l(c,d,tz),ty);}
}
