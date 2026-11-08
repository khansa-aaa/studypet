// Hoot's few settings, kept in ~/Library/Application Support/studypet/settings.json.
const fs = require('fs');
const path = require('path');

const DEFAULTS = { model: 'sonnet', shortcut: 'Alt+Space', anchor: null };

function file(dir) {
  return path.join(dir, 'settings.json');
}

function read(dir) {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(dir), 'utf8')) };
  } catch (_) {
    return { ...DEFAULTS };
  }
}

function update(dir, patch) {
  const next = { ...read(dir), ...patch };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file(dir), JSON.stringify(next, null, 2));
  return next;
}

module.exports = { read, update, DEFAULTS };
