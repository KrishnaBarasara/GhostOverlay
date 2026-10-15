const electronInstaller = require('electron-winstaller');
const path = require('path');

async function buildInstaller() {
    try {
        console.log('Creating Windows Installer...');

        await electronInstaller.createWindowsInstaller({
            appDirectory: path.join(__dirname, 'dist/ghost-overlay-win32-x64'),
            outputDirectory: path.join(__dirname, 'dist/installer'),
            authors: 'Ghost Developer',
            exe: 'ghost-overlay.exe',
            setupExe: 'GhostOverlay_Setup.exe',
            setupIcon: undefined, // Optional: add path to .ico file if you have one
            noMsi: true
        });

        console.log('It worked! Installer is ready at dist/installer/GhostOverlay_Setup.exe');
    } catch (e) {
        console.log(`No dice: ${e.message}`);
    }
}

buildInstaller();
