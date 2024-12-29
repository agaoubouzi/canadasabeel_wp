const { execSync } = require('child_process');

try {
  // Install Chrome using Puppeteer
  execSync('npx puppeteer browsers install chrome', { stdio: 'inherit' });
  
  // Make Chrome executable
  execSync('chmod -R 755 /opt/render/.cache/puppeteer', { stdio: 'inherit' });
} catch (error) {
  console.error('Error during postinstall:', error);
  process.exit(1);
}