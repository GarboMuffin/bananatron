# Bananatron

Black-box auditing framework for Electron apps.

Bananatron is inspired by [Rise of Inspectron: Automated Black-box Auditing of Cross-platform Electron Apps](https://www.usenix.org/conference/usenixsecurity24/presentation/ali) by Mir Masood Ali, Mohammad Ghasemisharif, Chris Kanich, and Jason Polakis. The difference is how the instrumentation is added to the app. We like to say that Bananatron lives in the "API layer" and Inspectron lives in the "implementation layer".

## Why and how

https://muffin.ink/blog/bananatron/

## Usage

### Step 0: Dependencies

The project is written in JavaScript. You'll need to install Node.js and npm to run it. Usually these are bundled together. You can download them from https://nodejs.org/

Then run this in a terminal to install the rest of the dependencies:

```bash
npm ci
```

### Step 1: Download an app

For all the platforms, our goal is to download an app and find the folder to where it got installed. Bananatron is a black-box auditor, so the app does not need to be open source (but source code does make later analysis much easier).

#### Windows

1. Download the app from its website.
2. Install the app.
3. Figure out where the app got installed. You can find the app's entry in the start menu > right click > open file location > right click on the shortcut > open file location again and it'll bring you to the folder. You'll know you found the right folder if there's files named like "ffmpeg.dll" and "chrome_100_percent.pak". For many apps with autoupdate, you'll need to go into another folder named like "app-1.2.3" to find the actual Electron files.

#### macOS

1. Go into System Settings > Privacy and Security > App Management > Add your IDE/terminal/etc. to this list so that it is allowed to modify apps. You should actually restart the app when macOS tells you to.
2. Download the app from its website. Drag the .app into /Applications.
3. Launch the unmodified app once to pass code signing integrity checks.
4. The path of the .app bundle itself is what you'll need in the next section.

#### Linux

1. Download the app from its website.
2. Extract/install the app. We need to get to the actual files. This depends on the what format the app is available in:
   - Archive (tar.gz, zip, etc.): This is the easiest case. Just extract the archive.
   - OS package (deb, rpm, etc.): We found it was easiest to install the package and then search through /opt and /usr to find the app's actual files.
   - AppImage: run `chmod +x [name].AppImage` to mark it as executable then `./[name].AppImage --appimage-extract`. This will output the app files into a folder called squashfs-root.
   - Snap: Use `snap download` to download the .snap file, then extract using `unsquashfs` to output the app files into a folder called squashfs-root. Look around the extracted filesystem to find the main Electron binary, similar to an OS package. Run the executable directly instead of in the Snap sandbox.
3. Find the actual Electron files. You'll know you found the right folder if there's files named like "libffmpeg.so" and "chrome_100_percent.pak".

### Step 2: Run the injector

In the previous step you found the path where the Electron parts of the app lives. Now you take that path, and pass it to the injector:

```bash
node injector /path/to/the/app/folder
```

On Windows you may need to run this in an administrator terminal. On macOS and Linux you may need to run this using sudo.

This will install the latest version of the instrumentation scripts into the app. You have to redo this whenever the instrumentation is updated.

As an example, consider [TurboWarp Desktop](https://desktop.turbowarp.org/) (I make this app). After installing it, the commands to run are:

 - Windows: `node injector "C:\Users\[your username]\AppData\Local\Programs\TurboWarp"`
 - macOS: `node injector /Applications/TurboWarp.app`
 - Linux .deb: `sudo node injector /opt/TurboWarp`

### Step 3: Instrument

Launch the app as you would normally. It'll work the same as normal, but now its inner workings are being instrumented. Interact with the app as a user would to gather as much interesting data as possible.

We repeated this process for more than 100 apps to get a pretty big dataset.

### Step 4: Analyze the data

The logs are stored in a folder called `Bananatron Logs` in your home directory. They can be quite long and are meant to be machine-readable. Good luck.

We have a script that we used to identify various risks to be further analyzed by a human, however it is not ready to be shared.

## Discovered security vulnerabilities

Bugs that were discovered, at least in part, based on data collected by Bananatron:

 - Altair (GraphQL client) did not validate HTTPS certificates (CVE-2024-54147)
 - Buttercup (password manager) disables web security for Dropbox authentication, allowing the page to read arbitrary files and bypass the same-origin policy

## License

Bananatron is available under the [GNU General Public License v3.0](LICENSE) license. The copyleft clauses of the GPLv3 should not hinder auditing closed-source apps on your computer as that is not redistribution.
