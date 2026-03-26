const fs = require('fs');
const path = require('path');

const glbPath = path.join(__dirname, 'models/saturn.glb');
if (fs.existsSync(glbPath)) {
    const buffer = fs.readFileSync(glbPath);
    let jsonLength = buffer.readUInt32LE(12);
    let jsonString = buffer.toString('utf8', 20, 20 + jsonLength);
    
    try {
        const gltf = JSON.parse(jsonString);
        console.log("Meshes:");
        console.dir(gltf.meshes, {depth: null});
        console.log("Materials:");
        console.dir(gltf.materials, {depth: null});
        console.log("Nodes:");
        console.dir(gltf.nodes, {depth: null});
    } catch(e) {
        console.error("Parse error:", e);
    }
} else {
    console.log("File not found:", glbPath);
}
