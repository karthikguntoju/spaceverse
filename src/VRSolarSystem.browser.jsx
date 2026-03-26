// VR Solar System Component - Browser Compatible Version
// This version removes ES6 module syntax for better browser compatibility

// Properly access globals after libraries are loaded
const { useRef, useState, useEffect } = React;

// Safely access React Three Fiber exports
let Canvas, useFrame, useThree;
// Try different possible locations for React Three Fiber
if (typeof window.ReactThreeFiber !== 'undefined') {
    ({ Canvas, useFrame, useThree } = window.ReactThreeFiber);
    console.log('React Three Fiber found in window.ReactThreeFiber');
} else if (typeof window.Fiber !== 'undefined') {
    ({ Canvas, useFrame, useThree } = window.Fiber);
    console.log('React Three Fiber found in window.Fiber');
} else {
    console.warn('React Three Fiber not found in expected locations');
    // Fallback to dummy functions to prevent complete failure
    Canvas = ({ children }) => React.createElement('div', { className: 'fallback-canvas' }, children);
    useFrame = () => {};
    useThree = () => ({});
}// Safely access React Three XR exports
let XR, createXRStore, useXR, useXRFrame, Controllers, Hands;
if (typeof window.ReactThreeXR !== 'undefined') {
    ({ XR, createXRStore, useXR, useXRFrame, Controllers, Hands } = window.ReactThreeXR);
} else if (typeof window.XR !== 'undefined') {
    ({ XR, createXRStore, useXR, useXRFrame, Controllers, Hands } = window.XR);
} else {
    console.error('React Three XR not available');
    // Fallback to dummy components to prevent complete failure
    XR = ({ children }) => children;
    createXRStore = () => ({});
    useXR = () => ({});
    useXRFrame = () => {};
    Controllers = () => null;
    Hands = () => null;
}

const THREE = window.THREE || {};
// Planet data - mirroring the existing implementation with more accurate data
const planetData = [
  { key: 'sun', name: 'Sun', radius: 30, distance: 0, speed: 0, rotationSpeed: 0.0005, textureUrl: '/images/GSFC_20171208_Archive_e001435~orig.jpg' },
  { key: 'mercury', name: 'Mercury', radius: 2.5, distance: 50, speed: 0.004, rotationSpeed: 0.0008, textureUrl: '/public/textures/mercury.jpg' },
  { key: 'venus', name: 'Venus', radius: 4.5, distance: 70, speed: 0.002, rotationSpeed: 0.0006, textureUrl: '/public/textures/venus.jpg' },
  { key: 'earth', name: 'Earth', radius: 5, distance: 95, speed: 0.001, rotationSpeed: 0.01, textureUrl: '/public/textures/earth.jpg' },
  { key: 'mars', name: 'Mars', radius: 3.5, distance: 120, speed: 0.0008, rotationSpeed: 0.009, textureUrl: '/public/textures/mars.jpg' },
  { key: 'jupiter', name: 'Jupiter', radius: 12, distance: 180, speed: 0.0004, rotationSpeed: 0.02, textureUrl: '/public/textures/jupiter.jpg' },
  { key: 'saturn', name: 'Saturn', radius: 10, distance: 220, speed: 0.0003, rotationSpeed: 0.018, textureUrl: '/public/textures/saturn.jpg', ringTextureUrl: '/public/textures/saturn-ring.png' },
  { key: 'uranus', name: 'Uranus', radius: 6, distance: 280, speed: 0.0002, rotationSpeed: 0.015, textureUrl: '/public/textures/uranus.jpg' },
  { key: 'neptune', name: 'Neptune', radius: 6, distance: 320, speed: 0.0001, rotationSpeed: 0.016, textureUrl: '/public/textures/neptune.jpg' }
];

// Orbital periods (approx, in Earth days) for real-time alignment
const orbitalPeriods = {
  sun: null,
  mercury: 87.969,
  venus: 224.701,
  earth: 365.256,
  mars: 686.98,
  jupiter: 4332.589,
  saturn: 10759,
  uranus: 30688.5,
  neptune: 60182
};

// Planet component
const Planet = ({ planet, isSelected, onSelect, useRealTimeAlignment }) => {
  const meshRef = useRef();
  const groupRef = useRef();
  const ringRef = useRef();
  
  const [texture, setTexture] = useState(null);
  const [ringTexture, setRingTexture] = useState(null);
  
  // Load textures
  useEffect(() => {
    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(planet.textureUrl, (loadedTexture) => {
      setTexture(loadedTexture);
    });
    
    if (planet.ringTextureUrl) {
      textureLoader.load(planet.ringTextureUrl, (loadedTexture) => {
        setRingTexture(loadedTexture);
      });
    }
  }, [planet.textureUrl, planet.ringTextureUrl]);
  
  // Animation frame
  useFrame((state, delta) => {
    if (meshRef.current && groupRef.current) {
      // Rotation animation
      meshRef.current.rotation.y += planet.rotationSpeed;
      
      // Orbit animation
      if (planet.distance > 0) {
        if (useRealTimeAlignment) {
          // Real-time orbital alignment based on actual planetary periods
          const period = orbitalPeriods[planet.key];
          if (period) {
            groupRef.current.rotation.y += (2 * Math.PI) / (period * 24 * 60 * 60) * delta * 60; // Speed up for demo
          }
        } else {
          // Simplified orbit animation
          groupRef.current.rotation.y += planet.speed;
        }
      }
    }
    
    if (ringRef.current && planet.key === 'saturn') {
      ringRef.current.rotation.x = Math.PI / 3;
    }
  });
  
  // Handle planet click
  const handleClick = () => {
    onSelect(planet);
  };
  
  return (
    <group ref={groupRef}>
      <mesh 
        ref={meshRef} 
        position={[planet.distance, 0, 0]}
        onClick={handleClick}
        scale={isSelected ? [1.2, 1.2, 1.2] : [1, 1, 1]}
      >
        <sphereGeometry args={[planet.radius, 32, 32]} />
        {texture && <meshStandardMaterial map={texture} />}
        {!texture && <meshStandardMaterial color="#888888" />}
      </mesh>
      
      {/* Saturn's rings */}
      {planet.key === 'saturn' && ringTexture && (
        <mesh ref={ringRef} position={[planet.distance, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[planet.radius * 1.5, planet.radius * 2.5, 64]} />
          <meshStandardMaterial 
            map={ringTexture} 
            side={THREE.DoubleSide}
            transparent={true}
          />
        </mesh>
      )}
    </group>
  );
};

// Solar System Scene component
const SolarSystemScene = ({ onPlanetSelect, selectedPlanet, useRealTimeAlignment }) => {
  const { camera } = useThree();
  
  // Position camera to view the solar system
  useEffect(() => {
    camera.position.set(0, 100, 200);
    camera.lookAt(0, 0, 0);
  }, [camera]);
  
  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.3} />
      <pointLight position={[0, 0, 0]} intensity={2} distance={500} />
      
      {/* Stars background */}
      <Stars />
      
      {/* Planets */}
      {planetData.map((planet) => (
        <Planet
          key={planet.key}
          planet={planet}
          isSelected={selectedPlanet?.key === planet.key}
          onSelect={onPlanetSelect}
          useRealTimeAlignment={useRealTimeAlignment}
        />
      ))}
      
      {/* XR Controllers */}
      <Controllers />
      <Hands />
    </>
  );
};

// Stars background component
const Stars = () => {
  const starsRef = useRef();
  
  useEffect(() => {
    if (starsRef.current) {
      const starCount = 5000;
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(starCount * 3);
      
      for (let i = 0; i < starCount * 3; i++) {
        positions[i] = (Math.random() - 0.5) * 2000;
      }
      
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      starsRef.current.geometry = geometry;
    }
  }, []);
  
  return (
    <points ref={starsRef}>
      <bufferGeometry />
      <pointsMaterial color="#ffffff" size={1} sizeAttenuation={false} />
    </points>
  );
};

// VR Entry Button component
const VREntryButton = ({ onEnterVR }) => (
  <button
    onClick={onEnterVR}
    style={{
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      padding: '20px 40px',
      fontSize: '24px',
      backgroundColor: 'rgba(100, 255, 218, 0.2)',
      color: '#E6F1FF',
      border: '2px solid #64FFDA',
      borderRadius: '15px',
      backdropFilter: 'blur(12px)',
      cursor: 'pointer',
      zIndex: 1000,
      transition: 'all 0.3s ease'
    }}
    onMouseOver={(e) => e.target.style.backgroundColor = 'rgba(100, 255, 218, 0.3)'}
    onMouseOut={(e) => e.target.style.backgroundColor = 'rgba(100, 255, 218, 0.2)'}
  >
    👓 Enter VR
  </button>
);

// Planet Info Panel component
const PlanetInfoPanel = ({ planet, onClose }) => {
  if (!planet) return null;
  
  return (
    <div style={{
      position: 'absolute',
      top: '20px',
      left: '50%',
      transform: 'translateX(-50%)',
      backgroundColor: 'rgba(13, 17, 23, 0.9)',
      borderRadius: '15px',
      padding: '20px',
      maxWidth: '500px',
      width: '90%',
      backdropFilter: 'blur(12px)',
      border: '1px solid rgba(100, 255, 218, 0.2)',
      color: '#E6F1FF',
      zIndex: 1000
    }}>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        marginBottom: '15px' 
      }}>
        <h2 style={{ margin: 0 }}>{planet.name}</h2>
        <button 
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#E6F1FF',
            fontSize: '24px',
            cursor: 'pointer'
          }}
        >
          ×
        </button>
      </div>
      
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: '1fr 1fr', 
        gap: '15px',
        marginBottom: '15px'
      }}>
        <div>
          <strong>Radius:</strong> {planet.radius} units
        </div>
        <div>
          <strong>Distance:</strong> {planet.distance} units
        </div>
        <div>
          <strong>Orbital Speed:</strong> {planet.speed}
        </div>
        <div>
          <strong>Rotation Speed:</strong> {planet.rotationSpeed}
        </div>
      </div>
      
      <button 
        onClick={() => window.location.href = '/quiz'}
        style={{
          padding: '12px 24px',
          backgroundColor: 'transparent',
          color: '#E6F1FF',
          border: '1px solid #64FFDA',
          borderRadius: '8px',
          cursor: 'pointer',
          width: '100%',
          fontWeight: 'bold'
        }}
      >
        🧠 Take Quiz
      </button>
    </div>
  );
};

// VR Solar System Component
const VRSolarSystem = () => {
  const [selectedPlanet, setSelectedPlanet] = useState(null);
  const [showVRButton, setShowVRButton] = useState(true);
  const [useRealTimeAlignment, setUseRealTimeAlignment] = useState(false);
  const store = createXRStore();
  
  const handlePlanetSelect = (planet) => {
    setSelectedPlanet(planet);
  };
  
  const handleCloseInfo = () => {
    setSelectedPlanet(null);
  };
  
  const handleEnterVR = () => {
    store.enterVR();
    setShowVRButton(false);
  };
  
  const toggleRealTimeAlignment = () => {
    setUseRealTimeAlignment(!useRealTimeAlignment);
  };
  
  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <Canvas
        camera={{ position: [0, 100, 200], fov: 75 }}
        style={{ background: '#0D1117' }}
      >
        <XR store={store}>
          <SolarSystemScene 
            onPlanetSelect={handlePlanetSelect} 
            selectedPlanet={selectedPlanet}
            useRealTimeAlignment={useRealTimeAlignment}
          />
        </XR>
      </Canvas>
      
      {/* Back to Home button */}
      <a 
        href="/" 
        style={{
          position: 'absolute',
          top: '20px',
          left: '20px',
          padding: '10px 20px',
          backgroundColor: 'rgba(100, 255, 218, 0.06)',
          color: '#E6F1FF',
          border: '2px solid #64FFDA',
          borderRadius: '25px',
          textDecoration: 'none',
          zIndex: 1000
        }}
      >
        ← Back to Home
      </a>
      
      {/* VR Entry Button */}
      {showVRButton && <VREntryButton onEnterVR={handleEnterVR} />}
      
      {/* Planet Info Panel */}
      <PlanetInfoPanel planet={selectedPlanet} onClose={handleCloseInfo} />
      
      {/* Controls Panel */}
      <div style={{
        position: 'absolute',
        top: '20px',
        right: '20px',
        backgroundColor: 'rgba(13, 17, 23, 0.8)',
        borderRadius: '15px',
        padding: '15px',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(100, 255, 218, 0.2)',
        color: '#E6F1FF',
        zIndex: 1000
      }}>
        <div style={{ marginBottom: '10px' }}>
          <label>
            <input 
              type="checkbox" 
              checked={useRealTimeAlignment}
              onChange={toggleRealTimeAlignment}
              style={{ marginRight: '8px' }}
            />
            Real-time Alignment
          </label>
        </div>
        <button 
          onClick={() => window.location.href = '/solar-system'}
          style={{
            padding: '8px 12px',
            backgroundColor: 'transparent',
            color: '#E6F1FF',
            border: '1px solid #64FFDA',
            borderRadius: '5px',
            cursor: 'pointer',
            width: '100%'
          }}
        >
          Standard 3D Mode
        </button>
      </div>
      
      {/* Navigation Bar */}
      <div style={{
        position: 'absolute',
        bottom: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: '10px',
        maxWidth: '90vw',
        overflowX: 'auto'
      }}>
        {planetData.map((planet) => (
          <button
            key={planet.key}
            onClick={() => handlePlanetSelect(planet)}
            style={{
              padding: '8px 16px',
              backgroundColor: selectedPlanet?.key === planet.key 
                ? 'rgba(100, 255, 218, 0.2)' 
                : 'transparent',
              color: '#E6F1FF',
              border: `1px solid ${selectedPlanet?.key === planet.key ? '#64FFDA' : 'rgba(255, 255, 255, 0.2)'}`,
              borderRadius: '8px',
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            {planet.name}
          </button>
        ))}
      </div>
    </div>
  );
};

// Make VRSolarSystem globally available
window.VRSolarSystem = VRSolarSystem;