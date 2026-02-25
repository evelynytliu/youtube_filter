import { parseSync } from 'svgson';
import { readFileSync } from 'fs';

const svg1 = readFileSync('kiddolens_logo_f1.svg', 'utf8');
const svg2 = readFileSync('kiddolens_logo_f2.svg', 'utf8');

const doc1 = parseSync(svg1);
const doc2 = parseSync(svg2);

function getPathInfo(doc) {
    return doc.children
        .filter(c => c.name === 'path')
        .map(p => p.attributes.d);
}

const paths1 = getPathInfo(doc1);
const paths2 = getPathInfo(doc2);
console.log('paths1:', paths1);
console.log('paths2:', paths2);
