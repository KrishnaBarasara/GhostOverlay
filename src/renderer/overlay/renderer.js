const overlayContainer = document.getElementById('overlay-container');
const statusText = document.getElementById('status-text');

// --- Custom Manual Resizing Logic (Dual-OS Architecture) ---
const isMac = navigator.userAgent.includes('Mac OS X');

if (!isMac) {
    // ==========================================
    // WINDOWS: EXACT ORIGINAL CODE (100% UNTOUCHED)
    // ==========================================
    const resizeHandles = document.querySelectorAll('.resize-handle');

    resizeHandles.forEach(handle => {
        handle.addEventListener('pointerdown', (e) => {
            if (document.getElementById('overlay-container').classList.contains('locked')) return;
            e.target.setPointerCapture(e.pointerId);
            window.api.startCustomResize(handle.getAttribute('data-edge'));
        });

        handle.addEventListener('pointerup', (e) => {
            e.target.releasePointerCapture(e.pointerId);
            window.api.stopCustomResize();
        });
    });

    const dragHandle = document.getElementById('floating-drag-handle');
    if (dragHandle) {
        dragHandle.addEventListener('pointerdown', (e) => {
            e.target.setPointerCapture(e.pointerId);
            window.api.startCustomDrag();
        });
        dragHandle.addEventListener('pointerup', (e) => {
            e.target.releasePointerCapture(e.pointerId);
            window.api.stopCustomAction();
        });
    }
} else {
    // ==========================================
    // MAC: BROWSER-DRIVEN MATH (Bypasses OS Jumping Bug)
    // ==========================================
    let macDragState = null;
    let macResizeState = null;

    // MAC DRAGGING
    const dragHandle = document.getElementById('floating-drag-handle');
    if (dragHandle) {
        dragHandle.addEventListener('pointerdown', async (e) => {
            e.target.setPointerCapture(e.pointerId); // Lock mouse to element instantly
            const bounds = await window.api.getBounds();
            macDragState = { startX: e.screenX, startY: e.screenY, startBounds: bounds };
        });
        
        dragHandle.addEventListener('pointermove', (e) => {
            if (!macDragState) return;
            const deltaX = e.screenX - macDragState.startX;
            const deltaY = e.screenY - macDragState.startY;
            window.api.setBounds({
                x: Math.round(macDragState.startBounds.x + deltaX),
                y: Math.round(macDragState.startBounds.y + deltaY),
                width: macDragState.startBounds.width,
                height: macDragState.startBounds.height
            });
        });

        dragHandle.addEventListener('pointerup', (e) => {
            macDragState = null;
            e.target.releasePointerCapture(e.pointerId);
        });
    }

    // MAC RESIZING
    const resizeHandles = document.querySelectorAll('.resize-handle');
    resizeHandles.forEach(handle => {
        handle.addEventListener('pointerdown', async (e) => {
            if (document.getElementById('overlay-container').classList.contains('locked')) return;
            e.target.setPointerCapture(e.pointerId); // Lock mouse to corner instantly
            const bounds = await window.api.getBounds();
            macResizeState = { 
                edge: handle.getAttribute('data-edge'), 
                startX: e.screenX, 
                startY: e.screenY, 
                startBounds: bounds 
            };
        });

        handle.addEventListener('pointermove', (e) => {
            if (!macResizeState) return;
            const deltaX = e.screenX - macResizeState.startX;
            const deltaY = e.screenY - macResizeState.startY;
            let newBounds = { ...macResizeState.startBounds };
            const MIN_WIDTH = 300;
            const MIN_HEIGHT = 200;

            if (macResizeState.edge === 'bottom-right') {
                newBounds.width = Math.max(MIN_WIDTH, Math.round(macResizeState.startBounds.width + deltaX));
                newBounds.height = Math.max(MIN_HEIGHT, Math.round(macResizeState.startBounds.height + deltaY));
            } else if (macResizeState.edge === 'top-left') {
                const w = Math.round(macResizeState.startBounds.width - deltaX);
                const h = Math.round(macResizeState.startBounds.height - deltaY);
                if (w >= MIN_WIDTH) { newBounds.width = w; newBounds.x = Math.round(macResizeState.startBounds.x + deltaX); }
                if (h >= MIN_HEIGHT) { newBounds.height = h; newBounds.y = Math.round(macResizeState.startBounds.y + deltaY); }
            }
            window.api.setBounds(newBounds);
        });

        handle.addEventListener('pointerup', (e) => {
            macResizeState = null;
            e.target.releasePointerCapture(e.pointerId);
        });
    });
}
// ---------------------------------------
// 3. Keep lock/unlock toggler working for the Overlay UI
window.api.onLockToggled((isLocked) => {
    if (isLocked) {
        // Locked Mode
        overlayContainer.classList.remove('unlocked');
        overlayContainer.classList.add('locked');
        statusText.innerText = 'LOCKED';
    } else {
        overlayContainer.classList.remove('locked');
        overlayContainer.classList.add('unlocked');
        statusText.innerText = 'UNLOCKED';
    }
});

if (window.api.onUpdateTheme) {
    window.api.onUpdateTheme((theme) => {
        if (theme === 'Light') {
            document.body.classList.add('light-theme');
        } else {
            document.body.classList.remove('light-theme');
        }
    });
}

let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];
let finalAudioBuffer = null;
let shouldTranscribeOnStop = false;

// 1. Receive the Interviewer's Question
window.api.onTranscriptReady((text) => {
    if (!text) return;
    const container = document.getElementById('transcript-container');
    const qDiv = document.createElement('div');
    qDiv.className = 'message-row message-question';
    qDiv.innerHTML = '<div class="avatar user">Q</div><div class="msg-content">' + text + '</div>';
    container.appendChild(qDiv);

    // SMART ANCHOR: Scroll the view securely by manipulating scrollTop
    setTimeout(() => {
        // Calculate the exact offset so the question rests just below the top edge of the visible scroll area
        const containerRect = container.getBoundingClientRect();
        const msgRect = qDiv.getBoundingClientRect();
        container.scrollTop += (msgRect.top - containerRect.top);
    }, 50);
});

// --- HIGHLIGHT EXISTING QUESTION ---
if (window.api.onHighlightQuestion) {
    window.api.onHighlightQuestion(() => {
        const container = document.getElementById('transcript-container');
        const questions = container.querySelectorAll('.message-question');
        if (questions.length === 0) return;

        const lastQ = questions[questions.length - 1];

        // 1. Smart Anchor: Scroll the exact same way we do for new questions
        const containerRect = container.getBoundingClientRect();
        const msgRect = lastQ.getBoundingClientRect();
        container.scrollTop += (msgRect.top - containerRect.top);

        // 2. Visual Feedback: Subtly pulse the existing question so the user notices it
        lastQ.classList.remove('highlight-pulse'); // reset if already pulsing
        void lastQ.offsetWidth; // trigger reflow
        lastQ.classList.add('highlight-pulse');
    });
}

// --- UNIFIED DUAL-TAB AI RESPONSE UI ---
let currentResponseNodes = {};
let frontendPreferredTab = 'bullet'; // Defaults to bullet

// 1. Build the Dual-Tab "Thinking" State
window.api.onAiThinkingStart(() => {
    const container = document.getElementById('transcript-container');
    const aDiv = document.createElement('div');
    aDiv.className = 'message-row message-answer thinking-pulse';

    aDiv.innerHTML = `
        <div class="avatar ai">AI</div>
        <div class="msg-content" style="width: 100%;">
            <div class="tabs-container">
                <div class="tab-btn ${frontendPreferredTab === 'bullet' ? 'active' : ''}" data-tab="bullet">Bullet</div>
                <div class="tab-btn ${frontendPreferredTab === 'detailed' ? 'active' : ''}" data-tab="detailed">Detailed</div>
            </div>
            <div class="tab-content bullet-content ${frontendPreferredTab === 'bullet' ? 'active' : ''}">Analyzing...</div>
            <div class="tab-content detailed-content ${frontendPreferredTab === 'detailed' ? 'active' : ''}">Analyzing...</div>
        </div>
    `;

    currentResponseNodes = {
        main: aDiv,
        bullet: aDiv.querySelector('.bullet-content'),
        detailed: aDiv.querySelector('.detailed-content')
    };

    // Tab click logic (Scoped ONLY to this specific question)
    aDiv.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const selectedTab = e.target.getAttribute('data-tab');

            aDiv.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            aDiv.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            e.target.classList.add('active');
            aDiv.querySelector('.' + selectedTab + '-content').classList.add('active');

            frontendPreferredTab = selectedTab;
            if (window.api.updatePreferredTab) window.api.updatePreferredTab(selectedTab);
        });
    });

    container.appendChild(aDiv);
    scrollToBottom();
});

// 2. Clear "Analyzing..." and prepare for incoming stream
if (window.api.onAiStreamStart) {
    window.api.onAiStreamStart((tabType) => {
        if (currentResponseNodes.main) {
            currentResponseNodes.main.classList.remove('thinking-pulse');
            if (currentResponseNodes[tabType]) {
                currentResponseNodes[tabType].innerHTML = '';
            }
        }
    });
}

// 3. Route tokens into the correct tab
if (window.api.onAiTokenStream) {
    window.api.onAiTokenStream((data) => {
        const { token, tabType } = data;
        if (currentResponseNodes[tabType]) {
            const formattedToken = token.replace(/\n/g, '<br>');
            currentResponseNodes[tabType].innerHTML += formattedToken;
            scrollToBottom();
        }
    });
}

// 4. Handle End of Stream
if (window.api.onAiStreamEnd) {
    window.api.onAiStreamEnd((tabType) => {
        scrollToBottom();
    });
}

// 5. Handle Network/API Errors safely within the dual-tab structure
if (window.api.onAiResponseError) {
    window.api.onAiResponseError((data) => {
        const errorText = data.error || data;
        const tabType = data.tabType || frontendPreferredTab;

        if (currentResponseNodes.main) {
            currentResponseNodes.main.classList.remove('thinking-pulse');
            if (currentResponseNodes[tabType]) {
                currentResponseNodes[tabType].innerHTML = '<span style="color:#ff6b6b; font-weight:bold;">' + errorText + '</span>';
            }
        }
    });
}
// ---------------------------------------

// Handle Ctrl+Shift+Space or UI Record Button (routed from main.js)
window.api.onToggleAudio(() => {
    const btn = document.getElementById('btn-record');
    const btnText = btn.querySelector('.btn-text');
    if (isRecording) {
        // Stop and queue
        shouldTranscribeOnStop = false;
        mediaRecorder.stop();
        btn.classList.remove('recording');
        if (btnText) btnText.innerText = 'Start Recording';
    } else {
        // Start fresh
        startDesktopRecording();
        btn.classList.add('recording');
        if (btnText) btnText.innerText = 'Stop Recording';
    }
});

// Handle Ctrl+Shift+Enter or UI Translate Button (routed from main.js)
window.api.onTranscribeAudio(() => {
    if (isRecording) {
        // Stop instantly AND translate
        shouldTranscribeOnStop = true;
        mediaRecorder.stop();
        document.getElementById('btn-record').classList.remove('recording');
    } else if (finalAudioBuffer) {
        // Translate already queued audio
        sendBufferAndClear(finalAudioBuffer);
    }
});

async function startDesktopRecording() {
    isRecording = true;
    audioChunks = []; // CRITICAL: Clears old audio
    finalAudioBuffer = null;
    document.getElementById('listening-status').style.display = 'inline';
    document.getElementById('saved-status').style.display = 'none';

    try {
        const sourceId = await window.api.getDesktopSourceId();

        // Detect OS from the browser/renderer context
        const isMac = navigator.userAgent.includes('Mac OS X');
        let streamConstraints;

        if (isMac) {
            console.log('[Audio Hijacker] macOS detected. Hunting for BlackHole 2ch...');
            const devices = await navigator.mediaDevices.enumerateDevices();
            const blackholeDevice = devices.find(d => d.label.includes('BlackHole'));

            if (blackholeDevice) {
                console.log('[Audio Hijacker] Locked onto BlackHole target:', blackholeDevice.deviceId);
                // CLEAN MAC CONSTRAINTS (No desktopCapturer flags)
                streamConstraints = {
                    audio: {
                        deviceId: { exact: blackholeDevice.deviceId },
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl: false
                    },
                    video: false
                };
            } else {
                console.warn('[Audio Hijacker] BlackHole missing in device list! Falling back to default.');
                streamConstraints = { audio: true, video: false };
            }
        } else {
            console.log('[Audio Hijacker] Windows detected. Using native desktop audio routing.');
            streamConstraints = {
                audio: { mandatory: { chromeMediaSource: 'desktop' } },
                video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId } }
            };
        }

        const stream = await navigator.mediaDevices.getUserMedia(streamConstraints);

        const audioTrack = stream.getAudioTracks()[0];
        const audioOnlyStream = new MediaStream([audioTrack]);
        stream.getVideoTracks().forEach(track => track.stop());

        mediaRecorder = new MediaRecorder(audioOnlyStream, { mimeType: 'audio/webm' });

        mediaRecorder.ondataavailable = e => {
            if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.onstop = async () => {
            isRecording = false;
            document.getElementById('listening-status').style.display = 'none';

            const blob = new Blob(audioChunks, { type: 'audio/webm' });
            finalAudioBuffer = await blob.arrayBuffer();
            audioTrack.stop(); // Release the system audio hook

            if (shouldTranscribeOnStop) {
                // Triggered by Shift+Enter
                sendBufferAndClear(finalAudioBuffer);
                shouldTranscribeOnStop = false;
            } else {
                // Triggered by Shift+Space
                document.getElementById('saved-status').style.display = 'inline';
            }
        };

        mediaRecorder.start();
    } catch (err) {
        console.error('Failed to capture audio:', err);
        document.getElementById('listening-status').innerText = 'ERROR';
    }
}

function sendBufferAndClear(buffer) {
    document.getElementById('saved-status').style.display = 'none';
    window.api.sendAudioBuffer(buffer);
    finalAudioBuffer = null; // Prevent double-sending
}



// Smart Hover: Allow scrolling while locked
const transcriptContainer = document.getElementById('transcript-container');
transcriptContainer.addEventListener('mouseenter', () => {
    if (document.getElementById('overlay-container').classList.contains('locked')) {
        window.api.setHoverState(true);
    }
});
transcriptContainer.addEventListener('mouseleave', () => {
    if (document.getElementById('overlay-container').classList.contains('locked')) {
        window.api.setHoverState(false);
    }
});

// Smart Hover Expansion: Header Zone
const headerZone = document.getElementById('header-zone');
headerZone.addEventListener('mouseenter', () => {
    if (document.getElementById('overlay-container').classList.contains('locked')) {
        window.api.setHoverState(true);
    }
});
headerZone.addEventListener('mouseleave', () => {
    if (document.getElementById('overlay-container').classList.contains('locked')) {
        window.api.setHoverState(false);
    }
});

// --- Action Bar Button Wiring ---
// --- Master Lock & Move Logic ---
const floatingControls = document.querySelector('.floating-controls');
const floatingLockBtn = document.getElementById('floating-lock-btn');
const lockIconSlot = floatingLockBtn.querySelector('.icon-slot');
const lockTextSlot = floatingLockBtn.querySelector('.text-slot');

const svgUnlocked = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>`;
const svgLocked = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;

// 2. Centralized UI Sync Function
function updateLockUI() {
    const overlay = document.getElementById('overlay-container');
    const isCurrentlyLocked = overlay.classList.contains('locked');

    // TELL MAIN.JS TO START NATIVE OS TRACKING
    if (window.api.setLockState) {
        window.api.setLockState(isCurrentlyLocked);
    }

    if (isCurrentlyLocked) {
        floatingLockBtn.classList.add('locked-state');
        lockIconSlot.innerHTML = svgLocked;
        lockTextSlot.innerText = 'Locked';
        document.getElementById('status-text').innerText = 'LOCKED';
    } else {
        floatingLockBtn.classList.remove('locked-state');
        lockIconSlot.innerHTML = svgUnlocked;
        lockTextSlot.innerText = 'Unlocked';
        document.getElementById('status-text').innerText = 'UNLOCKED';
    }
}

// 3. Handle Button Clicks
floatingLockBtn.addEventListener('click', () => {
    const overlay = document.getElementById('overlay-container');
    overlay.classList.toggle('locked'); // Toggle state instantly

    if (window.api.manualToggleLock) window.api.manualToggleLock(); // Notify Main

    updateLockUI(); // Sync the visuals

    if (overlay.classList.contains('locked')) {
        window.api.setHoverState(false); // Drop hover safety
    }
});

// 4. Handle Keyboard Shortcuts (assuming you receive an IPC from Main for shortcuts)
// Note: Ensure your preload.js exposes a listener like 'onToggleLock' for the shortcut
if (window.api.onLockToggled) {
    window.api.onLockToggled((isLocked) => {
        const overlay = document.getElementById('overlay-container');
        if (isLocked) {
            overlay.classList.add('locked');
        } else {
            overlay.classList.remove('locked');
        }
        updateLockUI(); // Sync the visuals
    });
}

// Emergency Kill
document.getElementById('btn-kill').addEventListener('click', () => {
    window.api.manualKill();
});



// Start/Stop Record Toggle
document.getElementById('btn-record').addEventListener('click', () => {
    if (window.api && window.api.uiRecordBtnClicked) {
        window.api.uiRecordBtnClicked();
    }
});

// Translate Audio Stop/Queue Translation
document.getElementById('btn-translate').addEventListener('click', () => {
    if (window.api && window.api.uiTranslateBtnClicked) {
        window.api.uiTranslateBtnClicked();
    }
});

// --- AUTO MODE: AUTONOMOUS FRONTEND ENGINE ---
let appState = { keys: {}, settings: {} };
let autoAudioContext, autoMediaStream, autoScriptProcessor;
let aaiWs = null;
let isAutoCapturing = false;

// Memory & State
let autoTranscriptBuffer = "";
let conversationHistory = [];
// --- TIMING & LEDGER STATE ---
let uiLedger = []; 
const MAX_LEDGER_SIZE = 3;
let lastExtractionTime = 0; // Stopwatch start
let candidateAnswerGap = 0; // Locked stopwatch result
let currentSlideId = 1;
let isEvaluating = false;
let isSolving = false;
let activeSolverController = null;

// --- NEW TIME-WINDOW STATE ---
let lastExtractedQuestion = "";
let lastEvaluatedText = "";
let lastQuestionTimestamp = 0; // Tracks when the interviewer stopped speaking
const MERGE_THRESHOLD_MS = 6000; // 8 seconds gap means candidate has answered
let lockedContext = "NONE"; // Locks the previous question for pronoun resolution
let currentActiveQuestionNode = null; // Tracks the DOM node of the current developing question

// 1. Fetch secure keys and settings on boot
if (window.api.getAppState) {
    window.api.getAppState().then(state => {
        appState = state;
    });
}

// 2. Toggle UI Visibility (Triggered by main.js on boot)
if (window.api.onToggleAutoUI) {
    window.api.onToggleAutoUI((isVisible) => {
        const container = document.getElementById('auto-transcript-container');
        if (container) container.style.display = isVisible ? 'flex' : 'none';
        const translateBtn = document.getElementById('btn-translate');
        if (translateBtn) translateBtn.style.display = 'none'; // Always hide in auto
    });
}

// 3. The Master Toggle (Triggered by button click or hotkey)
if (window.api.onToggleAutoStreamFrontend) {
    window.api.onToggleAutoStreamFrontend(() => {
        if (isAutoCapturing) {
            stopAutoStream();
        } else {
            startAutoStream();
        }
    });
}

async function stopAutoStream() {
    console.log("[Auto Engine] Stopping stream...");
    isAutoCapturing = false;

    if (autoMediaStream) autoMediaStream.getTracks().forEach(track => track.stop());
    if (autoScriptProcessor) autoScriptProcessor.disconnect();
    if (aaiWs && aaiWs.readyState === WebSocket.OPEN) aaiWs.close();

    const headerStatus = document.getElementById('status-text');
    if (headerStatus) {
        headerStatus.innerText = "Ready (Paused)";
        headerStatus.classList.remove('recording-active');
    }

    const btnRecord = document.getElementById('btn-record');
    if (btnRecord) {
        btnRecord.classList.remove('recording');
        const btnText = btnRecord.querySelector('.btn-text');
        if (btnText) btnText.innerText = 'Start Recording';
    }
}

async function startAutoStream() {
    if (isAutoCapturing || !appState.keys.assembly) return;
    isAutoCapturing = true;

    // Reset State
    autoTranscriptBuffer = "";
    lastExtractedQuestion = "";
    lastEvaluatedText = "";
    document.getElementById('transcript-final').innerText = "";
    document.getElementById('transcript-partial').innerText = "Connecting to AssemblyAI...";

    const headerStatus = document.getElementById('status-text');
    if (headerStatus) {
        headerStatus.innerText = "Connecting...";
        headerStatus.classList.add('recording-active');
    }

    const btnRecord = document.getElementById('btn-record');
    if (btnRecord) {
        btnRecord.classList.add('recording');
        const btnText = btnRecord.querySelector('.btn-text');
        if (btnText) btnText.innerText = 'Stop Recording';
    }

    // 1. Setup AssemblyAI V3 WebSocket
    const aaiUrlObj = new URL('wss://streaming.assemblyai.com/v3/ws');
    aaiUrlObj.searchParams.append('sample_rate', '16000');
    aaiUrlObj.searchParams.append('speech_model', 'universal-streaming-english');
    aaiUrlObj.searchParams.append('format_turns', 'true');
    aaiUrlObj.searchParams.append('end_utterance_silence_threshold', '1000');

    const s = appState.settings;

    // 1. Maintain the general context prompt for AssemblyAI's LeMUR/Universal models
    let techStack = [s.role, s.context, s.language].filter(Boolean).join(', ');
    if (techStack.length) {
        aaiUrlObj.searchParams.append('keyterms_prompt', JSON.stringify(techStack.split(',').map(t => t.trim())));
    }

    // 2. Inject the Auto-Tuned Vocabulary Engine array for aggressive spelling correction
    if (s.wordBoostList && Array.isArray(s.wordBoostList) && s.wordBoostList.length > 0) {
        console.log('words', JSON.stringify(s.wordBoostList))
        aaiUrlObj.searchParams.append('word_boost', JSON.stringify(s.wordBoostList));
        aaiUrlObj.searchParams.append('boost_param', 'high'); // Forces the model to prioritize these words
        console.log(`[Auto Engine] Boosting transcription with ${s.wordBoostList.length} role-specific terms.`);
    }

    // Browser WS uses protocols, but AAI accepts token in query if needed. 
    // NOTE: If browser WS rejects headers, we append to URL:
    aaiWs = new WebSocket(aaiUrlObj.toString() + `&token=${appState.keys.assembly}`);

    aaiWs.onopen = async () => {
        console.log("[Auto Engine] AssemblyAI Connected!");
        document.getElementById('transcript-partial').innerText = "Listening...";
        if (headerStatus) headerStatus.innerText = "Listening...";

        // 2. Start Audio Capture (macOS BlackHole / Windows Desktop)
        try {
            const sourceId = await window.api.getDesktopSourceId();
            const isMac = navigator.userAgent.includes('Mac OS X');
            let streamConstraints;

            if (isMac) {
                const devices = await navigator.mediaDevices.enumerateDevices();
                const blackholeDevice = devices.find(d => d.label.includes('BlackHole'));
                if (blackholeDevice) {
                    streamConstraints = {
                        audio: { deviceId: { exact: blackholeDevice.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
                        video: false
                    };
                } else {
                    streamConstraints = { audio: true, video: false };
                }
            } else {
                streamConstraints = {
                    audio: { mandatory: { chromeMediaSource: 'desktop' } },
                    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId } }
                };
            }

            autoMediaStream = await navigator.mediaDevices.getUserMedia(streamConstraints);
            autoAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
            const source = autoAudioContext.createMediaStreamSource(autoMediaStream);
            autoScriptProcessor = autoAudioContext.createScriptProcessor(4096, 1, 1);

            source.connect(autoScriptProcessor);
            autoScriptProcessor.connect(autoAudioContext.destination);

            autoScriptProcessor.onaudioprocess = (e) => {
                if (!isAutoCapturing || aaiWs.readyState !== WebSocket.OPEN) return;
                const float32 = e.inputBuffer.getChannelData(0);
                const int16 = new Int16Array(float32.length);
                for (let i = 0; i < float32.length; i++) {
                    int16[i] = Math.max(-32768, Math.min(32767, Math.floor(float32[i] * 32768)));
                }
                aaiWs.send(int16.buffer);
            };
        } catch (err) {
            console.error("Audio capture failed:", err);
            document.getElementById('transcript-partial').innerText = "Audio capture failed.";
        }
    };

    aaiWs.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (!msg.transcript) return;

        if (msg.end_of_turn === false) {
            document.getElementById('transcript-partial').innerText = msg.transcript;
            scrollCaptions();
            
            // --- STOPWATCH LOGIC: FIRST SYLLABLE DETECTED ---
            if (lastExtractionTime > 0) {
                candidateAnswerGap = ((Date.now() - lastExtractionTime) / 1000).toFixed(1);
                lastExtractionTime = 0; // Lock the timer!
            }
            
        } else if (msg.end_of_turn === true) {
            // Failsafe: if they spoke so fast we missed the partial event
            if (lastExtractionTime > 0) {
                candidateAnswerGap = ((Date.now() - lastExtractionTime) / 1000).toFixed(1);
                lastExtractionTime = 0;
            }

            // Always append. The AI will decide what to do with it.
            autoTranscriptBuffer = (autoTranscriptBuffer + " " + msg.transcript).trim();

            document.getElementById('transcript-final').innerText = msg.transcript + " ";
            document.getElementById('transcript-partial').innerText = "";
            scrollCaptions();

            if (autoTranscriptBuffer.trim().length > 0) {
                // Pass the true floor time to the AI
                evaluateAutoBuffer(autoTranscriptBuffer, candidateAnswerGap);
            }
        }
    };

    aaiWs.onclose = () => {
        if (isAutoCapturing) stopAutoStream();
    };
}

// --- THE SNIPER ENGINE V4 (STOPWATCH, STRICT LEDGER, & ROLE-AWARE) ---
async function evaluateAutoBuffer(currentText, gapSeconds) { 
    if (isEvaluating) return;
    if (currentText.length < 5) return;
    if (currentText === lastEvaluatedText) return;

    // --- RAMBLER SAFETY CAP ---
    const safeAudioLimit = currentText.length > 600 ? currentText.substring(currentText.length - 600) : currentText;

    isEvaluating = true;

    // 1. Build the INTERVIEW HISTORY LEDGER string
    let ledgerString = uiLedger.length > 0 
        ? uiLedger.map((q, i) => `[Event ${i + 1}] UI Displayed: "${q}"`).join('\n') 
        : "No previous questions displayed yet.";

    // 2. Extract Job Role for Domain Context
    const targetRole = appState.settings.role || 'General Candidate';

    try {
        const evaluatorSystemPrompt = `You are a precision Semantic Extraction Engine and UI Dispatcher for a real-time interview assistant. Your job is to analyze the chronological flow of the interview and determine exactly how the UI should update.

[INPUTS PROVIDED TO YOU]
1. [TARGET ROLE]: The specific job title/domain of the candidate. Use this to correctly spell and contextualize industry-specific jargon.
2. [INTERVIEW HISTORY LEDGER]: The recent timeline of what the candidate has seen on their screen.
3. [CURRENT AUDIO]: The interviewer's latest transcribed speech.
4. [GAP SECONDS]: The exact time in seconds since the interviewer last stopped speaking.

[ACTION MATRIX & RULES]
Analyze the inputs and output one of three strict actions:

1. "IGNORE" (Strict Noise Filtering)
   - USE WHEN: [CURRENT AUDIO] is pure filler, small-talk ("yeah exactly", "let's move on"), or rambling without setting up a scenario or question.
   - OUTPUT: "extracted_question" must be "" (empty).

2. "REPLACE_ACTIVE" (Amend / Add Constraint)
   - USE WHEN: [CURRENT AUDIO] is a direct continuation, add-on, or constraint to the MOST RECENT question in the Ledger.
   - CRITICAL BOUNDARY: You may ONLY use this action if [GAP SECONDS] is 5 or less. If [GAP SECONDS] is 6 or more, you are STRICTLY FORBIDDEN from using REPLACE_ACTIVE.
   - OUTPUT: Combine the last question and [CURRENT AUDIO] into one perfectly clean, grammatically correct question.

3. "ADD_NEW" (Fresh Topic / Pronoun Pivot / Timeout Force)
   - USE WHEN: [CURRENT AUDIO] is a brand new topic, a pivot ("now about Redux Saga"), OR if [GAP SECONDS] is > 5 (forcing a new UI bubble due to timeout).
   - PRONOUN RESOLUTION: If [CURRENT AUDIO] uses a pronoun ("how to persist it?"), look at the Ledger to replace "it" with the proper noun before outputting.
   - OUTPUT: A perfectly clean, standalone question string.

[EXTRACTION RULES]
- DOMAIN AWARENESS: Use the [TARGET ROLE] to fix transcription errors. (e.g., if role is React Developer, "use effect" becomes "useEffect").

[JSON OUTPUT FORMAT STRICTLY]
{
  "action": "ADD_NEW" | "REPLACE_ACTIVE" | "IGNORE",
  "extracted_question": "The perfectly clean, resolved question string"
}`;

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${appState.keys.openai}` },
            body: JSON.stringify({
                model: appState.settings.model || 'gpt-4o-mini',
                response_format: { type: "json_object" },
                messages: [
                    { role: 'system', content: evaluatorSystemPrompt },
                    { role: 'user', content: `[TARGET ROLE]: ${targetRole}\n\n[INTERVIEW HISTORY LEDGER]:\n${ledgerString}\n\n[GAP SECONDS]: ${gapSeconds}\n\n[CURRENT AUDIO]: "${safeAudioLimit}"` }
                ],
                temperature: 0.1
            })
        });

        const data = await response.json();
        const parsed = JSON.parse(data.choices[0].message.content);
        const { extracted_question, action } = parsed;

        if (action === 'IGNORE' || !extracted_question || extracted_question === lastExtractedQuestion) {
            isEvaluating = false;
            return;
        }

        // --- SMART KILL SWITCH ---
        if (isSolving && activeSolverController && action === 'REPLACE_ACTIVE') {
            console.log("[Auto Engine] Constraint added! Aborting previous stream...");
            activeSolverController.abort();
            activeSolverController = null;
            isSolving = false;

            if (conversationHistory.length > 0 && conversationHistory[conversationHistory.length - 1].role === 'assistant') {
                conversationHistory.pop();
            }
        }

        lastEvaluatedText = currentText; 
        lastExtractedQuestion = extracted_question;

        // --- DYNAMIC UI UPDATING & STRICT LEDGER MANAGEMENT ---
        if (action === 'REPLACE_ACTIVE' && currentActiveQuestionNode) {
            currentActiveQuestionNode.querySelector('.msg-content').innerText = extracted_question;

            // In-place update: DO NOT increase array size for amendments
            if (uiLedger.length > 0) {
                uiLedger[uiLedger.length - 1] = extracted_question;
            } else {
                uiLedger.push(extracted_question); // Fallback
            }

            if (conversationHistory.length > 0 && conversationHistory[conversationHistory.length - 1].role === 'user') {
                conversationHistory.pop();
            }

            const answers = document.querySelectorAll('.message-answer');
            if (answers.length > 0) {
                answers[answers.length - 1].remove();
            }
        } else {
            // action === 'ADD_NEW'
            currentSlideId++;
            conversationHistory = []; 
            currentActiveQuestionNode = renderQuestionAndReturnNode(extracted_question);
            
            // Only ADD_NEW increases array size
            uiLedger.push(extracted_question);
            if (uiLedger.length > MAX_LEDGER_SIZE) {
                uiLedger.shift();
            }

            // Wipe the buffer so the next topic doesn't inherit old words
            autoTranscriptBuffer = ""; 
        }

        // START THE STOPWATCH: The UI just updated, Candidate Floor Time begins NOW.
        lastExtractionTime = Date.now();
        candidateAnswerGap = 0;

        solveAutoQuestion(extracted_question, ledgerString);

    } catch (err) {
        console.error("Sniper Error:", err);
    } finally {
        isEvaluating = false;
    }
}

// --- NEW DOM HELPER ---
function renderQuestionAndReturnNode(text) {
    const container = document.getElementById('transcript-container');
    const scrollWrapper = document.querySelector('.content'); // Target the true master scroll container
    const qDiv = document.createElement('div');
    qDiv.className = 'message-row message-question';
    qDiv.innerHTML = `<div class="avatar user">Q</div><div class="msg-content">${text}</div>`;
    container.appendChild(qDiv);

    // SMART ANCHOR FIX: Scroll the master wrapper based on the new question's vertical offset
    requestAnimationFrame(() => {
        scrollWrapper.scrollTo({
            top: qDiv.offsetTop - 15, // 15px padding gives visual breathing room at the top edge
            behavior: 'smooth'
        });
    });

    return qDiv;
}

// --- THE SOLVER ENGINE (OLD PROMPTS + CONCURRENT STREAMING + DIRECT DOM) ---
async function solveAutoQuestion(extractedQuestion, rawContext) {
    isSolving = true;
    activeSolverController = new AbortController();
    const abortSignal = activeSolverController.signal;

    conversationHistory.push({ role: 'user', content: extractedQuestion, slideId: currentSlideId });
    const s = appState.settings;

    // YOUR EXACT ORIGINAL PROMPTS
    const bulletPromptText = `You are a stealth real-time interview assistant helping a Senior-Level ${s.role}.
INTERVIEW CONTEXT:
"${rawContext}"
OBJECTIVE:
Generate high-quality, senior-level answers compressed into dense, scannable memory triggers.

DYNAMIC SCOPE ASSESSMENT (adapt based on question type):
1. Single Fact / Closed Question: Provide 2–3 bullets covering core idea, implementation, and tradeoff.
2. Pipeline / Debugging Question: Provide sequential bullets showing flow (trigger → system → issue → fix).
3. Enumeration / Broad Question: Provide 1 bullet per key concept.

CONTEXTUAL AWARENESS (ANTI-REPETITION) - CRITICAL:
- Analyze the provided Conversation History. 
- IF you have already defined or introduced the core technology in a previous answer, DO NOT define it again. 
- Jump IMMEDIATELY into the specific follow-up answer. Eliminate all introductory fluff.

QUALITY RULES:
- Think like a senior engineer first, then compress the output
- Preserve depth: include mechanisms, decisions, and tradeoffs

FORMAT RULES (STRICT):
- Use "-" for bullets only
- Maximum 12–15 words per bullet
- No numbering, no headings, no extra text
LANGUAGE: ${s.language}`;

    const detailedPromptText = `You are a real-time stealth interview assistant helping a Senior-Level ${s.role}.
INTERVIEW CONTEXT:
"${rawContext}"
GOAL: Generate a technically strong, natural-sounding answer as if I am the candidate speaking.

CONTEXTUAL AWARENESS (ANTI-REPETITION) - CRITICAL:
- Analyze the provided Conversation History. 
- IF you have already explained what a technology is in a previous answer, DO NOT re-explain it. 
- Get straight to the specific point of the new question. Do not waste time with introductory sentences.

VOICE RULES:
- Always speak in first person ("I", "I’ve worked on", "I prefer")
- Format the answer as clean bullet-style lines using "-"
- Each point must be a complete natural sentence
- Do NOT use numbering (no 1., 2., etc.)

FINAL OUTPUT STRUCTURE:
Answer:
- Each line should be a clear, natural sentence

Follow-up Questions:
- One deep technical question
- One real-world tradeoff question
LANGUAGE: ${s.language}`;

    // Create Dual-Tab UI Shell
    const { mainDiv, bulletContent, detailedContent } = renderThinkingShell();

    const runStream = async (promptText, tabType, contentNode) => {
        const filteredHistory = conversationHistory
            .filter(msg => tabType === 'detailed' || msg.role === 'user')
            .map(msg => ({ role: msg.role, content: msg.content }));

        const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${appState.keys.openai}` },
            signal: abortSignal,
            body: JSON.stringify({
                model: appState.settings.model || 'gpt-4o-mini', // Uses the user's selected model for the actual answer
                messages: [{ role: 'system', content: promptText }, ...filteredHistory],
                temperature: 0.25, stream: true
            })
        });

        if (!res.ok) throw new Error("Stream Failed");

        mainDiv.classList.remove('thinking-pulse');
        contentNode.innerHTML = ""; // Clear "Analyzing..."

        const reader = res.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let fullAnswer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const lines = decoder.decode(value, { stream: true }).split('\n').filter(line => line.trim() !== '');
            for (const line of lines) {
                if (line.includes('[DONE]')) break;
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        if (data.choices?.[0]?.delta?.content) {
                            const token = data.choices[0].delta.content;
                            fullAnswer += token;
                            contentNode.innerHTML += token.replace(/\n/g, '<br>');
                        }
                    } catch (e) { }
                }
            }
        }
        return fullAnswer;
    };

    try {
        const [bulletAns, detailedAns] = await Promise.all([
            runStream(bulletPromptText, 'bullet', bulletContent),
            runStream(detailedPromptText, 'detailed', detailedContent)
        ]);

        const historyAns = frontendPreferredTab === 'detailed' ? detailedAns : bulletAns;
        conversationHistory.push({ role: 'assistant', content: historyAns, slideId: currentSlideId });

    } catch (err) {
        if (err.name !== 'AbortError') {
            mainDiv.classList.remove('thinking-pulse');
            bulletContent.innerHTML = `<span style="color:#ff6b6b">API Error</span>`;
        }
    } finally {
        isSolving = false;
        activeSolverController = null;
    }
}

// --- DOM HELPERS ---
function triggerHighlight() {
    const questions = document.querySelectorAll('.message-question');
    if (!questions.length) return;
    const lastQ = questions[questions.length - 1];
    lastQ.classList.remove('highlight-pulse');
    void lastQ.offsetWidth;
    lastQ.classList.add('highlight-pulse');
}

function renderQuestion(text, action = 'NEW') {
    const container = document.getElementById('transcript-container');
    const qDiv = document.createElement('div');
    qDiv.className = 'message-row message-question';

    // Visual tweak: If it's a follow-up, show a subtle indent arrow instead of 'Q'
    const avatarText = action === 'FOLLOW_UP' ? '↳' : 'Q';
    const avatarStyle = action === 'FOLLOW_UP' ? 'background: #3a259c;' : '';

    qDiv.innerHTML = `<div class="avatar user" style="${avatarStyle}">${avatarText}</div><div class="msg-content">${text}</div>`;
    container.appendChild(qDiv);

    setTimeout(() => {
        container.scrollTop += (qDiv.getBoundingClientRect().top - container.getBoundingClientRect().top);
    }, 50);
}

function renderThinkingShell() {
    const container = document.getElementById('transcript-container');
    const aDiv = document.createElement('div');
    aDiv.className = 'message-row message-answer thinking-pulse';

    aDiv.innerHTML = `
        <div class="avatar ai">AI</div>
        <div class="msg-content" style="width: 100%;">
            <div class="tabs-container">
                <div class="tab-btn ${frontendPreferredTab === 'bullet' ? 'active' : ''}" data-tab="bullet">Bullet</div>
                <div class="tab-btn ${frontendPreferredTab === 'detailed' ? 'active' : ''}" data-tab="detailed">Detailed</div>
            </div>
            <div class="tab-content bullet-content ${frontendPreferredTab === 'bullet' ? 'active' : ''}">Analyzing...</div>
            <div class="tab-content detailed-content ${frontendPreferredTab === 'detailed' ? 'active' : ''}">Analyzing...</div>
        </div>
    `;

    aDiv.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const selectedTab = e.target.getAttribute('data-tab');
            aDiv.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            aDiv.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            e.target.classList.add('active');
            aDiv.querySelector('.' + selectedTab + '-content').classList.add('active');
            frontendPreferredTab = selectedTab;
            if (window.api.updatePreferredTab) window.api.updatePreferredTab(selectedTab);
        });
    });

    container.appendChild(aDiv);
    scrollToBottom();

    return {
        mainDiv: aDiv,
        bulletContent: aDiv.querySelector('.bullet-content'),
        detailedContent: aDiv.querySelector('.detailed-content')
    };
}

function scrollToBottom() {
    // INTENTIONALLY LEFT BLANK: 
    // This neutralizes the aggressive AssemblyAI polling that hijacks manual scrolling.
    // The UI now relies entirely on the precision anchor inside renderQuestionAndReturnNode.
}

function scrollCaptions() {
    // Dedicated scroller just for the Live AssemblyAI box (CC behavior)
    setTimeout(() => {
        const textArea = document.querySelector('.transcript-text-area');
        if (textArea) {
            textArea.scrollTop = textArea.scrollHeight;
        }
    }, 20);
}
