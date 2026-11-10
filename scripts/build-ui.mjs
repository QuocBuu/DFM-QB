import {compile} from 'sass';
import {mkdir, writeFile, copyFile} from 'node:fs/promises';
const result = compile('ui/bootstrap.scss', {
  loadPaths: ['node_modules'], style: 'compressed',
  silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'if-function'],
  quietDeps: true
});
await mkdir('dist/vendor', {recursive: true});
await writeFile('dist/vendor/bootstrap.css', '/*! Bootstrap v5.3.8 | MIT | see bootstrap.LICENSE */\n' + result.css + '\n');
await copyFile('node_modules/bootstrap/LICENSE', 'dist/vendor/bootstrap.LICENSE');
