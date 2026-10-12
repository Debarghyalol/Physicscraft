import {Xoroshiro128PlusPlus,PositionalRandomFactory,upgradeSeedTo128bit} from './random';
export interface NoiseParameters{base_octave:number;octave_count:number;base_amplitude:number;amplitude_modifiers?:number[];}
const G:ReadonlyArray<readonly[number,number,number]>=[[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1],[1,1,0],[0,-1,1],[-1,1,0],[0,-1,-1]];
const floor=Math.floor,smooth=(t:number)=>t*t*t*(t*(t*6-15)+10),lerp=(t:number,a:number,b:number)=>a+t*(b-a),wrap=(x:number)=>x>=-16777215.999999998&&x<16777216?x:x-Math.floor(x/33554432+.5)*33554432;
export class PerlinNoise{
 protected p=new Uint8Array(256);protected ox:number;protected oy:number;protected oz:number;
 constructor(r:Xoroshiro128PlusPlus){this.ox=r.nextDouble()*256;this.oy=r.nextDouble()*256;this.oz=r.nextDouble()*256;for(let i=0;i<256;i++)this.p[i]=i;for(let i=0;i<256;i++){const j=i+r.nextIntBounded(256-i),t=this.p[i];this.p[i]=this.p[j];this.p[j]=t;}}
 protected permute(n:number):number{return this.p[n&255];}
 sample(x:number,y:number,z:number):number{x=wrap(x+this.ox);y=wrap(y+this.oy);z=wrap(z+this.oz);const ix=floor(x),iy=floor(y),iz=floor(z),rx=x-ix,ry=y-iy,rz=z-iz;return this.sampleRelative(ix,iy,iz,rx,ry,rz,ry,ry);}
 protected sampleRelative(ix:number,iy:number,iz:number,rx:number,ry:number,rz:number,originalY:number,interpY:number):number{
 const x0=this.permute(ix),x1=this.permute(ix+1),xy00=this.permute(x0+iy),xy01=this.permute(x0+iy+1),xy10=this.permute(x1+iy),xy11=this.permute(x1+iy+1),dot=(h:number,x:number,y:number,z:number)=>{const g=G[h&15];return g[0]*x+g[1]*y+g[2]*z;};
 const d000=dot(this.permute(xy00+iz),rx,interpY,rz),d100=dot(this.permute(xy10+iz),rx-1,interpY,rz),d010=dot(this.permute(xy01+iz),rx,interpY-1,rz),d110=dot(this.permute(xy11+iz),rx-1,interpY-1,rz),d001=dot(this.permute(xy00+iz+1),rx,interpY,rz-1),d101=dot(this.permute(xy10+iz+1),rx-1,interpY,rz-1),d011=dot(this.permute(xy01+iz+1),rx,interpY-1,rz-1),d111=dot(this.permute(xy11+iz+1),rx-1,interpY-1,rz-1);
 const ax=smooth(rx),ay=smooth(originalY),az=smooth(rz);return lerp(az,lerp(ay,lerp(ax,d000,d100),lerp(ax,d010,d110)),lerp(ay,lerp(ax,d001,d101),lerp(ax,d011,d111)));
 }
}
export class SmearedPerlinNoise extends PerlinNoise{
 constructor(r:Xoroshiro128PlusPlus,private fudgeYScale:number){super(r);}
 sampleSmeared(x:number,y:number,z:number):number{const wx=wrap(x)+this.ox,wy=wrap(y)+this.oy,wz=wrap(z)+this.oz,ix=floor(wx),iy=floor(wy),iz=floor(wz),rx=wx-ix,ry=wy-iy,rz=wz-iz,limit=y>=0&&y<ry?y:ry,fudge=Math.floor(limit/this.fudgeYScale+1e-7)*this.fudgeYScale;return this.sampleRelative(ix,iy,iz,rx,ry,rz,ry,ry-fudge);}
}
export class NormalNoise{
 private layers:Array<{p:PerlinNoise;frequency:number;amplitude:number}>;readonly normalizationFactor:number;
 constructor(seed:bigint,readonly parameters:NoiseParameters){const count=parameters.octave_count,mods=parameters.amplitude_modifiers??[];let freq=Math.pow(2,parameters.base_octave),amp=parameters.base_amplitude*Math.pow(.5,-(count-1))/(Math.pow(.5,-count)-1),octaves:Array<{octave:number;frequency:number;amplitude:number}>=[];
  for(let i=0;i<count;i++){const m=mods[i]??1;if(m!==0)octaves.push({octave:parameters.base_octave+i,frequency:freq,amplitude:amp*m});freq*=2;amp*=.5;}
  const target=octaves.reduce((s,o)=>s+Math.abs(o.amplitude),0),dev=Math.sqrt(octaves.reduce((s,o)=>s+Math.pow(.2702247831245211*Math.abs(o.amplitude),2),0));this.normalizationFactor=dev===0?0:(target/3)/(dev*Math.sqrt(2));
  const root=upgradeSeedTo128bit(seed),r=new Xoroshiro128PlusPlus(root.lo,root.hi),first=new PositionalRandomFactory(r.nextLong(),r.nextLong()),second=new PositionalRandomFactory(r.nextLong(),r.nextLong());this.layers=[];
  for(const o of octaves){const name='octave_'+o.octave,a=Math.fround(this.normalizationFactor*o.amplitude);this.layers.push({p:new PerlinNoise(first.fromHashOf(name)),frequency:o.frequency,amplitude:a});this.layers.push({p:new PerlinNoise(second.fromHashOf(name)),frequency:o.frequency*1.0181268882175227,amplitude:a});}
 }
 sample(x:number,y:number,z:number):number{let v=0;for(const l of this.layers)v+=l.p.sample(x*l.frequency,y*l.frequency,z*l.frequency)*l.amplitude;return v;}
}