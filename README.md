# UV Face Filter - TikTok Style

A web-based camera effect that recreates the TikTok UV face filter. Zero UI, instant camera access, real-time face tracking with UV color processing.

## Features

- **Zero UI**: No buttons, text, or landing screens - just black screen → camera permission → effect
- **Instant Access**: Camera permission requested immediately on page load
- **Face Tracking**: Real-time face landmark detection using MediaPipe Face Mesh
- **Skin Segmentation**: Effect applied only to skin areas (excludes eyes, pupils, eyebrows, lips, hair)
- **UV Color Processing**: 
  - Inverted colors
  - High-contrast LUT mapping
  - Skin → deep blue/cyan
  - Eyes → near white
  - Lips → greenish tone
  - Hair/background → white/light
- **Soft Edge Blending**: Natural transitions between effect and background
- **Mobile Optimized**: Targets 30-60 FPS on modern smartphones

## Setup

### Local Development

1. **Start a local server** (required for camera access):

```bash
# Using Python 3
python3 -m http.server 8000

# Or using Node.js (if you have http-server installed)
npx http-server -p 8000
```

2. **Open in browser**:
   - Navigate to `http://localhost:8000`
   - On mobile: Use your computer's IP address (e.g., `http://192.168.1.100:8000`)

### Deployment

1. **Deploy to any static hosting**:
   - Netlify
   - Vercel
   - GitHub Pages
   - Any web server

2. **Generate QR Code**:
   - Use any QR code generator
   - Link to your deployed URL
   - Users scan → instant camera access → effect runs

## Browser Compatibility

- ✅ iOS Safari (mobile)
- ✅ Android Chrome (mobile)
- ✅ Desktop browsers (for testing)

## Important Notes

### HTTPS Requirement
**Camera access requires HTTPS in production**. Localhost is an exception for development, but deployed sites must use HTTPS.

### MediaPipe Loading
The app uses MediaPipe Face Mesh from CDN. If the CDN is slow or blocked, the app will fall back to a simple inverted video effect.

### Performance
- First load may take a moment to download MediaPipe models (~2-3MB)
- Face detection starts automatically once models are loaded
- Frame rate is capped at 30 FPS for mobile optimization

## Technical Details

- **Face Detection**: MediaPipe Face Mesh (468 landmarks)
- **Rendering**: HTML5 Canvas with pixel-level manipulation
- **Performance**: Frame rate limiting, optimized mask calculations
- **Fallback**: If face detection fails, shows inverted video

## File Structure

```
uv-face-filter/
├── index.html      # Main HTML (zero UI)
├── main.js         # Core filter logic
├── package.json    # Project config
└── README.md       # This file
```

## Usage

1. Scan QR code or open URL
2. Grant camera permission when prompted
3. Effect activates immediately
4. Move your head - effect stays locked to face

## Customization

Edit `main.js` to adjust:
- Color mappings in `applyUVLUT()`
- Contrast levels in `applyContrast()`
- Blur radius in `applySoftBlur()`
- Frame rate target in `targetFPS`

## Performance Tips

- Test on actual mobile devices for accurate performance
- Lower `processingScale` if experiencing lag
- Adjust `targetFPS` based on device capabilities
- Consider WebGL for GPU acceleration (future enhancement)

