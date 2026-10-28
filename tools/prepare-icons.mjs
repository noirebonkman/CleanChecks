import {readFileSync,writeFileSync} from 'node:fs';
import {createCanvas,loadImage} from '@napi-rs/canvas';
// Reuse the symbol paths from the supplied LUCENT vector logo, excluding the wordmark.
const paths=readFileSync('public/logo-black.svg','utf8').match(/<path\b[^>]*\/>/g).slice(-5).join('').replaceAll('#161616','#ffffff');
const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="100" fill="#255fa8"/><g transform="translate(-173 99) scale(.72)">${paths}</g></svg>`;
writeFileSync('public/icon.svg',svg);
const image=await loadImage(Buffer.from(svg));
for(const [size,file] of [[32,'favicon-32.png'],[180,'apple-touch-icon.png'],[192,'icon-192.png'],[512,'icon-512.png']]){
 const canvas=createCanvas(size,size),ctx=canvas.getContext('2d');ctx.fillStyle='#255fa8';ctx.fillRect(0,0,size,size);ctx.drawImage(image,0,0,size,size);writeFileSync('public/'+file,canvas.toBuffer('image/png'));
}
console.log('Generated LUCENT symbol icons: SVG, favicon, Apple touch and PWA sizes');
