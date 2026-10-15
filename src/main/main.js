const { app, BrowserWindow, ipcMain, globalShortcut, desktopCapturer, screen, dialog } = require('electron');
const { exec } = require('child_process');
const path = require('path');

// --- ROBUST ENV LOADER FOR ELECTRON-BUILDER ---
// In development, app.isPackaged is false, so we load .env from the root directory.
// When packaged, electron-builder places 'extraResources' in process.resourcesPath.
const isPackaged = app.isPackaged;
const envPath = isPackaged
  ? path.join(process.resourcesPath, '.env')
  : path.join(__dirname, '../../.env');

require('dotenv').config({ path: envPath });
// ----------------------------------------------

const WebSocket = require('ws');
let launchWindow = null;
let overlayWindow = null;
let isLocked = false; // Default state for the overlay: Unlocked
let mousePoller = null;
let dragInterval = null;
let dragOffset = { x: 0, y: 0 };
global.interviewSettings = {};
global.appTheme = 'Dark';
global.transcriptionMode = 'auto';
global.autoSessionTranscript = "";
global.preferredActiveTab = 'bullet'; // Defaults to bullet mode

function enforceMacAudioRouting() {
  const { exec } = require('child_process');
  const { dialog, app } = require('electron');
  const path = require('path');
  const fs = require('fs');

  return new Promise((resolve) => {
    if (process.platform !== 'darwin') {
      console.log('[Audio Gatekeeper] Windows detected. Bypassing audio lock.');
      return resolve(true);
    }

    console.log('[Audio Gatekeeper] macOS detected. Initiating Soft Gate Wizard...');

    exec('system_profiler SPAudioDataType', async (error, stdout) => {
      const hasBlackHole = stdout && stdout.includes('BlackHole');
      const hasMultiOutput = stdout && stdout.includes('Multi-Output');

      // STEP 1: MIDI Setup (Trigger if driver OR device is missing)
      if (!hasBlackHole || !hasMultiOutput) {
        console.log('[Audio Gatekeeper] BlackHole or Multi-Output missing. Triggering Step 1...');

        const response = await dialog.showMessageBox({
          type: 'info',
          buttons: ['Install Now', 'Cancel'],
          title: 'Audio Driver Required',
          message: 'Nexora needs an internal audio driver to capture interview audio on Mac.',
          detail: 'This will install the open-source BlackHole 2ch driver. You will be prompted for your Mac password.'
        });

        if (response.response === 0) {
          const isPackaged = app.isPackaged;
          const possiblePaths = isPackaged ? [
            path.join(process.resourcesPath, 'assets', 'BlackHole2ch.pkg')
          ] : [
            path.join(__dirname, '..', '..', 'assets', 'BlackHole2ch.pkg'),
            path.join(process.cwd(), 'assets', 'BlackHole2ch.pkg'),
            path.join(__dirname, 'assets', 'BlackHole2ch.pkg')
          ];

          let validPkgPath = null;
          for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
              validPkgPath = p;
              break;
            }
          }

          if (!validPkgPath) {
            console.error('[Audio Gatekeeper] 🚨 INSTALLER FILE NOT FOUND.');
            dialog.showErrorBox('Missing Installer File', 'Could not find the BlackHole installer.');
            app.quit();
            return;
          }

          const tmpPkgPath = '/tmp/BlackHole2ch.pkg';
          try {
            fs.copyFileSync(validPkgPath, tmpPkgPath);
          } catch (copyErr) {
            dialog.showErrorBox('Permission Error', 'Could not access the installer file.');
            app.quit();
            return;
          }

          const installCommand = `osascript -e 'do shell script "installer -pkg " & quoted form of "${tmpPkgPath}" & " -target / && killall coreaudiod" with administrator privileges'`;

          await new Promise((installResolve) => {
            exec(installCommand, (installErr) => {
              if (fs.existsSync(tmpPkgPath)) fs.unlinkSync(tmpPkgPath);
              if (installErr) {
                dialog.showErrorBox('Installation Failed', 'Could not install the audio driver.');
                app.quit();
              } else {
                installResolve();
              }
            });
          });
        } else {
          app.quit();
          return;
        }

        // Guide them through creating the Multi-Output device
        const midiResponse = await dialog.showMessageBox({
          type: 'info',
          title: 'Step 1: Create Audio Router',
          message: 'Nexora needs a Multi-Output Device to link your headphones to its audio engine.',
          detail: '1. Click "Open Audio MIDI Setup" below.\n2. Click the "+" icon (bottom left) -> "Create Multi-Output Device".\n3. Check the boxes for "BlackHole 2ch" AND your Headphones.\n4. (Optional) Rename it to "Nexora".\n5. Come back and click "Next".',
          buttons: ['Next', 'Open Audio MIDI Setup'],
          defaultId: 0
        });

        if (midiResponse.response === 1) {
          exec('open -a "Audio MIDI Setup"');
          await dialog.showMessageBox({
            type: 'info',
            title: 'Waiting for MIDI Setup',
            message: 'Once you have created the Multi-Output device, click Continue.',
            buttons: ['Continue']
          });
        }
      }

      // STEP 2: System Sound Output (Always show this to ensure they are routed)
      const soundResponse = await dialog.showMessageBox({
        type: 'info',
        title: 'Step 2: Set System Output',
        message: 'Almost done! Now route your Mac sound through the new device.',
        detail: '1. Click "Open Sound Settings" below.\n2. Change your Output to the Multi-Output Device (or "Nexora" if you renamed it).\n3. Come back and click "Verify & Launch".',
        buttons: ['Verify & Launch', 'Open Sound Settings', 'Quit'],
        defaultId: 0,
        cancelId: 2
      });

      if (soundResponse.response === 1) {
        exec('open /System/Library/PreferencePanes/Sound.prefPane');
        await dialog.showMessageBox({
          type: 'info',
          title: 'Final Step',
          message: 'Once you have selected the new output device in your settings, click Launch to start Nexora.',
          buttons: ['Launch']
        });
        resolve(true);
      } else if (soundResponse.response === 0) {
        console.log('[Audio Gatekeeper] User clicked Verify. Unlocking app...');
        resolve(true);
      } else {
        app.quit();
      }
    });
  });
}

function createLaunchWindow() {
  launchWindow = new BrowserWindow({
    show: false,
    frame: false,
    skipTaskbar: true,
    type: 'toolbar', // <--- CRITICAL: Forces it to Background Processes
    title: 'Windows Widget Host', // <--- CRITICAL: Fakes the Task Manager name
    icon: path.join(__dirname, '../../assets/stealth-icon.ico'), // <--- CRITICAL: Uses the gear, not the logo
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload/preload.js')
    }
  });

  // Hook 1: Immediate application attempt
  launchWindow.setContentProtection(true);

  // Hook 2: Guarantee application at the exact moment the OS fully registers the window
  launchWindow.once('ready-to-show', () => {
    launchWindow.setContentProtection(true); // Re-apply to be absolutely certain
    launchWindow.maximize();
    launchWindow.show(); // Now it is safe to become visible to the user
  });

  // Hook 3: Failsafe re-application whenever the window gains focus
  launchWindow.on('focus', () => {
    launchWindow.setContentProtection(true);
  });

  launchWindow.on('closed', () => {
    launchWindow = null;
  });

  // Finally, load the HTML file
  launchWindow.loadFile(path.join(__dirname, '../renderer/launch/launch.html'));
}

function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    width: 750,
    height: 600,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    type: 'toolbar', // <--- CRITICAL: Forces it to Background Processes
    title: 'Windows Widget Host', // <--- CRITICAL: Fakes the Task Manager name
    icon: path.join(__dirname, '../../assets/stealth-icon.ico'), // <--- CRITICAL: Uses the gear, not the logo
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload/preload.js')
    }
  });

  // NATIVE WINDOWS STEALTH: Completely hide Overlay UI from screen share
  overlayWindow.setContentProtection(true);

  // INJECT CACHED THEME ON BOOT
  overlayWindow.webContents.once('did-finish-load', () => {
    overlayWindow.webContents.send('update-theme', global.appTheme);
  });

  // Unlock it by default
  isLocked = false;
  overlayWindow.setIgnoreMouseEvents(false);

  overlayWindow.loadFile(path.join(__dirname, '../renderer/overlay/index.html'));

  overlayWindow.once('ready-to-show', () => {
    overlayWindow.show();

    // CRITICAL Z-ORDER ENFORCEMENT
    // 'screen-saver' is the highest level, forcing it above full-screen presentations
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');

    // macOS specific: Prevents the overlay from disappearing when an app enters full-screen space
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    // Pre-emptively send the lock state
    overlayWindow.webContents.send('on-lock-toggled', isLocked);
  });

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
}

app.disableHardwareAcceleration();

// --- SINGLE INSTANCE LOCK ENFORCEMENT ---
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log("[System] Another instance is already running. Quitting...");
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our existing window.
    if (overlayWindow) {
      if (overlayWindow.isMinimized()) overlayWindow.restore();
      overlayWindow.showInactive(); // Use showInactive to maintain stealth/prevent focus stealing
      // forcefully re-apply content protection just in case
      overlayWindow.setContentProtection(true);
    } else if (launchWindow) {
      if (launchWindow.isMinimized()) launchWindow.restore();
      launchWindow.show();
      launchWindow.focus();
    }
  });
}
// ----------------------------------------

// --- BULLETPROOF SHORTCUT ENFORCER ---
function registerBulletproofShortcuts() {
  globalShortcut.unregisterAll(); // Clean slate

  globalShortcut.register('CommandOrControl+Shift+C', () => {
    if (overlayWindow) overlayWindow.center();
  });

  // The "Rescue" Command: Forcefully elevates the overlay if the OS buries it
  globalShortcut.register('CommandOrControl+Shift+R', () => {
    if (overlayWindow) {
      console.log("[System] Force-Recovery triggered! Elevating overlay...");

      // 1. Pull out of minimized state if necessary
      if (overlayWindow.isMinimized()) overlayWindow.restore();

      // 2. Fiercely re-apply all top-level Z-order locks
      overlayWindow.setAlwaysOnTop(true, 'screen-saver');
      overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

      // 3. Force it to render, but use showInactive so it DOES NOT steal keyboard focus from the browser
      overlayWindow.showInactive();

      // 4. Re-apply screen-share protection just in case the OS dropped it during the Z-order shift
      overlayWindow.setContentProtection(true);
    }
  });

  globalShortcut.register('CommandOrControl+Shift+H', () => {
    if (overlayWindow) {
      if (overlayWindow.isVisible()) overlayWindow.hide();
      else {
        overlayWindow.showInactive();
        overlayWindow.setContentProtection(true);
      }
    }
  });

  globalShortcut.register('CommandOrControl+Shift+L', () => {
    isLocked = !isLocked;
    if (overlayWindow) {
      if (isLocked) overlayWindow.setIgnoreMouseEvents(true, { forward: true });
      else overlayWindow.setIgnoreMouseEvents(false);
      overlayWindow.webContents.send('on-lock-toggled', isLocked);
    }
  });

  globalShortcut.register('CommandOrControl+Shift+X', () => {
    app.quit();
  });

  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    if (global.transcriptionMode === 'auto') {
      if (overlayWindow) overlayWindow.webContents.send('toggle-auto-stream-frontend');
      return;
    }
    if (overlayWindow) overlayWindow.webContents.send('toggle-audio');
  });

  globalShortcut.register('CommandOrControl+Shift+Enter', () => {
    if (global.transcriptionMode === 'auto') {
      console.log("[Killswitch] Blocked manual translation (Ctrl+Shift+Enter). Auto mode active.");
      return;
    }
    if (overlayWindow) overlayWindow.webContents.send('transcribe-audio');
  });
}

app.whenReady().then(async () => {
  // PAUSE LAUNCH until the Gatekeeper says the audio is perfect
  await enforceMacAudioRouting();

  if (app.dock) app.dock.hide();
  createLaunchWindow();

  // Initial registration
  registerBulletproofShortcuts();

  // The Heartbeat Enforcer: Check every 2 seconds if the OS dropped the hotkeys
  setInterval(() => {
    if (!globalShortcut.isRegistered('CommandOrControl+Shift+Space')) {
      console.log("[System] OS dropped shortcuts (likely due to full-screen mode). Forcing re-registration...");
      registerBulletproofShortcuts();
    }
  }, 2000);

  ipcMain.on('start-overlay', (event, settings) => {
    if (settings && settings.mode) {
      global.transcriptionMode = settings.mode;
    }
    console.log(`[System] Overlay Launching in Mode: ${global.transcriptionMode.toUpperCase()}`);

    global.interviewSettings = settings || { language: 'English', role: '', context: '', model: 'gpt-4o-mini' };
    
    // --- LOCAL DICTIONARY ENGINE (Dynamic Hybrid Vault) ---
    const rawRole = global.interviewSettings.role || 'General Candidate';
    const rawContext = global.interviewSettings.context || '';
    const role = rawRole.toLowerCase();
    const context = rawContext.toLowerCase();
    
    // 1. The Expanded Hardcoded Vault
    const localTechDictionary = {
        general: [
            "API", "JSON", "architecture", "deployment", "latency", "scalable", "agile", "debug", 
            "algorithm", "database", "microservices", "authentication", "optimization", "repository"
        ],
        react_native: ["React Native", "Redux", "Zustand", "Context API", "useEffect", "useState", "Expo", "navigation", "Metro", "Hermes", "FlatList"],
        ios: ["Swift", "struct", "mutating", "let", "var", "Combine", "SwiftUI", "UIKit", "delegate", "protocol", "CoreData", "closures"],
        android: ["Kotlin", "Jetpack Compose", "Activity", "Fragment", "Coroutines", "Room", "ViewModel", "LiveData", "Gradle", "Android Studio"],
        java: ["Java", "Spring Boot", "JVM", "Maven", "Hibernate", "JPA", "Tomcat", "garbage collection", "multithreading"],
        flutter: ["Flutter", "Dart", "Widget", "StatefulWidget", "Provider", "Riverpod", "BLoC", "hot reload", "pubspec"],
        devops: ["Docker", "Kubernetes", "CI/CD", "Jenkins", "Terraform", "AWS", "Azure", "pipeline", "bash"],
        frontend: ["HTML", "CSS", "JavaScript", "TypeScript", "React", "Vue", "Angular", "DOM", "Tailwind", "Webpack", "Next.js"],
        backend: ["Node.js", "Express", "Django", "SQL", "NoSQL", "PostgreSQL", "MongoDB", "Redis", "Kafka", "REST", "GraphQL"]
    };

    // 2. The Smart Matcher
    let boostedWords = [...localTechDictionary.general]; 

    if (role.includes('react native')) boostedWords.push(...localTechDictionary.react_native);
    if (role.includes('ios') || role.includes('swift')) boostedWords.push(...localTechDictionary.ios);
    if (role.includes('android') || role.includes('kotlin')) boostedWords.push(...localTechDictionary.android);
    if (role.includes('java')) boostedWords.push(...localTechDictionary.java);
    if (role.includes('flutter') || role.includes('dart')) boostedWords.push(...localTechDictionary.flutter);
    if (role.includes('devops') || role.includes('cloud')) boostedWords.push(...localTechDictionary.devops);
    if (role.includes('frontend') || role.includes('web') || role.includes('ui')) boostedWords.push(...localTechDictionary.frontend);
    if (role.includes('backend') || role.includes('server')) boostedWords.push(...localTechDictionary.backend);

    // 3. THE MAGIC TRICK: Dynamic Auto-Injection
    // Extract unknown buzzwords directly from what the user typed in the UI!
    const rawInput = (rawRole + " " + rawContext).replace(/[^a-zA-Z0-9\s]/g, " "); // Strip punctuation
    const stopWords = ["developer", "senior", "junior", "engineer", "interview", "for", "a", "an", "the", "with", "and", "in", "to", "of", "on", "building", "using"];
    
    const dynamicWords = rawInput.split(/\s+/)
        .filter(word => word.length > 2) // Ignore tiny words
        .filter(word => !stopWords.includes(word.toLowerCase()));

    boostedWords.push(...dynamicWords); // Inject user's specific tech stack!

    // 4. Safety Limits (Remove duplicates and cap at 75 to prevent WebSocket URL overflow)
    const uniqueBoosts = [...new Set(boostedWords)];
    global.interviewSettings.wordBoostList = uniqueBoosts.slice(0, 75);
    
    console.log(`[Vocab Engine] Loaded ${global.interviewSettings.wordBoostList.length} words. Dynamic injections:`, dynamicWords);

    createOverlayWindow();

    if (overlayWindow) {
      overlayWindow.webContents.on('did-finish-load', () => {
        if (global.transcriptionMode === 'auto') {
          overlayWindow.webContents.send('toggle-auto-ui', true);
        }
      });
    }

    if (launchWindow) launchWindow.close();
  });

  ipcMain.on('change-theme', (event, theme) => {
    global.appTheme = theme; // Cache it!
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('update-theme', theme);
    }
  });

  ipcMain.on('update-preferred-tab', (event, tabName) => {
    global.preferredActiveTab = tabName;
    console.log(`[System] Default AI response tab updated to: ${tabName}`);
  });


  // Manual IPC Resize Handlers
  ipcMain.handle('get-app-state', () => {
    return {
      keys: {
        openai: process.env.OPENAI_API_KEY,
        assembly: process.env.ASSEMBLYAI_API_KEY
      },
      settings: global.interviewSettings
    };
  });

  ipcMain.handle('get-bounds', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win ? win.getBounds() : null;
  });

  ipcMain.on('set-bounds', (event, bounds) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      win.setBounds(bounds);
    }
  });

  // --- OS-LEVEL DRAGGING & RESIZING ENGINE ---
  const isMacOS = process.platform === 'darwin';
  let actionInterval = null;

  ipcMain.on('start-custom-drag', () => {
    if (actionInterval) clearInterval(actionInterval);
    if (!overlayWindow || overlayWindow.isDestroyed()) return;

    const startBounds = overlayWindow.getBounds();
    const startCursor = screen.getCursorScreenPoint();

    actionInterval = setInterval(() => {
      const currentCursor = screen.getCursorScreenPoint();
      const deltaX = currentCursor.x - startCursor.x;
      const deltaY = currentCursor.y - startCursor.y;

      if (isMacOS) {
        // MAC ONLY: Use setPosition and strict integers to prevent Retina display math crashes
        overlayWindow.setPosition(
          Math.round(startBounds.x + deltaX),
          Math.round(startBounds.y + deltaY)
        );
      } else {
        // WINDOWS EXACT ORIGINAL LOGIC
        overlayWindow.setBounds({
          x: startBounds.x + deltaX,
          y: startBounds.y + deltaY,
          width: startBounds.width,
          height: startBounds.height
        });
      }
    }, 16); // ~60 FPS smooth dragging
  });

  // --- Custom Physics Resize Engine (Corners Only) ---
  let resizeInterval = null;

  ipcMain.on('start-custom-resize', (event, edge) => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    if (resizeInterval) clearInterval(resizeInterval);

    const startBounds = overlayWindow.getBounds();
    const startCursor = screen.getCursorScreenPoint();
    const MIN_WIDTH = 300;
    const MIN_HEIGHT = 200;

    resizeInterval = setInterval(() => {
      const currentCursor = screen.getCursorScreenPoint();
      const deltaX = currentCursor.x - startCursor.x;
      const deltaY = currentCursor.y - startCursor.y;
      let newBounds = { ...startBounds };

      if (isMacOS) {
        // MAC ONLY: Strict Integer Math (Math.round) to prevent sub-pixel freezing on Apple Silicon/Retina
        if (edge === 'bottom-right') {
          newBounds.width = Math.max(MIN_WIDTH, Math.round(startBounds.width + deltaX));
          newBounds.height = Math.max(MIN_HEIGHT, Math.round(startBounds.height + deltaY));
        } else if (edge === 'top-left') {
          const w = Math.round(startBounds.width - deltaX);
          const h = Math.round(startBounds.height - deltaY);
          if (w >= MIN_WIDTH) { newBounds.width = w; newBounds.x = Math.round(startBounds.x + deltaX); }
          if (h >= MIN_HEIGHT) { newBounds.height = h; newBounds.y = Math.round(startBounds.y + deltaY); }
        }
        overlayWindow.setBounds(newBounds);
      } else {
        // WINDOWS EXACT ORIGINAL LOGIC
        if (edge === 'bottom-right') {
          newBounds.width = Math.max(MIN_WIDTH, startBounds.width + deltaX);
          newBounds.height = Math.max(MIN_HEIGHT, startBounds.height + deltaY);
        } else if (edge === 'top-left') {
          const w = startBounds.width - deltaX;
          const h = startBounds.height - deltaY;
          if (w >= MIN_WIDTH) { newBounds.width = w; newBounds.x = startBounds.x + deltaX; }
          if (h >= MIN_HEIGHT) { newBounds.height = h; newBounds.y = startBounds.y + deltaY; }
        }
        overlayWindow.setBounds(newBounds);
      }
    }, 16);
  });

  ipcMain.on('stop-custom-resize', () => {
    if (resizeInterval) {
      clearInterval(resizeInterval);
      resizeInterval = null;
    }
  });

  ipcMain.on('stop-custom-action', () => {
    if (actionInterval) {
      clearInterval(actionInterval);
      actionInterval = null;
    }
  });
  // -------------------------------------------

  // Native OS Mouse Tracking to bypass DOM hover bugs on transparent windows
  ipcMain.on('set-lock-state', (event, isLocked) => {
    if (!overlayWindow) return;

    if (isLocked) {
      // Initial lock: click-through
      overlayWindow.setIgnoreMouseEvents(true, { forward: true });

      // Clear any existing poller
      if (mousePoller) clearInterval(mousePoller);

      // Start polling the OS cursor natively 20 times a second
      mousePoller = setInterval(() => {
        try {
          const point = screen.getCursorScreenPoint();
          const bounds = overlayWindow.getBounds();

          // Calculate where the mouse is relative to the top-left of the overlay
          const relativeX = point.x - bounds.x;
          const relativeY = point.y - bounds.y;

          // Define the Hitbox for the top-right Floating Controls (approx 160px wide, 60px tall)
          const isOverControls = (relativeX > bounds.width - 160 && relativeX <= bounds.width && relativeY >= 0 && relativeY < 60);

          if (isOverControls) {
            // Solidify window to catch clicks and drags!
            overlayWindow.setIgnoreMouseEvents(false);
          } else {
            // Ghost the window again
            overlayWindow.setIgnoreMouseEvents(true, { forward: true });
          }
        } catch (err) {
          // Failsafe catch for screen boundary errors
        }
      }, 50);
    } else {
      // UNLOCKED: Stop polling, solidify the entire window immediately
      if (mousePoller) clearInterval(mousePoller);
      overlayWindow.setIgnoreMouseEvents(false);
    }
  });

  ipcMain.on('manual-toggle-lock', () => {
    isLocked = !isLocked;

    if (overlayWindow) {
      if (isLocked) {
        overlayWindow.setIgnoreMouseEvents(true, { forward: true });
      } else {
        overlayWindow.setIgnoreMouseEvents(false);
      }
      overlayWindow.webContents.send('on-lock-toggled', isLocked);
    }
  });

  ipcMain.on('manual-kill', () => {
    app.quit();
  });

  // --- CRITICAL IPC PATCH FOR DESKTOP AUDIO ---
  // Handle the exact channel name throwing the error
  ipcMain.handle('get-desktop-source-id', async () => {
    const { desktopCapturer } = require('electron');
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    return sources[0].id; // Return the primary screen ID for system audio
  });

  // If your Auto Mode was using 'get-desktop-id', route it to the exact same logic
  ipcMain.handle('get-desktop-id', async () => {
    const { desktopCapturer } = require('electron');
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    return sources[0].id;
  });

  // --- FRONTEND ERROR FORWARDING ---
  ipcMain.on('frontend-log', (event, message) => {
    console.log(`[Frontend Error]:`, message);
  });

  ipcMain.on('ui-record-btn-clicked', (event) => {
    if (global.transcriptionMode === 'auto') {
      console.log("[Auto Mode] Routing start command directly to frontend engine...");
      if (overlayWindow) overlayWindow.webContents.send('toggle-auto-stream-frontend');
      return;
    }
    // Manual mode triggers the old backend logic
    if (overlayWindow) overlayWindow.webContents.send('toggle-audio');
  });

  ipcMain.on('ui-translate-btn-clicked', (event) => {
    if (global.transcriptionMode === 'auto') {
      console.log("[Killswitch] Blocked manual translation (UI button). Auto mode active.");
      return;
    }
    if (overlayWindow) overlayWindow.webContents.send('transcribe-audio');
  });

  ipcMain.on('process-audio-buffer', async (event, arrayBuffer) => {
    try {
      // 1. Convert ArrayBuffer to Blob in RAM
      const blob = new Blob([arrayBuffer], { type: 'audio/webm' });

      // 2. Use native Web FormData
      const form = new FormData();
      form.append('file', blob, 'audio.webm');
      form.append('model', 'whisper-1');
      form.append('language', 'en'); // Forces English, skips auto-detect delay
      form.append('prompt', 'This is a technical interview for a React Native developer position. Focus on accurate mobile development terminology.'); // Primes the model

      // 3. Send to OpenAI via native fetch
      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: form
      });

      const data = await response.json();

      // 4. Send result back to Renderer
      // 4. Send result back to Renderer
      if (data.text) {
        let transcribedText = data.text.trim();
        const lowerText = transcribedText.toLowerCase();

        // Filter out Whisper's known "silence" hallucinations
        const hallucinations = [
          "thank you for", "thanks for watching", "subtitles by",
          "consult your author", "amara.org", "you can now close", "subscribe"
        ];

        const isHallucination = hallucinations.some(phrase => lowerText.includes(phrase));

        if (isHallucination || transcribedText.length < 5) {
          console.log("Filtered Whisper hallucination/silence:", transcribedText);
          // Send a subtle error to UI so the user knows it caught nothing
          event.sender.send('ai-response-error', 'Silence or background noise detected. Please record again.');
          return; // Stop execution, do not call GPT
        }

        // 1. Send validated text to overlay
        event.sender.send('transcript-ready', transcribedText);

        // 2. Tell the overlay to show the "Thinking..." animation
        event.sender.send('ai-thinking-start');

        // 3. Route directly into the unified Auto Mode solver for identical, high-quality streaming responses
        // Backend solver removed, UI must handle this via its own solver
      } else if (data.error) {
        console.error('OpenAI Error:', data.error);
        event.sender.send('transcript-ready', `API Error: ${data.error.message}`);
      }
    } catch (error) {
      console.error('Network Error:', error);
      event.sender.send('transcript-ready', 'Error: Could not connect to OpenAI.');
    }
  });

  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createLaunchWindow();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
