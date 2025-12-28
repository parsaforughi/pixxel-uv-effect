#!/bin/bash

# Start local server for UV Face Filter
echo "Starting UV Face Filter local server..."
echo ""
echo "Server will be available at:"
echo "  - Desktop: http://localhost:8000"
echo "  - Mobile: http://$(ipconfig getifaddr en0 2>/dev/null || hostname -I | awk '{print $1}'):8000"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

cd "$(dirname "$0")"
python3 -m http.server 8000

