#!/usr/bin/env node
// -*- fill-column: 90; eval: (display-fill-column-indicator-mode 1); -*-
// =======================================================================================
import * as util from 'util';
import * as http from 'http';
import * as fs   from 'fs/promises';
import { stdin as input, stdout as output } from 'process';
import * as readline from 'readline';

// ---------------------------------------------------------------------------------------
// helper functions:
// ---------------------------------------------------------------------------------------
function post_prompt(prompt, hostname = '127.0.0.1', port = 7860) {
  console.log("POSTing!");
  
  const data = JSON.stringify({
    prompt: prompt,
    // steps: 8,
    seed: Math.floor(Math.random() * (2 ** 32)),
  });

  const options = {
    hostname: hostname,
    port: port,
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
      socket.destroy(); // don't wait for the response.
    });
  });

  req.on('error', (error) => {
    if (error.message !== 'socket hang up')
      console.error(`ERROR: ${error}`);
  });
}
// ---------------------------------------------------------------------------------------
function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
// ---------------------------------------------------------------------------------------


// =======================================================================================
// set inspect_fun appropriately for node.js:
// =======================================================================================
let inspect_fun = util.inspect;
// ----------------------------------------------------------------------------------------


// =======================================================================================
// MAIN:
// =======================================================================================
async function main() {
  // ---------------------------------------------------------------------------------------
  // process the command-line arguments:
  // ---------------------------------------------------------------------------------------
  const args    = process.argv.slice(2);
  let   count   = 1;
  let   post    = false;
  let   confirm = false;
  let   from_stdin = false;

  if (args.length == 0) {
    throw new Error("Usage: ./wildcards-plus-tool.js [--post|--confirm] (--stdin | <input-file>) [<count>]");
  }

  if (["-p", "--post"].includes(args[0])) {
    post = true;
    args.shift();
  }
  else if (["-c", "--confirm"].includes(args[0])) {
    post    = true;
    confirm = true;
    args.shift();
  }

  if (args.length === 0) {
    throw new Error("Error: Must provide --stdin or an input file.");
  }

  if (args[0] === '--stdin') {
    if (confirm)
      throw new Error(`the --confirm and --stdin options are incompatible.`);
    
    from_stdin = true;
  }

  if (args.length > 1) {
    count = parseInt(args[1]);
  }

  // ---------------------------------------------------------------------------------------
  // read prompt input:
  // ---------------------------------------------------------------------------------------
  let prompt_input = '';

  if (from_stdin) {
    // Read all stdin into a string
    prompt_input = await new Promise((resolve, reject) => {
      let data = '';
      input.setEncoding('utf8');
      input.on('data', chunk => data += chunk);
      input.on('end', () => resolve(data));
      input.on('error', err => reject(err));
    });
  } else {
    if (args.length === 0) {
      throw new Error("Error: No input file provided.");
    }

    prompt_input = await fs.readFile(args[0], 'utf8');
  }

  // ---------------------------------------------------------------------------------------
  // parse the input and expand:
  // ---------------------------------------------------------------------------------------
  console.log('--------------------------------------------------------------------------------');
  console.log(`Expansion${count > 1 ? "s" : ''}:`);

  let posted_count    = 0;
  let prior_expansion = null;
  
  while (posted_count < count) {
    console.log('--------------------------------------------------------------------------------');
    // console.log(`posted_count = ${posted_count}`);

    const context  = load_prelude();
    const expanded = expand_wildcards(result.value, context);
    
    console.log(expanded);

    if (!post) {
      posted_count += 1; // a lie to make the counter correct.
    }
    else {
      if (!confirm) {
        post_prompt(expanded);
        posted_count += 1;
      }
      else  {
        console.log();

        const question = `POST this prompt as #${posted_count+1} out of ${count} (enter /y.*/ for ye, positive integer for multiple images, or /p.*/ to POST the prior prompt)? `;
        const answer = await ask(question);

        if (! (answer.match(/^[yp].*/i) || answer.match(/^\d+/i))) 
          continue;

        if (answer.match(/^p.*/i)) {
          if (prior_expansion) { 
            console.log(`POSTing prior prompt '${expanded}'`);
            post_prompt(prior_expansion);
          }
          else {
            console.log(`can't rewind, no prior prompt`);
          }
        }
        else {          
          const parsed    = parseInt(answer);
          const gen_count = isNaN(parsed) ? 1 : parsed;  
          
          // console.log(`parsed = '${parsed}', count = '${count}'`);
          
          for (let iix = 0; iix < gen_count; iix++) {
            post_prompt(expanded);
            posted_count += 1;
          }
        }
      }
    }

    prior_expansion = expanded;
  }

  console.log('--------------------------------------------------------------------------------');
}

// ---------------------------------------------------------------------------------------
main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
