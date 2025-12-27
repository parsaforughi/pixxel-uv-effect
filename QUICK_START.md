# Quick Start Guide

## Local Testing

1. **Start server**:
```bash
cd uv-face-filter
python3 -m http.server 8000
```

2. **Open in browser**:
   - Desktop: `http://localhost:8000`
   - Mobile: `http://[YOUR_IP]:8000` (find your IP with `ifconfig` or `ipconfig`)

3. **Grant camera permission** when prompted

4. **Effect should activate immediately**

## Deploy to Production

### Option 1: Netlify (Easiest)
1. Drag the `uv-face-filter` folder to [Netlify Drop](https://app.netlify.com/drop)
2. Get your URL (e.g., `https://your-app.netlify.app`)
3. Generate QR code pointing to that URL

### Option 2: Vercel
```bash
npm i -g vercel
cd uv-face-filter
vercel
```

### Option 3: GitHub Pages
1. Create GitHub repo
2. Push code
3. Enable GitHub Pages in repo settings
4. Use the GitHub Pages URL

## Generate QR Code

Use any QR code generator:
- [QR Code Generator](https://www.qr-code-generator.com/)
- [QRCode Monkey](https://www.qrcode-monkey.com/)

Point QR code to your deployed URL.

## Testing Checklist

- [ ] Camera permission requested immediately
- [ ] No UI elements visible (black screen → camera)
- [ ] Face detection works
- [ ] Skin shows blue/cyan UV effect
- [ ] Eyes appear white
- [ ] Lips show greenish tone
- [ ] Effect stays locked to face during movement
- [ ] Works on iOS Safari
- [ ] Works on Android Chrome

## Troubleshooting

**Camera not working?**
- Ensure you're using HTTPS (or localhost)
- Check browser permissions
- Try different browser

**Face detection not working?**
- Check browser console for errors
- Ensure MediaPipe loaded (check Network tab)
- App will fallback to inverted video if MediaPipe fails

**Performance issues?**
- Lower `targetFPS` in `main.js` (line 23)
- Increase `step` values in mask creation functions
- Test on actual mobile device (desktop may be slower)

