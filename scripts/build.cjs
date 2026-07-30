const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const modules = new Map();
const tutorialStylesPath = path.join(root, 'src', 'procgen', 'tutorial-overlay.css');

const importPattern = /^\s*import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]\s*;\s*$/gm;
const moduleScriptPattern = /<script\b(?=[^>]*\btype=["']module["'])[^>]*\bsrc=["']([^"']+)["'][^>]*><\/script>/gi;

function moduleId(file) {
  return path.relative(root, file).replaceAll(path.sep, '/');
}

function resolveImport(fromFile, request) {
  const cleanRequest = request.split(/[?#]/, 1)[0];
  if (!cleanRequest.startsWith('.')) {
    throw new Error(`Only local module imports are supported: ${request} in ${moduleId(fromFile)}`);
  }
  const resolved = path.resolve(path.dirname(fromFile), cleanRequest);
  return path.extname(resolved) ? resolved : `${resolved}.js`;
}

function parseImports(file, source) {
  return [...source.matchAll(importPattern)].map(match => ({
    bindings: match[1].split(',').map(name => name.trim()).filter(Boolean),
    file: resolveImport(file, match[2]),
  }));
}

function collectModule(file) {
  const normalized = path.normalize(file);
  if (modules.has(normalized)) return;
  if (!fs.existsSync(normalized)) throw new Error(`Imported module not found: ${normalized}`);

  const source = fs.readFileSync(normalized, 'utf8');
  const imports = parseImports(normalized, source);
  modules.set(normalized, { source, imports });
  for (const dependency of imports) collectModule(dependency.file);
}

function transformModule(file, record) {
  const exportedNames = [];
  let source = record.source.replace(importPattern, (_statement, bindings, request) => {
    const dependency = resolveImport(file, request);
    const names = bindings.split(',').map(name => name.trim()).filter(Boolean).join(', ');
    return `const { ${names} } = __require(${JSON.stringify(moduleId(dependency))});`;
  });

  source = source.replace(/^export\s+(function|const)\s+([A-Za-z_$][\w$]*)/gm, (_match, kind, name) => {
    exportedNames.push(name);
    return `${kind} ${name}`;
  });

  if (/^\s*(?:import|export)\b/m.test(source)) {
    throw new Error(`Unsupported module syntax remains in ${moduleId(file)}`);
  }

  const publish = exportedNames.length
    ? `\nObject.assign(__exports, { ${[...new Set(exportedNames)].join(', ')} });`
    : '';
  return `${source.trim()}${publish}`.replace(/[ \t]+$/gm, '');
}

function createBundle(entries) {
  modules.clear();
  for (const entry of entries) collectModule(entry);

  const definitions = [...modules.entries()].map(([file, record]) => {
    const id = moduleId(file);
    return `${JSON.stringify(id)}: (__exports, __require) => {\n${transformModule(file, record)}\n}`;
  });
  const start = entries.map(entry => `__require(${JSON.stringify(moduleId(entry))});`).join('\n');

  return `(() => {
'use strict';
const __modules = {
${definitions.join(',\n')}
};
const __cache = Object.create(null);
function __require(id) {
  if (__cache[id]) return __cache[id];
  const factory = __modules[id];
  if (!factory) throw new Error('Bundled module not found: ' + id);
  const exports = {};
  __cache[id] = exports;
  factory(exports, __require);
  return exports;
}
${start}
})();`;
}

function inlineRuntimeStyles(html) {
  if (!fs.existsSync(tutorialStylesPath)) {
    throw new Error(`Tutorial stylesheet not found: ${tutorialStylesPath}`);
  }
  if (!/<\/head>/i.test(html)) {
    throw new Error('The standalone document must contain a closing </head> tag');
  }

  const tutorialStyles = fs.readFileSync(tutorialStylesPath, 'utf8');
  if (/<\/style/i.test(tutorialStyles)) {
    throw new Error('Tutorial stylesheet contains an unsafe </style sequence');
  }
  return html.replace(
    /<\/head>/i,
    `<style data-tutorial-styles>\n${tutorialStyles.trim()}\n</style>\n</head>`,
  );
}

function build() {
  const htmlPath = path.join(root, 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const moduleScripts = [...html.matchAll(moduleScriptPattern)];
  if (moduleScripts.length === 0) {
    throw new Error(`No module script entries found in ${htmlPath}`);
  }

  const entries = moduleScripts.map(match => resolveImport(htmlPath, match[1]));
  const bundle = createBundle(entries).replace(/<\/script/gi, '<\\/script');
  let inserted = false;
  const bundledHtml = html.replace(moduleScriptPattern, () => {
    if (inserted) return '';
    inserted = true;
    return `<script>\n${bundle}\n</script>`;
  });
  const standalone = inlineRuntimeStyles(bundledHtml).replace(/[ \t]+$/gm, '');

  fs.mkdirSync(dist, { recursive: true });
  const outIndex = path.join(dist, 'index.html');
  const outNamed = path.join(dist, 'beans_living_soil_prototype_vertical_v3.html');
  fs.writeFileSync(outIndex, standalone, 'utf8');
  fs.writeFileSync(outNamed, standalone, 'utf8');
  console.log(`Built ${path.relative(root, outIndex)} and ${path.relative(root, outNamed)}`);
  console.log(`Bundled ${modules.size} modules from ${entries.map(moduleId).join(', ')}`);
  
  const assetsDir = path.join(root, 'assets');
  const distAssetsDir = path.join(dist, 'assets');
  if (fs.existsSync(assetsDir)) {
    fs.cpSync(assetsDir, distAssetsDir, { recursive: true });
    console.log(`Copied assets to dist/assets`);
  }
}

build();
