import {writeFileSync} from 'node:fs';
import {createCanvas,loadImage} from '@napi-rs/canvas';
// Plain initials replace the previous graphic symbol in browser/home-screen icons.
const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#205ba6"/><text x="256" y="268" text-anchor="middle" dominant-baseline="central" font-family="Arial, sans-serif" font-size="240" font-weight="700" fill="#fff">FM</text></svg>';
writeFileSync('public/icon.svg',svg);
const image=await loadImage(Buffer.from(svg));
for(const [size,file] of [[32,'favicon-32.png'],[180,'apple-touch-icon.png'],[192,'icon-192.png'],[512,'icon-512.png']]){
 const canvas=createCanvas(size,size),ctx=canvas.getContext('2d');ctx.fillStyle='#255fa8';ctx.fillRect(0,0,size,size);ctx.drawImage(image,0,0,size,size);writeFileSync('public/'+file,canvas.toBuffer('image/png'));
}
// Compatibility paths for older installed clients, now containing company text.
for(const [file,color] of [['logo-black.svg','#192639'],['logo-white.svg','#f1f6fb']]){
 writeFileSync('public/'+file,`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="48" viewBox="0 0 240 48"><text x="0" y="33" font-family="sans-serif" font-size="30" font-weight="700" fill="${color}">FM 파트너스</text></svg>`);
}
console.log('FM text icons prepared; previous graphic logos replaced with company text.');
