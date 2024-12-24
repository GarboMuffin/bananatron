# Bananatron

Black-box auditing framework for Electron apps.

Bananatron is inspired by [Rise of Inspectron: Automated Black-box Auditing of Cross-platform Electron Apps](https://www.usenix.org/conference/usenixsecurity24/presentation/ali) by Mir Masood Ali, Mohammad Ghasemisharif, Chris Kanich, and Jason Polakis. The difference is how the instrumentation is added to the app. We like to say that Bananatron lives in the "API layer" and Inspectron lives in the "implementation layer".

## Usage

### Step 0: Dependencies

The project is written in JavaScript. You'll need to install Node.js and npm to run it. Usually these are bundled together. You can download them from https://nodejs.org/

Then run this in a terminal to install the rest of the dependencies:

```bash
npm ci
```

### Step 1: Download an app

For all the platforms, our goal is to download an app and find the folder to where it got installed.

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

Launch the app as you would normally. It'll work as normal, but now with instrumentation. Click around a bit to collect as much possibly interesting data as possible.

### Step 4: Analyze the data

The logs are stored in a folder called Bananatron Logs in your home directory. They can be quite long, so good luck. We have a script that automated much of this process however it is not ready to be shared.
