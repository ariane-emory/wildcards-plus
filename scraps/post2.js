#!/usr/bin/env node
// -*- fill-column: 90; eval: (display-fill-column-indicator-mode 1); -*-
// =======================================================================================
import * as http from 'http';

const random_seed = () => Math.floor(Math.random() * (2 ** 32));

const data = JSON.stringify({
  prompt: "a chupacabra",
  steps: 5,
  seed: random_seed(),
});

const options = {
  hostname: '127.0.0.1',
  port: 7860,
  path: '/sdapi/v1/txt2img',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = http.request(options);

// Only attach an error handler (important!)
req.on('error', (error) => {
  if (error.message !== 'socket hang up') {
    console.error(`ERROR: ${error}`);
  }
});

req.on('socket', (socket) => {
  socket.on('connect', () => {
    req.end();       // finish sending the request
    socket.destroy(); // immediately destroy the connection
    console.log("Request sent and socket destroyed.");
  });
});


// Send the body and immediately end the request
req.write(data);
req.end();

// Don't set any 'response' handlers!
console.log("Request sent! Not waiting for a response.");
