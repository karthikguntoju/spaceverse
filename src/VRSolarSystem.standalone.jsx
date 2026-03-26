// VR Solar System Component - Standalone Version
// This version includes minimal dependencies and avoids external library issues

// Simple implementation without external dependencies
const VRSolarSystem = () => {
  return (
    <div style={{ 
      width: '100vw', 
      height: '100vh', 
      position: 'relative',
      backgroundColor: '#0D1117',
      color: '#E6F1FF',
      fontFamily: 'Inter, sans-serif'
    }}>
      <div style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        textAlign: 'center'
      }}>
        <h1>VR Solar System</h1>
        <p>Standalone version - no external dependencies</p>
        <div style={{ marginTop: '20px' }}>
          <button 
            onClick={() => alert('VR functionality would be implemented here')}
            style={{
              padding: '12px 24px',
              backgroundColor: 'rgba(100, 255, 218, 0.2)',
              color: '#E6F1FF',
              border: '2px solid #64FFDA',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '16px'
            }}
          >
            👓 Enter VR Mode
          </button>
        </div>
      </div>
      
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
    </div>
  );
};

// Make it globally available
window.VRSolarSystem = VRSolarSystem;

export default VRSolarSystem;