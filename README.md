# Traffic Smart

Traffic Smart is a COA mini-project simulator that demonstrates a **Smart Traffic Signal Controller with Processor Performance Simulator**.

## What is new in this version?
- Interactive **small-town map** instead of a simple static junction
- **Drag to pan** around the town like a game
- **Scroll to zoom** in and out
- Many **moving vehicles** on all four main approaches
- Buildings, parks, road network, crosswalks, and traffic lights
- Emergency-vehicle interrupt priority
- Queue-based adaptive traffic control tied to the COA logic

## Features
- Adaptive signal mode
- Fixed 20-second mode
- Rush Hour preset
- Random traffic generation
- Emergency interrupt buttons
- Processor metrics: instructions, cycles, CPI, CPU time, cache hits/misses
- Execution trace panel

## Controls
- **Start / Pause / Reset** — control the simulation
- **Sliders** — set North, South, East, and West traffic queues
- **Drag inside the map** — move around the town
- **Mouse wheel / trackpad scroll** — zoom in and out
- **Click a road entry** — inject extra traffic from that direction
- **Center View** — return camera to the main junction

## Algorithm
The adaptive controller uses:

`green = clamp(10 + 0.5 × phaseQueue, 10, 35)`

Where:
- `phaseQueue` = total queue count for the active phase
- NS phase = North + South
- EW phase = East + West

## COA Concepts Demonstrated
- Registers
- ALU
- Control Unit
- Instruction Cycle
- Interrupt Handling
- Processor Performance Metrics

## Run locally
Because this project uses plain HTML, CSS, and JavaScript, you can run it directly.

### Option 1
Open `index.html` in the browser.

### Option 2
Run a simple local server:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## Academic note
The processor metrics shown are an **educational simulation model** created to support the COA mini-project demonstration. They are not hardware-benchmark values.
