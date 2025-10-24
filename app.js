// test2
// app.js

// --- Backend (Node.js/Express) Setup ---
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// THIS IS THE NEW LINE TO SERVE YOUR IMAGES
app.use('/images', express.static('images'));

// MongoDB connection string from .env file
const uri = process.env.MONGODB_URI;

mongoose.connect(uri)
    .then(() => console.log('MongoDB connection established successfully.'))
    .catch(err => console.error('MongoDB connection error:', err));

// Mongoose schema updated to include visual data for the 3D scene
const planetSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    info: { type: String, required: true },
    radius: { type: Number, required: true },
    distance: { type: Number, default: 0 },
    speed: { type: Number, default: 0 }, // Orbital speed
    rotationSpeed: { type: Number, default: 0.002 }, // Added for individual planet rotation
    textureUrl: { type: String, required: true },
    ringTextureUrl: { type: String }
});

const Planet = mongoose.model('Planet', planetSchema);

// API endpoint to get all planets
app.get('/api/planets', async (req, res) => {
    try {
        // Add .sort({ distance: 1 }) to order the planets by their distance from the sun
        const planets = await Planet.find().sort({ distance: 1 }); 
        res.json(planets);
    } catch (err) {
        res.status(500).json({ error: 'Error fetching planets' });
    }
});

// --- Dummy Data Insertion (updated with your local image paths and new sizes/speeds) ---
const insertDummyData = async () => {
    await Planet.deleteMany({}); // Clear old data to prevent duplicates on restart
    const dummyPlanets = [
        // RADIUS values significantly increased for better visibility
        // ROTATIONSPEED added for individual rotation rates
        { key: "sun", name: "Sun", radius: 25, textureUrl: '/images/GSFC_20171208_Archive_e001435~orig.jpg', rotationSpeed: 0.0005, info: `<p>The Sun is the star at the center of the Solar System.</p><div class="info-item"><span>Type:</span> <span>G-type main-sequence star</span></div><div class="info-item"><span>Diameter:</span> <span>1.39 million km</span></div>`},
        { key: "mercury", name: "Mercury", radius: 2.5, distance: 40, speed: 0.004, rotationSpeed: 0.0008, textureUrl: '/images/mercury.jpg', info: `<p>Mercury is the smallest planet in our solar system.</p><div class="info-item"><span>Day Length:</span> <span>59 Earth days</span></div><div class="info-item"><span>Year Length:</span> <span>88 Earth days</span></div>`},
        { key: "venus", name: "Venus", radius: 4.5, distance: 60, speed: 0.002, rotationSpeed: 0.0006, textureUrl: '/images/venus.jpg', info: `<p>Venus is the second planet from the Sun.</p><div class="info-item"><span>Day Length:</span> <span>243 Earth days</span></div><div class="info-item"><span>Year Length:</span> <span>225 Earth days</span></div>`},
        { key: "earth", name: "Earth", radius: 5, distance: 85, speed: 0.001, rotationSpeed: 0.01, textureUrl: '/images/earth.jpg', info: `<p>Our home planet, Earth is the only place we know of so far that’s inhabited by living things.</p><div class="info-item"><span>Day Length:</span> <span>24 hours</span></div><div class="info-item"><span>Year Length:</span> <span>365.25 days</span></div>`},
        { key: "mars", name: "Mars", radius: 3.5, distance: 110, speed: 0.0008, rotationSpeed: 0.009, textureUrl: '/images/mars.jpg', info: `<p>Mars is the fourth planet from the Sun – a dusty, cold, desert world.</p><div class="info-item"><span>Day Length:</span> <span>24.6 hours</span></div><div class="info-item"><span>Year Length:</span> <span>687 Earth days</span></div>`},
        { key: "jupiter", name: "Jupiter", radius: 15, distance: 180, speed: 0.0005, rotationSpeed: 0.02, textureUrl: '/images/jupiter.webp', info: `<p>Jupiter is the largest planet in our solar system.</p><div class="info-item"><span>Day Length:</span> <span>9.9 Earth hours</span></div><div class="info-item"><span>Year Length:</span> <span>11.9 Earth years</span></div>`},
        { key: "saturn", name: "Saturn", radius: 12, distance: 250, speed: 0.0003, rotationSpeed: 0.018, textureUrl: '/images/saturn.webp', ringTextureUrl: 'https://s3-us-west-2.amazonaws.com/s.cdpn.io/17271/2k_saturn_ring_alpha.png', info: `<p>Saturn is the sixth planet from the Sun.</p><div class="info-item"><span>Day Length:</span> <span>10.7 Earth hours</span></div><div class="info-item"><span>Year Length:</span> <span>29.5 Earth years</span></div>`},
        { key: "uranus", name: "Uranus", radius: 9, distance: 320, speed: 0.0002, rotationSpeed: 0.012, textureUrl: '/images/Uranus.jpg', info: `<p>Uranus is the seventh planet from the Sun.</p><div class="info-item"><span>Day Length:</span> <span>17.2 Earth hours</span></div><div class="info-item"><span>Year Length:</span> <span>84 Earth years</span></div>`},
        { key: "neptune", name: "Neptune", radius: 8.8, distance: 380, speed: 0.0001, rotationSpeed: 0.013, textureUrl: '/images/neptune.jpg', info: `<p>Neptune is the eighth and farthest-known Solar planet.</p><div class="info-item"><span>Day Length:</span> <span>16.1 Earth hours</span></div><div class="info-item"><span>Year Length:</span> <span>164.8 Earth years</span></div>`}
    ];
    await Planet.insertMany(dummyPlanets);
    console.log('Dummy planet data inserted!');
};

insertDummyData().catch(err => {
    if (err.code !== 11000) { // Ignore duplicate key errors on hot-reload
        console.error(err);
    }
});

// --- Frontend HTML Template ---
const htmlTemplate = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Interactive Planet Explorer Deluxe</title>
    <style>
        body { margin: 0; overflow: hidden; font-family: 'Inter', sans-serif; background-color: #00000a; color: #ffffff; }
        canvas { display: block; }
        #loader-container { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-color: #00000a; display: flex; justify-content: center; align-items: center; flex-direction: column; z-index: 100; transition: opacity 0.5s ease; }
        #loader-container.hidden { opacity: 0; pointer-events: none; }
        .loader-text { font-size: 1.5em; margin-bottom: 20px; }
        .progress-bar { width: 300px; height: 5px; background-color: rgba(255,255,255,0.2); border-radius: 5px; overflow: hidden; }
        #progress { width: 0%; height: 100%; background-color: #ffb703; transition: width 0.2s ease; }
        #info-panel { position: absolute; top: 20px; left: -450px; width: 380px; max-height: calc(100vh - 40px); background-color: rgba(0, 5, 20, 0.8); border-radius: 15px; padding: 25px; box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.37); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.18); transition: left 0.5s ease-in-out; overflow-y: auto; z-index: 10; }
        #info-panel.visible { left: 20px; }
        #info-panel h2 { margin-top: 0; color: #ffb703; font-size: 1.8em; text-align: center; }
        #info-panel p { line-height: 1.6; font-size: 0.95em; }
        #close-btn { position: absolute; top: 15px; right: 15px; background: none; border: none; color: white; font-size: 24px; cursor: pointer; transition: transform 0.2s; }
        #close-btn:hover { transform: scale(1.2); }
        .info-item { display: flex; justify-content: space-between; margin-bottom: 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.1); padding-bottom: 8px; }
        .info-item span:first-child { font-weight: bold; color: #fb8500; }
        #navigation-bar { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); background-color: rgba(0, 5, 20, 0.8); border-radius: 15px; padding: 10px; box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.37); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.18); display: flex; gap: 10px; z-index: 10; }
        .nav-btn { background: none; border: 2px solid transparent; color: #fff; padding: 8px 15px; border-radius: 10px; cursor: pointer; font-size: 0.9em; transition: background-color 0.3s, border-color 0.3s; }
        .nav-btn:hover { background-color: rgba(255, 183, 3, 0.2); border-color: #ffb703; } /* Added hover effect */
        .nav-btn.active { background-color: rgba(255, 183, 3, 0.4); border-color: #ffb703; }
        #panel-planet-img { display: block; width: 100px; height: 100px; border-radius: 50%; object-fit: cover; margin: 0 auto 20px auto; box-shadow: 0 0 15px rgba(255, 183, 3, 0.5); background-color: #000; }
    </style>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap" rel="stylesheet">
</head>
<body>
    <div id="loader-container">
        <div class="loader-text">Warping into the solar system...</div>
        <div class="progress-bar"><div id="progress"></div></div>
    </div>
    
    <div id="info-panel">
        <button id="close-btn">&times;</button>
        <img src="" alt="Selected Planet" id="panel-planet-img">
        <h2 id="planet-name"></h2>
        <div id="planet-info"></div>
    </div>

    <div id="navigation-bar"></div>

    <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/tween.js/18.6.4/tween.umd.js"></script>
    <script>
        document.addEventListener('DOMContentLoaded', () => {
            const scene = new THREE.Scene();
            const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
            const renderer = new THREE.WebGLRenderer({ antialias: true });
            renderer.setSize(window.innerWidth, window.innerHeight);
            document.body.appendChild(renderer.domElement);
            const loadingManager = new THREE.LoadingManager();
            const loaderContainer = document.getElementById('loader-container');
            const progressElement = document.getElementById('progress');
            loadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
                progressElement.style.width = (itemsLoaded / itemsTotal * 100) + '%';
            };
            loadingManager.onLoad = () => {
                setTimeout(() => loaderContainer.classList.add('hidden'), 500);
            };
            const textureLoader = new THREE.TextureLoader(loadingManager);
            const ambientLight = new THREE.AmbientLight(0x404040, 3.5);
            scene.add(ambientLight);
            const pointLight = new THREE.PointLight(0xffffff, 2, 3000);
            pointLight.position.set(0, 80, 180);
            scene.add(pointLight);
            const starGeometry = new THREE.BufferGeometry();
            const starVertices = [];
            for (let i = 0; i < 15000; i++) {
                const x = (Math.random() - 0.5) * 3000;
                const y = (Math.random() - 0.5) * 3000;
                const z = (Math.random() - 0.5) * 3000;
                starVertices.push(x, y, z);
            }
            starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
            const starMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 0.7 });
            const stars = new THREE.Points(starGeometry, starMaterial);
            scene.add(stars);
            const celestialObjects = new Map();
            const navigationBar = document.getElementById('navigation-bar');

            fetch('/api/planets')
                .then(response => response.json())
                .then(planetApiData => {
                    const planetData = {};
                    planetApiData.forEach(planet => {
                        planetData[planet.key] = planet;
                    });
                    
                    buildScene(planetData);
                })
                .catch(error => {
                    console.error('Error fetching planet data:', error);
                    document.querySelector('.loader-text').textContent = 'Could not load solar system data.';
                });
            
            function buildScene(planetData) {
                for (const key in planetData) {
                    const data = planetData[key];
                    const geometry = new THREE.SphereGeometry(data.radius, 64, 64);
                    const texture = textureLoader.load(data.textureUrl);
                    
                    let material;
                    if (key === 'sun') {
                        material = new THREE.MeshBasicMaterial({ map: texture });
                    } else {
                        material = new THREE.MeshStandardMaterial({ map: texture });
                    }
                    
                    const mesh = new THREE.Mesh(geometry, material);
                    mesh.position.x = data.distance || 0;
                    mesh.userData = { ...data, key };

                    // Adjust mesh rotation for better texture mapping appearance
                    if (key !== 'sun') {
                        mesh.rotation.y = Math.PI / 2; // Rotate 90 degrees on Y to adjust texture
                    }

                    if(data.ringTextureUrl) {
                        const ringGeometry = new THREE.RingGeometry(data.radius + 1.5, data.radius + 5, 64);
                        const ringTexture = textureLoader.load(data.ringTextureUrl);
                        const ringMaterial = new THREE.MeshBasicMaterial({ map: ringTexture, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
                        const ring = new THREE.Mesh(ringGeometry, ringMaterial);
                        ring.rotation.x = -Math.PI / 2;
                        mesh.add(ring);
                    }

                    let orbit;
                    if (data.distance) {
                        const orbitGeometry = new THREE.RingGeometry(data.distance - 0.1, data.distance + 0.1, 256);
                        const orbitMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.15 });
                        orbit = new THREE.Mesh(orbitGeometry, orbitMaterial);
                        orbit.rotation.x = Math.PI / 2;
                        scene.add(orbit);
                    }
                    
                    celestialObjects.set(key, { mesh, orbit });

                    const navBtn = document.createElement('button');
                    navBtn.className = 'nav-btn';
                    navBtn.textContent = data.name;
                    navBtn.dataset.key = key;
                    navBtn.addEventListener('click', () => handleObjectSelection(celestialObjects.get(key).mesh));
                    navigationBar.appendChild(navBtn);
                    
                    scene.add(mesh);
                }
            }

            camera.position.set(0, 80, 180);
            camera.lookAt(scene.position);
            let isDragging = false, canClick = true;
            let previousMousePosition = { x: 0, y: 0 };
            let cameraTarget = new THREE.Vector3(0,0,0);
            let cameraRadius = 200;
            let cameraTheta = 0;
            let cameraPhi = Math.PI / 4;
            document.addEventListener('mousedown', e => { 
                isDragging = true; 
                canClick = true;
                previousMousePosition = { x: e.clientX, y: e.clientY };
            });
            document.addEventListener('mouseup', () => { isDragging = false; });
            document.addEventListener('mousemove', e => {
                if (Math.abs(e.clientX - previousMousePosition.x) > 5 || Math.abs(e.clientY - previousMousePosition.y) > 5) {
                    canClick = false;
                }
                if (!isDragging) return;
                const deltaMove = { x: e.clientX - previousMousePosition.x, y: e.clientY - previousMousePosition.y };
                cameraTheta -= deltaMove.x * 0.005;
                cameraPhi -= deltaMove.y * 0.005;
                cameraPhi = Math.max(0.1, Math.min(Math.PI - 0.1, cameraPhi));
                previousMousePosition = { x: e.clientX, y: e.clientY };
            });
            document.addEventListener('wheel', e => {
                cameraRadius += e.deltaY * 0.1;
                cameraRadius = Math.max(10, Math.min(800, cameraRadius));
            });

            const raycaster = new THREE.Raycaster();
            const mouse = new THREE.Vector2();

            document.addEventListener('click', (event) => {
                if (!canClick || event.target.closest('#navigation-bar, #info-panel')) return;
                mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
                mouse.y = - (event.clientY / window.innerHeight) * 2 + 1;
                raycaster.setFromCamera(mouse, camera);
                const intersects = raycaster.intersectObjects([...celestialObjects.values()].map(o => o.mesh));
                if (intersects.length > 0) {
                    handleObjectSelection(intersects[0].object);
                }
            });

            function handleObjectSelection(selectedMesh) {
                const data = selectedMesh.userData;
                const key = data.key;
                document.getElementById('panel-planet-img').src = data.textureUrl;
                document.getElementById('planet-name').innerText = data.name;
                document.getElementById('planet-info').innerHTML = data.info;
                document.getElementById('info-panel').classList.add('visible');
                
                const targetPosition = new THREE.Vector3();
                selectedMesh.getWorldPosition(targetPosition);
                
                // New target camera distance based on planet radius for better framing
                const newCameraRadius = data.radius * 7; // Adjust multiplier for desired zoom level
                const newCameraPhi = Math.PI / 2.5; // Slightly above the equator

                new TWEEN.Tween(cameraTarget).to(targetPosition, 1200).easing(TWEEN.Easing.Quadratic.Out).start();
                
                // Animate camera's radius and phi directly for smooth zoom and angle change
                new TWEEN.Tween({ radius: cameraRadius, phi: cameraPhi })
                    .to({ radius: newCameraRadius, phi: newCameraPhi }, 1200)
                    .easing(TWEEN.Easing.Quadratic.Out)
                    .onUpdate(function() {
                        cameraRadius = this._object.radius;
                        cameraPhi = this._object.phi;
                    })
                    .start();

                document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
                document.querySelector(\`.nav-btn[data-key="\${key}"]\`).classList.add('active');
                
                celestialObjects.forEach((obj, objKey) => {
                    if(obj.orbit) {
                        obj.orbit.material.opacity = (objKey === key) ? 0.8 : 0.15;
                        obj.orbit.material.color.set((objKey === key) ? 0xffb703 : 0xffffff);
                    }
                });
            }
            
            document.getElementById('close-btn').addEventListener('click', () => {
                document.getElementById('info-panel').classList.remove('visible');
                // Return camera to a general overview position
                new TWEEN.Tween(cameraTarget).to({x:0, y:0, z:0}, 1000).easing(TWEEN.Easing.Quadratic.Out).start();
                new TWEEN.Tween({ radius: cameraRadius, phi: cameraPhi })
                    .to({ radius: 200, phi: Math.PI / 4 }, 1000) // Reset to initial overview values
                    .easing(TWEEN.Easing.Quadratic.Out)
                    .onUpdate(function() {
                        cameraRadius = this._object.radius;
                        cameraPhi = this._object.phi;
                    })
                    .start();

                document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
                celestialObjects.forEach(obj => {
                    if(obj.orbit) {
                        obj.orbit.material.opacity = 0.15;
                        obj.orbit.material.color.set(0xffffff);
                    }
                });
            });

            const clock = new THREE.Clock();
            function animate() {
                requestAnimationFrame(animate);
                const elapsedTime = clock.getElapsedTime();
                celestialObjects.forEach(({ mesh }) => {
                    const data = mesh.userData;
                    if (data.distance) {
                        mesh.position.x = Math.cos(elapsedTime * data.speed) * data.distance;
                        mesh.position.z = Math.sin(elapsedTime * data.speed) * data.distance;
                    }
                    // Use individual rotationSpeed
                    mesh.rotation.y += data.rotationSpeed || 0.002; // Fallback to default if not defined
                });
                camera.position.x = cameraTarget.x + cameraRadius * Math.sin(cameraPhi) * Math.sin(cameraTheta);
                camera.position.y = cameraTarget.y + cameraRadius * Math.cos(cameraPhi);
                camera.position.z = cameraTarget.z + cameraRadius * Math.sin(cameraPhi) * Math.cos(cameraTheta);
                camera.lookAt(cameraTarget);
                TWEEN.update();
                renderer.render(scene, camera);
            }
            animate();
            window.addEventListener('resize', () => {
                camera.aspect = window.innerWidth / window.innerHeight;
                camera.updateProjectionMatrix();
                renderer.setSize(window.innerWidth, window.innerHeight);
            });
        });
    </script>
</body>
</html>
`;

// Serve the React frontend on the root URL
app.get('/', (req, res) => {
    res.send(htmlTemplate);
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Open your browser and navigate to http://localhost:${PORT}`);
});