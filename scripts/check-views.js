const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const root = path.join(__dirname, '..', 'views');
const files = [];
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(target);
    else if (entry.name.endsWith('.ejs')) files.push(target);
  }
}
collect(root);

for (const file of files) {
  try {
    ejs.compile(fs.readFileSync(file, 'utf8'), { filename: file });
  } catch (error) {
    console.error(`Invalid EJS template: ${path.relative(root, file)}`);
    throw error;
  }
}
console.log(`Template syntax checked ${files.length} EJS files.`);
