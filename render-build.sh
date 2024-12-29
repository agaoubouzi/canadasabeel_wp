#!/usr/bin/env bash
set -o errexit

echo "Starting render-build.sh script..." # Add this line

npm install

echo "npm install complete." # Add this line

PUPPETEER_CACHE_DIR=/opt/render/.cache/puppeteer
mkdir -p $PUPPETEER_CACHE_DIR

echo "Created cache directory: $PUPPETEER_CACHE_DIR" # Add this line

npx puppeteer browsers install chrome

echo "Puppeteer Chrome installation complete." # Add this line