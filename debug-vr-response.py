import requests

# Test what's actually being served
response = requests.get('http://localhost:5001/vr-solar-system', timeout=5)
print(f"Status Code: {response.status_code}")
print(f"Content Length: {len(response.text)} characters")
print(f"Content Type: {response.headers.get('content-type', 'Unknown')}")

# Print first 500 characters to see what we're getting
print("\nFirst 500 characters of response:")
print(response.text[:500])

# Check if it's the VR page
if "VR Solar System Explorer" in response.text:
    print("\n✅ This appears to be the correct VR page")
elif "Spaceverse - Explore the Solar System" in response.text:
    print("\n❌ This appears to be the home page, not the VR page")
else:
    print("\n❓ This is neither the VR page nor the home page")