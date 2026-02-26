import * as svgPathBbox from 'svg-path-bbox';

let bbox = svgPathBbox.default || svgPathBbox.svgPathBbox || svgPathBbox;

const hookF3 = "M100.23,229.61c-18.77,0-30.88-9.06-33.97-24.01-4.93-23.78-5.27-149.96,0-173.11,3-13.16,15.21-24.01,33.97-24.01s32.12,7.39,33.97,24.01c5.44,48.67,3.7,157.44,0,173.11-4.47,18.89-15.21,24.01-33.97,24.01h0Z";
const petalF3 = "M97.62,93.71c19.91-21.35,91.02-69.74,116.27-80.95,23.85-10.58,51.28-4.08,53.87,25.22s3.33,135.03,0,161.91c-3.33,26.88-23.39,38.36-53.87,25.22-27.73-11.95-97.35-61.27-116.27-80.95-17.25-17.95-17.3-31.91,0-50.45h0Z";

function getBox(p) {
    if (typeof bbox === 'function') return bbox(p);
    return Object.values(svgPathBbox)[0](p);
}

const bH3 = getBox(hookF3);
const bP3 = getBox(petalF3);

console.log("Hook F3 BBox:", bH3);
console.log("Petal F3 BBox:", bP3);
