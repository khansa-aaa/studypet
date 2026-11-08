// Screenshots of the display you're working on, sized for Claude: the long edge is at most 1568 px,
// which is as much detail as Claude uses, so bigger images would only cost more of your allowance.
// Hoot's own window has content protection on, so it isn't in the picture.
const { desktopCapturer, screen, systemPreferences } = require('electron');

const MAX_EDGE = 1568;

// 'granted', 'denied', 'not-determined' or 'restricted'
function permission() {
  return process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'granted';
}

function displayUnderCursor() {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

async function capture(displayId) {
  const displays = screen.getAllDisplays();
  const display = displays.find((d) => d.id === displayId) || displayUnderCursor();
  const px = { w: display.size.width * display.scaleFactor, h: display.size.height * display.scaleFactor };
  const k = Math.min(1, MAX_EDGE / Math.max(px.w, px.h));
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(px.w * k), height: Math.round(px.h * k) } });
  const src = sources.find((s) => s.display_id === String(display.id)) || (displays.length === 1 ? sources[0] : null);
  if (!src || src.thumbnail.isEmpty()) {
    const err = new Error("Hoot couldn't take a screenshot.");
    if (permission() !== 'granted') err.code = 'permission';
    throw err;
  }
  const img = src.thumbnail;
  return {
    jpeg: img.toJPEG(80),
    thumb: img.resize({ width: 320, quality: 'good' }).toDataURL(),
    display: displays.length > 1 ? display.label || `Display ${displays.indexOf(display) + 1}` : null
  };
}

module.exports = { capture, permission, displayUnderCursor };
