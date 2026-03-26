import requests

# First, let's try to access the VR page without authentication
print("Testing VR page without authentication...")
try:
    response = requests.get('http://localhost:5001/vr-solar-system', timeout=5, allow_redirects=False)
    print(f"Status Code: {response.status_code}")
    print(f"Location Header: {response.headers.get('location', 'None')}")
    
    if response.status_code == 302:
        print("✅ Redirected (expected for unauthenticated access)")
        redirect_url = response.headers.get('location', '')
        if redirect_url == '/':
            print("✅ Redirected to home page (correct behavior)")
        else:
            print(f"⚠️  Redirected to unexpected location: {redirect_url}")
    elif response.status_code == 200:
        if "VR Solar System Explorer" in response.text:
            print("✅ VR page served directly")
        else:
            print("❌ Home page served instead of VR page")
    else:
        print(f"⚠️  Unexpected status code: {response.status_code}")
        
except Exception as e:
    print(f"❌ Error: {e}")

# Let's also test the direct file access
print("\nTesting direct access to VR file...")
try:
    response = requests.get('http://localhost:5001/vr-solar-system.html', timeout=5)
    print(f"Status Code: {response.status_code}")
    if response.status_code == 200:
        if "VR Solar System Explorer" in response.text:
            print("✅ Direct VR file access works")
        else:
            print("❌ Direct VR file access returns wrong content")
    else:
        print(f"⚠️  Direct VR file access failed with status {response.status_code}")
except Exception as e:
    print(f"❌ Error accessing direct VR file: {e}")