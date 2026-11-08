// Which of the sheet's 16 look frames (rows 9-10, clockwise from straight up in 22.5° steps)
// points from Hoot towards the cursor. -1 means "don't look": the cursor is right on top of Hoot.
function lookIndex(center, cursor, deadzone = 70) {
  const dx = cursor.x - center.x;
  const dy = center.y - cursor.y; // screen y grows downwards
  if (Math.hypot(dx, dy) < deadzone) return -1;
  const deg = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  return Math.round(deg / 22.5) % 16;
}

module.exports = { lookIndex };
