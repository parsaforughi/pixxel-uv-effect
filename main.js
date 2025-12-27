// UV Face Filter - TikTok Style
// Zero UI, instant camera access, real-time face tracking with UV color processing

class UVFaceFilter {
    constructor() {
        this.video = document.getElementById('video');
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.faceMesh = null;
        this.camera = null;
        this.isProcessing = false;
        this.animationFrame = null;
        
        // Face mesh landmarks for skin segmentation
        this.skinLandmarks = this.getSkinLandmarks();
        this.eyeLandmarks = this.getEyeLandmarks();
        this.lipLandmarks = this.getLipLandmarks();
        this.eyebrowLandmarks = this.getEyebrowLandmarks();
        
        // Performance optimization - use smaller canvas for processing
        this.processingScale = 0.75;
        this.lastFrameTime = 0;
        this.targetFPS = 30;
        this.frameInterval = 1000 / this.targetFPS;
        
        this.init();
    }
    
    getSkinLandmarks() {
        // Face mesh has 468 landmarks
        // Exclude eyes, eyebrows, and lips
        const allLandmarks = Array.from({ length: 468 }, (_, i) => i);
        const exclude = [
            // Left eye
            33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246,
            // Right eye
            362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398,
            // Left eyebrow
            107, 55, 65, 52, 53, 46, 70, 63, 105, 66, 69,
            // Right eyebrow
            336, 296, 334, 293, 300, 276, 283, 282, 295, 285, 336,
            // Lips
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
        try {
            // Request camera immediately - no UI, instant request
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'user',
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            });
            
            this.video.srcObject = stream;
            
            // Wait for video to be ready
            this.video.addEventListener('loadedmetadata', () => {
                this.setupCanvas();
                this.setupFaceMesh();
            });
            
        } catch (error) {
            console.error('Camera access denied:', error);
            // Still show black screen (no UI)
        }
    }
    
    setupCanvas() {
        const videoWidth = this.video.videoWidth;
        const videoHeight = this.video.videoHeight;
        
        // Set canvas to full screen but maintain aspect ratio
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
        
        // Center canvas
        this.canvas.style.width = '100vw';
        this.canvas.style.height = '100vh';
        this.canvas.style.objectFit = 'cover';
    }
    
    setupFaceMesh() {
        if (typeof FaceMesh === 'undefined') {
            console.error('MediaPipe FaceMesh not loaded');
            // Fallback: show inverted video
            this.startFallback();
            return;
        }
        
        this.faceMesh = new FaceMesh({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
            }
        });
        
        this.faceMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });
        
        this.faceMesh.onResults((results) => {
            this.processFrame(results);
        });
        
        // Initialize camera with face mesh
        if (typeof Camera !== 'undefined') {
            this.camera = new Camera(this.video, {
                onFrame: async () => {
                    const now = performance.now();
                    if (now - this.lastFrameTime >= this.frameInterval) {
                        this.lastFrameTime = now;
                        if (!this.isProcessing && this.faceMesh) {
                            this.isProcessing = true;
                            await this.faceMesh.send({ image: this.video });
                            this.isProcessing = false;
                        }
                    }
                },
                width: this.video.videoWidth,
                height: this.video.videoHeight
            });
            
            this.camera.start();
        } else {
            // Fallback if Camera utility not available
            this.startFallback();
        }
    }
    
    startFallback() {
        // Fallback: just show inverted video without face tracking
        const drawFrame = () => {
            if (this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
                this.drawInvertedFrame();
            }
            this.animationFrame = requestAnimationFrame(drawFrame);
        };
        drawFrame();
    }
    
    processFrame(results) {
        if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
            // No face detected - show inverted video
            this.drawInvertedFrame();
            return;
        }
        
        const landmarks = results.multiFaceLandmarks[0];
        this.applyUVFilter(landmarks);
    }
    
    drawInvertedFrame() {
        this.ctx.save();
        this.ctx.scale(-1, 1);
        this.ctx.drawImage(this.video, -this.canvas.width, 0, this.canvas.width, this.canvas.height);
        this.ctx.restore();
        
        // Apply global invert
        const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        this.invertColors(imageData);
        this.ctx.putImageData(imageData, 0, 0);
    }
    
    applyUVFilter(landmarks) {
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
                // Eye area - near white
                const inverted = this.invertPixel(r, g, b);
                const uvColor = this.applyUVLUT(inverted.r, inverted.g, inverted.b, 'eye');
                data[i] = uvColor.r;
                data[i + 1] = uvColor.g;
                data[i + 2] = uvColor.b;
            } else if (lipValue > 0.1) {
                // Lip area - greenish tone
                const inverted = this.invertPixel(r, g, b);
                const uvColor = this.applyUVLUT(inverted.r, inverted.g, inverted.b, 'lip');
                data[i] = uvColor.r;
                data[i + 1] = uvColor.g;
                data[i + 2] = uvColor.b;
            } else if (eyebrowValue > 0.1) {
                // Eyebrow - minimal effect, slightly lighter
                const inverted = this.invertPixel(r, g, b);
                const uvColor = this.applyUVLUT(inverted.r, inverted.g, inverted.b, 'hair');
                data[i] = this.lerp(r, uvColor.r, 0.3);
                data[i + 1] = this.lerp(g, uvColor.g, 0.3);
                data[i + 2] = this.lerp(b, uvColor.b, 0.3);
            } else if (skinValue > 0.1) {
                // Skin area - apply UV blue/cyan effect
                const inverted = this.invertPixel(r, g, b);
                const uvColor = this.applyUVLUT(inverted.r, inverted.g, inverted.b, 'skin');
                // Blend based on mask strength
                const blend = skinValue;
                data[i] = this.lerp(r, uvColor.r, blend);
                data[i + 1] = this.lerp(g, uvColor.g, blend);
                data[i + 2] = this.lerp(b, uvColor.b, blend);
            } else {
                // Background - invert and apply hair effect (white/light)
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
    }
    
    createSkinMask(landmarks, width, height) {
        const mask = new Float32Array(width * height);
        
        // Create polygon from skin landmarks
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
        
        // Use canvas path for faster polygon filling
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        const tempCtx = tempCanvas.getContext('2d');
        
        // Draw polygon with gradient falloff
        tempCtx.beginPath();
        tempCtx.moveTo(skinPoints[0].x, skinPoints[0].y);
        for (let i = 1; i < skinPoints.length; i++) {
            tempCtx.lineTo(skinPoints[i].x, skinPoints[i].y);
        }
        tempCtx.closePath();
        tempCtx.fillStyle = 'white';
        tempCtx.fill();
        
        // Apply distance-based falloff more efficiently
        const step = 2; // Sample every 2 pixels for performance
        for (let y = 0; y < height; y += step) {
            for (let x = 0; x < width; x += step) {
                const dist = this.distanceToPolygon(x, y, skinPoints);
                const value = Math.max(0, 1 - dist / 60);
                const idx = y * width + x;
                mask[idx] = value;
                // Fill neighboring pixels with same value for smoother result
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
        
        // Optimize: only process around eye regions
        const step = 1;
        for (let y = 0; y < height; y += step) {
            for (let x = 0; x < width; x += step) {
                const dist = this.distanceToPolygon(x, y, eyePoints);
                if (dist < 30) { // Only process nearby pixels
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
        
        // Optimize: only process around lip region
        const step = 1;
        for (let y = 0; y < height; y += step) {
            for (let x = 0; x < width; x += step) {
                const dist = this.distanceToPolygon(x, y, lipPoints);
                if (dist < 25) { // Only process nearby pixels
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
        
        // Optimize: only process around eyebrow region
        const step = 1;
        for (let y = 0; y < height; y += step) {
            for (let x = 0; x < width; x += step) {
                const dist = this.distanceToPolygon(x, y, eyebrowPoints);
                if (dist < 20) { // Only process nearby pixels
                    mask[y * width + x] = Math.max(0, 1 - dist / 15);
                }
            }
        }
        
        return mask;
    }
    
    distanceToPolygon(x, y, points) {
        if (points.length === 0) return Infinity;
        
        // Check if point is inside polygon
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            const xi = points[i].x, yi = points[i].y;
            const xj = points[j].x, yj = points[j].y;
            
            const intersect = ((yi > y) !== (yj > y)) && 
                            (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        
        if (inside) return 0;
        
        // Find minimum distance to polygon edges
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
        // High-contrast color LUT based on type - matching TikTok UV filter
        switch (type) {
            case 'skin':
                // Deep blue / cyan for skin (UV effect)
                return {
                    r: Math.min(255, Math.max(0, b * 0.4 + r * 0.05)),
                    g: Math.min(255, Math.max(0, b * 0.7 + g * 0.15)),
                    b: Math.min(255, Math.max(0, b * 0.95 + r * 0.05))
                };
            case 'eye':
                // Near white for eyes
                const eyeBrightness = (r + g + b) / 3;
                return {
                    r: Math.min(255, eyeBrightness * 1.3),
                    g: Math.min(255, eyeBrightness * 1.3),
                    b: Math.min(255, eyeBrightness * 1.3)
                };
            case 'lip':
                // Greenish tone for lips
                return {
                    r: Math.min(255, Math.max(0, g * 0.5 + r * 0.2)),
                    g: Math.min(255, Math.max(0, g * 0.9 + b * 0.2)),
                    b: Math.min(255, Math.max(0, g * 0.4 + b * 0.3))
                };
            case 'hair':
                // White / light for hair/background
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
        // Apply very soft edge blur only at mask boundaries
        const data = imageData.data;
        const width = imageData.width;
        const height = imageData.height;
        const tempData = new Uint8ClampedArray(data);
        
        // Only process edge regions for performance
        const step = 2; // Process every other pixel
        
        for (let y = radius; y < height - radius; y += step) {
            for (let x = radius; x < width - radius; x += step) {
                const idx = y * width + x;
                const maskVal = mask[idx];
                
                // Only blur at edges (where mask transitions)
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
    // Give MediaPipe scripts time to initialize
    setTimeout(() => {
        new UVFaceFilter();
    }, 100);
});
