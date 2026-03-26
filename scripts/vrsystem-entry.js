import VRSolarSystem from '../src/VRSolarSystem.browser.jsx';
// Expose as a global for pages that expect `VRSolarSystem` to be available on window
if (typeof window !== 'undefined') {
  window.VRSolarSystem = VRSolarSystem;
}
export default VRSolarSystem;
