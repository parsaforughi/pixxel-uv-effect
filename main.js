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
        
        // Temporal smoothing for face tracking stability (EMA)
        this.landmarkHistory = []; // Store last 5 frames of landmarks
        this.maxHistoryFrames = 5;
        this.smoothingAlpha = 0.75; // EMA factor (higher = more smoothing, more stable)
        this.emaLandmarks = null; // Exponential moving average state
        
        // Temporal color stability (70% previous, 30% current) - ONLY for processed skin
        this.lastProcessedSkin = null; // Store previous frame's processed skin colors
        this.colorSmoothingAlpha = 0.7; // 70% previous frame, 30% current frame
        
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
                const x = this.canvas.width - logoSize - padding;
                const y = this.canvas.height - logoSize - padding;
                
                // Draw with semi-transparent background for visibility
                this.ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
                this.ctx.fillRect(x - 5, y - 5, logoSize + 10, logoSize + 10);
                
                // Draw logo image
                this.ctx.drawImage(this.logoImage, x, y, logoSize, logoSize);
            } else {
                // Draw text logo as fallback
                const text = 'UV';
                const fontSize = isMobile ? 20 : 24;
                const x = this.canvas.width - padding;
                const y = this.canvas.height - padding;
                
                // Draw text with shadow for visibility
                this.ctx.font = `bold ${fontSize}px Arial`;
                this.ctx.textAlign = 'right';
                this.ctx.textBaseline = 'bottom';
                
                // Shadow
                this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
                this.ctx.fillText(text, x + 2, y + 2);
                
                // Text
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
                    width: { ideal: 1280, min: 640 },
                    height: { ideal: 720, min: 480 }
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
        
        if (videoAspect > windowAspect) {
            this.canvas.width = windowWidth;
            this.canvas.height = windowWidth / videoAspect;
        } else {
            this.canvas.width = windowHeight * videoAspect;
            this.canvas.height = windowHeight;
        }
        
        deepLog('CANVAS', 'Canvas dimensions set', {
            width: this.canvas.width,
            height: this.canvas.height
        });
        
        this.canvas.style.width = '100vw';
        this.canvas.style.height = '100vh';
        this.canvas.style.objectFit = 'cover';
        
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
            
            // Clear canvas
            this.ctx.fillStyle = '#000';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            
            // Draw video frame (mirrored)
            this.ctx.save();
            this.ctx.scale(-1, 1);
            this.ctx.drawImage(this.video, -this.canvas.width, 0, this.canvas.width, this.canvas.height);
            this.ctx.restore();
            
            // Get image data for processing
            const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
            const data = imageData.data;
            
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
                
                // Invert colors first
                const invertedR = 255 - r;
                const invertedG = 255 - g;
                const invertedB = 255 - b;
                
                // Filter to only green and blue tones - remove red spectrum
                // Keep green and blue channels, reduce/remove red
                const greenBlueOnly = {
                    r: Math.min(255, invertedG * 0.3),      // Minimal red from green
                    g: Math.min(255, invertedG * 1.0),      // Full green
                    b: Math.min(255, invertedB * 1.0)       // Full blue
                };
                
                data[i] = greenBlueOnly.r;
                data[i + 1] = greenBlueOnly.g;
                data[i + 2] = greenBlueOnly.b;
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
    
    // Temporal smoothing using Exponential Moving Average (EMA) for stable face tracking
    smoothLandmarks(newLandmarks) {
        if (!newLandmarks || newLandmarks.length === 0) {
            return this.lastLandmarks || this.emaLandmarks; // Return last known if no new data
        }
        
        // Initialize EMA state if first frame
        if (!this.emaLandmarks) {
            this.emaLandmarks = newLandmarks.map(l => ({ ...l }));
            return this.emaLandmarks;
        }
        
        // Apply EMA: smoothed = alpha * previous + (1 - alpha) * current
        // Higher alpha = more smoothing (more stable, less responsive)
        const alpha = this.smoothingAlpha;
        const smoothed = [];
        
        for (let i = 0; i < newLandmarks.length; i++) {
            smoothed.push({
                x: alpha * this.emaLandmarks[i].x + (1 - alpha) * newLandmarks[i].x,
                y: alpha * this.emaLandmarks[i].y + (1 - alpha) * newLandmarks[i].y,
                z: (this.emaLandmarks[i].z !== undefined && newLandmarks[i].z !== undefined) 
                    ? alpha * this.emaLandmarks[i].z + (1 - alpha) * newLandmarks[i].z
                    : newLandmarks[i].z
            });
        }
        
        // Update EMA state
        this.emaLandmarks = smoothed;
        
        // Also maintain history for additional stability
        this.landmarkHistory.push(smoothed);
        if (this.landmarkHistory.length > this.maxHistoryFrames) {
            this.landmarkHistory.shift();
        }
        
        return smoothed;
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
            
            const rawLandmarks = results.multiFaceLandmarks[0];
            
            // Apply temporal smoothing for stable face lock
            const smoothedLandmarks = this.smoothLandmarks(rawLandmarks);
            
            // Store smoothed landmarks for continuous rendering
            this.lastLandmarks = smoothedLandmarks;
            
            // Apply UV filter immediately with smoothed landmarks
            this.applyUVFilter(smoothedLandmarks);
            
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
                return;
            }
            
            const width = this.canvas.width;
            const height = this.canvas.height;
            
            // STEP 1: Capture raw camera frame (NO invert yet)
            this.ctx.fillStyle = '#000';
            this.ctx.fillRect(0, 0, width, height);
            this.ctx.save();
            this.ctx.scale(-1, 1);
            this.ctx.drawImage(this.video, -width, 0, width, height);
            this.ctx.restore();
            
            const originalImageData = this.ctx.getImageData(0, 0, width, height);
            const originalData = new Uint8ClampedArray(originalImageData.data);
            
            // STEP 2: Face landmarks already detected (passed as parameter)
            
            // STEP 3: Create person segmentation (person mask + background mask)
            const personMask = this.createPersonMask(landmarks, width, height);
            const backgroundMask = this.createBackgroundMask(personMask, width, height);
            
            // STEP 4: Build STRICT binary skin-only mask (exclude everything else)
            const binarySkinMask = this.createStrictBinarySkinMask(landmarks, width, height);
            const eyeMask = this.createEyeMask(landmarks, width, height);
            const lipMask = this.createLipMask(landmarks, width, height);
            
            // STEP 5: Apply adaptive edge feather ONLY to the face skin mask
            const featheredMask = this.applyFeatherToMask(binarySkinMask, landmarks, width, height);
            
            // STEP 6: Process BACKGROUND FIRST - clamp to dark, no UV processing
            const processedBackgroundData = new Uint8ClampedArray(originalData.length);
            for (let i = 0; i < originalData.length; i += 4) {
                const x = (i / 4) % width;
                const y = Math.floor((i / 4) / width);
                const idx = y * width + x;
                const bgMaskValue = backgroundMask[idx] || 0;
                
                if (bgMaskValue > 0.5) {
                    // Background pixel - apply clamping
                    const r = originalData[i];
                    const g = originalData[i + 1];
                    const b = originalData[i + 2];
                    
                    // Calculate luminance and saturation
                    const luminance = (r + g + b) / 3;
                    const maxChannel = Math.max(r, g, b);
                    const minChannel = Math.min(r, g, b);
                    const saturation = maxChannel > 0 ? (maxChannel - minChannel) / maxChannel : 0;
                    
                    // Shadow suppression: dark, low-saturation pixels → pure dark background
                    if (luminance < 60 && saturation < 0.3) {
                        // Hard clamp to dark
                        processedBackgroundData[i] = Math.max(0, luminance * 0.3);
                        processedBackgroundData[i + 1] = Math.max(0, luminance * 0.3);
                        processedBackgroundData[i + 2] = Math.max(0, luminance * 0.3);
                    } else {
                        // Slightly darken and desaturate background
                        const darkened = luminance * 0.85; // Slightly darken
                        const desaturated = this.lerp(luminance, maxChannel, saturation * 0.3); // Low saturation
                        processedBackgroundData[i] = this.clamp(darkened);
                        processedBackgroundData[i + 1] = this.clamp(darkened);
                        processedBackgroundData[i + 2] = this.clamp(darkened);
                    }
                    processedBackgroundData[i + 3] = originalData[i + 3];
                } else {
                    // Not background - will be processed later
                    processedBackgroundData[i] = originalData[i];
                    processedBackgroundData[i + 1] = originalData[i + 1];
                    processedBackgroundData[i + 2] = originalData[i + 2];
                    processedBackgroundData[i + 3] = originalData[i + 3];
                }
            }
            
            // STEP 7: Process colors ONLY inside the face skin mask (UV processing)
            const processedSkinData = new Uint8ClampedArray(processedBackgroundData);
            
            for (let i = 0; i < processedBackgroundData.length; i += 4) {
                const x = (i / 4) % width;
                const y = Math.floor((i / 4) / width);
                const idx = y * width + x;
                const maskValue = featheredMask[idx] || 0;
                
                if (maskValue > 0) {
                    // Inside face skin mask - process UV colors
                    const r = originalData[i]; // Use original, not background-processed
                    const g = originalData[i + 1];
                    const b = originalData[i + 2];
                    
                    // 7a) Invert colors (masked region only)
                    let invertedR = 255 - r;
                    let invertedG = 255 - g;
                    let invertedB = 255 - b;
                    
                    // 7b) Apply UV LUT-style remapping
                    const eyeValue = eyeMask[idx] || 0;
                    const lipValue = lipMask[idx] || 0;
                    
                    let uvColor;
                    if (eyeValue > 0.1) {
                        uvColor = this.applyUVLUT(invertedR, invertedG, invertedB, 'eye');
                    } else if (lipValue > 0.1) {
                        uvColor = this.applyUVLUT(invertedR, invertedG, invertedB, 'lip');
                    } else {
                        uvColor = this.applyUVLUT(invertedR, invertedG, invertedB, 'skin');
                    }
                    
                    processedSkinData[i] = uvColor.r;
                    processedSkinData[i + 1] = uvColor.g;
                    processedSkinData[i + 2] = uvColor.b;
                    processedSkinData[i + 3] = originalData[i + 3];
                }
            }
            
            // Create temporary ImageData for S-curve processing
            const tempImageData = new ImageData(processedSkinData, width, height);
            
            // 7c) Apply non-linear S-curve contrast (only to processed skin)
            this.applySCurveContrastToMask(tempImageData, featheredMask);
            
            // 7d) Preserve mid-tones (already handled in S-curve)
            
            // STEP 8: Temporal smoothing - blend CURRENT processed skin with PREVIOUS frame
            if (this.lastProcessedSkin) {
                for (let i = 0; i < processedSkinData.length; i += 4) {
                    const x = (i / 4) % width;
                    const y = Math.floor((i / 4) / width);
                    const idx = y * width + x;
                    const maskValue = featheredMask[idx] || 0;
                    
                    if (maskValue > 0) {
                        // Only blend inside mask: 70% previous + 30% current
                        processedSkinData[i] = this.colorSmoothingAlpha * this.lastProcessedSkin[i] + 
                                               (1 - this.colorSmoothingAlpha) * processedSkinData[i];
                        processedSkinData[i + 1] = this.colorSmoothingAlpha * this.lastProcessedSkin[i + 1] + 
                                                   (1 - this.colorSmoothingAlpha) * processedSkinData[i + 1];
                        processedSkinData[i + 2] = this.colorSmoothingAlpha * this.lastProcessedSkin[i + 2] + 
                                                   (1 - this.colorSmoothingAlpha) * processedSkinData[i + 2];
                    }
                }
            }
            
            // Store current processed skin for next frame
            this.lastProcessedSkin = new Uint8ClampedArray(processedSkinData);
            
            // STEP 9: Composite processed face skin over processed background
            const finalImageData = new ImageData(width, height);
            for (let i = 0; i < originalData.length; i += 4) {
                const x = (i / 4) % width;
                const y = Math.floor((i / 4) / width);
                const idx = y * width + x;
                const maskValue = featheredMask[idx] || 0;
                const bgMaskValue = backgroundMask[idx] || 0;
                
                if (maskValue > 0) {
                    // Face skin - use processed UV colors with mask blend
                    finalImageData.data[i] = this.lerp(processedBackgroundData[i], processedSkinData[i], maskValue);
                    finalImageData.data[i + 1] = this.lerp(processedBackgroundData[i + 1], processedSkinData[i + 1], maskValue);
                    finalImageData.data[i + 2] = this.lerp(processedBackgroundData[i + 2], processedSkinData[i + 2], maskValue);
                    finalImageData.data[i + 3] = originalData[i + 3];
                } else if (bgMaskValue > 0.5) {
                    // Background - use clamped dark background
                    finalImageData.data[i] = processedBackgroundData[i];
                    finalImageData.data[i + 1] = processedBackgroundData[i + 1];
                    finalImageData.data[i + 2] = processedBackgroundData[i + 2];
                    finalImageData.data[i + 3] = originalData[i + 3];
                } else {
                    // Person but not face skin (clothes, etc.) - keep original
                    finalImageData.data[i] = originalData[i];
                    finalImageData.data[i + 1] = originalData[i + 1];
                    finalImageData.data[i + 2] = originalData[i + 2];
                    finalImageData.data[i + 3] = originalData[i + 3];
                }
            }
            
            // STEP 10: Apply very subtle global softness (AFTER compositing)
            this.applySubtleGlobalSoftness(finalImageData, eyeMask, lipMask);
            
            // STEP 11: Apply very subtle vignette (opacity < 6%)
            this.applySubtleVignette(finalImageData);
            
            // Put final image back
            this.ctx.putImageData(finalImageData, 0, 0);
            
            // Draw logo
            this.drawLogo();
            
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
    
    // Create person mask (face + body/clothes, excludes background)
    createPersonMask(landmarks, width, height) {
        const mask = new Float32Array(width * height);
        
        // Get face outline points (jawline, cheeks, forehead)
        const faceOutlineIndices = [
            // Jawline
            172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323,
            // Cheeks
            234, 454, 227, 447,
            // Forehead
            10, 151, 9
        ];
        
        const faceOutlinePoints = faceOutlineIndices
            .filter(idx => idx < landmarks.length)
            .map(idx => ({
                x: landmarks[idx].x * width,
                y: landmarks[idx].y * height
            }));
        
        if (faceOutlinePoints.length === 0) return mask;
        
        // Find bounding box of face
        const faceMinX = Math.min(...faceOutlinePoints.map(p => p.x));
        const faceMaxX = Math.max(...faceOutlinePoints.map(p => p.x));
        const faceMinY = Math.min(...faceOutlinePoints.map(p => p.y));
        const faceMaxY = Math.max(...faceOutlinePoints.map(p => p.y));
        
        // Extend downward to include body/clothes (estimate person area)
        const personMinX = Math.max(0, faceMinX - (faceMaxX - faceMinX) * 0.3);
        const personMaxX = Math.min(width, faceMaxX + (faceMaxX - faceMinX) * 0.3);
        const personMinY = faceMinY;
        const personMaxY = Math.min(height, faceMaxY + (faceMaxY - faceMinY) * 2.5); // Extend down for body
        
        // Create person mask (face + estimated body area)
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                
                // Check if inside face outline
                const insideFace = this.isPointInPolygon(x, y, faceOutlinePoints);
                
                // Check if in estimated body area (below face)
                const inBodyArea = (x >= personMinX && x <= personMaxX && 
                                   y >= faceMaxY && y <= personMaxY);
                
                // Person mask: face OR body area
                mask[idx] = (insideFace || inBodyArea) ? 1.0 : 0.0;
            }
        }
        
        return mask;
    }
    
    // Create background mask (inverse of person mask)
    createBackgroundMask(personMask, width, height) {
        const mask = new Float32Array(width * height);
        
        for (let i = 0; i < personMask.length; i++) {
            // Background = NOT person
            mask[i] = personMask[i] > 0.5 ? 0.0 : 1.0;
        }
        
        return mask;
    }
    
    // Create STRICT binary skin-only mask (exclude clothes, background, hair)
    createStrictBinarySkinMask(landmarks, width, height) {
        const mask = new Float32Array(width * height);
        
        // Get face outline points (jawline, cheeks, forehead)
        const faceOutlineIndices = [
            // Jawline
            172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323,
            // Cheeks
            234, 454, 227, 447,
            // Forehead
            10, 151, 9
        ];
        
        const faceOutlinePoints = faceOutlineIndices
            .filter(idx => idx < landmarks.length)
            .map(idx => ({
                x: landmarks[idx].x * width,
                y: landmarks[idx].y * height
            }));
        
        if (faceOutlinePoints.length === 0) return mask;
        
        // Get exclusion zones (eyes, lips, eyebrows, hair)
        const eyeMask = this.createEyeMask(landmarks, width, height);
        const lipMask = this.createLipMask(landmarks, width, height);
        const eyebrowMask = this.createEyebrowMask(landmarks, width, height);
        const hairMask = this.createHairMask(landmarks, width, height);
        
        // Create binary mask: 1 inside face, 0 outside
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                
                // Check if inside face outline
                const insideFace = this.isPointInPolygon(x, y, faceOutlinePoints);
                
                // Exclude eyes, lips, eyebrows, hair
                const isExcluded = (eyeMask[idx] > 0.1) || 
                                 (lipMask[idx] > 0.1) || 
                                 (eyebrowMask[idx] > 0.1) || 
                                 (hairMask[idx] > 0.3);
                
                // Binary: 1 for skin, 0 for everything else
                mask[idx] = (insideFace && !isExcluded) ? 1.0 : 0.0;
            }
        }
        
        return mask;
    }
    
    // Check if point is inside polygon
    isPointInPolygon(x, y, points) {
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            const xi = points[i].x, yi = points[i].y;
            const xj = points[j].x, yj = points[j].y;
            
            const intersect = ((yi > y) !== (yj > y)) && 
                            (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }
    
    // Apply adaptive feather ONLY to the mask (not to colors)
    applyFeatherToMask(binaryMask, landmarks, width, height) {
        const featheredMask = new Float32Array(binaryMask);
        
        // Find zones for adaptive feather
        const jawlineIndices = [172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323];
        const jawlinePoints = jawlineIndices
            .filter(idx => idx < landmarks.length)
            .map(idx => ({
                x: landmarks[idx].x * width,
                y: landmarks[idx].y * height
            }));
        
        const hairlineIndices = [10, 151, 9, 107, 55, 65, 52, 53, 46];
        const hairlinePoints = hairlineIndices
            .filter(idx => idx < landmarks.length)
            .map(idx => ({
                x: landmarks[idx].x * width,
                y: landmarks[idx].y * height
            }));
        
        const cheekIndices = [234, 454, 227, 447];
        const cheekPoints = cheekIndices
            .filter(idx => idx < landmarks.length)
            .map(idx => ({
                x: landmarks[idx].x * width,
                y: landmarks[idx].y * height
            }));
        
        // Apply adaptive feather to mask edges
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                const maskValue = binaryMask[idx];
                
                // Only feather edges (transition from 0 to 1)
                if (maskValue > 0 && maskValue < 1) {
                    // Determine feather size based on zone
                    const distToJawline = this.distanceToPolygon(x, y, jawlinePoints);
                    const distToHairline = this.distanceToPolygon(x, y, hairlinePoints);
                    const distToCheek = this.distanceToPolygon(x, y, cheekPoints);
                    
                    let featherSize;
                    if (distToJawline < 30) {
                        featherSize = 12 + (distToJawline / 30) * 4; // 12-16px
                    } else if (distToHairline < 40) {
                        featherSize = 16 + (distToHairline / 40) * 4; // 16-20px
                    } else if (distToCheek < 25) {
                        featherSize = 6 + (distToCheek / 25) * 2; // 6-8px
                    } else {
                        featherSize = 8;
                    }
                    
                    // Apply Gaussian feather
                    const edgeDist = Math.abs(maskValue - 0.5) * 2;
                    const normalizedDist = edgeDist * featherSize;
                    const feather = Math.exp(-normalizedDist * normalizedDist / (2 * featherSize * featherSize));
                    featheredMask[idx] = Math.max(0, Math.min(1, maskValue + (1 - maskValue) * feather * 0.5));
                }
            }
        }
        
        return featheredMask;
    }
    
    // Create skin mask with adaptive feather blur (surgical precision)
    // Jawline: 12-16px, Hairline: 16-20px, Cheeks/forehead: 6-8px
    createSkinMaskWithFeather(landmarks, width, height) {
        const baseMask = this.createSkinMask(landmarks, width, height);
        
        // Find jawline points (bottom of face) - 12-16px feather
        const jawlineIndices = [172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323];
        const jawlinePoints = jawlineIndices
            .filter(idx => idx < landmarks.length)
            .map(idx => ({
                x: landmarks[idx].x * width,
                y: landmarks[idx].y * height
            }));
        
        // Find hairline points (top of face) - 16-20px feather
        const hairlineIndices = [10, 151, 9, 107, 55, 65, 52, 53, 46];
        const hairlinePoints = hairlineIndices
            .filter(idx => idx < landmarks.length)
            .map(idx => ({
                x: landmarks[idx].x * width,
                y: landmarks[idx].y * height
            }));
        
        // Find cheek/forehead points - 6-8px feather
        const cheekIndices = [234, 454, 227, 447]; // Left and right cheek points
        const foreheadIndices = [10, 151, 9]; // Forehead points
        const cheekPoints = [...cheekIndices, ...foreheadIndices]
            .filter(idx => idx < landmarks.length)
            .map(idx => ({
                x: landmarks[idx].x * width,
                y: landmarks[idx].y * height
            }));
        
        // Apply adaptive feather with precise zones
        const featheredMask = new Float32Array(baseMask);
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                const maskValue = baseMask[idx];
                
                // Only feather edges (0 < mask < 1)
                if (maskValue > 0 && maskValue < 1) {
                    // Calculate distances to different zones
                    const distToJawline = this.distanceToPolygon(x, y, jawlinePoints);
                    const distToHairline = this.distanceToPolygon(x, y, hairlinePoints);
                    const distToCheek = this.distanceToPolygon(x, y, cheekPoints);
                    
                    // Determine which zone we're in and apply appropriate feather
                    let featherSize;
                    if (distToJawline < 30) {
                        // Jawline zone: 12-16px
                        featherSize = 12 + (distToJawline / 30) * 4; // 12-16px
                    } else if (distToHairline < 40) {
                        // Hairline zone: 16-20px
                        featherSize = 16 + (distToHairline / 40) * 4; // 16-20px
                    } else if (distToCheek < 25) {
                        // Cheek/forehead zone: 6-8px
                        featherSize = 6 + (distToCheek / 25) * 2; // 6-8px
                    } else {
                        // Default: 8px
                        featherSize = 8;
                    }
                    
                    // Apply smooth Gaussian-like feather
                    const edgeDistance = Math.abs(maskValue - 0.5) * 2; // 0 at edge, 1 at center
                    const normalizedDist = edgeDistance * featherSize;
                    const feather = Math.exp(-normalizedDist * normalizedDist / (2 * featherSize * featherSize));
                    
                    // Smooth transition
                    featheredMask[idx] = Math.max(0, Math.min(1, maskValue + (1 - maskValue) * feather * 0.5));
                }
            }
        }
        
        return featheredMask;
    }
    
    createHairMask(landmarks, width, height) {
        // Create mask for hair area (top of head, exclude from skin)
        const mask = new Float32Array(width * height);
        const hairlineIndices = [10, 151, 9, 107, 55, 65, 52, 53, 46, 336, 296, 334, 293, 300];
        const hairlinePoints = hairlineIndices
            .filter(idx => idx < landmarks.length)
            .map(idx => ({
                x: landmarks[idx].x * width,
                y: landmarks[idx].y * height
            }));
        
        if (hairlinePoints.length === 0) return mask;
        
        // Create a region above the hairline
        const topY = Math.min(...hairlinePoints.map(p => p.y));
        const bottomY = Math.max(...hairlinePoints.map(p => p.y));
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (y < bottomY + 50) { // Area above hairline
                    const dist = this.distanceToPolygon(x, y, hairlinePoints);
                    if (dist < 80) {
                        mask[y * width + x] = Math.max(0, 1 - dist / 80);
                    }
                }
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
                // TikTok UV: Saturated ALIVE cyan-blue (not navy, not purple, not dead)
                const brightness = (r + g + b) / 3;
                
                // Map to vibrant cyan-blue spectrum (alive, not flat)
                // Bright areas -> vibrant light cyan
                // Dark areas -> deep saturated cyan-blue
                if (brightness > 140) {
                    // Light skin: vibrant pale cyan-blue (alive, not dead)
                    return {
                        r: Math.min(255, Math.max(40, brightness * 0.35 + g * 0.25)),   // Some red for warmth
                        g: Math.min(255, Math.max(140, brightness * 0.75 + g * 0.4)),  // Strong green-cyan
                        b: Math.min(255, Math.max(180, brightness * 0.95 + b * 0.5))   // Very strong blue
                    };
                } else {
                    // Dark skin/shadow: deep saturated ALIVE cyan-blue
                    return {
                        r: Math.min(255, Math.max(20, r * 0.25 + b * 0.15)),    // Minimal but not zero red
                        g: Math.min(255, Math.max(80, g * 0.7 + b * 0.6)),      // Very strong green-cyan
                        b: Math.min(255, Math.max(140, b * 1.2 + g * 0.5))      // Maximum blue saturation
                    };
                }
            case 'eye':
                // Near-white with detail preserved
                const eyeBrightness = (r + g + b) / 3;
                if (eyeBrightness > 80) {
                    // Bright eyes -> near-white, preserve detail
                    const detail = Math.min(1, eyeBrightness / 180);
                    return {
                        r: Math.min(255, 200 + eyeBrightness * 0.3),
                        g: Math.min(255, 200 + eyeBrightness * 0.3),
                        b: Math.min(255, 220 + eyeBrightness * 0.25)
                    };
                } else {
                    // Dark pupils -> very dark
                    return {
                        r: Math.max(0, eyeBrightness * 0.2),
                        g: Math.max(0, eyeBrightness * 0.2),
                        b: Math.max(0, eyeBrightness * 0.25)
                    };
                }
            case 'lip':
                // Green-teal for lips
                return {
                    r: Math.min(255, Math.max(0, g * 0.3 + r * 0.1)),       // Low red
                    g: Math.min(255, Math.max(100, g * 0.9 + b * 0.4)),    // Strong green
                    b: Math.min(255, Math.max(120, g * 0.5 + b * 0.8))     // Strong teal-blue
                };
            case 'hair':
                // Very light, almost white
                const hairBrightness = (r + g + b) / 3;
                return {
                    r: Math.min(255, 180 + hairBrightness * 0.3),
                    g: Math.min(255, 200 + hairBrightness * 0.3),
                    b: Math.min(255, 220 + hairBrightness * 0.3)
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
    
    // S-curve contrast (non-linear) for cinematic feel
    applySCurveContrast(imageData) {
        const data = imageData.data;
        const strength = 0.4; // S-curve strength
        
        for (let i = 0; i < data.length; i += 4) {
            // Normalize to 0-1
            let r = data[i] / 255;
            let g = data[i + 1] / 255;
            let b = data[i + 2] / 255;
            
            // Apply S-curve: enhance mid-tones, preserve highlights and shadows
            const sCurve = (t) => {
                if (t < 0.5) {
                    return t * (1 - strength) + t * t * strength * 2;
                } else {
                    return t * (1 - strength) + (1 - (1 - t) * (1 - t)) * strength;
                }
            };
            
            r = sCurve(r);
            g = sCurve(g);
            b = sCurve(b);
            
            // Denormalize
            data[i] = this.clamp(r * 255);
            data[i + 1] = this.clamp(g * 255);
            data[i + 2] = this.clamp(b * 255);
        }
    }
    
    // Apply S-curve contrast ONLY to masked regions
    applySCurveContrastToMask(imageData, mask) {
        const data = imageData.data;
        const width = imageData.width;
        const strength = 0.4;
        
        const sCurve = (t) => {
            if (t < 0.5) {
                return t * (1 - strength) + t * t * strength * 2;
            } else {
                return t * (1 - strength) + (1 - (1 - t) * (1 - t)) * strength;
            }
        };
        
        for (let i = 0; i < data.length; i += 4) {
            const x = (i / 4) % width;
            const y = Math.floor((i / 4) / width);
            const idx = y * width + x;
            const maskValue = mask[idx] || 0;
            
            if (maskValue > 0) {
                // Normalize to 0-1
                let r = data[i] / 255;
                let g = data[i + 1] / 255;
                let b = data[i + 2] / 255;
                
                // Apply S-curve
                r = sCurve(r);
                g = sCurve(g);
                b = sCurve(b);
                
                // Denormalize
                data[i] = this.clamp(r * 255);
                data[i + 1] = this.clamp(g * 255);
                data[i + 2] = this.clamp(b * 255);
            }
        }
    }
    
    // Very subtle global softness (AFTER compositing)
    applySubtleGlobalSoftness(imageData, eyeMask, lipMask) {
        const data = imageData.data;
        const width = imageData.width;
        const height = imageData.height;
        const tempData = new Uint8ClampedArray(data);
        const radius = 1.5;
        
        for (let y = radius; y < height - radius; y++) {
            for (let x = radius; x < width - radius; x++) {
                const idx = (y * width + x) * 4;
                const maskIdx = y * width + x;
                
                const eyeValue = eyeMask[maskIdx] || 0;
                const lipValue = lipMask[maskIdx] || 0;
                
                // Keep eyes and lips sharp, apply subtle softness to everything else
                if (eyeValue < 0.05 && lipValue < 0.05) {
                    let rSum = 0, gSum = 0, bSum = 0, count = 0;
                    
                    for (let dy = -radius; dy <= radius; dy++) {
                        for (let dx = -radius; dx <= radius; dx++) {
                            const dist = Math.sqrt(dx * dx + dy * dy);
                            if (dist <= radius) {
                                const nIdx = ((y + dy) * width + (x + dx)) * 4;
                                const weight = Math.exp(-dist * dist / (2 * radius * radius));
                                rSum += tempData[nIdx] * weight;
                                gSum += tempData[nIdx + 1] * weight;
                                bSum += tempData[nIdx + 2] * weight;
                                count += weight;
                            }
                        }
                    }
                    
                    if (count > 0) {
                        // Very subtle: 90% original, 10% blurred
                        data[idx] = data[idx] * 0.9 + (rSum / count) * 0.1;
                        data[idx + 1] = data[idx + 1] * 0.9 + (gSum / count) * 0.1;
                        data[idx + 2] = data[idx + 2] * 0.9 + (bSum / count) * 0.1;
                    }
                }
            }
        }
    }
    
    // Very subtle vignette (opacity < 6%)
    applySubtleVignette(imageData) {
        const data = imageData.data;
        const width = imageData.width;
        const height = imageData.height;
        const centerX = width / 2;
        const centerY = height / 2;
        const maxDist = Math.sqrt(centerX ** 2 + centerY ** 2);
        
        for (let i = 0; i < data.length; i += 4) {
            const x = (i / 4) % width;
            const y = Math.floor((i / 4) / width);
            const dist = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
            const normalizedDist = dist / maxDist;
            const vignette = Math.pow(normalizedDist, 2) * 0.05; // <6% opacity
            
            data[i] = this.clamp(data[i] * (1 - vignette));
            data[i + 1] = this.clamp(data[i + 1] * (1 - vignette));
            data[i + 2] = this.clamp(data[i + 2] * (1 - vignette));
        }
    }
    
    // Depth and lighting effects: nose highlight, gentle gradients, subtle vignette (<6%)
    applyDepthLighting(imageData, landmarks, skinMask) {
        const data = imageData.data;
        const width = imageData.width;
        const height = imageData.height;
        
        // Find nose bridge for highlight
        const noseTipIdx = 4;
        const noseBridgeIdx = 6;
        let noseX = width / 2, noseY = height / 2;
        if (landmarks && landmarks[noseTipIdx]) {
            noseX = landmarks[noseTipIdx].x * width;
            noseY = landmarks[noseTipIdx].y * height;
        }
        
        // Find forehead center for gradient
        const foreheadIdx = 10;
        let foreheadX = width / 2, foreheadY = height * 0.2;
        if (landmarks && landmarks[foreheadIdx]) {
            foreheadX = landmarks[foreheadIdx].x * width;
            foreheadY = landmarks[foreheadIdx].y * height;
        }
        
        // Find cheek points for gentle gradient falloff
        const leftCheekIdx = 234;
        const rightCheekIdx = 454;
        let leftCheekX = width * 0.3, leftCheekY = height * 0.5;
        let rightCheekX = width * 0.7, rightCheekY = height * 0.5;
        if (landmarks && landmarks[leftCheekIdx]) {
            leftCheekX = landmarks[leftCheekIdx].x * width;
            leftCheekY = landmarks[leftCheekIdx].y * height;
        }
        if (landmarks && landmarks[rightCheekIdx]) {
            rightCheekX = landmarks[rightCheekIdx].x * width;
            rightCheekY = landmarks[rightCheekIdx].y * height;
        }
        
        for (let i = 0; i < data.length; i += 4) {
            const x = (i / 4) % width;
            const y = Math.floor((i / 4) / width);
            const idx = y * width + x;
            const skinValue = skinMask[idx] || 0;
            
            if (skinValue > 0.1) {
                // Nose bridge highlight (slightly brighter)
                const distToNose = Math.sqrt((x - noseX) ** 2 + (y - noseY) ** 2);
                const noseHighlight = Math.exp(-distToNose * distToNose / (2 * 35 * 35)) * 0.12; // Gaussian falloff
                
                // Gentle gradient on cheeks (subtle falloff)
                const distToLeftCheek = Math.sqrt((x - leftCheekX) ** 2 + (y - leftCheekY) ** 2);
                const distToRightCheek = Math.sqrt((x - rightCheekX) ** 2 + (y - rightCheekY) ** 2);
                const minCheekDist = Math.min(distToLeftCheek, distToRightCheek);
                const cheekGradient = Math.exp(-minCheekDist * minCheekDist / (2 * 100 * 100)) * 0.08; // Gentle
                
                // Forehead gradient (subtle)
                const distToForehead = Math.sqrt((x - foreheadX) ** 2 + (y - foreheadY) ** 2);
                const foreheadGradient = Math.exp(-distToForehead * distToForehead / (2 * 120 * 120)) * 0.06;
                
                // Combine lighting (UV light feel, not HDR)
                const lighting = noseHighlight - cheekGradient + foreheadGradient;
                data[i] = this.clamp(data[i] + lighting * 25);
                data[i + 1] = this.clamp(data[i + 1] + lighting * 25);
                data[i + 2] = this.clamp(data[i + 2] + lighting * 25);
            }
        }
        
        // Very subtle vignette (<6% opacity)
        const centerX = width / 2;
        const centerY = height / 2;
        const maxDist = Math.sqrt(centerX ** 2 + centerY ** 2);
        
        for (let i = 0; i < data.length; i += 4) {
            const x = (i / 4) % width;
            const y = Math.floor((i / 4) / width);
            const dist = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
            const normalizedDist = dist / maxDist;
            const vignette = Math.pow(normalizedDist, 2) * 0.05; // <6% opacity, very subtle
            
            data[i] = this.clamp(data[i] * (1 - vignette));
            data[i + 1] = this.clamp(data[i + 1] * (1 - vignette));
            data[i + 2] = this.clamp(data[i + 2] * (1 - vignette));
        }
    }
    
    // Temporal color stability: 70% previous frame, 30% current frame
    applyTemporalColorSmoothing(imageData, lastFrameData) {
        const data = imageData.data;
        const alpha = this.colorSmoothingAlpha; // 0.7 = 70% previous, 30% current
        
        for (let i = 0; i < data.length; i += 4) {
            // Blend: 70% previous + 30% current
            data[i] = alpha * lastFrameData[i] + (1 - alpha) * data[i];
            data[i + 1] = alpha * lastFrameData[i + 1] + (1 - alpha) * data[i + 1];
            data[i + 2] = alpha * lastFrameData[i + 2] + (1 - alpha) * data[i + 2];
        }
    }
    
    // Adaptive softness: very subtle global softness, sharp features (eyes, nose, lips)
    applyAdaptiveSoftness(imageData, skinMask, eyeMask, lipMask) {
        const data = imageData.data;
        const width = imageData.width;
        const height = imageData.height;
        const tempData = new Uint8ClampedArray(data);
        const radius = 1.5; // Very light blur radius for subtle softness
        
        // Apply very subtle global softness first (affects everything slightly)
        for (let y = radius; y < height - radius; y++) {
            for (let x = radius; x < width - radius; x++) {
                const idx = (y * width + x) * 4;
                const maskIdx = y * width + x;
                
                const skinValue = skinMask[maskIdx] || 0;
                const eyeValue = eyeMask[maskIdx] || 0;
                const lipValue = lipMask[maskIdx] || 0;
                
                // Very subtle softness on skin (85% original, 15% blurred)
                // Keep eyes, nose, lips completely sharp (100% original)
                if (skinValue > 0.1 && eyeValue < 0.05 && lipValue < 0.05) {
                    let rSum = 0, gSum = 0, bSum = 0, count = 0;
                    
                    // Very light Gaussian blur
                    for (let dy = -radius; dy <= radius; dy++) {
                        for (let dx = -radius; dx <= radius; dx++) {
                            const dist = Math.sqrt(dx * dx + dy * dy);
                            if (dist <= radius) {
                                const nIdx = ((y + dy) * width + (x + dx)) * 4;
                                const weight = Math.exp(-dist * dist / (2 * radius * radius));
                                rSum += tempData[nIdx] * weight;
                                gSum += tempData[nIdx + 1] * weight;
                                bSum += tempData[nIdx + 2] * weight;
                                count += weight;
                            }
                        }
                    }
                    
                    if (count > 0) {
                        // Very subtle blend: 85% original, 15% blurred (TikTok-style softness)
                        data[idx] = data[idx] * 0.85 + (rSum / count) * 0.15;
                        data[idx + 1] = data[idx + 1] * 0.85 + (gSum / count) * 0.15;
                        data[idx + 2] = data[idx + 2] * 0.85 + (bSum / count) * 0.15;
                    }
                }
                // Features (eyes, lips) remain 100% sharp - no blur applied
            }
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
