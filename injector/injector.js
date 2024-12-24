const fsExtra = require('fs-extra');
const os = require('os');
const childProcess = require('child_process');
const path = require('path');
const asar = require('@muffins/asar');
const {FuseV1Options, FuseVersion, flipFuses, getCurrentFuseWire} = require('@electron/fuses');

// Path to JS instrumentation module's source code
const instrumentationModuleSource = path.join(__dirname, '../instrumentation');

/**
 * @param {string} path
 * @returns {boolean} True if path exists and is a regular file.
 */
const fileExists = (path) => {
    try {
        return fsExtra.statSync(path).isFile();
    } catch (e) {
        return false; // Any error, like ENOENT for not existing, means path isn't a file
    }
};

/**
 * @param {string} path
 * @returns {boolean} True if path exists and is a directory.
 */
const directoryExists = (path) => {
    try {
        return fsExtra.statSync(path).isDirectory();
    } catch (e) {
        return false; // Any error, like ENOENT for not existing, means path isn't a directory
    }
};

/**
 * @param {string} resourcesPath
 * @param {object} packageJson
 * @returns {[string, string]}
 */
const resolvePackageMain = (resourcesPath, packageJson) => {
    const realMainName = packageJson.main || 'index.js';

    for (const extension of ['', '.js', '.cjs', '.mjs', '/index.js', '/index.cjs', '/index.mjs']) {
        const nameWithExtension = realMainName + extension;
        const fullPath = path.join(resourcesPath, nameWithExtension);
        if (fileExists(fullPath)) {
            return [nameWithExtension, fullPath];
        }
    }

    throw new Error(`Could not resolve main for ${realMainName}`);
};

/**
 * @param {string} resourcesPath
 * @param {import('@electron/fuses').FuseConfig|null} originalFuses
 */
const addInstrumentation = (resourcesPath, originalFuses) => {
    // Read the old package.json
    const packageJsonPath = path.join(resourcesPath, 'package.json');
    const packageJsonText = fsExtra.readFileSync(packageJsonPath, 'utf-8');
    const packageJsonData = JSON.parse(packageJsonText);

    // Create __bananatron signature if it doesn't exist yet
    if (!packageJsonData.__bananatron) {
        packageJsonData.__bananatron = {};
    }

    // Old versions of Bananatron injected a new main script. But now we override the file itself, so
    // detect this and put the old main script back.
    if (packageJsonData.__bananatron.realMain) {
        packageJsonData.main = packageJsonData.__bananatron.realMain;
        delete packageJsonData.__bananatron.realMain;
    }

    // Store fuse information too
    // If someone was using old bananatron, __bananatron could be set but fuse information missing
    // so check separately.
    if (!Object.prototype.hasOwnProperty.call(packageJsonData.__bananatron, 'fuses')) {
        let formattedFuses;
        if (originalFuses) {
            formattedFuses = {};
            for (const [name, id] of Object.entries(FuseV1Options)) {
                if (/^\d+$/.test(name)) continue;
                const value = originalFuses[id];
                formattedFuses[name] = value === 49; // 49 is enable
            }
        } else {
            formattedFuses = null;
        }

        packageJsonData.__bananatron.fuses = {
            raw: originalFuses,
            formatted: formattedFuses
        };
    }

    // Save our new package.json
    fsExtra.writeFileSync(packageJsonPath, JSON.stringify(packageJsonData, null, 4));

    // Remove old instrumentation then install the latest version
    const bananatronPath = path.join(resourcesPath, '__bananatron');
    fsExtra.removeSync(bananatronPath);
    fsExtra.mkdirSync(bananatronPath, {
        recursive: true
    });

    // If the Electron version is new enough to have fuses, we don't need to babel it.
    // Otherwise we'll assume the worst.
    const needsBabel = !originalFuses;
    if (needsBabel) {
        console.log('Looks like an old Electron version; running instrumentation through babel');
    }

    for (const instrumentationFileName of fsExtra.readdirSync(instrumentationModuleSource)) {
        const fileContent = fsExtra.readFileSync(path.join(instrumentationModuleSource, instrumentationFileName));
        const compatibleCode = needsBabel ? require('@babel/core').transformSync(fileContent, {
            plugins: [
                require('@babel/plugin-transform-spread').default,
                require('@babel/plugin-transform-parameters').default,
                require('@babel/plugin-transform-regenerator').default,
                require('@babel/plugin-transform-block-scoping').default
            ]
        }).code : fileContent;
        fsExtra.writeFileSync(path.join(bananatronPath, instrumentationFileName), compatibleCode);
    }

    // If no main specified, it defaults to index.js
    const [realMainName, realMainPath] = resolvePackageMain(resourcesPath, packageJsonData);
    const relativeFromMainToBananatron = path.relative(path.dirname(realMainPath), bananatronPath);

    let isModule;
    if (realMainName.endsWith('.mjs')) {
        isModule = true;
    } else if (realMainName.endsWith('.cjs')) {
        isModule = false;
    } else {
        isModule = packageJsonData.type === 'module';
    }

    const realMainContents = fsExtra.readFileSync(realMainPath, 'utf-8')
        .replace(/\/\/ __BANANATRON_START__\n[\s\S]+?\/\/ __BANANATRON_END__\n/gm, '');

    const pathToBananatronEntry = JSON.stringify('./' + relativeFromMainToBananatron + '/instrumentation.cjs');
    const newMainPrelude = (
        isModule ?
        `import ${pathToBananatronEntry};` :
        `try {
            require(${pathToBananatronEntry});
        } catch (e) {
            console.error((e && e.stack) || e);
            require('electron').dialog.showErrorBox('Bananatron Initialization Error', (e && e.stack) || e);
            process.exit(1);
        }`
    );
    const newMainContents = '// __BANANATRON_START__\n' + newMainPrelude + '\n// __BANANATRON_END__\n' + realMainContents;
    fsExtra.writeFileSync(realMainPath, newMainContents);
};

/**
 * @param {string} resourcesPath
 */
const removeInstrumentation = (resourcesPath) => {
    const packageJsonPath = path.join(resourcesPath, 'package.json');
    if (!fileExists(packageJsonPath)) {
        throw new Error(`${packageJsonPath} does not exist`);
    }

    // Remove instrumentation module
    fsExtra.removeSync(path.join(resourcesPath, '__bananatron'));

    // Restore package.json
    const packageJsonText = fsExtra.readFileSync(packageJsonPath, 'utf-8');
    const packageJsonData = JSON.parse(packageJsonText);
    if (packageJsonData.__bananatron) {
        // Compatibility with old versions of Bananatron
        if (packageJsonData.__bananatron.realMain) {
            packageJsonData.main = packageJsonData.__bananatron.realMain;
        }

        delete packageJsonData.__bananatron;
        fsExtra.writeFileSync(packageJsonPath, JSON.stringify(packageJsonData, null, 4));
    }

    // Restore main script
    const [_realMainName, realMainPath] = resolvePackageMain(resourcesPath, packageJsonData);
    const oldMainContents = fsExtra.readFileSync(realMainPath, 'utf-8');
    const newMainContents = oldMainContents.replace(/\/\/ __BANANATRON_START__\n[\s\S]+?\/\/ __BANANATRON_END__\n/gm, '');
    fsExtra.writeFileSync(realMainPath, newMainContents);
};

/**
 * Recursively list all the child directories in a directory including itself.
 * Like UNIX "find -type d".
 * @param {string} dir
 * @returns {string[]} Absolute paths.
 */
const getAllDirectories = (dir) => {
    const contents = fsExtra.readdirSync(dir)
        .sort() // for determinism
        .map(i => path.join(dir, i));
    let result = [dir];
    for (const child of contents) {
        if (directoryExists(child)) {
            // This is probably O(n^2) but there's never enough directories in the app
            // for that to matter.
            result = [...result, ...getAllDirectories(child)];
        }
    }
    return result;
};

const removeMacCodeSigning = (appPath) => {
    const child = childProcess.spawn('codesign', [
        '--remove-signature',
        '--force',
        '--deep',
        appPath
    ]);
    return new Promise((resolve, reject) => {
        child.on('exit', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(code);
            }
        });
    });
};

const getExecutablePath = (appPath) => {
    if (process.platform === 'darwin') {
        // Just return the .app file
        return appPath;
    }

    if (process.platform === 'win32') {
        const possible = fsExtra.readdirSync(appPath)
            .filter(i => i.endsWith('.exe'));

        for (const name of possible) {
            const p = path.join(appPath, name);
            const stat = fsExtra.statSync(p);
            if (!stat.isDirectory() && stat.size > 40000000) {
                return p;
            }
        }

        throw new Error(`None of these files looks like the executable: ${possible.join(', ')}`);
    }

    if (process.platform === 'linux') {
        const possible = fsExtra.readdirSync(appPath)
            .filter(i => (
                !/\.so(?:\.\d+)?$/.test(i) &&
                !i.endsWith('.pak') &&
                !i.endsWith('.dll') &&
                !i.endsWith('.json') &&
                !i.endsWith('.js') &&
                !i.endsWith('.asar') &&
                !i.endsWith('.bin') &&
                !i.endsWith('.html') &&
                !i.endsWith('.txt') &&
                !i.endsWith('.dat') &&
                i !== 'chrome-sandbox' &&
                i !== 'chrome_crashpad_handler' &&
                i !== 'resources' &&
                i !== 'locales'
            ));

        for (const name of possible) {
            const p = path.join(appPath, name);
            const stat = fsExtra.statSync(p);
            if (!stat.isDirectory() && stat.size > 80000000 && (stat.mode & 0o400) === 0o400) {
                return p;
            }
        }

        throw new Error(`None of these files are executable: ${possible.join(', ')}`);
    }
};

/**
 * Injects our instrumentation into an existing Electron app.
 * @param {string} appPath
 * For Windows and Linux:
 *      appPath should point to the folder where the app is installed.
 *      This is the directory where files like "chrome_100_percent.pak" can be found.
 *      The path needs to be writable by us.
 * For macOS:
 *      appPath should point to the .app file.
 * @param {boolean} enableInstrumentation True to add Bananatron, false to remove.
 */
const inject = async (appPath, enableInstrumentation) => {
    // On Windows, ~ is not automatically converted to home directory by the shell.
    // For convenience we'll do that here...
    appPath = appPath.replace(/^~/, os.homedir());

    // We want a directory not the actual exe
    if (fileExists(appPath)) {
        appPath = path.dirname(appPath);
    }

    if (!directoryExists(appPath)) {
        throw new Error(`${appPath} needs to be a directory`);
    }

    const isMacOS = process.platform === 'darwin';
    if (isMacOS) {
        if (!directoryExists(path.join(appPath, 'Contents/Frameworks/Electron Framework.framework'))) {
            throw new Error(`${appPath} does not look like an Electron app (Electron Framework.framework missing)`);
        }
    } else {
        const EXPECTED_FILES = [
            'chrome_100_percent.pak',
            'content_resources_200_percent.pak',
            'libEGL.dll',
            'libGLESv2.dll',
            'v8_context_snapshot.bin'
        ];
        if (!EXPECTED_FILES.some(i => fileExists(path.join(appPath, i)))) {
            throw new Error(`${appPath} does not look like an Electron app (none of these exist: ${EXPECTED_FILES.join(', ')})`);
        }
    }

    // Read fuses ahead of time and disable ASAR integrity.
    let originalFuseConfig = null;
    try {
        const executablePath = getExecutablePath(appPath);
        originalFuseConfig = await getCurrentFuseWire(executablePath);

        if (
            originalFuseConfig.version === FuseVersion.V1 &&
            originalFuseConfig[FuseV1Options.EnableEmbeddedAsarIntegrityValidation] === 49 /* ENABLE */
        ) {
            console.log(`Disabling ASAR integrity validation for ${executablePath}`);

            const newFuses = {
                version: FuseVersion.V1,
                // TODO: preserve the rest of the options?
                [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false
            };
            await flipFuses(executablePath, newFuses);

            if (process.platform === 'darwin') {
                // Changed binary, so have to get rid of the code signatures
                for (const dir of getAllDirectories(appPath)) {
                    if (dir.endsWith('.app') || dir.endsWith('.framework')) {
                        console.log(`Removing code signature from ${dir}`);
                        await removeMacCodeSigning(dir);
                    }
                }
            }
        }
    } catch (e) {
        console.error(`Fuse error on ${appPath} (this is probably a bug but will continue anyways as it is non-critical)`, e);
    }

    const resourcesPath = path.join(appPath, isMacOS ? 'Contents/Resources' : 'resources');
    const possibleAsars = [
        // Many apps package all the JS resources into an ASAR file
        // Example: Scratch 3
        path.join(resourcesPath, 'app.asar'),

        // Some apps have a different ASAR for each system architecture
        // Example: Slack
        path.join(resourcesPath, 'app-x64.asar'),
        path.join(resourcesPath, 'app-arm64.asar'),
    ];

    const possibleUnpackedDirectories = [
        // Some apps are just loose files
        // Example: VS Code
        path.join(resourcesPath, 'app'),
    ];

    let anySuccess = false;
    const errors = [];

    for (const possibleAsar of possibleAsars) {
        if (!fileExists(possibleAsar)) {
            continue;
        }

        console.log(`Injecting ${possibleAsar}`);
        const tempPath = path.join(os.tmpdir(), `bananatron-${Math.random()}`);
        const adjacentUnpackedPack = possibleAsar + '.unpacked';

        try {
            try {
                asar.extractAll(possibleAsar, tempPath);

                // Copy over .unpacked, so when we recreate the archive, the asar helper creates
                // all the symlinks needed for the app to find the files.
                if (fsExtra.existsSync(adjacentUnpackedPack)) {
                    console.log(`Importing adjacent unpacked ${adjacentUnpackedPack}`);
                    fsExtra.copySync(adjacentUnpackedPack, tempPath);
                }
            } catch (e) {
                console.error('Error extracting asar but will try continuing anyways', e);
            }
            if (enableInstrumentation) {
                addInstrumentation(tempPath, originalFuseConfig);
            } else {
                removeInstrumentation(tempPath);
            }
            await asar.createPackage(tempPath, possibleAsar);
            anySuccess = true;
        } catch (e) {
            errors.push(e);
        } finally {
            // Always remove the temporary file, even if something went horribly wrong
            fsExtra.removeSync(tempPath);
        }
    }

    for (const possibleUnpackedDirectory of possibleUnpackedDirectories) {
        if (!directoryExists(possibleUnpackedDirectory)) {
            continue;
        }

        console.log(`Injecting ${possibleUnpackedDirectory}`);

        try {
            if (enableInstrumentation) {
                addInstrumentation(possibleUnpackedDirectory);
            } else {
                removeInstrumentation(possibleUnpackedDirectory);
            }
            anySuccess = true;
        } catch (e) {
            errors.push(e);
        }
    }

    if (!anySuccess) {
        console.error(errors);
        throw new Error('All injection attemps failed :( See array above for individual errors');
    }
};

const run = async () => {
    if (process.argv.length < 3) {
        console.error(`Need to provide path to app, like this: node injector <path>`);
        process.exit(1);
    }

    const errors = [];
    const files = process.argv.slice(2).filter(i => !i.startsWith('--'));
    for (const file of files) {
        try {
            await inject(file, !process.argv.includes('--undo'));
        } catch (e) {
            console.error('Error!', file, e);
            errors.push(e);
        }
    }

    if (errors.length) {
        console.log('Injector is exiting with errrors');
        process.exit(1);
    } else {
        console.log('Injector is exiting successfully');
    }
};

run();
