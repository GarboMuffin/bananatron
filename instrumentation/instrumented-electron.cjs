const path = require('path');
const realElectron = require('electron');

const instrumentedElectron = {};

// In old versions of Electron, trying to access eg. the inAppPurchase module at all can cause an error
// if the platform doesn't support it. So we have to make these lazy. (This also matches how the real
// Electron's module looks)
for (const moduleName of Object.keys(realElectron)) {
    Object.defineProperty(instrumentedElectron, moduleName, {
        get: () => realElectron[moduleName],
        enumerable: true,
        configurable: false
    });
}

// Use this instead of console.log if we want to be able to read it after the program ends!!!
const log = require('./log.cjs');

// This is a big list of some of the callbacks we created ourselves so that we can avoid logging our own stuff.
// WeakSet will avoid leaking memory.
const ourEventListeners = new WeakSet();
/**
 * @template T
 * @param {T} callback
 * @returns {T}
 */
const internalCallback = (callback) => {
    ourEventListeners.add(callback);
    return callback;
};
const stringifyCallbacks = (callbacks) => {
    return callbacks
        .filter(fn => !ourEventListeners.has(fn))
        .map(fn => fn.toString());
};

// Handle logs from the renderer process
realElectron.ipcMain.on('__bananatron/log', internalCallback((event, data) => {
    log(data);
    event.returnValue = 1; // set any return value so renderer process resumes
}));

const httpCspCache = new WeakMap();
realElectron.ipcMain.on('__bananatron/dom_content_loaded', internalCallback((event, data) => {
    // e.senderFrame does not exist in old Electron versions
    if (event.senderFrame) {
        log({
            'Module': ['CSP'],
            'URL': event.senderFrame.url,
            'HTTP_CSP': httpCspCache.get(event.senderFrame) || null,
            'HTML_CSP': data.htmlCSP || null
        });
    }
    event.returnValue = 1; // set any return value so renderer process resumes
}));

realElectron.app.on('web-contents-created', internalCallback((event, webContents) => {
    // Log web preferences when any web contents is created
    log({
        'Module': ['BrowserWindow', 'WebContents'],
        'Event': 'web-contents-created',
        'WebPreferences': (webContents.getLastWebPreferences || webContents.getWebPreferences).call(webContents)
    });

    // Every webContents gets its own ipcMain too
    if (webContents.ipc) {
        addLoggingToIpcMain(webContents.ipc);
    }

    // Intercepts calls of executeJavascript() and logs it
    webContents.on('frame-created', internalCallback((event, frame) => {
        const oldExecuteJavaScript = frame.frame.executeJavaScript;
        frame.frame.executeJavaScript = function executeJavascript(...args) {
            log({
                'Module': ['BrowserWindow', 'WebContents', 'WebFrame'],
                'Method': 'executeJavascript',
                'Arguments': args
            });
            return oldExecuteJavaScript.apply(this, args);
        };
    }));

    // Log navigation events without interrupting the original behavior
    webContents.on('will-navigate', internalCallback((event, url) => {
        log({
            'Module': ['BrowserWindow', 'WebContents'],
            'Event': 'will-navigate',
            'URL': url
        });
    }));

    webContents.on('did-navigate', internalCallback((event, url) => {
        log({
            'Module': ['BrowserWindow', 'WebContents'],
            'Event': 'did-navigate',
            'URL': url
        });
    }));

    webContents.on('did-navigate-in-page', internalCallback((event, url) => {
        log({
            'Module': ['BrowserWindow', 'WebContents'],
            'Event': 'did-navigate-in-page',
            'URL': url
        });
    }));

    if (webContents.setWindowOpenHandler) {
        const __setWindowOpenHandler = webContents.setWindowOpenHandler;
        let called = false;
        webContents.setWindowOpenHandler = function (handler) {
            called = true;
            log({
                'Module': ['BrowserWindow', 'WebContents'],
                'Method': 'setWindowOpenHandler',
                'FunctionAsString': '' + handler
            });
            if (handler) {
                return __setWindowOpenHandler.call(this, (details) => {
                    const response = handler(details);
                    log({
                        'Module': ['BrowserWindow', 'WebContents'],
                        'Method': 'setWindowOpenHandler',
                        'Details': details,
                        'Response': response
                    });
                    return response;
                });
            } else {
                return  __setWindowOpenHandler.call(this, handler);
            }
        }

        // Give apps some time to set this
        setTimeout(() => {
            if (!called) {
                log({
                    'Module': ['BrowserWindow', 'WebContents'],
                    'Method': 'setWindowOpenHandler',
                    'WasNeverCalled': true
                });
            }
        });
    } else {
        // TODO: old versions of Electron have a different API for this
    }
}));

const addLoggingToIpcMain = (ipcMain) => {
    // If proxy is not supported, just fallback to no instrumentation
    const Proxy = global.Proxy || function (a) { return a; };

    if (ipcMain.handle) {
        const __ipcMainHandle = ipcMain.handle;
        ipcMain.handle = function handle(method, handler) {
            log({
                'Module': ['ipcMain'],
                'Attribute': 'handle',
                'Method': method,
                'FunctionAsString': handler.toString()
            });
    
            return __ipcMainHandle.call(this, method, async (event, ...args) => {
                if (!event || typeof event !== 'object') return handler(event, ...args);
    
                let checkedSender = false;
                const wrappedEvent = new Proxy(event, {
                    get: (target, property) => {
                        if (property === 'sender' || property === 'senderFrame' || property === 'senderId') {
                            checkedSender = true;
                        }
                        return target[property];
                    }
                });
    
                const result = await handler(wrappedEvent, ...args);
                log({
                    'Module': ['ipcMain'],
                    'Attribute': 'handle',
                    'Method': method,
                    'Arguments': args,
                    'Result': result,
                    'CheckedSender': checkedSender
                });
                return result;
            });
        };
    }

    if (ipcMain.handleOnce) {
        const __ipcMainHandleOnce = ipcMain.handleOnce;
        ipcMain.handleOnce = function handleOnce(method, handler) {
            log({
                'Module': ['ipcMain'],
                'Attribute': 'handleOnce',
                'Method': method,
                'FunctionAsString': handler.toString()
            });
    
            return __ipcMainHandleOnce.call(this, method, async (event, ...args) => {
                if (!event || typeof event !== 'object') return handler(event, ...args);
    
                let checkedSender = false;
                const wrappedEvent = new Proxy(event, {
                    get: (target, property) => {
                        if (property === 'sender' || property === 'senderFrame' || property === 'senderId') {
                            checkedSender = true;
                        }
                        return target[property];
                    }
                });
    
                const result = await handler(wrappedEvent, ...args);
                log({
                    'Module': ['ipcMain'],
                    'Attribute': 'handleOnce',
                    'Method': method,
                    'Arguments': args,
                    'Result': result,
                    'CheckedSender': checkedSender
                });
                return result;
            });
        };
    }

    if (ipcMain.on) {
        const __ipcMainOn = ipcMain.on;
        ipcMain.on = function on(method, handler) {
            log({
                'Module': ['ipcMain'],
                'Attribute': 'on',
                'Method': method,
                'FunctionAsString': handler.toString()
            });
    
            return __ipcMainOn.call(this, method, (event, ...args) => {
                if (!event || typeof event !== 'object') return handler(event, ...args);
    
                let checkedSender = false;
                const wrappedEvent = new Proxy(event, {
                    get: (target, property) => {
                        if (property === 'sender' || property === 'senderFrame' || property === 'senderId') {
                            checkedSender = true;
                        }
                        return target[property];
                    }
                });
    
                handler(wrappedEvent, ...args);
                log({
                    'Module': ['ipcMain'],
                    'Attribute': 'on',
                    'Method': method,
                    'Arguments': args,
                    'Result': event.returnValue,
                    'CheckedSender': checkedSender
                });
            });
        };
    }

    if (ipcMain.once) {
        const __ipcMainOnce = ipcMain.once;
        ipcMain.once = function once(method, handler) {
            log({
                'Module': ['ipcMain'],
                'Attribute': 'once',
                'Method': method,
                'FunctionAsString': handler.toString()
            });
    
            return __ipcMainOnce.call(this, method, (event, ...args) => {
                if (!event || typeof event !== 'object') return handler(event, ...args);
    
                let checkedSender = false;
                const wrappedEvent = new Proxy(event, {
                    get: (target, property) => {
                        if (property === 'sender' || property === 'senderFrame' || property === 'senderId') {
                            checkedSender = true;
                        }
                        return target[property];
                    }
                });
    
                handler(wrappedEvent, ...args);
                log({
                    'Module': ['ipcMain'],
                    'Attribute': 'once',
                    'Method': method,
                    'Arguments': args,
                    'Result': event.returnValue,
                    'CheckedSender': checkedSender
                });
            });
        };
    }
};
// Always add logging to the global ipcMain
addLoggingToIpcMain(instrumentedElectron.ipcMain);

realElectron.app.on('session-created', internalCallback((session) => {
    // Add logging to the per-session protocol object
    if (session.protocol) {
        addProtocolLogging(session.protocol);
    }

    // Log all requests
    if (session.webRequest && session.webRequest.onBeforeRequest) {
        session.webRequest.onBeforeRequest((details, callback) => {
            log({
                'Module': ['session', 'webRequest'],
                'Attribute': 'onBeforeRequest',
                'URL': details.url
            });
            // Change nothing, we just observe
            callback({});
        });
    }

    if (session.webRequest && session.webRequest.onHeadersReceived) {
        session.webRequest.onHeadersReceived((details, callback) => {
            if (details.frame && details.resourceType === 'mainFrame' || details.resourceType === 'subFrame') {
                const csps = details.responseHeaders['content-security-policy'];
                httpCspCache.set(details.frame, csps);
            }
            // Change nothing, we just observe
            callback({});
        });
    }

    // Always preprend our preload script
    if (session.setPreloads) {
        const ourPreload = path.join(__dirname, 'preload.js');
        const __setPreloads = session.setPreloads;
        session.setPreloads = function (preloads) {
            return __setPreloads.call(this, [
                ourPreload,
                ...preloads
            ]);
        };
        session.setPreloads([]);
    }

    // Log when app does not override permission request and permission check handlers
    if (session.setPermissionRequestHandler) {
        const __setPermissionRequestHandler = session.setPermissionRequestHandler;
        let usesRequestHandler = false;
        session.setPermissionRequestHandler = function(handler) {
            usesRequestHandler = true;
            log({
                'Module': ['session'],
                'Method': 'setPermissionRequestHandler',
                'FunctionAsString': '' + handler
            });
            if (handler) {
                return __setPermissionRequestHandler.call(this, (webContents, permission, callback, details) => {
                    handler(webContents, permission, (granted) => {
                        log({
                            'Module': ['session'],
                            'Method': 'setPermissionRequestHandler',
                            'Permission': permission,
                            'Details': details,
                            'Result': granted
                        });
                        callback(granted);
                    }, details);
                });
            } else {
                return __setPermissionRequestHandler.call(this, handler);
            }
        };

        // Give app chance to set this
        setTimeout(() => {
            if (!usesRequestHandler) {
                log({
                    'Module': ['session'],
                    'Method': 'setPermissionRequestHandler',
                    'WasNeverCalled': true
                });
            }
        });
    }
    if (session.setPermissionCheckHandler) {
        const __setPermissionCheckHandler = session.setPermissionCheckHandler;
        let usesCheckHandler = false;
        session.setPermissionCheckHandler = function(handler) {
            usesCheckHandler = true;
            log({
                'Module': ['session'],
                'Method': 'setPermissionCheckHandler',
                'FunctionAsString': '' + handler
            });
            if (handler) {
                return __setPermissionCheckHandler.call(this, (webContents, permission, origin, details) => {
                    const granted = handler(webContents, permission, origin, details);
                    log({
                        'Module': ['session'],
                        'Method': 'setPermissionCheckHandler',
                        'Permission': permission,
                        'Origin': origin,
                        'Details': details,
                        'Result': granted
                    });
                    return granted;
                });
            } else {
                return __setPermissionCheckHandler.call(this, handler);
            }
        };

        // Give app chance to set this
        setTimeout(() => {
            if (!usesCheckHandler) {
                log({
                    'Module': ['session'],
                    'Method': 'setPermissionCheckHandler',
                    'WasNeverCalled': true
                });
            }
        });
    }
}));

const addProtocolLogging = (protocol) => {
    // handle is the new way, registerWhatever is the old way
    // they both might exist at the same time, but if they didn't already exist then don't make them
    // start existing, since some apps (TurboWarp Desktop) do feature detection based on these
    // existing or not
    if (protocol.handle) {
        const __handle = protocol.handle;
        protocol.handle = function (scheme, handler) {
            log({
                'Module': ['protocol'],
                'Attribute': 'handle',
                'Protocol': scheme,
                'FunctionAsString': handler.toString(),
            });
            return __handle.call(this, scheme, handler);
        };
    }
    if (protocol.registerBufferProtocol) {
        const __registerBufferProtocol = protocol.registerBufferProtocol;
        protocol.registerBufferProtocol = function (scheme, handler) {
            log({
                'Module': ['protocol'],
                'Attribute': 'registerBufferProtocol',
                'Protocol': scheme,
                'FunctionAsString': handler.toString(),
            });
            return __registerBufferProtocol.call(this, scheme, handler);
        };
        const __registerFileProtocol = protocol.registerFileProtocol;
        protocol.registerFileProtocol = function (scheme, handler) {
            log({
                'Module': ['protocol'],
                'Attribute': 'registerFileProtocol',
                'Protocol': scheme,
                'FunctionAsString': handler.toString(),
            });
            return __registerFileProtocol.call(this, scheme, handler);
        };
        const __registerHttpProtocol = protocol.registerHttpProtocol;
        protocol.registerHttpProtocol = function (scheme, handler) {
            log({
                'Module': ['protocol'],
                'Attribute': 'registerHttpProtocol',
                'Protocol': scheme,
                'FunctionAsString': handler.toString(),
            });
            return __registerHttpProtocol.call(this, scheme, handler);
        };
        const __registerStreamProtocol = protocol.registerStreamProtocol;
        protocol.registerStreamProtocol = function (scheme, handler) {
            log({
                'Module': ['protocol'],
                'Attribute': 'registerStreamProtocol',
                'Protocol': scheme,
                'FunctionAsString': handler.toString(),
            });
            return __registerStreamProtocol.call(this, scheme, handler);
        };
        const __registerStringProtocol = protocol.registerStringProtocol;
        protocol.registerStringProtocol = function (scheme, handler) {
            log({
                'Module': ['protocol'],
                'Attribute': 'registerStringProtocol',
                'Protocol': scheme,
                'FunctionAsString': handler.toString(),
            });
            return __registerStringProtocol.call(this, scheme, handler);
        };
    }
    if (protocol.registerSchemesAsPrivileged) {
        const __registerSchemesAsPrivileged = protocol.registerSchemesAsPrivileged;
        protocol.registerSchemesAsPrivileged = function (schemes) {
            log({
                'Module': ['protocol'],
                'Attribute': 'registerSchemesAsPrivileged',
                'Schemes': schemes
            });
            return __registerSchemesAsPrivileged.call(this, schemes);
        };
    }
};
// don't need to handle electron.protocol separately, the session created callback seems to work on its own

realElectron.app.on('browser-window-created', internalCallback((event, window) => {
    log({
        'Module': ['BrowserWindow','WebContents'],
        'Attribute': 'webPreferences',
        'Event': ['browser-window-created'],
        'WebPreferences': (window.webContents.getLastWebPreferences || window.webContents.getWebPreferences).call(window.webContents),
        'WebContents': {
            'webContentsId': window.webContents.id
        }
    });

    // Wait a little bit so the app can setup whatever listeners
    setTimeout(() => {
        log({
            'Module': ['app', 'WebContents'],
            'Attribute': '',
            'Event': ['app-ready'],
            'WebContents': {
                'webContentsId': window.webContents.id
            },
            'EventHandlers': {
                'will-navigate': stringifyCallbacks(window.webContents.listeners('will-navigate')),
                'new-window': stringifyCallbacks(window.webContents.listeners('new-window')),
                'will-attach-webview': stringifyCallbacks(window.webContents.listeners('will-attach-webview')),
            }
        });
    });
}));

const __setAsDefaultProtocolClient = instrumentedElectron.app.setAsDefaultProtocolClient;
instrumentedElectron.app.setAsDefaultProtocolClient = (...args) => {
    let objectToPush = {
        'Module': ['App'],
        'Attribute': 'setAsDefaultProtocolClient',
        'Args': args
    };
    log(objectToPush);
    return __setAsDefaultProtocolClient(...args);
};

realElectron.app.on('ready', () => {
    // Wait a little bit to let the app finish setting up
    setTimeout(() => {
        const app = realElectron.app;
        log({
            'Module': ['app'],
            'EventHandlers': {
                // slice(1) removes internal event listener used by Electron itself
                'certificate-error': stringifyCallbacks(app.listeners('certificate-error').slice(1)),
                'web-contents-created': stringifyCallbacks(app.listeners('web-contents-created'))
            }
        });

        const commandLine = realElectron.app.commandLine;
        if (commandLine && typeof commandLine.hasSwitch === 'function') {
            log({
                'Module': ['app', 'commandLine'],
                'CommandLineSwitches': {
                    '--ignore-certificate-errors': commandLine.hasSwitch('ignore-certificate-errors') ? commandLine.getSwitchValue('ignore-certificate-errors') : false,
                    '--ignore-certificate-errors-spki-list': commandLine.hasSwitch('ignore-certificate-errors-spki-list') ? commandLine.getSwitchValue('ignore-certificate-errors-spki-list') : false,
                    '--ignore-urlfetcher-cert-requests': commandLine.hasSwitch('ignore-urlfetcher-cert-requests') ? commandLine.getSwitchValue('ignore-urlfetcher-cert-requests') : false,
                    '--disable-web-security': commandLine.hasSwitch('disable-web-security') ? commandLine.getSwitchValue('disable-web-security') : false,
                    '--host-rules': commandLine.hasSwitch('host-rules') ? commandLine.getSwitchValue('host-rules') : false,
                    '--host-resolver-rules': commandLine.hasSwitch('host-resolver-rules') ? commandLine.getSwitchValue('host-resolver-rules') : false,
                    '--auth-server-whitelist': commandLine.hasSwitch('auth-server-whitelist') ? commandLine.getSwitchValue('auth-server-whitelist') : false,
                    '--auth-negotiate-delegate-whitelist': commandLine.hasSwitch('auth-negotiate-delegate-whitelist') ? commandLine.getSwitchValue('auth-negotiate-delegate-whitelist') : false,
                    '--js-flags': commandLine.hasSwitch('js-flags') ? commandLine.getSwitchValue('js-flags') : false,
                    '--allow-file-access-from-files': commandLine.hasSwitch('allow-file-access-from-files') ? commandLine.getSwitchValue('allow-file-access-from-files') : false,
                    '--allow-no-sandbox-job': commandLine.hasSwitch('allow-no-sandbox-job') ? commandLine.getSwitchValue('allow-no-sandbox-job') : false,
                    '--allow-running-insecure-content': commandLine.hasSwitch('allow-running-insecure-content') ? commandLine.getSwitchValue('allow-running-insecure-content') : false,
                    '--cipher-suite-blacklist': commandLine.hasSwitch('cipher-suite-blacklist') ? commandLine.getSwitchValue('cipher-suite-blacklist') : false,
                    '--debug-packed-apps': commandLine.hasSwitch('debug-packed-apps') ? commandLine.getSwitchValue('debug-packed-apps') : false,
                    '--disable-features': commandLine.hasSwitch('disable-features') ? commandLine.getSwitchValue('disable-features') : false,
                    '--disable-kill-after-bad-ipc': commandLine.hasSwitch('disable-kill-after-bad-ipc') ? commandLine.getSwitchValue('disable-kill-after-bad-ipc') : false,
                    '--disable-webrtc-encryption': commandLine.hasSwitch('disable-webrtc-encryption') ? commandLine.getSwitchValue('disable-webrtc-encryption') : false,
                    '--disable-xss-auditor': commandLine.hasSwitch('disable-xss-auditor') ? commandLine.getSwitchValue('disable-xss-auditor') : false,
                    '--enable-local-file-accesses': commandLine.hasSwitch('enable-local-file-accesses') ? commandLine.getSwitchValue('enable-local-file-accesses') : false,
                    '--enable-nacl-debug': commandLine.hasSwitch('enable-nacl-debug') ? commandLine.getSwitchValue('enable-nacl-debug') : false,
                    '--remote-debugging-address': commandLine.hasSwitch('remote-debugging-address') ? commandLine.getSwitchValue('remote-debugging-address') : false,
                    '--remote-debugging-port': commandLine.hasSwitch('remote-debugging-port') ? commandLine.getSwitchValue('remote-debugging-port') : false,
                    '--inspect': commandLine.hasSwitch('inspect') ? commandLine.getSwitchValue('inspect') : false,
                    '--inspect-brk': commandLine.hasSwitch('inspect-brk') ? commandLine.getSwitchValue('inspect-brk') : false,
                    '--explicitly-allowed-ports': commandLine.hasSwitch('explicitly-allowed-ports') ? commandLine.getSwitchValue('explicitly-allowed-ports') : false,
                    '--expose-internals-for-testing': commandLine.hasSwitch('expose-internals-for-testing') ? commandLine.getSwitchValue('expose-internals-for-testing') : false,
                    '--gpu-launcher': commandLine.hasSwitch('gpu-launcher') ? commandLine.getSwitchValue('gpu-launcher') : false,
                    '--nacl-dangerous-no-sandbox-nonsfi': commandLine.hasSwitch('nacl-dangerous-no-sandbox-nonsfi') ? commandLine.getSwitchValue('nacl-dangerous-no-sandbox-nonsfi') : false,
                    '--nacl-gdb-script': commandLine.hasSwitch('nacl-gdb-script') ? commandLine.getSwitchValue('nacl-gdb-script') : false,
                    '--net-log-capture-mode': commandLine.hasSwitch('net-log-capture-mode') ? commandLine.getSwitchValue('net-log-capture-mode') : false,
                    '--no-sandbox': commandLine.hasSwitch('no-sandbox') ? commandLine.getSwitchValue('no-sandbox') : false,
                    '--reduce-security-for-testing': commandLine.hasSwitch('reduce-security-for-testing') ? commandLine.getSwitchValue('reduce-security-for-testing') : false,
                    '--unsafely-treat-insecure-origin-as-secure': commandLine.hasSwitch('unsafely-treat-insecure-origin-as-secure') ? commandLine.getSwitchValue('unsafely-treat-insecure-origin-as-secure') : false,
                },
            });
        }
    });
});

const __shellOpenExternal = realElectron.shell.openExternal;
instrumentedElectron.shell.openExternal = function (value) {
    log({
        'Module': ['shell'],
        'Method': 'openExternal',
        'Value': value
    });
    return __shellOpenExternal.call(this, value);
};

module.exports = instrumentedElectron;
