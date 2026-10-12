import {DENSITY_JSON,NOISE_SETTINGS} from './data.generated';
import {NormalNoise,PerlinNoise,SmearedPerlinNoise} from './noise';
import {PositionalRandomFactory,upgradeSeedTo128bit} from './random';
export interface DensityContext{x:number;y:number;z:number;}
export type Density=(p:DensityContext)=>number;
/** Compiles the bundled Minecraft density JSON. Blend values and beardifier are explicit stubs. */
export class DensityFunctionCompiler{
 private definitions=new Map<string,any>();private compiled=new Map<string,Density>();private noises=new Map<string,NormalNoise>();
 constructor(private readonly seed:number){for(const [n,j] of Object.entries(DENSITY_JSON))this.definitions.set('minecraft:'+n,j);}
 compileRoot(name='minecraft:overworld/final_density'):Density{return this.compileRef(name);}
 compileRef(name:string):Density{
  if(this.compiled.has(name))return this.compiled.get(name)!;const v=this.definitions.get(name);
  if(v===undefined){if(name==='minecraft:zero')return()=>0;if(name==='minecraft:y')return p=>p.y;if(['minecraft:beardifier','minecraft:blend_density','minecraft:blend_alpha','minecraft:blend_offset'].includes(name))return()=>0;throw new Error('Unknown density function: '+name);}
  const f=this.compile(v);this.compiled.set(name,f);return f;
 }
 private compile(v:any):Density{
  if(typeof v==='number')return()=>v;if(typeof v==='string')return this.compileRef(v);if(!v||typeof v!=='object')return()=>0;
  const t=String(v.type??'').replace(/^minecraft:/,''),c=(k:string)=>this.compile(v[k]),input=()=>c('input');
  switch(t){
   case'constant':return()=>Number(v.argument??v.value??0);
   case'cache':case'cache_2d':return input();
   case'interpolated':return this.interpolate(input(),Number(v.cell_size_xz??4),Number(v.cell_size_y??8));
   case'noise':{const n=this.getNoise(String(v.noise).replace(/^minecraft:/,'')),sx=Number(v.xz_scale??1),sy=Number(v.y_scale??1),shx=v.shift_x?c('shift_x'):()=>0,shz=v.shift_z?c('shift_z'):()=>0;return p=>n.sample((p.x+shx(p))*sx,p.y*sy,(p.z+shz(p))*sx);}
   case'shift_a':{const n=this.getNoise(String(v.noise).replace(/^minecraft:/,''));return p=>n.sample(p.x*.25,0,p.z*.25)*4;}
   case'shift_b':{const n=this.getNoise(String(v.noise).replace(/^minecraft:/,''));return p=>n.sample(p.z*.25,p.x*.25,0)*4;}
   case'shift':{const n=this.getNoise(String(v.noise).replace(/^minecraft:/,''));return p=>n.sample(p.x*.25,p.y*.25,p.z*.25)*4;}
   case'blend_density':case'blend_alpha':case'blend_offset':case'beardifier':return()=>0;
   case'old_blended_noise':{const n=this.getNoise('base_3d_noise'),sx=684.412*Number(v.xz_scale??.25),sy=684.412*Number(v.y_scale??.125);return p=>n.sample(p.x*sx,p.y*sy,p.z*sx);}
   case'spline':return p=>this.spline(v.spline,p);
   case'find_top_surface':return p=>p.y;
   case'distance_to_point':return p=>Math.hypot(p.x-Number(v.x??0),p.y-Number(v.y??0),p.z-Number(v.z??0));
   case'slice':{const y=Number(v.y??0),f=input();return p=>f({...p,y});}
   case'gradient':{const a=Number(v.from_coordinate),b=Number(v.to_coordinate),lo=Number(v.from_value),hi=Number(v.to_value),axis=String(v.axis??'y');return p=>{const x=axis==='x'?p.x:axis==='z'?p.z:p.y;return a===b?lo:lo+(hi-lo)*Math.max(0,Math.min(1,(x-a)/(b-a)));};}
   case'abs':{const f=input();return p=>Math.abs(f(p));}case'square':{const f=input();return p=>f(p)**2;}case'cube':{const f=input();return p=>f(p)**3;}
   case'sqrt':{const f=input();return p=>Math.sqrt(Math.max(0,f(p));}case'half_negative':{const f=input();return p=>f(p)<0?f(p)*.5:f(p);}
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
   case'lerp':{const a=c('alpha'),b=c('first'),d=c('second');return p=>{const q=Math.max(0,Math.min(1,a(p)));return b(p)+(d(p)-b(p))*q;};}
   case'range_choice':{const f=input(),a=c('when_in_range'),b=c('when_out_of_range'),lo=Number(v.min_inclusive),hi=Number(v.max_exclusive);return p=>{const q=f(p);return q>=lo&&q<hi?a(p):b(p);};}
   case'interval_select':{const f=input(),a=c('when_below'),b=c('when_in_range'),d=c('when_above'),lo=Number(v.min_inclusive),hi=Number(v.max_exclusive);return p=>{const q=f(p);return q<lo?a(p):q<hi?b(p):d(p);};}
   case'gradient_clamp':case'gradient_repeat':case'gradient_mirror':{const f=input(),period=Math.max(1,Number(v.period??1));return p=>{let q=f(p);q=t==='gradient_clamp'?Math.max(0,Math.min(1,q)):t==='gradient_repeat'?((q%period)+period)%period:1-Math.abs(((q%(2*period))+2*period)%(2*period)-period);return q;};}
   case'end_outer_islands':return p=>Math.max(0,1-Math.hypot(p.x/2,p.z/2)/100)*.5;
   default:throw new Error('Unsupported density function: '+t);
  }
 }
 private interpolate(f:Density,sx:number,sy:number):Density{
  const cache=new Map<string,number>();return p=>{const bx=Math.floor(p.x/sx),by=Math.floor(p.y/sy),bz=Math.floor(p.z/sx),tx=p.x/sx-bx,ty=p.y/sy-by,tz=p.z/sx-bz;
   const at=(x:number,y:number,z:number)=>{const k=x+','+y+','+z;let n=cache.get(k);if(n===undefined){n=f({x:x*sx,y:y*sy,z:z*sx});cache.set(k,n);}return n;},l=(a:number,b:number,t:number)=>a+(b-a)*t;
   const a=l(at(bx,by,bz),at(bx+1,by,bz),tx),b=l(at(bx,by,bz+1),at(bx+1,by,bz+1),tx),c=l(at(bx,by+1,bz),at(bx+1,by+1,bz),tx),d=l(at(bx,by+1,bz+1),at(bx+1,by+1,bz+1),tx);return l(l(a,b,tz),l(c,d,tz),ty);};
 }
 private getNoise(name:string):NormalNoise{
  if(this.noises.has(name))return this.noises.get(name)!;const key=Object.keys(NOISE_SETTINGS).find(k=>k===name||k.endsWith('/'+name)),s=key?NOISE_SETTINGS[key]:undefined;
  if(!s)throw new Error('Missing noise settings: '+name);const root=upgradeSeedTo128bit(BigInt(this.seed)),factory=new PositionalRandomFactory(root.lo,root.hi),r=factory.fromHashOf(name);
  const n=new NormalNoise(r.nextLong(),s);this.noises.set(name,n);return n;
 }
 private spline(s:any,p:DensityContext):number{
  if(!s||!Array.isArray(s.points))return 0;const x=this.compile(s.coordinate)(p),a=s.points as any[];if(!a.length)return 0;let i=0;while(i<a.length&&x>Number(a[i].location))i++;
  if(i===0){const q=a[0];return this.splineValue(q.value,p)+(x-Number(q.location))*Number(q.derivative??0);}if(i>=a.length){const q=a[a.length-1];return this.splineValue(q.value,p)+(x-Number(q.location))*Number(q.derivative??0);}
  const q=a[i-1],r=a[i],dx=Number(r.location)-Number(q.location),t=(x-Number(q.location))/dx,y1=this.splineValue(q.value,p),y2=this.splineValue(r.value,p),u=Number(q.derivative??0)*dx-(y2-y1),v=-Number(r.derivative??0)*dx+(y2-y1);
  return y1+t*(y2-y1)+t*(1-t)*(t*u+(1-t)*v);
 }
 private splineValue(v:any,p:DensityContext):number{return typeof v==='number'?v:this.spline(v.spline,p);}
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
 private corner(x:number,y:number,z:number){const i=this.index(x,y,z);if(!this.ready[i]){this.values[i]=this.root({x:this.originX+x*4,y:this.minY+y*8,z:this.originZ+z*4});this.ready[i]=1;}return this.values[i];}
 sample(x:number,y:number,z:number):number{const rx=Math.max(0,Math.min(3.999999,x-this.originX)),rz=Math.max(0,Math.min(3.999999,z-this.originZ)),gx=rx/4,gz=rz/4,gy=Math.max(0,Math.min(47.999999,y-this.minY))/8,ix=Math.floor(gx),iz=Math.floor(gz),iy=Math.floor(gy),tx=gx-ix,tz=gz-iz,ty=gy-iy,l=(a:number,b:number,t:number)=>a+(b-a)*t;
  const a=l(this.corner(ix,iy,iz),this.corner(ix+1,iy,iz),tx),b=l(this.corner(ix,iy,iz+1),this.corner(ix+1,iy,iz+1),tx),c=l(this.corner(ix,iy+1,iz),this.corner(ix+1,iy+1,iz),tx),d=l(this.corner(ix,iy+1,iz+1),this.corner(ix+1,iy+1,iz+1),tx);return l(l(a,b,tz),l(c,d,tz),ty);}
}
