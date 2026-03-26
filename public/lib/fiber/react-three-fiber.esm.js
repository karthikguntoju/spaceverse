// Minimal local ESM stub for @react-three/fiber to allow offline/headless tests
export default {
  _localStub: true,
  name: 'react-three-fiber-stub',
  createRoot: (container) => ({ render: (comp) => { /* stub render */ } })
};

export function useFrame() { /* noop */ }
export function useThree() { return { scene: {}, camera: {} }; }
