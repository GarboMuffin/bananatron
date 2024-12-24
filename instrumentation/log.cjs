const packageJSON = require('../package.json');
const fs = require('fs');
const path = require('path');
const os = require('os');
const util = require('util');

const appName = (packageJSON.name || 'Unknown App')
    // replace / with - so it doesn't try to make a folder
    .replace(/\//g, '-');

const date = new Date();

const formatNumber = (number) => {
    const string = number.toString();
    if (string.length >= 2) return string;
    return '0' + string;
};

const formatted = `${date.getFullYear()}-${formatNumber(date.getMonth() + 1)}-${formatNumber(date.getDate())} ${formatNumber(date.getHours())}-${formatNumber(date.getMinutes())}-${formatNumber(date.getSeconds())}`;
const logsDir = path.dirname(path.join(os.homedir(), 'Bananatron Logs', formatted));

if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
}
const logPath = path.join(logsDir, `${appName} ${formatted}.log`);

const makeSafeForStringify = (obj) => {
    try {
        JSON.stringify(obj);
        // stringify worked, so safe already
        return obj;
    } catch (e) {
    }

    const newObj = {};
    for (const key of Object.keys(obj)) {
        newObj[key] = makeSafeForStringify(obj[key]);
    }

    if (Object.keys(newObj).length === 0) {
        // Guess we are the problem :(
        return '[NOT SERIALIZABLE: ' + obj.toString() + ']';
    }

    return newObj;
};

/**
 * Log to console and to file.
 */
const log = (data) => {
    // Use process.stdout instead of console.log so it's less likely to get detected by the app's
    // own instrumentation. But we still want the fancy formatting.
    process.stdout.write('[Bananatron] ' + util.inspect(data, {
        colors: true,
    }) + '\n');

    try {
        const serialized = JSON.stringify(makeSafeForStringify(data));
        fs.appendFileSync(logPath, serialized + '\n');
    } catch (e) {
        process.stderr.write('[Bananatron] Log error: ' + util.inspect(e, {
            colors: true,
        }) + '\n');
    }
};

module.exports = log;
