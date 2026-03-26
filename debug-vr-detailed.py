import requests
import re

def debug_vr_page():
    print("🔍 Detailed VR Page Debugging")
    print("=" * 50)
    
    # Get the VR page content
    response = requests.get('http://localhost:5001/vr-solar-system.html', timeout=10)
    content = response.text
    
    print(f"Page Size: {len(content)} characters")
    print(f"Status Code: {response.status_code}")
    
    # Check for required elements
    print("\n📋 Checking Required Elements:")
    
    # Check for container
    if 'id="vr-container"' in content:
        print("✅ VR Container found")
    else:
        print("❌ VR Container missing")
    
    # Check for required scripts
    required_scripts = [
        "react@18/umd/react.development.js",
        "react-dom@18/umd/react-dom.development.js",
        "@babel/standalone/babel.min.js",
        "/src/VRSolarSystem.jsx"
    ]
    
    for script in required_scripts:
        if script in content:
            print(f"✅ {script} found")
        else:
            print(f"❌ {script} missing")
    
    # Check for React rendering code
    if "ReactDOM.createRoot" in content and "root.render" in content:
        print("✅ React rendering code found")
    else:
        print("❌ React rendering code missing")
    
    # Check for Babel script type
    if 'type="text/babel"' in content:
        print("✅ Babel script type found")
    else:
        print("❌ Babel script type missing")
    
    # Look for potential issues
    print("\n🔍 Looking for Potential Issues:")
    
    # Check if scripts are loaded in correct order
    script_matches = list(re.finditer(r'<script[^>]*src=["\']([^"\']*)["\'][^>]*>', content))
    script_srcs = [match.group(1) for match in script_matches]
    
    print("Script loading order:")
    for i, src in enumerate(script_srcs):
        print(f"  {i+1}. {src}")
    
    # Check if there are any obvious errors in the JSX component
    jsx_response = requests.get('http://localhost:5001/src/VRSolarSystem.jsx', timeout=10)
    jsx_content = jsx_response.text
    
    print(f"\n📄 VRSolarSystem.jsx Analysis:")
    print(f"File Size: {len(jsx_content)} characters")
    
    # Check for required imports
    required_imports = [
        "react",
        "@react-three/fiber",
        "@react-three/xr",
        "three"
    ]
    
    for imp in required_imports:
        if imp in jsx_content:
            print(f"✅ Import '{imp}' found")
        else:
            print(f"❌ Import '{imp}' missing")
    
    # Check for main component export
    if "export default VRSolarSystem" in jsx_content:
        print("✅ VRSolarSystem component export found")
    else:
        print("❌ VRSolarSystem component export missing")
    
    # Check for Canvas component usage
    if "<Canvas" in jsx_content:
        print("✅ Canvas component usage found")
    else:
        print("❌ Canvas component usage missing")
    
    print("\n" + "=" * 50)
    print("💡 Common causes for empty VR page:")
    print("   1. JavaScript errors preventing rendering")
    print("   2. Missing or incorrectly ordered dependencies")
    print("   3. CORS issues with external libraries")
    print("   4. Incorrect React component mounting")
    print("   5. Three.js WebGL context issues")

if __name__ == "__main__":
    debug_vr_page()