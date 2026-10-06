import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
const html = await readFile('src/index.html', 'utf8');
const worker = await readFile('src/worker.mjs', 'utf8');
await writeFile('dist/server/index.js', `const HTML = ${JSON.stringify(html)};\n${worker.replace("import HTML from './page.mjs';", '')}`);
await copyFile('.openai/hosting.json', 'dist/.openai/hosting.json');
console.log('Built DJ Room Worker and hosting manifest');
