// Compatibility fix for Node.js 25 and later.
//
// Node 25 removed buffer.SlowBuffer. jsonwebtoken depends (via jws -> jwa) on
// buffer-equal-constant-time, which reads SlowBuffer.prototype as soon as it is
// loaded, so the server crashed on startup. No newer version of that chain
// fixes it yet, so we put back an alias before anything loads jsonwebtoken.
//
// This must be required before any other module in server.js.
// Safe to delete once jsonwebtoken no longer pulls in buffer-equal-constant-time.
const buffer = require("buffer");

if (!buffer.SlowBuffer) {
  buffer.SlowBuffer = buffer.Buffer;
}
