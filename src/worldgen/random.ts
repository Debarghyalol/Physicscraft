/**
 * Minecraft Xoroshiro128++ random source and seed support.
 * BigInt keeps all arithmetic compatible with Java's modulo-2^64 long math.
 */
const MASK64=(1n<<64n)-1n, GOLDEN=-7046029254386353131n, SILVER=7640891576956012809n;
const rotl=(x:bigint,k:bigint)=>((x<<k)|(x>>(64n-k)))&MASK64, u64=(x:bigint)=>x&MASK64;
const signed64=(x:bigint)=>{const v=u64(x);return v>=(1n<<63n)?v-(1n<<64n):v;};
export interface Seed128{lo:bigint;hi:bigint;}
export function mixStafford13(v:bigint):bigint{let z=u64(v);z=u64((z^(z>>30n))*-4658895280553007687n);z=u64((z^(z>>27n))*-7723592293110705685n);return signed64(z^(z>>31n));}
export function upgradeSeedTo128bitUnmixed(seed:bigint):Seed128{const lo=u64(seed^SILVER);return{lo:signed64(lo),hi:signed64(lo+GOLDEN)};}
export function upgradeSeedTo128bit(seed:bigint):Seed128{const s=upgradeSeedTo128bitUnmixed(seed);return{lo:mixStafford13(s.lo),hi:mixStafford13(s.hi)};}
function md5(input:Uint8Array):Uint8Array{
 const shifts=[7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21],k=Array.from({length:64},(_,i)=>Math.floor(Math.abs(Math.sin(i+1))*4294967296)>>>0);
 const len=input.length,total=((len+8)>>>6)+1,data=new Uint8Array(total*64);data.set(input);data[len]=128;const view=new DataView(data.buffer);
 view.setUint32(data.length-8,(len*8)>>>0,true);view.setUint32(data.length-4,Math.floor(len*8/4294967296),true);
 let a0=0x67452301,b0=0xefcdab89,c0=0x98badcfe,d0=0x10325476;
 for(let off=0;off<data.length;off+=64){const m=Array.from({length:16},(_,i)=>view.getUint32(off+i*4,true));let a=a0,b=b0,c=c0,d=d0;
  for(let i=0;i<64;i++){let f:number,g:number,sh:number;if(i<16){f=(b&c)|(~b&d);g=i;sh=shifts[i%4];}else if(i<32){f=(d&b)|(~d&c);g=(5*i+1)%16;sh=shifts[4+i%4];}else if(i<48){f=b^c^d;g=(3*i+5)%16;sh=shifts[8+i%4];}else{f=c^(b|~d);g=(7*i)%16;sh=shifts[12+i%4];}const sum=(a+f+k[i]+m[g])>>>0,rot=((sum<<sh)|(sum>>>(32-sh)))>>>0;[a,d,c,b]=[d,c,b,(b+rot)>>>0];}
  a0=(a0+a)>>>0;b0=(b0+b)>>>0;c0=(c0+c)>>>0;d0=(d0+d)>>>0;
 }
 const out=new Uint8Array(16),ov=new DataView(out.buffer);ov.setUint32(0,a0,true);ov.setUint32(4,b0,true);ov.setUint32(8,c0,true);ov.setUint32(12,d0,true);return out;
}
export function seedFromHashOf(name:string):Seed128{const d=md5(new TextEncoder().encode(name)),v=new DataView(d.buffer,d.byteOffset,d.byteLength);return{lo:signed64(v.getBigInt64(0,false)),hi:signed64(v.getBigInt64(8,false))};}
export function xorSeed(a:Seed128,b:Seed128):Seed128{return{lo:signed64(a.lo^b.lo),hi:signed64(a.hi^b.hi)};}
export class Xoroshiro128PlusPlus{
 private lo:bigint;private hi:bigint;
 constructor(lo:bigint,hi:bigint){if((lo|hi)===0n){lo=GOLDEN;hi=SILVER;}this.lo=u64(lo);this.hi=u64(hi);}
 nextLong():bigint{const s0=this.lo,s1=this.hi,res=u64(rotl(u64(s0+s1),17n)+s0),m=s1^s0;this.lo=u64(rotl(s0,49n)^m^(m<<21n));this.hi=rotl(m,28n);return signed64(res);}
 nextInt():number{return Number(BigInt.asIntN(32,this.nextLong()));}
 nextIntBounded(bound:number):number{if(!Number.isInteger(bound)||bound<=0)throw new RangeError('bound must be positive');for(;;){const bits=BigInt(this.nextInt()>>>0),product=bits*BigInt(bound),low=product&0xffffffffn;if(low<BigInt(bound)){const threshold=(0x100000000n-BigInt(bound))%BigInt(bound);if(low<threshold)continue;}return Number(product>>32n);}}
 nextIntBetweenInclusive(min:number,max:number):number{return this.nextIntBounded(max-min+1)+min;}
 nextBoolean():boolean{return(u64(this.nextLong())&1n)!==0n;}nextFloat():number{return Number(u64(this.nextLong())>>40n)/16777216;}nextDouble():number{return Number(u64(this.nextLong())>>11n)/9007199254740992;}
 /** Vanilla RandomSource.forkPositional(): consumes two longs from this generator. */
 forkPositional():PositionalRandomFactory{return new PositionalRandomFactory(this.nextLong(),this.nextLong());}
 fork():Xoroshiro128PlusPlus{return new Xoroshiro128PlusPlus(this.nextLong(),this.nextLong());}
 static fromSeed(seed:bigint):Xoroshiro128PlusPlus{const s=upgradeSeedTo128bit(seed);return new Xoroshiro128PlusPlus(s.lo,s.hi);}
 static fromRawSeed(s:Seed128):Xoroshiro128PlusPlus{return new Xoroshiro128PlusPlus(s.lo,s.hi);}
}
export class PositionalRandomFactory{
 constructor(private readonly seedLo:bigint,private readonly seedHi:bigint){}
 at(x:number,y:number,z:number):Xoroshiro128PlusPlus{let s=BigInt.asIntN(64,BigInt(Math.imul(x,3129871))^(BigInt(z)*116129781n)^BigInt(y));s=BigInt.asIntN(64,s*s*42317861n+s*11n);s>>=16n;return new Xoroshiro128PlusPlus(s^this.seedLo,this.seedHi);}
 fromSeed(seed:bigint):Xoroshiro128PlusPlus{return new Xoroshiro128PlusPlus(seed^this.seedLo,seed^this.seedHi);}
 fromHashOf(name:string):Xoroshiro128PlusPlus{return Xoroshiro128PlusPlus.fromRawSeed(xorSeed(seedFromHashOf(name),{lo:this.seedLo,hi:this.seedHi}));}
}
