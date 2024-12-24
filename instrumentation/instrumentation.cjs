if (!global.__bananatron) {
    global.__bananatron = true;

    const log = require('./log.cjs');

    // Log human-readable app state
    const packageJSON = require('../package.json');
    log({
        'AppName': packageJSON.name,
        'AppVersion': packageJSON.version,
        'Fuses': packageJSON.__bananatron.fuses.formatted,
        'Dependencies': packageJSON.dependencies
    });

    // Log Electron/Chromium version information
    log({
        'Module': ['process', 'versions'],
        'Chromium': process.versions.chrome,
        'Electron': process.versions.electron
    });

    // Override CJS modules
    const instrumentedElectron = require('./instrumented-electron.cjs');
    require.cache.electron = {
        exports: instrumentedElectron
    };

    // Override ESM modules
    try {
        const nodeModule = require('module');
        const nodeURL = require('url');
        // register() was added in some recent Electrons, if it doesn't exist then that's
        // fine, the app won't use ESM so we don't need to do anything anyways.
        if (nodeModule && typeof nodeModule.register === 'function') {
            const shims = {
                electron: {
                    cjsPath: './instrumented-electron.cjs',
                    exports: Object.keys(instrumentedElectron).sort()
                }
            };
            nodeModule.register('./esm-loader-hooks.mjs', nodeURL.pathToFileURL(__filename), {
                data: {
                    shims
                }
            });
        }
    } catch (e) {
        if (e.code === 'ERR_MODULE_NOT_FOUND') {
            // This happens when ESM is not supported by the app, so safe to ignore.
        } else {
            throw e;
        }
    }
}
