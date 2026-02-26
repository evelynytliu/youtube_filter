import pkg from 'flubber';
const { interpolate } = pkg;
import fs from 'fs';

// F1
const hookF1 = "M57.31,228.61c-15.66,0-25.77-9.06-28.35-24.01-4.11-23.78-4.4-149.96,0-173.11,2.5-13.16,12.69-24.01,28.35-24.01s26.8,7.39,28.35,24.01c4.54,48.67,3.09,157.44,0,173.11-3.73,18.89-12.69,24.01-28.35,24.01h0Z";
const petalF1 = "M291.17,93.5c-19.73-21.11-90.2-68.94-115.23-80.02-23.64-10.46-50.82-4.03-53.39,24.93s-3.3,133.48,0,160.05,23.18,37.92,53.39,24.93c27.48-11.81,96.48-60.57,115.23-80.02,17.1-17.75,17.14-31.54,0-49.87h0Z";

// F2
const hookF2 = "M102.9,229.61c-18.77,0-30.88-9.06-33.97-24.01-4.93-23.78-5.27-149.96,0-173.11,3-13.16,15.21-24.01,33.97-24.01s32.12,7.39,33.97,24.01c5.44,48.67,3.7,157.44,0,173.11-4.47,18.89-15.21,24.01-33.97,24.01Z";
const petalF2 = "M222.23,229.61c-18.77,0-30.88-9.06-33.97-24.01-4.93-23.78-5.27-149.96,0-173.11,3-13.16,15.21-24.01,33.97-24.01s32.12,7.39,33.97,24.01c5.44,48.67,3.7,157.44,0,173.11-4.47,18.89-15.21,24.01-33.97,24.01h0Z";

// F3
const hookF3 = "M93.57,229.61c-18.77,0-30.88-9.06-33.97-24.01-4.93-23.78-5.27-149.96,0-173.11,3-13.16,15.21-24.01,33.97-24.01s32.12,7.39,33.97,24.01c5.44,48.67,3.7,157.44,0,173.11-4.47,18.89-15.21,24.01-33.97,24.01Z";
const petalF3 = "M109.62,93.71c19.91-21.35,91.02-69.74,116.27-80.95,23.85-10.58,51.28-4.08,53.87,25.22s3.33,135.03,0,161.91c-3.33,26.88-23.39,38.36-53.87,25.22-27.73-11.95-97.35-61.27-116.27-80.95-17.25-17.95-17.3-31.91,0-50.45h0Z";

// F4
const hookF4 = "M100.23,229.61c-18.77,0-30.88-9.06-33.97-24.01-4.93-23.78-5.27-149.96,0-173.11,3-13.16,15.21-24.01,33.97-24.01s32.12,7.39,33.97,24.01c5.44,48.67,3.7,157.44,0,173.11-4.47,18.89-15.21,24.01-33.97,24.01Z";
const petalF4 = "M111.62,93.71c19.91-21.35,91.02-69.74,116.27-80.95,23.85-10.58,51.28-4.08,53.87,25.22s3.33,135.03,0,161.91c-3.33,26.88-23.39,38.36-53.87,25.22-27.73-11.95-97.35-61.27-116.27-80.95-17.25-17.95-17.3-31.91,0-50.45h0Z";
const greenF4 = "M111.62,93.71h0c-17.3,18.53-17.25,32.49,0,50.44,5.24,5.45,14.36,13.17,25.4,21.73.85-27.21.94-63.27-.2-93.95-10.83,8.38-19.86,16.05-25.2,21.78Z";

function generatePath(frames, p1, p2) {
   const fn = interpolate(p1, p2, { maxSegmentLength: 2 });
   const step = 1 / (frames - 1);
   let res = [];
   for (let i = 0; i < frames; i++) {
      res.push(fn(i * step));
   }
   return res;
}

const framesPhase1 = 15; // F1 -> F2
const framesPhase2 = 15; // F2 -> F3
const framesPhase3 = 10; // F3 -> F4

const hookFrames1 = generatePath(framesPhase1, hookF1, hookF2);
const hookFrames2 = generatePath(framesPhase2, hookF2, hookF3);
const hookFrames3 = generatePath(framesPhase3, hookF3, hookF4);

const petalFrames1 = generatePath(framesPhase1, petalF1, petalF2);
const petalFrames2 = generatePath(framesPhase2, petalF2, petalF3);
const petalFrames3 = generatePath(framesPhase3, petalF3, petalF4);

const totalHookFrames = hookFrames1.concat(hookFrames2.slice(1)).concat(hookFrames3.slice(1));
const totalPetalFrames = petalFrames1.concat(petalFrames2.slice(1)).concat(petalFrames3.slice(1));

const hookVals = totalHookFrames.join(";");
const petalVals = totalPetalFrames.join(";");

const N = totalHookFrames.length;
const keyTimes = Array.from({ length: N }, (_, i) => i / (N - 1)).join(";");

const duration = 1.8; // seconds

const svgCode = `<?xml version="1.0" encoding="UTF-8"?>
<svg id="kiddolens_logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 328.12 238.24">
  <defs>
    <radialGradient id="_未命名漸層_130" cx="191.33" cy="119.28" fx="191.33" fy="119.28" r="95.71" gradientTransform="translate(.62 -121.63) rotate(.15) scale(1 2.02)" gradientUnits="userSpaceOnUse">
      <stop offset=".38" stop-color="#facd40"/>
      <stop offset=".43" stop-color="#facd40" stop-opacity=".96"/>
      <stop offset=".51" stop-color="#facd40" stop-opacity=".86"/>
      <stop offset=".62" stop-color="#facd40" stop-opacity=".69"/>
      <stop offset=".75" stop-color="#facd40" stop-opacity=".46"/>
      <stop offset=".89" stop-color="#facd40" stop-opacity=".17"/>
      <stop offset=".97" stop-color="#facd40" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <path fill="#355dce" d="${hookF4}">
     <animate attributeName="d" dur="${duration}s" repeatCount="1" fill="freeze" calcMode="linear" keyTimes="${keyTimes}"
      values="${hookVals}"
     />
  </path>

  <!-- Starts solid yellow, fades out at the very end -->
  <path fill="#facd40" d="${petalF4}">
     <animate attributeName="d" dur="${duration}s" repeatCount="1" fill="freeze" calcMode="linear" keyTimes="${keyTimes}"
      values="${petalVals}"
     />
     <animate attributeName="opacity" values="1;1;0" keyTimes="0;0.95;1" dur="${duration}s" fill="freeze" />
  </path>

  <!-- Starts invisible, fades in at the very end to reveal the gradient -->
  <path fill="url(#_未命名漸層_130)" opacity="0" d="${petalF4}">
     <animate attributeName="d" dur="${duration}s" repeatCount="1" fill="freeze" calcMode="linear" keyTimes="${keyTimes}"
      values="${petalVals}"
     />
     <animate attributeName="opacity" values="0;0;1" keyTimes="0;0.95;1" dur="${duration}s" fill="freeze" />
  </path>

  <!-- Green intersection comes LAST so it's ON TOP of the yellow gradient, providing a solid #80af4c tip -->
  <!-- It remains completely hidden during the morph animation, and only fades in at the end -->
  <path fill="#80af4c" opacity="0" d="${greenF4}">
     <animate attributeName="opacity" values="0;0;1" keyTimes="0;0.95;1" dur="${duration}s" fill="freeze" />
  </path>

</svg>`;

fs.writeFileSync('public/logo.svg', svgCode);
fs.writeFileSync('kiddolens_logo_animated.svg', svgCode);
console.log('SVG mapped F1->F2->F3->F4 correctly placing green tip on top of gradient.');
