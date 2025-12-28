// UV Face Filter - TikTok Style
// DEEP DEBUG MODE: Extensive logging at every step

console.log('=== MAIN.JS STARTING ===');
console.log('Timestamp:', new Date().toISOString());

// Global flag to prevent multiple getUserMedia calls
window.cameraInitialized = false;
window.uvFilterInstance = null;
window.debugLogs = [];

function deepLog(category, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = {
        timestamp,
        category,
        message,
        data: data ? JSON.parse(JSON.stringify(data)) : null
    };
    window.debugLogs.push(logEntry);
    if (window.debugLogs.length > 1000) {
        window.debugLogs.shift(); // Keep last 1000 logs
    }
    // Always log to console
    const logMsg = `[${timestamp}] [${category}] ${message}`;
    if (data) {
        console.log(logMsg, data);
    } else {
        console.log(logMsg);
    }
}

console.log('=== deepLog function defined ===');
deepLog('INIT', 'main.js script loaded');

class UVFaceFilter {
    constructor() {
        deepLog('CONSTRUCTOR', 'UVFaceFilter constructor called');
        deepLog('CONSTRUCTOR', 'window.cameraInitialized', { value: window.cameraInitialized });
        deepLog('CONSTRUCTOR', 'window.uvFilterInstance exists?', { exists: !!window.uvFilterInstance });
        
        // Prevent multiple instances
        if (window.uvFilterInstance) {
            deepLog('CONSTRUCTOR', 'WARNING: Instance already exists, skipping');
            console.warn('[UVFilter] Instance already exists, skipping');
            return;
        }
        window.uvFilterInstance = this;
        deepLog('CONSTRUCTOR', 'Instance registered globally');
        
        this.video = document.getElementById('video');
        this.canvas = document.getElementById('canvas');
        deepLog('CONSTRUCTOR', 'DOM elements', {
            video: !!this.video,
            canvas: !!this.canvas,
            videoId: this.video?.id,
            canvasId: this.canvas?.id
        });
        
        if (!this.video || !this.canvas) {
            deepLog('CONSTRUCTOR', 'ERROR: Missing DOM elements', {
                video: !!this.video,
                canvas: !!this.canvas
            });
            return;
        }
        
        // Use willReadFrequently for better performance with frequent getImageData calls
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
        
        // Enable high-quality image smoothing for soft, smooth image
        if (this.ctx) {
            this.ctx.imageSmoothingEnabled = true;
            this.ctx.imageSmoothingQuality = 'high';
        }
        
        deepLog('CONSTRUCTOR', 'Canvas context', { context: !!this.ctx });
        
        this.faceMesh = null;
        this.camera = null;
        this.isProcessing = false;
        this.animationFrame = null;
        this.frameCount = 0;
        this.lastLogTime = 0;
        this.fallbackActive = false;
        this.faceMeshLoadTimeout = null;
        this.videoReady = false;
        this.streamActive = false;
        this.mediaPipeReady = false;
        this.cameraStream = null;
        this.lastHealthCheck = 0;
        this.renderLoopActive = false;
        this.lastLandmarks = null; // Store last detected landmarks for continuous rendering
        this.faceMeshSetupAttempted = false; // Prevent multiple FaceMesh setups
        
        // Face mesh landmarks
        this.skinLandmarks = this.getSkinLandmarks();
        this.eyeLandmarks = this.getEyeLandmarks();
        this.lipLandmarks = this.getLipLandmarks();
        this.eyebrowLandmarks = this.getEyebrowLandmarks();
        deepLog('CONSTRUCTOR', 'Landmarks initialized', {
            skin: this.skinLandmarks.length,
            eye: Object.keys(this.eyeLandmarks).length,
            lip: this.lipLandmarks.length,
            eyebrow: Object.keys(this.eyebrowLandmarks).length
        });
        
        // Performance
        this.processingScale = 0.75;
        this.lastFrameTime = 0;
        this.targetFPS = 30;
        this.frameInterval = 1000 / this.targetFPS;
        
        // Debug state
        this.debugMode = true;
        this.lastFaceDetected = 0;
        this.faceMeshFailCount = 0;
        this.maxFaceMeshFailures = 10;
        
        // Logo
        this.logoImage = null;
        this.logoLoaded = false;
        this.loadLogo();
        
        deepLog('CONSTRUCTOR', 'Initialization complete, calling init()');
        this.init();
    }
    
    loadLogo() {
        // Try to load logo image if it exists
        const logoImg = new Image();
        logoImg.crossOrigin = 'anonymous'; // Allow cross-origin if needed
        logoImg.onload = () => {
            this.logoImage = logoImg;
            this.logoLoaded = true;
            deepLog('LOGO', 'Logo image loaded successfully', {
                width: logoImg.naturalWidth,
                height: logoImg.naturalHeight,
                complete: logoImg.complete
            });
        };
        logoImg.onerror = (error) => {
            deepLog('LOGO', 'Logo image not found, will use text logo', {
                error: error
            });
            this.logoLoaded = true; // Still mark as loaded so we can draw text logo
        };
        logoImg.src = './pixxel.png'; // Try to load pixxel.png
    }
    
    drawLogo() {
        try {
            if (!this.ctx || !this.logoLoaded) {
                deepLog('LOGO', 'Cannot draw - ctx or logo not loaded', {
                    hasCtx: !!this.ctx,
                    logoLoaded: this.logoLoaded,
                    hasLogoImage: !!this.logoImage
                });
                return;
            }
            
            // Responsive sizing for mobile
            const isMobile = window.innerWidth < 768;
            const padding = isMobile ? 12 : 20;
            const logoSize = isMobile ? 50 : 60; // Smaller on mobile
            
            // Get display dimensions (accounting for device pixel ratio)
            const devicePixelRatio = window.devicePixelRatio || 1;
            const dpr = Math.min(devicePixelRatio, 2);
            const displayWidth = this.canvas.width / dpr;
            const displayHeight = this.canvas.height / dpr;
            
            // Ensure canvas dimensions are valid
            if (!this.canvas.width || !this.canvas.height) {
                deepLog('LOGO', 'Canvas dimensions invalid', {
                    width: this.canvas.width,
                    height: this.canvas.height
                });
                return;
            }
            
            // If we have a logo image, draw it
            if (this.logoImage && this.logoImage.complete && this.logoImage.naturalWidth > 0) {
                const x = displayWidth - logoSize - padding;
                const y = displayHeight - logoSize - padding;
                
                // Draw logo image directly - no background or shadow
                this.ctx.drawImage(this.logoImage, x, y, logoSize, logoSize);
            } else {
                // Draw text logo as fallback
                const text = 'UV';
                const fontSize = isMobile ? 20 : 24;
                const devicePixelRatio = window.devicePixelRatio || 1;
                const dpr = Math.min(devicePixelRatio, 2);
                const displayWidth = this.canvas.width / dpr;
                const displayHeight = this.canvas.height / dpr;
                const x = displayWidth - padding;
                const y = displayHeight - padding;
                
                // Draw text without shadow
                this.ctx.font = `bold ${fontSize}px Arial`;
                this.ctx.textAlign = 'right';
                this.ctx.textBaseline = 'bottom';
                
                // Text only - no shadow
                this.ctx.fillStyle = '#ffffff';
                this.ctx.fillText(text, x, y);
            }
        } catch (error) {
            deepLog('LOGO', 'ERROR drawing logo', {
                name: error.name,
                message: error.message,
                stack: error.stack
            });
        }
    }
    
    getSkinLandmarks() {
        const allLandmarks = Array.from({ length: 468 }, (_, i) => i);
        const exclude = [
            33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246,
            362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398,
            107, 55, 65, 52, 53, 46, 70, 63, 105, 66, 69,
            336, 296, 334, 293, 300, 276, 283, 282, 295, 285, 336,
            61, 146, 91, 181, 84, 17, 314, 405, 320, 307, 375, 321, 308, 324, 318,
            13, 82, 81, 80, 78, 95, 88, 178, 87, 14, 317, 402, 318, 324,
            12, 268, 271, 272, 407, 415, 310, 311, 312, 13, 82, 81, 80, 78
        ];
        return allLandmarks.filter(i => !exclude.includes(i));
    }
    
    getEyeLandmarks() {
        return {
            left: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
            right: [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398]
        };
    }
    
    getEyebrowLandmarks() {
        return {
            left: [107, 55, 65, 52, 53, 46, 70, 63, 105, 66, 69],
            right: [336, 296, 334, 293, 300, 276, 283, 282, 295, 285, 336]
        };
    }
    
    getLipLandmarks() {
        return [
            61, 146, 91, 181, 84, 17, 314, 405, 320, 307, 375, 321, 308, 324, 318,
            13, 82, 81, 80, 78, 95, 88, 178, 87, 14, 317, 402, 318, 324,
            12, 268, 271, 272, 407, 415, 310, 311, 312
        ];
    }
    
    logVideoState() {
        if (!this.video) return;
        const state = {
            readyState: this.video.readyState,
            HAVE_NOTHING: this.video.HAVE_NOTHING,
            HAVE_METADATA: this.video.HAVE_METADATA,
            HAVE_CURRENT_DATA: this.video.HAVE_CURRENT_DATA,
            HAVE_FUTURE_DATA: this.video.HAVE_FUTURE_DATA,
            HAVE_ENOUGH_DATA: this.video.HAVE_ENOUGH_DATA,
            paused: this.video.paused,
            ended: this.video.ended,
            videoWidth: this.video.videoWidth,
            videoHeight: this.video.videoHeight,
            srcObject: !!this.video.srcObject,
            currentTime: this.video.currentTime,
            duration: this.video.duration,
            error: this.video.error ? {
                code: this.video.error.code,
                message: this.video.error.message
            } : null
        };
        deepLog('VIDEO_STATE', 'Video element state', state);
        return state;
    }
    
    logStreamState() {
        if (!this.cameraStream) {
            deepLog('STREAM_STATE', 'No stream available');
            return;
        }
        const tracks = this.cameraStream.getTracks();
        const trackStates = tracks.map((track, idx) => ({
            index: idx,
            kind: track.kind,
            enabled: track.enabled,
            readyState: track.readyState,
            muted: track.muted,
            id: track.id,
            label: track.label,
            settings: track.getSettings ? track.getSettings() : null,
            constraints: track.getConstraints ? track.getConstraints() : null
        }));
        deepLog('STREAM_STATE', 'Stream state', {
            active: this.cameraStream.active,
            id: this.cameraStream.id,
            tracksCount: tracks.length,
            tracks: trackStates
        });
    }
    
    async init() {
        deepLog('INIT', 'init() called');
        deepLog('INIT', 'Current state', {
            cameraInitialized: window.cameraInitialized,
            videoReady: this.videoReady,
            streamActive: this.streamActive,
            mediaPipeReady: this.mediaPipeReady,
            fallbackActive: this.fallbackActive
        });
        
        // Check global flag
        if (window.cameraInitialized === true) {
            deepLog('INIT', 'CAMERA INIT BLOCKED (SKIPPED) - Already initialized');
            if (this.video.srcObject) {
                deepLog('INIT', 'Video has srcObject, setting up listeners');
                this.setupVideoListeners();
                this.videoReady = true;
                this.streamActive = true;
                this.startImmediateFallback();
                this.setupFaceMesh();
            } else {
                deepLog('INIT', 'WARNING: Camera initialized but video.srcObject is null');
            }
            return;
        }
        
        deepLog('INIT', 'CAMERA INIT START');
        this.logVideoState();
        deepLog('INIT', 'navigator.mediaDevices', {
            exists: !!navigator.mediaDevices,
            getUserMedia: typeof navigator.mediaDevices?.getUserMedia,
            enumerateDevices: typeof navigator.mediaDevices?.enumerateDevices
        });
        deepLog('INIT', 'User agent', { ua: navigator.userAgent });
        
        this.setupVideoListeners();
        
        try {
            const constraints = {
                video: {
                    facingMode: 'user',
                    width: { ideal: 640 },
                    height: { ideal: 480 }
                }
            };
            
            deepLog('INIT', 'Calling getUserMedia', { constraints });
            
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            
            deepLog('INIT', 'getUserMedia SUCCESS', {
                streamActive: stream.active,
                streamId: stream.id,
                tracksCount: stream.getTracks().length
            });
            
            stream.getTracks().forEach((track, idx) => {
                deepLog('INIT', `Track ${idx}`, {
                    kind: track.kind,
                    enabled: track.enabled,
                    readyState: track.readyState,
                    muted: track.muted,
                    id: track.id,
                    label: track.label
                });
            });
            
            window.cameraInitialized = true;
            deepLog('INIT', 'CAMERA INIT SUCCESS - Global flag set');
            
            this.cameraStream = stream;
            this.streamActive = true;
            deepLog('INIT', 'Stream stored and marked active');
            
            deepLog('INIT', 'Setting video.srcObject');
            this.video.srcObject = stream;
            deepLog('INIT', 'video.srcObject set', {
                hasSrcObject: !!this.video.srcObject,
                srcObjectId: this.video.srcObject?.id
            });
            
            deepLog('INIT', 'Attempting video.play()');
            try {
                const playPromise = this.video.play();
                deepLog('INIT', 'video.play() promise created');
                await playPromise;
                deepLog('INIT', 'video.play() SUCCESS');
                this.logVideoState();
            } catch (playError) {
                deepLog('INIT', 'video.play() FAILED', {
                    name: playError.name,
                    message: playError.message,
                    stack: playError.stack
                });
                setTimeout(async () => {
                    try {
                        deepLog('INIT', 'Retrying video.play()');
                        await this.video.play();
                        deepLog('INIT', 'video.play() SUCCESS on retry');
                    } catch (retryError) {
                        deepLog('INIT', 'video.play() FAILED on retry', {
                            name: retryError.name,
                            message: retryError.message
                        });
                    }
                }, 500);
            }
            
            deepLog('INIT', 'Waiting for video metadata...');
            
        } catch (error) {
            deepLog('INIT', 'getUserMedia ERROR', {
                name: error.name,
                message: error.message,
                stack: error.stack,
                constraint: error.constraint,
                constraintName: error.constraintName
            });
            this.activateHardFallback('getUserMedia failed: ' + error.message, false);
        }
    }
    
    setupVideoListeners() {
        deepLog('LISTENERS', 'Setting up video event listeners');
        
        // Remove existing listeners
        if (this.onLoadedMetadata) {
            this.video.removeEventListener('loadedmetadata', this.onLoadedMetadata);
        }
        if (this.onCanPlay) {
            this.video.removeEventListener('canplay', this.onCanPlay);
        }
        if (this.onPlay) {
            this.video.removeEventListener('play', this.onPlay);
        }
        if (this.onPlaying) {
            this.video.removeEventListener('playing', this.onPlaying);
        }
        if (this.onPause) {
            this.video.removeEventListener('pause', this.onPause);
        }
        if (this.onVideoError) {
            this.video.removeEventListener('error', this.onVideoError);
        }
        if (this.onStalled) {
            this.video.removeEventListener('stalled', this.onStalled);
        }
        if (this.onWaiting) {
            this.video.removeEventListener('waiting', this.onWaiting);
        }
        
        this.onLoadedMetadata = () => {
            deepLog('VIDEO_EVENT', 'loadedmetadata fired');
            this.logVideoState();
            this.logStreamState();
            
                if (this.video.videoWidth > 0 && this.video.videoHeight > 0) {
                    deepLog('VIDEO_EVENT', 'Video dimensions valid', {
                        width: this.video.videoWidth,
                        height: this.video.videoHeight
                    });
                    this.setupCanvas();
                    this.videoReady = true;
                    
                    // Start UV filter render loop immediately - no face detection needed
                    // UV filter applies to entire camera feed like a UV camera
                    if (!this.renderLoopActive) {
                        deepLog('VIDEO_EVENT', 'Starting UV camera filter render loop');
                        this.startImmediateFallback();
                    }
                } else {
                    deepLog('VIDEO_EVENT', 'ERROR: Video dimensions are zero');
                    this.activateHardFallback('Video dimensions are zero', false);
                }
        };
        
        this.onCanPlay = () => {
            deepLog('VIDEO_EVENT', 'canplay fired');
            this.logVideoState();
        };
        
        this.onPlay = () => {
            deepLog('VIDEO_EVENT', 'play fired');
            this.logVideoState();
        };
        
        this.onPlaying = () => {
            deepLog('VIDEO_EVENT', 'playing fired');
            this.logVideoState();
        };
        
        this.onPause = () => {
            deepLog('VIDEO_EVENT', 'pause fired');
            this.logVideoState();
        };
        
        this.onVideoError = (e) => {
            deepLog('VIDEO_EVENT', 'error fired', {
                errorCode: this.video.error?.code,
                errorMessage: this.video.error?.message,
                event: e
            });
            this.logVideoState();
            this.activateHardFallback('Video error event', false);
        };
        
        this.onStalled = () => {
            deepLog('VIDEO_EVENT', 'stalled fired');
            this.logVideoState();
        };
        
        this.onWaiting = () => {
            deepLog('VIDEO_EVENT', 'waiting fired');
            this.logVideoState();
        };
        
        // Add listeners
        this.video.addEventListener('loadedmetadata', this.onLoadedMetadata);
        this.video.addEventListener('canplay', this.onCanPlay);
        this.video.addEventListener('play', this.onPlay);
        this.video.addEventListener('playing', this.onPlaying);
        this.video.addEventListener('pause', this.onPause);
        this.video.addEventListener('error', this.onVideoError);
        this.video.addEventListener('stalled', this.onStalled);
        this.video.addEventListener('waiting', this.onWaiting);
        
        deepLog('LISTENERS', 'All video event listeners attached');
    }
    
    setupCanvas() {
        deepLog('CANVAS', 'setupCanvas() called');
        
        if (!this.video.videoWidth || !this.video.videoHeight) {
            deepLog('CANVAS', 'ERROR: Invalid video dimensions');
            return;
        }
        
        const videoWidth = this.video.videoWidth;
        const videoHeight = this.video.videoHeight;
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        const videoAspect = videoWidth / videoHeight;
        const windowAspect = windowWidth / windowHeight;
        
        deepLog('CANVAS', 'Calculating canvas size', {
            videoWidth,
            videoHeight,
            windowWidth,
            windowHeight,
            videoAspect,
            windowAspect
        });
        
        // Get device pixel ratio for high-resolution rendering
        const devicePixelRatio = window.devicePixelRatio || 1;
        const dpr = Math.min(devicePixelRatio, 2); // Cap at 2x for performance
        
        // Calculate display dimensions
        let displayWidth, displayHeight;
        if (videoAspect > windowAspect) {
            displayWidth = windowWidth;
            displayHeight = windowWidth / videoAspect;
        } else {
            displayWidth = windowHeight * videoAspect;
            displayHeight = windowHeight;
        }
        
        // Set canvas internal resolution higher for better quality
        this.canvas.width = displayWidth * dpr;
        this.canvas.height = displayHeight * dpr;
        
        // CSS size stays at display size
        this.canvas.style.width = displayWidth + 'px';
        this.canvas.style.height = displayHeight + 'px';
        this.canvas.style.objectFit = 'cover';
        
        // Scale context to match device pixel ratio
        this.ctx.scale(dpr, dpr);
        
        // Enable high-quality image smoothing for soft, smooth rendering
        this.ctx.imageSmoothingEnabled = true;
        this.ctx.imageSmoothingQuality = 'high';
        
        deepLog('CANVAS', 'Canvas dimensions set', {
            internalWidth: this.canvas.width,
            internalHeight: this.canvas.height,
            displayWidth: displayWidth,
            displayHeight: displayHeight,
            devicePixelRatio: dpr
        });
        
        // Canvas setup complete
    }
    
    setupFaceMesh() {
        console.log('=== setupFaceMesh() CALLED ===');
        
        // CRITICAL: Prevent multiple FaceMesh instances
        if (this.faceMesh) {
            console.log('FaceMesh already exists, skipping setup');
            deepLog('FACEMESH', 'FaceMesh already exists, skipping');
            return;
        }
        
        deepLog('FACEMESH', 'setupFaceMesh() called');
        deepLog('FACEMESH', 'MediaPipe availability', {
            FaceMesh: typeof FaceMesh,
            Camera: typeof Camera
        });
        
        console.log('FaceMesh type:', typeof FaceMesh);
        console.log('Camera type:', typeof Camera);
        console.log('Fallback active:', this.fallbackActive);
        console.log('Render loop active:', this.renderLoopActive);
        
        if (typeof FaceMesh === 'undefined') {
            console.error('ERROR: FaceMesh not available');
            deepLog('FACEMESH', 'ERROR: FaceMesh not available - staying in fallback mode');
            return;
        }
        
        console.log('FaceMesh is available, proceeding with setup...');
        
        try {
            deepLog('FACEMESH', 'Creating FaceMesh instance');
            this.faceMesh = new FaceMesh({
                locateFile: (file) => {
                    const url = `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
                    deepLog('FACEMESH', 'Loading MediaPipe file', { file, url });
                    return url;
                }
            });
            
            deepLog('FACEMESH', 'FaceMesh instance created');
            
            this.faceMesh.setOptions({
                maxNumFaces: 1,
                refineLandmarks: true,
                minDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5
            });
            
            deepLog('FACEMESH', 'FaceMesh options set');
            
            this.faceMesh.onResults((results) => {
                const hasFace = results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0;
                console.log('FaceMesh results:', {
                    hasResults: !!results,
                    hasFace: hasFace,
                    landmarksCount: hasFace ? results.multiFaceLandmarks[0].length : 0
                });
                
                deepLog('FACEMESH', 'FaceMesh results received', {
                    hasResults: !!results,
                    hasImage: !!results.image,
                    multiFaceLandmarks: results.multiFaceLandmarks?.length || 0,
                    fallbackActive: this.fallbackActive,
                    renderLoopActive: this.renderLoopActive
                });
                
                // If we have face landmarks, disable fallback temporarily to apply filter
                if (hasFace) {
                    console.log('✓ FACE DETECTED! Applying UV filter');
                    deepLog('FACEMESH', 'Face detected! Applying UV filter');
                    // Temporarily disable fallback to render UV filter
                    this.fallbackActive = false;
                    this.processFrame(results);
                } else {
                    console.log('No face detected');
                    deepLog('FACEMESH', 'No face detected in results');
                    // Keep fallback active if no face
                }
            });
            
            deepLog('FACEMESH', 'FaceMesh onResults handler set');
            
            // Don't timeout - let it try indefinitely, but switch to fallback if too many failures
            this.faceMeshLoadTimeout = null;
            
            if (typeof Camera !== 'undefined') {
                deepLog('FACEMESH', 'Initializing MediaPipe Camera utility', {
                    videoWidth: this.video.videoWidth,
                    videoHeight: this.video.videoHeight
                });
                
                if (this.video.videoWidth > 0 && this.video.videoHeight > 0) {
                    this.camera = new Camera(this.video, {
                        onFrame: async () => {
                            const now = performance.now();
                            if (now - this.lastFrameTime >= this.frameInterval) {
                                this.lastFrameTime = now;
                                if (!this.isProcessing && this.faceMesh && this.video.readyState >= this.video.HAVE_CURRENT_DATA) {
                                    this.isProcessing = true;
                                    try {
                                        // Always try to send to FaceMesh - don't skip if fallback is active
                                        await this.faceMesh.send({ image: this.video });
                                        // Reset fail count on success
                                        this.faceMeshFailCount = 0;
                                        // Log every 30 frames (once per second at 30fps)
                                        if (this.frameCount % 30 === 0) {
                                            console.log('FaceMesh frame sent successfully, frame:', this.frameCount);
                                        }
                                    } catch (error) {
                                        console.error('FaceMesh.send() ERROR:', error);
                                        deepLog('FACEMESH', 'FaceMesh.send() ERROR', {
                                            name: error.name,
                                            message: error.message,
                                            failCount: this.faceMeshFailCount + 1
                                        });
                                        this.faceMeshFailCount++;
                                        // Switch to fallback after 5 failures (give it more chances)
                                        if (this.faceMeshFailCount >= 5) {
                                            console.warn('FaceMesh failures exceeded, staying in fallback mode');
                                            deepLog('FACEMESH', 'FaceMesh failures exceeded, staying in fallback mode');
                                            // Don't activate hard fallback - just keep fallback active
                                            this.fallbackActive = true;
                                        }
                                    }
                                    this.isProcessing = false;
                                }
                            }
                        },
                        width: this.video.videoWidth,
                        height: this.video.videoHeight
                    });
                    
                    console.log('✓ MediaPipe Camera instance created');
                    deepLog('FACEMESH', 'MediaPipe Camera instance created');
                    
                    this.camera.start();
                    console.log('✓ MediaPipe Camera.start() called');
                    deepLog('FACEMESH', 'MediaPipe Camera.start() called');
                    this.mediaPipeReady = true;
                    console.log('FaceMesh setup complete! Waiting for face detection...');
                } else {
                    deepLog('FACEMESH', 'ERROR: Invalid video dimensions for Camera');
                    this.activateHardFallback('Invalid video dimensions for Camera', false);
                }
            } else {
                deepLog('FACEMESH', 'ERROR: Camera utility not available');
                this.activateHardFallback('Camera utility not available', false);
            }
        } catch (error) {
            deepLog('FACEMESH', 'ERROR in setupFaceMesh', {
                name: error.name,
                message: error.message,
                stack: error.stack
            });
            this.activateHardFallback('setupFaceMesh error: ' + error.message, false);
        }
    }
    
    startImmediateFallback() {
        deepLog('FALLBACK', 'startImmediateFallback() called - starting UV filter render loop');
        
        // Cancel existing render loop if any
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
        
        if (this.renderLoopActive) {
            deepLog('FALLBACK', 'Render loop already active, skipping');
            return;
        }
        
        this.fallbackActive = true;
        this.renderLoopActive = true;
        
        let lastFrameTime = 0;
        const targetFPS = 30;
        const frameInterval = 1000 / targetFPS;
        
        const drawFrame = () => {
            try {
                const now = performance.now();
                const elapsed = now - lastFrameTime;
                
                // Throttle to target FPS
                if (elapsed < frameInterval) {
                    this.animationFrame = requestAnimationFrame(drawFrame);
                    return;
                }
                lastFrameTime = now;
                
                if (!this.video || !this.ctx) {
                    this.animationFrame = requestAnimationFrame(drawFrame);
                    return;
                }
                
                // Check video state
                const videoReady = this.video.readyState >= this.video.HAVE_CURRENT_DATA;
                const hasDimensions = this.video.videoWidth > 0 && this.video.videoHeight > 0;
                
                if (videoReady && hasDimensions) {
                    // Apply UV filter to entire video feed
                    this.applyUVFilterToEntireFrame();
                    this.frameCount++;
                }
                
                this.animationFrame = requestAnimationFrame(drawFrame);
                } catch (error) {
                deepLog('FALLBACK', 'ERROR in UV filter drawFrame', {
                    name: error.name,
                    message: error.message
                });
                this.animationFrame = requestAnimationFrame(drawFrame);
            }
        };
        
        deepLog('FALLBACK', 'Starting UV filter render loop');
        drawFrame();
    }
    
    applyUVFilterToEntireFrame() {
        try {
            if (!this.ctx || !this.video || this.video.readyState < this.video.HAVE_CURRENT_DATA) {
                return;
            }
            
            // Get display dimensions (accounting for device pixel ratio)
            const devicePixelRatio = window.devicePixelRatio || 1;
            const dpr = Math.min(devicePixelRatio, 2);
            const displayWidth = this.canvas.width / dpr;
            const displayHeight = this.canvas.height / dpr;
            
            // Clear canvas
            this.ctx.fillStyle = '#000';
            this.ctx.fillRect(0, 0, displayWidth, displayHeight);
            
            // Draw video frame (mirrored) at display size
            this.ctx.save();
            this.ctx.scale(-1, 1);
            this.ctx.drawImage(this.video, -displayWidth, 0, displayWidth, displayHeight);
            this.ctx.restore();
            
            // Get image data for processing (at full internal resolution)
            const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
            const data = imageData.data;
            
            // Apply light smoothing for softer image (before inversion)
            this.applyLightSmoothing(imageData);
            
            // Apply UV filter to every pixel - simple color inversion
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                
                // Detect sunscreen - very bright/white areas (sunscreen is usually white/light cream)
                // Sunscreen blocks UV light, so it appears black in UV view
                const brightness = (r + g + b) / 3;
                // Check for white/light cream color (high brightness, low saturation)
                const maxChannel = Math.max(r, g, b);
                const minChannel = Math.min(r, g, b);
                const saturation = maxChannel > 0 ? (maxChannel - minChannel) / maxChannel : 0;
                const isSunscreen = brightness > 180 && saturation < 0.3; // Bright and low saturation = sunscreen
                
                if (isSunscreen) {
                    // Sunscreen blocks UV - appears black in UV view
                    data[i] = 0;     // R
                    data[i + 1] = 0; // G
                    data[i + 2] = 0; // B
                    continue;
                }
                
                // Color inversion - prevent pure black for bright backgrounds (walls, roof)
                // Bright areas should invert to dark but not pure black
                let invertedR = 255 - r;
                let invertedG = 255 - g;
                let invertedB = 255 - b;
                
                // Calculate original brightness to detect bright backgrounds
                const originalBrightness = (r + g + b) / 3;
                const invertedBrightness = (invertedR + invertedG + invertedB) / 3;
                
                // If original was very bright (walls, roof, background), 
                // prevent pure black and keep some color information
                if (originalBrightness > 200) {
                    // Very bright areas (white walls, roof) - invert but keep minimum values
                    const minValue = 40; // Higher minimum for bright backgrounds
                    invertedR = Math.max(minValue, invertedR);
                    invertedG = Math.max(minValue, invertedG);
                    invertedB = Math.max(minValue, invertedB);
                } else if (originalBrightness > 150) {
                    // Moderately bright areas - prevent pure black
                    const minValue = 25;
                    invertedR = Math.max(minValue, invertedR);
                    invertedG = Math.max(minValue, invertedG);
                    invertedB = Math.max(minValue, invertedB);
                } else if (invertedBrightness < 30) {
                    // Very dark after inversion (was very bright) - add minimum with blue tint
                    const minValue = 20;
                    invertedR = Math.max(minValue, invertedR * 0.4);
                    invertedG = Math.max(minValue, invertedG * 0.6);
                    invertedB = Math.max(minValue, invertedB * 0.8);
                } else if (invertedBrightness < 60) {
                    // Light shadows - prevent pure black
                    const minValue = 15;
                    invertedR = Math.max(minValue, invertedR * 0.7);
                    invertedG = Math.max(minValue, invertedG * 0.8);
                    invertedB = Math.max(minValue, invertedB * 0.9);
                }
                
                data[i] = invertedR;
                data[i + 1] = invertedG;
                data[i + 2] = invertedB;
            }
            
            // No contrast adjustment - pure inversion only
            
            // Put processed image back
            this.ctx.putImageData(imageData, 0, 0);
            
            // Draw logo in bottom right corner
            this.drawLogo();
            
        } catch (error) {
            deepLog('RENDER', 'ERROR in applyUVFilterToEntireFrame', {
                name: error.name,
                message: error.message
            });
        }
    }
    
    activateHardFallback(reason, stopMediaPipeOnly = true) {
        deepLog('FALLBACK', 'activateHardFallback() called', {
            reason,
            stopMediaPipeOnly,
            currentState: {
                fallbackActive: this.fallbackActive,
                renderLoopActive: this.renderLoopActive,
                mediaPipeReady: this.mediaPipeReady,
                streamActive: this.streamActive
            }
        });
        
        // Cancel existing render loop
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
            deepLog('FALLBACK', 'Cancelled existing animation frame');
        }
        
        this.fallbackActive = true;
        this.renderLoopActive = true;
        
        if (this.faceMeshLoadTimeout) {
            clearTimeout(this.faceMeshLoadTimeout);
            this.faceMeshLoadTimeout = null;
            deepLog('FALLBACK', 'FaceMesh timeout cleared');
        }
        
        if (this.camera && stopMediaPipeOnly) {
            try {
                this.camera.stop();
                deepLog('FALLBACK', 'MediaPipe Camera utility stopped (stream remains alive)');
            } catch (e) {
                deepLog('FALLBACK', 'Error stopping MediaPipe camera utility', {
                    name: e.name,
                    message: e.message
                });
            }
        }
        
        deepLog('FALLBACK', 'Camera stream remains active - switching to fallback rendering');
        this.logStreamState();
        this.logVideoState();
        
        const drawFrame = () => {
            try {
                if (!this.video || !this.ctx) {
                    deepLog('FALLBACK', 'Missing video or ctx');
                    this.animationFrame = requestAnimationFrame(drawFrame);
                    return;
                }
                
                if (this.video.readyState >= this.video.HAVE_CURRENT_DATA && this.video.videoWidth > 0) {
                    this.drawRawVideoFrame();
                } else {
                    deepLog('FALLBACK', 'Video not ready for rendering', {
                        hasVideo: !!this.video,
                        readyState: this.video?.readyState,
                        videoWidth: this.video?.videoWidth,
                        videoHeight: this.video?.videoHeight,
                        hasSrcObject: !!this.video?.srcObject
                    });
                }
                this.animationFrame = requestAnimationFrame(drawFrame);
                } catch (error) {
                deepLog('FALLBACK', 'ERROR in hard fallback drawFrame', {
                    name: error.name,
                    message: error.message,
                    stack: error.stack
                });
                this.animationFrame = requestAnimationFrame(drawFrame);
            }
        };
        
        deepLog('FALLBACK', 'Starting hard fallback render loop');
        drawFrame();
    }
    
    drawRawVideoFrame() {
        try {
            if (!this.ctx || !this.video) {
                deepLog('RENDER', 'ERROR: Missing ctx or video in drawRawVideoFrame');
                return;
            }
            
            // Health check every 60 frames
            if (this.frameCount % 60 === 0) {
                const now = performance.now();
                if (now - this.lastHealthCheck > 2000) {
                    this.lastHealthCheck = now;
                    deepLog('RENDER', 'Health check', {
                        frameCount: this.frameCount,
                        videoReadyState: this.video.readyState,
                        videoWidth: this.video.videoWidth,
                        videoHeight: this.video.videoHeight,
                        videoPaused: this.video.paused,
                        streamActive: this.streamActive,
                        hasSrcObject: !!this.video.srcObject
                    });
                    this.logStreamState();
                }
            }
            
            // Clear canvas
            this.ctx.fillStyle = '#000';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            
            // Draw video (mirrored)
            this.ctx.save();
            this.ctx.scale(-1, 1);
            this.ctx.drawImage(this.video, -this.canvas.width, 0, this.canvas.width, this.canvas.height);
            this.ctx.restore();
            
            // Draw logo in bottom right corner
            this.drawLogo();
            
            this.frameCount++;
            
            // Log every 300 frames (every ~10 seconds at 30fps)
            if (this.frameCount % 300 === 0) {
                const now = performance.now();
                if (now - this.lastLogTime > 10000) {
                    deepLog('RENDER', 'Frame render', {
                        frameCount: this.frameCount,
                        readyState: this.video.readyState,
                        dimensions: `${this.video.videoWidth}x${this.video.videoHeight}`,
                        canvasDimensions: `${this.canvas.width}x${this.canvas.height}`
                    });
                    this.lastLogTime = now;
                }
            }
        } catch (error) {
            deepLog('RENDER', 'ERROR in drawRawVideoFrame', {
                name: error.name,
                message: error.message,
                stack: error.stack
            });
        }
    }
    
    drawDebugOverlay(text) {
        try {
            if (!this.ctx) return;
            
            this.ctx.strokeStyle = '#ff0000';
            this.ctx.lineWidth = 3;
            this.ctx.strokeRect(10, 10, 200, 100);
            
            this.ctx.fillStyle = '#ffffff';
            this.ctx.font = '16px Arial';
            this.ctx.fillText('VIDEO OK', 20, 35);
            this.ctx.fillText('FRAME OK', 20, 55);
            
            this.ctx.fillText('UV CAMERA MODE', 20, 75);
            
            if (text) {
                this.ctx.fillText(text.substring(0, 40), 20, 95);
            }
        } catch (error) {
            deepLog('RENDER', 'ERROR in drawDebugOverlay', {
                name: error.name,
                message: error.message
            });
        }
    }
    
    processFrame(results) {
        try {
            if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
                // No face - keep using last landmarks if available, otherwise switch to fallback
                if (this.lastLandmarks) {
                    // Keep rendering with last known landmarks
                    return;
                } else if (!this.fallbackActive) {
                    this.fallbackActive = true;
                    this.startImmediateFallback();
                }
                return;
            }
            
            this.lastFaceDetected = Date.now();
            if (this.faceMeshLoadTimeout) {
                clearTimeout(this.faceMeshLoadTimeout);
                this.faceMeshLoadTimeout = null;
            }
            
            // Disable fallback to apply UV filter
            this.fallbackActive = false;
            
            const landmarks = results.multiFaceLandmarks[0];
            
            // Store landmarks for continuous rendering
            this.lastLandmarks = landmarks;
            
            // Apply UV filter immediately
            this.applyUVFilter(landmarks);
            
            // Start continuous UV filter render loop if not already running
            if (!this.renderLoopActive) {
                this.renderLoopActive = true;
                // Cancel any existing animation frame first
                if (this.animationFrame) {
                    cancelAnimationFrame(this.animationFrame);
                }
                
                const drawUVFrame = () => {
                    if (this.fallbackActive) {
                        this.renderLoopActive = false;
                        return; // Stop if fallback reactivated
                    }
                    
                    // Re-apply UV filter with last known landmarks
                    if (this.lastLandmarks && this.video && this.video.readyState >= this.video.HAVE_CURRENT_DATA) {
                        this.applyUVFilter(this.lastLandmarks);
                    } else if (!this.lastLandmarks) {
                        // No landmarks - switch to fallback
                        this.fallbackActive = true;
                        this.renderLoopActive = false;
                        this.startImmediateFallback();
                        return;
                    }
                    
                    this.animationFrame = requestAnimationFrame(drawUVFrame);
                };
                this.animationFrame = requestAnimationFrame(drawUVFrame);
                deepLog('PROCESS', 'Started UV filter render loop');
            }
        } catch (error) {
            deepLog('PROCESS', 'ERROR in processFrame', {
                name: error.name,
                message: error.message,
                stack: error.stack
            });
            // Reactivate fallback on error
            if (!this.renderLoopActive) {
                this.fallbackActive = true;
                this.startImmediateFallback();
            }
        }
    }
    
    drawInvertedFrame() {
        try {
            if (!this.ctx || !this.video || this.video.readyState < this.video.HAVE_CURRENT_DATA) {
                deepLog('RENDER', 'Cannot draw inverted frame - video not ready', {
                    hasCtx: !!this.ctx,
                    hasVideo: !!this.video,
                    readyState: this.video?.readyState
                });
                return;
            }
            
            this.ctx.save();
            this.ctx.scale(-1, 1);
            this.ctx.drawImage(this.video, -this.canvas.width, 0, this.canvas.width, this.canvas.height);
            this.ctx.restore();
            
            const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
            this.invertColors(imageData);
            this.ctx.putImageData(imageData, 0, 0);
            
            // Inverted mode active
        } catch (error) {
            deepLog('RENDER', 'ERROR in drawInvertedFrame', {
                name: error.name,
                message: error.message
            });
        }
    }
    
    applyUVFilter(landmarks) {
        try {
            if (!this.ctx || !this.video || this.video.readyState < this.video.HAVE_CURRENT_DATA) {
                deepLog('RENDER', 'Cannot apply UV filter - video not ready', {
                    hasCtx: !!this.ctx,
                    hasVideo: !!this.video,
                    readyState: this.video?.readyState
                });
                return;
            }
            
            deepLog('RENDER', 'Applying UV filter', {
                landmarksCount: landmarks.length,
                canvasSize: `${this.canvas.width}x${this.canvas.height}`,
                videoSize: `${this.video.videoWidth}x${this.video.videoHeight}`
            });
            
            // Clear canvas first
            this.ctx.fillStyle = '#000';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            
            this.ctx.save();
            this.ctx.scale(-1, 1);
            this.ctx.drawImage(this.video, -this.canvas.width, 0, this.canvas.width, this.canvas.height);
            this.ctx.restore();
            
            const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
            const data = imageData.data;
            
            const skinMask = this.createSkinMask(landmarks, this.canvas.width, this.canvas.height);
            const eyeMask = this.createEyeMask(landmarks, this.canvas.width, this.canvas.height);
            const lipMask = this.createLipMask(landmarks, this.canvas.width, this.canvas.height);
            const eyebrowMask = this.createEyebrowMask(landmarks, this.canvas.width, this.canvas.height);
            
            for (let i = 0; i < data.length; i += 4) {
                const x = (i / 4) % this.canvas.width;
                const y = Math.floor((i / 4) / this.canvas.width);
                
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                
                const idx = Math.floor(y) * this.canvas.width + Math.floor(x);
                const skinValue = skinMask[idx] || 0;
                const eyeValue = eyeMask[idx] || 0;
                const lipValue = lipMask[idx] || 0;
                const eyebrowValue = eyebrowMask[idx] || 0;
                
                if (eyeValue > 0.1) {
                    const inverted = this.invertPixel(r, g, b);
                    const uvColor = this.applyUVLUT(inverted.r, inverted.g, inverted.b, 'eye');
                    data[i] = uvColor.r;
                    data[i + 1] = uvColor.g;
                    data[i + 2] = uvColor.b;
                } else if (lipValue > 0.1) {
                    const inverted = this.invertPixel(r, g, b);
                    const uvColor = this.applyUVLUT(inverted.r, inverted.g, inverted.b, 'lip');
                    data[i] = uvColor.r;
                    data[i + 1] = uvColor.g;
                    data[i + 2] = uvColor.b;
                } else if (eyebrowValue > 0.1) {
                    const inverted = this.invertPixel(r, g, b);
                    const uvColor = this.applyUVLUT(inverted.r, inverted.g, inverted.b, 'hair');
                    data[i] = this.lerp(r, uvColor.r, 0.3);
                    data[i + 1] = this.lerp(g, uvColor.g, 0.3);
                    data[i + 2] = this.lerp(b, uvColor.b, 0.3);
                } else if (skinValue > 0.1) {
                    const inverted = this.invertPixel(r, g, b);
                    const uvColor = this.applyUVLUT(inverted.r, inverted.g, inverted.b, 'skin');
                    const blend = skinValue;
                    data[i] = this.lerp(r, uvColor.r, blend);
                    data[i + 1] = this.lerp(g, uvColor.g, blend);
                    data[i + 2] = this.lerp(b, uvColor.b, blend);
                } else {
                    const inverted = this.invertPixel(r, g, b);
                    const uvColor = this.applyUVLUT(inverted.r, inverted.g, inverted.b, 'hair');
                    data[i] = uvColor.r;
                    data[i + 1] = uvColor.g;
                    data[i + 2] = uvColor.b;
                }
            }
            
            this.applyContrast(imageData, 1.8);
            this.applySoftBlur(imageData, skinMask, 2);
            
            this.ctx.putImageData(imageData, 0, 0);
            // UV filter active
            
            this.frameCount++;
        } catch (error) {
            deepLog('RENDER', 'ERROR in applyUVFilter', {
                name: error.name,
                message: error.message,
                stack: error.stack
            });
            this.drawInvertedFrame();
        }
    }
    
    createSkinMask(landmarks, width, height) {
        const mask = new Float32Array(width * height);
        const skinPoints = this.skinLandmarks.map(idx => {
            if (idx < landmarks.length) {
                const landmark = landmarks[idx];
                return {
                    x: landmark.x * width,
                    y: landmark.y * height
                };
            }
            return null;
        }).filter(p => p !== null);
        
        if (skinPoints.length === 0) return mask;
        
        const step = 2;
        for (let y = 0; y < height; y += step) {
            for (let x = 0; x < width; x += step) {
                const dist = this.distanceToPolygon(x, y, skinPoints);
                const value = Math.max(0, 1 - dist / 60);
                const idx = y * width + x;
                mask[idx] = value;
                if (x + 1 < width) mask[idx + 1] = value;
                if (y + 1 < height) mask[(y + 1) * width + x] = value;
            }
        }
        
        return mask;
    }
    
    createEyeMask(landmarks, width, height) {
        const mask = new Float32Array(width * height);
        const eyeIndices = [...this.eyeLandmarks.left, ...this.eyeLandmarks.right];
        
        const eyePoints = eyeIndices
            .filter(idx => idx < landmarks.length)
            .map(idx => {
                const landmark = landmarks[idx];
                return {
                    x: landmark.x * width,
                    y: landmark.y * height
                };
            });
        
        if (eyePoints.length === 0) return mask;
        
        const step = 1;
        for (let y = 0; y < height; y += step) {
            for (let x = 0; x < width; x += step) {
                const dist = this.distanceToPolygon(x, y, eyePoints);
                if (dist < 30) {
                    mask[y * width + x] = Math.max(0, 1 - dist / 25);
                }
            }
        }
        
        return mask;
    }
    
    createLipMask(landmarks, width, height) {
        const mask = new Float32Array(width * height);
        const lipIndices = this.lipLandmarks;
        
        const lipPoints = lipIndices
            .filter(idx => idx < landmarks.length)
            .map(idx => {
                const landmark = landmarks[idx];
                return {
                    x: landmark.x * width,
                    y: landmark.y * height
                };
            });
        
        if (lipPoints.length === 0) return mask;
        
        const step = 1;
        for (let y = 0; y < height; y += step) {
            for (let x = 0; x < width; x += step) {
                const dist = this.distanceToPolygon(x, y, lipPoints);
                if (dist < 25) {
                    mask[y * width + x] = Math.max(0, 1 - dist / 20);
                }
            }
        }
        
        return mask;
    }
    
    createEyebrowMask(landmarks, width, height) {
        const mask = new Float32Array(width * height);
        const eyebrowIndices = [...this.eyebrowLandmarks.left, ...this.eyebrowLandmarks.right];
        
        const eyebrowPoints = eyebrowIndices
            .filter(idx => idx < landmarks.length)
            .map(idx => {
                const landmark = landmarks[idx];
                return {
                    x: landmark.x * width,
                    y: landmark.y * height
                };
            });
        
        if (eyebrowPoints.length === 0) return mask;
        
        const step = 1;
        for (let y = 0; y < height; y += step) {
            for (let x = 0; x < width; x += step) {
                const dist = this.distanceToPolygon(x, y, eyebrowPoints);
                if (dist < 20) {
                    mask[y * width + x] = Math.max(0, 1 - dist / 15);
                }
            }
        }
        
        return mask;
    }
    
    distanceToPolygon(x, y, points) {
        if (points.length === 0) return Infinity;
        
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            const xi = points[i].x, yi = points[i].y;
            const xj = points[j].x, yj = points[j].y;
            
            const intersect = ((yi > y) !== (yj > y)) && 
                            (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        
        if (inside) return 0;
        
        let minDist = Infinity;
        for (let i = 0; i < points.length; i++) {
            const p1 = points[i];
            const p2 = points[(i + 1) % points.length];
            const dist = this.pointToLineDistance(x, y, p1.x, p1.y, p2.x, p2.y);
            minDist = Math.min(minDist, dist);
        }
        
        return minDist;
    }
    
    pointToLineDistance(px, py, x1, y1, x2, y2) {
        const A = px - x1;
        const B = py - y1;
        const C = x2 - x1;
        const D = y2 - y1;
        
        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = -1;
        
        if (lenSq !== 0) param = dot / lenSq;
        
        let xx, yy;
        
        if (param < 0) {
            xx = x1;
            yy = y1;
        } else if (param > 1) {
            xx = x2;
            yy = y2;
        } else {
            xx = x1 + param * C;
            yy = y1 + param * D;
        }
        
        const dx = px - xx;
        const dy = py - yy;
        return Math.sqrt(dx * dx + dy * dy);
    }
    
    invertPixel(r, g, b) {
        return {
            r: 255 - r,
            g: 255 - g,
            b: 255 - b
        };
    }
    
    applyUVLUT(r, g, b, type) {
        switch (type) {
            case 'skin':
                // Match TikTok UV filter: pale white skin with deep blue/purple shadows
                // Original inverted colors are used to create the UV effect
                const brightness = (r + g + b) / 3;
                
                // Bright areas (normal skin) -> pale white/light blue
                // Dark areas (shadows, sun damage) -> deep blue/purple
                if (brightness > 128) {
                    // Bright areas: pale white with slight blue tint
                    return {
                        r: Math.min(255, Math.max(200, brightness * 0.9 + r * 0.1)),
                        g: Math.min(255, Math.max(200, brightness * 0.85 + g * 0.15)),
                        b: Math.min(255, Math.max(220, brightness * 0.95 + b * 0.15))
                    };
                } else {
                    // Dark areas: deep blue/purple (shadows, sun damage)
                    return {
                        r: Math.min(255, Math.max(0, r * 0.3 + b * 0.2)),
                        g: Math.min(255, Math.max(0, g * 0.4 + b * 0.3)),
                        b: Math.min(255, Math.max(80, b * 1.2 + r * 0.3))
                    };
                }
            case 'eye':
                // Glowing white eyes with dark pupils
                const eyeBrightness = (r + g + b) / 3;
                if (eyeBrightness > 100) {
                    // Bright eyes -> glowing white
                    return {
                        r: Math.min(255, eyeBrightness * 1.5),
                        g: Math.min(255, eyeBrightness * 1.5),
                        b: Math.min(255, eyeBrightness * 1.5)
                    };
                } else {
                    // Dark pupils -> very dark
                    return {
                        r: Math.max(0, eyeBrightness * 0.3),
                        g: Math.max(0, eyeBrightness * 0.3),
                        b: Math.max(0, eyeBrightness * 0.3)
                    };
                }
            case 'lip':
                return {
                    r: Math.min(255, Math.max(0, g * 0.5 + r * 0.2)),
                    g: Math.min(255, Math.max(0, g * 0.9 + b * 0.2)),
                    b: Math.min(255, Math.max(0, g * 0.4 + b * 0.3))
                };
            case 'hair':
                const hairBrightness = (r + g + b) / 3;
                return {
                    r: Math.min(255, hairBrightness * 1.15),
                    g: Math.min(255, hairBrightness * 1.15),
                    b: Math.min(255, hairBrightness * 1.15)
                };
            default:
                return { r, g, b };
        }
    }
    
    applyContrast(imageData, contrast) {
        const data = imageData.data;
        const factor = (259 * (contrast * 255 + 255)) / (255 * (259 - contrast * 255));
        
        for (let i = 0; i < data.length; i += 4) {
            data[i] = this.clamp(factor * (data[i] - 128) + 128);
            data[i + 1] = this.clamp(factor * (data[i + 1] - 128) + 128);
            data[i + 2] = this.clamp(factor * (data[i + 2] - 128) + 128);
        }
    }
    
    applySoftBlur(imageData, mask, radius) {
        const data = imageData.data;
        const width = imageData.width;
        const height = imageData.height;
        const tempData = new Uint8ClampedArray(data);
        
        const step = 2;
        
        for (let y = radius; y < height - radius; y += step) {
            for (let x = radius; x < width - radius; x += step) {
                const idx = y * width + x;
                const maskVal = mask[idx];
                
                if (maskVal > 0.15 && maskVal < 0.85) {
                    let rSum = 0, gSum = 0, bSum = 0, count = 0;
                    
                    for (let dy = -radius; dy <= radius; dy++) {
                        for (let dx = -radius; dx <= radius; dx++) {
                            const dist = Math.sqrt(dx * dx + dy * dy);
                            if (dist <= radius) {
                                const nIdx = (y + dy) * width + (x + dx);
                                const weight = 1 - (dist / radius) * 0.5;
                                rSum += tempData[nIdx * 4] * weight;
                                gSum += tempData[nIdx * 4 + 1] * weight;
                                bSum += tempData[nIdx * 4 + 2] * weight;
                                count += weight;
                            }
                        }
                    }
                    
                    if (count > 0) {
                        const blend = 1 - Math.abs(maskVal - 0.5) * 2;
                        data[idx * 4] = this.lerp(data[idx * 4], rSum / count, blend * 0.25);
                        data[idx * 4 + 1] = this.lerp(data[idx * 4 + 1], gSum / count, blend * 0.25);
                        data[idx * 4 + 2] = this.lerp(data[idx * 4 + 2], bSum / count, blend * 0.25);
                    }
                }
            }
        }
    }
    
    applyLightSmoothing(imageData) {
        // Light smoothing filter for softer, smoother image
        // Uses a small 3x3 Gaussian-like kernel for subtle blur
        const data = imageData.data;
        const width = imageData.width;
        const height = imageData.height;
        const tempData = new Uint8ClampedArray(data);
        
        // Process every pixel with a 3x3 smoothing kernel
        const radius = 1;
        for (let y = radius; y < height - radius; y++) {
            for (let x = radius; x < width - radius; x++) {
                let rSum = 0, gSum = 0, bSum = 0, count = 0;
                
                // 3x3 kernel with center weight
                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        const idx = ((y + dy) * width + (x + dx)) * 4;
                        // Center pixel has more weight (5), edges have weight 1
                        const weight = (dx === 0 && dy === 0) ? 5 : 1;
                        rSum += tempData[idx] * weight;
                        gSum += tempData[idx + 1] * weight;
                        bSum += tempData[idx + 2] * weight;
                        count += weight;
                    }
                }
                
                // Blend 70% smoothed, 30% original for light smoothing
                const idx = (y * width + x) * 4;
                data[idx] = data[idx] * 0.3 + (rSum / count) * 0.7;
                data[idx + 1] = data[idx + 1] * 0.3 + (gSum / count) * 0.7;
                data[idx + 2] = data[idx + 2] * 0.3 + (bSum / count) * 0.7;
            }
        }
    }
    
    clamp(value) {
        return Math.max(0, Math.min(255, value));
    }
    
    lerp(a, b, t) {
        return a + (b - a) * t;
    }
    
    invertColors(imageData) {
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            data[i] = 255 - data[i];
            data[i + 1] = 255 - data[i + 1];
            data[i + 2] = 255 - data[i + 2];
        }
    }
}

// Initialize filter
console.log('=== SETTING UP WINDOW LOAD LISTENER ===');

window.addEventListener('load', () => {
    console.log('=== WINDOW LOAD EVENT FIRED ===');
    deepLog('INIT', 'Window load event fired');
    
    console.log('MediaPipe check:', {
        FaceMesh: typeof FaceMesh,
        Camera: typeof Camera
    });
    deepLog('INIT', 'MediaPipe availability', {
        FaceMesh: typeof FaceMesh,
        Camera: typeof Camera
    });
    
    console.log('Global state:', {
        cameraInitialized: window.cameraInitialized,
        uvFilterInstance: !!window.uvFilterInstance
    });
    deepLog('INIT', 'Global state', {
        cameraInitialized: window.cameraInitialized,
        uvFilterInstance: !!window.uvFilterInstance
    });
    
    if (window.uvFilterInstance) {
        console.warn('WARNING: Instance already exists, skipping initialization');
        deepLog('INIT', 'WARNING: Instance already exists, skipping initialization');
        return;
    }
    
    console.log('Waiting 100ms before initializing...');
    setTimeout(() => {
        console.log('=== INITIALIZING UVFaceFilter ===');
        deepLog('INIT', 'Initializing UVFaceFilter after timeout');
        deepLog('INIT', 'MediaPipe after timeout', {
            FaceMesh: typeof FaceMesh,
            Camera: typeof Camera
        });
        try {
            new UVFaceFilter();
            console.log('✓ UVFaceFilter instance created');
        } catch (error) {
            console.error('ERROR creating UVFaceFilter:', error);
            console.error('Error stack:', error.stack);
        }
    }, 100);
});

// Also try immediate initialization if DOM is already ready
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    console.log('DOM already ready, initializing immediately');
    setTimeout(() => {
        if (!window.uvFilterInstance) {
            console.log('=== INITIALIZING UVFaceFilter (DOM ready) ===');
            try {
                new UVFaceFilter();
                console.log('✓ UVFaceFilter instance created (DOM ready)');
            } catch (error) {
                console.error('ERROR creating UVFaceFilter (DOM ready):', error);
            }
        }
    }, 100);
}

// Expose debug logs globally
window.getDebugLogs = () => {
    console.log('=== DEBUG LOGS ===');
    window.debugLogs.forEach(log => {
        console.log(`[${log.timestamp}] [${log.category}] ${log.message}`, log.data);
    });
    console.log('=== END DEBUG LOGS ===');
    return window.debugLogs;
};
