/**
 * ------------------------------------------------------------------
 * CONFIGURATION & CONSTANTS
 * ------------------------------------------------------------------
 */
const CONFIG = {
    FPS: 60,
    FOV: 100,
    CAMERA_HEIGHT: 1000, 
    CAMERA_DEPTH: 0.84, 
    SEGMENT_LENGTH: 200, 
    DRAW_DISTANCE: 300, 
    LANES: 3,
    ROAD_WIDTH: 2000,
    MAX_SPEED: 12000, 
    ACCEL: 100,
    BRAKING: -300,
    DECEL: -50,
    OFF_ROAD_DECEL: -200,
    SKY_SPEED: 0.001, 
    
    COLORS: {
        SKY_TOP: '#000022',
        SKY_BOTTOM: '#003366',
        ROAD_LIGHT: '#444444',
        ROAD_DARK: '#3e3e3e',
        GRASS_LIGHT: '#104010',
        GRASS_DARK: '#0b300b',
        LANE_MARKER: '#ffffff',
        RUMBLE: '#550000',
        FOG: '#001525',
        TREE_TRUNK: '#443322',
        TREE_LEAVES: '#004400'
    }
};

/**
 * ------------------------------------------------------------------
 * AUDIO ENGINE (Synthesized)
 * ------------------------------------------------------------------
 */
class AudioController {
    constructor() {
        this.ctx = null;
        this.engineOsc = null;
        this.engineGain = null;
        this.windNode = null;
        this.windGain = null;
        this.initialized = false;
    }

    init() {
        if (this.initialized) return;
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();

        // Engine Sound (Sawtooth for growl)
        this.engineOsc = this.ctx.createOscillator();
        this.engineOsc.type = 'sawtooth';
        this.engineOsc.frequency.value = 100;
        
        // Engine Filter (Muffle it a bit)
        this.engineFilter = this.ctx.createBiquadFilter();
        this.engineFilter.type = 'lowpass';
        this.engineFilter.frequency.value = 400;

        this.engineGain = this.ctx.createGain();
        this.engineGain.gain.value = 0;

        this.engineOsc.connect(this.engineFilter);
        this.engineFilter.connect(this.engineGain);
        this.engineGain.connect(this.ctx.destination);
        this.engineOsc.start();

        // Wind Noise (White Noise Buffer)
        const bufferSize = 2 * this.ctx.sampleRate;
        const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }

        this.windNode = this.ctx.createBufferSource();
        this.windNode.buffer = noiseBuffer;
        this.windNode.loop = true;
        
        this.windGain = this.ctx.createGain();
        this.windGain.gain.value = 0;
        
        // Wind Filter (Highpass)
        const windFilter = this.ctx.createBiquadFilter();
        windFilter.type = 'highpass';
        windFilter.frequency.value = 800;

        this.windNode.connect(windFilter);
        windFilter.connect(this.windGain);
        this.windGain.connect(this.ctx.destination);
        this.windNode.start();

        this.initialized = true;
    }

    update(speedRatio) {
        if (!this.initialized) return;
        
        // Speed ratio is 0 to 1
        const r = Math.max(0, Math.min(1, speedRatio));

        // Engine Pitch: 80Hz idle -> 300Hz max
        const targetFreq = 80 + (r * 220);
        this.engineOsc.frequency.setTargetAtTime(targetFreq, this.ctx.currentTime, 0.1);
        
        // Engine Filter opens up with speed
        this.engineFilter.frequency.setTargetAtTime(400 + (r * 1000), this.ctx.currentTime, 0.1);

        // Engine Volume: Idle is quiet, mid is loud, high speed slightly quieter (wind takes over)
        let engVol = 0.1 + (r * 0.2);
        this.engineGain.gain.setTargetAtTime(engVol, this.ctx.currentTime, 0.1);

        // Wind Volume: Starts at 50% speed
        let windVol = 0;
        if (r > 0.5) {
            windVol = (r - 0.5) * 2 * 0.3; // max 0.3 vol
        }
        this.windGain.gain.setTargetAtTime(windVol, this.ctx.currentTime, 0.1);
    }

    playCrash() {
        if (!this.initialized) return;
        const t = this.ctx.currentTime;
        
        // 1. Create White Noise Buffer for Crash
        const bufferSize = this.ctx.sampleRate * 2; // 2 seconds
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;

        // 2. Filter it (Lowpass sweep for explosion sound)
        const noiseFilter = this.ctx.createBiquadFilter();
        noiseFilter.type = 'lowpass';
        noiseFilter.frequency.setValueAtTime(1000, t);
        noiseFilter.frequency.exponentialRampToValueAtTime(100, t + 1);

        // 3. Envelope (Sharp attack, long decay)
        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(1, t);
        noiseGain.gain.exponentialRampToValueAtTime(0.01, t + 1.5);

        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(this.ctx.destination);
        noise.start(t);
        noise.stop(t + 2);

        // 4. Fade out engine/wind immediately
        this.engineGain.gain.cancelScheduledValues(t);
        this.engineGain.gain.setValueAtTime(this.engineGain.gain.value, t);
        this.engineGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        
        this.windGain.gain.cancelScheduledValues(t);
        this.windGain.gain.setValueAtTime(this.windGain.gain.value, t);
        this.windGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    }
    
    resume() {
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }
}

/**
 * ------------------------------------------------------------------
 * INPUT HANDLING
 * ------------------------------------------------------------------
 */
class InputSystem {
    constructor() {
        this.keys = {};
        this.gesture = { tilt: 0, throttle: 0, brake: 0, active: false };
        
        // Keyboard steering - more responsive
        this.keyboardSteer = 0;
        this.steerSpeed = 0.25; // Fast steering response
        this.steerReturn = 0.2; // Quick return to center
        
        // Wave gesture detection
        this.waveHistory = [];
        this.waveThreshold = 3; // Number of direction changes needed
        this.waveTimeWindow = 1500; // Time window in ms
        this.lastWaveTime = 0;
        this.waveCooldown = 1000; // Cooldown between wave detections
        this.onWaveDetected = null; // Callback for wave gesture

        window.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;
            // Prevent default for game keys to avoid page scrolling
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) {
                e.preventDefault();
            }
        });
        window.addEventListener('keyup', (e) => this.keys[e.code] = false);

        this.videoElement = document.getElementById('input_video');
        this.canvasPreview = document.getElementById('webcam-preview');
        this.ctxPreview = this.canvasPreview.getContext('2d');
        
        this.hands = new Hands({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`});
        this.hands.setOptions({
            maxNumHands: 1,
            modelComplexity: 1,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });
        this.hands.onResults(this.onHandsResults.bind(this));
        
        this.camera = new Camera(this.videoElement, {
            onFrame: async () => await this.hands.send({image: this.videoElement}),
            width: 320,
            height: 240
        });
    }

    startCamera() { return this.camera.start(); }

    onHandsResults(results) {
        this.ctxPreview.save();
        this.ctxPreview.clearRect(0, 0, this.canvasPreview.width, this.canvasPreview.height);
        this.ctxPreview.drawImage(results.image, 0, 0, this.canvasPreview.width, this.canvasPreview.height);
        
        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            const landmarks = results.multiHandLandmarks[0];
            drawConnectors(this.ctxPreview, landmarks, HAND_CONNECTIONS, {color: '#00FF00', lineWidth: 2});
            drawLandmarks(this.ctxPreview, landmarks, {color: '#FF0000', lineWidth: 1});
            
            this.processGesture(landmarks);
            this.detectWaveGesture(landmarks);
            this.gesture.active = true;
            document.getElementById('g-status').innerText = "Tracking";
            document.getElementById('g-status').style.color = "#00ff88";
        } else {
            this.gesture.active = false;
            this.gesture.tilt *= 0.9;
            this.gesture.throttle = 0;
            this.gesture.brake = 0;
            document.getElementById('g-status').innerText = "No Hand";
            document.getElementById('g-status').style.color = "#ff0055";
        }
        this.ctxPreview.restore();
    }

    processGesture(landmarks) {
        const wrist = landmarks[0];
        const middleBase = landmarks[9];
        const dx = middleBase.x - wrist.x;
        const dy = middleBase.y - wrist.y; 
        
        let angle = Math.atan2(dy, dx); 
        const neutralAngle = -Math.PI / 2;
        let tilt = (angle - neutralAngle);
        const maxTilt = 0.8;
        this.gesture.tilt = Math.max(-1, Math.min(1, tilt / maxTilt));
        
        if(Math.abs(this.gesture.tilt) < 0.1) this.gesture.tilt = 0;
        document.getElementById('g-tilt').innerText = (this.gesture.tilt * 90).toFixed(0) + "°";

        const tips = [8, 12, 16, 20];
        const pips = [6, 10, 14, 18];
        let extendedFingers = 0;

        for(let i=0; i<4; i++) {
            const dTip = this.dist(wrist, landmarks[tips[i]]);
            const dPip = this.dist(wrist, landmarks[pips[i]]);
            if (dTip > dPip * 1.1) extendedFingers++;
        }

        let actionText = "Coast";
        if (extendedFingers >= 3) {
            this.gesture.throttle = 1;
            this.gesture.brake = 0;
            actionText = "ACCEL";
        } else if (extendedFingers <= 1) {
            this.gesture.throttle = 0;
            this.gesture.brake = 1;
            actionText = "BRAKE";
        } else {
            this.gesture.throttle = 0;
            this.gesture.brake = 0;
        }
        document.getElementById('g-action').innerText = actionText;
    }

    dist(p1, p2) { return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2)); }

    detectWaveGesture(landmarks) {
        const now = Date.now();
        const wrist = landmarks[0];
        
        // Add current position to history
        this.waveHistory.push({
            x: wrist.x,
            time: now
        });
        
        // Remove old entries outside time window
        this.waveHistory = this.waveHistory.filter(p => now - p.time < this.waveTimeWindow);
        
        // Need at least 4 points to detect wave
        if (this.waveHistory.length < 4) return;
        
        // Check for direction changes (wave motion)
        let directionChanges = 0;
        let lastDirection = null;
        
        for (let i = 1; i < this.waveHistory.length; i++) {
            const dx = this.waveHistory[i].x - this.waveHistory[i-1].x;
            if (Math.abs(dx) > 0.02) { // Minimum movement threshold
                const direction = dx > 0 ? 'right' : 'left';
                if (lastDirection && direction !== lastDirection) {
                    directionChanges++;
                }
                lastDirection = direction;
            }
        }
        
        // Check if wave detected and not in cooldown
        if (directionChanges >= this.waveThreshold && (now - this.lastWaveTime) > this.waveCooldown) {
            this.lastWaveTime = now;
            this.waveHistory = []; // Clear history after detection
            console.log('Wave gesture detected!');
            if (this.onWaveDetected) {
                this.onWaveDetected();
            }
        }
    }

    getCommand() {
        let cmd = { steer: 0, accel: 0, brake: 0 };
        if (this.gesture.active) {
            cmd.steer = this.gesture.tilt;
            cmd.accel = this.gesture.throttle;
            cmd.brake = this.gesture.brake;
        } else {
            // Smooth keyboard steering with WASD and Arrow keys
            let targetSteer = 0;
            // Left: A or Left Arrow
            if (this.keys['ArrowLeft'] || this.keys['KeyA']) targetSteer = 1;
            // Right: D or Right Arrow
            if (this.keys['ArrowRight'] || this.keys['KeyD']) targetSteer = -1;
            
            // Smoothly interpolate steering
            if (targetSteer !== 0) {
                this.keyboardSteer += (targetSteer - this.keyboardSteer) * this.steerSpeed;
            } else {
                // Return to center faster
                this.keyboardSteer *= (1 - this.steerReturn);
                if (Math.abs(this.keyboardSteer) < 0.01) this.keyboardSteer = 0;
            }
            
            cmd.steer = this.keyboardSteer;
            
            // Forward/Accelerate: W or Up Arrow
            if (this.keys['ArrowUp'] || this.keys['KeyW']) cmd.accel = 1;
            // Brake: S or Down Arrow
            if (this.keys['ArrowDown'] || this.keys['KeyS']) cmd.brake = 1;
            
            // Update visual hint for active keys
            this.updateKeyHints();
        }
        return cmd;
    }
    
    updateKeyHints() {
        const hint = document.getElementById('controls-hint');
        if (!hint) return;
        
        const keys = hint.querySelectorAll('.key');
        keys.forEach(key => {
            const keyText = key.textContent;
            let isActive = false;
            // W = Forward
            if (keyText === 'W') isActive = this.keys['KeyW'] || this.keys['ArrowUp'];
            // A = Left
            if (keyText === 'A') isActive = this.keys['KeyA'] || this.keys['ArrowLeft'];
            // S = Brake
            if (keyText === 'S') isActive = this.keys['KeyS'] || this.keys['ArrowDown'];
            // D = Right
            if (keyText === 'D') isActive = this.keys['KeyD'] || this.keys['ArrowRight'];
            key.classList.toggle('active', isActive);
        });
    }
}

/**
 * ------------------------------------------------------------------
 * VISUAL EFFECTS (Particles)
 * ------------------------------------------------------------------
 */
class ParticleSystem {
    constructor(ctx, width, height) {
        this.ctx = ctx;
        this.width = width;
        this.height = height;
        this.particles = [];
        this.maxParticles = 50;
    }

    updateAndDraw(speedRatio) {
        if (speedRatio < 0.5) return; // Only show speed lines at high speed

        // Spawn particles
        if (this.particles.length < this.maxParticles && Math.random() > 0.5) {
            this.particles.push({
                x: Math.random() * this.width,
                y: Math.random() * this.height,
                z: 0,
                angle: 0,
                speed: 10 + Math.random() * 20
            });
        }

        this.ctx.strokeStyle = `rgba(255, 255, 255, ${speedRatio * 0.3})`;
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();

        const centerX = this.width / 2;
        const centerY = this.height / 2;

        for (let i = this.particles.length - 1; i >= 0; i--) {
            let p = this.particles[i];
            
            // Move away from center
            const dx = p.x - centerX;
            const dy = p.y - centerY;
            const angle = Math.atan2(dy, dx);
            
            p.x += Math.cos(angle) * p.speed * speedRatio;
            p.y += Math.sin(angle) * p.speed * speedRatio;
            
            // Draw streak
            this.ctx.moveTo(p.x, p.y);
            this.ctx.lineTo(p.x - Math.cos(angle) * 20, p.y - Math.sin(angle) * 20);

            // Remove if off screen
            if (p.x < 0 || p.x > this.width || p.y < 0 || p.y > this.height) {
                this.particles.splice(i, 1);
            }
        }
        this.ctx.stroke();
    }
}

/**
 * ------------------------------------------------------------------
 * GAME LOGIC
 * ------------------------------------------------------------------
 */
class Utils {
    static project(p, cameraX, cameraY, cameraZ, cameraDepth, width, height, roadWidth) {
        p.camera.x = (p.world.x || 0) - cameraX;
        p.camera.y = (p.world.y || 0) - cameraY;
        p.camera.z = (p.world.z || 0) - cameraZ;
        if (p.camera.z <= 0) { p.screen.scale = 0; return; }
        p.screen.scale = cameraDepth / p.camera.z;
        p.screen.x = Math.round((width / 2) + (p.screen.scale * p.camera.x * width / 2));
        p.screen.y = Math.round((height / 2) - (p.screen.scale * p.camera.y * height / 2));
        p.screen.w = Math.round((p.screen.scale * roadWidth * width / 2));
    }
    static percentRemaining(n, total) { return (n % total) / total; }
    static interpolate(a, b, percent) { return a + (b - a) * percent; }
    static randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
}

class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d', { alpha: false });
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.canvas.width = this.width;
        this.canvas.height = this.height;

        this.input = new InputSystem();
        this.audio = new AudioController();
        this.particles = new ParticleSystem(this.ctx, this.width, this.height);
        
        this.position = 0;      
        this.playerX = 0;       
        this.speed = 0;         
        this.score = 0;
        this.distanceRun = 0;
        this.segments = [];     
        this.isPlaying = false;
        this.isGameOver = false;
        
        // Load High Score
        this.highScore = parseInt(localStorage.getItem('gestureRiderHighScore')) || 0;

        this.resetRoad();
        
        this.step = this.step.bind(this);
        this.lastTime = performance.now();
        
        document.getElementById('restart-btn').addEventListener('click', () => this.restart());
    }

    restart() {
        document.getElementById('game-over-screen').classList.add('hidden');
        this.resetRoad();
        this.speed = 0;
        this.score = 0;
        this.distanceRun = 0;
        this.position = 0;
        this.playerX = 0;
        this.isGameOver = false;
        this.isPlaying = true;
        this.lastTime = performance.now();
        this.audio.resume();
        this.audio.update(0);
        requestAnimationFrame(this.step);
    }

    resetRoad() {
        this.segments = [];
        const TOTAL_SEGMENTS = 2000; 
        for (let i = 0; i < TOTAL_SEGMENTS; i++) {
            const curve = (i > 100 && i < 300) ? 2 : (i > 500 && i < 700) ? -3 : (i > 1000 && i < 1200) ? 4 : (i > 1500 && i < 1700) ? -2 : 0;
            this.segments.push({
                index: i,
                p1: { world: { y:0, z: i * CONFIG.SEGMENT_LENGTH }, camera: {}, screen: {} },
                p2: { world: { y:0, z: (i + 1) * CONFIG.SEGMENT_LENGTH }, camera: {}, screen: {} },
                color: Math.floor(i / 3) % 2 ? CONFIG.COLORS.ROAD_DARK : CONFIG.COLORS.ROAD_LIGHT,
                curve: curve,
                cars: [],
                sprites: []
            });
            
            if (i > 20 && i % 40 === 0 && Math.random() > 0.3) {
                // Precise lane alignment for 3 lanes: Left (-0.65), Center (0), Right (0.65)
                // This ensures "gaps" (the white lines) are exactly between these values
                const lanes = [-0.65, 0, 0.65]; 
                this.addCar(i, lanes[Math.floor(Math.random() * lanes.length)], Utils.randomInt(3000, 8000));
            }
            if (i % 20 === 0 && Math.random() > 0.2) {
                const side = Math.random() > 0.5 ? 1 : -1;
                this.addSprite(i, side * (1.5 + Math.random()), 'tree');
            }
        }
    }

    addCar(segmentIndex, offset, speed) {
        this.segments[segmentIndex].cars.push({
            offset: offset,
            z: segmentIndex * CONFIG.SEGMENT_LENGTH,
            speed: speed,
            percent: 0,
            type: Math.random() > 0.5 ? 'car' : 'truck',
            justPassed: false
        });
    }

    addSprite(segmentIndex, offset, type) {
        this.segments[segmentIndex].sprites.push({ offset: offset, type: type });
    }

    start() {
        this.audio.init();
        this.isPlaying = true;
        this.lastTime = performance.now();
        requestAnimationFrame(this.step);
    }

    update(dt) {
        if (this.isGameOver) return;

        const cmd = this.input.getCommand();
        const ratio = this.speed / CONFIG.MAX_SPEED;
        this.audio.update(ratio); // Update Audio
        
        if (cmd.accel > 0) this.speed += CONFIG.ACCEL * cmd.accel * dt * 60;
        else if (cmd.brake > 0) this.speed += CONFIG.BRAKING * dt * 60;
        else this.speed += CONFIG.DECEL * dt * 60;

        this.speed = Math.max(0, Math.min(this.speed, CONFIG.MAX_SPEED));

        const dx = dt * 2 * cmd.steer * (this.speed / CONFIG.MAX_SPEED); 
        this.playerX = this.playerX - dx;
        
        const playerSegment = this.findSegment(this.position + CONFIG.CAMERA_DEPTH * CONFIG.SEGMENT_LENGTH);
        this.playerX = this.playerX - (dx * playerSegment.curve * ratio * 0.1); 

        if ((this.playerX < -1 || this.playerX > 1) && this.speed > 2000) this.speed += CONFIG.OFF_ROAD_DECEL * dt * 60;
        
        this.playerX = Math.max(-2, Math.min(2, this.playerX));
        this.position += this.speed * dt;
        this.distanceRun += this.speed * dt;
        
        const trackLength = this.segments.length * CONFIG.SEGMENT_LENGTH;
        if (this.position >= trackLength) this.position -= trackLength;
        if (this.position < 0) this.position += trackLength;

        this.updateTraffic(dt, playerSegment);
        this.checkSpriteCollisions(); // Check tree collisions

        // Update HUD
        document.getElementById('scoreVal').innerText = Math.floor(this.score);
        document.getElementById('distVal').innerText = (this.distanceRun / 100000).toFixed(1);
        document.getElementById('speedVal').innerText = Math.floor(this.speed / 100);
    }

    checkSpriteCollisions() {
        const playerZ = this.position + CONFIG.CAMERA_HEIGHT;
        const trackLen = this.segments.length * CONFIG.SEGMENT_LENGTH;
        // Check overlapping segments
        const startSegIndex = Math.floor(playerZ / CONFIG.SEGMENT_LENGTH) % this.segments.length;
        
        // Check current and neighbors
        for(let i = -1; i <= 2; i++) {
            const idx = (startSegIndex + i + this.segments.length) % this.segments.length;
            const segment = this.segments[idx];
            
            for(let j = 0; j < segment.sprites.length; j++) {
                const sprite = segment.sprites[j];
                const spriteZ = segment.p1.world.z;
                
                let dist = spriteZ - playerZ;
                if (dist < -trackLen/2) dist += trackLen;
                if (dist > trackLen/2) dist -= trackLen;
                
                if (Math.abs(dist) < 100) { 
                    const spriteW = 0.3; // Tree trunk width
                    const playerW = 0.15; // Bike width
                    
                    if (this.overlap(this.playerX, playerW, sprite.offset, spriteW)) {
                        this.crash();
                        return;
                    }
                }
            }
        }
    }

    updateTraffic(dt, playerSegment) {
        const carsToMove = [];
        const playerZ = this.position + CONFIG.CAMERA_HEIGHT; 
        const trackLen = this.segments.length * CONFIG.SEGMENT_LENGTH;

        for(let i=0; i<this.segments.length; i++) {
            let segment = this.segments[i];
            
            for(let j=0; j<segment.cars.length; j++) {
                let car = segment.cars[j];
                car.z += car.speed * dt;
                
                if (car.z > trackLen) car.z -= trackLen;
                if (car.z < 0) car.z += trackLen;

                let currentSegmentIndex = i;
                let actualSegmentIndex = Math.floor(car.z / CONFIG.SEGMENT_LENGTH) % this.segments.length;

                if (currentSegmentIndex !== actualSegmentIndex) {
                    carsToMove.push({ car: car, from: currentSegmentIndex, to: actualSegmentIndex });
                }

                // Interaction Logic
                let dist = car.z - playerZ;
                if (dist < -trackLen/2) dist += trackLen;
                if (dist > trackLen/2) dist -= trackLen;

                // Close Call / Overtake Logic
                if (dist < -100 && dist > -300 && !car.justPassed) {
                    // Check lateral distance
                    // playerX is -1 to 1, car.offset is -1 to 1
                    // Normalized lateral distance
                    const lateralDist = Math.abs(this.playerX - car.offset);
                    // Safe overtaking distance but close enough for thrill
                    if (lateralDist < 0.8 && lateralDist > 0.35) {
                        this.triggerCloseCall();
                        car.justPassed = true;
                    }
                }
                
                // Reset passed flag when far away
                if (Math.abs(dist) > 1000) car.justPassed = false;

                // Collision Logic
                if (Math.abs(dist) < 200) { 
                    // Realistic Lane Splitting Logic:
                    // Cars are roughly 0.45 width (leaving plenty of gap in a 1.0 lane)
                    // Player is significantly narrowed to 0.15 (motorcycle width) to allow threading
                    const carW = 0.45; 
                    const playerW = 0.15; 
                    
                    if (this.overlap(this.playerX, playerW, car.offset, carW)) {
                        this.crash();
                    }
                }
            }
        }

        for (let move of carsToMove) {
            const fromSeg = this.segments[move.from];
            const toSeg = this.segments[move.to];
            const index = fromSeg.cars.indexOf(move.car);
            if (index > -1) {
                fromSeg.cars.splice(index, 1);
                toSeg.cars.push(move.car);
            }
        }
        
        if (this.speed > 0) this.score += (this.speed / 1000) * dt * 10;
    }

    triggerCloseCall() {
        this.score += 500;
        const msg = document.createElement('div');
        msg.className = 'float-msg';
        msg.innerText = "CLOSE CALL +500";
        const area = document.getElementById('message-area');
        area.appendChild(msg);
        setTimeout(() => area.removeChild(msg), 1000);
    }

    overlap(x1, w1, x2, w2) {
        const half1 = w1/2; const half2 = w2/2;
        const min1 = x1 - half1; const max1 = x1 + half1;
        const min2 = x2 - half2; const max2 = x2 + half2;
        return !((max1 < min2) || (min1 > max2));
    }

    crash() {
        this.speed = 0;
        this.isGameOver = true;
        this.audio.playCrash();
        
        // High Score Logic
        if (this.score > this.highScore) {
            this.highScore = Math.floor(this.score);
            localStorage.setItem('gestureRiderHighScore', this.highScore);
        }

        document.getElementById('final-score').innerText = Math.floor(this.score);
        document.getElementById('best-score').innerText = this.highScore;
        document.getElementById('game-over-screen').classList.remove('hidden');
    }

    findSegment(z) {
        return this.segments[Math.floor(z / CONFIG.SEGMENT_LENGTH) % this.segments.length];
    }

    render() {
        this.ctx.clearRect(0, 0, this.width, this.height);
        this.renderBackground();

        let baseSegment = this.findSegment(this.position);
        let basePercent = Utils.percentRemaining(this.position, CONFIG.SEGMENT_LENGTH);
        
        let playerSegment = this.findSegment(this.position + CONFIG.CAMERA_DEPTH * CONFIG.SEGMENT_LENGTH);
        let playerPercent = Utils.percentRemaining(this.position + CONFIG.CAMERA_DEPTH * CONFIG.SEGMENT_LENGTH, CONFIG.SEGMENT_LENGTH);
        let playerY = Utils.interpolate(playerSegment.p1.world.y, playerSegment.p2.world.y, playerPercent);
        
        let dx = -(baseSegment.curve * basePercent);
        let x = 0;
        let maxY = this.height; 

        for(let n = 0; n < CONFIG.DRAW_DISTANCE; n++) {
            let segment = this.segments[(baseSegment.index + n) % this.segments.length];
            segment.looped = segment.index < baseSegment.index;
            x += dx; dx += segment.curve;
            let segmentLoopOffset = segment.looped ? this.segments.length * CONFIG.SEGMENT_LENGTH : 0;
            
            Utils.project(segment.p1, (this.playerX * CONFIG.ROAD_WIDTH) - x, playerY + CONFIG.CAMERA_HEIGHT, this.position - segmentLoopOffset, CONFIG.CAMERA_DEPTH, this.width, this.height, CONFIG.ROAD_WIDTH);
            Utils.project(segment.p2, (this.playerX * CONFIG.ROAD_WIDTH) - x - dx, playerY + CONFIG.CAMERA_HEIGHT, this.position - segmentLoopOffset, CONFIG.CAMERA_DEPTH, this.width, this.height, CONFIG.ROAD_WIDTH);

            if(segment.p1.camera.z <= CONFIG.CAMERA_DEPTH || segment.p2.screen.y >= maxY || segment.p2.screen.y >= segment.p1.screen.y) continue;

            this.renderSegment(segment);
            maxY = segment.p1.screen.y; 
            segment.clipY = maxY; 
        }

        for(let n = CONFIG.DRAW_DISTANCE - 1; n > 0; n--) {
            let segment = this.segments[(baseSegment.index + n) % this.segments.length];
            
            for(let i=0; i<segment.cars.length; i++) {
                let car = segment.cars[i];
                let spriteScale = segment.p1.screen.w; // Scale based on road width
                if (spriteScale > 5) { // Optimization
                     let spriteX = segment.p1.screen.x + (segment.p1.screen.w * car.offset);
                     let spriteY = segment.p1.screen.y;
                     this.renderCar(spriteX, spriteY, spriteScale, car);
                }
            }

            for(let i=0; i<segment.sprites.length; i++) {
                let sprite = segment.sprites[i];
                let spriteScale = segment.p1.screen.w;
                if (spriteScale > 5) {
                    let spriteX = segment.p1.screen.x + (segment.p1.screen.w * sprite.offset);
                    let spriteY = segment.p1.screen.y;
                    this.renderSprite(spriteX, spriteY, spriteScale, sprite.type);
                }
            }
        }
        
        // Speed Lines
        this.particles.updateAndDraw(this.speed / CONFIG.MAX_SPEED);
        
        this.renderCockpit();
    }

    renderBackground() {
        let grad = this.ctx.createLinearGradient(0, 0, 0, this.height);
        grad.addColorStop(0, CONFIG.COLORS.SKY_TOP);
        grad.addColorStop(1, CONFIG.COLORS.SKY_BOTTOM);
        this.ctx.fillStyle = grad;
        this.ctx.fillRect(0, 0, this.width, this.height);
        
        // Sun
        this.ctx.fillStyle = 'rgba(255, 200, 100, 0.2)';
        this.ctx.beginPath();
        this.ctx.arc(this.width * 0.8, this.height * 0.2, 80, 0, Math.PI*2);
        this.ctx.fill();

        // Mountains
        this.ctx.fillStyle = '#051020';
        this.ctx.beginPath();
        this.ctx.moveTo(0, this.height/2 + 50);
        for(let i=0; i<this.width; i+=50) {
            this.ctx.lineTo(i, (this.height/2) - 50 + Math.random()*50);
        }
        this.ctx.lineTo(this.width, this.height/2 + 50);
        this.ctx.fill();
    }

    renderSegment(segment) {
        let x1 = segment.p1.screen.x; let y1 = segment.p1.screen.y; let w1 = segment.p1.screen.w;
        let x2 = segment.p2.screen.x; let y2 = segment.p2.screen.y; let w2 = segment.p2.screen.w;

        this.ctx.fillStyle = (Math.floor(segment.index / 3) % 2) ? CONFIG.COLORS.GRASS_DARK : CONFIG.COLORS.GRASS_LIGHT;
        this.ctx.fillRect(0, y2, this.width, y1 - y2);

        this.ctx.fillStyle = segment.color;
        this.ctx.beginPath();
        this.ctx.moveTo(x1 - w1, y1); this.ctx.lineTo(x2 - w2, y2);
        this.ctx.lineTo(x2 + w2, y2); this.ctx.lineTo(x1 + w1, y1);
        this.ctx.fill();

        let r1 = w1 / Math.max(6, 2 * CONFIG.LANES); let r2 = w2 / Math.max(6, 2 * CONFIG.LANES);
        this.ctx.fillStyle = (Math.floor(segment.index / 2) % 2) ? '#fff' : CONFIG.COLORS.RUMBLE;
        this.ctx.beginPath(); this.ctx.moveTo(x1 - w1 - r1, y1); this.ctx.lineTo(x1 - w1, y1); this.ctx.lineTo(x2 - w2, y2); this.ctx.lineTo(x2 - w2 - r2, y2); this.ctx.fill();
        this.ctx.beginPath(); this.ctx.moveTo(x1 + w1 + r1, y1); this.ctx.lineTo(x1 + w1, y1); this.ctx.lineTo(x2 + w2, y2); this.ctx.lineTo(x2 + w2 + r2, y2); this.ctx.fill();
        
        if (Math.floor(segment.index / 2) % 2) {
             let l1 = w1 / 40; let l2 = w2 / 40;
             this.ctx.fillStyle = CONFIG.COLORS.LANE_MARKER;
             let lanex1 = x1 - w1 * 0.33; let lanex2 = x2 - w2 * 0.33;
             this.ctx.beginPath(); this.ctx.moveTo(lanex1 - l1, y1); this.ctx.lineTo(lanex1 + l1, y1); this.ctx.lineTo(lanex2 + l2, y2); this.ctx.lineTo(lanex2 - l2, y2); this.ctx.fill();
             lanex1 = x1 + w1 * 0.33; lanex2 = x2 + w2 * 0.33;
             this.ctx.beginPath(); this.ctx.moveTo(lanex1 - l1, y1); this.ctx.lineTo(lanex1 + l1, y1); this.ctx.lineTo(lanex2 + l2, y2); this.ctx.lineTo(lanex2 - l2, y2); this.ctx.fill();
        }
    }

    renderSprite(x, y, scale, type) {
        if (scale <= 0) return;
        const w = scale * 0.5; const h = scale * 1.5;
        if (type === 'tree') {
            this.ctx.fillStyle = CONFIG.COLORS.TREE_TRUNK;
            this.ctx.fillRect(x - w*0.2, y - h, w*0.4, h);
            this.ctx.fillStyle = CONFIG.COLORS.TREE_LEAVES;
            this.ctx.beginPath(); this.ctx.moveTo(x - w, y - h*0.5); this.ctx.lineTo(x, y - h * 1.5); this.ctx.lineTo(x + w, y - h*0.5); this.ctx.fill();
            this.ctx.beginPath(); this.ctx.moveTo(x - w*0.8, y - h); this.ctx.lineTo(x, y - h * 1.8); this.ctx.lineTo(x + w*0.8, y - h); this.ctx.fill();
        }
    }

    renderCar(x, y, scale, car) {
        if(scale <= 0) return;
        const w = scale * 0.5; const h = scale * 0.4;
        this.ctx.fillStyle = car.type === 'truck' ? '#334455' : '#882222';
        this.ctx.fillRect(x - w/2, y - h, w, h);
        this.ctx.fillStyle = '#111';
        this.ctx.fillRect(x - w/2 - w*0.1, y - h*0.3, w*0.2, h*0.3); 
        this.ctx.fillRect(x + w/2 - w*0.1, y - h*0.3, w*0.2, h*0.3);
        this.ctx.fillStyle = '#ff0000';
        this.ctx.shadowBlur = 10; this.ctx.shadowColor = '#ff0000';
        this.ctx.fillRect(x - w*0.4, y - h*0.6, w*0.15, h*0.15);
        this.ctx.fillRect(x + w*0.25, y - h*0.6, w*0.15, h*0.15);
        this.ctx.shadowBlur = 0;
        this.ctx.fillStyle = '#221111';
        this.ctx.fillRect(x - w*0.4, y - h*0.9, w*0.8, h*0.3);
    }

    renderCockpit() {
        const cx = this.width / 2;
        const cy = this.height;
        const shakeX = (Math.random() - 0.5) * (this.speed / CONFIG.MAX_SPEED) * 5;
        const shakeY = (Math.random() - 0.5) * (this.speed / CONFIG.MAX_SPEED) * 5;
        const lean = this.input.gesture.active ? this.input.gesture.tilt * 100 : (this.input.keys['ArrowLeft'] ? -50 : (this.input.keys['ArrowRight']? 50 : 0));

        this.ctx.save();
        this.ctx.translate(cx + shakeX + lean, cy + shakeY);
        // Tilt the cockpit slightly based on steering
        this.ctx.rotate(lean * 0.002);

        this.ctx.beginPath();
        this.ctx.fillStyle = 'rgba(0, 50, 50, 0.2)';
        this.ctx.arc(0, 0, 400, Math.PI, 0); 
        this.ctx.fill();

        this.ctx.fillStyle = '#111';
        this.ctx.beginPath(); this.ctx.arc(0, 0, 150, Math.PI, 0); 
        this.ctx.fill();
        this.ctx.strokeStyle = '#333'; this.ctx.lineWidth = 5; this.ctx.stroke();

        this.ctx.fillStyle = '#fff';
        this.ctx.font = '20px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.fillText("KM/H", 0, -50);
        
        this.ctx.font = 'bold 40px monospace';
        this.ctx.fillStyle = this.speed > CONFIG.MAX_SPEED * 0.9 ? '#ff0055' : '#00ff88';
        this.ctx.fillText(Math.floor(this.speed / 100), 0, -90);

        this.ctx.strokeStyle = '#222';
        this.ctx.lineWidth = 20;
        this.ctx.lineCap = 'round';
        this.ctx.beginPath(); this.ctx.moveTo(-100, -20); this.ctx.quadraticCurveTo(-200, -50, -400, 100); this.ctx.stroke();
        this.ctx.beginPath(); this.ctx.moveTo(100, -20); this.ctx.quadraticCurveTo(200, -50, 400, 100); this.ctx.stroke();
        this.ctx.lineWidth = 25; this.ctx.strokeStyle = '#000';
        this.ctx.beginPath(); this.ctx.moveTo(-350, 60); this.ctx.lineTo(-400, 100); this.ctx.stroke();
        this.ctx.beginPath(); this.ctx.moveTo(350, 60); this.ctx.lineTo(400, 100); this.ctx.stroke();
        this.ctx.restore();
    }

    step(now) {
        if (!this.isPlaying) return;
        const dt = Math.min(1, (now - this.lastTime) / 1000);
        this.lastTime = now;
        this.update(dt);
        this.render();
        requestAnimationFrame(this.step);
    }
}

window.onload = () => {
    const startBtn = document.getElementById('start-btn');
    const loadingMsg = document.getElementById('loading-msg');
    const overlay = document.getElementById('overlay-screen');
    const game = new Game();
    let gameStarted = false;
    let cameraReady = false;

    // Function to start the game
    const startGame = () => {
        if (gameStarted) return;
        gameStarted = true;
        overlay.classList.add('hidden');
        game.start();
    };

    // Set up wave gesture callback for starting
    game.input.onWaveDetected = () => {
        if (!gameStarted && cameraReady) {
            startGame();
        } else if (game.isGameOver) {
            game.restart();
        }
    };

    // Try to start camera immediately
    (async () => {
        startBtn.disabled = true;
        startBtn.innerText = "Loading Camera...";
        loadingMsg.innerText = "Initializing hand tracking...";
        
        try {
            await game.input.startCamera();
            cameraReady = true;
            startBtn.disabled = false;
            startBtn.innerText = "START ENGINE";
            loadingMsg.innerHTML = '👋 <strong>Wave your hand</strong> to start<br>or click the button below';
        } catch(e) {
            console.error(e);
            cameraReady = false;
            startBtn.disabled = false;
            startBtn.innerText = "START (Keyboard Mode)";
            loadingMsg.innerText = "Camera unavailable - Keyboard controls only";
        }
    })();

    startBtn.addEventListener('click', () => {
        startGame();
    });
};
