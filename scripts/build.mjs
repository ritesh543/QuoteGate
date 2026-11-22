import { build } from 'esbuild';
import { readFile, readdir, writeFile } from 'node:fs/promises';

const output = await build({
  entryPoints: ['src/studionet.js'],
  outfile: 'dist/assets/studionet.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  legalComments: 'linked',
  minify: true,
  metafile: true
});
const packages = new Set();
for (const input of Object.keys(output.metafile.inputs)) {
  const parts = input.split('node_modules/').at(-1).split('/');
  if (input.includes('node_modules/')) packages.add(parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]);
}
const notices = [];
for (const name of [...packages].sort()) {
  const path = 'node_modules/' + name;
  const info = JSON.parse(await readFile(path + '/package.json', 'utf8'));
  const license = (await readdir(path)).find(file => /^licen[cs]e(?:\.[a-z]+)?$/i.test(file));
  notices.push(name + '@' + info.version + ' (' + (info.license || 'see notice') + ')\n' +
    (license ? await readFile(path + '/' + license, 'utf8') : 'See the package distribution for license text.'));
}
await writeFile('dist/assets/THIRD-PARTY-NOTICES.txt', notices.join('\n\n' + '-'.repeat(60) + '\n\n') + '\n');
console.log('Built the bundled StudioNet wallet client.');
