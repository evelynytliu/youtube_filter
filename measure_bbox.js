import * as svgPathBbox from 'svg-path-bbox';

let bbox = svgPathBbox.default || svgPathBbox.svgPathBbox || svgPathBbox;

const hookF1 = "M57.31,229.61c-15.66,0-25.77-9.06-28.35-24.01-4.11-23.78-4.4-149.96,0-173.11,2.5-13.16,12.69-24.01,28.35-24.01s26.8,7.39,28.35,24.01c4.54,48.67,3.09,157.44,0,173.11-3.73,18.89-12.69,24.01-28.35,24.01Z";
const hookF2 = "M62.74,229.51c-19.59,0-32.25-9.06-35.48-24.01-5.14-23.78-5.51-149.96,0-173.11,3.13-13.16,15.88-24.01,35.48-24.01s33.54,7.39,35.48,24.01c5.68,48.67,3.87,157.44,0,173.11-4.66,18.89-15.88,24.01-35.48,24.01Z";
const petalRight = "M291.17,94.97c-19.73-20.59-90.2-67.25-115.23-78.06-23.64-10.2-50.82-3.93-53.39,24.32s-3.3,130.2,0,156.12c3.3,25.92,23.18,36.99,53.39,24.32,27.48-11.52,96.48-59.08,115.23-78.06,17.1-17.31,17.14-30.77,0-48.65Z";
const petalLeft = "M66.05,94.87c19.11-20.59,87.37-67.25,111.61-78.06,22.9-10.2,49.22-3.93,51.71,24.32,2.49,28.26,3.2,130.2,0,156.12s-22.45,36.99-51.71,24.32c-26.61-11.52-93.44-59.08-111.61-78.06-16.56-17.31-16.6-30.77,0-48.65Z";
const petalYellow = "M66.05,94.87c-16.6,17.88-16.56,31.34,0,48.65,6.61,6.91,19.66,17.6,34.87,28.96,1.16-29.44,1.34-72.14-.22-106.54-14.95,11.08-27.89,21.64-34.65,28.93Z";

function getBox(p) {
    if (typeof bbox === 'function') return bbox(p);
    return Object.values(svgPathBbox)[0](p);
}

function union(b1, b2) {
    if (!b1) return b2;
    return [
        Math.min(b1[0], b2[0]),
        Math.min(b1[1], b2[1]),
        Math.max(b1[2], b2[2]),
        Math.max(b1[3], b2[3])
    ];
}

const bF2 = [hookF2, petalLeft, petalYellow]
    .map(getBox)
    .reduce(union, null);

const bF1 = [hookF1, petalRight]
    .map(getBox)
    .reduce(union, null);

const bAll = union(bF1, bF2);

console.log("F2 BBox [minX, minY, maxX, maxY]:", bF2);
console.log("F2 Width/Height:", bF2[2] - bF2[0], bF2[3] - bF2[1]);
console.log("F2 Center X:", (bF2[2] + bF2[0]) / 2);
console.log("F1 BBox:", bF1);
console.log("All BBox:", bAll);
