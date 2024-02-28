const fs = require('fs');

module.exports.saveToFile = (folder, fileName, data) => {
  const dirExists = fs.existsSync(folder);

  if (!dirExists) {
    fs.mkdirSync(folder);
  }

  fs.writeFileSync(`${folder}/${fileName}`, data, 'utf8');
};

module.exports.readFiles = dirname => {
  const names = fs.readdirSync(dirname);

  return names.map(name => fs.readFileSync(`${dirname}/${name}`, 'utf-8'));
};

module.exports.getUrls = files => {
  return files.reduce((acc, file) => acc.concat(JSON.parse(file)), []);
};

module.exports.deleteDir = dirname => {
  fs.rmdirSync(dirname, { recursive: true });
};
