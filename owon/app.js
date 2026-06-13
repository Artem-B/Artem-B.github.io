// Owon HDS200 WebUI Application Logic
const APP_VERSION = '0.1';

document.addEventListener('DOMContentLoaded', () => {
    // --- UI Elements & State ---
    const state = {
        device: null,
        interfaceNumber: 0,
        epIn: null,
        epOut: null,
        isConnected: false,
        activeTab: 'panel-measure',
        waveforms: {
            ch1: [],
            ch2: [],
            visible1: true,
            visible2: true,
            captureHoffset: (() => {
                try {
                    const saved = localStorage.getItem('owon_capture_state');
                    if (saved) return JSON.parse(saved).captureHoffset;
                } catch (e) { }
                return undefined;
            })(),
            captureTimebase: (() => {
                try {
                    const saved = localStorage.getItem('owon_capture_state');
                    if (saved) return JSON.parse(saved).captureTimebase;
                } catch (e) { }
                return undefined;
            })(),
            captureSampleRate: (() => {
                try {
                    const saved = localStorage.getItem('owon_capture_state');
                    if (saved) return JSON.parse(saved).captureSampleRate;
                } catch (e) { }
                return undefined;
            })(),
            captureMemoryDepth: (() => {
                try {
                    const saved = localStorage.getItem('owon_capture_state');
                    if (saved) return JSON.parse(saved).captureMemoryDepth;
                } catch (e) { }
                return undefined;
            })()
        },
        isFetching: false, // Waveform read lock
        isPollingDmm: false,
        dmmTimer: null,
        isLiveFetching: false,
        liveTimer: null,
        demoAnimationId: null,
        demoPhase: 0,
        metadata: null,
        memoryDepthLabel: null,
        dragging: null, // 'horiz' or 'vert' tracking
        dragTriggerLevelVal: undefined,
        dragTriggerLevelText: undefined,
        pendingTriggerLevel: null,
        pendingTimebaseScale: null,
        pendingVerticalScales: {},
        waveformDragPreview: null,
        hudRects: [],
        cursors: {
            t1Enabled: false,
            t2Enabled: false,
            v1Enabled: false,
            v2Enabled: false,
            source: 'CH1',
            snapEnabled: true,
            t1: -0.002,
            t2: 0.002,
            v1: 1.0,
            v2: -1.0
        }
    };
    window.owonState = state;

    // Selectors
    const elements = {
        connectBtn: document.getElementById('connect-btn'),
        disconnectBtn: document.getElementById('disconnect-btn'),
        statusIndicator: document.getElementById('status-indicator'),
        connectionStatus: document.getElementById('connection-status'),
        connectedDeviceName: document.getElementById('connected-device-name'),
        brandVersion: document.getElementById('brand-version'),

        // Info bar
        infoMfr: document.getElementById('info-mfr'),
        infoModel: document.getElementById('info-model'),
        infoFw: document.getElementById('info-fw'),

        // Scope Control Status Bar
        scopeTrigStatus: document.getElementById('scope-trig-status'),
        btnRunStop: document.getElementById('btn-run-stop'),
        viewportIndicator: document.getElementById('viewport-indicator'),
        triggerOffsetReadout: document.getElementById('trigger-offset-readout'),

        // Canvas
        canvas: document.getElementById('scope-canvas'),
        toggleCh1: document.getElementById('toggle-ch1'),
        toggleCh2: document.getElementById('toggle-ch2'),
        btnFetchWave: document.getElementById('btn-fetch-wave'),
        btnAutoFetch: document.getElementById('btn-auto-fetch'),

        // Terminal
        terminalOutput: document.getElementById('terminal-output'),
        terminalForm: document.getElementById('terminal-form'),
        terminalInput: document.getElementById('terminal-input'),
        btnClearTerminal: document.getElementById('btn-clear-terminal'),

        // Header actions
        btnCycleAcq: document.getElementById('btn-cycle-acq'),
        btnCycleMem: document.getElementById('btn-cycle-mem'),

        // Nav & Panels
        navItems: document.querySelectorAll('.nav-item'),
        controlPanels: document.querySelectorAll('.control-panel'),

        // DMM
        dmmVal: document.getElementById('dmm-measured-value'),
        dmmUnit: document.getElementById('dmm-unit-label'),
        dmmFuncSelect: document.getElementById('dmm-func'),
        btnQueryDmm: document.getElementById('btn-query-dmm'),
        btnPollDmm: document.getElementById('btn-poll-dmm'),

        // Toast
        toast: document.getElementById('notification-toast'),
        cursorT1Enabled: document.getElementById('cursor-t1-enabled'),
        cursorT2Enabled: document.getElementById('cursor-t2-enabled'),
        cursorV1Enabled: document.getElementById('cursor-v1-enabled'),
        cursorV2Enabled: document.getElementById('cursor-v2-enabled'),
        cursorsSource: document.getElementById('cursors-source'),
        cursorsSnap: document.getElementById('cursors-snap'),
        btnResetCursors: document.getElementById('btn-reset-cursors'),
        cursorValT1: document.getElementById('cursor-val-t1'),
        cursorValT2: document.getElementById('cursor-val-t2'),
        cursorValDt: document.getElementById('cursor-val-dt'),
        cursorValFreq: document.getElementById('cursor-val-freq'),
        cursorValV1: document.getElementById('cursor-val-v1'),
        cursorValV2: document.getElementById('cursor-val-v2'),
        cursorValDv: document.getElementById('cursor-val-dv'),
        cursorValVt1: document.getElementById('cursor-val-vt1'),
        cursorValVt2: document.getElementById('cursor-val-vt2')
    };

    // Set version dynamically
    if (elements.brandVersion) {
        elements.brandVersion.textContent = `v${APP_VERSION}`;
    }

    // Context setup
    const ctx = elements.canvas.getContext('2d');
    const viewportCtx = elements.viewportIndicator.getContext('2d');

    // Scaling and cycle constants
    const VOLTAGE_SCALES = ['10mv', '20mv', '50mv', '100mv', '200mv', '500mv', '1v', '2v', '5v', '10v'];
    const TIMEBASE_SCALES = [
        '5ns', '10ns', '20ns', '50ns', '100ns', '200ns', '500ns',
        '1us', '2us', '5us', '10us', '20us', '50us', '100us', '200us', '500us',
        '1ms', '2ms', '5ms', '10ms', '20ms', '50ms', '100ms', '200ms', '500ms',
        '1s', '2s', '5s', '10s'
    ];
    const ACQ_MODES = ['SAMPle', 'PEAK'];
    let acqModeIdx = 0;

    // --- Navigation Logic ---
    elements.navItems.forEach(item => {
        item.addEventListener('click', () => {
            const target = item.getAttribute('data-target');

            // Update Nav state
            elements.navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            // Show targeted panel
            elements.controlPanels.forEach(panel => panel.classList.add('hidden'));
            document.getElementById(target).classList.remove('hidden');
            state.activeTab = target;
        });
    });

    // --- Toast Notification Helper ---
    function showToast(msg, duration = 3000) {
        elements.toast.textContent = msg;
        elements.toast.classList.remove('hidden');
        setTimeout(() => elements.toast.classList.add('hidden'), duration);
    }

    // --- Terminal Operations ---
    function appendTerminal(text, type = 'recv') {
        const line = document.createElement('div');
        line.className = `terminal-line ${type}`;
        line.textContent = text;
        elements.terminalOutput.appendChild(line);
        elements.terminalOutput.scrollTop = elements.terminalOutput.scrollHeight;
    }

    elements.btnClearTerminal.addEventListener('click', () => {
        elements.terminalOutput.innerHTML = '';
        appendTerminal('Terminal cleared.', 'system');
    });

    // --- WebUSB Logic ---
    const OWON_VID = 0x5345;
    const OWON_PID = 0x1234;

    async function connectDevice() {
        try {
            appendTerminal('Requesting USB device matching Owon HDS series...', 'system');
            const authorizedDevices = await navigator.usb.getDevices();
            const device = authorizedDevices.find(d => d.vendorId === OWON_VID)
                || await navigator.usb.requestDevice({
                    filters: [{ vendorId: OWON_VID, productId: OWON_PID }, { vendorId: OWON_VID }]
                });

            await initializeUsbSession(device);
        } catch (err) {
            console.error(err);
            appendTerminal(`Connection Error: ${err.message}`, 'error');
            showToast('Connection failed.');
        }
    }

    async function initializeUsbSession(device) {
        try {
            state.device = device;
            appendTerminal(`Opening connection to ${device.productName}...`, 'system');
            await device.open();

            let configValue = device.configuration ? device.configuration.configurationValue : 1;
            await device.selectConfiguration(configValue);

            // Discover endpoints
            let epIn = null;
            let epOut = null;
            let ifaceNum = 0;
            let altSetting = 0;

            // Look for the first bulk IN and bulk OUT endpoints
            for (const iface of device.configuration.interfaces) {
                for (const alt of iface.alternates) {
                    const foundIn = alt.endpoints.find(e => e.direction === 'in' && e.type === 'bulk');
                    const foundOut = alt.endpoints.find(e => e.direction === 'out' && e.type === 'bulk');
                    if (foundIn && foundOut) {
                        ifaceNum = iface.interfaceNumber;
                        altSetting = alt.alternateSetting;
                        epIn = foundIn.endpointNumber;
                        epOut = foundOut.endpointNumber;
                        break;
                    }
                }
                if (epIn && epOut) break;
            }

            if (epIn === null || epOut === null) {
                throw new Error("Could not locate valid bulk IN/OUT endpoints on this device.");
            }

            await device.claimInterface(ifaceNum);
            if (altSetting !== 0) {
                await device.selectAlternateInterface(ifaceNum, altSetting);
            }

            state.interfaceNumber = ifaceNum;
            state.epIn = epIn;
            state.epOut = epOut;
            state.isConnected = true;

            // Update UI Connected State
            elements.connectBtn.classList.add('hidden');
            elements.disconnectBtn.classList.remove('hidden');
            elements.statusIndicator.className = 'status-dot connected';
            elements.connectionStatus.textContent = 'Connected';
            elements.connectedDeviceName.textContent = `${device.manufacturerName} ${device.productName}`;

            appendTerminal(`Successfully attached to ${device.productName}!`, 'system');
            appendTerminal(`Endpoints: IN=${epIn}, OUT=${epOut}`, 'system');

            showToast('Connected to Oscilloscope!');

            // Query initial status
            await querySystemInfo();
            await fetchWaveform();

        } catch (err) {
            console.error(err);
            appendTerminal(`Interface claim failed: ${err.message}`, 'error');
            state.device = null;
            state.isConnected = false;
        }
    }

    async function disconnectDevice() {
        if (!state.device) return;

        stopContinuous();

        try {
            await state.device.releaseInterface(state.interfaceNumber);
            await state.device.close();
        } catch (err) {
            console.warn("Cleanup during disconnect failed", err);
        }

        state.device = null;
        state.isConnected = false;
        state.epIn = null;
        state.epOut = null;
        state.waveforms.ch1 = [];
        state.waveforms.ch2 = [];
        state.waveforms.captureHoffset = undefined;
        state.waveforms.captureTimebase = undefined;
        state.waveforms.captureSampleRate = undefined;
        state.waveforms.captureMemoryDepth = undefined;
        try {
            localStorage.removeItem('owon_capture_state');
        } catch (e) { }
        state.metadata = null;
        state.waveformDragPreview = null;

        // UI Update
        elements.connectBtn.classList.remove('hidden');
        elements.disconnectBtn.classList.add('hidden');
        elements.statusIndicator.className = 'status-dot disconnected';
        elements.connectionStatus.textContent = 'Disconnected';
        elements.connectedDeviceName.textContent = 'No Device Selected';

        // Clear Info
        elements.infoMfr.textContent = '-';
        elements.infoModel.textContent = '-';
        elements.infoFw.textContent = '-';
        elements.scopeTrigStatus.textContent = 'UNKNOWN';

        appendTerminal('Device disconnected.', 'system');
        showToast('Disconnected.');

        // Draw empty grid
        drawScope();
        updateViewportToolbar();
    }

    let deviceMutex = Promise.resolve();

    async function sendCommand(cmdString, isInternal = true) {
        if (!state.isConnected) {
            if (!isInternal) appendTerminal('Cannot send: device disconnected.', 'error');
            return null;
        }

        // Internal closure encapsulating the single command transaction
        const transaction = async () => {
            try {
                const encoder = new TextEncoder();
                const commandBytes = encoder.encode(cmdString + '\r\n');

                if (!isInternal || document.getElementById('toggle-debug-logs')?.checked) {
                    appendTerminal(cmdString, 'sent');
                }
                await state.device.transferOut(state.epOut, commandBytes);

                if (cmdString.includes('?')) {
                    return await readResponse(isInternal, cmdString);
                }
                return true;
            } catch (err) {
                if (!isInternal || document.getElementById('toggle-debug-logs')?.checked) {
                    appendTerminal(`Tx Error: ${err.message}`, 'error');
                }
                return null;
            }
        };

        // Mutex queuing: Wait for existing transactions to resolve, then lock the pipeline.
        const existingTransaction = deviceMutex;
        let release;
        deviceMutex = new Promise(res => release = res);

        await existingTransaction;
        try {
            return await transaction();
        } finally {
            release(); // Release queue lock for next command in line
        }
    }
    window.testSendCommand = sendCommand;
    window.owonFetchWaveform = fetchWaveform;
    window.owonGetViewportModel = getViewportModel;
    window.owonGetWaveformIndices = getWaveformIndices;
    window.owonDrawScope = drawScope;
    window.owonSetTimebaseScale = setTimebaseScale;

    async function readResponse(isInternal = true, cmdString = '') {
        if (!state.isConnected) return null;

        try {
            // Read large chunk (e.g., 1024 bytes or more for binary streams)
            const result = await state.device.transferIn(state.epIn, 8192);

            if (result.status === 'ok' && result.data) {
                // Determine if response is binary or text
                const rawBytes = new Uint8Array(result.data.buffer);

                // Owon binary response has a 4-byte little-endian length header.
                // We check if the potential length fits within the received buffer.
                if (rawBytes.length >= 4) {
                    const potentialLen = rawBytes[0] | (rawBytes[1] << 8) | (rawBytes[2] << 16) | (rawBytes[3] << 24);
                    if (potentialLen > 0 && potentialLen < 8192 && potentialLen + 4 <= rawBytes.length) {
                        const payload = rawBytes.slice(4, 4 + potentialLen);
                        // Detect if payload is JSON text
                        if (payload[0] === 123 /* '{' */) {
                            const decoder = new TextDecoder();
                            const text = decoder.decode(payload).trim();
                            if (!isInternal || document.getElementById('toggle-debug-logs')?.checked) {
                                appendTerminal(text, 'recv');
                            }
                        } else {
                            if (!isInternal || document.getElementById('toggle-debug-logs')?.checked) {
                                if (cmdString === ':DATa:WAVe:SCReen:CH1?') {
                                    const signedValues = new Int8Array(payload.buffer, payload.byteOffset, payload.byteLength);
                                    let displayArray = Array.from(signedValues);
                                    let clipInfo = '';

                                    try {
                                        const model = getViewportModel();
                                        const isStopped = state.metadata?.RUNSTATUS === 'STOP';
                                        if (model) {
                                            const pointsLen = signedValues.length;
                                            const { iStart, iEnd } = getWaveformIndices(pointsLen);

                                            const status = state.metadata?.RUNSTATUS || 'RUN';
                                            clipInfo = ` [i:${iStart}-${iEnd}, acq:${Math.round(model.acquisitionSamples)}, vp:${Math.round(model.viewportSamples)}, status:${status}]`;

                                            if (isStopped && model.viewportSamples > model.acquisitionSamples) {
                                                if (iStart > 0 || iEnd < pointsLen - 1) {
                                                    displayArray = iEnd >= iStart ? displayArray.slice(iStart, iEnd + 1) : [];
                                                    clipInfo += ' (Clipped)';
                                                }
                                            }
                                        }
                                    } catch (e) {
                                        // Ignore model errors and log full data
                                    }

                                    appendTerminal(`[Owon Binary Data${clipInfo}: [${displayArray.join(', ')}]]`, 'recv');
                                } else {
                                    appendTerminal(`[Owon Binary Data: ${payload.length} bytes]`, 'recv');
                                }
                            }
                        }
                        return payload;
                    }
                }

                // In SCPI, standard binary blocks start with '#'
                if (rawBytes[0] === 35 /* '#' */) {
                    // Parse binary Arbitrary Block Header
                    const numLenChars = parseInt(String.fromCharCode(rawBytes[1]), 10);
                    if (!isNaN(numLenChars) && numLenChars > 0) {
                        const lenStr = String.fromCharCode(...rawBytes.slice(2, 2 + numLenChars));
                        const expectedLen = parseInt(lenStr, 10);
                        const headerSize = 2 + numLenChars;

                        // Return raw data payload
                        const payload = rawBytes.slice(headerSize, headerSize + expectedLen);
                        if (!isInternal || document.getElementById('toggle-debug-logs')?.checked) {
                            appendTerminal(`[SCPI Binary Block: ${payload.length} bytes]`, 'recv');
                        }
                        return payload;
                    }
                }

                // Standard text response
                const decoder = new TextDecoder();
                const responseText = decoder.decode(result.data).trim();
                if (!isInternal || document.getElementById('toggle-debug-logs')?.checked) {
                    appendTerminal(responseText, 'recv');
                }
                return responseText;
            } else {
                if (!isInternal || document.getElementById('toggle-debug-logs')?.checked) {
                    appendTerminal(`Rx non-ok: ${result.status}`, 'error');
                }
                return null;
            }
        } catch (err) {
            if (!isInternal || document.getElementById('toggle-debug-logs')?.checked) {
                appendTerminal(`Rx Error: ${err.message}`, 'error');
            }
            return null;
        }
    }

    // --- Scope System Queries ---
    async function fetchHeaderInfo() {
        if (!state.isConnected) return null;

        const headBytes = await sendCommand(':DATa:WAVe:SCReen:HEAD?');
        if (headBytes && headBytes instanceof Uint8Array) {
            try {
                const decoder = new TextDecoder();
                const jsonText = decoder.decode(headBytes).trim();
                const meta = JSON.parse(jsonText);

                // --- PRESERVE DRAG STATE ---
                // Prevent live fetching from overwriting the element currently being dragged
                // so it doesn't snap back to the old device state before mouseup
                if (state.dragging && state.metadata) {
                    if ((state.dragging === 'horiz' || state.dragging === 'waveform_horiz') && meta.TIMEBASE) {
                        meta.TIMEBASE.HOFFSET = state.metadata.TIMEBASE.HOFFSET;
                    } else if (state.dragging === 'vert' && meta.Trig && meta.Trig.Items) {
                        meta.Trig.Items.Level = state.metadata.Trig.Items.Level;
                    }
                    // Note: offset_ch is explicitly NOT preserved here. It streams the live
                    // hardware position while the ghost waveform handles the dragged position.
                }

                applyPendingTriggerLevel(meta);
                applyPendingTimebaseScale(meta);
                applyPendingVerticalScales(meta);

                // Capture horizontal parameters on transition to STOP or if not yet initialized
                if (meta.RUNSTATUS) {
                    const isStop = meta.RUNSTATUS.toUpperCase() === 'STOP';
                    const wasRunning = !state.metadata || state.metadata.RUNSTATUS !== 'STOP';
                    if (!isStop || wasRunning || state.waveforms.captureHoffset === undefined) {
                        state.waveforms.captureHoffset = parseFloat(meta.TIMEBASE?.HOFFSET) || 0;
                        state.waveforms.captureTimebase = parseTime(meta.TIMEBASE?.SCALE);
                        state.waveforms.captureSampleRate = parseSampleRate(meta.SAMPLE?.SAMPLERATE);
                        state.waveforms.captureMemoryDepth = parseMemoryDepth(meta.SAMPLE?.DEPMEM || meta.SAMPLE?.DATALEN);
                        try {
                            localStorage.setItem('owon_capture_state', JSON.stringify({
                                captureHoffset: state.waveforms.captureHoffset,
                                captureTimebase: state.waveforms.captureTimebase,
                                captureSampleRate: state.waveforms.captureSampleRate,
                                captureMemoryDepth: state.waveforms.captureMemoryDepth
                            }));
                        } catch (e) { }
                    }
                }

                state.metadata = meta;

                updateMemoryDepthLabel(meta.SAMPLE?.DEPMEM || meta.SAMPLE?.DATALEN);
                updateAcquisitionModeLabel(meta.SAMPLE?.TYPE);
                updateViewportToolbar();

                // Update status-bar indicators
                if (meta.RUNSTATUS) {
                    const status = meta.RUNSTATUS.toUpperCase();
                    elements.scopeTrigStatus.textContent = status;

                    // Dynamic class toggles for status badge
                    elements.scopeTrigStatus.classList.remove('stopped', 'scanning');
                    if (status === 'STOP') {
                        elements.scopeTrigStatus.classList.add('stopped');
                    } else if (status === 'SCAN') {
                        elements.scopeTrigStatus.classList.add('scanning');
                    }

                    // Toggle Play/Pause icon state
                    const playIcon = elements.btnRunStop.querySelector('i');
                    if (status === 'STOP') {
                        playIcon.className = 'fa-solid fa-play';
                        elements.btnRunStop.classList.remove('running');
                    } else {
                        playIcon.className = 'fa-solid fa-pause';
                        elements.btnRunStop.classList.add('running');
                    }
                }

                if (meta.CHANNEL && meta.CHANNEL.length >= 2) {
                    const ch1 = meta.CHANNEL[0];
                    const ch2 = meta.CHANNEL[1];

                    if (ch1) {
                        state.waveforms.visible1 = (ch1.DISPLAY === 'ON');
                        elements.toggleCh1.setAttribute('data-active', state.waveforms.visible1 ? "true" : "false");
                    }

                    if (ch2) {
                        state.waveforms.visible2 = (ch2.DISPLAY === 'ON');
                        elements.toggleCh2.setAttribute('data-active', state.waveforms.visible2 ? "true" : "false");
                    }
                }
                return meta;
            } catch (err) {
                console.error('Failed to parse system header info:', err);
            }
        }
        return null;
    }

    async function querySystemInfo() {
        const idn = await sendCommand('*IDN?');
        if (idn && typeof idn === 'string') {
            const parts = idn.split(',');
            if (parts.length >= 4) {
                elements.infoMfr.textContent = parts[0];
                elements.infoModel.textContent = parts[1];
                elements.infoFw.textContent = parts[3];
            }
        }

        const depth = await sendCommand(':ACQuire:DEPMem?');
        if (depth && typeof depth === 'string') {
            updateMemoryDepthLabel(depth);
        }

        // Fetch comprehensive screen header metadata
        const fetchedMeta = await fetchHeaderInfo();
        if (!fetchedMeta) {
            const trig = await sendCommand(':TRIGger:STATus?');
            if (trig && typeof trig === 'string') {
                elements.scopeTrigStatus.textContent = trig.toUpperCase();
            }
        }
    }

    async function fetchWaveform() {
        if (!state.isConnected) {
            showToast('Please connect USB first.');
            return;
        }

        // Re-entrancy guard: discard request if a fetch is currently active
        if (state.isFetching) return;
        state.isFetching = true;

        try {
            // 1. Fetch the latest configuration metadata from screen
            await fetchHeaderInfo();

            if (state.dragging === 'waveform_horiz') {
                drawScope();
                return;
            }

            // Read Channel 1
            if (state.waveforms.visible1) {
                const ch1Data = await sendCommand(':DATa:WAVe:SCReen:CH1?');
                if (ch1Data) {
                    const parsed = parseWaveformData(ch1Data);
                    // Only overwrite state if payload contains real non-transient signal
                    if (parsed) {
                        state.waveforms.ch1 = parsed;
                        if (state.metadata?.RUNSTATUS !== 'STOP' || state.waveforms.ch1CaptureOffset === undefined) {
                            state.waveforms.ch1CaptureOffset = state.metadata?.CHANNEL?.[0]?.OFFSET || 0;
                        }
                    }
                }
            }

            // Read Channel 2
            if (state.waveforms.visible2) {
                const ch2Data = await sendCommand(':DATa:WAVe:SCReen:CH2?');
                if (ch2Data) {
                    const parsed = parseWaveformData(ch2Data);
                    if (parsed) {
                        state.waveforms.ch2 = parsed;
                        if (state.metadata?.RUNSTATUS !== 'STOP' || state.waveforms.ch2CaptureOffset === undefined) {
                            state.waveforms.ch2CaptureOffset = state.metadata?.CHANNEL?.[1]?.OFFSET || 0;
                        }
                    }
                }
            }

            // Re-render Canvas
            drawScope();

        } catch (err) {
            appendTerminal(`Fetch failed: ${err.message}`, 'error');
        } finally {
            state.isFetching = false; // Release lock
        }
    }

    function parseWaveformData(data) {
        if (data instanceof Uint8Array) {
            const signedData = new Int8Array(data.buffer, data.byteOffset, data.byteLength);

            // Hardware Defense: Detect absolute digital zero transient frames.
            // During display toggling state-changes, the scope temporarily returns
            // exactly N bytes of 0x00. Real analog signals always contain noise.
            let allZeros = true;
            for (let i = 0; i < signedData.length; i++) {
                if (signedData[i] !== 0) {
                    allZeros = false;
                    break;
                }
            }
            if (allZeros && signedData.length > 0) {
                // Indicate that this is a transient blank frame to avoid wiping existing data
                return null;
            }

            // Convert to 0-255 range (adding 128) to match unified renderer coordinate space
            return Array.from(signedData).map(v => v + 128);
        }

        // If string (comma separated fallback)
        if (typeof data === 'string') {
            return data.split(',').map(x => {
                const n = parseFloat(x.trim());
                return isNaN(n) ? 0 : n;
            });
        }

        return [];
    }

    // --- DMM Continuous Polling ---
    async function queryDmm() {
        const funcVal = elements.dmmFuncSelect.value;

        // Set labels
        let unit = '?';
        if (funcVal.includes('VOLT')) unit = 'V';
        else if (funcVal.includes('CURR')) unit = 'A';
        else if (funcVal === 'RESistance') unit = 'Ω';
        else if (funcVal === 'CAPacitance') unit = 'F';
        else if (funcVal === 'DIODe') unit = 'V';
        else if (funcVal === 'CONTinuity') unit = 'Ω';

        elements.dmmUnit.textContent = unit;

        const res = await sendCommand(':DMM:MEAS?');
        if (res) {
            elements.dmmVal.textContent = res;
        }
    }

    function toggleDmmPolling() {
        if (state.isPollingDmm) {
            // Stop
            clearInterval(state.dmmTimer);
            state.isPollingDmm = false;
            elements.btnPollDmm.classList.remove('btn-accent');
            elements.btnPollDmm.classList.add('btn-outline');
            elements.btnPollDmm.textContent = 'Continuous';
        } else {
            if (!state.isConnected) {
                showToast('Connect to device first.');
                return;
            }
            // Start
            state.isPollingDmm = true;
            elements.btnPollDmm.classList.remove('btn-outline');
            elements.btnPollDmm.classList.add('btn-accent');
            elements.btnPollDmm.textContent = 'STOP POLLING';

            queryDmm();
            state.dmmTimer = setInterval(queryDmm, 800);
        }
    }

    function toggleLiveWave() {
        if (state.isLiveFetching) {
            clearInterval(state.liveTimer);
            state.isLiveFetching = false;
            elements.btnAutoFetch.classList.remove('btn-accent');
            elements.btnAutoFetch.classList.add('btn-outline');
            elements.btnAutoFetch.textContent = 'LIVE';
        } else {
            if (!state.isConnected) {
                showToast('Connect to device first.');
                return;
            }
            state.isLiveFetching = true;
            elements.btnAutoFetch.classList.remove('btn-outline');
            elements.btnAutoFetch.classList.add('btn-accent');
            elements.btnAutoFetch.textContent = 'STOP LIVE';

            fetchWaveform();
            state.liveTimer = setInterval(fetchWaveform, 66);
        }
    }

    function stopContinuous() {
        if (state.isPollingDmm) toggleDmmPolling();
        if (state.isLiveFetching) toggleLiveWave();
    }

    // --- Canvas & Visualization ---
    function resizeCanvas() {
        const rect = elements.canvas.getBoundingClientRect();
        elements.canvas.width = rect.width;
        elements.canvas.height = rect.height;
        drawScope();
    }

    window.addEventListener('resize', resizeCanvas);

    function drawGrid(g, w, h) {
        ctx.strokeStyle = 'rgba(48, 54, 61, 0.4)';
        ctx.lineWidth = 1;

        const dx = g.width / 12;
        const dy = g.height / 8;

        // Draw vertical grid lines
        for (let i = 0; i <= 12; i++) {
            ctx.beginPath();
            const x = g.left + i * dx;
            ctx.moveTo(x, g.top);
            ctx.lineTo(x, g.bottom);

            // Central vertical axis style
            if (i === 6) {
                ctx.strokeStyle = 'rgba(88, 166, 255, 0.4)';
                ctx.setLineDash([4, 4]);
            } else {
                ctx.strokeStyle = 'rgba(48, 54, 61, 0.4)';
                ctx.setLineDash([]);
            }
            ctx.stroke();
        }

        // Draw horizontal grid lines
        for (let j = 0; j <= 8; j++) {
            ctx.beginPath();
            const y = g.top + j * dy;
            ctx.moveTo(g.left, y);
            ctx.lineTo(g.right, y);

            // Central horizontal axis style
            if (j === 4) {
                ctx.strokeStyle = 'rgba(88, 166, 255, 0.4)';
                ctx.setLineDash([4, 4]);
            } else {
                ctx.strokeStyle = 'rgba(48, 54, 61, 0.4)';
                ctx.setLineDash([]);
            }
            ctx.stroke();
        }

        // Draw distinct grid boundary border
        ctx.setLineDash([]);
        ctx.strokeStyle = '#30363d';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(g.left, g.top, g.width, g.height);
    }

    function getWaveformXRange(g, preview = null) {
        const model = getViewportModel(preview);
        if (!model.viewportSamples || model.acquisitionSamples >= model.viewportSamples) {
            return { start: g.left, end: g.right };
        }

        const xForSample = (sample) => g.centerX + (sample / model.viewportSamples) * g.width;
        return {
            start: xForSample(model.acquisition.start),
            end: xForSample(model.acquisition.end)
        };
    }

    function getWaveformIndices(pointsLen, preview = null) {
        if (!Number.isFinite(pointsLen) || pointsLen <= 0) {
            return { iStart: 0, iEnd: -1 };
        }

        const isStopped = state.metadata?.RUNSTATUS === 'STOP';
        // When running, the device eventually fills the full screen buffer.
        // Only apply theoretical clipping when stopped (or during a drag preview).
        if (!isStopped && !preview) {
            return { iStart: 0, iEnd: pointsLen - 1 };
        }

        const model = getViewportModel(preview);
        const decimationFactor = model.viewportSamples / pointsLen;
        let iStart = Math.max(0, Math.ceil((model.acquisition.start - model.viewport.start) / decimationFactor));
        let iEnd = Math.min(pointsLen - 1, Math.floor((model.acquisition.end - 1 - model.viewport.start) / decimationFactor - 1));

        if (isScreenColumnPairPayload(pointsLen)) {
            // A 600-byte screen waveform is 300 two-byte screen columns. Ending
            // a clipped path on the first byte of a column draws a false runt edge.
            if (iStart % 2 !== 0) iStart += 1;
            if (iEnd % 2 === 0) iEnd -= 1;
        }

        return { iStart, iEnd };
    }

    function isScreenColumnPairPayload(pointsLen) {
        const dataLen = Number(state.metadata?.SAMPLE?.DATALEN);
        return pointsLen === 600 && (!Number.isFinite(dataLen) || dataLen === pointsLen);
    }

    function getInterleavedWaveformLaneCount(points) {
        const length = Array.isArray(points) ? points.length : Number(points) || 0;
        if (length <= 1) return 1;

        // Screen-waveform payloads represent the visible screen columns. PEAK
        // mode may add extra byte phases, but it does not prove the payload
        // doubled; some HDS2102S captures return 600 bytes in both modes.
        if (length > 700) return 4;
        if (length > 300) return 2;
        return 1;
    }

    function drawWaveform(points, color, g, offsetDelta = 0, xShiftPx = 0) {
        if (!points || points.length === 0) return;

        const xRange = getWaveformXRange(g);
        const clipLeft = Math.max(g.left, Math.min(xRange.start, xRange.end) + xShiftPx);
        const clipRight = Math.min(g.right, Math.max(xRange.start, xRange.end) + xShiftPx);
        if (clipRight <= clipLeft) return;

        ctx.save();
        // Screen-waveform data is already sampled across the device's visible
        // 12-division viewport. Keep drawing bounded to the visible portion of
        // the current acquisition window.
        ctx.beginPath();
        ctx.rect(clipLeft, g.top, clipRight - clipLeft, g.height);
        ctx.clip();

        const dy = g.height / 8; // Pixels per division
        const unitsPerDiv = 25.0;
        const pixelsPerUnit = dy / unitsPerDiv;
        const centerY = g.centerY;
        const deltaY = offsetDelta * pixelsPerUnit;
        const xStart = g.left + xShiftPx;
        const xWidth = g.width;

        const laneCount = getInterleavedWaveformLaneCount(points);
        const lanes = Array.from({ length: laneCount }, (_, lane) => lane);

        const columnCount = Math.ceil(points.length / laneCount);
        const { iStart, iEnd } = getWaveformIndices(columnCount);
        if (iEnd < iStart) {
            ctx.restore();
            return;
        }

        const stepX = columnCount > 1 ? xWidth / (columnCount - 1) : 0;

        ctx.strokeStyle = color;
        ctx.lineWidth = 1.55;
        ctx.lineCap = 'round';
        ctx.shadowColor = color;
        ctx.shadowBlur = 4;
        ctx.beginPath();

        let previousSpan = null;
        for (let i = iStart; i <= iEnd; i++) {
            const x = xStart + i * stepX;
            let minY = Infinity;
            let maxY = -Infinity;

            lanes.forEach((lane) => {
                const val = points[lane + i * laneCount];
                if (!Number.isFinite(val)) return;
                const y = centerY - ((val - 128) * pixelsPerUnit) - deltaY;
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
            });

            if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
                previousSpan = null;
                continue;
            }
            if (previousSpan) {
                minY = Math.min(minY, previousSpan.maxY);
                maxY = Math.max(maxY, previousSpan.minY);
            }
            if (minY === maxY) {
                minY -= 0.7;
                maxY += 0.7;
            }
            ctx.moveTo(x, minY);
            ctx.lineTo(x, maxY);
            previousSpan = { minY, maxY };
        }

        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.restore(); // Clean context cleanup
    }

    function drawZeroIndicator(channelIdx, offsetValue, color, g) {
        if (offsetValue === undefined) return;

        const dy = g.height / 8;
        const pixelsPerUnit = dy / 25.0;
        const centerY = g.centerY;
        const y = centerY - (offsetValue * pixelsPerUnit);

        // Constrain indicator vertical to be visible on grid
        if (y < g.top || y > g.bottom) return;

        // Draw indicator pointing RIGHT, resting just outside the left grid border
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(g.left, y); // Tip touches left grid border
        ctx.lineTo(g.left - 12, y - 7);
        ctx.lineTo(g.left - 12, y + 7);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#000000';
        ctx.font = 'bold 10px JetBrains Mono, Courier';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${channelIdx + 1}`, g.left - 7, y);
    }

    function parseVoltage(str) {
        if (typeof str === 'number') return str;
        if (!str) return 0;
        const match = str.match(/(-?[\d\.]+)\s*([mu]?V)/i);
        if (!match) return parseFloat(str) || 0;
        const val = parseFloat(match[1]);
        const unit = match[2].toLowerCase();
        if (unit === 'mv') return val * 0.001;
        if (unit === 'uv') return val * 0.000001;
        return val;
    }

    function formatVoltageForDisplay(voltage) {
        return Math.abs(voltage) < 1.0
            ? `${(voltage * 1000).toFixed(0)}mV`
            : `${voltage.toFixed(2)}V`;
    }

    function formatVoltageForScpi(voltage) {
        const padded = voltage + Math.sign(voltage) * 0.0001;
        return Math.abs(padded) < 1.0
            ? `${(padded * 1000).toFixed(1)}mV`
            : `${padded.toFixed(4)}V`;
    }

    function getTriggerLevelForY(g, y) {
        const trigInfo = state.metadata?.Trig?.Items;
        if (!trigInfo) return null;

        const trigChan = trigInfo.Channel || 'CH1';
        const chMeta = state.metadata.CHANNEL && (trigChan === 'CH2' ? state.metadata.CHANNEL[1] : state.metadata.CHANNEL[0]);
        if (!chMeta) return null;

        const dy = g.height / 8;
        const offsetUnits = chMeta.OFFSET || 0;
        const scaleVal = parseVoltage(chMeta.SCALE);
        if (scaleVal === 0) return null;

        const ny = Math.max(g.top, Math.min(g.bottom, y));
        return scaleVal * (-(ny - g.centerY) / dy - (offsetUnits / 25.0));
    }

    function applyPendingTriggerLevel(meta) {
        const pending = state.pendingTriggerLevel;
        const trigItems = meta?.Trig?.Items;
        if (!pending || !trigItems) return;

        const deviceLevel = parseVoltage(trigItems.Level);
        const hasCaughtUp = Math.abs(deviceLevel - pending.val) < 0.001;
        if (Date.now() > pending.expires || hasCaughtUp) {
            state.pendingTriggerLevel = null;
            return;
        }

        trigItems.Level = pending.levelText;
    }

    function applyPendingTimebaseScale(meta) {
        const pending = state.pendingTimebaseScale;
        const timebase = meta?.TIMEBASE;
        if (!pending || !timebase || !timebase.SCALE) return;

        const deviceScale = parseTime(timebase.SCALE);
        const hasCaughtUp = Math.abs(deviceScale - pending.seconds) <= pending.seconds * 1e-6;
        if (hasCaughtUp) {
            state.pendingTimebaseScale = null;
            return;
        }

        if (Date.now() > pending.expires) {
            state.pendingTimebaseScale = null;
            return;
        }

        if (pending.wasStopped && Date.now() - pending.sentAt > 150) {
            showToast('Timebase limit reached.');
            state.pendingTimebaseScale = null;
            return;
        }

        timebase.SCALE = pending.label;
    }

    function applyPendingVerticalScales(meta) {
        const channels = meta?.CHANNEL;
        if (!channels || !state.pendingVerticalScales) return;

        for (const [chIdxText, pending] of Object.entries(state.pendingVerticalScales)) {
            const chIdx = Number(chIdxText);
            const channel = channels[chIdx];
            if (!pending || !channel || !channel.SCALE) continue;

            const deviceScale = parseVoltage(channel.SCALE);
            const hasCaughtUp = Math.abs(deviceScale - pending.volts) <= Math.max(pending.volts * 1e-6, 1e-9);
            if (Date.now() > pending.expires || hasCaughtUp) {
                delete state.pendingVerticalScales[chIdx];
                continue;
            }

            channel.SCALE = pending.label;
        }
    }

    function parseTime(timeStr) {
        if (!timeStr) return 0;
        const num = parseFloat(timeStr);
        const unit = timeStr.replace(/[0-9.]/g, '').trim().toLowerCase();
        if (unit.includes('ns')) return num * 1e-9;
        if (unit.includes('us') || unit.includes('µs')) return num * 1e-6;
        if (unit.includes('ms')) return num * 1e-3;
        if (unit.includes('s')) return num;
        return num;
    }

    function parseSampleRate(rate) {
        if (typeof rate === 'number') return rate;
        if (!rate) return 0;
        const text = String(rate).trim().replace(/Sa\/s/i, '').replace(/SPS/i, '');
        const value = parseFloat(text);
        if (!Number.isFinite(value)) return 0;
        const unit = text.replace(/[-+0-9.,\s]/g, '').toLowerCase();
        if (unit.includes('g')) return value * 1e9;
        if (unit.includes('m')) return value * 1e6;
        if (unit.includes('k')) return value * 1e3;
        return value;
    }

    function parseMemoryDepth(depth) {
        if (typeof depth === 'number') return depth;
        if (!depth) return 0;
        const text = String(depth).trim();
        const value = parseFloat(text);
        if (!Number.isFinite(value)) return 0;
        const unit = text.replace(/[-+0-9.,\s]/g, '').toLowerCase();
        if (unit.includes('m')) return Math.round(value * 1000000);
        if (unit.includes('k')) return Math.round(value * 1000);
        return Math.round(value);
    }

    function normalizeMemoryDepthLabel(depth) {
        const samples = parseMemoryDepth(depth);
        if (!samples) return null;
        if (samples <= 5000) return '4K';
        if (samples <= 9000) return '8K';
        if (samples % 1000000 === 0) return `${samples / 1000000}M`;
        if (samples % 1000 === 0) return `${samples / 1000}K`;
        return String(samples);
    }

    function updateMemoryDepthLabel(depth) {
        const label = normalizeMemoryDepthLabel(depth);
        if (!label) return;
        state.memoryDepthLabel = label;
        elements.btnCycleMem.textContent = `Mem: ${label}`;
    }

    function updateAcquisitionModeLabel(mode) {
        const normalized = String(mode || '').toUpperCase();
        if (normalized.includes('PEAK')) {
            acqModeIdx = ACQ_MODES.indexOf('PEAK');
            elements.btnCycleAcq.textContent = 'Acq: PEAK';
        } else if (normalized.includes('SAMP')) {
            acqModeIdx = ACQ_MODES.indexOf('SAMPle');
            elements.btnCycleAcq.textContent = 'Acq: SAMP';
        }
    }

    function getVisibleWaveformLength() {
        const lengths = [];
        if (state.waveforms.visible1 && state.waveforms.ch1.length) lengths.push(state.waveforms.ch1.length);
        if (state.waveforms.visible2 && state.waveforms.ch2.length) lengths.push(state.waveforms.ch2.length);
        return lengths.length ? Math.max(...lengths) : 0;
    }

    function formatSignedTime(seconds) {
        if (!Number.isFinite(seconds) || Math.abs(seconds) < 1e-15) return '0 s';
        const sign = seconds > 0 ? '+' : '-';
        const absVal = Math.abs(seconds);
        if (absVal < 1e-6) return `${sign}${(absVal * 1e9).toFixed(2)} ns`;
        if (absVal < 1e-3) return `${sign}${(absVal * 1e6).toFixed(2)} us`;
        if (absVal < 1) return `${sign}${(absVal * 1e3).toFixed(2)} ms`;
        return `${sign}${absVal.toFixed(2)} s`;
    }

    function countWaveformEdges(points) {
        if (!points || points.length < 2) return 0;
        let edges = 0;
        let prevHigh = points[0] >= 128;
        for (let i = 1; i < points.length; i++) {
            const high = points[i] >= 128;
            if (high !== prevHigh) edges++;
            prevHigh = high;
        }
        return edges;
    }

    function getWaveformColumnValues(points) {
        if (!points || points.length < 2) return [];
        if (points.length % 2 !== 0) return points;
        const cols = [];
        for (let i = 0; i < points.length; i += 2) {
            cols.push((points[i] + points[i + 1]) / 2);
        }
        return cols;
    }

    function getWaveformEdgeDivisions(points) {
        const cols = getWaveformColumnValues(points);
        if (cols.length < 2) return [];
        const edges = [];
        let prevHigh = cols[0] >= 128;
        for (let i = 1; i < cols.length; i++) {
            const high = cols[i] >= 128;
            if (high !== prevHigh) {
                edges.push((i / (cols.length - 1)) * 12);
            }
            prevHigh = high;
        }
        return edges;
    }

    function getHorizontalOffsetUnits() {
        return parseFloat(state.metadata?.TIMEBASE?.HOFFSET) || 0;
    }

    function getHorizontalOffsetDivisions(offsetUnits = getHorizontalOffsetUnits()) {
        return offsetUnits / 25.0;
    }

    function getHorizontalOffsetSeconds(offsetUnits = getHorizontalOffsetUnits()) {
        const timebase = parseTime(state.metadata?.TIMEBASE?.SCALE);
        if (timebase > 0) return getHorizontalOffsetDivisions(offsetUnits) * timebase;

        const sampleRate = parseSampleRate(state.metadata?.SAMPLE?.SAMPLERATE);
        if (sampleRate > 0) return offsetUnits / sampleRate;
        return 0;
    }

    function getViewportModel(preview = state.waveformDragPreview) {
        const timebase = parseTime(state.metadata?.TIMEBASE?.SCALE);
        const sampleRate = parseSampleRate(state.metadata?.SAMPLE?.SAMPLERATE);
        const memoryDepth = parseMemoryDepth(state.metadata?.SAMPLE?.DEPMEM || state.metadata?.SAMPLE?.DATALEN);
        const visibleLength = getVisibleWaveformLength();
        const viewportSamples = sampleRate > 0 && timebase > 0
            ? sampleRate * timebase * 12
            : Math.max(visibleLength, 300);
        const acquisitionSamples = Math.max(memoryDepth, visibleLength, 1);
        const halfViewport = Math.max(viewportSamples / 2, 1);
        const previewDeltaSamples = preview ? preview.offsetUnits - preview.startHoffset : 0;
        const triggerOffsetUnits = getHorizontalOffsetUnits() + previewDeltaSamples;
        const samplesPerDivision = viewportSamples / 12;
        const trigger = -getHorizontalOffsetDivisions(triggerOffsetUnits) * samplesPerDivision;

        let capHoffset = triggerOffsetUnits;
        let capTimebase = timebase;
        let capSampleRate = sampleRate;

        if (state.metadata?.RUNSTATUS === 'STOP') {
            if (state.waveforms.captureHoffset !== undefined) {
                capHoffset = state.waveforms.captureHoffset;
            }
            if (state.waveforms.captureTimebase !== undefined) {
                capTimebase = state.waveforms.captureTimebase;
            }
            if (state.waveforms.captureSampleRate !== undefined) {
                capSampleRate = state.waveforms.captureSampleRate;
            }
        }

        const captureOffsetSeconds = (capHoffset / 25.0) * capTimebase;
        const currentOffsetSeconds = (triggerOffsetUnits / 25.0) * timebase;
        const acquisitionCenterSeconds = captureOffsetSeconds - currentOffsetSeconds;
        const acquisitionCenterSamples = acquisitionCenterSeconds * sampleRate;

        const acquisitionSamplesCurrent = capSampleRate > 0
            ? (acquisitionSamples / capSampleRate) * sampleRate
            : acquisitionSamples;

        const acquisitionStart = acquisitionCenterSamples - acquisitionSamplesCurrent / 2;
        const acquisitionEnd = acquisitionCenterSamples + acquisitionSamplesCurrent / 2;

        const viewport = {
            start: -halfViewport,
            end: halfViewport
        };
        const acquisition = {
            start: acquisitionStart,
            end: acquisitionEnd
        };
        return { acquisition, viewport, trigger, viewportSamples, acquisitionSamples: acquisitionSamplesCurrent };
    }

    function drawViewportIndicator() {
        const c = elements.viewportIndicator;
        if (!c) return;
        const rect = c.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const width = Math.max(1, Math.round(rect.width * dpr));
        const height = Math.max(1, Math.round(rect.height * dpr));
        if (c.width !== width || c.height !== height) {
            c.width = width;
            c.height = height;
        }

        viewportCtx.save();
        viewportCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        viewportCtx.clearRect(0, 0, rect.width, rect.height);
        viewportCtx.fillStyle = 'rgba(255, 255, 255, 0.06)';
        viewportCtx.fillRect(0, 0, rect.width, rect.height);

        if (!state.metadata?.TIMEBASE) {
            viewportCtx.fillStyle = 'rgba(255,255,255,0.25)';
            viewportCtx.fillRect(8, rect.height / 2 - 1, rect.width - 16, 2);
            viewportCtx.restore();
            return;
        }

        const model = getViewportModel();
        const triggerOffscreen = model.trigger < model.viewport.start || model.trigger > model.viewport.end;
        const min = triggerOffscreen
            ? Math.min(model.viewport.start, model.trigger)
            : model.viewport.start;
        const max = triggerOffscreen
            ? Math.max(model.viewport.end, model.trigger)
            : model.viewport.end;
        const span = Math.max(max - min, 1);
        const pad = 6;
        const xFor = (value) => pad + ((value - min) / span) * (rect.width - pad * 2);
        const midY = Math.round(rect.height / 2) + 0.5;

        const vx = xFor(model.viewport.start);
        const vw = Math.max(2, xFor(model.viewport.end) - vx);
        viewportCtx.fillStyle = state.dragging === 'waveform_horiz' ? 'rgba(88,166,255,0.28)' : 'rgba(88,166,255,0.16)';
        viewportCtx.strokeStyle = '#58a6ff';
        viewportCtx.lineWidth = 1;
        viewportCtx.fillRect(vx, 4.5, vw, rect.height - 9);
        viewportCtx.strokeRect(vx, 4.5, vw, rect.height - 9);

        viewportCtx.strokeStyle = 'rgba(255,255,255,0.35)';
        viewportCtx.lineWidth = 2;
        viewportCtx.beginPath();
        viewportCtx.moveTo(xFor(model.acquisition.start), midY);
        viewportCtx.lineTo(xFor(model.acquisition.end), midY);
        viewportCtx.stroke();

        const tx = xFor(model.trigger);
        viewportCtx.strokeStyle = '#f85149';
        viewportCtx.lineWidth = 2;
        viewportCtx.beginPath();
        viewportCtx.moveTo(tx, 3);
        viewportCtx.lineTo(tx, rect.height - 3);
        viewportCtx.stroke();
        viewportCtx.fillStyle = '#f85149';
        viewportCtx.font = 'bold 8px JetBrains Mono, monospace';
        viewportCtx.textAlign = 'center';
        viewportCtx.textBaseline = 'top';
        viewportCtx.fillText('T', tx, 2);
        viewportCtx.restore();
    }

    function updateViewportToolbar() {
        if (elements.triggerOffsetReadout) {
            elements.triggerOffsetReadout.textContent = state.metadata?.TIMEBASE
                ? formatSignedTime(getHorizontalOffsetSeconds())
                : '0 s';
        }
        drawViewportIndicator();
    }

    function logHorizontalCalibration(label = 'horizontal') {
        const meta = state.metadata;
        if (!meta) return null;
        const snapshot = {
            label,
            timebaseOffset: meta.TIMEBASE?.HOFFSET,
            timebaseScale: meta.TIMEBASE?.SCALE,
            sampleRate: meta.SAMPLE?.SAMPLERATE,
            dataLen: meta.SAMPLE?.DATALEN,
            memoryDepth: meta.SAMPLE?.DEPMEM,
            visibleWaveformLength: getVisibleWaveformLength(),
            waveformEdges: {
                ch1: countWaveformEdges(state.waveforms.ch1),
                ch2: countWaveformEdges(state.waveforms.ch2)
            },
            waveformEdgeDivisions: {
                ch1: getWaveformEdgeDivisions(state.waveforms.ch1).slice(0, 24),
                ch2: getWaveformEdgeDivisions(state.waveforms.ch2).slice(0, 24)
            },
            parsed: {
                offsetSeconds: getHorizontalOffsetSeconds(),
                viewportSamples: parseSampleRate(meta.SAMPLE?.SAMPLERATE) * parseTime(meta.TIMEBASE?.SCALE) * 12,
                memorySamples: parseMemoryDepth(meta.SAMPLE?.DEPMEM || meta.SAMPLE?.DATALEN),
                offsetDivisions: getHorizontalOffsetDivisions()
            }
        };
        console.table(snapshot);
        return snapshot;
    }
    window.owonViewportDiagnostics = logHorizontalCalibration;

    function formatTime(seconds) {
        const absVal = Math.abs(seconds);
        let text = '';
        if (absVal === 0) {
            text = "0.00ps";
        } else if (absVal < 1e-9) {
            text = (seconds * 1e12).toFixed(1) + "ps";
        } else if (absVal < 1e-6) {
            text = (seconds * 1e9).toFixed(2) + "ns";
        } else if (absVal < 1e-3) {
            text = (seconds * 1e6).toFixed(2) + "us";
        } else if (absVal < 1) {
            text = (seconds * 1e3).toFixed(2) + "ms";
        } else {
            text = seconds.toFixed(2) + "s";
        }
        return "T: " + text;
    }

    function findClosestTimebaseIndex(scale) {
        const scaleSeconds = parseTime(scale);
        if (!scaleSeconds) return -1;

        let closestIdx = 0;
        let minDiff = Infinity;
        for (let i = 0; i < TIMEBASE_SCALES.length; i++) {
            const diff = Math.abs(parseTime(TIMEBASE_SCALES[i]) - scaleSeconds);
            if (diff < minDiff) {
                minDiff = diff;
                closestIdx = i;
            }
        }
        return closestIdx;
    }

    function findClosestVoltageScaleIndex(scale) {
        const scaleVolts = parseVoltage(scale);
        if (!scaleVolts) return -1;

        let closestIdx = 0;
        let minDiff = Infinity;
        for (let i = 0; i < VOLTAGE_SCALES.length; i++) {
            const diff = Math.abs(parseVoltage(VOLTAGE_SCALES[i]) - scaleVolts);
            if (diff < minDiff) {
                minDiff = diff;
                closestIdx = i;
            }
        }
        return closestIdx;
    }

    async function setVerticalScale(chIdx, nextScale, logPrefix = 'Setting vertical scale to') {
        if (!state.metadata?.CHANNEL?.[chIdx]) return;

        const currentScale = state.metadata.CHANNEL[chIdx].SCALE;
        if (currentScale && parseVoltage(currentScale) === parseVoltage(nextScale)) return;

        const chNum = chIdx + 1;
        const scaleVolts = parseVoltage(nextScale);
        appendTerminal(`${logPrefix} CH${chNum} ${nextScale}`, 'system');
        state.metadata.CHANNEL[chIdx].SCALE = nextScale;
        state.pendingVerticalScales[chIdx] = {
            label: nextScale,
            volts: scaleVolts,
            expires: Date.now() + 3000
        };
        drawScope();

        await sendCommand(`:CH${chNum}:SCALe ${scaleVolts.toFixed(2)}`);
        await sendCommand(`:CH${chNum}:SCALe?`);
        await new Promise(r => setTimeout(r, 150));
        await fetchWaveform();
    }

    async function setTimebaseScale(nextScale, logPrefix = 'Setting Timebase Scale to') {
        if (!state.metadata?.TIMEBASE) return;

        const currentScale = state.metadata.TIMEBASE.SCALE;
        if (currentScale && parseTime(currentScale) === parseTime(nextScale)) return;

        const wasStopped = state.metadata?.RUNSTATUS === 'STOP';

        appendTerminal(`${logPrefix} ${nextScale}`, 'system');
        state.metadata.TIMEBASE.SCALE = nextScale;
        state.pendingTimebaseScale = {
            label: nextScale,
            seconds: parseTime(nextScale),
            expires: Date.now() + 3000,
            wasStopped: wasStopped,
            sentAt: Date.now()
        };
        drawScope();

        await sendCommand(`:HORIzontal:SCALe ${nextScale}`);
        await sendCommand(':HORIzontal:SCALe?');
        await new Promise(r => setTimeout(r, 150));
        await fetchWaveform();
    }

    function getGridConfig(w, h) {
        const marginTop = 22;
        const marginBottom = 25; // Grid terminates right above the status HUD
        const marginX = 20;
        const availableWidth = Math.max(0, w - marginX * 2);
        const availableHeight = Math.max(0, h - marginTop - marginBottom);
        const divisionSize = Math.min(availableWidth / 12, availableHeight / 8);
        const gridWidth = divisionSize * 12;
        const gridHeight = divisionSize * 8;
        const left = marginX + (availableWidth - gridWidth) / 2;
        const top = marginTop + (availableHeight - gridHeight) / 2;
        const right = left + gridWidth;
        const bottom = top + gridHeight;

        return {
            left, top, right, bottom,
            width: right - left,
            height: bottom - top,
            centerX: left + (right - left) / 2,
            centerY: top + (bottom - top) / 2
        };
    }

    function getTriggerPixelCoords(g, hOffsetOverride = null) {
        const fallback = { x: g.centerX, y: g.centerY };
        if (!state.metadata) return fallback;

        let tx = g.centerX;
        if (state.metadata.TIMEBASE) {
            const hoffset = hOffsetOverride ?? (parseFloat(state.metadata.TIMEBASE.HOFFSET) || 0);
            const dx = g.width / 12;
            const pixelsPerUnitX = dx / 25.0;
            tx = g.centerX - (hoffset * pixelsPerUnitX);
        }

        let ty = g.centerY;
        if (state.metadata.Trig && state.metadata.Trig.Items) {
            const tItems = state.metadata.Trig.Items;
            const trigChan = tItems.Channel || 'CH1';
            let chMeta = null;
            if (state.metadata.CHANNEL) {
                if (trigChan === 'CH1') chMeta = state.metadata.CHANNEL[0];
                else if (trigChan === 'CH2') chMeta = state.metadata.CHANNEL[1];
            }

            if (chMeta) {
                const dy = g.height / 8;
                const offsetUnits = chMeta.OFFSET || 0;
                const scaleVal = parseVoltage(chMeta.SCALE);
                const levelVal = parseVoltage(tItems.Level);

                if (scaleVal !== 0) {
                    ty = g.centerY - ((offsetUnits / 25.0) + (levelVal / scaleVal)) * dy;
                }
            }
        }
        if (isNaN(ty)) ty = g.centerY;
        if (isNaN(tx)) tx = g.centerX;
        return { x: tx, y: ty };
    }

    function drawOffscreenTriggerCue(g, side) {
        const label = side === 'left' ? 'T<-' : '->T';
        const x = side === 'left' ? g.left + 5 : g.right - 5;
        ctx.fillStyle = '#ff3a3a';
        ctx.font = 'bold 12px JetBrains Mono, monospace';
        ctx.textAlign = side === 'left' ? 'left' : 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(label, x, g.top + 4);
    }

    function drawTriggerMarkers(g, hOffsetOverride = null, alpha = 1) {
        if (!state.isConnected || !state.metadata) return;

        ctx.save();
        ctx.globalAlpha *= alpha;
        const coords = getTriggerPixelCoords(g, hOffsetOverride);

        // 1. Draw Top Red Marker (Horizontal Trigger Position)
        const markerX = coords.x;
        if (markerX >= g.left && markerX <= g.right) {
            ctx.fillStyle = '#ff3a3a';
            ctx.beginPath();
            ctx.moveTo(markerX - 8, g.top - 16);
            ctx.lineTo(markerX + 8, g.top - 16);
            ctx.lineTo(markerX + 8, g.top - 6);
            ctx.lineTo(markerX, g.top); // Pointy tip touches the top border of the grid
            ctx.lineTo(markerX - 8, g.top - 6);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('T', markerX, g.top - 11);
        } else {
            drawOffscreenTriggerCue(g, markerX < g.left ? 'left' : 'right');
        }

        // 2. Draw Right Marker (Vertical Trigger Level)
        const markerY = coords.y;
        if (markerY >= g.top - 10 && markerY <= g.bottom + 10) {
            const trigChan = (state.metadata.Trig && state.metadata.Trig.Items && state.metadata.Trig.Items.Channel) || 'CH1';
            const color = trigChan === 'CH2' ? '#00f2fe' : '#ffec00';

            // Faint alignment helper dotted line across grid viewport
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(g.left, markerY);
            ctx.lineTo(g.right, markerY);
            ctx.stroke();
            ctx.setLineDash([]);

            // Pointer Arrow pointing LEFT, positioned OUTSIDE the right grid border
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(g.right, markerY); // Tip touches the right grid border
            ctx.lineTo(g.right + 14, markerY - 8); // Base anchored 14px into margin
            ctx.lineTo(g.right + 14, markerY + 8);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = '#000000';
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('T', g.right + 8, markerY);
        }
        ctx.restore();
    }

    // --- Cursor Helper Functions ---
    
    // Convert Vertical Cursor Time offset (seconds relative to trigger) to Screen X
    function getXForTime(g, time) {
        const scaleStr = state.metadata?.TIMEBASE?.SCALE || '1ms';
        const timebase = parseTime(scaleStr) || 0.001;
        
        const preview = state.waveformDragPreview;
        const hOffsetOverride = preview ? preview.offsetUnits : null;
        const coords = getTriggerPixelCoords(g, hOffsetOverride);
        
        const pixelsPerSecond = g.width / (12 * timebase);
        return coords.x + time * pixelsPerSecond;
    }

    // Convert Screen X to Vertical Cursor Time offset (seconds relative to trigger)
    function getTimeForX(g, x) {
        const scaleStr = state.metadata?.TIMEBASE?.SCALE || '1ms';
        const timebase = parseTime(scaleStr) || 0.001;
        
        const preview = state.waveformDragPreview;
        const hOffsetOverride = preview ? preview.offsetUnits : null;
        const coords = getTriggerPixelCoords(g, hOffsetOverride);
        
        const pixelsPerSecond = g.width / (12 * timebase);
        return (x - coords.x) / pixelsPerSecond;
    }

    // Get vertical scale and offset for selected cursor source
    function getSelectedChannelScaleOffset() {
        if (!state.metadata || !state.metadata.CHANNEL) {
            return { scale: 1.0, offset: 0 };
        }
        const chIdx = state.cursors.source === 'CH2' ? 1 : 0;
        const ch = state.metadata.CHANNEL[chIdx];
        if (!ch) return { scale: 1.0, offset: 0 };
        
        const scaleVal = parseVoltage(ch.SCALE) || 1.0;
        
        // Account for active vertical offset dragging
        let offset = ch.OFFSET || 0;
        if (state.dragging === `offset_ch${chIdx + 1}` && state.dragOffsetVal !== undefined) {
            offset = state.dragOffsetVal;
        } else if (state.pendingOffset && state.pendingOffset.chIdx === chIdx) {
            offset = state.pendingOffset.val;
        }
        
        return { scale: scaleVal, offset: offset };
    }

    // Convert Horizontal Cursor Voltage to Screen Y
    function getYForVoltage(g, voltage) {
        const { scale, offset } = getSelectedChannelScaleOffset();
        const dy = g.height / 8;
        const divisions = (offset / 25.0) + (voltage / scale);
        return g.centerY - divisions * dy;
    }

    // Convert Screen Y to Horizontal Cursor Voltage
    function getVoltageForY(g, y) {
        const { scale, offset } = getSelectedChannelScaleOffset();
        const dy = g.height / 8;
        if (dy <= 0) return 0;
        
        const divisions = (g.centerY - y) / dy;
        return (divisions - (offset / 25.0)) * scale;
    }

    // Locate edge columns in active channel's waveform
    function getWaveformEdges() {
        const source = state.cursors.source;
        const points = source === 'CH2' ? state.waveforms.ch2 : state.waveforms.ch1;
        const visible = source === 'CH2' ? state.waveforms.visible2 : state.waveforms.visible1;
        
        if (!visible || !points || points.length < 2) return { edgeIndices: [], columnCount: 0 };
        
        const laneCount = getInterleavedWaveformLaneCount(points);
        const columnCount = Math.ceil(points.length / laneCount);
        
        // Average the interleaved lanes for each column
        const cols = [];
        for (let i = 0; i < columnCount; i++) {
            let sum = 0;
            let cnt = 0;
            for (let lane = 0; lane < laneCount; lane++) {
                const val = points[lane + i * laneCount];
                if (Number.isFinite(val)) {
                    sum += val;
                    cnt++;
                }
            }
            cols.push(cnt > 0 ? sum / cnt : 128);
        }
        
        // Calculate absolute derivative
        const diffs = [];
        for (let i = 1; i < cols.length; i++) {
            diffs.push(Math.abs(cols[i] - cols[i - 1]));
        }
        
        // Find local maxima of derivatives above threshold
        const threshold = 6;
        const edgeIndices = [];
        for (let i = 1; i < diffs.length - 1; i++) {
            if (diffs[i] > threshold && diffs[i] >= diffs[i - 1] && diffs[i] >= diffs[i + 1]) {
                edgeIndices.push(i);
            }
        }
        return { edgeIndices, columnCount };
    }

    // Calculate snapped screen X using magnetic pull to closest grid line or waveform edge
    function getSnappedX(g, rawX) {
        if (!state.cursors.snapEnabled) return rawX;
        
        let closestTarget = rawX;
        let minDistance = Infinity;
        
        // 1. Check grid lines (12 divisions)
        const dx = g.width / 12;
        const iGrid = Math.round((rawX - g.left) / dx);
        if (iGrid >= 0 && iGrid <= 12) {
            const gridX = g.left + iGrid * dx;
            const dist = Math.abs(rawX - gridX);
            if (dist < minDistance) {
                minDistance = dist;
                closestTarget = gridX;
            }
        }
        
        // 2. Check waveform edges (if source has data)
        const edgesInfo = getWaveformEdges();
        if (edgesInfo && edgesInfo.edgeIndices && edgesInfo.edgeIndices.length > 0) {
            const { edgeIndices, columnCount } = edgesInfo;
            const stepX = columnCount > 1 ? g.width / (columnCount - 1) : 0;
            if (stepX > 0) {
                for (let idx of edgeIndices) {
                    const edgeX = g.left + idx * stepX;
                    const dist = Math.abs(rawX - edgeX);
                    if (dist < minDistance) {
                        minDistance = dist;
                        closestTarget = edgeX;
                    }
                }
            }
        }
        
        // Apply magnetic pull formula (deadband 15 pixels)
        const snapRadius = 15;
        if (minDistance < snapRadius) {
            const pull = Math.pow(minDistance / snapRadius, 2);
            return closestTarget + (rawX - closestTarget) * pull;
        }
        
        return rawX;
    }

    // Calculate snapped screen Y using magnetic pull to horizontal grid lines
    function getSnappedY(g, rawY) {
        if (!state.cursors.snapEnabled) return rawY;
        
        const dy = g.height / 8;
        const jGrid = Math.round((rawY - g.top) / dy);
        if (jGrid >= 0 && jGrid <= 8) {
            const gridY = g.top + jGrid * dy;
            const dist = Math.abs(rawY - gridY);
            
            const snapRadius = 15;
            if (dist < snapRadius) {
                const pull = Math.pow(dist / snapRadius, 2);
                return gridY + (rawY - gridY) * pull;
            }
        }
        
        return rawY;
    }

    // Lookup waveform voltage at time T
    function getWaveformVoltageAtTime(g, time) {
        const source = state.cursors.source;
        const points = source === 'CH2' ? state.waveforms.ch2 : state.waveforms.ch1;
        const visible = source === 'CH2' ? state.waveforms.visible2 : state.waveforms.visible1;
        
        if (!visible || !points || points.length === 0) return null;
        
        const xCursor = getXForTime(g, time);
        
        const laneCount = getInterleavedWaveformLaneCount(points);
        const columnCount = Math.ceil(points.length / laneCount);
        
        const stepX = columnCount > 1 ? g.width / (columnCount - 1) : 0;
        if (stepX <= 0) return null;
        
        const i = Math.round((xCursor - g.left) / stepX);
        
        // Ensure index is within visible acquisition range
        const { iStart, iEnd } = getWaveformIndices(columnCount);
        if (i < iStart || i > iEnd || i < 0 || i >= columnCount) return null;
        
        // Average lanes at column index i
        let sum = 0;
        let cnt = 0;
        for (let lane = 0; lane < laneCount; lane++) {
            const val = points[lane + i * laneCount];
            if (Number.isFinite(val)) {
                sum += val;
                cnt++;
            }
        }
        if (cnt === 0) return null;
        const sampleVal = sum / cnt;
        
        // Convert to voltage relative to 0V baseline
        const { scale, offset } = getSelectedChannelScaleOffset();
        return scale * ((sampleVal - 128 - offset) / 25.0);
    }

    // Format voltage with scale and sign
    function formatCursorVoltage(volts) {
        if (!Number.isFinite(volts)) return '--';
        const absV = Math.abs(volts);
        const sign = volts < 0 ? '-' : '';
        if (absV < 1.0) {
            return `${sign}${(absV * 1000).toFixed(1)} mV`;
        }
        return `${sign}${volts.toFixed(3)} V`;
    }

    // Format time with scale and sign
    function formatCursorTime(seconds) {
        if (!Number.isFinite(seconds)) return '--';
        const absT = Math.abs(seconds);
        const sign = seconds < 0 ? '-' : '';
        if (absT < 1e-6) {
            return `${sign}${(absT * 1e9).toFixed(1)} ns`;
        }
        if (absT < 1e-3) {
            return `${sign}${(absT * 1e6).toFixed(1)} us`;
        }
        if (absT < 1.0) {
            return `${sign}${(absT * 1000).toFixed(3)} ms`;
        }
        return `${sign}${seconds.toFixed(3)} s`;
    }

    // Update the Cursors control panel readout
    function updateCursorsReadout(g) {
        if (!elements.cursorValT1) return;
        
        const t1 = state.cursors.t1;
        const t2 = state.cursors.t2;
        const dt = t2 - t1;
        const freq = dt !== 0 ? 1.0 / Math.abs(dt) : null;
        
        const v1 = state.cursors.v1;
        const v2 = state.cursors.v2;
        const dv = v2 - v1;
        
        const vt1 = getWaveformVoltageAtTime(g, t1);
        const vt2 = getWaveformVoltageAtTime(g, t2);
        
        elements.cursorValT1.innerText = state.cursors.t1Enabled ? formatCursorTime(t1) : '--';
        elements.cursorValT2.innerText = state.cursors.t2Enabled ? formatCursorTime(t2) : '--';
        elements.cursorValDt.innerText = (state.cursors.t1Enabled && state.cursors.t2Enabled) ? formatCursorTime(dt) : '--';
        elements.cursorValFreq.innerText = (state.cursors.t1Enabled && state.cursors.t2Enabled && freq !== null) ? (freq >= 1000 ? `${(freq / 1000).toFixed(2)} kHz` : `${freq.toFixed(1)} Hz`) : '--';
        
        elements.cursorValV1.innerText = state.cursors.v1Enabled ? formatCursorVoltage(v1) : '--';
        elements.cursorValV2.innerText = state.cursors.v2Enabled ? formatCursorVoltage(v2) : '--';
        elements.cursorValDv.innerText = (state.cursors.v1Enabled && state.cursors.v2Enabled) ? formatCursorVoltage(dv) : '--';
        
        elements.cursorValVt1.innerText = (state.cursors.t1Enabled && vt1 !== null) ? formatCursorVoltage(vt1) : '--';
        elements.cursorValVt2.innerText = (state.cursors.t2Enabled && vt2 !== null) ? formatCursorVoltage(vt2) : '--';
    }

    // Draw cursors floating HUD on canvas
    function drawCursorsHud(g) {
        const lines = [];
        
        const t1 = state.cursors.t1;
        const t2 = state.cursors.t2;
        const dt = t2 - t1;
        const freq = dt !== 0 ? 1.0 / Math.abs(dt) : null;
        
        const v1 = state.cursors.v1;
        const v2 = state.cursors.v2;
        const dv = v2 - v1;
        
        const vt1 = getWaveformVoltageAtTime(g, t1);
        const vt2 = getWaveformVoltageAtTime(g, t2);
        
        if (state.cursors.t1Enabled) {
            lines.push({ label: 'T1', val: formatCursorTime(t1), color: '#ff2e93' });
        }
        if (state.cursors.t2Enabled) {
            lines.push({ label: 'T2', val: formatCursorTime(t2), color: '#ff2e93' });
        }
        if (state.cursors.t1Enabled && state.cursors.t2Enabled) {
            lines.push({ label: 'dT', val: formatCursorTime(dt), color: '#ffffff' });
            lines.push({ label: '1/dT', val: freq !== null ? (freq >= 1000 ? `${(freq / 1000).toFixed(2)} kHz` : `${freq.toFixed(1)} Hz`) : '--', color: '#ffffff' });
        }
        
        if (state.cursors.v1Enabled) {
            lines.push({ label: 'V1', val: formatCursorVoltage(v1), color: '#00ff66' });
        }
        if (state.cursors.v2Enabled) {
            lines.push({ label: 'V2', val: formatCursorVoltage(v2), color: '#00ff66' });
        }
        if (state.cursors.v1Enabled && state.cursors.v2Enabled) {
            lines.push({ label: 'dV', val: formatCursorVoltage(dv), color: '#ffffff' });
        }
        
        if (state.cursors.t1Enabled && vt1 !== null) {
            lines.push({ label: 'V(T1)', val: formatCursorVoltage(vt1), color: 'var(--ch1-color)' });
        }
        if (state.cursors.t2Enabled && vt2 !== null) {
            lines.push({ label: 'V(T2)', val: formatCursorVoltage(vt2), color: 'var(--ch1-color)' });
        }
        
        if (lines.length === 0) return;
        
        ctx.save();
        
        const padding = 10;
        const boxWidth = 190;
        const rowHeight = 16;
        const boxHeight = lines.length * rowHeight + padding * 2;
        const x = g.right - boxWidth - 10;
        const y = g.top + 10;
        
        ctx.fillStyle = 'rgba(13, 17, 23, 0.82)';
        ctx.strokeStyle = 'rgba(48, 54, 61, 0.8)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x, y, boxWidth, boxHeight, 6);
        ctx.fill();
        ctx.stroke();
        
        ctx.font = '11px JetBrains Mono, monospace';
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        
        lines.forEach((line, idx) => {
            const lineY = y + padding + idx * rowHeight;
            ctx.fillStyle = '#8b949e';
            ctx.fillText(line.label + ':', x + padding, lineY);
            
            ctx.fillStyle = line.color;
            ctx.textAlign = 'right';
            ctx.fillText(line.val, x + boxWidth - padding, lineY);
            ctx.textAlign = 'left';
        });
        
        ctx.restore();
    }

    // Draw cursor lines and handles
    function drawCursors(g) {
        const anyEnabled = state.cursors.t1Enabled || state.cursors.t2Enabled || state.cursors.v1Enabled || state.cursors.v2Enabled;
        if (!anyEnabled) return;
        
        ctx.save();
        
        const x1 = getXForTime(g, state.cursors.t1);
        const x2 = getXForTime(g, state.cursors.t2);
        
        const drawVCursor = (x, label, color) => {
            if (x >= g.left && x <= g.right) {
                ctx.strokeStyle = color;
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(x, g.top);
                ctx.lineTo(x, g.bottom);
                ctx.stroke();
                ctx.setLineDash([]);
                
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.moveTo(x - 12, g.top);
                ctx.lineTo(x + 12, g.top);
                ctx.lineTo(x + 12, g.top + 14);
                ctx.lineTo(x, g.top + 20);
                ctx.lineTo(x - 12, g.top + 14);
                ctx.closePath();
                ctx.fill();
                
                ctx.fillStyle = '#000000';
                ctx.font = 'bold 9px monospace';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(label, x, g.top + 9);
            }
        };
        
        if (state.cursors.t1Enabled) drawVCursor(x1, 'T1', '#ff2e93');
        if (state.cursors.t2Enabled) drawVCursor(x2, 'T2', '#ff2e93');
        
        const y1 = getYForVoltage(g, state.cursors.v1);
        const y2 = getYForVoltage(g, state.cursors.v2);
        
        const drawHCursor = (y, label, color) => {
            if (y >= g.top && y <= g.bottom) {
                ctx.strokeStyle = color;
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(g.left, y);
                ctx.lineTo(g.right, y);
                ctx.stroke();
                ctx.setLineDash([]);
                
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.moveTo(g.left, y - 10);
                ctx.lineTo(g.left - 20, y - 10);
                ctx.lineTo(g.left - 24, y);
                ctx.lineTo(g.left - 20, y + 10);
                ctx.lineTo(g.left, y + 10);
                ctx.closePath();
                ctx.fill();
                
                ctx.fillStyle = '#000000';
                ctx.font = 'bold 9px monospace';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(label, g.left - 12, y);
            }
        };
        
        if (state.cursors.v1Enabled) drawHCursor(y1, 'V1', '#00ff66');
        if (state.cursors.v2Enabled) drawHCursor(y2, 'V2', '#00ff66');
        
        drawCursorsHud(g);
        
        ctx.restore();
    }

    function drawScope() {
        const w = elements.canvas.width;
        const h = elements.canvas.height;

        // Calculate Grid geometry based on canvas dimensions
        const g = getGridConfig(w, h);

        // Clear viewport
        ctx.fillStyle = '#040608';
        ctx.fillRect(0, 0, w, h);

        // Draw scaled grid divisions inside the Grid Box
        drawGrid(g, w, h);

        // Clear expired pending offsets or ones that hardware has caught up to
        if (state.pendingOffset) {
            const chMeta = state.metadata?.CHANNEL?.[state.pendingOffset.chIdx];
            if (Date.now() > state.pendingOffset.expires || (chMeta && Math.abs(chMeta.OFFSET - state.pendingOffset.val) < 2)) {
                state.pendingOffset = null;
            }
        }
        if (state.pendingTriggerLevel && Date.now() > state.pendingTriggerLevel.expires) {
            state.pendingTriggerLevel = null;
        }

        // Draw zero-level line indicators from hardware offsets (or local drag offset)
        if (state.isConnected && state.metadata && state.metadata.CHANNEL) {
            const ch1Meta = state.metadata.CHANNEL[0];
            const ch2Meta = state.metadata.CHANNEL[1];

            if (state.waveforms.visible1 && ch1Meta) {
                let offset1 = ch1Meta.OFFSET;
                if (state.dragging === 'offset_ch1' && state.dragOffsetVal !== undefined) offset1 = state.dragOffsetVal;
                else if (state.pendingOffset && state.pendingOffset.chIdx === 0) offset1 = state.pendingOffset.val;

                drawZeroIndicator(0, offset1, '#ffec00', g);
            }
            if (state.waveforms.visible2 && ch2Meta) {
                let offset2 = ch2Meta.OFFSET;
                if (state.dragging === 'offset_ch2' && state.dragOffsetVal !== undefined) offset2 = state.dragOffsetVal;
                else if (state.pendingOffset && state.pendingOffset.chIdx === 1) offset2 = state.pendingOffset.val;

                drawZeroIndicator(1, offset2, '#00f2fe', g);
            }
        }

        // Draw trace signals
        const dy = g.height / 8;
        const pixelsPerUnit = dy / 25.0;

        if (state.waveforms.visible1 && state.waveforms.ch1.length > 0) {
            let baseShiftUnits = 0;
            const deviceOffset = state.metadata.CHANNEL[0]?.OFFSET || 0;
            if (state.metadata.RUNSTATUS === 'STOP' && state.waveforms.ch1CaptureOffset !== undefined) {
                baseShiftUnits = deviceOffset - state.waveforms.ch1CaptureOffset;
            }
            drawWaveform(state.waveforms.ch1, '#ffec00', g, baseShiftUnits); // Real hardware waveform

            let ghostOffset = undefined;
            if (state.dragging === 'offset_ch1' && state.dragOffsetVal !== undefined) ghostOffset = state.dragOffsetVal;
            else if (state.pendingOffset && state.pendingOffset.chIdx === 0) ghostOffset = state.pendingOffset.val;

            if (ghostOffset !== undefined) {
                const anchorOffset = (state.metadata.RUNSTATUS === 'STOP') ? state.waveforms.ch1CaptureOffset : deviceOffset;
                const ghostShiftUnits = ghostOffset - anchorOffset;
                if (Math.abs(ghostOffset - deviceOffset) > 2) {
                    ctx.globalAlpha = 0.5;
                    drawWaveform(state.waveforms.ch1, '#ffec00', g, ghostShiftUnits); // Ghost
                    ctx.globalAlpha = 1.0;
                }
            }
        }
        if (state.waveforms.visible2 && state.waveforms.ch2.length > 0) {
            let baseShiftUnits = 0;
            const deviceOffset = state.metadata.CHANNEL[1]?.OFFSET || 0;
            if (state.metadata.RUNSTATUS === 'STOP' && state.waveforms.ch2CaptureOffset !== undefined) {
                baseShiftUnits = deviceOffset - state.waveforms.ch2CaptureOffset;
            }
            drawWaveform(state.waveforms.ch2, '#00f2fe', g, baseShiftUnits); // Real hardware waveform

            let ghostOffset = undefined;
            if (state.dragging === 'offset_ch2' && state.dragOffsetVal !== undefined) ghostOffset = state.dragOffsetVal;
            else if (state.pendingOffset && state.pendingOffset.chIdx === 1) ghostOffset = state.pendingOffset.val;

            if (ghostOffset !== undefined) {
                const anchorOffset = (state.metadata.RUNSTATUS === 'STOP') ? state.waveforms.ch2CaptureOffset : deviceOffset;
                const ghostShiftUnits = ghostOffset - anchorOffset;
                if (Math.abs(ghostOffset - deviceOffset) > 2) {
                    ctx.globalAlpha = 0.5;
                    drawWaveform(state.waveforms.ch2, '#00f2fe', g, ghostShiftUnits); // Ghost
                    ctx.globalAlpha = 1.0;
                }
            }
        }

        if (state.dragging === 'waveform_horiz' && state.waveformDragPreview) {
            const preview = state.waveformDragPreview;
            if (state.waveforms.visible1 && state.waveforms.ch1.length > 0) {
                ctx.globalAlpha = 0.42;
                drawWaveform(state.waveforms.ch1, '#ffec00', g, 0, preview.deltaPx);
                ctx.globalAlpha = 1.0;
            }
            if (state.waveforms.visible2 && state.waveforms.ch2.length > 0) {
                ctx.globalAlpha = 0.42;
                drawWaveform(state.waveforms.ch2, '#00f2fe', g, 0, preview.deltaPx);
                ctx.globalAlpha = 1.0;
            }
        }

        // Draw Cursors
        drawCursors(g);

        // Update Cursors Readout
        updateCursorsReadout(g);

        // Draw Screen Overlays (Status Bar style)
        if (state.isConnected && state.metadata) {
            ctx.font = '12px JetBrains Mono, Outfit, monospace';
            ctx.textBaseline = 'bottom';
            ctx.textAlign = 'left';
            ctx.shadowBlur = 0;

            // Bottom HUD background overlay for readability
            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.fillRect(0, h - 25, w, 25);

            state.hudRects = [];
            const hudY = h - 25;
            const hudH = 25;
            const textY = h - 7;
            let curX = 15;

            function drawHudItem(id, text, color, pushRect) {
                ctx.fillStyle = color;
                ctx.fillText(text, curX, textY);
                const tw = ctx.measureText(text).width;
                if (pushRect) {
                    state.hudRects.push({ id, x: curX, y: hudY, w: tw, h: hudH });
                }
                curX += tw;
            }

            // Left side: Channels scale
            if (state.metadata.CHANNEL && state.metadata.CHANNEL[0]) {
                const ch1 = state.metadata.CHANNEL[0];
                const color = '#ffec00';
                drawHudItem('ch1_label', '[1] ', color, false);
                drawHudItem('ch1_scale', `${ch1.SCALE || '-'}`, color, true);
                drawHudItem('ch1_space', ' ', color, false);
                drawHudItem('ch1_coupling', `${ch1.COUPLING || ''}`, color, true);
                drawHudItem('ch1_space2', ' ', color, false);
                drawHudItem('ch1_probe', `${ch1.PROBE || '1X'}`, color, true);
                curX = 15 + 160;
            }
            if (state.metadata.CHANNEL && state.metadata.CHANNEL[1]) {
                const ch2 = state.metadata.CHANNEL[1];
                const color = '#00f2fe';
                drawHudItem('ch2_label', '[2] ', color, false);
                drawHudItem('ch2_scale', `${ch2.SCALE || '-'}`, color, true);
                drawHudItem('ch2_space', ' ', color, false);
                drawHudItem('ch2_coupling', `${ch2.COUPLING || ''}`, color, true);
                drawHudItem('ch2_space2', ' ', color, false);
                drawHudItem('ch2_probe', `${ch2.PROBE || '10X'}`, color, true);
                curX = 15 + 160 + 160;
            }

            // Center side: Timebase Scale
            if (state.metadata.TIMEBASE) {
                drawHudItem('tb_label', 'M: ', '#ffffff', false);
                drawHudItem('timebase', `${state.metadata.TIMEBASE.SCALE || '-'}`, '#ffffff', true);
                curX = 15 + 140 + 140 + 120;
            }

            // Center-right side: Sample Rate
            if (state.metadata.SAMPLE && state.metadata.SAMPLE.SAMPLERATE) {
                drawHudItem('sr', `SR: ${state.metadata.SAMPLE.SAMPLERATE}`, 'rgba(255, 255, 255, 0.5)', false);
            }

            // Right side: Trigger Level & Edge Info & Sweep & Coupling
            if (state.metadata.Trig && state.metadata.Trig.Items) {
                const t = state.metadata.Trig.Items;
                const color = '#ffa500';

                const prefix = `T: `;
                const chanText = `${t.Channel || ''}`;
                const arrowText = ` ${t.Edge === 'RISe' ? '↑' : '↓'} `;
                const levelText = `${t.Level || ''} `;

                const sweepText = `[${state.trigSweep || 'AUTO'}] `;
                const coupText = `[${state.trigCoupling || 'DC'}]`;

                const wPrefix = ctx.measureText(prefix).width;
                const wChan = ctx.measureText(chanText).width;
                const wArrow = ctx.measureText(arrowText).width;
                const wLevel = ctx.measureText(levelText).width;
                const wSweep = ctx.measureText(sweepText).width;
                const wCoup = ctx.measureText(coupText).width;

                const totalWidth = wPrefix + wChan + wArrow + wLevel + wSweep + wCoup;
                let rx = w - 15 - totalWidth;

                ctx.fillStyle = color;
                ctx.fillText(prefix, rx, textY);
                rx += wPrefix;

                ctx.fillText(chanText, rx, textY);
                state.hudRects.push({ id: 'trig_channel', x: rx, y: hudY, w: wChan, h: hudH });
                rx += wChan;

                ctx.fillText(arrowText, rx, textY);
                state.hudRects.push({ id: 'trig_edge', x: rx, y: hudY, w: wArrow, h: hudH });
                rx += wArrow;

                ctx.fillText(levelText, rx, textY);
                rx += wLevel;

                ctx.fillText(sweepText, rx, textY);
                state.hudRects.push({ id: 'trig_sweep', x: rx, y: hudY, w: wSweep, h: hudH });
                rx += wSweep;

                ctx.fillText(coupText, rx, textY);
                state.hudRects.push({ id: 'trig_coupling', x: rx, y: hudY, w: wCoup, h: hudH });
            }

            // Draw dynamic frequency text in top corner if available
            if (state.metadata.CHANNEL && state.metadata.CHANNEL[0] && state.metadata.CHANNEL[0].DISPLAY === 'ON') {
                const freq = state.metadata.CHANNEL[0].FREQUENCE;
                if (freq && freq > 0) {
                    ctx.fillStyle = 'rgba(255, 236, 0, 0.8)';
                    ctx.font = 'bold 13px JetBrains Mono';
                    ctx.textBaseline = 'top';

                    let freqStr = freq < 1000 ? `${freq.toFixed(1)} Hz` : `${(freq / 1000).toFixed(2)} kHz`;
                    ctx.fillText(` Freq(1): ${freqStr}`, 15, 10);
                }
            }
        }

        // Draw real-time interactive trigger markers using the grid config
        drawTriggerMarkers(g);
        if (state.dragging === 'waveform_horiz' && state.waveformDragPreview) {
            drawTriggerMarkers(g, state.waveformDragPreview.offsetUnits, 0.72);
        }
        updateViewportToolbar();
    }



    // --- Event Bindings ---
    elements.connectBtn.addEventListener('click', connectDevice);
    elements.disconnectBtn.addEventListener('click', disconnectDevice);

    // Raw Send Action Form
    elements.terminalForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const cmd = elements.terminalInput.value.trim();
        if (!cmd) return;

        elements.terminalInput.value = '';
        await sendCommand(cmd, false);
    });

    // Dynamic command attributes mapping
    document.querySelectorAll('.scpi-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const cmd = btn.getAttribute('data-cmd');
            if (cmd) {
                await sendCommand(cmd);
                if (state.isConnected) {
                    await new Promise(r => setTimeout(r, 150));
                    await fetchWaveform();
                }
            }
        });
    });

    // Templates (like :HORIzontal:SCALe {{value}})
    document.querySelectorAll('select[data-cmd-template]').forEach(sel => {
        sel.addEventListener('change', async () => {
            const template = sel.getAttribute('data-cmd-template');
            const val = sel.value;
            if (val) {
                const finalCmd = template.replace('{{value}}', val);
                await sendCommand(finalCmd);
                if (state.isConnected) {
                    await new Promise(r => setTimeout(r, 150));
                    await fetchWaveform();
                }
            }
        });
    });

    document.querySelectorAll('.scpi-template-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const template = btn.getAttribute('data-template');
            const sourceId = btn.getAttribute('data-source');
            const input = document.getElementById(sourceId);
            if (input && input.value.trim()) {
                const finalCmd = template.replace('{{value}}', input.value.trim());
                await sendCommand(finalCmd);
                if (state.isConnected) {
                    await new Promise(r => setTimeout(r, 150));
                    await fetchWaveform();
                }
            }
        });
    });

    // Switches (ON/OFF toggles)
    document.querySelectorAll('.toggle-switch input').forEach(sw => {
        sw.addEventListener('change', async () => {
            const cmd = sw.checked ? sw.getAttribute('data-cmd-on') : sw.getAttribute('data-cmd-off');
            if (cmd) {
                await sendCommand(cmd);
                if (state.isConnected) {
                    await new Promise(r => setTimeout(r, 150));
                    await fetchWaveform();
                }
            }
        });
    });

    // Direct Measurement queries update HTML element
    document.querySelectorAll('.scpi-query-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const query = btn.getAttribute('data-query');
            const targetId = btn.getAttribute('data-update');
            const res = await sendCommand(query);
            if (res) {
                document.getElementById(targetId).textContent = res;
            }
        });
    });

    // Toggle visible traces with instrument synchronization
    elements.toggleCh1.addEventListener('click', async () => {
        const curr = elements.toggleCh1.getAttribute('data-active') === 'true';
        const next = !curr;
        elements.toggleCh1.setAttribute('data-active', next);
        state.waveforms.visible1 = next;

        if (state.isConnected) {
            await sendCommand(`:CH1:DISPlay ${next ? 'ON' : 'OFF'}`);
            // Add hardware settling delay to let acquisition buffers stabilize before query
            await new Promise(r => setTimeout(r, 200));
            await fetchWaveform();
        } else {
            drawScope();
        }
    });

    elements.toggleCh2.addEventListener('click', async () => {
        const curr = elements.toggleCh2.getAttribute('data-active') === 'true';
        const next = !curr;
        elements.toggleCh2.setAttribute('data-active', next);
        state.waveforms.visible2 = next;

        if (state.isConnected) {
            await sendCommand(`:CH2:DISPlay ${next ? 'ON' : 'OFF'}`);
            // Add hardware settling delay to let acquisition buffers stabilize before query
            await new Promise(r => setTimeout(r, 200));
            await fetchWaveform();
        } else {
            drawScope();
        }
    });

    // Header actions
    document.getElementById('btn-reset-device').addEventListener('click', () => sendCommand('*RST'));
    document.getElementById('btn-auto-set').addEventListener('click', () => sendCommand(':TRIGger:SINGle:SWEep AUTO'));

    elements.btnCycleAcq.addEventListener('click', async () => {
        acqModeIdx = (acqModeIdx + 1) % ACQ_MODES.length;
        const mode = ACQ_MODES[acqModeIdx];
        const displayMode = mode === 'SAMPle' ? 'SAMP' : 'PEAK';
        elements.btnCycleAcq.textContent = `Acq: ${displayMode}`;
        appendTerminal(`Setting Acquisition Mode to ${displayMode}`, 'system');
        await sendCommand(`:ACQuire:MODe ${mode}`);
        if (state.isConnected) {
            await new Promise(r => setTimeout(r, 150));
            await fetchWaveform();
        }
    });

    const MEM_DEPTHS = ['4K', '8K'];
    elements.btnCycleMem.addEventListener('click', async () => {
        const currentLabel = state.memoryDepthLabel || normalizeMemoryDepthLabel(state.metadata?.SAMPLE?.DEPMEM) || MEM_DEPTHS[0];
        const currentIdx = Math.max(0, MEM_DEPTHS.indexOf(currentLabel));
        const memDepthIdx = (currentIdx + 1) % MEM_DEPTHS.length;
        const depth = MEM_DEPTHS[memDepthIdx];
        updateMemoryDepthLabel(depth);
        appendTerminal(`Setting Memory Depth to ${depth}`, 'system');
        await sendCommand(`:ACQuire:DEPMem ${depth}`);
        const confirmedDepth = await sendCommand(':ACQuire:DEPMem?');
        if (confirmedDepth && typeof confirmedDepth === 'string') {
            updateMemoryDepthLabel(confirmedDepth);
        }
        if (state.isConnected) {
            await new Promise(r => setTimeout(r, 150));
            await fetchWaveform();
        }
    });

    // Capture / Live actions
    elements.btnFetchWave.addEventListener('click', fetchWaveform);
    elements.btnAutoFetch.addEventListener('click', toggleLiveWave);
    elements.btnQueryDmm.addEventListener('click', queryDmm);
    elements.btnPollDmm.addEventListener('click', toggleDmmPolling);

    // --- Cursor UI Controls Event Listeners ---
    const bindCursorToggle = (element, stateProp) => {
        if (element) {
            element.checked = state.cursors[stateProp];
            element.addEventListener('change', (e) => {
                state.cursors[stateProp] = e.target.checked;
                drawScope();
            });
        }
    };
    bindCursorToggle(elements.cursorT1Enabled, 't1Enabled');
    bindCursorToggle(elements.cursorT2Enabled, 't2Enabled');
    bindCursorToggle(elements.cursorV1Enabled, 'v1Enabled');
    bindCursorToggle(elements.cursorV2Enabled, 'v2Enabled');
    if (elements.cursorsSource) {
        elements.cursorsSource.value = state.cursors.source;
        elements.cursorsSource.addEventListener('change', (e) => {
            state.cursors.source = e.target.value;
            drawScope();
        });
    }
    if (elements.cursorsSnap) {
        elements.cursorsSnap.checked = state.cursors.snapEnabled;
        elements.cursorsSnap.addEventListener('change', (e) => {
            state.cursors.snapEnabled = e.target.checked;
            drawScope();
        });
    }
    if (elements.btnResetCursors) {
        elements.btnResetCursors.addEventListener('click', () => {
            if (!state.metadata || !state.metadata.TIMEBASE) return;
            const timebase = parseTime(state.metadata.TIMEBASE.SCALE) || 0.001;
            state.cursors.t1 = -2.0 * timebase;
            state.cursors.t2 = 2.0 * timebase;
            
            const { scale } = getSelectedChannelScaleOffset();
            state.cursors.v1 = 1.5 * scale;
            state.cursors.v2 = -1.5 * scale;
            
            drawScope();
        });
    }

    // Scope Top-Bar Controls
    elements.btnRunStop.addEventListener('click', async () => {
        if (!state.isConnected) return;

        const isStopped = state.metadata && state.metadata.RUNSTATUS === 'STOP';
        if (isStopped) {
            state.waveforms.captureHoffset = undefined;
            state.waveforms.captureTimebase = undefined;
            state.waveforms.captureSampleRate = undefined;
            state.waveforms.captureMemoryDepth = undefined;
            try {
                localStorage.removeItem('owon_capture_state');
            } catch (e) { }
            await sendCommand(':RUNning RUN');
        } else {
            await sendCommand(':RUNning STOP');
        }

        // Briefly pause for stable hardware settling
        await new Promise(r => setTimeout(r, 150));
        await fetchWaveform();
    });

    // WebUSB Hotplug listeners
    if ('usb' in navigator) {
        navigator.usb.addEventListener('disconnect', (event) => {
            if (state.device && state.device === event.device) {
                appendTerminal('USB Hardware physically removed.', 'error');
                disconnectDevice();
            }
        });
    } else {
        appendTerminal('WebUSB is NOT supported by this browser. USB connection is unavailable.', 'error');
        elements.connectBtn.disabled = true;
    }

    // --- Canvas Dragging Mechanics for Trigger Indicators ---
    function getCanvasMouseCoords(e) {
        const rect = elements.canvas.getBoundingClientRect();
        const scaleX = elements.canvas.width / rect.width;
        const scaleY = elements.canvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }

    async function handleHudClick(rect) {
        if (rect.id === 'ch1_coupling' || rect.id === 'ch2_coupling') {
            const chIdx = rect.id === 'ch1_coupling' ? 0 : 1;
            const chNum = chIdx + 1;
            const curr = (state.metadata.CHANNEL[chIdx].COUPLING || 'DC').toUpperCase();
            const next = curr === 'DC' ? 'AC' : (curr === 'AC' ? 'GND' : 'DC');
            appendTerminal(`HUD action: Cycling CH${chNum} coupling to ${next}`, 'system');
            await sendCommand(`:CH${chNum}:COUPling ${next}`);
            await fetchWaveform();
        } else if (rect.id === 'ch1_probe' || rect.id === 'ch2_probe') {
            const chIdx = rect.id === 'ch1_probe' ? 0 : 1;
            const chNum = chIdx + 1;
            const curr = (state.metadata.CHANNEL[chIdx].PROBE || '1X').toUpperCase();
            let next = '1X';
            if (curr === '1X') next = '10X';
            else if (curr === '10X') next = '100X';
            else if (curr === '100X') next = '1000X';

            appendTerminal(`HUD action: Cycling CH${chNum} probe to ${next}`, 'system');
            await sendCommand(`:CH${chNum}:PROBe ${next}`);
            await new Promise(r => setTimeout(r, 150));
            await fetchWaveform();
        } else if (rect.id === 'trig_channel') {
            const curr = (state.metadata.Trig.Items.Channel || 'CH1').toUpperCase();
            const next = curr === 'CH1' ? 'CH2' : 'CH1';
            appendTerminal(`HUD action: Cycling trigger source to ${next}`, 'system');
            await sendCommand(`:TRIG:EDGE:SOUR ${next}`);
            await new Promise(r => setTimeout(r, 150));
            await fetchWaveform();
        } else if (rect.id === 'trig_edge') {
            const curr = (state.metadata.Trig.Items.Edge || 'RISe').toLowerCase();
            const next = curr.startsWith('ris') ? 'FALL' : 'RISE';
            appendTerminal(`HUD action: Cycling trigger edge to ${next}`, 'system');
            await sendCommand(`:TRIGger:SINGle:EDGe ${next}`);
            await new Promise(r => setTimeout(r, 150));
            await fetchWaveform();
        } else if (rect.id === 'trig_sweep') {
            const curr = state.trigSweep || 'AUTO';
            let next = 'AUTO';
            if (curr === 'AUTO') next = 'NORMal';
            else if (curr === 'NORMal') next = 'SINGle';
            state.trigSweep = next;
            appendTerminal(`HUD action: Cycling trigger sweep to ${next}`, 'system');
            await sendCommand(`:TRIGger:SWEep ${next}`);
            drawScope(); // fast UI update
        } else if (rect.id === 'trig_coupling') {
            const curr = state.trigCoupling || 'DC';
            const next = curr === 'DC' ? 'AC' : 'DC';
            state.trigCoupling = next;
            appendTerminal(`HUD action: Cycling trigger coupling to ${next}`, 'system');
            await sendCommand(`:TRIGger:COUPling ${next}`);
            drawScope(); // fast UI update
        }
    }

    elements.canvas.addEventListener('mousedown', (e) => {
        const w = elements.canvas.width;
        const h = elements.canvas.height;
        const g = getGridConfig(w, h);
        const mouse = getCanvasMouseCoords(e);

        // 0. Check hit on Cursor handles if cursors are enabled
        const x1 = getXForTime(g, state.cursors.t1);
        const x2 = getXForTime(g, state.cursors.t2);
        const y1 = getYForVoltage(g, state.cursors.v1);
        const y2 = getYForVoltage(g, state.cursors.v2);

        // Hit on T1 (handle or vertical line)
        const hitT1 = state.cursors.t1Enabled && (
                      (Math.abs(mouse.x - x1) < 12 && mouse.y >= g.top && mouse.y <= g.bottom) ||
                      (Math.abs(mouse.x - x1) < 16 && mouse.y >= g.top - 5 && mouse.y <= g.top + 20));
        
        // Hit on T2 (handle or vertical line)
        const hitT2 = state.cursors.t2Enabled && (
                      (Math.abs(mouse.x - x2) < 12 && mouse.y >= g.top && mouse.y <= g.bottom) ||
                      (Math.abs(mouse.x - x2) < 16 && mouse.y >= g.top - 5 && mouse.y <= g.top + 20));
        
        // Hit on V1 (handle or horizontal line)
        const hitV1 = state.cursors.v1Enabled && (
                      (Math.abs(mouse.y - y1) < 12 && mouse.x >= g.left && mouse.x <= g.right) ||
                      (Math.abs(mouse.y - y1) < 16 && mouse.x >= g.left - 24 && mouse.x <= g.left));
        
        // Hit on V2 (handle or horizontal line)
        const hitV2 = state.cursors.v2Enabled && (
                      (Math.abs(mouse.y - y2) < 12 && mouse.x >= g.left && mouse.x <= g.right) ||
                      (Math.abs(mouse.y - y2) < 16 && mouse.x >= g.left - 24 && mouse.x <= g.left));

        if (hitT1) {
            state.dragging = 'cursor_t1';
            elements.canvas.style.cursor = 'ew-resize';
            e.preventDefault();
            return;
        }
        if (hitT2) {
            state.dragging = 'cursor_t2';
            elements.canvas.style.cursor = 'ew-resize';
            e.preventDefault();
            return;
        }
        if (hitV1) {
            state.dragging = 'cursor_v1';
            elements.canvas.style.cursor = 'ns-resize';
            e.preventDefault();
            return;
        }
        if (hitV2) {
            state.dragging = 'cursor_v2';
            elements.canvas.style.cursor = 'ns-resize';
            e.preventDefault();
            return;
        }

        if (!state.isConnected || !state.metadata) return;

        const coords = getTriggerPixelCoords(g);

        // 1. Check hit on Top Red Marker (resting above g.top)
        if (Math.abs(mouse.x - coords.x) < 16 && mouse.y >= g.top - 20 && mouse.y <= g.top) {
            state.dragging = 'horiz';
            elements.canvas.style.cursor = 'ew-resize';
            e.preventDefault();
            return;
        }

        const hasVisibleWaveform = (state.waveforms.visible1 && state.waveforms.ch1.length > 0) ||
            (state.waveforms.visible2 && state.waveforms.ch2.length > 0);
        if (hasVisibleWaveform && mouse.x >= g.left && mouse.x <= g.right && mouse.y >= g.top && mouse.y <= g.bottom) {
            const startHoffset = getHorizontalOffsetUnits();
            state.dragging = 'waveform_horiz';
            state.waveformDragPreview = {
                startX: mouse.x,
                startHoffset,
                deltaPx: 0,
                offsetUnits: startHoffset
            };
            elements.canvas.style.cursor = 'ew-resize';
            e.preventDefault();
            return;
        }

        // 2. Check hit on Right Edge Marker (resting to the right of g.right)
        if (mouse.x >= g.right && mouse.x <= g.right + 20 && Math.abs(mouse.y - coords.y) < 16) {
            state.dragging = 'vert';
            state.dragTriggerLevelVal = parseVoltage(state.metadata.Trig?.Items?.Level);
            state.dragTriggerLevelText = state.metadata.Trig?.Items?.Level;
            elements.canvas.style.cursor = 'ns-resize';
            e.preventDefault();
            return;
        }

        // 2.5 Check hit on Left Channel Zero-Offset Indicators
        if (state.metadata.CHANNEL) {
            const dy = g.height / 8;
            const pixelsPerUnit = dy / 25.0;
            for (let i = 0; i < 2; i++) {
                const ch = state.metadata.CHANNEL[i];
                if (!ch || !state.waveforms['visible' + (i + 1)]) continue;
                const cy = g.centerY - ((ch.OFFSET || 0) * pixelsPerUnit);

                // Rectangle bounds to left of grid: left-24 to left+4, height 20px centered on cy
                if (mouse.x >= g.left - 24 && mouse.x <= g.left + 4 && Math.abs(mouse.y - cy) < 10) {
                    state.dragging = `offset_ch${i + 1}`;
                    state.dragStartOffset = ch.OFFSET || 0; // Capture drag origin
                    elements.canvas.style.cursor = 'ns-resize';
                    e.preventDefault();
                    return;
                }
            }
        }

        // 3. Check hit on HUD item
        if (state.hudRects) {
            const rect = state.hudRects.find(r =>
                mouse.x >= r.x && mouse.x <= r.x + r.w &&
                mouse.y >= r.y && mouse.y <= r.y + r.h
            );
            if (rect) {
                handleHudClick(rect);
                e.preventDefault();
                return;
            }
        }
    });

    // Hover pointer logic ONLY while the mouse moves over the active canvas area
    elements.canvas.addEventListener('mousemove', (e) => {
        if (state.dragging) return;

        const w = elements.canvas.width;
        const h = elements.canvas.height;
        const g = getGridConfig(w, h);
        const mouse = getCanvasMouseCoords(e);

        const x1 = getXForTime(g, state.cursors.t1);
        const x2 = getXForTime(g, state.cursors.t2);
        const y1 = getYForVoltage(g, state.cursors.v1);
        const y2 = getYForVoltage(g, state.cursors.v2);
        
        const hoverT1 = state.cursors.t1Enabled && (
                        (Math.abs(mouse.x - x1) < 12 && mouse.y >= g.top && mouse.y <= g.bottom) ||
                        (Math.abs(mouse.x - x1) < 16 && mouse.y >= g.top - 5 && mouse.y <= g.top + 20));
        const hoverT2 = state.cursors.t2Enabled && (
                        (Math.abs(mouse.x - x2) < 12 && mouse.y >= g.top && mouse.y <= g.bottom) ||
                        (Math.abs(mouse.x - x2) < 16 && mouse.y >= g.top - 5 && mouse.y <= g.top + 20));
        const hoverV1 = state.cursors.v1Enabled && (
                        (Math.abs(mouse.y - y1) < 12 && mouse.x >= g.left && mouse.x <= g.right) ||
                        (Math.abs(mouse.y - y1) < 16 && mouse.x >= g.left - 24 && mouse.x <= g.left));
        const hoverV2 = state.cursors.v2Enabled && (
                        (Math.abs(mouse.y - y2) < 12 && mouse.x >= g.left && mouse.x <= g.right) ||
                        (Math.abs(mouse.y - y2) < 16 && mouse.x >= g.left - 24 && mouse.x <= g.left));
        
        const hoverCursor = hoverT1 || hoverT2 || hoverV1 || hoverV2;

        if (hoverCursor) {
            elements.canvas.style.cursor = 'pointer';
            return;
        }

        if (!state.isConnected || !state.metadata) {
            elements.canvas.style.cursor = 'default';
            return;
        }

        const coords = getTriggerPixelCoords(g);
        const hoverHoriz = Math.abs(mouse.x - coords.x) < 16 && mouse.y >= g.top - 20 && mouse.y <= g.top;
        const hoverVert = mouse.x >= g.right && mouse.x <= g.right + 20 && Math.abs(mouse.y - coords.y) < 16;

        let hoverOffset = false;
        if (state.metadata.CHANNEL) {
            const dy = g.height / 8;
            const pixelsPerUnit = dy / 25.0;
            for (let i = 0; i < 2; i++) {
                const ch = state.metadata.CHANNEL[i];
                if (!ch || !state.waveforms['visible' + (i + 1)]) continue;
                const cy = g.centerY - ((ch.OFFSET || 0) * pixelsPerUnit);
                if (mouse.x >= g.left - 24 && mouse.x <= g.left + 4 && Math.abs(mouse.y - cy) < 10) {
                    hoverOffset = true;
                    break;
                }
            }
        }

        const hoverHud = state.hudRects && state.hudRects.some(r =>
            mouse.x >= r.x && mouse.x <= r.x + r.w &&
            mouse.y >= r.y && mouse.y <= r.y + r.h
        );
        const hasVisibleWaveform = (state.waveforms.visible1 && state.waveforms.ch1.length > 0) ||
            (state.waveforms.visible2 && state.waveforms.ch2.length > 0);
        const hoverWaveform = hasVisibleWaveform && mouse.x >= g.left && mouse.x <= g.right && mouse.y >= g.top && mouse.y <= g.bottom;

        if (hoverHoriz || hoverVert || hoverOffset || hoverHud || hoverWaveform) {
            elements.canvas.style.cursor = 'pointer';
        } else {
            elements.canvas.style.cursor = 'default';
        }
    });

    elements.canvas.addEventListener('wheel', async (e) => {
        if (!state.isConnected || !state.metadata || !state.hudRects) return;
        const mouse = getCanvasMouseCoords(e);

        const rect = state.hudRects.find(r =>
            mouse.x >= r.x && mouse.x <= r.x + r.w &&
            mouse.y >= r.y && mouse.y <= r.y + r.h
        );
        if (!rect) return;

        e.preventDefault();
        const dir = e.deltaY < 0 ? 1 : -1;

        if (rect.id === 'ch1_scale' || rect.id === 'ch2_scale') {
            const chIdx = rect.id === 'ch1_scale' ? 0 : 1;
            const current = state.metadata.CHANNEL[chIdx].SCALE;
            const closestIdx = findClosestVoltageScaleIndex(current);
            if (closestIdx === -1) return;

            const nextIdx = Math.max(0, Math.min(VOLTAGE_SCALES.length - 1, closestIdx + dir));
            if (nextIdx !== closestIdx) {
                const nextVal = VOLTAGE_SCALES[nextIdx];
                await setVerticalScale(chIdx, nextVal, 'HUD action: Changing scale to');
            }
        } else if (rect.id === 'timebase') {
            const current = state.metadata.TIMEBASE.SCALE;
            const closestIdx = findClosestTimebaseIndex(current);
            if (closestIdx === -1) return;

            const nextIdx = Math.max(0, Math.min(TIMEBASE_SCALES.length - 1, closestIdx + dir));
            if (nextIdx !== closestIdx) {
                const nextVal = TIMEBASE_SCALES[nextIdx];
                await setTimebaseScale(nextVal, 'HUD action: Changing timebase scale to');
            }
        }
    }, { passive: false });

    // Drag tracking MUST extend to the entire window to prevent drop-off artifacts
    window.addEventListener('mousemove', (e) => {
        if (!state.dragging) return;

        const w = elements.canvas.width;
        const h = elements.canvas.height;
        const g = getGridConfig(w, h);
        const mouse = getCanvasMouseCoords(e);

        if (state.dragging === 'cursor_t1') {
            const rawX = Math.max(g.left, Math.min(g.right, mouse.x));
            const snappedX = getSnappedX(g, rawX);
            state.cursors.t1 = getTimeForX(g, snappedX);
            drawScope();
            e.preventDefault();
            return;
        } else if (state.dragging === 'cursor_t2') {
            const rawX = Math.max(g.left, Math.min(g.right, mouse.x));
            const snappedX = getSnappedX(g, rawX);
            state.cursors.t2 = getTimeForX(g, snappedX);
            drawScope();
            e.preventDefault();
            return;
        } else if (state.dragging === 'cursor_v1') {
            const rawY = Math.max(g.top, Math.min(g.bottom, mouse.y));
            const snappedY = getSnappedY(g, rawY);
            state.cursors.v1 = getVoltageForY(g, snappedY);
            drawScope();
            e.preventDefault();
            return;
        } else if (state.dragging === 'cursor_v2') {
            const rawY = Math.max(g.top, Math.min(g.bottom, mouse.y));
            const snappedY = getSnappedY(g, rawY);
            state.cursors.v2 = getVoltageForY(g, snappedY);
            drawScope();
            e.preventDefault();
            return;
        }

        if (!state.isConnected || !state.metadata) return;

        if (state.dragging === 'horiz') {
            // Restrict movement to the active horizontal grid boundaries
            const nx = Math.max(g.left, Math.min(g.right, mouse.x));
            const dx = g.width / 12;
            const pixelsPerUnitX = dx / 25.0;
            const newHoffset = -(nx - g.centerX) / pixelsPerUnitX;

            if (state.metadata.TIMEBASE) {
                state.metadata.TIMEBASE.HOFFSET = newHoffset;
                drawScope(); // Re-draw immediately for smooth real-time visual feedback
            }
        } else if (state.dragging === 'waveform_horiz') {
            const preview = state.waveformDragPreview;
            if (!preview) return;
            const dx = g.width / 12;
            const pixelsPerUnitX = dx / 25.0;
            preview.deltaPx = mouse.x - preview.startX;
            preview.offsetUnits = preview.startHoffset - (preview.deltaPx / pixelsPerUnitX);
            drawScope();
        } else if (state.dragging === 'vert') {
            const newV = getTriggerLevelForY(g, mouse.y);
            if (newV === null) return;

            const levelStr = formatVoltageForDisplay(newV);
            state.dragTriggerLevelVal = newV;
            state.dragTriggerLevelText = levelStr;
            state.metadata.Trig.Items.Level = levelStr;
            drawScope(); // Re-draw immediately
        } else if (state.dragging.startsWith('offset_ch')) {
            const chNum = parseInt(state.dragging.replace('offset_ch', ''));
            const dy = g.height / 8;
            const pixelsPerUnit = dy / 25.0;

            const rawOffset = (g.centerY - mouse.y) / pixelsPerUnit;
            state.dragOffsetVal = Math.max(-2000, Math.min(2000, Math.round(rawOffset)));

            drawScope();
        }
        e.preventDefault();
    });

    window.addEventListener('mouseup', async (e) => {
        if (!state.dragging) return;

        const mode = state.dragging;
        state.dragging = null;
        elements.canvas.style.cursor = 'default';

        if (mode.startsWith('cursor_')) {
            drawScope();
            return;
        }

        if (!state.isConnected || !state.metadata) {
            state.waveformDragPreview = null;
            updateViewportToolbar();
            return;
        }

        const w = elements.canvas.width;
        const h = elements.canvas.height;
        const g = getGridConfig(w, h);

        if (mode === 'horiz') {
            const coords = getTriggerPixelCoords(g);
            const dx = g.width / 12;
            const divs = -(coords.x - g.centerX) / dx;
            // Hack identical to physical hardware parser padding
            const val = divs + Math.sign(divs) * 0.0001;

            appendTerminal(`Setting trigger position offset to ${divs.toFixed(3)} divisions.`, 'system');
            await sendCommand(`:HORIzontal:OFFSet ${val.toFixed(4)}`);
        } else if (mode === 'waveform_horiz') {
            const preview = state.waveformDragPreview;
            const finalOffset = preview?.offsetUnits ?? getHorizontalOffsetUnits();
            const divs = finalOffset / 25.0;
            const val = divs + Math.sign(divs) * 0.0001;
            state.waveformDragPreview = null;
            if (state.metadata.TIMEBASE) state.metadata.TIMEBASE.HOFFSET = finalOffset;

            appendTerminal(`Moving waveform viewport to ${divs.toFixed(3)} divisions.`, 'system');
            await sendCommand(`:HORIzontal:OFFSet ${val.toFixed(4)}`);
        } else if (mode === 'vert') {
            const mouse = getCanvasMouseCoords(e);
            const releaseLevel = getTriggerLevelForY(g, mouse.y);
            const levelVal = releaseLevel ?? state.dragTriggerLevelVal ?? parseVoltage(state.metadata.Trig?.Items?.Level);
            const levelText = formatVoltageForDisplay(levelVal);
            const scpiLevel = formatVoltageForScpi(levelVal);
            if (state.metadata.Trig?.Items) {
                state.metadata.Trig.Items.Level = levelText;
            }
            state.pendingTriggerLevel = {
                val: levelVal,
                levelText,
                expires: Date.now() + 2500
            };
            state.dragTriggerLevelVal = undefined;
            state.dragTriggerLevelText = undefined;

            appendTerminal(`Setting trigger level to ${levelVal.toFixed(3)}V.`, 'system');
            await sendCommand(`:TRIGger:SINGle:EDGe:LEVel ${scpiLevel}`);
        } else if (mode.startsWith('offset_ch')) {
            const chNum = parseInt(mode.replace('offset_ch', ''));
            const chIdx = chNum - 1;
            const finalOffset = state.dragOffsetVal !== undefined ? state.dragOffsetVal : (state.metadata.CHANNEL[chIdx].OFFSET || 0);

            // Maintain ghost and marker for 600ms or until hardware updates to match
            state.pendingOffset = { chIdx, val: finalOffset, expires: Date.now() + 600 };
            state.dragOffsetVal = undefined; // clear ghost state

            // Crucial Fix: SCPI expects values in divisions, not internal units (25 units/div)
            const divs = finalOffset / 25.0;
            // Precision hack matching physical hardware parser rounding padding
            const val = divs + Math.sign(divs) * 0.0001;

            appendTerminal(`Setting CH${chNum} vertical offset to ${divs.toFixed(3)} divisions.`, 'system');
            await sendCommand(`:CH${chNum}:OFFSet ${val.toFixed(4)}`);
        }

        // Briefly pause for hardware display buffers to update, then refresh device state
        await new Promise(r => setTimeout(r, 150));
        await fetchWaveform();
        updateViewportToolbar();
    });

    // Canvas scroll wheel for Timebase scale adjustment
    elements.canvas.addEventListener('wheel', async (e) => {
        if (!state.isConnected || !state.metadata || !state.metadata.TIMEBASE) return;
        const mouse = getCanvasMouseCoords(e);
        const hudRect = state.hudRects?.find(r =>
            mouse.x >= r.x && mouse.x <= r.x + r.w &&
            mouse.y >= r.y && mouse.y <= r.y + r.h
        );
        if (hudRect) return;

        e.preventDefault(); // prevent page scroll

        const currentScale = state.metadata.TIMEBASE.SCALE;
        if (!currentScale) return;

        let idx = findClosestTimebaseIndex(currentScale);
        if (idx === -1) return;

        // Scroll up = Zoom in (smaller time), Scroll down = Zoom out (larger time)
        if (e.deltaY < 0) {
            idx = Math.max(0, idx - 1);
        } else if (e.deltaY > 0) {
            idx = Math.min(TIMEBASE_SCALES.length - 1, idx + 1);
        }

        const newScale = TIMEBASE_SCALES[idx];
        await setTimebaseScale(newScale);
    });

    // --- Init System ---
    resizeCanvas();

    // Auto-connect to previously paired devices on startup
    if ('usb' in navigator) {
        navigator.usb.getDevices().then(async (devices) => {
            const matched = devices.find(d => d.vendorId === OWON_VID);
            if (matched) {
                appendTerminal(`Discovered paired device: ${matched.productName || 'Owon HDS'}. Auto-connecting...`, 'system');
                await initializeUsbSession(matched);
            }
        }).catch(err => {
            console.warn('Auto-reconnect check failed', err);
        });
    }
});
