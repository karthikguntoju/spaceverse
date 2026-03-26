import React, { useRef, useState, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { XR, createXRStore, useXR, useXRFrame, Controllers, Hands } from '@react-three/xr';
import * as THREE from 'three';

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

// J2000 epoch (approx): Jan 1, 2000 at 12:00 UTC
const J2000 = Date.UTC(2000, 0, 1, 12, 0, 0);

// Texture loader helper
const useTextureLoader = (url) => {
  const textureRef = useRef();
  
  useEffect(() => {
    if (url) {
      const loader = new THREE.TextureLoader();
      loader.load(url, (texture) => {
        textureRef.current = texture;
      });
    }
  }, [url]);
  
  return textureRef.current;
};

// Floating Label component for VR
const FloatingLabel = ({ text, position }) => {
  const textureRef = useRef();
  
  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    context.fillStyle = 'rgba(0, 0, 0, 0.7)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.font = 'Bold 32px Arial';
    context.fillStyle = 'white';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, canvas.width / 2, canvas.height / 2);
    
    const texture = new THREE.CanvasTexture(canvas);
    textureRef.current = texture;
  }, [text]);
  
  if (!textureRef.current) return null;
  
  return (
    <sprite position={position}>
      <spriteMaterial map={textureRef.current} />
    </sprite>
  );
};

// Planet component
const Planet = ({ data, isSelected, onSelect, useRealTimeAlignment }) => {
  const meshRef = useRef();
  const pivotRef = useRef();
  const texture = useTextureLoader(data.textureUrl);
  const ringTexture = useTextureLoader(data.ringTextureUrl);
  
  useFrame((state, delta) => {
    if (meshRef.current && pivotRef.current) {
      // Orbital motion
      if (data.distance > 0) {
        if (useRealTimeAlignment && orbitalPeriods[data.key]) {
          // Real-time orbital calculation based on J2000 epoch
          const now = Date.now();
          const daysSinceJ2000 = (now - J2000) / (1000 * 60 * 60 * 24);
          const periodDays = orbitalPeriods[data.key];
          const frac = (daysSinceJ2000 % periodDays) / periodDays;
          const angle = frac * Math.PI * 2;
          
          pivotRef.current.rotation.y = angle;
        } else {
          // Demo mode orbital motion
          pivotRef.current.rotation.y += data.speed * 0.5; // Slower for VR comfort
        }
      }
      
      // Rotation (slower for VR comfort)
      meshRef.current.rotation.y += data.rotationSpeed * 0.5;
    }
  });
  
  const handleClick = () => {
    onSelect(data);
  };
  
  return (
    <group ref={pivotRef}>
      <group 
        position={[data.distance, 0, 0]}
        onClick={handleClick}
        onPointerOver={() => document.body.style.cursor = 'pointer'}
        onPointerOut={() => document.body.style.cursor = 'auto'}
      >
        <mesh ref={meshRef}>
          <sphereGeometry args={[data.radius, 64, 64]} />
          {texture ? (
            <meshStandardMaterial map={texture} />
          ) : (
            <meshStandardMaterial color={0xaaaaaa} />
          )}
        </mesh>
        
        {/* Saturn's rings */}
        {data.key === 'saturn' && ringTexture && (
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[data.radius + 2, data.radius + 8, 64]} />
            <meshBasicMaterial map={ringTexture} transparent side={THREE.DoubleSide} />
          </mesh>
        )}
        
        {/* Selection highlight */}
        {isSelected && (
          <mesh>
            <sphereGeometry args={[data.radius * 1.1, 32, 32]} />
            <meshBasicMaterial color={0x64ffda} transparent opacity={0.3} side={THREE.BackSide} />
          </mesh>
        )}
        
        {/* Floating label */}
        <FloatingLabel text={data.name} position={[0, data.radius + 5, 0]} />
      </group>
    </group>
  );
};

// Orbit component
const Orbit = ({ radius }) => {
  if (radius <= 0) return null;
  
  return (
    <mesh rotation={[Math.PI / 2, 0, 0]}>
      <ringGeometry args={[radius - 0.5, radius + 0.5, 128]} />
      <meshBasicMaterial color={0xffffff} transparent opacity={0.2} side={THREE.DoubleSide} />
    </mesh>
  );
};

// Starfield component
const Starfield = () => {
  const starsRef = useRef();
  
  useEffect(() => {
    const starGeometry = new THREE.BufferGeometry();
    const starVertices = [];
    
    // Increased stars for better VR immersion
    for (let i = 0; i < 20000; i++) {
      const x = (Math.random() - 0.5) * 4000;
      const y = (Math.random() - 0.5) * 4000;
      const z = (Math.random() - 0.5) * 4000;
      starVertices.push(x, y, z);
    }
    
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
    starsRef.current.geometry = starGeometry;
  }, []);
  
  return (
    <points ref={starsRef}>
      <pointsMaterial color={0xffffff} size={2} sizeAttenuation={false} />
    </points>
  );
};

// Camera controller for VR
const VRCameraController = ({ targetPlanet }) => {
  const { camera } = useThree();
  const cameraTargetRef = useRef(new THREE.Vector3(0, 0, 0));
  
  useFrame(() => {
    if (targetPlanet) {
      // Move camera closer to the selected planet with comfortable distance
      const targetPos = new THREE.Vector3(
        targetPlanet.distance * 1.5,
        targetPlanet.radius * 3, // Higher for better view
        targetPlanet.distance * 1.5
      );
      
      // Smoothly interpolate camera position
      camera.position.lerp(targetPos, 0.05);
      
      // Look at the planet
      cameraTargetRef.current.set(targetPlanet.distance, 0, 0);
      camera.lookAt(cameraTargetRef.current);
    } else {
      // Default view - look at the center of the solar system
      cameraTargetRef.current.lerp(new THREE.Vector3(0, 0, 0), 0.05);
      camera.lookAt(cameraTargetRef.current);
    }
  });
  
  return null;
};

// Main solar system scene
const SolarSystemScene = ({ onPlanetSelect, selectedPlanet, useRealTimeAlignment }) => {
  const xr = useXR();
  
  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.7} />
      <pointLight position={[0, 0, 0]} intensity={2.5} />
      
      {/* Starfield */}
      <Starfield />
      
      {/* Planets and orbits */}
      {planetData.map((planet) => (
        <group key={planet.key}>
          <Orbit radius={planet.distance} />
          <Planet 
            data={planet} 
            isSelected={selectedPlanet?.key === planet.key}
            onSelect={onPlanetSelect}
            useRealTimeAlignment={useRealTimeAlignment}
          />
        </group>
      ))}
      
      {/* VR Controllers */}
      {xr.isPresenting && (
        <>
          <Controllers />
          <Hands />
        </>
      )}
      
      {/* Camera controller */}
      <VRCameraController targetPlanet={selectedPlanet} />
    </>
  );
};

// VR Entry Button
const VREntryButton = ({ onEnterVR }) => {
  return (
    <button 
      onClick={onEnterVR}
      style={{
        position: 'absolute',
        bottom: '20px',
        right: '20px',
        padding: '12px 24px',
        backgroundColor: '#64FFDA',
        color: '#0D1117',
        border: 'none',
        borderRadius: '25px',
        fontSize: '16px',
        fontWeight: 'bold',
        cursor: 'pointer',
        zIndex: 1000,
        boxShadow: '0 4px 15px rgba(100, 255, 218, 0.3)'
      }}
    >
      Enter VR Mode
    </button>
  );
};

// Planet Info Panel
const PlanetInfoPanel = ({ planet, onClose }) => {
  if (!planet) return null;
  
  return (
    <div style={{
      position: 'absolute',
      top: '20px',
      left: '20px',
      width: '300px',
      maxHeight: '80vh',
      backgroundColor: 'rgba(13, 17, 23, 0.8)',
      borderRadius: '15px',
      padding: '20px',
      backdropFilter: 'blur(12px)',
      border: '1px solid rgba(100, 255, 218, 0.2)',
      color: '#E6F1FF',
      overflowY: 'auto',
      zIndex: 1000
    }}>
      <button 
        onClick={onClose}
        style={{
          position: 'absolute',
          top: '15px',
          right: '15px',
          background: 'none',
          border: 'none',
          color: '#E6F1FF',
          fontSize: '24px',
          cursor: 'pointer'
        }}
      >
        ×
      </button>
      <h2 style={{ color: '#64FFDA', marginTop: 0 }}>{planet.name}</h2>
      <div dangerouslySetInnerHTML={{ __html: planet.info || '' }} />
      <button 
        onClick={() => window.location.href = `/quiz?planet=${planet.key}`}
        style={{
          marginTop: '15px',
          padding: '10px 20px',
          backgroundColor: 'transparent',
          color: '#E6F1FF',
          border: '2px solid #64FFDA',
          borderRadius: '20px',
          cursor: 'pointer',
          width: '100%'
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

export default VRSolarSystem;