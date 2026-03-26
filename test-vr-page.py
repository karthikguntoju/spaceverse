import requests
import time

try:
    print("Testing VR Solar System page...")
    response = requests.get('http://localhost:5001/vr-solar-system', timeout=5)
    print(f"Status Code: {response.status_code}")
    print(f"Response length: {len(response.text)} characters")
    if response.status_code == 200:
        print("✅ VR Page is accessible!")
        if "VR Solar System Explorer" in response.text:
            print("✅ VR Page content looks correct!")
        else:
            print("⚠️  VR Page content might be incorrect")
    else:
        print(f"❌ VR Page returned status code {response.status_code}")
except Exception as e:
    print(f"❌ Error connecting to VR Page: {e}")
    print("Please make sure the server is running on port 5004")