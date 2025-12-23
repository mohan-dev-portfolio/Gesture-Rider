# 🏍️ Gesture Rider - AI Powered Moto Sim

Gesture Rider is an immersive, browser-based motorcycle racing game controlled entirely by hand gestures. Inspired by the classic Traffic Rider, it combines a custom-built Pseudo-3D rendering engine with real-time Computer Vision to deliver a unique arcade experience without the need for game engines, VR headsets, or heavy downloads.

## 🎮 Features

- **AI Gesture Control**: Steer by tilting your hand, accelerate by opening your palm, and brake by closing your fist. Powered by MediaPipe Hands.

- **Custom Pseudo-3D Engine**: A retro-style rendering engine built from scratch using the HTML5 Canvas API. No 3D libraries (like Three.js) were used—just pure math and perspective projection.

- **Procedural Infinite Highway**: Endless gameplay with dynamic road curvature, scenery generation, and traffic patterns.

- **Synthesized Audio Engine**: Real-time engine revs, wind noise, and crash sound effects generated procedurally via the Web Audio API (no external audio files).

- **Skill-Based Gameplay**: Includes "Lane Splitting" mechanics where close overtakes grant bonus points.

- **Zero Dependencies**: The entire game is contained in a single HTML file. No build steps, bundlers, or local servers required.

## 🕹️ Controls

You can play using your webcam (AI Mode) or keyboard (Fallback Mode).

| Action | Hand Gesture ✋ | Keyboard ⌨️ |
|--------|----------------|-------------|
| Steer | Tilt hand Left / Right (like a doorknob) | Left Arrow / Right Arrow |
| Accelerate | Open Palm (Spread fingers) | Spacebar / Up Arrow |
| Brake | Closed Fist | B / Down Arrow |

## 🛠️ Technical Implementation

### 1. Computer Vision Layer

The game utilizes MediaPipe Hands to track 21 3D hand landmarks in real-time.

- **Steering**: Calculated using the roll angle (arctangent) between the wrist and the middle finger base.
- **Throttle/Brake**: Determined by calculating the Euclidean distance between finger tips and their respective PIP joints to detect finger extension.

### 2. Pseudo-3D Rendering (2.5D)

Instead of a true 3D engine, the game uses a **Z-Map Segment Projection** technique similar to classic 80s racers (e.g., OutRun).

- The road is divided into 2000 segments.
- Each frame, the engine projects visible segments from World Space (X, Y, Z) to Screen Space (X, Y) based on the camera's depth and field of view.
- Curvature is simulated by shifting the X-offset of segments cumulatively as they move into the distance.

### 3. Audio Synthesis

- **Engine**: A Sawtooth oscillator node connected to a Lowpass filter. The frequency and filter Q-value modulate based on the bike's speed to simulate RPM.
- **Wind**: A white noise buffer processed through a Highpass filter that increases in gain as speed increases.

## 🚀 How to Run

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/gesture-rider.git
   ```

2. **Open the file:**
   Simply open `gesture-rider.html` in any modern web browser (Chrome, Edge, Firefox).

3. **Grant Permissions:**
   Allow camera access when prompted to enable AI controls.

## 📦 Dependencies

- MediaPipe Hands (Loaded via CDN)
- MediaPipe Camera Utils (Loaded via CDN)

## 📝 License

Distributed under the MIT License. See `LICENSE` for more information.

---

Built with ❤️ using HTML5, Canvas, and AI.
