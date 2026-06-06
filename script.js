// Polyfill for roundRect in older browser environments
if (typeof CanvasRenderingContext2D.prototype.roundRect !== 'function') {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, radii) {
        if (!radii) radii = 0;
        let r = 0;
        if (Array.isArray(radii)) {
            r = radii[0] || 0;
        } else {
            r = radii;
        }
        this.beginPath();
        this.moveTo(x + r, y);
        this.arcTo(x + w, y, x + w, y + h, r);
        this.arcTo(x + w, y + h, x, y + h, r);
        this.arcTo(x, y + h, x, y, r);
        this.arcTo(x, y, x + w, y, r);
        this.closePath();
        return this;
    };
}

// State variables
let isPlaying = false;
let animationSpeed = 1.0;
let simulationTime = 50; // Range: 0 to 1000
let lastTime = 0;
let currentStage = 0;

// Transform matrix for Zoom & Pan
const transform = {
    x: 100,
    y: 0,
    scale: 0.8
};

// Canvas elements
let canvas, ctx, canvasContainer;
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let transformStart = { x: 0, y: 0 };

// Touch zoom/pan tracking
let touchStartDist = 0;
let touchStartScale = 1;
let touchStartMid = { x: 0, y: 0 };
let isPinching = false;

// Track canvas dimensions for relative panning on resize
let lastCanvasWidth = 0;
let lastCanvasHeight = 0;

// DNA Configuration
const NUM_BASES = 45;
const BASE_SPACING = 80;
const SEPARATION_Y = 160;
const PARENTAL_SEPARATION = 50;
const FORK_TRANSITION_WIDTH = 250;
const BASE_HEIGHT = 45;
const BASE_WIDTH = 22;

// Template DNA base sequence
const templateBases = [
    'A', 'T', 'G', 'C', 'A', 'A', 'T', 'G', 'C', 'T', 
    'A', 'C', 'G', 'T', 'A', 'G', 'C', 'T', 'A', 'T', 
    'G', 'C', 'A', 'A', 'T', 'G', 'C', 'T', 'A', 'C', 
    'G', 'T', 'A', 'G', 'C', 'T', 'A', 'T', 'G', 'C', 
    'A', 'T', 'C', 'G', 'T'
];

// Get complementary base
function getComplement(base, isRna = false) {
    if (base === 'A') return isRna ? 'U' : 'T';
    if (base === 'T' || base === 'U') return 'A';
    if (base === 'G') return 'C';
    if (base === 'C') return 'G';
    return '';
}

// Particle system for floating nucleotides and sparkles
const particles = [];
const floatingBases = [];

function spawnSparkle(x, y, color) {
    for (let i = 0; i < 8; i++) {
        particles.push({
            x: x,
            y: y,
            vx: (Math.random() - 0.5) * 6,
            vy: (Math.random() - 0.5) * 6,
            size: Math.random() * 4 + 2,
            color: color || '#ffffff',
            life: 1.0,
            decay: Math.random() * 0.05 + 0.03
        });
    }
}

function spawnFloatingBase(targetX, targetY, base, isRna) {
    const side = Math.random() > 0.5 ? 1 : -1;
    floatingBases.push({
        x: targetX + (Math.random() - 0.5) * 400,
        y: targetY + side * (Math.random() * 200 + 150),
        targetX: targetX,
        targetY: targetY,
        base: base,
        isRna: isRna,
        progress: 0,
        speed: Math.random() * 0.03 + 0.02
    });
}

// Setup elements when DOM is ready
function init() {
    canvas = document.getElementById('simulation-canvas');
    ctx = canvas.getContext('2d');
    canvasContainer = document.getElementById('canvas-container');

    // Initial resize and centering
    resizeCanvas();
    resetView();
    
    window.addEventListener('resize', () => {
        resizeCanvas();
    });

    // Attach control listeners
    setupControls();
    
    // Attach mouse & touch listeners
    setupInteractions();

    // Start animation loop
    lastTime = performance.now();
    requestAnimationFrame(animationLoop);
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Resize canvas properly considering DPR
function resizeCanvas() {
    const rect = canvasContainer.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    
    // Round to integer to prevent infinite resize loop on float sizes
    const targetWidth = Math.floor(rect.width * dpr);
    const targetHeight = Math.floor(rect.height * dpr);
    
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        ctx.scale(dpr, dpr);
    }
    
    // Adjust panning offsets relative to center changes on resize
    if (lastCanvasHeight > 0 && lastCanvasWidth > 0) {
        const dw = rect.width - lastCanvasWidth;
        const dh = rect.height - lastCanvasHeight;
        transform.x += dw / 2;
        transform.y += dh / 2;
    } else if (rect.width > 0 && rect.height > 0) {
        // First time we get a valid size, center the view
        resetView();
    }
    
    lastCanvasWidth = rect.width;
    lastCanvasHeight = rect.height;
}

// Center the view on the screen
function resetView() {
    const rect = canvasContainer.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return; // Wait for layout
    transform.scale = rect.width < 768 ? 0.55 : 0.75;
    transform.x = rect.width * 0.15;
    transform.y = rect.height / 2;
    updateZoomIndicator();
}

function updateZoomIndicator() {
    document.getElementById('zoom-indicator').innerText = `${Math.round(transform.scale * 100)}%`;
}

// Custom theme variable retrieval from documentElement (root) with safe fallback values
function getThemeColor(varName, fallbackColor = '#ffffff') {
    const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return val || fallbackColor;
}

// Main logic calculator
// Computes active coordinates, active enzymes, and replication progress based on time (0-1000)
function getReplicationState(time) {
    const state = {
        forkX: -100,
        helicase: { active: false, x: 0, y: 0 },
        primaseTop: { active: false, x: 0, y: 0, progress: 0 },
        primaseBottom: { active: false, x: 0, y: 0, progress: 0 },
        polyTop: { active: false, x: 0, y: 0 },
        polyBottom: { active: false, x: 0, y: 0 },
        ligase: { active: false, x: 0, y: 0, sparkle: false },
        topReplication: Array(NUM_BASES).fill(null), // null | 'RNA' | 'DNA'
        bottomReplication: Array(NUM_BASES).fill(null)
    };

    // Stage 0: Fully wound double helix
    if (time < 100) {
        state.forkX = -200; // Complete double helix, fork has not entered yet
    }
    // Stage 1: Unwinding
    else if (time >= 100 && time < 250) {
        const t = (time - 100) / 150; // 0 to 1
        state.forkX = lerp(-200, 15 * BASE_SPACING, t); // Unzipping L-to-R
        state.helicase.active = true;
        state.helicase.x = state.forkX;
        state.helicase.y = 0;
    }
    // Stage 2: Primer 1 binding
    else if (time >= 250 && time < 380) {
        state.forkX = 15 * BASE_SPACING;
        state.helicase.active = true;
        state.helicase.x = state.forkX;

        // Primase binds and places RNA primer
        // Top strand: binds at index 0-3 (moves left-to-right)
        // Bottom strand: binds at index 11-14 (Primer is 5' (R) to 3' (L). Synthesized R-to-L)
        const t = (time - 250) / 130; // 0 to 1
        
        state.primaseTop.active = true;
        state.primaseTop.x = lerp(0 * BASE_SPACING, 3 * BASE_SPACING, t);
        state.primaseTop.y = -SEPARATION_Y;
        state.primaseTop.progress = t;

        state.primaseBottom.active = true;
        state.primaseBottom.x = lerp(14 * BASE_SPACING, 11 * BASE_SPACING, t);
        state.primaseBottom.y = SEPARATION_Y;
        state.primaseBottom.progress = t;

        // Populate primers
        const topPrimerLimit = Math.floor(lerp(0, 4, t));
        for (let i = 0; i < topPrimerLimit; i++) {
            state.topReplication[i] = 'RNA';
        }
        
        const bottomPrimerLimit = Math.floor(lerp(15, 10, t));
        for (let i = 14; i > bottomPrimerLimit; i--) {
            state.bottomReplication[i] = 'RNA';
        }
    }
    // Stage 3: Synthesis 1 (Leading strand continuous synthesis & Lagging strand Fragment 1)
    else if (time >= 380 && time < 520) {
        const t = (time - 380) / 140;
        
        // Fork opens from 15 to 30 (leading and lagging strands replicate concurrently as fork opens)
        state.forkX = lerp(15 * BASE_SPACING, 30 * BASE_SPACING, t);
        state.helicase.active = true;
        state.helicase.x = state.forkX;
        state.helicase.y = 0;

        // Leading strand primer is preserved
        for (let i = 0; i <= 3; i++) state.topReplication[i] = 'RNA';
        // Lagging strand primer 1 is preserved
        for (let i = 11; i <= 14; i++) state.bottomReplication[i] = 'RNA';

        // Top DNA Polymerase starts at index 4 and moves right following the fork
        state.polyTop.active = true;
        state.polyTop.x = lerp(4 * BASE_SPACING, 30 * BASE_SPACING - 50, t);
        state.polyTop.y = -SEPARATION_Y;

        // Fill top leading strand up to polymerase
        const currentTopIndex = Math.floor(state.polyTop.x / BASE_SPACING);
        for (let i = 4; i < currentTopIndex; i++) {
            if (i < NUM_BASES) state.topReplication[i] = 'DNA';
        }

        // Lagging strand: Bottom Polymerase 1 synthesizes Fragment 1 DNA (indices 10 down to 0)
        state.polyBottom.active = true;
        state.polyBottom.x = lerp(10 * BASE_SPACING, 0 * BASE_SPACING, t);
        state.polyBottom.y = SEPARATION_Y;

        const dna1Limit = Math.floor(lerp(11, -1, t));
        for (let i = 10; i > dna1Limit; i--) {
            state.bottomReplication[i] = 'DNA';
        }
        state.primaseBottom.active = false;
    }
    // Stage 4: Synthesis 2 & 3 (Leading strand continues & Lagging strand Fragment 2 & 3)
    else if (time >= 520 && time < 720) {
        const t = (time - 520) / 200;
        
        // Fork continues to open from 30 to 45 in the first half of Stage 4 (t < 0.5)
        const tOpen = Math.min((time - 520) / 100, 1.0);
        state.forkX = lerp(30 * BASE_SPACING, NUM_BASES * BASE_SPACING, tOpen);
        state.helicase.active = true;
        state.helicase.x = state.forkX;
        state.helicase.y = 0;

        // Leading strand primer is preserved
        for (let i = 0; i <= 3; i++) state.topReplication[i] = 'RNA';

        // Top DNA Polymerase continues moving from index 30 to 44
        state.polyTop.active = true;
        state.polyTop.x = lerp(30 * BASE_SPACING, NUM_BASES * BASE_SPACING - 50, tOpen);
        state.polyTop.y = -SEPARATION_Y;

        // Fill top leading strand up to polymerase
        const currentTopIndex = Math.floor(state.polyTop.x / BASE_SPACING);
        for (let i = 4; i < currentTopIndex; i++) {
            if (i < NUM_BASES) state.topReplication[i] = 'DNA';
        }

        // Lagging strand Fragment 1 is fully complete
        for (let i = 0; i <= 10; i++) state.bottomReplication[i] = 'DNA';
        for (let i = 11; i <= 14; i++) state.bottomReplication[i] = 'RNA';

        // Divide Stage 4 into 4 sequential substages for the lagging strand (50 units each)
        if (time < 570) {
            // Substage 4.1: Primase Bottom synthesizes Primer 2 (indices 29 down to 26)
            // This is unzipped since Helicase is already past index 30
            const tSub = (time - 520) / 50;

            state.primaseBottom.active = true;
            state.primaseBottom.x = lerp(29 * BASE_SPACING, 26 * BASE_SPACING, tSub);
            state.primaseBottom.y = SEPARATION_Y;
            state.primaseBottom.progress = tSub;

            const secondPrimerLimit = Math.floor(lerp(30, 25, tSub));
            for (let i = 29; i > secondPrimerLimit; i--) {
                state.bottomReplication[i] = 'RNA';
            }
        }
        else if (time >= 570 && time < 620) {
            // Substage 4.2: Bottom Polymerase 2 synthesizes Fragment 2 DNA (indices 25 down to 15)
            const tSub = (time - 570) / 50;

            // Primer 2 is fully complete
            for (let i = 26; i <= 29; i++) state.bottomReplication[i] = 'RNA';

            state.polyBottom.active = true;
            state.polyBottom.x = lerp(25 * BASE_SPACING, 15 * BASE_SPACING, tSub);
            state.polyBottom.y = SEPARATION_Y;

            const dna2Limit = Math.floor(lerp(26, 14, tSub));
            for (let i = 25; i > dna2Limit; i--) {
                state.bottomReplication[i] = 'DNA';
            }
        }
        else if (time >= 620 && time < 670) {
            // Substage 4.3: Primase Bottom synthesizes Primer 3 (indices 44 down to 41)
            // This is unzipped since Helicase reaches index 45 at time = 620
            const tSub = (time - 620) / 50;

            // Fragment 2 is fully complete
            for (let i = 15; i <= 25; i++) state.bottomReplication[i] = 'DNA';
            for (let i = 26; i <= 29; i++) state.bottomReplication[i] = 'RNA';

            state.primaseBottom.active = true;
            state.primaseBottom.x = lerp(44 * BASE_SPACING, 41 * BASE_SPACING, tSub);
            state.primaseBottom.y = SEPARATION_Y;
            state.primaseBottom.progress = tSub;

            const thirdPrimerLimit = Math.floor(lerp(45, 40, tSub));
            for (let i = 44; i > thirdPrimerLimit; i--) {
                state.bottomReplication[i] = 'RNA';
            }
        }
        else {
            // Substage 4.4: Bottom Polymerase 3 synthesizes Fragment 3 DNA (indices 40 down to 30)
            const tSub = (time - 670) / 50;

            // Fragment 2 is fully complete
            for (let i = 15; i <= 25; i++) state.bottomReplication[i] = 'DNA';
            for (let i = 26; i <= 29; i++) state.bottomReplication[i] = 'RNA';

            // Primer 3 is fully complete
            for (let i = 41; i <= 44; i++) state.bottomReplication[i] = 'RNA';

            state.polyBottom.active = true;
            state.polyBottom.x = lerp(40 * BASE_SPACING, 30 * BASE_SPACING, tSub);
            state.polyBottom.y = SEPARATION_Y;

            const dna3Limit = Math.floor(lerp(41, 29, tSub));
            for (let i = 40; i > dna3Limit; i--) {
                state.bottomReplication[i] = 'DNA';
            }
        }
    }
    // Stage 5: Primer Removal & Ligation
    else if (time >= 720 && time < 850) {
        state.forkX = NUM_BASES * BASE_SPACING;
        state.helicase.active = true;
        state.helicase.x = state.forkX;
        state.helicase.y = 0;

        // Fully synthesize all DNA segments except primer locations
        // During 720-770, RNA primers are converted to DNA
        const tReplace = Math.min((time - 720) / 50, 1.0);
        
        for (let i = 0; i < NUM_BASES; i++) {
            // Top strand: only index <= 3 is RNA primer (before replacement)
            if (i <= 3) {
                state.topReplication[i] = tReplace > 0.5 ? 'DNA' : 'RNA';
            } else {
                state.topReplication[i] = 'DNA';
            }

            // Bottom strand: 11-14, 26-29, and 41-44 are RNA primers (before replacement)
            if ((i >= 11 && i <= 14) || (i >= 26 && i <= 29) || (i >= 41 && i <= 44)) {
                state.bottomReplication[i] = tReplace > 0.5 ? 'DNA' : 'RNA';
            } else {
                state.bottomReplication[i] = 'DNA';
            }
        }

        // DNA Ligase binds at junctions: index 14/15 and index 29/30
        const tLigase = (time - 770) / 80; // 0 to 1
        if (tLigase >= 0 && tLigase <= 0.5) {
            state.ligase.active = true;
            state.ligase.x = 14.5 * BASE_SPACING;
            state.ligase.y = SEPARATION_Y - 2 * PARENTAL_SEPARATION;
            state.ligase.sparkle = true;
        } else if (tLigase > 0.5 && tLigase <= 1.0) {
            state.ligase.active = true;
            state.ligase.x = 29.5 * BASE_SPACING;
            state.ligase.y = SEPARATION_Y - 2 * PARENTAL_SEPARATION;
            state.ligase.sparkle = true;
            
            // Junction 14/15 complete
            state.bottomReplication[14] = 'DNA';
        } else if (tLigase > 1.0) {
            // All ligation complete
            state.bottomReplication[14] = 'DNA';
            state.bottomReplication[29] = 'DNA';
        }
    }
    // Completing & scrolling off
    else if (time >= 850 && time <= 1000) {
        const t = (time - 850) / 150;
        state.forkX = lerp(NUM_BASES * BASE_SPACING, (NUM_BASES + 10) * BASE_SPACING, t);
        state.helicase.active = true;
        state.helicase.x = state.forkX;
        state.helicase.y = 0;
        // All is completed DNA
        for (let i = 0; i < NUM_BASES; i++) {
            state.topReplication[i] = 'DNA';
            state.bottomReplication[i] = 'DNA';
        }
    }

    return state;
}

// Interpolation helper
function lerp(start, end, amt) {
    return (1 - amt) * start + amt * end;
}

// Get the coordinates of a base on the top/bottom template strand
function getStrandCoords(index, strandType, state) {
    const x = index * BASE_SPACING;
    const centerY = 0; // Relative to transform.y
    const forkX = state.forkX;

    // Calculate template Y at this x (flat/parallel, no winding)
    let y = centerY;
    const sign = strandType === 'top' ? -1 : 1;
    const targetSep = sign * SEPARATION_Y;
    const parentalSep = sign * PARENTAL_SEPARATION;

    if (x > forkX) {
        y = centerY + parentalSep;
    } else if (x < forkX - FORK_TRANSITION_WIDTH) {
        y = centerY + targetSep;
    } else {
        const t = (x - (forkX - FORK_TRANSITION_WIDTH)) / FORK_TRANSITION_WIDTH;
        const smoothT = t * t * (3 - 2 * t);
        y = lerp(centerY + targetSep, centerY + parentalSep, smoothT);
    }

    return { x, y };
}

// Helper to calculate exact template and complement locations and drawing directions
function getBaseDrawInfo(index, strandType, state) {
    const coord = getStrandCoords(index, strandType, state);
    const x = coord.x;
    const yTemplate = coord.y;
    
    const xVal = index * BASE_SPACING;
    const forkX = state.forkX;
    
    // Determine if it is replicated at this index
    const isReplicated = strandType === 'top' ? 
        (state.topReplication[index] !== null) : 
        (state.bottomReplication[index] !== null);

    let yComplement;
    if (xVal > forkX) {
        // Parental DNA: complement backbone is on the opposite strand
        yComplement = strandType === 'top' ? PARENTAL_SEPARATION : -PARENTAL_SEPARATION;
    } else {
        // Left of fork: complement backbone is offset from the template backbone
        if (strandType === 'top') {
            yComplement = yTemplate + 2 * PARENTAL_SEPARATION;
        } else {
            yComplement = yTemplate - 2 * PARENTAL_SEPARATION;
        }
    }

    const templateDir = strandType === 'top' ? 'down' : 'up';
    const complementDir = strandType === 'top' ? 'up' : 'down';

    return {
        x,
        yTemplate,
        yComplement,
        templateDir,
        complementDir,
        isReplicated: isReplicated && xVal <= forkX
    };
}

// Render loop
function animationLoop(timestamp) {
    const dt = timestamp - lastTime;
    lastTime = timestamp;

    // Auto-resize handler if DOM layout bounding box shifts
    const rect = canvasContainer.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.floor(rect.width * dpr) || canvas.height !== Math.floor(rect.height * dpr)) {
        resizeCanvas();
    }

    if (isPlaying) {
        simulationTime += (dt * 0.03) * animationSpeed;
        if (simulationTime > 1000) {
            simulationTime = 0;
        }
        
        // Auto-update stage active item in sidebar based on time
        updateActiveStageFromTime();
    }

    // Update particles
    updateParticles();

    // Draw frame
    draw();

    requestAnimationFrame(animationLoop);
}

function updateActiveStageFromTime() {
    let stage = 0;
    if (simulationTime < 100) stage = 0;
    else if (simulationTime >= 100 && simulationTime < 250) stage = 1;
    else if (simulationTime >= 250 && simulationTime < 380) stage = 2;
    else if (simulationTime >= 380 && simulationTime < 520) stage = 3;
    else if (simulationTime >= 520 && simulationTime < 720) stage = 4;
    else if (simulationTime >= 720 && simulationTime < 850) stage = 5;
    else stage = 0; // wrap to 0

    if (stage !== currentStage) {
        setStageUI(stage);
    }
}

// Particle updating
function updateParticles() {
    // Sparkles
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= p.decay;
        if (p.life <= 0) {
            particles.splice(i, 1);
        }
    }

    // Floating bases
    for (let i = floatingBases.length - 1; i >= 0; i--) {
        const fb = floatingBases[i];
        fb.progress += fb.speed;
        
        // Interpolate position towards target
        fb.x = lerp(fb.x, fb.targetX, fb.progress);
        fb.y = lerp(fb.y, fb.targetY, fb.progress);

        if (fb.progress >= 1.0) {
            // Spawn a small sparkle and delete
            spawnSparkle(fb.targetX, fb.targetY, BASE_COLORS[fb.base]);
            floatingBases.splice(i, 1);
        }
    }
}

// Particle colors
const BASE_COLORS = {
    'A': '#00d2ff',
    'T': '#ff5e36',
    'G': '#10b981',
    'C': '#eab308',
    'U': '#d946ef'
};

// Main draw routine
function draw() {
    try {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Save context for transform (zoom & pan)
        ctx.save();
        ctx.translate(transform.x, transform.y);
        ctx.scale(transform.scale, transform.scale);

        // Render Grid lines (for visual depth)
        drawGrid();

        // Get current simulation state
        const state = getReplicationState(simulationTime);

        // Spawn floating bases occasionally when polymerases/primases are active
        triggerFloatingBases(state);

        // Draw Hydrogen Bonds (draw first so they sit underneath nucleotide blocks)
        drawHydrogenBonds(state);

        // Draw DNA Backbones
        drawBackbones(state);

        // Draw Nucleotides
        drawNucleotides(state);

        // Draw Enzymes
        drawEnzymes(state);

        // Draw Labels & Annotations
        drawLabels(state);

        // Draw Particles
        drawParticles();

        ctx.restore();
    } catch (error) {
        console.error("Error in draw():", error);
    }
}

// Draw subtle grid
function drawGrid() {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.02)';
    ctx.lineWidth = 2;

    const gridSize = 100;
    const startX = -2000;
    const endX = NUM_BASES * BASE_SPACING + 1000;
    const startY = -600;
    const endY = 600;

    ctx.beginPath();
    for (let x = startX; x <= endX; x += gridSize) {
        ctx.moveTo(x, startY);
        ctx.lineTo(x, endY);
    }
    for (let y = startY; y <= endY; y += gridSize) {
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
    }
    ctx.stroke();
}

// Periodic floating particle triggers
let baseSpawnTimer = 0;
function triggerFloatingBases(state) {
    if (!isPlaying) return;
    
    baseSpawnTimer++;
    if (baseSpawnTimer % 25 === 0) {
        // Spawn for Top DNA Polymerase
        if (state.polyTop.active) {
            const idx = Math.floor(state.polyTop.x / BASE_SPACING);
            if (idx < NUM_BASES) {
                const targetBase = templateBases[idx];
                const compBase = getComplement(targetBase);
                spawnFloatingBase(state.polyTop.x, state.polyTop.y, compBase, false);
            }
        }
        // Spawn for Bottom DNA Polymerase
        if (state.polyBottom.active) {
            const idx = Math.floor(state.polyBottom.x / BASE_SPACING);
            if (idx >= 0 && idx < NUM_BASES) {
                const targetBase = templateBases[idx];
                const compBase = getComplement(targetBase);
                spawnFloatingBase(state.polyBottom.x, state.polyBottom.y, compBase, false);
            }
        }
        // Spawn for Primases
        if (state.primaseTop.active && Math.random() > 0.5) {
            const idx = Math.floor(state.primaseTop.x / BASE_SPACING);
            if (idx < NUM_BASES) {
                const targetBase = templateBases[idx];
                const compBase = getComplement(targetBase, true);
                spawnFloatingBase(state.primaseTop.x, state.primaseTop.y, compBase, true);
            }
        }
    }
}

// Draw DNA Backbones (Sugar-Phosphate Backbones)
function drawBackbones(state) {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    const templateColor = isDark ? '#4b5563' : '#9ca3af';
    const newDnaColor = '#ef4444'; // Red-orange for new DNA backbone
    const newRnaColor = '#d946ef'; // Magenta for RNA Primer backbone

    // 1. Draw Top Template Strand Backbone
    ctx.beginPath();
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.strokeStyle = templateColor;
    
    let p = getStrandCoords(0, 'top', state);
    ctx.moveTo(p.x, p.y);
    for (let i = 1; i < NUM_BASES; i++) {
        p = getStrandCoords(i, 'top', state);
        ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();

    // 2. Draw Bottom Template Strand Backbone
    ctx.beginPath();
    ctx.strokeStyle = templateColor;
    p = getStrandCoords(0, 'bottom', state);
    ctx.moveTo(p.x, p.y);
    for (let i = 1; i < NUM_BASES; i++) {
        p = getStrandCoords(i, 'bottom', state);
        ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();

    // 3. Draw Top Synthesized Strand Backbone
    ctx.beginPath();
    ctx.lineWidth = 6;
    let drawingNew = false;
    let lastColor = '';

    for (let i = 0; i < NUM_BASES; i++) {
        const type = state.topReplication[i];
        if (type) {
            const color = type === 'RNA' ? newRnaColor : newDnaColor;
            const drawInfo = getBaseDrawInfo(i, 'top', state);
            const drawY = drawInfo.yComplement;

            if (!drawingNew || color !== lastColor) {
                if (drawingNew) {
                    ctx.stroke();
                }
                ctx.beginPath();
                ctx.strokeStyle = color;
                ctx.moveTo(drawInfo.x, drawY);
                drawingNew = true;
                lastColor = color;
            } else {
                ctx.lineTo(drawInfo.x, drawY);
            }
        } else {
            if (drawingNew) {
                ctx.stroke();
                drawingNew = false;
            }
        }
    }
    if (drawingNew) ctx.stroke();

    // 4. Draw Bottom Synthesized Strand Backbone
    drawingNew = false;
    lastColor = '';
    
    for (let i = 0; i < NUM_BASES; i++) {
        const type = state.bottomReplication[i];
        if (type) {
            const color = type === 'RNA' ? newRnaColor : newDnaColor;
            const drawInfo = getBaseDrawInfo(i, 'bottom', state);
            const drawY = drawInfo.yComplement;

            // Before DNA Ligase joins the fragments, keep them separated (create nicks at index 15 and 30)
            const forceBreak = (i === 15 && simulationTime < 810) || (i === 30 && simulationTime < 850);

            if (!drawingNew || color !== lastColor || forceBreak) {
                if (drawingNew) {
                    ctx.stroke();
                }
                ctx.beginPath();
                ctx.strokeStyle = color;
                ctx.moveTo(drawInfo.x, drawY);
                drawingNew = true;
                lastColor = color;
            } else {
                ctx.lineTo(drawInfo.x, drawY);
            }
        } else {
            if (drawingNew) {
                ctx.stroke();
                drawingNew = false;
            }
        }
    }
    if (drawingNew) ctx.stroke();
}

// Helper to draw a single hydrogen bond (double or triple dashed lines)
function drawSingleHydrogenBond(x, y1, y2, isTriple, pairColor) {
    ctx.strokeStyle = pairColor;
    ctx.setLineDash([4, 4]);

    if (isTriple) {
        ctx.beginPath();
        ctx.moveTo(x - 5, y1); ctx.lineTo(x - 5, y2);
        ctx.moveTo(x, y1); ctx.lineTo(x, y2);
        ctx.moveTo(x + 5, y1); ctx.lineTo(x + 5, y2);
        ctx.stroke();
    } else {
        ctx.beginPath();
        ctx.moveTo(x - 3, y1); ctx.lineTo(x - 3, y2);
        ctx.moveTo(x + 3, y1); ctx.lineTo(x + 3, y2);
        ctx.stroke();
    }
    ctx.setLineDash([]); // Reset dash
}

// Draw hydrogen bonds between complementary base pairs
function drawHydrogenBonds(state) {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    ctx.lineWidth = 2.5;

    for (let i = 0; i < NUM_BASES; i++) {
        const base = templateBases[i];
        const isTriple = (base === 'G' || base === 'C');
        const xVal = i * BASE_SPACING;

        if (xVal > state.forkX) {
            // Parental DNA: draw bond between top and bottom templates
            const topInfo = getBaseDrawInfo(i, 'top', state);
            const y1 = topInfo.yTemplate + (topInfo.templateDir === 'down' ? BASE_HEIGHT : -BASE_HEIGHT);
            const y2 = topInfo.yComplement + (topInfo.complementDir === 'down' ? BASE_HEIGHT : -BASE_HEIGHT);
            const pairColor = isDark ? 'rgba(255, 255, 255, 0.25)' : 'rgba(0, 0, 0, 0.15)';
            drawSingleHydrogenBond(xVal, y1, y2, isTriple, pairColor);
        } else {
            // Left of fork: draw bonds for top and/or bottom replicated strands
            const pairColor = isDark ? 'rgba(255, 255, 255, 0.4)' : 'rgba(0, 0, 0, 0.25)';

            if (state.topReplication[i] !== null) {
                const topInfo = getBaseDrawInfo(i, 'top', state);
                const y1 = topInfo.yTemplate + (topInfo.templateDir === 'down' ? BASE_HEIGHT : -BASE_HEIGHT);
                const y2 = topInfo.yComplement + (topInfo.complementDir === 'down' ? BASE_HEIGHT : -BASE_HEIGHT);
                drawSingleHydrogenBond(topInfo.x, y1, y2, isTriple, pairColor);
            }

            if (state.bottomReplication[i] !== null) {
                const bottomInfo = getBaseDrawInfo(i, 'bottom', state);
                const y1 = bottomInfo.yTemplate + (bottomInfo.templateDir === 'down' ? BASE_HEIGHT : -BASE_HEIGHT);
                const y2 = bottomInfo.yComplement + (bottomInfo.complementDir === 'down' ? BASE_HEIGHT : -BASE_HEIGHT);
                drawSingleHydrogenBond(bottomInfo.x, y1, y2, isTriple, pairColor);
            }
        }
    }
}

// Draw bases capsules with letters
function drawNucleotides(state) {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 15px ' + varFont('font-primary', 'sans-serif');

    for (let i = 0; i < NUM_BASES; i++) {
        const base = templateBases[i];
        const compBase = getComplement(base);

        // 1. Top template nucleotide
        const topInfo = getBaseDrawInfo(i, 'top', state);
        drawBaseCapsule(topInfo.x, topInfo.yTemplate, base, topInfo.templateDir, false);

        // 2. Bottom template nucleotide
        const bottomInfo = getBaseDrawInfo(i, 'bottom', state);
        drawBaseCapsule(bottomInfo.x, bottomInfo.yTemplate, compBase, bottomInfo.templateDir, false);

        // 3. Top newly synthesized nucleotide
        if (state.topReplication[i]) {
            const isRna = state.topReplication[i] === 'RNA';
            const baseType = getComplement(base, isRna);
            drawBaseCapsule(topInfo.x, topInfo.yComplement, baseType, topInfo.complementDir, isRna, true);
        }

        // 4. Bottom newly synthesized nucleotide
        if (state.bottomReplication[i]) {
            const isRna = state.bottomReplication[i] === 'RNA';
            const baseType = getComplement(compBase, isRna);
            drawBaseCapsule(bottomInfo.x, bottomInfo.yComplement, baseType, bottomInfo.complementDir, isRna, true);
        }
    }
}

function varFont(cssVar, fallback) {
    return getThemeColor('--' + cssVar) || fallback;
}

// Render a single base capsule
function drawBaseCapsule(x, y, base, direction, isRna, isComplement = false) {
    const color = BASE_COLORS[base] || '#999';
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    
    ctx.save();
    
    // Position transformations based on direction
    const height = BASE_HEIGHT;
    const width = BASE_WIDTH;
    const dirSign = direction === 'down' ? 1 : -1;
    
    // Draw capsule shape
    ctx.fillStyle = color;
    
    // Give complement/RNA a different styling or glow
    if (isComplement) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 6;
    }

    // Draw rounded capsule
    const radius = 6;
    ctx.beginPath();
    
    if (direction === 'down') {
        // Starts at template backbone y, goes downwards
        ctx.roundRect(x - width/2, y + 2, width, height, [0, 0, radius, radius]);
    } else {
        // Starts at template backbone y, goes upwards
        ctx.roundRect(x - width/2, y - height - 2, width, height, [radius, radius, 0, 0]);
    }
    ctx.fill();

    // Add white inner border for RNA Primer to distinguish it
    if (isRna) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    // Draw letter text
    ctx.fillStyle = '#ffffff';
    ctx.shadowBlur = 0; // Clear text shadow for crisp letters
    
    const textY = direction === 'down' ? y + height/2 + 2 : y - height/2 - 2;
    ctx.fillText(base, x, textY);
    
    ctx.restore();
}

// Draw enzyme molecular machines
function drawEnzymes(state) {
    const isDark = document.body.getAttribute('data-theme') === 'dark';

    // 1. Helicase (Triangular/Hexagonal unzipping engine)
    if (state.helicase.active) {
        ctx.save();
        ctx.translate(state.helicase.x, state.helicase.y);
        
        // Add subtle rotation animation based on play timeline
        const angle = isPlaying ? (performance.now() * 0.005) : 0;
        ctx.rotate(angle);

        // Outer glow using resolved color variable
        ctx.shadowColor = getThemeColor('--color-helicase');
        ctx.shadowBlur = 15;
        
        // Draw double hexagon structure for Helicase
        ctx.fillStyle = 'rgba(245, 158, 11, 0.85)';
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 3;
        
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const a = (i * Math.PI) / 3;
            const x = Math.cos(a) * 45;
            const y = Math.sin(a) * 45;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Inner core
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(0, 0, 15, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    // 2. Primases (Pink ovals creating primers)
    if (state.primaseTop.active) {
        drawPrimase(state.primaseTop.x, state.primaseTop.y);
    }
    if (state.primaseBottom.active) {
        drawPrimase(state.primaseBottom.x, state.primaseBottom.y);
    }

    // 3. DNA Polymerases (Teal oval synthesis engines)
    if (state.polyTop.active) {
        drawPolymerase(state.polyTop.x, state.polyTop.y, '5\'→3\'');
    }
    if (state.polyBottom.active) {
        drawPolymerase(state.polyBottom.x, state.polyBottom.y, '5\'→3\'');
    }

    // 4. DNA Ligase (Purple sealing engine)
    if (state.ligase.active) {
        ctx.save();
        ctx.shadowColor = getThemeColor('--color-ligase');
        ctx.shadowBlur = 15;
        ctx.fillStyle = 'rgba(139, 92, 246, 0.85)';
        ctx.strokeStyle = '#8b5cf6';
        ctx.lineWidth = 3;

        ctx.beginPath();
        ctx.arc(state.ligase.x, state.ligase.y, 40, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Draw inner details
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px ' + varFont('font-primary', 'sans-serif');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('LIGASE', state.ligase.x, state.ligase.y);

        // Sparkle effect
        if (state.ligase.sparkle && isPlaying && Math.random() > 0.7) {
            spawnSparkle(state.ligase.x, state.ligase.y, '#c084fc');
        }
        ctx.restore();
    }
}

function drawPrimase(x, y) {
    ctx.save();
    ctx.shadowColor = getThemeColor('--color-primase');
    ctx.shadowBlur = 12;
    ctx.fillStyle = 'rgba(236, 72, 153, 0.85)';
    ctx.strokeStyle = '#ec4899';
    ctx.lineWidth = 3;

    // Draw capsule-like pill shape
    ctx.beginPath();
    ctx.roundRect(x - 45, y - 25, 90, 50, 25);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px ' + varFont('font-primary', 'sans-serif');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('PRIMASE', x, y);

    ctx.restore();
}

function drawPolymerase(x, y, dirText) {
    ctx.save();
    ctx.shadowColor = getThemeColor('--color-polymerase');
    ctx.shadowBlur = 18;
    ctx.fillStyle = 'rgba(6, 182, 212, 0.82)';
    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 3;

    // Draw large egg/oval shape representing DNA Polymerase wrapping DNA
    ctx.beginPath();
    ctx.ellipse(x, y, 65, 45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Inner letters
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px ' + varFont('font-primary', 'sans-serif');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('DNA POLYMERASE', x, y - 6);
    
    ctx.font = '900 11px ' + varFont('font-display', 'sans-serif');
    ctx.fillStyle = '#22d3ee';
    ctx.fillText(dirText, x, y + 14);

    ctx.restore();
}

// Draw Labels, pointers, 5' and 3' annotations
function drawLabels(state) {
    ctx.save();
    ctx.fillStyle = getThemeColor('--text-main');
    ctx.font = 'bold 22px ' + varFont('font-display', 'sans-serif');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Helper to draw clean circular terminal label badge (5' or 3')
    function drawTerminalBadge(x, y, label) {
        ctx.save();
        ctx.fillStyle = 'rgba(15, 19, 26, 0.85)';
        ctx.strokeStyle = getThemeColor('--border-color');
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = getThemeColor('--text-main');
        ctx.fillText(label, x, y + 1);
        ctx.restore();
    }

    // Top Template ends: 3' Left, 5' Right
    const leftTop = getStrandCoords(0, 'top', state);
    drawTerminalBadge(leftTop.x - 50, leftTop.y, "3'");

    const rightTop = getStrandCoords(NUM_BASES - 1, 'top', state);
    drawTerminalBadge(rightTop.x + 50, rightTop.y, "5'");

    // Bottom Template ends: 5' Left, 3' Right
    const leftBottom = getStrandCoords(0, 'bottom', state);
    drawTerminalBadge(leftBottom.x - 50, leftBottom.y, "5'");

    const rightBottom = getStrandCoords(NUM_BASES - 1, 'bottom', state);
    drawTerminalBadge(rightBottom.x + 50, rightBottom.y, "3'");

    // Newly synthesized strands ends (drawn conditional on their existence)
    if (state.topReplication[0]) {
        // Leading strand start (left-most): 5'
        const drawInfo = getBaseDrawInfo(0, 'top', state);
        drawTerminalBadge(drawInfo.x - 45, drawInfo.yComplement, "5'");
    }

    // Lagging strand fragment 1 start: 5' (at index 14)
    if (state.bottomReplication[14] && simulationTime < 810) {
        const drawInfo = getBaseDrawInfo(14, 'bottom', state);
        const isLigaseNear = (state.ligase.active && Math.abs(state.ligase.x - (drawInfo.x + 45)) < 60);
        if (!isLigaseNear) {
            drawTerminalBadge(drawInfo.x + 45, drawInfo.yComplement, "5'");
        }
    }

    // Lagging strand fragment 2 start: 5' (at index 29)
    if (state.bottomReplication[29] && simulationTime < 850) {
        const drawInfo = getBaseDrawInfo(29, 'bottom', state);
        const isLigaseNear = (state.ligase.active && Math.abs(state.ligase.x - (drawInfo.x + 45)) < 60);
        if (!isLigaseNear) {
            drawTerminalBadge(drawInfo.x + 45, drawInfo.yComplement, "5'");
        }
    }

    // Lagging strand fragment 3 start: 5' (at index 44)
    if (state.bottomReplication[44]) {
        const drawInfo = getBaseDrawInfo(44, 'bottom', state);
        drawTerminalBadge(drawInfo.x + 45, drawInfo.yComplement, "5'");
    }

    // Dynamic pointers labeling major enzymes/strands
    ctx.font = 'bold 15px ' + varFont('font-primary', 'sans-serif');
    ctx.textAlign = 'left';
    ctx.fillStyle = getThemeColor('--text-main');

    // Template strand label
    if (state.forkX > 10 * BASE_SPACING) {
        const tCoord = getStrandCoords(12, 'top', state);
        drawPointerLabel('주형 가닥 (Template Strand)', tCoord.x - 50, tCoord.y - 80, tCoord.x, tCoord.y - 10);
    }

    // Helicase label
    if (state.helicase.active) {
        drawPointerLabel('헬리케이스 (Helicase)', state.helicase.x - 120, -120, state.helicase.x - 10, -30);
    }

    // DNA Polymerase labels
    if (state.polyTop.active) {
        drawPointerLabel('DNA 중합효소 (Polymerase)', state.polyTop.x - 50, state.polyTop.y - 100, state.polyTop.x, state.polyTop.y - 30);
    }
    
    if (state.polyBottom.active) {
        drawPointerLabel('지연 가닥 합성 (Lagging strand synthesis)', state.polyBottom.x - 180, state.polyBottom.y + 110, state.polyBottom.x, state.polyBottom.y + 35);
    }

    // Leading Strand label
    if (state.topReplication[12] === 'DNA') {
        const lCoord = getStrandCoords(13, 'top', state);
        drawPointerLabel('선도 가닥 (Leading Strand)', lCoord.x + 80, lCoord.y + 70, lCoord.x, lCoord.y + 20);
    }

    ctx.restore();
}

function drawPointerLabel(text, tx, ty, targetX, targetY) {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    
    // Draw indicator line using resolved color variable
    ctx.strokeStyle = getThemeColor('--primary-color');
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(tx + 50, ty + 10);
    ctx.lineTo(targetX, targetY);
    ctx.stroke();

    // Small dot at target
    ctx.fillStyle = getThemeColor('--primary-color');
    ctx.beginPath();
    ctx.arc(targetX, targetY, 4, 0, Math.PI * 2);
    ctx.fill();

    // Text box background
    ctx.save();
    ctx.fillStyle = isDark ? 'rgba(30, 39, 54, 0.9)' : 'rgba(255, 255, 255, 0.95)';
    ctx.strokeStyle = getThemeColor('--border-color');
    ctx.lineWidth = 1;
    ctx.font = 'bold 13px ' + varFont('font-primary', 'sans-serif');
    
    const textWidth = ctx.measureText(text).width;
    ctx.beginPath();
    ctx.roundRect(tx - 10, ty - 12, textWidth + 20, 26, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = getThemeColor('--text-main');
    ctx.fillText(text, tx, ty + 5);
    ctx.restore();
}

// Draw particle systems
function drawParticles() {
    // sparkles
    for (const p of particles) {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1.0;

    // floating bases
    for (const fb of floatingBases) {
        const color = BASE_COLORS[fb.base];
        ctx.save();
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        
        ctx.beginPath();
        ctx.roundRect(fb.x - 10, fb.y - 15, 20, 30, 4);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.shadowBlur = 0;
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(fb.base, fb.x, fb.y);

        ctx.restore();
    }
}

// Setup Interactive control listeners
function setupControls() {
    const playBtn = document.getElementById('btn-play');
    const prevBtn = document.getElementById('btn-prev');
    const stepBtn = document.getElementById('btn-step');
    const resetBtn = document.getElementById('btn-reset');
    const speedSlider = document.getElementById('slider-speed');
    const speedValue = document.getElementById('speed-value');

    const zoomInBtn = document.getElementById('btn-zoom-in');
    const zoomOutBtn = document.getElementById('btn-zoom-out');
    const zoomResetBtn = document.getElementById('btn-zoom-reset');

    const themeToggle = document.getElementById('theme-toggle');
    const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
    const sidebarOpenBtn = document.getElementById('sidebar-open-btn');
    const sidebar = document.getElementById('sidebar');

    // Sidebar Slide Controls
    sidebarCloseBtn.addEventListener('click', () => {
        sidebar.classList.add('collapsed');
        sidebarOpenBtn.style.display = 'flex'; // 데스크톱에서도 오픈 버튼 강제 노출
        // trigger canvas resizing
        setTimeout(resizeCanvas, 400);
    });

    sidebarOpenBtn.addEventListener('click', () => {
        sidebar.classList.remove('collapsed');
        sidebar.classList.add('active'); // mobile view trigger
        sidebarOpenBtn.style.display = ''; // 기본 CSS 값으로 복구 (모바일 flex, 데스크톱 none)
        setTimeout(resizeCanvas, 400);
    });

    // Tap outside sidebar on mobile to close it
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768) {
            if (!sidebar.contains(e.target) && !sidebarOpenBtn.contains(e.target) && sidebar.classList.contains('active')) {
                sidebar.classList.remove('active');
                setTimeout(resizeCanvas, 400);
            }
        }
    });

    // Theme Switch
    themeToggle.addEventListener('click', () => {
        const currentTheme = document.body.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.body.setAttribute('data-theme', newTheme);
    });

    // Play/Pause controls
    playBtn.addEventListener('click', () => {
        isPlaying = !isPlaying;
        playBtn.innerHTML = isPlaying ? '<i class="fa-solid fa-pause"></i> 일시정지' : '<i class="fa-solid fa-play"></i> 재생';
        document.getElementById('status-badge').innerText = isPlaying ? '시뮬레이션 재생 중' : '일시정지됨';
    });

    // Reset controls
    resetBtn.addEventListener('click', () => {
        simulationTime = 50;
        isPlaying = false;
        playBtn.innerHTML = '<i class="fa-solid fa-play"></i> 재생';
        document.getElementById('status-badge').innerText = '준비 완료';
        particles.length = 0;
        floatingBases.length = 0;
        setStageUI(0);
        resetView();
    });

    // Step Frame controls
    stepBtn.addEventListener('click', () => {
        isPlaying = false;
        playBtn.innerHTML = '<i class="fa-solid fa-play"></i> 재생';
        simulationTime += 15;
        if (simulationTime > 1000) simulationTime = 0;
        updateActiveStageFromTime();
    });

    // Step Backward controls
    prevBtn.addEventListener('click', () => {
        isPlaying = false;
        playBtn.innerHTML = '<i class="fa-solid fa-play"></i> 재생';
        simulationTime -= 15;
        if (simulationTime < 0) simulationTime = 1000;
        updateActiveStageFromTime();
    });

    // Speed Slider
    speedSlider.addEventListener('input', (e) => {
        animationSpeed = parseFloat(e.target.value);
        speedValue.innerText = `${animationSpeed.toFixed(1)}x`;
    });

    // Zoom buttons centered on canvas
    zoomInBtn.addEventListener('click', () => {
        const rect = canvas.getBoundingClientRect();
        zoomAt(rect.width / 2, rect.height / 2, 1.25);
    });

    zoomOutBtn.addEventListener('click', () => {
        const rect = canvas.getBoundingClientRect();
        zoomAt(rect.width / 2, rect.height / 2, 0.8);
    });

    zoomResetBtn.addEventListener('click', () => {
        resetView();
    });

    // Interactive Stage Items
    const stageItems = document.querySelectorAll('.stage-item');
    stageItems.forEach(item => {
        item.addEventListener('click', () => {
            const stageNum = parseInt(item.getAttribute('data-stage'));
            isPlaying = false;
            playBtn.innerHTML = '<i class="fa-solid fa-play"></i> 재생';
            setStage(stageNum);
        });
    });
}

// Set specific stage state and timeline
function setStage(stageNum) {
    currentStage = stageNum;
    setStageUI(stageNum);

    // Map stages to specific target timeline frames
    const stageTimes = [50, 170, 310, 450, 620, 780];
    simulationTime = stageTimes[stageNum];

    particles.length = 0;
    floatingBases.length = 0;

    // Snap view to focus on the active area of that stage
    focusViewOnStage(stageNum);
}

function setStageUI(stageNum) {
    currentStage = stageNum;
    const stageItems = document.querySelectorAll('.stage-item');
    stageItems.forEach(item => {
        if (parseInt(item.getAttribute('data-stage')) === stageNum) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    // Guide Text update
    const guideTitles = [
        "복제 준비 (이중나선 구조)",
        "1단계: 이중나선 풀림",
        "2단계: RNA 프라이머 결합",
        "3단계: 선도가닥 연속 합성",
        "4단계: 지연가닥 불연속 합성",
        "5단계: 프라이머 제거 및 가닥 연결"
    ];

    const guideDescriptions = [
        "DNA 복제 준비 단계입니다. 실제 DNA는 상보적인 두 가닥이 꼬인 이중나선 구조를 띠고 있으나, 이 시뮬레이션에서는 학습의 직관성을 높이기 위해 평행한 사다리 구조로 표현했습니다.",
        "헬리케이스(Helicase) 효소가 결합하여 수소 결합을 끊으면서 이중나선을 풀어줍니다. 이에 따라 Y자 모양의 복제 분기점이 형성됩니다.",
        "프라이메이스(Primase)가 결합하여 새로운 가닥의 합성이 시작될 수 있도록 짧은 단일 가닥 RNA 조각인 'RNA 프라이머'를 만들어 붙입니다.",
        "DNA 중합효소(DNA Polymerase)가 선도가닥에서 5' 말단에서 3' 말단 방향(복제 분기점이 풀려나가는 방향)으로 끊김 없이 연속적으로 DNA를 합성합니다.",
        "지연가닥에서는 복제 분기점 반대 방향으로 합성되므로, 복제가 진행됨에 따라 짧은 단편인 '오카자키 절편(Okazaki Fragment)'들이 불연속적으로 만들어집니다.",
        "임시로 붙어 있던 RNA 프라이머가 DNA로 교체되고, DNA 연결효소(Ligase)가 오카자키 절편들의 끝을 화학적으로 서로 연결해 단일 가닥을 완성합니다."
    ];

    document.getElementById('guide-title').innerText = guideTitles[stageNum];
    document.getElementById('guide-desc').innerText = guideDescriptions[stageNum];
    document.getElementById('status-badge').innerText = guideTitles[stageNum];
}

// Reposition the camera centered on the active enzyme/event
function focusViewOnStage(stageNum) {
    const rect = canvasContainer.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    // Determine target coordinate in DNA space
    let targetDnaX = 0;
    if (stageNum === 0) targetDnaX = 10 * BASE_SPACING;
    else if (stageNum === 1) targetDnaX = 10 * BASE_SPACING;
    else if (stageNum === 2) targetDnaX = 12 * BASE_SPACING;
    else if (stageNum === 3) targetDnaX = 22 * BASE_SPACING; // Center on the middle of replication
    else if (stageNum === 4) targetDnaX = 22 * BASE_SPACING; // Focus on lagging strand synthesis area
    else if (stageNum === 5) targetDnaX = 22 * BASE_SPACING; // Focus on the ligation area

    // Apply smooth animated camera focus
    transform.scale = rect.width < 768 ? 0.6 : 0.8;
    transform.x = centerX - targetDnaX * transform.scale;
    transform.y = centerY;
    updateZoomIndicator();
}

// Mouse/Touch drag & zoom implementation
function setupInteractions() {
    // 1. Mouse Drag to Pan
    canvas.addEventListener('mousedown', (e) => {
        isDragging = true;
        dragStart.x = e.clientX;
        dragStart.y = e.clientY;
        transformStart.x = transform.x;
        transformStart.y = transform.y;
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - dragStart.x;
        const dy = e.clientY - dragStart.y;
        transform.x = transformStart.x + dx;
        transform.y = transformStart.y + dy;
    });

    window.addEventListener('mouseup', () => {
        isDragging = false;
    });

    // 2. Mouse Wheel to Zoom at point
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
        zoomAt(e.clientX, e.clientY, zoomFactor);
    }, { passive: false });

    // 3. Touch Drag (Pan) & Pinch (Zoom)
    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            isDragging = true;
            dragStart.x = e.touches[0].clientX;
            dragStart.y = e.touches[0].clientY;
            transformStart.x = transform.x;
            transformStart.y = transform.y;
        } else if (e.touches.length === 2) {
            isDragging = false;
            isPinching = true;
            touchStartDist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            touchStartScale = transform.scale;
            touchStartMid.x = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            touchStartMid.y = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        }
    });

    canvas.addEventListener('touchmove', (e) => {
        if (isDragging && e.touches.length === 1) {
            const dx = e.touches[0].clientX - dragStart.x;
            const dy = e.touches[0].clientY - dragStart.y;
            transform.x = transformStart.x + dx;
            transform.y = transformStart.y + dy;
        } else if (isPinching && e.touches.length === 2) {
            e.preventDefault();
            const currentDist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            const currentMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const currentMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

            const zoomFactor = currentDist / touchStartDist;
            const targetScale = touchStartScale * zoomFactor;

            // Zoom around the pinch midpoint
            const rect = canvas.getBoundingClientRect();
            const localMidX = touchStartMid.x - rect.left;
            const localMidY = touchStartMid.y - rect.top;
            
            // Convert to world coordinate space
            const worldX = (localMidX - transform.x) / transform.scale;
            const worldY = (localMidY - transform.y) / transform.scale;

            transform.scale = Math.min(Math.max(targetScale, 0.25), 3.0);
            
            // Apply scale + offset based on midpoints
            const currentLocalMidX = currentMidX - rect.left;
            const currentLocalMidY = currentMidY - rect.top;
            
            transform.x = currentLocalMidX - worldX * transform.scale;
            transform.y = currentLocalMidY - worldY * transform.scale;
            
            updateZoomIndicator();
        }
    }, { passive: false });

    canvas.addEventListener('touchend', () => {
        isDragging = false;
        isPinching = false;
    });
    canvas.addEventListener('touchcancel', () => {
        isDragging = false;
        isPinching = false;
    });
}

// Centered zoom algorithm
function zoomAt(clientX, clientY, factor) {
    const rect = canvas.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;

    const worldX = (mouseX - transform.x) / transform.scale;
    const worldY = (mouseY - transform.y) / transform.scale;

    const newScale = Math.min(Math.max(transform.scale * factor, 0.25), 3.0);

    transform.x = mouseX - worldX * newScale;
    transform.y = mouseY - worldY * newScale;
    transform.scale = newScale;

    updateZoomIndicator();
}
