#!/usr/bin/env node
// -*- fill-column: 90; eval: (display-fill-column-indicator-mode 1); -*-
// =======================================================================================
import * as http from 'http';

function post_prompt(prompt) {

  const data = JSON.stringify({
    prompt: prompt,
    steps: 5,
    seed: Math.floor(Math.random() * (2 ** 32)),
  });

  const options = {
    hostname: '127.0.0.1',
    port: 7860,
    path: '/sdapi/v1/txt2img',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  };

  const req = http.request(options);

  req.on('socket', (socket) => {
    socket.on('connect', () => {
      req.write(data);
      req.end();
      socket.destroy(); 
    });
  });

  req.on('error', (error) => {
    if (error.message !== 'socket hang up')
      console.error(`ERROR: ${error}`);
  });
}

post_prompt("a frog in a bog");
