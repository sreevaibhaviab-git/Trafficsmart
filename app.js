const $ = (id) => document.getElementById(id);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const canvas = $('townCanvas');
const ctx = canvas.getContext('2d');
const DPR = Math.max(1, window.devicePixelRatio || 1);

const world = {
  width: 2400,
  height: 1800,
  centerX: 1200,
  centerY: 900,
  mainRoadW: 150,
  smallRoadW: 88
};

const camera = {
  x: 560,
  y: 420,
  zoom: 0.78,
  dragging: false,
  moved: false,
  lastX: 0,
  lastY: 0
};

const state = {
  running: false,
  mode: 'adaptive',
  phase: 'EW',
  queues: { N: 12, S: 10, E: 24, W: 18 },
  remaining: 0,
  instructions: 0,
  cycles: 0,
  cacheHits: 0,
  cacheMisses: 0,
  interrupts: 0,
  cleared: 0,
  emergency: null,
  tick: 0,
  visualTrafficBoost: 1
};

const inputMap = { N: 'north', S: 'south', E: 'east', W: 'west' };
const queueMap = { N: 'northValue', S: 'southValue', E: 'eastValue', W: 'westValue' };
const carPalette = ['#f8fafc', '#cbd5e1', '#f59e0b', '#ef4444', '#3b82f6', '#22c55e', '#a78bfa', '#fb7185', '#eab308'];

let vehicles = [];
let ambientVehicles = [];
let vehicleSeq = 0;
let ambientSeq = 0;
let lastFrame = performance.now();

const vehicleTypes = [
  { type: 'car', weight: 48, length: 34, width: 19, speedMul: 1.0 },
  { type: 'bike', weight: 18, length: 22, width: 9, speedMul: 1.18 },
  { type: 'scooter', weight: 16, length: 24, width: 10, speedMul: 1.12 },
  { type: 'truck', weight: 10, length: 52, width: 23, speedMul: 0.72 },
  { type: 'bus', weight: 8, length: 58, width: 24, speedMul: 0.68 }
];

function pickVehicleType() {
  const total = vehicleTypes.reduce((a, b) => a + b.weight, 0);
  let r = Math.random() * total;
  for (const item of vehicleTypes) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return vehicleTypes[0];
}


const buildings = [
  { x: 170, y: 160, w: 330, h: 250, label: 'School', color: '#d9c7a0', roof: '#a86f4d' },
  { x: 610, y: 170, w: 350, h: 235, label: 'Mall', color: '#cfd7e6', roof: '#6f83a4' },
  { x: 1480, y: 170, w: 330, h: 245, label: 'Hospital', color: '#dfeceb', roof: '#c96063', accent: true },
  { x: 1900, y: 170, w: 300, h: 245, label: 'Apartments', color: '#d6c4b8', roof: '#916b5e' },
  { x: 165, y: 520, w: 310, h: 250, label: 'Library', color: '#d1d8c8', roof: '#72875d' },
  { x: 1710, y: 540, w: 290, h: 220, label: 'Police', color: '#d0d5de', roof: '#4d627a' },
  { x: 2000, y: 530, w: 220, h: 205, label: 'Fuel', color: '#efdeb2', roof: '#c08b4e' },
  { x: 170, y: 1040, w: 310, h: 250, label: 'Tech Park', color: '#d4e3ea', roof: '#6f8c9c' },
  { x: 1740, y: 1030, w: 360, h: 260, label: 'Bus Depot', color: '#dcd3ba', roof: '#9a825f' },
  { x: 180, y: 1440, w: 300, h: 180, label: 'Homes', color: '#ecd5c2', roof: '#ae755e' },
  { x: 620, y: 1410, w: 360, h: 210, label: 'Market', color: '#f0ddc4', roof: '#ab6c4a' },
  { x: 1480, y: 1415, w: 360, h: 210, label: 'Cinema', color: '#ddd6f5', roof: '#7768aa' },
  { x: 1910, y: 1420, w: 300, h: 190, label: 'Homes', color: '#eadccf', roof: '#9a7363' }
];

const parks = [
  { x: 1040, y: 180, w: 280, h: 220, label: 'Central Park' },
  { x: 1060, y: 1370, w: 270, h: 220, label: 'Play Ground' }
];

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * DPR);
  canvas.height = Math.round(rect.height * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function phaseDemand(phase) {
  return phase === 'NS' ? state.queues.N + state.queues.S : state.queues.E + state.queues.W;
}

function greenDuration(phase) {
  if (state.mode === 'fixed') return 20;
  const demand = phaseDemand(phase);
  return clamp(Math.round(10 + 0.5 * demand), 10, 35);
}

function chooseAdaptivePhase() {
  const ns = phaseDemand('NS');
  const ew = phaseDemand('EW');
  if (ns === ew) return state.phase === 'NS' ? 'EW' : 'NS';
  return ns > ew ? 'NS' : 'EW';
}

function setPhase(nextPhase, reason = 'normal scheduling') {
  state.phase = nextPhase;
  state.remaining = state.emergency ? 8 : greenDuration(nextPhase);
  log(`Control Unit selected ${nextPhase} phase (${reason}); green = ${state.remaining}s.`);
  renderPanel();
}

function processControlCycle(extraInstructions = 0) {
  const total = Object.values(state.queues).reduce((a, b) => a + b, 0);
  const instr = 42 + (total % 17) + extraInstructions;
  const cpi = state.emergency ? 1.35 : 1.20;
  const cyc = Math.round(instr * cpi);

  state.instructions += instr;
  state.cycles += cyc;

  const memoryAccesses = 6 + (state.tick % 4);
  const misses = state.tick % 5 === 0 ? 1 : 0;
  state.cacheMisses += misses;
  state.cacheHits += memoryAccesses - misses;
}

function dischargeTraffic() {
  const dirs = state.phase === 'NS' ? ['N', 'S'] : ['E', 'W'];
  dirs.forEach((d) => {
    const clearRate = state.emergency && d === state.emergency ? 2 : 1;
    const clearedNow = Math.min(clearRate, state.queues[d]);
    state.queues[d] -= clearedNow;
    state.cleared += clearedNow;
  });
}

function addLightArrivals() {
  const sequence = [null, 'N', 'E', null, 'S', 'W', null, 'E'];
  const d = sequence[state.tick % sequence.length];
  if (d && state.queues[d] < 40) state.queues[d] += 1;

  if (state.visualTrafficBoost > 1 && state.tick % 2 === 0) {
    ['N', 'S', 'E', 'W'].forEach((dir) => {
      if (Math.random() < 0.35 && state.queues[dir] < 40) state.queues[dir] += 1;
    });
  }
}

function tick() {
  if (!state.running) return;
  state.tick += 1;
  processControlCycle();
  dischargeTraffic();
  addLightArrivals();
  state.remaining -= 1;

  if (state.remaining <= 0) {
    if (state.emergency) {
      log(`Interrupt service completed for ${state.emergency}. Returning to normal scheduling.`);
      state.emergency = null;
    }
    const next = state.mode === 'adaptive' ? chooseAdaptivePhase() : state.phase === 'NS' ? 'EW' : 'NS';
    setPhase(next, state.mode === 'adaptive' ? 'queue comparison' : 'fixed alternation');
  }

  syncInputsFromState();
  syncVehiclePopulation();
  renderPanel();
}

function triggerEmergency(direction) {
  const emergencyPhase = ['N', 'S'].includes(direction) ? 'NS' : 'EW';
  state.interrupts += 1;
  state.emergency = direction;
  processControlCycle(28);
  log(`HIGH-PRIORITY INTERRUPT: emergency vehicle detected on ${direction}.`);
  spawnVehicle(direction, true, 0.02);
  setPhase(emergencyPhase, `interrupt service for lane ${direction}`);
}

function estimatedWaits() {
  const ns = phaseDemand('NS');
  const ew = phaseDemand('EW');
  const total = Math.max(1, ns + ew);
  const imbalance = Math.abs(ns - ew) / total;
  const fixed = 28 + total * 0.32 + imbalance * 18;
  const adaptive = fixed * (0.84 - Math.min(0.24, imbalance * 0.35));
  const improvement = Math.max(0, ((fixed - adaptive) / fixed) * 100);
  return { fixed, adaptive, improvement };
}

function renderPanel() {
  Object.entries(state.queues).forEach(([d, q]) => {
    $(queueMap[d]).textContent = q;
  });

  $('phaseText').textContent = `${state.phase === 'NS' ? 'North-South' : 'East-West'} GREEN${state.emergency ? ' · EMERGENCY PRIORITY' : ''}`;
  $('timerText').textContent = `00:${String(Math.max(0, state.remaining)).padStart(2, '0')}`;
  $('instructions').textContent = state.instructions.toLocaleString();
  $('cycles').textContent = state.cycles.toLocaleString();
  $('cpi').textContent = (state.emergency ? 1.35 : 1.20).toFixed(2);
  $('cpuTime').textContent = `${(state.cycles / 1000).toFixed(3)} ms`;
  $('cacheHits').textContent = state.cacheHits;
  $('cacheMisses').textContent = state.cacheMisses;
  $('interrupts').textContent = state.interrupts;
  $('cleared').textContent = state.cleared;

  const total = Object.values(state.queues).reduce((a, b) => a + b, 0);
  const waits = estimatedWaits();
  $('totalQueue').textContent = `${total} vehicles`;
  $('fixedWait').textContent = `${waits.fixed.toFixed(1)} s`;
  $('adaptiveWait').textContent = `${waits.adaptive.toFixed(1)} s`;
  $('improvement').textContent = `${waits.improvement.toFixed(1)}%`;

  $('runStatus').textContent = state.running ? 'Running' : 'Paused';
  $('runDot').classList.toggle('paused', !state.running);
}

function syncInputsFromState() {
  Object.entries(state.queues).forEach(([d, q]) => {
    $(inputMap[d]).value = q;
  });
}

function log(message) {
  const line = document.createElement('div');
  line.className = 'log-line';
  const stamp = new Date().toLocaleTimeString([], { hour12: false });
  line.innerHTML = `<span class="time">${stamp}</span>${message}`;
  $('logArea').prepend(line);
}

function getDirPathData(dir) {
  const stopGap = 118;
  const halfRoad = world.mainRoadW / 2;
  if (dir === 'N') {
    return { total: world.height - 120, stopAt: world.centerY - halfRoad - 22, axis: 'y', start: 60, laneBase: world.centerX - 20, angle: Math.PI / 2 };
  }
  if (dir === 'S') {
    return { total: world.height - 120, stopAt: world.centerY + halfRoad + 22, axis: 'y', start: world.height - 60, laneBase: world.centerX + 20, angle: -Math.PI / 2 };
  }
  if (dir === 'W') {
    return { total: world.width - 120, stopAt: world.centerX - halfRoad - 22, axis: 'x', start: 60, laneBase: world.centerY + 20, angle: 0 };
  }
  return { total: world.width - 120, stopAt: world.centerX + halfRoad + 22, axis: 'x', start: world.width - 60, laneBase: world.centerY - 20, angle: Math.PI };
}

function progressToWorld(v) {
  const info = getDirPathData(v.dir);
  const laneOffset = v.lane === 0 ? -16 : 16;
  if (v.dir === 'N') return { x: info.laneBase + laneOffset, y: info.start + v.progress * info.total, angle: info.angle };
  if (v.dir === 'S') return { x: info.laneBase + laneOffset, y: info.start - v.progress * info.total, angle: info.angle };
  if (v.dir === 'W') return { x: info.start + v.progress * info.total, y: info.laneBase + laneOffset, angle: info.angle };
  return { x: info.start - v.progress * info.total, y: info.laneBase + laneOffset, angle: info.angle };
}

function clearVehicles() {
  vehicles = [];
  ambientVehicles = [];
}

function spawnVehicle(direction, emergency = false, progress = 0) {
  if (vehicles.length > 180) return;
  const spec = emergency ? { type: 'ambulance', length: 46, width: 22, speedMul: 1.35 } : pickVehicleType();
  vehicles.push({
    id: ++vehicleSeq,
    dir: direction,
    progress,
    lane: vehicleSeq % 2,
    speed: (emergency ? 0.14 : 0.035 + ((vehicleSeq % 5) * 0.006)) * spec.speedMul,
    emergency,
    type: spec.type,
    color: emergency ? '#f8fafc' : carPalette[vehicleSeq % carPalette.length],
    length: spec.length,
    width: spec.width
  });
}

function spawnAmbientVehicle(routeIndex, progress = Math.random()) {
  const spec = pickVehicleType();
  ambientVehicles.push({
    id: ++ambientSeq,
    routeIndex,
    progress,
    speed: (0.025 + (ambientSeq % 4) * 0.004) * spec.speedMul,
    type: spec.type,
    color: carPalette[(ambientSeq + 3) % carPalette.length],
    length: spec.length,
    width: spec.width
  });
}

function isDirectionGreen(dir) {
  return state.phase === 'NS' ? ['N', 'S'].includes(dir) : ['E', 'W'].includes(dir);
}

function syncVehiclePopulation() {
  const desiredByDir = {};
  ['N', 'S', 'E', 'W'].forEach((dir) => {
    desiredByDir[dir] = clamp(Math.round(state.queues[dir] * 1.1), 6, 32);
  });

  ['N', 'S', 'E', 'W'].forEach((dir) => {
    const current = vehicles.filter((v) => v.dir === dir && !v.emergency && v.progress < 1.04).length;
    const need = desiredByDir[dir] - current;
    for (let i = 0; i < need; i++) {
      const spread = need > 1 ? (i / need) * 0.88 : 0.05;
      spawnVehicle(dir, false, clamp(spread + Math.random() * 0.03, 0, 0.94));
    }
  });
}

const ambientRoutes = [
  { axis: 'h', y: 430, x1: 70, x2: 2330, dir: 1, laneOffset: -18 },
  { axis: 'h', y: 430, x1: 2330, x2: 70, dir: -1, laneOffset: 18 },
  { axis: 'h', y: 1370, x1: 70, x2: 2330, dir: 1, laneOffset: -18 },
  { axis: 'h', y: 1370, x1: 2330, x2: 70, dir: -1, laneOffset: 18 },
  { axis: 'v', x: 520, y1: 70, y2: 1730, dir: 1, laneOffset: -18 },
  { axis: 'v', x: 520, y1: 1730, y2: 70, dir: -1, laneOffset: 18 },
  { axis: 'v', x: 1880, y1: 70, y2: 1730, dir: 1, laneOffset: -18 },
  { axis: 'v', x: 1880, y1: 1730, y2: 70, dir: -1, laneOffset: 18 }
];

function ambientWorldPosition(v) {
  const r = ambientRoutes[v.routeIndex];
  if (r.axis === 'h') {
    const x = r.x1 + (r.x2 - r.x1) * v.progress;
    return { x, y: r.y + r.laneOffset, angle: r.x2 > r.x1 ? 0 : Math.PI };
  }
  const y = r.y1 + (r.y2 - r.y1) * v.progress;
  return { x: r.x + r.laneOffset, y, angle: r.y2 > r.y1 ? Math.PI / 2 : -Math.PI / 2 };
}

function seedAmbientTraffic() {
  ambientVehicles = [];
  ambientRoutes.forEach((_, routeIndex) => {
    for (let i = 0; i < 7; i++) spawnAmbientVehicle(routeIndex, (i / 7 + Math.random() * 0.08) % 1);
  });
}

function animateAmbientTraffic(dt) {
  ambientVehicles.forEach((v) => {
    if (!state.running) return;
    v.progress += v.speed * dt * 1.6;
    if (v.progress > 1.04) v.progress = -0.04;
  });
}

function animateVehicles(dt) {
  ['N', 'S', 'E', 'W'].forEach((dir) => {
    const info = getDirPathData(dir);
    const stopProgress = Math.abs((info.stopAt - info.start) / info.total);
    const spacing = dir === 'N' || dir === 'S' ? 52 / info.total : 54 / info.total;

    const dirCars = vehicles.filter((v) => v.dir === dir).sort((a, b) => b.progress - a.progress);

    dirCars.forEach((v, index) => {
      const green = isDirectionGreen(dir) || (v.emergency && state.emergency === dir);
      const maxStoppedProgress = stopProgress - index * spacing;
      let canMove = state.running;

      if (!green && v.progress < stopProgress + 0.08 && v.progress >= maxStoppedProgress - 0.012) canMove = false;

      const carAhead = dirCars[index - 1];
      if (carAhead && carAhead.progress - v.progress < spacing * 0.85) canMove = false;

      if (canMove) {
        let speed = v.speed * (state.visualTrafficBoost > 1 ? 1.14 : 1);
        if (v.emergency && state.emergency === dir) speed *= 1.55;
        v.progress += speed * dt * 2.1;
      } else if (!green && v.progress > maxStoppedProgress && v.progress < stopProgress + 0.09) {
        v.progress = maxStoppedProgress;
      }
    });
  });

  vehicles = vehicles.filter((v) => v.progress <= 1.06);
  animateAmbientTraffic(dt);

  if (state.running && vehicles.length < 130 && Math.random() < 0.1 * state.visualTrafficBoost) {
    const dirs = ['N', 'S', 'E', 'W'];
    spawnVehicle(dirs[Math.floor(Math.random() * dirs.length)]);
  }
}

function injectTraffic(direction, count = 4) {
  state.queues[direction] = clamp(state.queues[direction] + count, 0, 40);
  for (let i = 0; i < count; i++) spawnVehicle(direction, false, i * 0.012);
  syncInputsFromState();
  renderPanel();
  log(`Interactive input: ${count} vehicles added to ${direction} approach.`);
}

function reset() {
  state.running = false;
  state.mode = 'adaptive';
  state.phase = 'EW';
  state.queues = { N: 12, S: 10, E: 24, W: 18 };
  state.remaining = greenDuration('EW');
  state.instructions = 0;
  state.cycles = 0;
  state.cacheHits = 0;
  state.cacheMisses = 0;
  state.interrupts = 0;
  state.cleared = 0;
  state.emergency = null;
  state.tick = 0;
  state.visualTrafficBoost = 1;
  $('adaptiveBtn').classList.add('active');
  $('fixedBtn').classList.remove('active');
  $('logArea').innerHTML = '';
  clearVehicles();
  seedAmbientTraffic();
  centerCamera();
  syncInputsFromState();
  syncVehiclePopulation();
  renderPanel();
  log('System reset. Adaptive controller ready.');
}

function centerCamera() {
  camera.zoom = 0.78;
  camera.x = world.centerX - getViewportWidth() / (2 * camera.zoom);
  camera.y = world.centerY - getViewportHeight() / (2 * camera.zoom);
  clampCamera();
}

function getViewportWidth() { return canvas.getBoundingClientRect().width; }
function getViewportHeight() { return canvas.getBoundingClientRect().height; }

function clampCamera() {
  const viewW = getViewportWidth() / camera.zoom;
  const viewH = getViewportHeight() / camera.zoom;
  camera.x = clamp(camera.x, 0, Math.max(0, world.width - viewW));
  camera.y = clamp(camera.y, 0, Math.max(0, world.height - viewH));
}

function worldToScreen(x, y) {
  return { x: (x - camera.x) * camera.zoom, y: (y - camera.y) * camera.zoom };
}

function screenToWorld(x, y) {
  return { x: x / camera.zoom + camera.x, y: y / camera.zoom + camera.y };
}

function drawRoundedRect(x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
}

function drawBackground() {
  ctx.fillStyle = '#7aa85b';
  ctx.fillRect(0, 0, world.width, world.height);
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  for (let x = 0; x < world.width; x += 120) ctx.fillRect(x, 0, 2, world.height);
  for (let y = 0; y < world.height; y += 120) ctx.fillRect(0, y, world.width, 2);
}

function drawPark(park) {
  drawRoundedRect(park.x, park.y, park.w, park.h, 26, '#5f9d4a', '#4f8540');
  ctx.fillStyle = '#7db76a';
  for (let i = 0; i < 10; i++) {
    const tx = park.x + 28 + (i % 5) * 44;
    const ty = park.y + 34 + Math.floor(i / 5) * 74;
    ctx.beginPath();
    ctx.arc(tx, ty, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#7a5237';
    ctx.fillRect(tx - 2, ty + 6, 4, 16);
    ctx.fillStyle = '#7db76a';
  }
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.font = '600 20px Inter, sans-serif';
  ctx.fillText(park.label, park.x + 20, park.y + park.h - 20);
}

function drawBuilding(b) {
  drawRoundedRect(b.x, b.y, b.w, b.h, 22, b.color, '#5f6774');
  drawRoundedRect(b.x + 12, b.y + 12, b.w - 24, 34, 14, b.roof, null);
  const cols = Math.max(3, Math.floor((b.w - 40) / 54));
  const rows = Math.max(2, Math.floor((b.h - 70) / 52));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const wx = b.x + 22 + c * 52;
      const wy = b.y + 62 + r * 50;
      drawRoundedRect(wx, wy, 24, 28, 4, '#7cb4d6', 'rgba(255,255,255,0.2)');
    }
  }
  if (b.accent) {
    ctx.fillStyle = '#cf4141';
    ctx.fillRect(b.x + b.w / 2 - 6, b.y + b.h / 2 - 28, 12, 56);
    ctx.fillRect(b.x + b.w / 2 - 28, b.y + b.h / 2 - 6, 56, 12);
  }
  ctx.fillStyle = '#1c2530';
  ctx.font = '700 20px Inter, sans-serif';
  ctx.fillText(b.label, b.x + 18, b.y + b.h - 18);
}

function drawRoadNetwork() {
  ctx.fillStyle = '#363d46';
  ctx.fillRect(world.centerX - world.mainRoadW / 2, 0, world.mainRoadW, world.height);
  ctx.fillRect(0, world.centerY - world.mainRoadW / 2, world.width, world.mainRoadW);
  ctx.fillRect(0, 430 - world.smallRoadW / 2, world.width, world.smallRoadW);
  ctx.fillRect(0, 1370 - world.smallRoadW / 2, world.width, world.smallRoadW);
  ctx.fillRect(520 - world.smallRoadW / 2, 0, world.smallRoadW, world.height);
  ctx.fillRect(1880 - world.smallRoadW / 2, 0, world.smallRoadW, world.height);

  ctx.fillStyle = '#3e464f';
  ctx.fillRect(world.centerX - 14, 0, 28, world.height);
  ctx.fillRect(0, world.centerY - 14, world.width, 28);

  ctx.strokeStyle = '#f4f0d8';
  ctx.lineWidth = 4;
  ctx.setLineDash([22, 20]);
  drawLine(world.centerX - world.mainRoadW / 4, 0, world.centerX - world.mainRoadW / 4, world.height);
  drawLine(world.centerX + world.mainRoadW / 4, 0, world.centerX + world.mainRoadW / 4, world.height);
  drawLine(0, world.centerY - world.mainRoadW / 4, world.width, world.centerY - world.mainRoadW / 4);
  drawLine(0, world.centerY + world.mainRoadW / 4, world.width, world.centerY + world.mainRoadW / 4);
  ctx.setLineDash([]);

  drawCrosswalk(world.centerX - 110, world.centerY - world.mainRoadW / 2 - 12, 220, 16, true);
  drawCrosswalk(world.centerX - 110, world.centerY + world.mainRoadW / 2 - 4, 220, 16, true);
  drawCrosswalk(world.centerX - world.mainRoadW / 2 - 12, world.centerY - 110, 16, 220, false);
  drawCrosswalk(world.centerX + world.mainRoadW / 2 - 4, world.centerY - 110, 16, 220, false);
}

function drawLine(x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawCrosswalk(x, y, w, h, horizontal) {
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  const stripes = 8;
  for (let i = 0; i < stripes; i++) {
    if (horizontal) ctx.fillRect(x + i * (w / stripes), y, 14, h);
    else ctx.fillRect(x, y + i * (h / stripes), w, 14);
  }
}

function drawTrafficLights() {
  const greenNS = state.phase === 'NS';
  const greenEW = state.phase === 'EW';
  drawSignal(world.centerX - 96, world.centerY - 120, greenNS ? 'green' : 'red', 'N');
  drawSignal(world.centerX + 78, world.centerY + 92, greenNS ? 'green' : 'red', 'S');
  drawSignal(world.centerX + 92, world.centerY - 96, greenEW ? 'green' : 'red', 'E');
  drawSignal(world.centerX - 118, world.centerY + 78, greenEW ? 'green' : 'red', 'W');
}

function drawSignal(x, y, active, label) {
  drawRoundedRect(x, y, 32, 70, 10, '#151a20', '#4a5463');
  ['red', 'yellow', 'green'].forEach((name, i) => {
    ctx.beginPath();
    ctx.arc(x + 16, y + 16 + i * 18, 6, 0, Math.PI * 2);
    const dim = name === 'red' ? '#652d33' : name === 'yellow' ? '#6d622c' : '#284f36';
    const bright = name === 'red' ? '#ff606d' : name === 'yellow' ? '#ffd34d' : '#5df59a';
    ctx.fillStyle = active === name ? bright : dim;
    ctx.fill();
  });
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '700 14px Inter, sans-serif';
  ctx.fillText(label, x + 10, y + 94);
}

function drawVehicleBody(v, x, y, angle) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  if (v.type === 'bike' || v.type === 'scooter') {
    ctx.strokeStyle = '#101418';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(-v.length * 0.28, 0, 4.2, 0, Math.PI * 2);
    ctx.arc(v.length * 0.28, 0, 4.2, 0, Math.PI * 2);
    ctx.stroke();
    drawRoundedRect(-v.length * 0.18, -v.width / 2, v.length * 0.42, v.width, 4, v.color, null);
    ctx.fillStyle = v.type === 'scooter' ? '#f1f5f9' : '#222';
    ctx.beginPath(); ctx.arc(2, 0, 3.8, 0, Math.PI * 2); ctx.fill();
  } else {
    drawRoundedRect(-v.length / 2, -v.width / 2, v.length, v.width, v.type === 'truck' || v.type === 'bus' ? 5 : 7, v.color, 'rgba(0,0,0,0.28)');
    if (v.type === 'truck') {
      drawRoundedRect(-v.length / 2 + 4, -v.width / 2 + 3, v.length * 0.52, v.width - 6, 3, '#cbd5e1', null);
      drawRoundedRect(v.length * 0.12, -v.width / 2 + 3, v.length * 0.28, v.width - 6, 3, '#d9f1ff', null);
    } else if (v.type === 'bus') {
      for (let i = 0; i < 4; i++) drawRoundedRect(-v.length / 2 + 8 + i * 12, -v.width / 2 + 3, 8, v.width - 6, 2, '#ccecff', null);
    } else {
      drawRoundedRect(-v.length / 2 + 7, -v.width / 2 + 3, 12, v.width - 6, 4, '#d9f1ff', null);
      drawRoundedRect(v.length / 2 - 14, -v.width / 2 + 3, 8, v.width - 6, 4, '#ffe4aa', null);
    }
  }

  if (v.emergency) {
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(-6, -v.width / 2 - 4, 12, 5);
    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(-6, v.width / 2 - 1, 12, 5);
  }
  ctx.restore();
}

function drawAmbientCars() {
  ambientVehicles.forEach((v) => {
    const p = ambientWorldPosition(v);
    drawVehicleBody(v, p.x, p.y, p.angle);
  });
}

function drawCars() {
  drawAmbientCars();
  vehicles.forEach((v) => {
    const { x, y, angle } = progressToWorld(v);
    drawVehicleBody(v, x, y, angle);
  });
}

function drawDirectionHUD() {
  const spots = {
    N: { x: world.centerX, y: world.centerY - 210 },
    S: { x: world.centerX, y: world.centerY + 235 },
    E: { x: world.centerX + 250, y: world.centerY },
    W: { x: world.centerX - 260, y: world.centerY }
  };
  Object.entries(spots).forEach(([dir, p]) => {
    ctx.fillStyle = 'rgba(10,17,27,0.84)';
    drawRoundedRect(p.x - 34, p.y - 24, 68, 44, 14, 'rgba(11,17,24,0.82)', 'rgba(255,255,255,0.06)');
    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 16px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(dir, p.x, p.y - 5);
    ctx.fillStyle = '#8ee6be';
    ctx.font = '700 18px Inter, sans-serif';
    ctx.fillText(String(state.queues[dir]), p.x, p.y + 14);
  });
  ctx.textAlign = 'left';
}

function drawViewportHUD() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const w = getViewportWidth();
  const h = getViewportHeight();
  drawRoundedRect(18, 16, 252, 72, 14, 'rgba(10,16,24,0.78)', 'rgba(255,255,255,0.08)');
  ctx.fillStyle = '#eef4ff';
  ctx.font = '700 16px Inter, sans-serif';
  ctx.fillText('Traffic Smart · Small Town View', 32, 40);
  ctx.fillStyle = '#9bb0c8';
  ctx.font = '12px Inter, sans-serif';
  ctx.fillText('Drag to pan · Scroll to zoom · Click a road entry to add traffic', 32, 62);
  ctx.fillText(`Zoom ${(camera.zoom * 100).toFixed(0)}%`, 32, 80);

  const miniW = 180, miniH = 130, pad = 18;
  const mx = w - miniW - pad;
  const my = 16;
  drawRoundedRect(mx, my, miniW, miniH, 14, 'rgba(10,16,24,0.8)', 'rgba(255,255,255,0.1)');
  ctx.fillStyle = '#7aa85b';
  ctx.fillRect(mx + 10, my + 22, miniW - 20, miniH - 32);
  const scaleX = (miniW - 20) / world.width;
  const scaleY = (miniH - 32) / world.height;
  ctx.fillStyle = '#4b5563';
  ctx.fillRect(mx + 10 + (world.centerX - world.mainRoadW / 2) * scaleX, my + 22, world.mainRoadW * scaleX, miniH - 32);
  ctx.fillRect(mx + 10, my + 22 + (world.centerY - world.mainRoadW / 2) * scaleY, miniW - 20, world.mainRoadW * scaleY);
  ctx.strokeStyle = '#e7f6ff';
  ctx.lineWidth = 2;
  ctx.strokeRect(mx + 10 + camera.x * scaleX, my + 22 + camera.y * scaleY, (w / camera.zoom) * scaleX, (h / camera.zoom) * scaleY);
  ctx.fillStyle = '#d9ecff';
  ctx.font = '700 12px Inter, sans-serif';
  ctx.fillText('Mini map', mx + 12, my + 16);
}

function drawTown() {
  const w = getViewportWidth();
  const h = getViewportHeight();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(camera.zoom, 0, 0, camera.zoom, -camera.x * camera.zoom, -camera.y * camera.zoom);
  drawBackground();
  parks.forEach(drawPark);
  drawRoadNetwork();
  buildings.forEach(drawBuilding);
  drawTrafficLights();
  drawCars();
  drawDirectionHUD();
  drawViewportHUD();
}

function renderFrame(now) {
  const dt = Math.min(0.035, (now - lastFrame) / 1000);
  lastFrame = now;
  animateVehicles(dt);
  drawTown();
  requestAnimationFrame(renderFrame);
}

function pickDirectionFromWorld(wx, wy) {
  const nearMainV = Math.abs(wx - world.centerX) < 90;
  const nearMainH = Math.abs(wy - world.centerY) < 90;
  if (nearMainV && wy < 340) return 'N';
  if (nearMainV && wy > 1460) return 'S';
  if (nearMainH && wx < 340) return 'W';
  if (nearMainH && wx > 2060) return 'E';
  return null;
}

Object.entries(inputMap).forEach(([d, id]) => {
  $(id).addEventListener('input', (e) => {
    state.queues[d] = Number(e.target.value);
    $(queueMap[d]).textContent = state.queues[d];
    processControlCycle(4);
    syncVehiclePopulation();
    renderPanel();
  });
});

$('adaptiveBtn').addEventListener('click', () => {
  state.mode = 'adaptive';
  $('adaptiveBtn').classList.add('active');
  $('fixedBtn').classList.remove('active');
  setPhase(chooseAdaptivePhase(), 'adaptive mode enabled');
});

$('fixedBtn').addEventListener('click', () => {
  state.mode = 'fixed';
  $('fixedBtn').classList.add('active');
  $('adaptiveBtn').classList.remove('active');
  state.remaining = 20;
  log('Fixed-time mode enabled: 20 seconds per phase.');
  renderPanel();
});

$('startBtn').addEventListener('click', () => {
  if (!state.running) {
    state.running = true;
    if (state.remaining <= 0) state.remaining = greenDuration(state.phase);
    log('Simulation started. Vehicles now respond to live signal states.');
    renderPanel();
  }
});

$('pauseBtn').addEventListener('click', () => {
  state.running = false;
  log('Simulation paused.');
  renderPanel();
});

$('rushBtn').addEventListener('click', () => {
  state.visualTrafficBoost = 2.3;
  state.queues = { N: 32, S: 29, E: 38, W: 34 };
  syncInputsFromState();
  syncVehiclePopulation();
  log('Rush Hour scenario loaded: heavy traffic across the town.');
  if (state.mode === 'adaptive') setPhase(chooseAdaptivePhase(), 'rush-hour demand detected');
  renderPanel();
});

$('randomBtn').addEventListener('click', () => {
  state.visualTrafficBoost = 1.5;
  ['N', 'S', 'E', 'W'].forEach((d) => state.queues[d] = 8 + Math.floor(Math.random() * 29));
  syncInputsFromState();
  clearVehicles();
  syncVehiclePopulation();
  log('Random traffic scenario generated.');
  if (state.mode === 'adaptive') setPhase(chooseAdaptivePhase(), 'new random demand');
  renderPanel();
});

$('resetBtn').addEventListener('click', reset);
$('clearLog').addEventListener('click', () => $('logArea').innerHTML = '');
$('centerViewBtn').addEventListener('click', () => { centerCamera(); log('Camera centered on the main junction.'); });

document.querySelectorAll('[data-emergency]').forEach((btn) => {
  btn.addEventListener('click', () => triggerEmergency(btn.dataset.emergency));
});

canvas.addEventListener('mousedown', (e) => {
  camera.dragging = true;
  camera.moved = false;
  camera.lastX = e.clientX;
  camera.lastY = e.clientY;
  canvas.classList.add('dragging');
});
window.addEventListener('mouseup', () => {
  camera.dragging = false;
  canvas.classList.remove('dragging');
});
window.addEventListener('mousemove', (e) => {
  if (!camera.dragging) return;
  const dx = (e.clientX - camera.lastX) / camera.zoom;
  const dy = (e.clientY - camera.lastY) / camera.zoom;
  if (Math.abs(dx) > 0.8 || Math.abs(dy) > 0.8) camera.moved = true;
  camera.x -= dx;
  camera.y -= dy;
  camera.lastX = e.clientX;
  camera.lastY = e.clientY;
  clampCamera();
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const before = screenToWorld(sx, sy);
  camera.zoom = clamp(camera.zoom * (e.deltaY < 0 ? 1.08 : 0.92), 0.45, 1.5);
  const after = screenToWorld(sx, sy);
  camera.x += before.x - after.x;
  camera.y += before.y - after.y;
  clampCamera();
}, { passive: false });

canvas.addEventListener('click', (e) => {
  if (camera.moved) return;
  const rect = canvas.getBoundingClientRect();
  const pos = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  const dir = pickDirectionFromWorld(pos.x, pos.y);
  if (dir) injectTraffic(dir, 4);
});

window.addEventListener('resize', () => {
  resizeCanvas();
  clampCamera();
});

setInterval(tick, 1000);
resizeCanvas();
reset();
state.running = true;
state.visualTrafficBoost = 1.35;
log('Auto-start enabled. Town traffic simulation is running.');
renderPanel();
requestAnimationFrame(renderFrame);
