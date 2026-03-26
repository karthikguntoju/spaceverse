const fs = require('fs');
const path = require('path');

const viewsDir = path.join(__dirname, 'views');
const filesToUpdate = [
    'space-traffic-simulator.html',
    'space-launches.html',
    'mission-tracker.html',
    'astronomical-events.html',
    'artemis-2-mission.html',
    'artemis-2-info.html',
    'solar-system.html'
];

const newNavCSS = `        .navbar {
            position: fixed;
            top: 1.5rem;
            left: 50%;
            transform: translateX(-50%);
            width: 98%;
            max-width: 1800px;
            
            /* Sci-Fi Geometry (Chamfered Tech Box) */
            clip-path: polygon(25px 0, calc(100% - 25px) 0, 100% 25px, 100% calc(100% - 25px), calc(100% - 25px) 100%, 25px 100%, 0 calc(100% - 25px), 0 25px);
            
            /* Frosty Glassmorphism */
            background: rgba(5, 10, 20, 0.7);
            backdrop-filter: blur(24px) saturate(200%);
            -webkit-backdrop-filter: blur(24px) saturate(200%);
            
            padding: 0.8rem 2.5rem;
            z-index: 1000;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            
            /* Inner telemetry glow and structural pseudo-bordering through shadows */
            box-shadow: inset 0 0 20px rgba(0, 243, 255, 0.15), inset 0 0 60px rgba(0, 0, 0, 0.9);
            transition: all 0.4s ease;
            border: none;
        }

        /* Nav Brackets matching the clip-path angles perfectly */
        .nav-bracket {
            position: absolute;
            top: 0;
            bottom: 0;
            width: 35px;
            background: transparent;
            pointer-events: none;
            z-index: 10;
        }
        .nav-bracket.left {
            left: 0;
            border-left: 2px solid var(--neon-blue);
            clip-path: polygon(0 25px, 25px 0, 100% 0, 100% 100%, 25px 100%, 0 calc(100% - 25px));
            box-shadow: inset 10px 0 20px -5px rgba(0, 243, 255, 0.4);
        }
        .nav-bracket.right {
            right: 0;
            border-right: 2px solid var(--neon-blue);
            clip-path: polygon(0 0, calc(100% - 25px) 0, 100% 25px, 100% calc(100% - 25px), calc(100% - 25px) 100%, 0 100%);
            box-shadow: inset -10px 0 20px -5px rgba(0, 243, 255, 0.4);
        }

        .navbar:hover {
            box-shadow: inset 0 0 30px rgba(0, 243, 255, 0.25), inset 0 0 80px rgba(0, 0, 0, 0.95);
        }

        .logo {
            font-size: 1.8rem;
            font-weight: 800;
            color: var(--neon-blue);
            text-shadow: 0 0 15px rgba(0, 243, 255, 0.6);
            display: flex;
            align-items: center;
            gap: 1rem;
            letter-spacing: 1px;
            text-transform: uppercase;
        }

        .logo-icon {
            width: 45px;
            height: 45px;
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .logo-planet {
            width: 30px;
            height: 30px;
            background: radial-gradient(circle at 30% 30%, var(--neon-blue), #005b99);
            border-radius: 50%;
            box-shadow: 0 0 20px rgba(0, 243, 255, 0.8), inset -5px -5px 10px rgba(0, 0, 0, 0.4);
            animation: planetRotate 10s linear infinite;
        }

        .logo-ring {
            position: absolute;
            width: 48px;
            height: 14px;
            border: 2px solid var(--neon-purple);
            border-radius: 50%;
            transform: rotateX(70deg);
            box-shadow: 0 0 15px rgba(188, 19, 254, 0.8);
            animation: ringPulse 3s infinite alternate;
        }

        @keyframes planetRotate {
            100% {
                transform: rotate(360deg);
            }
        }

        @keyframes ringPulse {
            100% {
                box-shadow: 0 0 25px rgba(188, 19, 254, 1);
                border-width: 3px;
            }
        }

        .nav-content {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-grow: 1;
            margin-left: 2rem;
        }

        .nav-links {
            display: flex;
            gap: 2.5rem;
            list-style: none;
            margin: 0 auto;
        }

        .nav-links li, .nav-links a {
            display: inline-block;
        }

        .nav-links a {
            color: var(--text-main);
            text-decoration: none;
            font-weight: 500;
            font-size: 1rem;
            letter-spacing: 0.5px;
            position: relative;
            padding: 0.5rem 0;
            transition: color 0.3s;
        }

        .nav-links a::after {
            content: '';
            position: absolute;
            bottom: -4px;
            left: 0;
            width: 100%;
            height: 2px;
            background: var(--neon-blue);
            box-shadow: 0 0 10px var(--neon-blue);
            transform: scaleX(0);
            transform-origin: right;
            transition: transform 0.4s cubic-bezier(0.86, 0, 0.07, 1);
        }

        .nav-links a:hover {
            color: #fff;
            text-shadow: 0 0 10px rgba(0, 243, 255, 0.8);
        }

        .nav-links a:hover::after {
            transform: scaleX(1);
            transform-origin: left;
        }

        /* Scanning laser above the link */
        .nav-links a::before {
            content: '';
            position: absolute;
            top: -4px;
            left: 0;
            width: 15px;
            height: 2px;
            background: #fff;
            box-shadow: 0 0 10px #fff, 0 0 20px var(--neon-blue);
            opacity: 0;
            transition: opacity 0.2s;
        }

        .nav-links a:hover::before {
            opacity: 1;
            animation: scanLaser 1s infinite linear;
        }

        @keyframes scanLaser {
            0% { left: 0%; opacity: 0; }
            10% { opacity: 1; }
            90% { opacity: 1; }
            100% { left: 100%; opacity: 0; }
        }`;

const newNavHTML = `    <nav class="navbar">
        <div class="nav-bracket left"></div>
        <div class="logo">
            <div class="logo-icon">
                <div class="logo-planet"></div>
                <div class="logo-ring"></div>
            </div>
            <span>Spaceverse</span>
        </div>
        <div class="nav-content" id="navContent">
            <ul class="nav-links" id="navLinks">
                <li><a href="/">Home</a></li>
                <li><a href="/solar-system">Solar System</a></li>
                <li><a href="/space-traffic-simulator">Traffic</a></li>
                <li><a href="/mission-tracker">Missions</a></li>
                <li><a href="/space-launches">Videos</a></li>
            </ul>
            <div class="user-info" id="userInfo">
                <button class="logout-btn" onclick="logout()" style="background: rgba(255, 77, 77, 0.1); color: #ff4d4d; border: 1px solid #ff4d4d; padding: 0.5rem 1.2rem; border-radius: 20px; cursor: pointer; font-weight: 600; font-family: 'Inter', sans-serif; transition: all 0.3s; box-shadow: 0 0 5px rgba(255,0,0,0.2);">Logout</button>
            </div>
        </div>
        <div class="nav-bracket right"></div>
    </nav>`;

filesToUpdate.forEach(file => {
    const filePath = path.join(viewsDir, file);
    if (!fs.existsSync(filePath)) {
        console.log("Missing:", filePath);
        return;
    }
    
    let content = fs.readFileSync(filePath, 'utf8');

    // Remove old `.navbar { ... }` up to `.logout-btn {` or `.back-home-btn {` or `</style>` block (rough regex)
    // Actually, in mission-tracker it goes up to `@media (max-width: 768px) {` but we can just regex replace `.navbar {` to `.logout-btn`
    // The safest way is to search for `.navbar {` and replace everything until `.container {` or `</style>`
    // Wait, let's just make sure we wipe out old nav CSS but KEEP .container and feature-specific CSS.
    // In all feature files, `.navbar { ... }` follows `#space-bg { ... }`
    
    // We will find `.navbar {` and find `.container {` or `.back-home-btn {` or `.logout-btn`
    // And replace that chunk with `our new CSS`
    
    // Replace CSS
    let startIndex = content.indexOf('.navbar {');
    if (startIndex !== -1) {
        // Find the next known safe class that IS NOT part of the navbar
        // It's usually `.container {` or `.back-home-btn {` or `.header {`
        let endIndex = content.indexOf('.container {', startIndex);
        if (endIndex === -1) endIndex = content.indexOf('.back-home-btn', startIndex);
        if (endIndex === -1) endIndex = content.indexOf('</style>', startIndex);
        
        if (endIndex !== -1) {
            content = content.substring(0, startIndex) + newNavCSS + "\n\n        " + content.substring(endIndex);
        }
    }
    
    // Replace HTML
    // Replace <nav class="navbar"> ... </nav> block
    const navStart = content.indexOf('<nav class="navbar"');
    if (navStart !== -1) {
        let navEnd = content.indexOf('</nav>', navStart);
        if (navEnd !== -1) {
            content = content.substring(0, navStart) + newNavHTML + content.substring(navEnd + 6);
        }
    }
    
    fs.writeFileSync(filePath, content, 'utf8');
    console.log("Successfully updated:", file);
});

console.log("All requested navbars propagated!");
