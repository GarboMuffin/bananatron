// Bananatron Preload script

const electron = require('electron');
const ipcRenderer = electron.ipcRenderer;
const contextBridge = electron.contextBridge;

// Converts values that we can't send through IPC such as functions to strings so they are
// still mostly viewable.
const makeSafeForIPC = (obj) => {
    if (typeof obj === 'number' || typeof obj === 'boolean' || typeof obj === 'bigint' || typeof obj === 'string') {
        return obj;
    }
    if (Array.isArray(obj)) {
        return obj.map(makeSafeForIPC);
    }
    if (typeof obj === 'object' && obj !== null) {
        const newObj = {};
        for (const key of Object.keys(obj)) {
            newObj[key] = makeSafeForIPC(obj[key]);
        }
        return newObj;
    }
    return '' + obj;
};

const log = (data) => {
    try {
        ipcRenderer.sendSync('__bananatron/log', makeSafeForIPC(data));
    } catch (e) {
        // i guess the IPC safety failed, whatever
        console.error(e);
    }
};

if (ipcRenderer) {
    if (ipcRenderer.on) {
        const __ipcRendererOn = ipcRenderer.on;
        ipcRenderer.on = function (event, listener) {
            log({
                'Module': ['ipcRenderer'],
                'Method': 'on',
                'Event': event,
                'FunctionAsString': listener.toString()
            });
            return __ipcRendererOn.call(this, event, listener);
        };
    }

    if (ipcRenderer.once) {
        const __ipcRendererOnce = ipcRenderer.once;
        ipcRenderer.once = function (event, listener) {
            log({
                'Module': ['ipcRenderer'],
                'Method': 'once',
                'Event': event,
                'FunctionAsString': listener.toString()
            });
            return __ipcRendererOnce.call(this, event, listener);
        };
    }

    document.addEventListener('DOMContentLoaded', () => {
        const httpEquivs = document.querySelectorAll('meta[http-equiv]');
        const cspMetas = Array.from(httpEquivs)
            .filter(i => i.getAttribute('http-equiv').toLowerCase() === 'content-security-policy')
            .map(i => i.getAttribute('content'));
        ipcRenderer.sendSync('__bananatron/dom_content_loaded', {
            htmlCSP: cspMetas.length > 0 ? cspMetas : null
        });
    });
}

if (contextBridge) {
    if (contextBridge.exposeInMainWorld) {
        const __exposeInMainWorld = contextBridge.exposeInMainWorld;
        contextBridge.exposeInMainWorld = function (name, api) {
            log({
                'Module': ['contextBridge'],
                'Method': 'exposeInMainWorld',
                'Name': name,
                'API': api
            });
            return __exposeInMainWorld.call(this, name, api);
        };
    }

    if (contextBridge.exposeInIsolatedWorld) {
        const __exposeInIsolatedWorld = contextBridge.exposeInIsolatedWorld;
        contextBridge.exposeInIsolatedWorld = function (world, name, api) {
            log({
                'Module': ['contextBridge'],
                'Method': 'exposeInIsolatedWorld',
                'World': world,
                'Name': name,
                'API': api
            });
            return __exposeInIsolatedWorld.call(this, name, api);
        };
    }
}
