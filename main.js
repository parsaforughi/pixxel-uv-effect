// UV Face Filter - TikTok Style
// Zero UI, instant camera access, real-time face tracking with UV color processing
// DEBUG MODE: Extensive logging and Safari-safe handling
// CRITICAL: Single getUserMedia call, camera stream never stopped

// Global flag to prevent multiple getUserMedia calls
window.cameraInitialized = false;
window.uvFilterInstance = null;

class UVFaceFilter {
    constructor() {
        console.log('[UVFilter] Constructor called');
        
        // Prevent multiple instances
        if (window.uvFilterInstance) {
            console.warn('[UVFilter] Instance already exists, skipping');
            return;
        }
        window.uvFilterInstance = this;
        
        this.video = document.getElementById('video');
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
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
        this.cameraStream = null; // Store stream reference
        
        // Face mesh landmarks for skin segmentation
        this.skinLandmarks = this.getSkinLandmarks();
        this.eyeLandmarks = this.getEyeLandmarks();
        this.lipLandmarks = this.getLipLandmarks();
        this.eyebrowLandmarks = this.getEyebrowLandmarks();
        
        // Performance optimization
        this.processingScale = 0.75;
        this.lastFrameTime = 0;
        this.targetFPS = 30;
        this.frameInterval = 1000 / this.targetFPS;
        
        // Debug state
        this.debugMode = true;
        this.lastFaceDetected = 0;
        this.faceMeshFailCount = 0;
        this.maxFaceMeshFailures = 10;
        
        console.log('[UVFilter] Initializing...');
        this.init();
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
    
    async init() {
        console.log('[UVFilter] init() called');
        
        // CRITICAL: Check global flag - getUserMedia MUST be called exactly ONCE
        if (window.cameraInitialized === true) {
            console.log('[UVFilter] CAMERA INIT BLOCKED (SKIPPED) - Already initialized');
            // If camera already initialized, just setup rendering
            if (this.video.srcObject) {
                this.setupVideoListeners();
                this.videoReady = true;
                this.streamActive = true;
                this.startImmediateFallback();
                this.setupFaceMesh();
            }
            return;
        }
        
        console.log('[UVFilter] CAMERA INIT START');
        console.log('[UVFilter] Video element:', this.video);
        console.log('[UVFilter] Canvas element:', this.canvas);
        console.log('[UVFilter] navigator.mediaDevices:', navigator.mediaDevices);
        
        // Setup video event listeners FIRST
        this.setupVideoListeners();
        
        try {
            console.log('[UVFilter] BEFORE getUserMedia call');
            console.log('[UVFilter] User agent:', navigator.userAgent);
            
            // Safari-safe constraints
            const constraints = {
                video: {
                    facingMode: 'user',
                    width: { ideal: 640 },
                    height: { ideal: 480 }
                }
            };
            
            console.log('[UVFilter] Requesting camera with constraints:', JSON.stringify(constraints));
            
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            
            console.log('[UVFilter] getUserMedia SUCCESS - stream received');
            console.log('[UVFilter] Stream active:', stream.active);
            console.log('[UVFilter] Stream tracks:', stream.getTracks().length);
            stream.getTracks().forEach((track, idx) => {
                console.log(`[UVFilter] Track ${idx}:`, track.kind, track.enabled, track.readyState);
            });
            
            // CRITICAL: Set global flag IMMEDIATELY after successful getUserMedia
            window.cameraInitialized = true;
            console.log('[UVFilter] CAMERA INIT SUCCESS');
            
            // Store stream reference - NEVER stop this stream
            this.cameraStream = stream;
            this.streamActive = true;
            
            console.log('[UVFilter] Setting video.srcObject...');
            this.video.srcObject = stream;
            console.log('[UVFilter] video.srcObject set, value:', this.video.srcObject);
            
            // Safari requires explicit play() call
            console.log('[UVFilter] Attempting video.play()...');
            try {
                await this.video.play();
                console.log('[UVFilter] video.play() SUCCESS');
            } catch (playError) {
                console.error('[UVFilter] video.play() FAILED:', playError);
                console.error('[UVFilter] Play error name:', playError.name);
                console.error('[UVFilter] Play error message:', playError.message);
                // Single retry only, no loops
                setTimeout(async () => {
                    try {
                        await this.video.play();
                        console.log('[UVFilter] video.play() SUCCESS on retry');
                    } catch (retryError) {
                        console.error('[UVFilter] video.play() FAILED on retry:', retryError);
                    }
                }, 500);
            }
            
            // Wait for video metadata
            console.log('[UVFilter] Waiting for video metadata...');
            
        } catch (error) {
            console.error('[UVFilter] getUserMedia ERROR:', error);
            console.error('[UVFilter] Error name:', error.name);
            console.error('[UVFilter] Error message:', error.message);
            console.error('[UVFilter] Error stack:', error.stack);
            
            // On getUserMedia failure, show error but don't retry
            this.activateHardFallback('getUserMedia failed: ' + error.message, false);
        }
    }
    
    setupVideoListeners() {
        console.log('[UVFilter] Setting up video event listeners');
        
        // Remove existing listeners to prevent duplicates
        this.video.removeEventListener('loadedmetadata', this.onLoadedMetadata);
        this.video.removeEventListener('canplay', this.onCanPlay);
        this.video.removeEventListener('play', this.onPlay);
        this.video.removeEventListener('playing', this.onPlaying);
        this.video.removeEventListener('pause', this.onPause);
        this.video.removeEventListener('error', this.onVideoError);
        this.video.removeEventListener('stalled', this.onStalled);
        this.video.removeEventListener('waiting', this.onWaiting);
        
        // Create bound handlers
        this.onLoadedMetadata = () => {
            console.log('[UVFilter] EVENT: loadedmetadata');
            console.log('[UVFilter] video.videoWidth:', this.video.videoWidth);
            console.log('[UVFilter] video.videoHeight:', this.video.videoHeight);
            console.log('[UVFilter] video.readyState:', this.video.readyState);
            console.log('[UVFilter] video.HAVE_METADATA:', this.video.HAVE_METADATA);
            console.log('[UVFilter] video.HAVE_CURRENT_DATA:', this.video.HAVE_CURRENT_DATA);
            console.log('[UVFilter] video.HAVE_ENOUGH_DATA:', this.video.HAVE_ENOUGH_DATA);
            
            if (this.video.videoWidth > 0 && this.video.videoHeight > 0) {
                this.setupCanvas();
                this.videoReady = true;
                
                // Start fallback render loop immediately
                if (!this.fallbackActive && !this.mediaPipeReady) {
                    console.log('[UVFilter] Starting immediate fallback render loop');
                    this.startImmediateFallback();
                }
                
                // Setup FaceMesh after canvas is ready
                this.setupFaceMesh();
            } else {
                console.error('[UVFilter] ERROR: Video dimensions are zero!');
                this.activateHardFallback('Video dimensions are zero', false);
            }
        };
        
        this.onCanPlay = () => {
            console.log('[UVFilter] EVENT: canplay');
            console.log('[UVFilter] video.readyState:', this.video.readyState);
        };
        
        this.onPlay = () => {
            console.log('[UVFilter] EVENT: play');
            console.log('[UVFilter] video.paused:', this.video.paused);
            console.log('[UVFilter] video.ended:', this.video.ended);
        };
        
        this.onPlaying = () => {
            console.log('[UVFilter] EVENT: playing');
        };
        
        this.onPause = () => {
            console.log('[UVFilter] EVENT: pause');
        };
        
        this.onVideoError = (e) => {
            console.error('[UVFilter] EVENT: video error');
            console.error('[UVFilter] Video error code:', this.video.error?.code);
            console.error('[UVFilter] Video error message:', this.video.error?.message);
            console.error('[UVFilter] Event:', e);
            // Don't stop camera on video error, just switch to fallback rendering
            this.activateHardFallback('Video error event', false);
        };
        
        this.onStalled = () => {
            console.warn('[UVFilter] EVENT: video stalled');
        };
        
        this.onWaiting = () => {
            console.warn('[UVFilter] EVENT: video waiting');
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
    }
    
    setupCanvas() {
        console.log('[UVFilter] setupCanvas() called');
        
        if (!this.video.videoWidth || !this.video.videoHeight) {
            console.error('[UVFilter] ERROR: Cannot setup canvas - video dimensions invalid');
            return;
        }
        
        const videoWidth = this.video.videoWidth;
        const videoHeight = this.video.videoHeight;
        
        console.log('[UVFilter] Video dimensions:', videoWidth, 'x', videoHeight);
        console.log('[UVFilter] Window dimensions:', window.innerWidth, 'x', window.innerHeight);
        
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        
        const videoAspect = videoWidth / videoHeight;
        const windowAspect = windowWidth / windowHeight;
        
        if (videoAspect > windowAspect) {
            this.canvas.width = windowWidth;
            this.canvas.height = windowWidth / videoAspect;
        } else {
            this.canvas.width = windowHeight * videoAspect;
            this.canvas.height = windowHeight;
        }
        
        console.log('[UVFilter] Canvas dimensions set to:', this.canvas.width, 'x', this.canvas.height);
        
        this.canvas.style.width = '100vw';
        this.canvas.style.height = '100vh';
        this.canvas.style.objectFit = 'cover';
        
        // Draw initial debug rectangle
        this.drawDebugOverlay('CANVAS SETUP OK');
    }
    
    setupFaceMesh() {
        console.log('[UVFilter] setupFaceMesh() called');
        console.log('[UVFilter] typeof FaceMesh:', typeof FaceMesh);
        console.log('[UVFilter] typeof Camera:', typeof Camera);
        
        if (typeof FaceMesh === 'undefined') {
            console.error('[UVFilter] ERROR: MediaPipe FaceMesh not loaded');
            console.error('[UVFilter] Switching to fallback rendering (camera stays alive)');
            this.activateHardFallback('MediaPipe FaceMesh not loaded', false);
            return;
        }
        
        try {
            console.log('[UVFilter] Creating FaceMesh instance...');
            this.faceMesh = new FaceMesh({
                locateFile: (file) => {
                    const url = `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
                    console.log('[UVFilter] MediaPipe loading file:', url);
                    return url;
                }
            });
            
            console.log('[UVFilter] FaceMesh instance created');
            
            this.faceMesh.setOptions({
                maxNumFaces: 1,
                refineLandmarks: true,
                minDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5
            });
            
            console.log('[UVFilter] FaceMesh options set');
            
            this.faceMesh.onResults((results) => {
                this.processFrame(results);
            });
            
            console.log('[UVFilter] FaceMesh onResults handler set');
            
            // Set timeout for FaceMesh to start working
            this.faceMeshLoadTimeout = setTimeout(() => {
                if (this.lastFaceDetected === 0) {
                    console.warn('[UVFilter] WARNING: FaceMesh timeout - no face detected after 5 seconds');
                    console.warn('[UVFilter] Switching to fallback rendering (camera stays alive)');
                    this.activateHardFallback('FaceMesh timeout - no face detected', false);
                }
            }, 5000);
            
            // Initialize camera with face mesh
            if (typeof Camera !== 'undefined') {
                console.log('[UVFilter] Camera utility available, initializing...');
                console.log('[UVFilter] Video dimensions for Camera:', this.video.videoWidth, 'x', this.video.videoHeight);
                
                if (this.video.videoWidth > 0 && this.video.videoHeight > 0) {
                    this.camera = new Camera(this.video, {
                        onFrame: async () => {
                            const now = performance.now();
                            if (now - this.lastFrameTime >= this.frameInterval) {
                                this.lastFrameTime = now;
                                if (!this.isProcessing && this.faceMesh && this.video.readyState >= this.video.HAVE_CURRENT_DATA) {
                                    this.isProcessing = true;
                                    try {
                                        await this.faceMesh.send({ image: this.video });
                                    } catch (error) {
                                        console.error('[UVFilter] FaceMesh.send() ERROR:', error);
                                        this.faceMeshFailCount++;
                                        if (this.faceMeshFailCount >= this.maxFaceMeshFailures) {
                                            this.activateHardFallback('FaceMesh send failures exceeded', false);
                                        }
                                    }
                                    this.isProcessing = false;
                                }
                            }
                        },
                        width: this.video.videoWidth,
                        height: this.video.videoHeight
                    });
                    
                    console.log('[UVFilter] Camera instance created');
                    
                    this.camera.start();
                    console.log('[UVFilter] Camera.start() called');
                    this.mediaPipeReady = true;
                } else {
                    console.error('[UVFilter] ERROR: Cannot start Camera - invalid video dimensions');
                    this.activateHardFallback('Invalid video dimensions for Camera', false);
                }
            } else {
                console.error('[UVFilter] ERROR: Camera utility not available');
                this.activateHardFallback('Camera utility not available', false);
            }
        } catch (error) {
            console.error('[UVFilter] ERROR in setupFaceMesh:', error);
            console.error('[UVFilter] Error stack:', error.stack);
            this.activateHardFallback('setupFaceMesh error: ' + error.message, false);
        }
    }
    
    startImmediateFallback() {
        console.log('[UVFilter] startImmediateFallback() called');
        if (this.fallbackActive) {
            console.log('[UVFilter] Fallback already active, skipping');
            return;
        }
        this.fallbackActive = true;
        
        const drawFrame = () => {
            try {
                if (this.video.readyState >= this.video.HAVE_CURRENT_DATA) {
                    this.drawRawVideoFrame();
                } else {
                    this.drawDebugOverlay('WAITING FOR VIDEO DATA...');
                }
                this.animationFrame = requestAnimationFrame(drawFrame);
            } catch (error) {
                console.error('[UVFilter] ERROR in fallback drawFrame:', error);
                this.drawDebugOverlay('FALLBACK ERROR: ' + error.message);
                this.animationFrame = requestAnimationFrame(drawFrame);
            }
        };
        
        drawFrame();
    }
    
    activateHardFallback(reason, stopMediaPipeOnly = true) {
        console.error('[UVFilter] activateHardFallback() called - reason:', reason);
        console.error('[UVFilter] stopMediaPipeOnly:', stopMediaPipeOnly);
        this.fallbackActive = true;
        
        if (this.faceMeshLoadTimeout) {
            clearTimeout(this.faceMeshLoadTimeout);
            this.faceMeshLoadTimeout = null;
        }
        
        // CRITICAL: Only stop MediaPipe processing, NEVER stop camera stream
        if (this.camera && stopMediaPipeOnly) {
            try {
                // Stop MediaPipe Camera utility (this does NOT stop the video stream)
                this.camera.stop();
                console.log('[UVFilter] MediaPipe Camera utility stopped (stream remains alive)');
            } catch (e) {
                console.error('[UVFilter] Error stopping MediaPipe camera utility:', e);
            }
        }
        
        // CRITICAL: NEVER stop the camera stream tracks
        // DO NOT call: stream.getTracks().forEach(track => track.stop())
        // DO NOT call: this.video.srcObject = null
        // The stream MUST remain alive
        
        console.log('[UVFilter] Camera stream remains active - switching to fallback rendering only');
        
        // Start raw video rendering
        const drawFrame = () => {
            try {
                if (this.video && this.video.readyState >= this.video.HAVE_CURRENT_DATA && this.video.videoWidth > 0) {
                    this.drawRawVideoFrame();
                    this.drawDebugOverlay('FALLBACK MODE: ' + reason);
                } else {
                    this.drawDebugOverlay('FALLBACK: ' + reason + ' | Video not ready');
                }
                this.animationFrame = requestAnimationFrame(drawFrame);
            } catch (error) {
                console.error('[UVFilter] ERROR in hard fallback drawFrame:', error);
                this.drawDebugOverlay('FALLBACK ERROR: ' + error.message);
                this.animationFrame = requestAnimationFrame(drawFrame);
            }
        };
        
        drawFrame();
    }
    
    drawRawVideoFrame() {
        try {
            if (!this.ctx || !this.video) return;
            
            // Clear canvas
            this.ctx.fillStyle = '#000';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            
            // Draw video (mirrored)
            this.ctx.save();
            this.ctx.scale(-1, 1);
            this.ctx.drawImage(this.video, -this.canvas.width, 0, this.canvas.width, this.canvas.height);
            this.ctx.restore();
            
            // Draw debug rectangle
            this.ctx.strokeStyle = '#ff0000';
            this.ctx.lineWidth = 3;
            this.ctx.strokeRect(10, 10, 100, 50);
            
            this.frameCount++;
            
            // Log every 60 frames
            if (this.frameCount % 60 === 0) {
                const now = performance.now();
                if (now - this.lastLogTime > 1000) {
                    console.log('[UVFilter] Frame', this.frameCount, '- Video readyState:', this.video.readyState, '- Dimensions:', this.video.videoWidth, 'x', this.video.videoHeight);
                    this.lastLogTime = now;
                }
            }
        } catch (error) {
            console.error('[UVFilter] ERROR in drawRawVideoFrame:', error);
        }
    }
    
    drawDebugOverlay(text) {
        try {
            if (!this.ctx) return;
            
            // Draw red rectangle
            this.ctx.strokeStyle = '#ff0000';
            this.ctx.lineWidth = 3;
            this.ctx.strokeRect(10, 10, 200, 100);
            
            // Draw text
            this.ctx.fillStyle = '#ffffff';
            this.ctx.font = '16px Arial';
            this.ctx.fillText('VIDEO OK', 20, 35);
            this.ctx.fillText('FRAME OK', 20, 55);
            
            if (this.mediaPipeReady) {
                this.ctx.fillText('FACEMESH OK', 20, 75);
            } else {
                this.ctx.fillText('FACEMESH: ' + (typeof FaceMesh !== 'undefined' ? 'LOADING' : 'FAILED'), 20, 75);
            }
            
            if (text) {
                this.ctx.fillText(text.substring(0, 40), 20, 95);
            }
        } catch (error) {
            console.error('[UVFilter] ERROR in drawDebugOverlay:', error);
        }
    }
    
    processFrame(results) {
        try {
            if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
                // No face detected - show inverted video
                this.drawInvertedFrame();
                return;
            }
            
            this.lastFaceDetected = Date.now();
            if (this.faceMeshLoadTimeout) {
                clearTimeout(this.faceMeshLoadTimeout);
                this.faceMeshLoadTimeout = null;
            }
            
            const landmarks = results.multiFaceLandmarks[0];
            this.applyUVFilter(landmarks);
        } catch (error) {
            console.error('[UVFilter] ERROR in processFrame:', error);
            this.drawInvertedFrame();
        }
    }
    
    drawInvertedFrame() {
        try {
            if (!this.ctx || !this.video || this.video.readyState < this.video.HAVE_CURRENT_DATA) {
                return;
            }
            
            this.ctx.save();
            this.ctx.scale(-1, 1);
            this.ctx.drawImage(this.video, -this.canvas.width, 0, this.canvas.width, this.canvas.height);
            this.ctx.restore();
            
            // Apply global invert
            const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
            this.invertColors(imageData);
            this.ctx.putImageData(imageData, 0, 0);
            
            // Draw debug overlay
            this.drawDebugOverlay('INVERTED MODE');
        } catch (error) {
            console.error('[UVFilter] ERROR in drawInvertedFrame:', error);
        }
    }
    
    applyUVFilter(landmarks) {
        try {
            if (!this.ctx || !this.video || this.video.readyState < this.video.HAVE_CURRENT_DATA) {
                return;
            }
            
            // Draw video frame (mirrored)
            this.ctx.save();
            this.ctx.scale(-1, 1);
            this.ctx.drawImage(this.video, -this.canvas.width, 0, this.canvas.width, this.canvas.height);
            this.ctx.restore();
            
            // Get image data for processing
            const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
            const data = imageData.data;
            
            // Create masks for different facial regions
            const skinMask = this.createSkinMask(landmarks, this.canvas.width, this.canvas.height);
            const eyeMask = this.createEyeMask(landmarks, this.canvas.width, this.canvas.height);
            const lipMask = this.createLipMask(landmarks, this.canvas.width, this.canvas.height);
            const eyebrowMask = this.createEyebrowMask(landmarks, this.canvas.width, this.canvas.height);
            
            // Apply UV color processing
            for (let i = 0; i < data.length; i += 4) {
                const x = (i / 4) % this.canvas.width;
                const y = Math.floor((i / 4) / this.canvas.width);
                
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                
                // Check pixel location in masks
                const idx = Math.floor(y) * this.canvas.width + Math.floor(x);
                const skinValue = skinMask[idx] || 0;
                const eyeValue = eyeMask[idx] || 0;
                const lipValue = lipMask[idx] || 0;
                const eyebrowValue = eyebrowMask[idx] || 0;
                
                // Priority: eyes > lips > eyebrows > skin > background
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
            
            // Apply aggressive contrast
            this.applyContrast(imageData, 1.8);
            
            // Apply soft edge blur at mask boundaries
            this.applySoftBlur(imageData, skinMask, 2);
            
            this.ctx.putImageData(imageData, 0, 0);
            
            // Draw debug overlay
            this.drawDebugOverlay('UV FILTER ACTIVE');
            
            this.frameCount++;
        } catch (error) {
            console.error('[UVFilter] ERROR in applyUVFilter:', error);
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
                return {
                    r: Math.min(255, Math.max(0, b * 0.4 + r * 0.05)),
                    g: Math.min(255, Math.max(0, b * 0.7 + g * 0.15)),
                    b: Math.min(255, Math.max(0, b * 0.95 + r * 0.05))
                };
            case 'eye':
                const eyeBrightness = (r + g + b) / 3;
                return {
                    r: Math.min(255, eyeBrightness * 1.3),
                    g: Math.min(255, eyeBrightness * 1.3),
                    b: Math.min(255, eyeBrightness * 1.3)
                };
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

// Initialize filter - wait for MediaPipe to load, then start
window.addEventListener('load', () => {
    console.log('[UVFilter] Window load event fired');
    console.log('[UVFilter] typeof FaceMesh:', typeof FaceMesh);
    console.log('[UVFilter] typeof Camera:', typeof Camera);
    console.log('[UVFilter] window.cameraInitialized:', window.cameraInitialized);
    
    // Prevent multiple instances
    if (window.uvFilterInstance) {
        console.warn('[UVFilter] Instance already exists, skipping initialization');
        return;
    }
    
    // Give MediaPipe scripts time to initialize
    setTimeout(() => {
        console.log('[UVFilter] Initializing UVFaceFilter after timeout');
        console.log('[UVFilter] typeof FaceMesh after timeout:', typeof FaceMesh);
        new UVFaceFilter();
    }, 100);
});
