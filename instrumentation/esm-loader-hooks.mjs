// This is a Node.js custom loader that we use to override ESM imports for modules.
// We generate stubs that redirect them to the CJS versions that we created.
// https://nodejs.org/api/module.html#customization-hooks

/** @type {Record<string, {cjsPath: string; exports: string[]}>} */
let shims;

export function initialize(options) {
  shims = options.shims;
}

function generateShim(moduleName) {
  const shim = shims[moduleName];
  const cjsPath = new URL(shim.cjsPath, import.meta.url).href;
  const js = `
    // Bananatron ESM shim for ${moduleName}
    import mod from ${JSON.stringify(cjsPath)};
    ${shim.exports.map(i => `const ${i} = mod.${i};`).join('\n')}
    export {
    ${shim.exports.map(i => `${i},`).join('\n')}
    };
    export default {
    ${shim.exports.map(i => `${i},`).join('\n')}
    };
  `;
  return `data:text/javascript;base64,${btoa(js)}`;
}

export function resolve(specifier, context, nextResolve) {
  // console.log(`[Bananatron] Resolving ESM dependency "${specifier}"`, context);

  if (Object.prototype.hasOwnProperty.call(shims, specifier)) {
    return nextResolve(generateShim(specifier));
  }

  return nextResolve(specifier);
}
