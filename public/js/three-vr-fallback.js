// Minimal, robust Three.js + WebXR fallback
window.initThreeVRFallback = function(containerId){
  try{
    const container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId || document.getElementById('vr-container');
    if(!container) {
      console.warn('Fallback: container not found');
      return;
    }

    // If THREE is not available as global, try to find module export
    const THREE = window.THREE;
    if(typeof THREE === 'undefined'){
      console.error('Fallback: THREE not available - ensure /lib/three is served');
      const errDiv = document.getElementById('error');
      if(errDiv){ errDiv.style.display = 'block'; errDiv.innerHTML = '<p>Three.js not available for fallback rendering.</p>'; }
      return;
    }

    // Clear previous content
    container.innerHTML = '';

    // Create renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.xr.enabled = true; // enable WebXR when available
    container.appendChild(renderer.domElement);

    // Create scene and camera
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d1117);
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 5000);
    camera.position.set(0, 60, 240);

    // Lighting
    scene.add(new THREE.AmbientLight(0x404040));
    const sunLight = new THREE.PointLight(0xffffff, 2, 3000);
    sunLight.position.set(0,0,0);
    scene.add(sunLight);

    // Sun
    const sunGeo = new THREE.SphereGeometry(30, 48, 48);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xffd700 });
    const sun = new THREE.Mesh(sunGeo, sunMat);
    scene.add(sun);

    // Earth
    const earthGeo = new THREE.SphereGeometry(5, 32, 32);
    const earthMat = new THREE.MeshPhongMaterial({ color: 0x1e90ff });
    const earth = new THREE.Mesh(earthGeo, earthMat);
    earth.position.set(95, 0, 0);
    scene.add(earth);

    // Stars
    const starGeo = new THREE.BufferGeometry();
    const starVertices = [];
    for(let i=0;i<2000;i++){
      starVertices.push((Math.random()-0.5)*2000, (Math.random()-0.5)*2000, (Math.random()-0.5)*2000);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.5 }));
    scene.add(stars);

    // Controls: simple orbit controls if available
    let controls;
    try{
      if(THREE.OrbitControls){
        controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.target.set(0,0,0);
      }
    }catch(e){ /* ignore */ }

    // Animation loop
    const clock = new THREE.Clock();
    const animate = () => {
      const delta = clock.getDelta();
      earth.rotation.y += 0.01;
      earth.position.x = Math.cos(Date.now()*0.0005)*95;
      earth.position.z = Math.sin(Date.now()*0.0005)*95;
      if(controls) controls.update();
      renderer.render(scene, camera);
    };

    renderer.setAnimationLoop(animate);

    // VR Button (minimal): if WebXR available, request session
    function createVRButton(){
      const btn = document.createElement('button');
      btn.style.position = 'absolute';
      btn.style.bottom = '20px';
      btn.style.left = '20px';
      btn.style.zIndex = 10000;
      btn.style.padding = '10px 16px';
      btn.style.background = 'rgba(100,255,218,0.08)';
      btn.style.border = '1px solid #64FFDA';
      btn.style.color = '#E6F1FF';
      btn.style.borderRadius = '8px';
      btn.textContent = 'Enter VR';

      btn.addEventListener('click', async () => {
        if(navigator.xr && navigator.xr.requestSession){
          try{
            const session = await navigator.xr.requestSession('immersive-vr');
            await renderer.xr.setSession(session);
          }catch(e){
            console.warn('XR session failed:', e);
            // fallback to fullscreen
            if(renderer.domElement.requestFullscreen) renderer.domElement.requestFullscreen();
          }
        } else {
          // Fallback: fullscreen
          if(renderer.domElement.requestFullscreen) renderer.domElement.requestFullscreen();
        }
      });

      document.body.appendChild(btn);
    }

    createVRButton();

    // Handle resize
    window.addEventListener('resize', ()=>{
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    console.log('Three.js fallback VR initialized');
    // expose for testing
    window.__three_vr_fallback_initialized = true;
    return { renderer, scene, camera };
  }catch(e){
    console.error('three-vr-fallback init error:', e);
    const errDiv = document.getElementById('error'); if(errDiv){ errDiv.style.display='block'; errDiv.innerHTML = `<p>Fallback init error: ${e.message}</p>`; }
  }
};