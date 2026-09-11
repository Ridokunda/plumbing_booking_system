const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const roots = ['app.js', 'bin', 'config', 'database', 'middleware', 'routes', 'scripts', 'utils'];
const files = [];
function collect(target) {
  const full = path.join(__dirname, '..', target);
  const stats = fs.statSync(full);
  if (stats.isFile() && full.endsWith('.js')) files.push(full);
  if (stats.isDirectory()) {
    for (const entry of fs.readdirSync(full)) collect(path.join(target, entry));
  }
}
roots.forEach(collect);

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax checked ${files.length} JavaScript files.`);
