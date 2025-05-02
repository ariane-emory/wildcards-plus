#!/usr/bin/env node
// -*- fill-column: 90; eval: (display-fill-column-indicator-mode 1); -*-
// =======================================================================================
// This file is NOT the Draw Things script: that's over in wildcards-plus.js.
//
// This script is a tool that you can use at the command line (you'll need to have Node.js
// installed) to test out wildcards-plus prompts that you're working on to see how they'll
// be expanded by wildcards-plus.
//
// The script takes a file name as its first argument, and an optional second argument
// specifying how many expansions you'd like to see.
//
// Usage: ./wildcards-plus-tool.js <input-file> [<count>]
//
// Example of usage:
// $ ./wildcards-plus-tester.js ./sample-prompts/fantasy-character.txt 3
// --------------------------------------------------------------------------------
// Expansions:
// --------------------------------------------------------------------------------
// dark fantasy, masterpiece, ultra high resolution, 8k, detailed background, wide shot, 
// An oil painting for the cover of a fantasy novel published in the 1990s, in the style of the artist Brom, which depicts a seductive, ominous and antediluvian cultist on a starlit night, cradling her jewel-encrusted spell book while standing in a crumbling church, glowering up at the viewer pridefully while commanding a coterie of demonic swarming slaves.
//
// dark fantasy, masterpiece, ultra high resolution, 8k, detailed background, wide shot, 
// An oil painting for the cover of a fantasy novel published in the 1980s, in the style of Yoshiaki Kawajiri, depicting an athletic, handsome and charming cataphract while laying on his throne in a shadowy arcane library and inviting past the viewer.
//
// epic fantasy, masterpiece, ultra high resolution, 8k, detailed background, wide shot, 
// A promotional poster for an award winning video game, which depicts a heroic, strong and athletic paladin wearing blood-smeared wargear holding his bejeweled flail while standing in an eerily lit lair, smiling towards the viewer victoriously.
// --------------------------------------------------------------------------------
//
// =======================================================================================
import * as util from 'util';
import * as http from 'http';
import * as fs   from 'fs';
import * as readline from 'readline';
import path from 'path';
import { stdin as input, stdout as output } from 'process';

// import * as readline from 'readline';
// ---------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------
// helper functions:
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
function parse_file(filename) {
  const prompt_input = fs.readFileSync(filename, 'utf8');
  const result = Prompt.match(prompt_input);
  return result;
}
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
function process_includes(thing, context = new Context()) {
  function walk(thing, context) {
    if (thing instanceof ASTSpecialFunction && thing.directive == 'include') {
      const current_file = context.files[context.files.length - 1];
      const res = [];

      context = context.shallow_copy();
      
      for (let filename of thing.args) {
        filename = path.join(path.dirname(current_file), filename);
        
        if (context.files.includes(filename)) {
          console.log(`WARNING: skipping duplicate include of '${filename}'.`);
          continue;
        }

        context.files.push(filename);

        const parse_file_result = parse_file(filename);

        if (! parse_file_result.is_finished)
          throw new Error(`error parsing ${filename}! ${inspect_fun(parse_file_result)}`);
        
        res.push(walk(parse_file_result.value, context));
      }

      return res;
    }
    else if (Array.isArray(thing)) {
      const ret = [];

      for (const t of thing)
        ret.push(walk(t, context));

      return ret;
    }
    else {
      return thing;
    }
  }

  return walk(thing, context).flat(Infinity);
}
// ---------------------------------------------------------------------------------------


// =======================================================================================
// set inspect_fun appropriately fore nod.js:
// =======================================================================================
let inspect_fun = util.inspect;
let dt_hosted   = false;
// ----------------------------------------------------------------------------------------

if (false)
  // =====================================================================================
  // DEV NOTE: Copy into wildcards-plus.js starting from this line onwards!
  // =====================================================================================
{
  inspect_fun = JSON.stringify;
  dt_hosted = true;
}
// ---------------------------------------------------------------------------------------


// =======================================================================================
// GRAMMAR.JS CONTENT:
// =======================================================================================
// Code in this section copy/pasted from the grammar.js file in my 'jparse'
// project circa ac2979f.
// 
// Not all of this section is actually used by the wildcards-plus script right 
// now, but it's easier to just copy/paste in the whole file than it is to
// bother working out which parts can be removed and snipping them out, and who
// knows, maybe I'll use more of it in the future.
// 
// Original project at: https://github.com/ariane-emory/jparse/
// =======================================================================================
//            
// (Rule) -| The core/basic Rules:
//         |
//         |-- Choice
//         |-- Enclosed ------- CuttingEnclosed
//         |-- NeverMatch
//         |-- Optional
//         |-- Sequence ------- CuttingSequence
//         |-- Xform
//         |
//         | Rules triggering failure:
//         |-- Expect
//         |-- Unexpected
//         |-- Fail
//         |
//         |-- (Quantified) -|-- Plus
//         |                 |-- Star
//         |
//         | Technically these next 3 could be implemented as Xforms, but 
//         | they're very convenient to have built-in (and are possibly faster
//         | this way than equivalent Xforms, at least for the for simpler use
//         | cases):
//         |
//         |-- Discard
//         |-- Elem
//         |-- Label
//         |
//         | Rules that make sense only when input is an Array of Tokens:
//         |
//         |-- TokenLabel
//         |
//         | Rules that make sense only when input is a string:
//         |
//         |-- Literal
//         |-- Regex
//         |
// ForwardReference (only needed when calling xform with a weird arg order)
// LabeledValue
// MatchResult
//
// ---------------------------------------------------------------------------------------
// variables:
// ---------------------------------------------------------------------------------------
let string_input_mode_enabled = true;
let log_enabled               = true;
let log_finalize_enabled      = false;
let log_match_enabled         = false;
let disable_prelude           = false; 
// ---------------------------------------------------------------------------------------
const DISCARD = Symbol('DISCARD');
// ---------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------
// trailing_separator_modes 'enum':
// ---------------------------------------------------------------------------------------
const trailing_separator_modes = Object.freeze({
  allowed:   'allowed',
  required:  'required',
  forbidden: 'forbidden'
});
// ---------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------
// Rule class
// ---------------------------------------------------------------------------------------
class Rule {
  // -------------------------------------------------------------------------------------
  match(input, index = 0, indent = 0) {
    if (log_match_enabled) {
      if (index_is_at_end_of_input(index, input))
        log(indent,
            `Matching ${this.constructor.name} ${this.toString()}, ` +
            `but at end of token stream!`);
      else 
        log(indent,
            `Matching ${this.constructor.name} ${this.toString()} at ` +
            `char ${string_input_mode_enabled ? index : input[index]?.start}, ` +
            `token #${index}: ` +
            `${input[index].toString().replace("\n", " ")}...`);
    }

    const ret = this.__match(indent, input, index);

    if (ret && ret?.value === undefined) {
      throw new Error(`got undefined from ${inspect_fun(this)}: ${inspect_fun(ret)}, ` +
                      `this is likely a programmer error`);
    }
    
    // if (ret && ret?.value === null) {
    //   throw new Error(`got null from ${inspect_fun(this)}: ${inspect_fun(ret)}, ` +
    //                   `this is likely a programmer error`);
    // }
    
    if (log_match_enabled) {
      if (ret)
        log(indent,
            `<= ${this.constructor.name} ${this.toString()} returned: ` +
            `${JSON.stringify(ret)}`);
      else
        log(indent,
            `<= Matching ${this.constructor.name} ` +
            `${this.toString()} returned null.`);
    }

    return ret;
  }
  // -------------------------------------------------------------------------------------
  __match(indent, input, index) {
    throw new Error(`__match is not implemented by ${this.constructor.name}`);
  }
  // -------------------------------------------------------------------------------------
  finalize(indent = 0) {
    this.__finalize(indent, new Set());
  }
  // -------------------------------------------------------------------------------------
  __finalize(indent, visited) {
    if (visited.has(this)) {
      if (log_finalize_enabled)
        log(indent, `skipping ${this}.`);

      return;
    }

    visited.add(this);

    if (log_finalize_enabled)
      log(indent, `finalizing ${this}...`);

    this.__impl_finalize(indent, visited);
  }
  // -------------------------------------------------------------------------------------
  __impl_finalize(indent, visited) {
    throw new Error(`__impl_finalize is not implemented by ` +
                    `${this.constructor.name}`);    
  }
  // -------------------------------------------------------------------------------------
  toString() {
    return this.__toString(new Map(), { value: 0 }).replace('() => ', '');
  }
  // -------------------------------------------------------------------------------------
  __toString(visited, next_id) {
    if (visited.has(this))
      return `#${visited.get(this)}`;

    next_id.value += 1;
    visited.set(this, next_id.value);
    
    return this.__impl_toString(visited, next_id).replace('() => ', '');
  }
  // -------------------------------------------------------------------------------------
  __impl_toString(visited, next_id) {
    throw new Error(`__impl_toString is not implemented by ` +
                    `${this.constructor.name}`);
  }
  // -------------------------------------------------------------------------------------
  __vivify(thing) {
    if (thing instanceof ForwardReference)
      thing = thing.func;
    
    if (typeof thing === 'function') 
      thing = thing();
    
    return thing;
  }
}
// ---------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------
// Quantified class
// ---------------------------------------------------------------------------------------
class Quantified extends Rule {
  // -------------------------------------------------------------------------------------
  constructor(rule, separator_rule = null,
              trailing_separator_mode = trailing_separator_modes.forbidden) {
    super();
    this.rule                    = make_rule_func(rule);
    this.separator_rule          = make_rule_func(separator_rule);
    this.trailing_separator_mode = trailing_separator_mode;
  }
  // -------------------------------------------------------------------------------------
  __impl_finalize(indent, visited) {
    this.rule            = this.__vivify(this.rule);
    this.separator_rule  = this.__vivify(this.separator_rule);
    this.rule           .__finalize(indent + 1, visited);
    this.separator_rule?.__finalize(indent + 1, visited);
  }
  // -------------------------------------------------------------------------------------
  __quantified_match(indent, input, index) {
    const values        = [];
    let prev_index      = null;
    const rewind_index  = ()   => index = prev_index;
    const update_index  = (ix) => {
      prev_index = index;
      index      = ix;
    };

    indent += 1;

    let match_result = this.rule.match(
      input, index, indent + 1);

    if (match_result === undefined)
      throw new Error("left");
    
    if (match_result === false)
      throw new Error("right");
    
    if (match_result === null)
      return new MatchResult([], input, index);

    // if (match_result.value === '' || match_result.value)
    if (match_result.value !== DISCARD)
      values.push(match_result.value);
    
    update_index(match_result.index);

    while (true) {
      if (this.separator_rule) {
        if (log_match_enabled)
          log(indent,
              `Matching separator rule ${this.separator_rule}...`);
        
        const separator_match_result =
              this.separator_rule.match(
                input, index, indent + 1);

        if (! separator_match_result) {
          // required mode stuff:
          if (this.trailing_separator_mode ==
              trailing_separator_modes.required) {
            rewind_index();
            values.pop();
          }

          if (log_match_enabled)
            log(indent,
                `did NOT Match separator rule ${this.separator_rule}...`);
          
          break;
        }

        if (log_match_enabled)
          log(indent,
              `matched separator rule ${this.separator_rule}...`);

        update_index(separator_match_result.index);
      } // end of if (this.separator_rule)

      match_result = this.rule.match(
        input, index, indent + 1);

      if (! match_result) {
        if (this.separator_rule) {
          // forbidden mode stuff:
          if (this.trailing_separator_mode ==
              trailing_separator_modes.forbidden) {
            rewind_index();
          }
        }

        break;
      }

      if (match_result.value !== DISCARD)
        values.push(match_result.value);
      
      update_index(match_result.index);
    }; // end while

    return new MatchResult(values, input, index);
  }
}
// ---------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------
// Plus class
// ---------------------------------------------------------------------------------------
class Plus extends Quantified {
  // -------------------------------------------------------------------------------------
  __match(indent, input, index) {
    const __quantified_match_result =
          this.__quantified_match(indent, input, index);

    return __quantified_match_result?.value.length == 0
      ? null
      : __quantified_match_result;
  }
  // -------------------------------------------------------------------------------------
  __impl_toString(visited, next_id) {
    return `${this.__vivify(this.rule).__toString(visited, next_id)}+`;
  }
}
// ---------------------------------------------------------------------------------------
function plus(rule, // convenience constructor
              separator_value = null,
              trailing_separator_mode =
              trailing_separator_modes.forbidden) {
  return new Plus(rule, separator_value, trailing_separator_mode);
}
// ---------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------
// Star class
// ---------------------------------------------------------------------------------------
class Star extends Quantified {
  // -------------------------------------------------------------------------------------
  __match(indent, input, index) {
    return this.__quantified_match(indent, input, index);
  }
  // -------------------------------------------------------------------------------------
  __impl_toString(visited, next_id) {
    return `${this.__vivify(this.rule).__toString(visited, next_id)}*`;
  }
}
// ---------------------------------------------------------------------------------------
function // convenience constructor
star(value,
     separator_value = null,
     trailing_separator_mode = trailing_separator_modes.forbidden) {
  return new Star(value, separator_value, trailing_separator_mode);
}
// ---------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------
// Choice class
// ---------------------------------------------------------------------------------------
class Choice extends Rule  {
  // -------------------------------------------------------------------------------------
  constructor(...options) {
    super();
    this.options = options.map(make_rule_func);
  }
  // -------------------------------------------------------------------------------------
  __impl_finalize(indent, visited) {
    for (let ix = 0; ix < this.options.length; ix++) {
      this.options[ix] = this.__vivify(this.options[ix]);
      this.options[ix].__finalize(indent + 1, visited);
    }
  }
  // -------------------------------------------------------------------------------------
  __match(indent, input, index) {
    let ix = 0;
    
    for (const option of this.options) {
      ix += 1;
      
      if (log_match_enabled)
        log(indent + 1, `Try option #${ix}: ${option}`);
      
      const match_result = option.match(
        input, index, indent + 2);

      if (match_result) {
        if (log_match_enabled)
          log(indent + 1, `Chose option #${ix}!`);
        
        return match_result;
      }

      if (log_match_enabled)
        log(indent + 1, `Rejected option #${ix}.`);

    }

    return null;
  }
  // -------------------------------------------------------------------------------------
  __impl_toString(visited, next_id) {
    return `{ ${this.options
                .map(x =>
                       this.__vivify(x)
                       .__toString(visited, next_id)).join(" | ")} }`;
  }
}
// ---------------------------------------------------------------------------------------
function choice(...options) { // convenience constructor
  if (options.length == 1) {
    console.log("WARNING: unnecessary use of choice!");
    
    return make_rule_func(options[0]);
  }
  
  return new Choice(...options)
}
// ---------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------
// Discard class
// ---------------------------------------------------------------------------------------
class Discard extends Rule {
  // -------------------------------------------------------------------------------------
  constructor(rule) {
    super();
    this.rule = make_rule_func(rule);
  }
  // -------------------------------------------------------------------------------------
  __impl_finalize(indent, visited) {
    this.rule = this.__vivify(this.rule);    
    this.rule?.__finalize(indent + 1, visited);
  }
  // -------------------------------------------------------------------------------------
  __match(indent, input, index) {
    if (! this.rule)
      return new MatchResult(null, input, index);
    
    const match_result = this.rule.match(
      input,
      index,
      indent + 1);

    if (! match_result)
      return null;

    const mr = new MatchResult(DISCARD, input, match_result.index);

    // console.log(`MR: ${inspect_fun(mr)}`);
    
    return mr;
  } 
  // -------------------------------------------------------------------------------------
  __impl_toString(visited, next_id) {
    return `-${this.__vivify(this.rule).__toString(visited, next_id)}`;
  }
}
// ---------------------------------------------------------------------------------------
function discard(rule) { // convenience constructor
  return new Discard(rule)
}
// ---------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------
// Element class
// ---------------------------------------------------------------------------------------
class Element extends Rule {
  // -------------------------------------------------------------------------------------
  constructor(index, rule) {
    super();
    this.index = index;
    this.rule  = make_rule_func(rule);
  }
  // -------------------------------------------------------------------------------------
  __impl_finalize(indent, visited) {
    this.rule = this.__vivify(this.rule);
    this.rule.__finalize(indent + 1, visited);
  }
  // -------------------------------------------------------------------------------------
  __match(indent, input, index) {
    const rule_match_result = this.rule.match(input, index, indent + 1);

    if (! rule_match_result)
      return null;

    if (log_match_enabled) {
      log(indent, `taking elem ${this.index} from ` +
          `${JSON.stringify(rule_match_result)}'s value.`);
    }

    if (log_match_enabled)
      log(indent, `GET ELEM ${this.index} FROM ${inspect_fun(rule_match_result)}`);
    
    rule_match_result.value = rule_match_result.value[this.index] ?? DISCARD;
    
    return rule_match_result
  }
  // -------------------------------------------------------------------------------------
  __impl_toString(visited, next_id) {
    return `${this.__vivify(this.rule)?.__toString(visited,
                                                   next_id)}[${this.index}]`;
  }
}
// ---------------------------------------------------------------------------------------
function elem(index, rule) { // convenience constructor
  return new Element(index, rule)
}
// ---------------------------------------------------------------------------------------
function first(rule) {
  return new Element(0, rule)
}
// ---------------------------------------------------------------------------------------
function second(rule) {
  return new Element(1, rule)
}
// ---------------------------------------------------------------------------------------
function third(rule) {
  return new Element(2, rule)
}
// ---------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------
// Enclosed class
// ---------------------------------------------------------------------------------------
class Enclosed extends Rule {
  // i-------------------------------------------------------------------------------------
  constructor(start_rule, body_rule, end_rule) {
    super();

    if (! end_rule) {
      // if two args are supplied, they're (body_rule, enclosing_rule):
      end_rule   = body_rule;
      body_rule  = start_rule;
      start_rule = end_rule;
    }
    
    this.start_rule = make_rule_func(start_rule);
    this.body_rule  = make_rule_func(body_rule); 
    this.end_rule   = make_rule_func(end_rule);  
    
    if (! this.end_rule)
      this.end_rule = this.start_rule;
  }
  // -------------------------------------------------------------------------------------
  __fail_or_throw_error(start_rule_result, failed_rule_result,
                        input, index) {
    return null;
  }
  // -------------------------------------------------------------------------------------
  __impl_finalize(indent, visited) {
    this.start_rule = this.__vivify(this.start_rule);
    this.body_rule  = this.__vivify(this.body_rule);
    this.end_rule   = this.__vivify(this.end_rule);
    this.start_rule.__finalize(indent + 1, visited);
    this.body_rule.__finalize(indent + 1, visited);
    this.end_rule.__finalize(indent + 1, visited);
  }
  // -------------------------------------------------------------------------------------
  __match(indent, input, index) {
    const start_rule_match_result =
          this.start_rule.match(
            input, index, indent + 1);

    if (! start_rule_match_result)
      return null;

    const body_rule_match_result =
          this.body_rule.match(
            input,
            start_rule_match_result.index, indent + 1);

    if (! body_rule_match_result)
      return this.__fail_or_throw_error(start_rule_match_result,
                                        body_rule_match_result,
                                        input,
                                        start_rule_match_result.index);

    const end_rule_match_result =
          this.end_rule.match(
            input,
            body_rule_match_result.index, indent + 1);

    if (! end_rule_match_result)
      return this.__fail_or_throw_error(start_rule_match_result,
                                        body_rule_match_result,
                                        input,
                                        body_rule_match_result.index);

    return new MatchResult(body_rule_match_result.value,
                           input,
                           end_rule_match_result.index);
  }
  // -------------------------------------------------------------------------------------
  __impl_toString(visited, next_id) {
    return `[${this.__vivify(this.start_rule).__toString(visited, next_id)} ` +
      `${this.__vivify(this.body_rule).__toString(visited, next_id)} ` +
      `${this.__vivify(this.end_rule).__toString(visited, next_id)}]`;
  }
}
// ---------------------------------------------------------------------------------------
function enc(start_rule, body_rule, end_rule) { // convenience constructor
  return new Enclosed(start_rule, body_rule, end_rule);
}
// ---------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------
// CuttingEnclosed class
// ---------------------------------------------------------------------------------------
class CuttingEnclosed extends Enclosed {
  // -------------------------------------------------------------------------------------
  constructor(start_rule, body_rule, end_rule) {
    super(start_rule, body_rule, end_rule);
  }
  // -------------------------------------------------------------------------------------
  __fail_or_throw_error(start_rule_result, failed_rule_result,
                        input, index) {
    if (string_input_mode_enabled) {
      throw new Error(`expected (${this.body_rule} ${this.end_rule}) ` +
                      `after ${this.start_rule} at ` +
                      `char ${index}` +
                      `, found: ` +
                      `"${input.substring(start_rule_result.index)}"`);
    }
    else {
      throw new Error(`expected (${this.body_rule} ${this.end_rule}) ` +
                      `after ${this.start_rule} at ` +
                      `char ${input[start_rule_result.index].start}` +
                      `, found: ` +
                      `[ ${input.slice(start_rule_result.index).join(", ")}` +
                      ` ]`);
    }
  }
  // -------------------------------------------------------------------------------------
  __impl_toString(visited, next_id) {
    return `[${this.__vivify(this.start_rule).__toString(visited, next_id)} ` +
      `${this.__vivify(this.body_rule).__toString(visited, next_id)}! ` +
      `${this.__vivify(this.end_rule).__toString(visited, next_id)}!]`
  }
}
// ---------------------------------------------------------------------------------------
// convenience constructor:
function cutting_enc(start_rule, body_rule, end_rule) {
  return new CuttingEnclosed(start_rule, body_rule, end_rule);
}
// ---------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------
// Label class
// ---------------------------------------------------------------------------------------
class Label extends Rule {
  // -------------------------------------------------------------------------------------
  constructor(label, rule) {
    super();
    this.label = label;
    this.rule = make_rule_func(rule);
  }
  // -------------------------------------------------------------------------------------
  __impl_finalize(indent, visited) {
    this.rule = this.__vivify(this.rule);
    this.rule.__finalize(indent + 1, visited);
  }
  // -------------------------------------------------------------------------------------
  __match(indent, input, index) {
    const rule_match_result = this.rule.match(
      input, index, indent);

    if (! rule_match_result)
      return null;

    return new MatchResult(
      new LabeledValue(this.label, rule_match_result.value),
      input,
      rule_match_result.index);
  }
  // -------------------------------------------------------------------------------------
  __impl_toString(visited, next_id) {
    return `L('${this.label}', ` +
      `${this.__vivify(this.rule).__toString(visited, next_id)})`;
  }
}
// ---------------------------------------------------------------------------------------
function label(label, rule) {
  return new Label(label, rule);
}
// ---------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------
// NeverMatch class
// ---------------------------------------------------------------------------------------
class NeverMatch extends Rule  {
  // -------------------------------------------------------------------------------------
  constructor() {
    super();
  }
  // -------------------------------------------------------------------------------------
  __impl_finalize(indent, visited) {
    // do nothing.
  }
  // -------------------------------------------------------------------------------------
  __match(indent, input, index) {
    return null;
  } 
  // -------------------------------------------------------------------------------------
  __impl_toString(visited, next_id) {
    return `<NEVER MATCH>`;
  }
}
// ---------------------------------------------------------------------------------------
const never_match = new NeverMatch();
// ---------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------
// Optional class
// ---------------------------------------------------------------------------------------
class Optional extends Rule {
  // -------------------------------------------------------------------------------------
  constructor(rule, default_value = null) {
    super();
    this.rule          = make_rule_func(rule);
    this.default_value = default_value;
  }
  // -------------------------------------------------------------------------------------
  __match(indent, input, index) {
    const match_result = this.rule.match(
      input,
      index,
      indent + 1);

    if (match_result === null) {
      const mr = new MatchResult(this.default_value !== null
                                 ? [ this.default_value ]
                                 : [],
                                 input, index);

      if (log_match_enabled)
        log(indent, `returning default ${inspect_fun(mr)}`);

      return mr;
    }
    
    match_result.value = [ match_result.value ];

    return match_result;
  }
  // -------------------------------------------------------------------------------------
  __impl_finalize(indent, visited) {
    this.rule = this.__vivify(this.rule);
    
    this.rule.__finalize(indent + 1, visited);
  }
  // -------------------------------------------------------------------------------------
  __impl_toString(visited, next_id) {
    return `${this.__vivify(this.rule).__toString(visited, next_id)}?`;
  }
}
// ---------------------------------------------------------------------------------------
function optional(rule, default_value = null) { // convenience constructor
  return new Optional(rule, default_value);
}
// ---------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------
// Sequence class
// ---------------------------------------------------------------------------------------
class Sequence extends Rule {
  // -------------------------------------------------------------------------------------
  constructor(...elements) {
    super();
    this.elements = elements.map(make_rule_func);
  }
  // -------------------------------------------------------------------------------------
  __fail_or_throw_error(start_rule_result, failed_rule_result,
                        input, index) {
    return null;
  }
  // -------------------------------------------------------------------------------------
  __impl_finalize(indent, visited) {
    for (let ix = 0; ix < this.elements.length; ix++) {
      this.elements[ix] = this.__vivify(this.elements[ix]);
      this.elements[ix].__finalize(indent + 1, visited);
    }
  }
  // -------------------------------------------------------------------------------------
  __match(indent, input, index) {
    const start_rule = input[0];

    if (log_match_enabled)
      log(indent + 1, `matching first sequence item #1 out of ` +
          `${this.elements.length}: ${this.elements[0]}...`);
    
    const start_rule_match_result =
          this.elements[0].match(input, index, indent + 2);
    let last_match_result = start_rule_match_result;

    if (log_match_enabled && last_match_result !== null)
      log(indent + 1, `first last_match_result = ${inspect_fun(last_match_result)}`);
    
    if (last_match_result === null) {
      if (log_match_enabled)
        log(indent + 1, `did not match sequence item #1.`);
      return null;
    }

    if (log_match_enabled)
      log(indent + 1, `matched sequence item #1: ` +
          `${JSON.stringify(last_match_result)}.`);
    
    const values = [];
    index        = last_match_result.index;

    if (log_match_enabled)
      log(indent + 1, `last_match_result = ${inspect_fun(last_match_result)}`);

    if (last_match_result.value !== DISCARD) {
      if (log_match_enabled)
        log(indent + 1, `pushing ${inspect_fun(last_match_result.value)}`);
      values.push(last_match_result.value);
      if (values.includes(null))
        throw new Error("STOP @ PUSH 1");
    }
    else if (log_match_enabled)
      log(indent + 1, `discarding ${inspect_fun(last_match_result)}!`);

    for (let ix = 1; ix < this.elements.length; ix++) {
      if (log_match_enabled)
        log(indent + 1, `matching sequence item #${ix+1} out of ` +
            `${this.elements.length}: ${this.elements[ix]}...`);
      
      const element = this.elements[ix];

      last_match_result = element.match(
        input, index, indent + 2);

      if (! last_match_result) {
        if (log_match_enabled)
          log(indent + 1, `did not match sequence item #${ix}.`);
        return this.__fail_or_throw_error(start_rule_match_result,
                                          last_match_result,
                                          input, index);
      }

      if (log_match_enabled)
        log(indent + 1, `matched sequence item #${ix}.`);

      if (last_match_result.value !== DISCARD) {
        if (log_match_enabled)
          log(indent + 1, `pushing ${inspect_fun(last_match_result.value)}`);

        values.push(last_match_result.value);

        if (values.includes(null))
          throw new Error(`STOP @ PUSH 2 AFTER ${this.elements[ix]}`);
      }

      index = last_match_result.index;
    }

    if (values.includes(null))
      throw new Error("STOP @ RET");
    
    const mr = new MatchResult(values, input, last_match_result.index);
    // console.log(`SEQ MR = ${inspect_fun(mr)}`);
    return mr;
  }
  // -------------------------------------------------------------------------------------
  __impl_toString(visited, next_id) {
    return `(${this.elements
               .map((x) => this.__vivify(x)
                           .__toString(visited, next_id)).join(" ")})`;
  }
}
// ---------------------------------------------------------------------------------------
function seq(...elements) { // convenience constructor
  return new Sequence(...elements);
}
// ---------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------
// CuttingSequence class
// ---------------------------------------------------------------------------------------
class CuttingSequence extends Sequence {
  // -------------------------------------------------------------------------------------
  constructor(leading_rule, ...expected_rules) {
    super(leading_rule, ...expected_rules);
  }
  // -------------------------------------------------------------------------------------
  __fail_or_throw_error(start_rule_result, failed_rule_result,
                        input, index) {
    throw new Error(`expected (${this.elements.slice(1).join(" ")}) ` +
                    `after ${this.elements[0]} at ` +
                    `char ${input[start_rule_result.index].start}` +
                    `, found: ` +
                    `[ ${input.slice(start_rule_result.index).join(", ")}` +
                    ` ]`);
  }
  // -------------------------------------------------------------------------------------
  __impl_toString(visited, next_id) {
    return `${this.__vivify(this.elements[0]).__toString(visited, next_id)}=>` +
      `${this.elements.slice(1)
         .map(x => this.__vivify(x).__toString(visited, next_id))}`;
  }
}
// ---------------------------------------------------------------------------------------
// convenience constructor:
function cutting_seq(leading_rule, ...expected_rules) {
  return new CuttingSequence(leading_rule, ...expected_rules);
}
// ---------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------
// Xform class
// ---------------------------------------------------------------------------------------
class Xform extends Rule {
  // -------------------------------------------------------------------------------------
  constructor(rule, xform_func) {
    super();
    this.xform_func = xform_func;
    this.rule       = make_rule_func(rule);
  }
  // -------------------------------------------------------------------------------------
  __impl_finalize(indent, visited) {
    this.rule = this.__vivify(this.rule);
    this.rule.__finalize(indent + 1, visited);
  }
  // -------------------------------------------------------------------------------------
  __match(indent, input, index) {
    const rule_match_result = this.rule.match(
      input, index, indent + 1);

    if (! rule_match_result)
      return null;

    rule_match_result.value = this.xform_func(rule_match_result.value);

    return rule_match_result
  }
  // -------------------------------------------------------------------------------------
  __impl_toString(visited, next_id) {
    return `${this.__vivify(this.rule).__toString(visited, next_id)}`;
  }
}
// ---------------------------------------------------------------------------------------
function xform(...things) { // convenience constructor with magic
  things = things.map(make_rule_func);

  if (things[0] instanceof Rule ||
      things[0] instanceof RegExp || 
      typeof things[0] === "string" || 
      things[0] instanceof ForwardReference) {
    const fn   = pipe_funs(...things.slice(1));
    const rule = things[0];

    return new Xform(rule, fn);
  }
  else
  {
    const fn   = compose_funs(...things.slice(0, -1));
    const rule = things[things.length - 1];

    return new Xform(rule, fn);
  }
}
// ---------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------
// Expect class
// ---------------------------------------------------------------------------------------
class Expect extends Rule {
  // -------------------------------------------------------------------------------------
  constructor(rule, error_func = null) {
    super();
    this.rule       = make_rule_func(rule);
    this.error_func = error_func;
  }
  // -------------------------------------------------------------------------------------
  __match(indent, input, index) {
    const match_result = this.rule.match(
      input,
      index,
      indent + 1);

    if (! match_result) {
      if (this.error_func) {
        throw this.error_func(this, index, input)
      }
      else {
        throw new Error(`expected (${this.rule} at ` +
                        `char ${input[index].start}` +
                        `, found: ` +
                        `[ ${input.slice(index).join(", ")}` +
                        ` ]`);
      }
    };

    return match_result;
  }
  // -------------------------------------------------------------------------------------
  __impl_finalize(indent, visited) {
    this.rule = this.__vivify(this.rule);    
    this.rule.__finalize(indent + 1, visited);
  }
  // -------------------------------------------------------------------------------------
  __impl_toString(visited, next_id) {
    return `${this.__vivify(this.rule).__toString(visited, next_id)}!`;
  }
}
// ---------------------------------------------------------------------------------------
function expect(rule, error_func = null) { // convenience constructor
  return new Expect(rule, error_func);
}
// ---------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------
// Unexpected class
// ---------------------------------------------------------------------------------------
class Unexpected extends Rule {
  // -------------------------------------------------------------------------------------
  constructor(rule, error_func = null) {
    super();
    this.rule       = make_rule_func(rule);
    this.error_func = error_func;
  }
  // -------------------------------------------------------------------------------------
  __match(indent, input, index) {
    const match_result = this.rule.match(
      input,
      index,
      indent + 1);

    if (match_result) {
      if (this.error_func) {
        throw this.error_func(this, index, input)
      }
      else {
        throw new Error(`unexpected (${this.rule} at ` +
                        `char ${index}` +
                        `, found: "` +
                        input.substring(index, index + 20) +
                        // `[ ${ (string_input_mode_enabled ? input.substring : input.slice)(index).join(", ")}` +
                        `..."`);
      }
    };

    return null; // new MatchResult(null, input, match_result.index);
  }
  // -------------------------------------------------------------------------------------
  __impl_finalize(indent, visited) {
    this.rule = this.__vivify(this.rule);    
    this.rule.__finalize(indent + 1, visited);
  }
  // -------------------------------------------------------------------------------------
  __impl_toString(visited, next_id) {
    return `!${this.__vivify(this.rule).__toString(visited, next_id)}!`;
  }
}
// ---------------------------------------------------------------------------------------
function unexpected(rule, error_func = null) { // convenience constructor
  return new Unexpected(rule, error_func);
}
// ---------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------
// Fail class
// ---------------------------------------------------------------------------------------
class Fail extends Rule {
  // -------------------------------------------------------------------------------------
  constructor(error_func = null) {
    super();
    this.error_func = error_func;
  }
  // -------------------------------------------------------------------------------------
  __match(indent, input, index) {
    throw this.error_func
      ? this.error_func(this, index, input)
      : new Error(`unexpected (${this.rule} at ` +
                  `char ${input[index].start}` +
                  `, found: ` +
                  `[ ${input.slice(index).join(", ")}` +
                  ` ]`);
  }
  // -------------------------------------------------------------------------------------
  __impl_finalize(indent, visited) {
    // do nothing
  }
  // -------------------------------------------------------------------------------------
  __impl_toString(visited, next_id) {
    return `<FAIL!>`;
  }
}
// ---------------------------------------------------------------------------------------
function fail(error_func = null) { // convenience constructor
  return new Fail(error_func);
}
// ---------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------
// TokenLabel class
// ---------------------------------------------------------------------------------------
class TokenLabel extends Rule {
  // -------------------------------------------------------------------------------------
  constructor(label) {
    super();
    this.label  = label;
  }
  // -------------------------------------------------------------------------------------
  __impl_finalize(indent, visited) {
    // do nothing.
  }
  // -------------------------------------------------------------------------------------
  __match(indent, input, index) {
    if (index_is_at_end_of_input(index, input))
      return null;

    let the_token = input[index];

    if (the_token?.label != this.label)
      return null;

    return new MatchResult(the_token,
                           input,
                           index + 1) // always matches just 1 token.
  }
  // -------------------------------------------------------------------------------------
  __impl_toString(visited, next_id) {
    return `'${this.label}'`;
  }
}
// ---------------------------------------------------------------------------------------
function tok(label) { // convenience constructor
  return new TokenLabel(label);
}
// ---------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------
// Literal class
// ---------------------------------------------------------------------------------------
class Literal extends Rule {
  // -------------------------------------------------------------------------------------
  constructor(string) {
    super();
    this.string  = string;
  }
  // -------------------------------------------------------------------------------------
  __impl_finalize(indent, visited) {
    // do nothing.
  }
  // -------------------------------------------------------------------------------------
  __match(indent, input, index) {
    if (index_is_at_end_of_input(index, input))
      return null;

    if (! input.startsWith(this.string, index))
      return null;

    return new MatchResult(this.string,
                           input,
                           index + this.string.length)
  }
  // -------------------------------------------------------------------------------------
  __impl_toString(visited, next_id) {
    return `'${this.string}'`;
  }
}
// ---------------------------------------------------------------------------------------
function l(first_arg, second_arg) { // convenience constructor
  if (second_arg)
    return new Label(first_arg, new Literal(second_arg));
  
  return new Literal(first_arg);
}
// ---------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------
// Regex class
// ---------------------------------------------------------------------------------------
class Regex extends Rule {
  // -------------------------------------------------------------------------------------
  constructor(regexp) {
    super();
    this.regexp  = this.#ensure_RegExp_sticky_flag(regexp);
  }
  // -------------------------------------------------------------------------------------
  #ensure_RegExp_sticky_flag(regexp) {
    // e.ensure_thing_has_class(RegExp, regexp);

    return regexp.sticky
      ? regexp
      : new RegExp(regexp.source, regexp.flags + 'y');
  }
  // -------------------------------------------------------------------------------------
  __impl_finalize(indent, visited) {
    // do nothing.
  }
  // -------------------------------------------------------------------------------------
  __match(indent, input, index) {
    this.regexp.lastIndex = index;

    if (log_match_enabled)
      log(indent, `testing  /${this.regexp.source}/ at char ${index} of ` +
          `'${input}'...`); 

    const match = this.regexp.exec(input);
    
    if (! match) {
      if (log_match_enabled)
        log(indent, `RETURN NULL!`);
      return null;
    }

    return new MatchResult(match[match.length - 1],
                           input,
                           index + match[0].length);
  }
  // -------------------------------------------------------------------------------------
  __impl_toString(visited, next_id) {
    return `${this.regexp.source}`;
  }
}
// ---------------------------------------------------------------------------------------
function r(first_arg, second_arg) { // convenience constructor
  if (second_arg)
    return new Label(first_arg, new Regex(second_arg));
  
  return new Regex(first_arg);
}
// ---------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------
// ForwardReference class
// ---------------------------------------------------------------------------------------
class ForwardReference {
  // -------------------------------------------------------------------------------------
  constructor(func) {
    this.func = func;
  }
  // -------------------------------------------------------------------------------------
  __toString() {
    return "???";
  }
  // -------------------------------------------------------------------------------------
  __impl_toString() {
    return "???";
  }
}
// ---------------------------------------------------------------------------------------
const ref = (func) => new ForwardReference(func);
// ---------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------
// LabeledValue class
// ---------------------------------------------------------------------------------------
class LabeledValue {
  // -------------------------------------------------------------------------------------
  constructor(label, value) {
    this.label  = label;
    this.value  = value;
  }
}
// ---------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------
// MatchResult class
// ---------------------------------------------------------------------------------------
class MatchResult {
  // -------------------------------------------------------------------------------------
  constructor(value, input, index) {
    this.value       = value;
    this.index       = index; // a number.
    this.is_finished = index == input.length; 
  }
}
// ---------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------
// helper functions and related vars:
// ---------------------------------------------------------------------------------------
function index_is_at_end_of_input(index, input) {
  return index == input.length
}
// ---------------------------------------------------------------------------------------
function log(indent, str = "", indent_str = "| ") {
  if (! log_enabled)
    return;

  console.log(`${indent_str.repeat(indent)}${str}`);
}
// ---------------------------------------------------------------------------------------
function maybe_make_TokenLabel_from_string(thing) {
  if (typeof thing === 'string')
    return new TokenLabel(thing);

  return thing
}
// ---------------------------------------------------------------------------------------
function maybe_make_RE_or_Literal_from_Regexp_or_string(thing) {
  if (typeof thing === 'string')
    return new Literal(thing);
  else if (thing instanceof RegExp)
    return new Regex(thing);
  else
    return thing;
}
// ---------------------------------------------------------------------------------------
let make_rule_func = maybe_make_RE_or_Literal_from_Regexp_or_string
// ---------------------------------------------------------------------------------------
function set_string_input_mode_enabled(state) {
  string_input_mode_enabled = state;
  return make_rule_func = state
    ? maybe_make_RE_or_Literal_from_Regexp_or_string
    : maybe_make_TokenLabel_from_string;
}
// ---------------------------------------------------------------------------------------
function set_log_finalize_enabled(state) {
  return log_finalize_enabled = state;
}
// ---------------------------------------------------------------------------------------
function set_log_match_enabled(state) {
  return log_match_enabled = state;
}
// ---------------------------------------------------------------------------------------
function compose_funs(...fns) {
  return fns.length === 0
    ? x => x
    : pipe_funs(...[...fns].reverse());
}
// ---------------------------------------------------------------------------------------
function pipe_funs(...fns) {
  if (fns.length === 0)
    return x => x;
  else if (fns.length === 1)
    return fns[0];

  const [head, ...rest] = fns;

  return rest.reduce((acc, fn) => x => fn(acc(x)), head);
}
// =======================================================================================
// END OF GRAMMAR.JS CONTENT
// =======================================================================================


// =======================================================================================
// COMMON-GRAMMAR.JS CONTENT:
// =======================================================================================
// Code in this section copy/pasted from the common-grammar.js file in my
// 'jparse' project circa ac2979f.
// 
// Not all of this section is actually used by the wildcards-plus script right 
// now, but it's easier to just copy/paste in the whole file than it is to
// bother working out which parts can be removed and snipping them out, and who
// knows, maybe I'll use more of it in the future.
// 
// Original project at: https://github.com/ariane-emory/jparse/
// =======================================================================================
// Convenient Rules/combinators for common terminals and constructs:
// =======================================================================================
// simple 'words':
const alphas             = r(/[a-zA-Z_]+/);
const alphacaps          = r(/[A-Z_]+/);
// ---------------------------------------------------------------------------------------
// whitespace:
const whites_star        = r(/\s*/);
const whites_plus        = r(/\s+/);
const d_whites_star      = discard(whites_star);
const d_whites_plus      = discard(whites_plus);
// ---------------------------------------------------------------------------------------
// leading/trailing whitespace:
const lws                = rule => second(seq(whites_star, rule));
const tws                = rule => first(seq(rule, whites_star));
// ---------------------------------------------------------------------------------------
// common numbers:
const udecimal           = r(/\d+\.\d+/); 
const urational          = r(/\d+\/[1-9]\d*/);
const uint               = r(/\d+/)
const sdecimal           = r(/[+-]?\d+\.\d+/);
const srational          = r(/[+-]?\d+\/[1-9]\d*/);
const sint               = r(/[+-]?\d+/)
// ---------------------------------------------------------------------------------------
// common separated quantified rules:
const star_comma_sep     = rule => star(rule, /\s*\,\s*/);
const plus_comma_sep     = rule => plus(rule, /\s*\,\s*/);
const star_whites_sep    = rule => star(rule, whites_plus);
const plus_whites_sep    = rule => plus(rule, whites_plus);
// ---------------------------------------------------------------------------------------
// string-like terminals:
const stringlike         = quote => r(new RegExp(String.raw`${quote}(?:[^${quote}\\]|\\.)*${quote}`));
const dq_string          = stringlike('"');
const sq_string          = stringlike("'");
const triple_dq_string   = r(/"""(?:[^\\]|\\.|\\n)*?"""/);
const raw_dq_string      = r(/r"[^"]*"/);
const template_string    = r(/`(?:[^\\`]|\\.)*`/);
// ---------------------------------------------------------------------------------------
// keyword helper:
const keyword            = word => {
  if (word instanceof Regex)
    return keyword(word.regexp);

  if (word instanceof RegExp)
    return keyword(word.source);
  
  return r(new RegExp(String.raw(`\b${word}\b`)));
};
// ---------------------------------------------------------------------------------------
// parenthesis-like terminals:
const lpar               = l('(');
const rpar               = l(')');
const lbrc               = l('{');
const rbrc               = l('}');
const lsqr               = l('[');
const rsqr               = l(']');
const lt                 = l('<');
const gt                 = l('>');
// ---------------------------------------------------------------------------------------
// common enclosed rules:
const par_enc            = rule => cutting_enc(lpar, rule, rpar);
const brc_enc            = rule => cutting_enc(lbrc, rule, rbrc);
const sqr_enc            = rule => cutting_enc(lsqr, rule, rsqr);
const tri_enc            = rule => cutting_enc(lt,   rule, gt);
const wse                = rule => enc(whites_star, rule, whites_star);
// ---------------------------------------------------------------------------------------
// basic arithmetic ops:
const factor_op          = r(/[\/\*\%]/);
const term_op            = r(/[\+\-]/);
// ---------------------------------------------------------------------------------------
// Pascal-like terminals:
const pascal_assign_op   = l(':=');
// ---------------------------------------------------------------------------------------
// Python-like terminals:
const python_exponent_op = l('**');
const python_logic_word  = r(/and|or|not|xor/);
// ---------------------------------------------------------------------------------------
// common punctuation:
const ampersand          = l('&');
const asterisk           = l('*');
const bang               = l('!');
const bslash             = l('\\');
const caret              = l('^');
const colon              = l(':');
const comma              = l(',');
const dash_arrow         = l('->');
const dot                = l('.');
const eq_arrow           = l('=>');
const ellipsis           = l('...');
const equals             = l('=');
const percent            = l('%');
const pipe               = l('|');
const pound              = l('#');
const question           = l('?');
const range              = l('..');
const semicolon          = l(';');
const slash              = l('/');
// ---------------------------------------------------------------------------------------
// C-like numbers:
const c_sint             = sint;
const c_uint             = uint;
const c_bin              = r(/0b[01]/);
const c_char             = r(/'\\?[^\']'/);
const c_hex              = r(/0x[0-9a-f]+/);
const c_octal            = r(/0o[0-7]+/);
const c_sfloat           = r(/[+-]?\d*\.\d+(e[+-]?\d+)?/i);
const c_ufloat           = r(/\d*\.\d+(e[+-]?\d+)?/i);
const c_ident            = r(/[a-zA-Z_][0-9a-zA-Z_]*/);
const c_snumber          = choice(c_hex, c_octal, c_sfloat, c_sint);
const c_unumber          = choice(c_hex, c_octal, c_ufloat, c_uint);
// ---------------------------------------------------------------------------------------
// other C-like terminals:
const c_bool             = choice('true', 'false');
const c_arith_assign     = r(/\+=|\-=|\*=|\/=|\%=/)
const c_bitwise_and      = l('&');
const c_bitwise_bool_ops = r(/&&|\|\|/);
const c_bitwise_not      = l('~');
const c_bitwise_or       = l('|');
const c_bitwise_xor      = caret; 
const c_ccomparison_op   = r(/<=?|>=?|[!=]/);
const c_incr_decr        = r(/\+\+|--/);
const c_shift            = r(/<<|>>/);
const c_shift_assign     = r(/<<=|>>=/);
const c_unicode_ident    = r(/[\p{L}_][\p{L}\p{N}_]*/u);
// ---------------------------------------------------------------------------------------
// dotted chains:
const dot_chain          = rule => plus(rule, dot); 
// ---------------------------------------------------------------------------------------
// common comment styles:
const c_line_comment     = r(/\/\/[^\n]*/);
const py_line_comment    = r(/#[^\n]*/);
const c_block_comment    = r(/\/\*[^]*?\*\//);
// ---------------------------------------------------------------------------------------
// ternary helper combinator:
const ternary            =
      ((cond_rule, then_rule = cond_rule, else_rule = then_rule) =>
        xform(seq(cond_rule, question, then_rule, colon, else_rule),
              arr => [ arr[0], arr[2], arr[4] ]));
// ---------------------------------------------------------------------------------------
// misc unsorted Rules:
const kebab_ident = r(/[a-z]+(?:-[a-z0-9]+)*/);
// ---------------------------------------------------------------------------------------
// C-like function calls:
const c_funcall = (fun_rule, arg_rule, open = '(', close = ')', sep = ',') =>
      seq(fun_rule,
          wst_cutting_enc(open,
                          wst_star(arg_rule, sep),
                          close));
// ---------------------------------------------------------------------------------------
// whitespace tolerant combinators:
// ---------------------------------------------------------------------------------------
const __make_wst_quantified_combinator = base_combinator => 
      ((rule, sep = null) => base_combinator(wse(rule), sep));
const __make_wst_quantified_combinator_alt = base_combinator =>
      ((rule, sep = null) =>
        lws(base_combinator(tws(rule),
                            sep ? seq(sep, whites_star) : null)));
const __make_wst_seq_combinator = base_combinator =>
      //      (...rules) => tws(base_combinator(...rules.map(x => lws(x))));
      (...rules) => base_combinator(...rules.map(x => lws(x)));
// ---------------------------------------------------------------------------------------
const wst_choice      = (...options) => wse(choice(...options));
const wst_star        = __make_wst_quantified_combinator(star);
const wst_plus        = __make_wst_quantified_combinator(plus);
const wst_star_alt    = __make_wst_quantified_combinator_alt(star);
const wst_plus_alt    = __make_wst_quantified_combinator_alt(plus);
const wst_seq         = __make_wst_seq_combinator(seq);
const wst_enc         = __make_wst_seq_combinator(enc);
const wst_cutting_seq = __make_wst_seq_combinator(cutting_seq);
const wst_cutting_enc = __make_wst_seq_combinator(cutting_enc);
const wst_par_enc     = rule => cutting_enc(wse(lpar), rule, wse(rpar));
const wst_brc_enc     = rule => cutting_enc(wse(lbrc), rule, wse(rbrc));
const wst_sqr_enc     = rule => cutting_enc(wse(lsqr), rule, wse(rsqr));
const wst_tri_enc     = rule => cutting_enc(wse(lt),   rule, wse(gt));
// ---------------------------------------------------------------------------------------
// convenience combinators:
// ---------------------------------------------------------------------------------------
const push            = ((value, rule) =>
  xform(rule, arr => [value, ...arr]));
const enclosing       = (left, enclosed, right) =>
      xform(arr => [ arr[0], arr[2] ], seq(left, enclosed, right)); 
// =======================================================================================
// END of COMMON-GRAMMAR.JS CONTENT
// =======================================================================================


// =======================================================================================
// WildcardPicker class
// ---------------------------------------------------------------------------------------
class WildcardPicker {
  // -------------------------------------------------------------------------------------
  constructor(optSpecs = []) {
    this.options = [];
    this.range   = 0;

    for (const optSpec of optSpecs) {
      if (Array.isArray(optSpec)) {
        this.add(...optSpec);
      } else {
        this.add(1, optSpec);
      }
    }
  }
  // -------------------------------------------------------------------------------------
  add(weight, value) {
    this.options.push([ weight, value ]);
    this.range += weight;
  }
  // -------------------------------------------------------------------------------------
  pick() {
    if (this.options.length == 1) {
      // console.log(`one option: ${inspect_fun(this.options[0][1])}`);

      return this.options[0][1];
    }
    
    let   total   = 0;
    const random  = Math.random() * this.range;

    for (const option of this.options) {
      total += option[0];

      if (random < total)
        return option[1];      
    }
  }
}
// ---------------------------------------------------------------------------------------


// =======================================================================================
// JSON ← S? ( Object / Array / String / True / False / Null / Number ) S?
const json = choice(() => json_object, () => json_array, () => json_string,
                    () => json_true,   () => json_false, () => json_null,
                    () => json_number);
// Object ← "{"
// ( String ":" JSON ( "," String ":" JSON )*
//   / S? ) 
// "}"
const json_object = xform(arr =>  Object.fromEntries(arr), 
                          wst_cutting_enc('{',
                                          wst_star(
                                            xform(arr => [arr[0], arr[2]],
                                                  wst_seq(() => json_string, ':', json)),
                                            ','),
                                          '}'));
// Array ← "["
// ( JSON ( "," JSON )*
//   / S? )
// "]"
const json_array = wst_cutting_enc('[', wst_star(json, ','), ']');
// String ← S? ["] ( [^ " \ U+0000-U+001F ] / Escape )* ["] S?
const json_unquote = str => str.substring(1, str.length - 1);
const json_string = xform(json_unquote, dq_string); // placeholder, C-like double-quoted strings, might not handle all unicode.
// UnicodeEscape ← "u" [0-9A-Fa-f]{4}
const json_unicodeEscape = r(/u[0-9A-Fa-f]{4}/);
// Escape ← [\] ( [ " / \ b f n r t ] / UnicodeEscape )
const json_escape = seq('\\', choice(/["\\/bfnrt]/, json_unicodeEscape));
// True ← "true"
const json_true = xform(x => true, l('true'));
// False ← "false"
const json_false = xform(x => false, l('false'));
// Null ← "null"
const json_null = xform(x => null, l('null'));
// Minus ← "-"
const json_minus = l('-');
// IntegralPart ← "0" / [1-9] [0-9]*
const json_integralPart = r(/0|[1-9][0-9]*/);
// FractionalPart ← "." [0-9]+
const json_fractionalPart = r(/\.[0-9]+/);
// ExponentPart ← ( "e" / "E" ) ( "+" / "-" )? [0-9]+
const json_exponentPart = r(/[eE][+-]?\d+/);
// Number ← Minus? IntegralPart FractionalPart? ExponentPart?
const reify_json_number = arr => {
  const multiplier      = arr[0].length > 0 ? -1 : 1;
  const integer_part    = arr[1];
  const fractional_part = arr[2];
  const exponent        = arr[3];
  const number          =  multiplier * ((integer_part + fractional_part)**exponent);

  return number;
  return arr;
};
const json_number = xform(reify_json_number,
                          seq(optional(json_minus),
                              xform(parseInt, json_integralPart), 
                              xform(arr => {
                                // console.log(`fractional part ARR: ${inspect_fun(arr)}`);
                                return parseFloat(arr[0]);
                              }, optional(json_fractionalPart, 0.0)),
                              xform(parseInt, optional(json_exponentPart, 1))));
// S ← [ U+0009 U+000A U+000D U+0020 ]+
const json_S = whites_plus;
// ---------------------------------------------------------------------------------------
json.finalize(); // .finalize-ing resolves the thunks that were used the in json and json_object for forward references to not-yet-defined rules.
// =======================================================================================


// =======================================================================================
// helper functions:
// =======================================================================================
function rand_int(x, y) {
  y ||= x;
  // console.log(`RAND_INT(${inspect_fun(x)}, ${inspect_fun(y)})`);
  const min = Math.min(x, y);
  const max = Math.max(x, y);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
// ---------------------------------------------------------------------------------------
function pretty_list(arr) {
  const items = arr.map(String); // Convert everything to strings like "null" and 7 → "7"

  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;

  const ret = `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
  
  return ret;
}
// ---------------------------------------------------------------------------------------
function capitalize(string) {
  // console.log(`CAPITALIZING '${string}'`);
  return string.charAt(0).toUpperCase() + string.slice(1);
}
// ---------------------------------------------------------------------------------------
function choose_indefinite_article(word) {
  if (!word)
    return 'a'; // fallback

  const lower = word.toLowerCase();

  // Words that begin with vowel *sounds*
  const vowelSoundExceptions = [
    /^e[uw]/,          // eulogy, Europe
    /^onc?e\b/,        // once
    /^uni([^nmd]|$)/,  // university, unique, union but not "unimportant"
    /^u[bcfhjkqrstn]/, // unicorn, useful, usual
    /^uk/,             // UK (spoken "you-kay")
    /^ur[aeiou]/,      // uranium
  ];

  const silentHWords = [
    'honest', 'honor', 'hour', 'heir', 'herb' // 'herb' only in American English
  ];

  const acronymStartsWithVowelSound = /^[aeiou]/i;
  const consonantYooSound = /^u[bcfhjkqrstn]/i;

  if (silentHWords.includes(lower))
    return 'an';

  if (vowelSoundExceptions.some(re => re.test(lower)))
    return 'a';

  // Words beginning with vowel letters
  if ('aeiou'.includes(lower[0]))
    return 'an';

  return 'a';
}
// ---------------------------------------------------------------------------------------
function unescape(str) {
  return str
    .replace(/\\n/g,   '\n')
    .replace(/\\ /g,   ' ')
    .replace(/\\(.)/g, '$1')
};
// ---------------------------------------------------------------------------------------
function smart_join(arr) {
  arr = [...arr];
  
  // console.log(`JOINING ${inspect_fun(arr)}`);
  const vowelp       = (ch)  => "aeiou".includes(ch.toLowerCase()); 
  const punctuationp = (ch)  => "_-,.?!;:".includes(ch);
  const linkingp     = (ch)  => ch === "_" || ch === "-";
  const whitep       = (ch)  => ch === ' ' || ch === '\n';
  
  let left_word = arr[0]?.toString() ?? "";
  let str       = left_word;

  for (let ix = 1; ix < arr.length; ix++)  {
    let right_word = null;
    let prev_char = null;
    let prev_char_is_escaped = null
    let next_char = null;

    const update_pos_vars = () => {
      right_word           = arr[ix]?.toString() ?? "";
      prev_char            = left_word[left_word.length - 1] ?? "";
      prev_char_is_escaped = left_word[left_word.length - 2] === '\\';
      next_char            = right_word[0] ?? '';
    };
    
    const shift_left = (n) => {
      const shifted_str = right_word.substring(0, n);
      str = str.substring(0, str.length -1) + shifted_str;
      left_word = left_word.substring(0, left_word.length - 1) + shifted_str;
      arr[ix] = right_word.substring(n);
      update_pos_vars();
    };

    update_pos_vars();
    
    if (prev_char === ',' && right_word === ',')
      continue;

    while  (",.!?".includes(prev_char) && right_word.startsWith('...'))
      shift_left(3);
    
    while (",.!?".includes(prev_char) && next_char && ",.!?".includes(next_char))
      shift_left(1);
    

    // console.log(`"${str}",  '${left_word}' + '${right_word}'`);

    // console.log(`str = '${str}', ` +
    //             `left_word = '${left_word}', ` +
    //             `right_word = '${right_word}', ` +
    //             `prev_char = '${prev_char}', ` +
    //             `next_char = '${next_char}'`);

    // handle "a" → "an" if necessary

    const articleCorrection = (originalArticle, nextWord) => {
      const expected = choose_indefinite_article(nextWord);
      if (originalArticle.toLowerCase() === 'a' && expected === 'an') {
        return originalArticle === 'A' ? 'An' : 'an';
      }
      return originalArticle;
    };

    // Normalize article if needed
    if (left_word === "a" || left_word.endsWith(" a") ||
        left_word === "A" || left_word.endsWith(" A")) {
      const nextWord = right_word;
      const updatedArticle = articleCorrection(left_word.trim(), nextWord);
      if (updatedArticle !== left_word.trim()) {
        if (left_word === "a" || left_word === "A") {
          str = str.slice(0, -1) + updatedArticle;
          left_word = updatedArticle;
        } else {
          str = str.slice(0, -2) + " " + updatedArticle;
          left_word = updatedArticle;
        }
      }
    }

    if (!(!str || !right_word) && 
        !whitep(prev_char) &&
        !whitep(next_char) &&
        !((linkingp(prev_char) || '(['.includes(prev_char)) && !prev_char_is_escaped) &&
        !(linkingp(next_char) || ')]'.includes(next_char)) &&
        ( next_char !== '<' && (! (prev_char === '<' && prev_char_is_escaped))) &&
        !(str.endsWith('\\n') || str.endsWith('\\ ')) &&  
        !punctuationp(next_char)) {
      // console.log(`SPACE!`);
      prev_char = ' ';
      str += ' ';
    }

    if (next_char === '<' && right_word !== '<') {
      // console.log(`CHOMP RIGHT!`);
      right_word = right_word.substring(1);
    }
    else if (prev_char === '<' && !prev_char_is_escaped) {
      // console.log(`CHOMP LEFT!`);
      str = str.slice(0, -1);
    }

    left_word = right_word;
    str += left_word;
  }

  // console.log(`before = '${str}'`);
  // console.log(`after  = '${unescape(str)}'`);

  return unescape(str);
}
// ---------------------------------------------------------------------------------------


// =======================================================================================
// helper functions for making contexts and dealing with the prelude:
// =======================================================================================
class Context {
  constructor({ 
    flags = new Set(),
    scalar_variables = new Map(),
    named_wildcards = new Map(),
    noisy = false,
    files = [],
    top_file = true,
  } = {}) {
    this.flags = flags;
    this.scalar_variables = scalar_variables;
    this.named_wildcards = named_wildcards;
    this.noisy = noisy;
    this.files = files;
    this.top_file = top_file;
  }
  // -------------------------------------------------------------------------------------
  reset_temporaries() {
    this.flags = new Set();
    this.scalar_variables = new Map();
  }
  // -------------------------------------------------------------------------------------
  clone() {
    return new Context({
      flags: new Set(this.flags),
      scalar_variables: new Map(this.scalar_variables),
      named_wildcards: new Map(this.named_wildcards),
      noisy: this.noisy,
      files: [...this.files],
      top_file: this.top_file,
    });
  }
  // -------------------------------------------------------------------------------------
  shallow_copy() {
    return new Context({
      flags: this.flags,
      scalar_variables: this.scalar_variables,
      named_wildcards: this.named_wildcards,
      noisy: this.noisy,
      files: this.files,
      top_file: false,
    });
  }
}
// ---------------------------------------------------------------------------------------
const prelude_text = disable_prelude ? '' : `
    @set_gender_if_unset := {!female !male !neuter {3 #female|2 #male|#neuter}}
    @gender              := {@set_gender_if_unset {?female woman |?male man |?neuter androgyne }}
    @pro_3rd_subj        := {@set_gender_if_unset {?female she   |?male he  |?neuter it }}
    @pro_3rd_obj         := {@set_gender_if_unset {?female her   |?male him |?neuter it }}
    @pro_pos_adj         := {@set_gender_if_unset {?female her   |?male his |?neuter its}}
    @pro_pos             := {@set_gender_if_unset {?female hers  |?male his |?neuter its}}
    @__digit             := {<0|<1|<2|<3|<4|<5|<6|<7|<8|<9}
    @__high_digit        := {<5|<6|<7|<8|<9}
    @random_weight       := {:1. @__digit}
    @high_random_weight  := {:1. @__high_digit}

    @pony_score_9        := {score_9,}
    @pony_score_8_up     := {score_9, score_8_up,}
    @pony_score_7_up     := {score_9, score_8_up, score_7_up,}
    @pony_score_6_up     := {score_9, score_8_up, score_7_up, score_6_up,}
    @pony_score_5_up     := {score_9, score_8_up, score_7_up, score_6_up, score_5_up,}
    @pony_score_4_up     := {score_9, score_8_up, score_7_up, score_6_up, score_5_up, score_4_up,}
    @aris_defaults       := {masterpiece, best quality, absurdres, aesthetic, 8k,
                             high depth of field, ultra high resolution, detailed background,
                             wide shot,}

    // Integrated conntent adapted from @Wizard Whitebeard's 'Wizard's Large Scroll of
    // Artist Summoning':
    @wizards_artists   := { @#__wizards_artists @__wizards_artists }
    @__wizards_artists := {
      #artist__zacharias_martin_aagaard Zacharias Martin Aagaard |
      #artist__slim_aarons Slim Aarons |
      #artist__elenore_abbott Elenore Abbott |
      #artist__tomma_abts Tomma Abts |
      #artist__vito_acconci Vito Acconci |
      #artist__andreas_achenbach Andreas Achenbach |
      #artist__ansel_adams Ansel Adams |
      #artist__josh_adamski Josh Adamski |
      #artist__charles_addams Charles Addams |
      #artist__etel_adnan Etel Adnan |
      #artist__alena_aenami Alena Aenami |
      #artist__leonid_afremov Leonid Afremov |
      #artist__petros_afshar Petros Afshar |
      #artist__yaacov_agam Yaacov Agam |
      #artist__eileen_agar Eileen Agar |
      #artist__craigie_aitchison Craigie Aitchison |
      #artist__ivan_aivazovsky Ivan Aivazovsky |
      #artist__francesco_albani Francesco Albani |
      #artist__alessio_albi Alessio Albi |
      #artist__miles_aldridge Miles Aldridge |
      #artist__john_white_alexander John White Alexander |
      #artist__alessandro_allori Alessandro Allori |
      #artist__mike_allred Mike Allred |
      #artist__lawrence_alma_tadema Lawrence Alma-Tadema |
      #artist__lilia_alvarado Lilia Alvarado |
      #artist__tarsila_do_amaral Tarsila do Amaral |
      #artist__ghada_amer Ghada Amer |
      #artist__cuno_amiet Cuno Amiet |
      #artist__el_anatsui El Anatsui |
      #artist__helga_ancher Helga Ancher |
      #artist__sarah_andersen Sarah Andersen |
      #artist__richard_anderson Richard Anderson |
      #artist__sophie_gengembre_anderson Sophie Gengembre Anderson |
      #artist__wes_anderson Wes Anderson |
      #artist__alex_andreev Alex Andreev |
      #artist__sofonisba_anguissola Sofonisba Anguissola |
      #artist__louis_anquetin Louis Anquetin |
      #artist__mary_jane_ansell Mary Jane Ansell |
      #artist__chiho_aoshima Chiho Aoshima |
      #artist__sabbas_apterus Sabbas Apterus |
      #artist__hirohiko_araki Hirohiko Araki |
      #artist__howard_arkley Howard Arkley |
      #artist__rolf_armstrong Rolf Armstrong |
      #artist__gerd_arntz Gerd Arntz |
      #artist__guy_aroch Guy Aroch |
      #artist__miki_asai Miki Asai |
      #artist__clemens_ascher Clemens Ascher |
      #artist__henry_asencio Henry Asencio |
      #artist__andrew_atroshenko Andrew Atroshenko |
      #artist__deborah_azzopardi Deborah Azzopardi |
      #artist__lois_van_baarle Lois van Baarle |
      #artist__ingrid_baars Ingrid Baars |
      #artist__anne_bachelier Anne Bachelier |
      #artist__francis_bacon Francis Bacon |
      #artist__firmin_baes Firmin Baes |
      #artist__tom_bagshaw Tom Bagshaw |
      #artist__karol_bak Karol Bak |
      #artist__christopher_balaskas Christopher Balaskas |
      #artist__benedick_bana Benedick Bana |
      #artist__banksy Banksy |
      #artist__george_barbier George Barbier |
      #artist__cicely_mary_barker Cicely Mary Barker |
      #artist__wayne_barlowe Wayne Barlowe |
      #artist__will_barnet Will Barnet |
      #artist__matthew_barney Matthew Barney |
      #artist__angela_barrett Angela Barrett |
      #artist__jean_michel_basquiat Jean-Michel Basquiat |
      #artist__lillian_bassman Lillian Bassman |
      #artist__pompeo_batoni Pompeo Batoni |
      #artist__casey_baugh Casey Baugh |
      #artist__chiara_bautista Chiara Bautista |
      #artist__herbert_bayer Herbert Bayer |
      #artist__mary_beale Mary Beale |
      #artist__alan_bean Alan Bean |
      #artist__romare_bearden Romare Bearden |
      #artist__cecil_beaton Cecil Beaton |
      #artist__cecilia_beaux Cecilia Beaux |
      #artist__jasmine_becket_griffith Jasmine Becket-Griffith |
      #artist__vanessa_beecroft Vanessa Beecroft |
      #artist__beeple Beeple |
      #artist__zdzislaw_beksinski Zdzisław Beksiński |
      #artist__katerina_belkina Katerina Belkina |
      #artist__julie_bell Julie Bell |
      #artist__vanessa_bell Vanessa Bell |
      #artist__bernardo_bellotto Bernardo Bellotto |
      #artist__ambrosius_benson Ambrosius Benson |
      #artist__stan_berenstain Stan Berenstain |
      #artist__laura_berger Laura Berger |
      #artist__jody_bergsma Jody Bergsma |
      #artist__john_berkey John Berkey |
      #artist__gian_lorenzo_bernini Gian Lorenzo Bernini |
      #artist__marta_bevacqua Marta Bevacqua |
      #artist__john_t_biggers John T. Biggers |
      #artist__enki_bilal Enki Bilal |
      #artist__ivan_bilibin Ivan Bilibin |
      #artist__butcher_billy Butcher Billy |
      #artist__george_caleb_bingham George Caleb Bingham |
      #artist__ed_binkley Ed Binkley |
      #artist__george_birrell George Birrell |
      #artist__robert_bissell Robert Bissell |
      #artist__charles_blackman Charles Blackman |
                             #artist__mary_blair Mary Blair |
                             #artist__john_blanche John Blanche |
                             #artist__don_blanding Don Blanding |
                             #artist__albert_bloch Albert Bloch |
                             #artist__hyman_bloom Hyman Bloom |
                             #artist__peter_blume Peter Blume |
                             #artist__don_bluth Don Bluth |
                             #artist__umberto_boccioni Umberto Boccioni |
                             #artist__anna_bocek Anna Bocek |
                             #artist__lee_bogle Lee Bogle |
                             #artist__louis_leopold_boily Louis-Léopold Boily |
                             #artist__giovanni_boldini Giovanni Boldini |
                             #artist__enoch_bolles Enoch Bolles |
                             #artist__david_bomberg David Bomberg |
                             #artist__chesley_bonestell Chesley Bonestell |
                             #artist__lee_bontecou Lee Bontecou |
                             #artist__michael_borremans Michael Borremans |
                             #artist__matt_bors Matt Bors |
                             #artist__flora_borsi Flora Borsi |
                             #artist__hieronymus_bosch Hieronymus Bosch |
                             #artist__sam_bosma Sam Bosma |
                             #artist__johfra_bosschart Johfra Bosschart |
                             #artist__fernando_botero Fernando Botero |
                             #artist__sandro_botticelli Sandro Botticelli |
                             #artist__william_adolphe_bouguereau William-Adolphe Bouguereau |
                             #artist__susan_seddon_boulet Susan Seddon Boulet |
                             #artist__louise_bourgeois Louise Bourgeois |
                             #artist__annick_bouvattier Annick Bouvattier |
                             #artist__david_michael_bowers David Michael Bowers |
                             #artist__noah_bradley Noah Bradley |
                             #artist__aleksi_briclot Aleksi Briclot |
                             #artist__frederick_arthur_bridgman Frederick Arthur Bridgman |
                             #artist__renie_britenbucher Renie Britenbucher |
                             #artist__romero_britto Romero Britto |
                             #artist__gerald_brom Gerald Brom |
                             #artist__bronzino Bronzino |
                             #artist__herman_brood Herman Brood |
                             #artist__mark_brooks Mark Brooks |
                             #artist__romaine_brooks Romaine Brooks |
                             #artist__troy_brooks Troy Brooks |
                             #artist__broom_lee Broom Lee |
                             #artist__allie_brosh Allie Brosh |
                             #artist__ford_madox_brown Ford Madox Brown |
                             #artist__charles_le_brun Charles Le Brun |
                             #artist__elisabeth_vigee_le_brun Élisabeth Vigée Le Brun |
                             #artist__james_bullough James Bullough |
                             #artist__laurel_burch Laurel Burch |
                             #artist__alejandro_burdisio Alejandro Burdisio |
                             #artist__daniel_buren Daniel Buren |
                             #artist__jon_burgerman Jon BurGerman |
                             #artist__richard_burlet Richard Burlet |
                             #artist__jim_burns Jim Burns |
                             #artist__stasia_burrington Stasia Burrington |
                             #artist__kaethe_butcher Kaethe Butcher |
                             #artist__saturno_butto Saturno Butto |
                             #artist__paul_cadmus Paul Cadmus |
                             #artist__zhichao_cai Zhichao Cai |
                             #artist__randolph_caldecott Randolph Caldecott |
                             #artist__alexander_calder_milne Alexander Calder Milne |
                             #artist__clyde_caldwell Clyde Caldwell |
                             #artist__vincent_callebaut Vincent Callebaut |
                             #artist__fred_calleri Fred Calleri |
                             #artist__charles_camoin Charles Camoin |
                             #artist__mike_campau Mike Campau |
                             #artist__eric_canete Eric Canete |
                             #artist__josef_capek Josef Capek |
                             #artist__leonetto_cappiello Leonetto Cappiello |
                             #artist__eric_carle Eric Carle |
                             #artist__larry_carlson Larry Carlson |
                             #artist__bill_carman Bill Carman |
                             #artist__jean_baptiste_carpeaux Jean-Baptiste Carpeaux |
                             #artist__rosalba_carriera Rosalba Carriera |
                             #artist__michael_carson Michael Carson |
                             #artist__felice_casorati Felice Casorati |
                             #artist__mary_cassatt Mary Cassatt |
                             #artist__a_j_casson A. J. Casson |
                             #artist__giorgio_barbarelli_da_castelfranco Giorgio Barbarelli da Castelfranco |
                             #artist__paul_catherall Paul Catherall |
                             #artist__george_catlin George Catlin |
                             #artist__patrick_caulfield Patrick Caulfield |
                             #artist__nicoletta_ceccoli Nicoletta Ceccoli |
                             #artist__agnes_cecile Agnes Cecile |
                             #artist__paul_cezanne Paul Cézanne |
                             #artist__paul_chabas Paul Chabas |
                             #artist__marc_chagall Marc Chagall |
                             #artist__tom_chambers Tom Chambers |
                             #artist__katia_chausheva Katia Chausheva |
                             #artist__hsiao_ron_cheng Hsiao-Ron Cheng |
                             #artist__yanjun_cheng Yanjun Cheng |
                             #artist__sandra_chevrier Sandra Chevrier |
                             #artist__judy_chicago Judy Chicago |
                             #artist__dale_chihuly Dale Chihuly |
                             #artist__frank_cho Frank Cho |
                             #artist__james_c_christensen James C. Christensen |
                             #artist__mikalojus_konstantinas_ciurlionis Mikalojus Konstantinas Ciurlionis |
                             #artist__alson_skinner_clark Alson Skinner Clark |
                             #artist__amanda_clark Amanda Clark |
                             #artist__harry_clarke Harry Clarke |
                             #artist__george_clausen George Clausen |
                             #artist__francesco_clemente Francesco Clemente |
                             #artist__alvin_langdon_coburn Alvin Langdon Coburn |
                             #artist__clifford_coffin Clifford Coffin |
                             #artist__vince_colletta Vince Colletta |
                             #artist__beth_conklin Beth Conklin |
                             #artist__john_constable John Constable |
                             #artist__darwyn_cooke Darwyn Cooke |
                             #artist__richard_corben Richard Corben |
                             #artist__vittorio_matteo_corcos Vittorio Matteo Corcos |
                             #artist__paul_corfield Paul Corfield |
                             #artist__fernand_cormon Fernand Cormon |
                             #artist__norman_cornish Norman Cornish |
                             #artist__camille_corot Camille Corot |
                             #artist__gemma_correll Gemma Correll |
                             #artist__petra_cortright Petra Cortright |
                                #artist__lorenzo_costa_the_elder Lorenzo Costa the Elder |
                                #artist__olive_cotton Olive Cotton |
                                #artist__peter_coulson Peter Coulson |
                                #artist__gustave_courbet Gustave Courbet |
                                #artist__frank_cadogan_cowper Frank Cadogan Cowper |
                                #artist__kinuko_y_craft Kinuko Y. Craft |
                                #artist__clayton_crain Clayton Crain |
                                #artist__lucas_cranach_the_elder Lucas Cranach the Elder |
                                #artist__lucas_cranach_the_younger Lucas Cranach the Younger |
                                #artist__walter_crane Walter Crane |
                                #artist__martin_creed Martin Creed |
                                #artist__gregory_crewdson Gregory Crewdson |
                                #artist__debbie_criswell Debbie Criswell |
                                #artist__victoria_crowe Victoria Crowe |
                                #artist__etam_cru Etam Cru |
                                #artist__robert_crumb Robert Crumb |
                                #artist__carlos_cruz_diez Carlos Cruz-Diez |
                                #artist__john_currin John Currin |
                                #artist__krenz_cushart Krenz Cushart |
                                #artist__camilla_derrico Camilla d'Errico |
      #artist__pino_daeni Pino Daeni |
      #artist__salvador_dali Salvador Dalí |
      #artist__sunil_das Sunil Das |
      #artist__ian_davenport Ian Davenport |
      #artist__stuart_davis Stuart Davis |
      #artist__roger_dean Roger Dean |
      #artist__michael_deforge Michael Deforge |
      #artist__edgar_degas Edgar Degas |
      #artist__eugene_delacroix Eugene Delacroix |
      #artist__robert_delaunay Robert Delaunay |
      #artist__sonia_delaunay Sonia Delaunay |
      #artist__gabriele_dellotto Gabriele Dell'otto |
                                #artist__nicolas_delort Nicolas Delort |
                                #artist__jean_delville Jean Delville |
                                #artist__posuka_demizu Posuka Demizu |
                                #artist__guy_denning Guy Denning |
                                #artist__monsu_desiderio Monsù Desiderio |
                                #artist__charles_maurice_detmold Charles Maurice Detmold |
                                #artist__edward_julius_detmold Edward Julius Detmold |
                                #artist__anne_dewailly Anne Dewailly |
                                #artist__walt_disney Walt Disney |
                                #artist__tony_diterlizzi Tony DiTerlizzi |
                                #artist__anna_dittmann Anna Dittmann |
                                #artist__dima_dmitriev Dima Dmitriev |
                                #artist__peter_doig Peter Doig |
                                #artist__kees_van_dongen Kees van Dongen |
                                #artist__gustave_dore Gustave Doré |
                                #artist__dave_dorman Dave Dorman |
                                #artist__emilio_giuseppe_dossena Emilio Giuseppe Dossena |
                                #artist__david_downton David Downton |
                                #artist__jessica_drossin Jessica Drossin |
                                #artist__philippe_druillet Philippe Druillet |
                                #artist__tj_drysdale TJ Drysdale |
                                #artist__ton_dubbeldam Ton Dubbeldam |
                                #artist__marcel_duchamp Marcel Duchamp |
                                #artist__joseph_ducreux Joseph Ducreux |
                                #artist__edmund_dulac Edmund Dulac |
                                #artist__marlene_dumas Marlene Dumas |
                                #artist__charles_dwyer Charles Dwyer |
                                #artist__william_dyce William Dyce |
                                #artist__chris_dyer Chris Dyer |
                                #artist__eyvind_earle Eyvind Earle |
                                #artist__amy_earles Amy Earles |
                                #artist__lori_earley Lori Earley |
                                #artist__jeff_easley Jeff Easley |
                                #artist__tristan_eaton Tristan Eaton |
                                #artist__jason_edmiston Jason Edmiston |
                                #artist__alfred_eisenstaedt Alfred Eisenstaedt |
                                #artist__jesper_ejsing Jesper Ejsing |
                                #artist__olafur_eliasson Olafur Eliasson |
                                #artist__harrison_ellenshaw Harrison Ellenshaw |
                                #artist__christine_ellger Christine Ellger |
                                #artist__larry_elmore Larry Elmore |
                                #artist__joseba_elorza Joseba Elorza |
                                #artist__peter_elson Peter Elson |
                                #artist__gil_elvgren Gil Elvgren |
                                #artist__ed_emshwiller Ed Emshwiller |
                                #artist__kilian_eng Kilian Eng |
                                #artist__jason_a_engle Jason A. Engle |
                                #artist__max_ernst Max Ernst |
                                #artist__romain_de_tirtoff_erte Romain de Tirtoff Erté |
                                #artist__m_c_escher M. C. Escher |
                                #artist__tim_etchells Tim Etchells |
                                #artist__walker_evans Walker Evans |
                                #artist__jan_van_eyck Jan van Eyck |
                                #artist__glenn_fabry Glenn Fabry |
                                #artist__ludwig_fahrenkrog Ludwig Fahrenkrog |
                                #artist__shepard_fairey Shepard Fairey |
                                #artist__andy_fairhurst Andy Fairhurst |
                                #artist__luis_ricardo_falero Luis Ricardo Falero |
                                #artist__jean_fautrier Jean Fautrier |
                                #artist__andrew_ferez Andrew Ferez |
                                #artist__hugh_ferriss Hugh Ferriss |
                                #artist__david_finch David Finch |
                                #artist__callie_fink Callie Fink |
                                #artist__virgil_finlay Virgil Finlay |
                                #artist__anato_finnstark Anato Finnstark |
                                #artist__howard_finster Howard Finster |
                                #artist__oskar_fischinger Oskar Fischinger |
                                #artist__samuel_melton_fisher Samuel Melton Fisher |
                                #artist__john_anster_fitzgerald John Anster Fitzgerald |
                                #artist__tony_fitzpatrick Tony Fitzpatrick |
                                #artist__hippolyte_flandrin Hippolyte Flandrin |
                                #artist__dan_flavin Dan Flavin |
                                #artist__max_fleischer Max Fleischer |
                                #artist__govaert_flinck Govaert Flinck |
                                #artist__alex_russell_flint Alex Russell Flint |
                                #artist__lucio_fontana Lucio Fontana |
                                #artist__chris_foss Chris Foss |
                                #artist__jon_foster Jon Foster |
                                #artist__jean_fouquet Jean Fouquet |
                                #artist__toby_fox Toby Fox |
                                #artist__art_frahm Art Frahm |
                                #artist__lisa_frank Lisa Frank |
                                #artist__helen_frankenthaler Helen Frankenthaler |
                                #artist__frank_frazetta Frank Frazetta |
                                #artist__kelly_freas Kelly Freas |
                                #artist__lucian_freud Lucian Freud |
                                #artist__brian_froud Brian Froud |
                                #artist__wendy_froud Wendy Froud |
                                #artist__tom_fruin Tom Fruin |
                                #artist__john_wayne_gacy John Wayne Gacy |
                                #artist__justin_gaffrey Justin Gaffrey |
                                #artist__hashimoto_gaho Hashimoto Gahō |
                                #artist__neil_gaiman Neil Gaiman |
                                #artist__stephen_gammell Stephen Gammell |
                                #artist__hope_gangloff Hope Gangloff |
                                #artist__alex_garant Alex Garant |
                                #artist__gilbert_garcin Gilbert Garcin |
                                #artist__michael_and_inessa_garmash Michael and Inessa Garmash |
                                #artist__antoni_gaudi Antoni Gaudi |
                                #artist__jack_gaughan Jack Gaughan |
                                #artist__paul_gauguin Paul Gauguin |
                                #artist__giovanni_battista_gaulli Giovanni Battista Gaulli |
                                #artist__anne_geddes Anne Geddes |
                                #artist__bill_gekas Bill Gekas |
                                #artist__artemisia_gentileschi Artemisia Gentileschi |
                                #artist__orazio_gentileschi Orazio Gentileschi |
                                #artist__daniel_f_gerhartz Daniel F. Gerhartz |
                                #artist__theodore_gericault Théodore Géricault |
                                #artist__jean_leon_gerome Jean-Léon Gérôme |
                                #artist__mark_gertler Mark Gertler |
                                #artist__atey_ghailan Atey Ghailan |
                                #artist__alberto_giacometti Alberto Giacometti |
                                #artist__donato_giancola Donato Giancola |
                                #artist__hr_giger H.R. Giger |
                                #artist__james_gilleard James Gilleard |
                                #artist__harold_gilman Harold Gilman |
                                #artist__charles_ginner Charles Ginner |
                                #artist__jean_giraud Jean Giraud |
                                #artist__anne_louis_girodet Anne-Louis Girodet |
                                #artist__milton_glaser Milton Glaser |
                                #artist__warwick_goble Warwick Goble |
                                #artist__john_william_godward John William Godward |
                                #artist__sacha_goldberger Sacha Goldberger |
                                #artist__nan_goldin Nan Goldin |
                                #artist__josan_gonzalez Josan Gonzalez |
                                #artist__felix_gonzalez_torres Felix Gonzalez-Torres |
                                #artist__derek_gores Derek Gores |
                                #artist__edward_gorey Edward Gorey |
                                #artist__arshile_gorky Arshile Gorky |
                                #artist__alessandro_gottardo Alessandro Gottardo |
                                #artist__adolph_gottlieb Adolph Gottlieb |
                                #artist__francisco_goya Francisco Goya |
                                #artist__laurent_grasso Laurent Grasso |
                                #artist__mab_graves Mab Graves |
                                #artist__eileen_gray Eileen Gray |
                                #artist__kate_greenaway Kate Greenaway |
                                #artist__alex_grey Alex Grey |
                                #artist__carne_griffiths Carne Griffiths |
                                #artist__gris_grimly Gris Grimly |
                                #artist__brothers_grimm Brothers Grimm |
                                #artist__tracie_grimwood Tracie Grimwood |
                                #artist__matt_groening Matt Groening |
                                #artist__alex_gross Alex Gross |
                                #artist__tom_grummett Tom Grummett |
                                #artist__huang_guangjian Huang Guangjian |
                                #artist__wu_guanzhong Wu Guanzhong |
                                #artist__rebecca_guay Rebecca Guay |
                                #artist__guercino Guercino |
                                #artist__jeannette_guichard_bunel Jeannette Guichard-Bunel |
                                #artist__scott_gustafson Scott Gustafson |
                                #artist__wade_guyton Wade Guyton |
                                #artist__hans_haacke Hans Haacke |
                                #artist__robert_hagan Robert Hagan |
                                #artist__philippe_halsman Philippe Halsman |
                                #artist__maggi_hambling Maggi Hambling |
                                #artist__richard_hamilton Richard Hamilton |
                                #artist__bess_hamiti Bess Hamiti |
                                #artist__tom_hammick Tom Hammick |
                                #artist__david_hammons David Hammons |
                                #artist__ren_hang Ren Hang |
                                #artist__erin_hanson Erin Hanson |
                                #artist__keith_haring Keith Haring |
                                #artist__alexei_harlamoff Alexei Harlamoff |
                                #artist__charley_harper Charley Harper |
                                #artist__john_harris John Harris |
                                #artist__florence_harrison Florence Harrison |
                                #artist__marsden_hartley Marsden Hartley |
                                #artist__ryohei_hase Ryohei Hase |
                                #artist__childe_hassam Childe Hassam |
                                #artist__ben_hatke Ben Hatke |
                                #artist__mona_hatoum Mona Hatoum |
                                #artist__pam_hawkes Pam Hawkes |
                                #artist__jamie_hawkesworth Jamie Hawkesworth |
                                #artist__stuart_haygarth Stuart Haygarth |
                                #artist__erich_heckel Erich Heckel |
                                #artist__valerie_hegarty Valerie Hegarty |
                                #artist__mary_heilmann Mary Heilmann |
                                #artist__michael_heizer Michael Heizer |
                                #artist__gottfried_helnwein Gottfried Helnwein |
                                #artist__barkley_l_hendricks Barkley L. Hendricks |
                                #artist__bill_henson Bill Henson |
                                #artist__barbara_hepworth Barbara Hepworth |
                                #artist__herge Hergé |
                                #artist__carolina_herrera Carolina Herrera |
                                #artist__george_herriman George Herriman |
                                #artist__don_hertzfeldt Don Hertzfeldt |
                                #artist__prudence_heward Prudence Heward |
                                #artist__ryan_hewett Ryan Hewett |
                                #artist__nora_heysen Nora Heysen |
                                #artist__george_elgar_hicks George Elgar Hicks |
                                #artist__lorenz_hideyoshi Lorenz Hideyoshi |
                                #artist__brothers_hildebrandt Brothers Hildebrandt |
                                #artist__dan_hillier Dan Hillier |
                                #artist__lewis_hine Lewis Hine |
                                #artist__miho_hirano Miho Hirano |
                                #artist__harumi_hironaka Harumi Hironaka |
                                #artist__hiroshige Hiroshige |
                                #artist__morris_hirshfield Morris Hirshfield |
                                #artist__damien_hirst Damien Hirst |
                                #artist__fan_ho Fan Ho |
                                #artist__meindert_hobbema Meindert Hobbema |
                                #artist__david_hockney David Hockney |
                                #artist__filip_hodas Filip Hodas |
                                #artist__howard_hodgkin Howard Hodgkin |
                                #artist__ferdinand_hodler Ferdinand Hodler |
                                #artist__tiago_hoisel Tiago Hoisel |
                                #artist__katsushika_hokusai Katsushika Hokusai |
                                #artist__hans_holbein_the_younger Hans Holbein the Younger |
                                #artist__frank_holl Frank Holl |
                                #artist__carsten_holler Carsten Holler |
                                #artist__zena_holloway Zena Holloway |
                                #artist__edward_hopper Edward Hopper |
                                #artist__aaron_horkey Aaron Horkey |
                                #artist__alex_horley Alex Horley |
                                #artist__roni_horn Roni Horn |
                                #artist__john_howe John Howe |
                                #artist__alex_howitt Alex Howitt |
                                #artist__meghan_howland Meghan Howland |
                                #artist__john_hoyland John Hoyland |
                                #artist__shilin_huang Shilin Huang |
                                #artist__arthur_hughes Arthur Hughes |
                                #artist__edward_robert_hughes Edward Robert Hughes |
                                #artist__jack_hughes Jack Hughes |
                                #artist__talbot_hughes Talbot Hughes |
                                #artist__pieter_hugo Pieter Hugo |
                                #artist__gary_hume Gary Hume |
                                #artist__friedensreich_hundertwasser Friedensreich Hundertwasser |
                                #artist__william_holman_hunt William Holman Hunt |
                                #artist__george_hurrell George Hurrell |
                                #artist__fabio_hurtado Fabio Hurtado |
                                #artist__hush HUSH |
                                #artist__michael_hutter Michael Hutter |
                                #artist__pierre_huyghe Pierre Huyghe |
                                #artist__doug_hyde Doug Hyde |
                                #artist__louis_icart Louis Icart |
                                #artist__robert_indiana Robert Indiana |
                                #artist__jean_auguste_dominique_ingres Jean Auguste Dominique Ingres |
                                #artist__robert_irwin Robert Irwin |
                                #artist__gabriel_isak Gabriel Isak |
                                #artist__junji_ito Junji Ito |
                                #artist__christophe_jacrot Christophe Jacrot |
                                #artist__louis_janmot Louis Janmot |
                                #artist__frieke_janssens Frieke Janssens |
                                #artist__alexander_jansson Alexander Jansson |
                                #artist__tove_jansson Tove Jansson |
                                #artist__aaron_jasinski Aaron Jasinski |
                                #artist__alexej_von_jawlensky Alexej von Jawlensky |
                                #artist__james_jean James Jean |
                                #artist__oliver_jeffers Oliver Jeffers |
                                #artist__lee_jeffries Lee Jeffries |
                                #artist__georg_jensen Georg Jensen |
                                #artist__ellen_jewett Ellen Jewett |
                                #artist__he_jiaying He Jiaying |
                                #artist__chantal_joffe Chantal Joffe |
                                #artist__martine_johanna Martine Johanna |
                                #artist__augustus_john Augustus John |
                                #artist__gwen_john Gwen John |
                                #artist__jasper_johns Jasper Johns |
                                #artist__eastman_johnson Eastman Johnson |
                                #artist__alfred_cheney_johnston Alfred Cheney Johnston |
                                #artist__dorothy_johnstone Dorothy Johnstone |
                                #artist__android_jones Android Jones |
                                #artist__erik_jones Erik Jones |
                                #artist__jeffrey_catherine_jones Jeffrey Catherine Jones |
                                #artist__peter_andrew_jones Peter Andrew Jones |
                                #artist__loui_jover Loui Jover |
                                #artist__amy_judd Amy Judd |
                                #artist__donald_judd Donald Judd |
                                #artist__jean_jullien Jean Jullien |
                                #artist__matthias_jung Matthias Jung |
                                #artist__joe_jusko Joe Jusko |
                                #artist__frida_kahlo Frida Kahlo |
                                #artist__hayv_kahraman Hayv Kahraman |
                                #artist__mw_kaluta M.W. Kaluta |
                                #artist__nadav_kander Nadav Kander |
                                #artist__wassily_kandinsky Wassily Kandinsky |
                                #artist__jun_kaneko Jun Kaneko |
                                #artist__titus_kaphar Titus Kaphar |
                                #artist__michal_karcz Michal Karcz |
                                #artist__gertrude_kasebier Gertrude Käsebier |
                                #artist__terada_katsuya Terada Katsuya |
                                #artist__audrey_kawasaki Audrey Kawasaki |
                                #artist__hasui_kawase Hasui Kawase |
                                #artist__glen_keane Glen Keane |
                                #artist__margaret_keane Margaret Keane |
                                #artist__ellsworth_kelly Ellsworth Kelly |
                                #artist__michael_kenna Michael Kenna |
                                #artist__thomas_benjamin_kennington Thomas Benjamin Kennington |
                                #artist__william_kentridge William Kentridge |
                                #artist__hendrik_kerstens Hendrik Kerstens |
                                #artist__jeremiah_ketner Jeremiah Ketner |
                                #artist__fernand_khnopff Fernand Khnopff |
                                #artist__hideyuki_kikuchi Hideyuki Kikuchi |
                                #artist__tom_killion Tom Killion |
                                #artist__thomas_kinkade Thomas Kinkade |
                                #artist__jack_kirby Jack Kirby |
                                #artist__ernst_ludwig_kirchner Ernst Ludwig Kirchner |
                                #artist__tatsuro_kiuchi Tatsuro Kiuchi |
                                #artist__jon_klassen Jon Klassen |
                                #artist__paul_klee Paul Klee |
                                #artist__william_klein William Klein |
                                #artist__yves_klein Yves Klein |
                                #artist__carl_kleiner Carl Kleiner |
                                #artist__gustav_klimt Gustav Klimt |
                                #artist__godfrey_kneller Godfrey Kneller |
                                #artist__emily_kame_kngwarreye Emily Kame Kngwarreye |
                                #artist__chad_knight Chad Knight |
                                #artist__nick_knight Nick Knight |
                                #artist__helene_knoop Helene Knoop |
                                #artist__phil_koch Phil Koch |
                                #artist__kazuo_koike Kazuo Koike |
                                #artist__oskar_kokoschka Oskar Kokoschka |
                                #artist__kathe_kollwitz Käthe Kollwitz |
                                #artist__michael_komarck Michael Komarck |
                                #artist__satoshi_kon Satoshi Kon |
                                #artist__jeff_koons Jeff Koons |
                                #artist__caia_koopman Caia Koopman |
                                #artist__konstantin_korovin Konstantin Korovin |
                                #artist__mark_kostabi Mark Kostabi |
                                #artist__bella_kotak Bella Kotak |
                                #artist__andrea_kowch Andrea Kowch |
                                #artist__lee_krasner Lee Krasner |
                                #artist__barbara_kruger Barbara Kruger |
                                #artist__brad_kunkle Brad Kunkle |
                                #artist__yayoi_kusama Yayoi Kusama |
                                #artist__michael_k_kutsche Michael K Kutsche |
                                #artist__ilya_kuvshinov Ilya Kuvshinov |
                                #artist__david_lachapelle David LaChapelle |
                                #artist__raphael_lacoste Raphael Lacoste |
                                #artist__lev_lagorio Lev Lagorio |
                                #artist__rene_lalique René Lalique |
                                #artist__abigail_larson Abigail Larson |
                                #artist__gary_larson Gary Larson |
                                #artist__denys_lasdun Denys Lasdun |
                                #artist__maria_lassnig Maria Lassnig |
                                #artist__dorothy_lathrop Dorothy Lathrop |
                                #artist__melissa_launay Melissa Launay |
                                #artist__john_lavery John Lavery |
                                #artist__jacob_lawrence Jacob Lawrence |
                                #artist__thomas_lawrence Thomas Lawrence |
                                #artist__ernest_lawson Ernest Lawson |
                                #artist__bastien_lecouffe_deharme Bastien Lecouffe-Deharme |
                                #artist__alan_lee Alan Lee |
                                #artist__minjae_lee Minjae Lee |
                                #artist__nina_leen Nina Leen |
                                #artist__fernand_leger Fernand Leger |
                                #artist__paul_lehr Paul Lehr |
                                #artist__frederic_leighton Frederic Leighton |
                                #artist__alayna_lemmer Alayna Lemmer |
                                #artist__tamara_de_lempicka Tamara de Lempicka |
                                #artist__sol_lewitt Sol LeWitt |
                                #artist__jc_leyendecker J.C. Leyendecker |
                                #artist__andre_lhote André Lhote |
                                #artist__roy_lichtenstein Roy Lichtenstein |
                                #artist__rob_liefeld Rob Liefeld |
                                #artist__fang_lijun Fang Lijun |
                                #artist__maya_lin Maya Lin |
                                #artist__filippino_lippi Filippino Lippi |
                                #artist__herbert_list Herbert List |
                                #artist__richard_long Richard Long |
                                #artist__yoann_lossel Yoann Lossel |
                                #artist__morris_louis Morris Louis |
                                #artist__sarah_lucas Sarah Lucas |
                                #artist__maximilien_luce Maximilien Luce |
                                #artist__loretta_lux Loretta Lux |
                                #artist__george_platt_lynes George Platt Lynes |
                                #artist__frances_macdonald Frances MacDonald |
                                #artist__august_macke August Macke |
                                #artist__stephen_mackey Stephen Mackey |
                                #artist__rachel_maclean Rachel Maclean |
                                #artist__raimundo_de_madrazo_y_garreta Raimundo de Madrazo y Garreta |
                                #artist__joe_madureira Joe Madureira |
                                #artist__rene_magritte Rene Magritte |
                                #artist__jim_mahfood Jim Mahfood |
                                #artist__vivian_maier Vivian Maier |
                                #artist__aristide_maillol Aristide Maillol |
                                #artist__don_maitz Don Maitz |
                                #artist__laura_makabresku Laura Makabresku |
                                #artist__alex_maleev Alex Maleev |
                                #artist__keith_mallett Keith Mallett |
                                #artist__johji_manabe Johji Manabe |
                                #artist__milo_manara Milo Manara |
                                #artist__edouard_manet Édouard Manet |
                                #artist__henri_manguin Henri Manguin |
                                #artist__jeremy_mann Jeremy Mann |
                                #artist__sally_mann Sally Mann |
                                #artist__andrea_mantegna Andrea Mantegna |
                                #artist__antonio_j_manzanedo Antonio J. Manzanedo |
                                #artist__robert_mapplethorpe Robert Mapplethorpe |
                                #artist__franz_marc Franz Marc |
                                #artist__ivan_marchuk Ivan Marchuk |
                                #artist__brice_marden Brice Marden |
                                #artist__andrei_markin Andrei Markin |
                                #artist__kerry_james_marshall Kerry James Marshall |
                                #artist__serge_marshennikov Serge Marshennikov |
                                #artist__agnes_martin Agnes Martin |
                                #artist__adam_martinakis Adam Martinakis |
                                #artist__stephan_martiniere Stephan Martinière |
                                #artist__ilya_mashkov Ilya Mashkov |
                                #artist__henri_matisse Henri Matisse |
                                #artist__rodney_matthews Rodney Matthews |
                                #artist__anton_mauve Anton Mauve |
                                #artist__peter_max Peter Max |
                                #artist__mike_mayhew Mike Mayhew |
                                #artist__angus_mcbride Angus McBride |
                                #artist__anne_mccaffrey Anne McCaffrey |
                                #artist__robert_mccall Robert McCall |
                                #artist__scott_mccloud Scott McCloud |
                                #artist__steve_mccurry Steve McCurry |
                                #artist__todd_mcfarlane Todd McFarlane |
                                #artist__barry_mcgee Barry McGee |
                                #artist__ryan_mcginley Ryan McGinley |
                                #artist__robert_mcginnis Robert McGinnis |
                                #artist__richard_mcguire Richard McGuire |
                                #artist__patrick_mchale Patrick McHale |
                                #artist__kelly_mckernan Kelly McKernan |
                                #artist__angus_mckie Angus McKie |
                                #artist__alasdair_mclellan Alasdair McLellan |
                                #artist__jon_mcnaught Jon McNaught |
                                #artist__dan_mcpharlin Dan McPharlin |
                                #artist__tara_mcpherson Tara McPherson |
                                #artist__ralph_mcquarrie Ralph McQuarrie |
                                #artist__ian_mcque Ian McQue |
                                #artist__syd_mead Syd Mead |
                                #artist__richard_meier Richard Meier |
                                #artist__maria_sibylla_merian Maria Sibylla Merian |
                                #artist__willard_metcalf Willard Metcalf |
                                #artist__gabriel_metsu Gabriel Metsu |
                                #artist__jean_metzinger Jean Metzinger |
                                #artist__michelangelo Michelangelo |
                                #artist__nicolas_mignard Nicolas Mignard |
                                #artist__mike_mignola Mike Mignola |
                                #artist__dimitra_milan Dimitra Milan |
                                #artist__john_everett_millais John Everett Millais |
                                #artist__marilyn_minter Marilyn Minter |
                                #artist__januz_miralles Januz Miralles |
                                #artist__joan_miro Joan Miró |
                                #artist__joan_mitchell Joan Mitchell |
                                #artist__hayao_miyazaki Hayao Miyazaki |
                                #artist__paula_modersohn_becker Paula Modersohn-Becker |
                                #artist__amedeo_modigliani Amedeo Modigliani |
                                #artist__moebius Moebius |
                                #artist__peter_mohrbacher Peter Mohrbacher |
                                #artist__piet_mondrian Piet Mondrian |
                                #artist__claude_monet Claude Monet |
                                #artist__jean_baptiste_monge Jean-Baptiste Monge |
                                #artist__alyssa_monks Alyssa Monks |
                                #artist__alan_moore Alan Moore |
                                #artist__antonio_mora Antonio Mora |
                                #artist__edward_moran Edward Moran |
                                #artist__koji_morimoto Kōji Morimoto |
                                #artist__berthe_morisot Berthe Morisot |
                                #artist__daido_moriyama Daido Moriyama |
                                #artist__james_wilson_morrice James Wilson Morrice |
                                #artist__sarah_morris Sarah Morris |
                                #artist__john_lowrie_morrison John Lowrie Morrison |
                                #artist__igor_morski Igor Morski |
                                #artist__john_kenn_mortensen John Kenn Mortensen |
                                #artist__victor_moscoso Victor Moscoso |
                                #artist__inna_mosina Inna Mosina |
                                #artist__richard_mosse Richard Mosse |
                                #artist__thomas_edwin_mostyn Thomas Edwin Mostyn |
                                #artist__marcel_mouly Marcel Mouly |
                                #artist__emmanuelle_moureaux Emmanuelle Moureaux |
                                #artist__alphonse_mucha Alphonse Mucha |
                                #artist__craig_mullins Craig Mullins |
                                #artist__augustus_edwin_mulready Augustus Edwin Mulready |
                                #artist__dan_mumford Dan Mumford |
                                #artist__edvard_munch Edvard Munch |
                                #artist__alfred_munnings Alfred Munnings |
                                #artist__gabriele_munter Gabriele Münter |
                                #artist__takashi_murakami Takashi Murakami |
                                #artist__patrice_murciano Patrice Murciano |
                                #artist__scott_musgrove Scott Musgrove |
                                #artist__wangechi_mutu Wangechi Mutu |
                                #artist__go_nagai Go Nagai |
                                #artist__hiroshi_nagai Hiroshi Nagai |
                                #artist__patrick_nagel Patrick Nagel |
                                #artist__tibor_nagy Tibor Nagy |
                                #artist__scott_naismith Scott Naismith |
                                #artist__juliana_nan Juliana Nan |
                                #artist__ted_nasmith Ted Nasmith |
                                #artist__todd_nauck Todd Nauck |
                                #artist__bruce_nauman Bruce Nauman |
                                #artist__ernst_wilhelm_nay Ernst Wilhelm Nay |
                                #artist__alice_neel Alice Neel |
                                #artist__keith_negley Keith Negley |
                                #artist__leroy_neiman LeRoy Neiman |
                                #artist__kadir_nelson Kadir Nelson |
                                #artist__odd_nerdrum Odd Nerdrum |
                                #artist__shirin_neshat Shirin Neshat |
                                #artist__mikhail_nesterov Mikhail Nesterov |
                                #artist__jane_newland Jane Newland |
                                #artist__victo_ngai Victo Ngai |
                                #artist__william_nicholson William Nicholson |
                                #artist__florian_nicolle Florian Nicolle |
                                #artist__kay_nielsen Kay Nielsen |
                                #artist__tsutomu_nihei Tsutomu Nihei |
                                #artist__victor_nizovtsev Victor Nizovtsev |
                                #artist__isamu_noguchi Isamu Noguchi |
                                #artist__catherine_nolin Catherine Nolin |
                                #artist__francois_de_nome François De Nomé |
                                #artist__earl_norem Earl Norem |
                                #artist__phil_noto Phil Noto |
                                #artist__georgia_okeeffe Georgia O'Keeffe |
      #artist__terry_oakes Terry Oakes |
      #artist__chris_ofili Chris Ofili |
      #artist__jack_ohman Jack Ohman |
      #artist__noriyoshi_ohrai Noriyoshi Ohrai |
      #artist__helio_oiticica Helio Oiticica |
      #artist__taro_okamoto Tarō Okamoto |
      #artist__tim_okamura Tim Okamura |
      #artist__naomi_okubo Naomi Okubo |
      #artist__atelier_olschinsky Atelier Olschinsky |
      #artist__greg_olsen Greg Olsen |
      #artist__oleg_oprisco Oleg Oprisco |
      #artist__tony_orrico Tony Orrico |
      #artist__mamoru_oshii Mamoru Oshii |
      #artist__ida_rentoul_outhwaite Ida Rentoul Outhwaite |
      #artist__yigal_ozeri Yigal Ozeri |
      #artist__gabriel_pacheco Gabriel Pacheco |
      #artist__michael_page Michael Page |
      #artist__rui_palha Rui Palha |
      #artist__polixeni_papapetrou Polixeni Papapetrou |
      #artist__julio_le_parc Julio Le Parc |
      #artist__michael_parkes Michael Parkes |
      #artist__philippe_parreno Philippe Parreno |
      #artist__maxfield_parrish Maxfield Parrish |
      #artist__alice_pasquini Alice Pasquini |
      #artist__james_mcintosh_patrick James McIntosh Patrick |
      #artist__john_pawson John Pawson |
      #artist__max_pechstein Max Pechstein |
      #artist__agnes_lawrence_pelton Agnes Lawrence Pelton |
      #artist__irving_penn Irving Penn |
      #artist__bruce_pennington Bruce Pennington |
      #artist__john_perceval John Perceval |
      #artist__george_perez George Perez |
      #artist__constant_permeke Constant Permeke |
      #artist__lilla_cabot_perry Lilla Cabot Perry |
      #artist__gaetano_pesce Gaetano Pesce |
      #artist__cleon_peterson Cleon Peterson |
      #artist__daria_petrilli Daria Petrilli |
      #artist__raymond_pettibon Raymond Pettibon |
      #artist__coles_phillips Coles Phillips |
      #artist__francis_picabia Francis Picabia |
      #artist__pablo_picasso Pablo Picasso |
      #artist__sopheap_pich Sopheap Pich |
      #artist__otto_piene Otto Piene |
      #artist__jerry_pinkney Jerry Pinkney |
      #artist__pinturicchio Pinturicchio |
      #artist__sebastiano_del_piombo Sebastiano del Piombo |
      #artist__camille_pissarro Camille Pissarro |
      #artist__ferris_plock Ferris Plock |
      #artist__bill_plympton Bill Plympton |
      #artist__willy_pogany Willy Pogany |
      #artist__patricia_polacco Patricia Polacco |
      #artist__jackson_pollock Jackson Pollock |
      #artist__beatrix_potter Beatrix Potter |
      #artist__edward_henry_potthast Edward Henry Potthast |
      #artist__simon_prades Simon Prades |
      #artist__maurice_prendergast Maurice Prendergast |
      #artist__dod_procter Dod Procter |
      #artist__leo_putz Leo Putz |
      #artist__howard_pyle Howard Pyle |
      #artist__arthur_rackham Arthur Rackham |
      #artist__natalia_rak Natalia Rak |
      #artist__paul_ranson Paul Ranson |
      #artist__raphael Raphael |
      #artist__abraham_rattner Abraham Rattner |
      #artist__jan_van_ravesteyn Jan van Ravesteyn |
      #artist__aliza_razell Aliza Razell |
      #artist__paula_rego Paula Rego |
      #artist__lotte_reiniger Lotte Reiniger |
      #artist__valentin_rekunenko Valentin Rekunenko |
      #artist__christoffer_relander Christoffer Relander |
      #artist__andrey_remnev Andrey Remnev |
      #artist__pierre_auguste_renoir Pierre-Auguste Renoir |
      #artist__ilya_repin Ilya Repin |
      #artist__joshua_reynolds Joshua Reynolds |
      #artist__rhads RHADS |
      #artist__bettina_rheims Bettina Rheims |
      #artist__jason_rhoades Jason Rhoades |
      #artist__georges_ribemont_dessaignes Georges Ribemont-Dessaignes |
      #artist__jusepe_de_ribera Jusepe de Ribera |
      #artist__gerhard_richter Gerhard Richter |
      #artist__chris_riddell Chris Riddell |
      #artist__hyacinthe_rigaud Hyacinthe Rigaud |
      #artist__rembrandt_van_rijn Rembrandt van Rijn |
      #artist__faith_ringgold Faith Ringgold |
      #artist__jozsef_rippl_ronai József Rippl-Rónai |
      #artist__pipilotti_rist Pipilotti Rist |
      #artist__charles_robinson Charles Robinson |
      #artist__theodore_robinson Theodore Robinson |
      #artist__kenneth_rocafort Kenneth Rocafort |
      #artist__andreas_rocha Andreas Rocha |
                                #artist__norman_rockwell Norman Rockwell |
                                #artist__ludwig_mies_van_der_rohe Ludwig Mies van der Rohe |
                                #artist__fatima_ronquillo Fatima Ronquillo |
                                #artist__salvator_rosa Salvator Rosa |
                                #artist__kerby_rosanes Kerby Rosanes |
                                #artist__conrad_roset Conrad Roset |
                                #artist__bob_ross Bob Ross |
                                #artist__dante_gabriel_rossetti Dante Gabriel Rossetti |
                                #artist__jessica_rossier Jessica Rossier |
                                #artist__marianna_rothen Marianna Rothen |
                                #artist__mark_rothko Mark Rothko |
                                #artist__eva_rothschild Eva Rothschild |
                                #artist__georges_rousse Georges Rousse |
                                #artist__luis_royo Luis Royo |
                                #artist__joao_ruas Joao Ruas |
                                #artist__peter_paul_rubens Peter Paul Rubens |
                                #artist__rachel_ruysch Rachel Ruysch |
                                #artist__albert_pinkham_ryder Albert Pinkham Ryder |
                                #artist__mark_ryden Mark Ryden |
                                #artist__ursula_von_rydingsvard Ursula von Rydingsvard |
                                #artist__theo_van_rysselberghe Theo van Rysselberghe |
                                #artist__eero_saarinen Eero Saarinen |
                                #artist__wlad_safronow Wlad Safronow |
                                #artist__amanda_sage Amanda Sage |
                                #artist__antoine_de_saint_exupery Antoine de Saint-Exupery |
                                #artist__nicola_samori Nicola Samori |
                                #artist__rebeca_saray Rebeca Saray |
                                #artist__john_singer_sargent John Singer Sargent |
                                #artist__martiros_saryan Martiros Saryan |
                                #artist__viviane_sassen Viviane Sassen |
                                #artist__nike_savvas Nike Savvas |
                                #artist__richard_scarry Richard Scarry |
                                #artist__godfried_schalcken Godfried Schalcken |
                                #artist__miriam_schapiro Miriam Schapiro |
                                #artist__kenny_scharf Kenny Scharf |
                                #artist__jerry_schatzberg Jerry Schatzberg |
                                #artist__ary_scheffer Ary Scheffer |
                                #artist__kees_scherer Kees Scherer |
                                #artist__helene_schjerfbeck Helene Schjerfbeck |
                                #artist__christian_schloe Christian Schloe |
                                #artist__karl_schmidt_rottluff Karl Schmidt-Rottluff |
                                #artist__julian_schnabel Julian Schnabel |
                                #artist__fritz_scholder Fritz Scholder |
                                #artist__charles_schulz Charles Schulz |
                                #artist__sean_scully Sean Scully |
                                #artist__ronald_searle Ronald Searle |
                                #artist__mark_seliger Mark Seliger |
                                #artist__anton_semenov Anton Semenov |
                                #artist__edmondo_senatore Edmondo Senatore |
                                #artist__maurice_sendak Maurice Sendak |
                                #artist__richard_serra Richard Serra |
                                #artist__georges_seurat Georges Seurat |
                                #artist__dr_seuss Dr. Seuss |
                                #artist__tanya_shatseva Tanya Shatseva |
                                #artist__natalie_shau Natalie Shau |
                                #artist__barclay_shaw Barclay Shaw |
                                #artist__e_h_shepard E. H. Shepard |
                                #artist__amrita_sher_gil Amrita Sher-Gil |
                                #artist__irene_sheri Irene Sheri |
                                #artist__duffy_sheridan Duffy Sheridan |
                                #artist__cindy_sherman Cindy Sherman |
                                #artist__shozo_shimamoto Shozo Shimamoto |
                                #artist__hikari_shimoda Hikari Shimoda |
                                #artist__makoto_shinkai Makoto Shinkai |
                                #artist__chiharu_shiota Chiharu Shiota |
                                #artist__elizabeth_shippen_green Elizabeth Shippen Green |
                                #artist__masamune_shirow Masamune Shirow |
                                #artist__tim_shumate Tim Shumate |
                                #artist__yuri_shwedoff Yuri Shwedoff |
                                #artist__malick_sidibe Malick Sidibé |
                                #artist__jeanloup_sieff Jeanloup Sieff |
                                #artist__bill_sienkiewicz Bill Sienkiewicz |
                                #artist__marc_simonetti Marc Simonetti |
                                #artist__david_sims David Sims |
                                #artist__andy_singer Andy Singer |
                                #artist__alfred_sisley Alfred Sisley |
                                #artist__sandy_skoglund Sandy Skoglund |
                                #artist__jeffrey_smart Jeffrey Smart |
                                #artist__berndnaut_smilde Berndnaut Smilde |
                                #artist__rodney_smith Rodney Smith |
                                #artist__samantha_keely_smith Samantha Keely Smith |
                                #artist__robert_smithson Robert Smithson |
                                #artist__barbara_stauffacher_solomon Barbara Stauffacher Solomon |
                                #artist__simeon_solomon Simeon Solomon |
                                #artist__hajime_sorayama Hajime Sorayama |
                                #artist__joaquin_sorolla Joaquín Sorolla |
                                #artist__ettore_sottsass Ettore Sottsass |
                                #artist__amadeo_de_souza_cardoso Amadeo de Souza-Cardoso |
                                #artist__millicent_sowerby Millicent Sowerby |
                                #artist__moses_soyer Moses Soyer |
                                #artist__sparth Sparth |
                                #artist__jack_spencer Jack Spencer |
                                #artist__art_spiegelman Art Spiegelman |
                                #artist__simon_stalenhag Simon Stålenhag |
                                #artist__ralph_steadman Ralph Steadman |
                                #artist__philip_wilson_steer Philip Wilson Steer |
                                #artist__william_steig William Steig |
                                #artist__fred_stein Fred Stein |
                                #artist__theophile_steinlen Théophile Steinlen |
                                #artist__brian_stelfreeze Brian Stelfreeze |
                                #artist__frank_stella Frank Stella |
                                #artist__joseph_stella Joseph Stella |
                                #artist__irma_stern Irma Stern |
                                #artist__alfred_stevens Alfred Stevens |
                                #artist__marie_spartali_stillman Marie Spartali Stillman |
                                #artist__stinkfish Stinkfish |
                                #artist__anne_stokes Anne Stokes |
                                #artist__william_stout William Stout |
                                #artist__paul_strand Paul Strand |
                                #artist__linnea_strid Linnea Strid |
                                #artist__john_melhuish_strudwick John Melhuish Strudwick |
                                #artist__drew_struzan Drew Struzan |
                                #artist__tatiana_suarez Tatiana Suarez |
                                #artist__eustache_le_sueur Eustache Le Sueur |
                                #artist__rebecca_sugar Rebecca Sugar |
                                #artist__hiroshi_sugimoto Hiroshi Sugimoto |
                                #artist__graham_sutherland Graham Sutherland |
                                #artist__jan_svankmajer Jan Svankmajer |
                                #artist__raymond_swanland Raymond Swanland |
                                #artist__annie_swynnerton Annie Swynnerton |
                                #artist__stanislaw_szukalski Stanisław Szukalski |
                                #artist__philip_taaffe Philip Taaffe |
                                #artist__hiroyuki_mitsume_takahashi Hiroyuki-Mitsume Takahashi |
                                #artist__dorothea_tanning Dorothea Tanning |
                                #artist__margaret_tarrant Margaret Tarrant |
                                #artist__genndy_tartakovsky Genndy Tartakovsky |
                                #artist__teamlab teamLab |
                                #artist__raina_telgemeier Raina Telgemeier |
                                #artist__john_tenniel John Tenniel |
                                #artist__sir_john_tenniel Sir John Tenniel |
                                #artist__howard_terpning Howard Terpning |
                                #artist__osamu_tezuka Osamu Tezuka |
                                #artist__abbott_handerson_thayer Abbott Handerson Thayer |
                                #artist__heather_theurer Heather Theurer |
                                #artist__mickalene_thomas Mickalene Thomas |
                                #artist__tom_thomson Tom Thomson |
                                #artist__titian Titian |
                                #artist__mark_tobey Mark Tobey |
                                #artist__greg_tocchini Greg Tocchini |
                                #artist__roland_topor Roland Topor |
                                #artist__sergio_toppi Sergio Toppi |
                                #artist__alex_toth Alex Toth |
                                #artist__henri_de_toulouse_lautrec Henri de Toulouse-Lautrec |
                                #artist__ross_tran Ross Tran |
                                #artist__philip_treacy Philip Treacy |
                                #artist__anne_truitt Anne Truitt |
                                #artist__henry_scott_tuke Henry Scott Tuke |
                                #artist__jmw_turner J.M.W. Turner |
                                #artist__james_turrell James Turrell |
                                #artist__john_henry_twachtman John Henry Twachtman |
                                #artist__naomi_tydeman Naomi Tydeman |
                                #artist__euan_uglow Euan Uglow |
                                #artist__daniela_uhlig Daniela Uhlig |
                                #artist__kitagawa_utamaro Kitagawa Utamaro |
                                #artist__christophe_vacher Christophe Vacher |
                                #artist__suzanne_valadon Suzanne Valadon |
                                #artist__thiago_valdi Thiago Valdi |
                                #artist__chris_van_allsburg Chris van Allsburg |
                                #artist__francine_van_hove Francine Van Hove |
                                #artist__jan_van_kessel_the_elder Jan van Kessel the Elder |
                                #artist__remedios_varo Remedios Varo |
                                #artist__nick_veasey Nick Veasey |
                                #artist__diego_velazquez Diego Velázquez |
                                #artist__eve_ventrue Eve Ventrue |
                                #artist__johannes_vermeer Johannes Vermeer |
                                #artist__charles_vess Charles Vess |
                                #artist__roman_vishniac Roman Vishniac |
                                #artist__kelly_vivanco Kelly Vivanco |
                                #artist__brian_m_viveros Brian M. Viveros |
                                #artist__elke_vogelsang Elke Vogelsang |
                                #artist__vladimir_volegov Vladimir Volegov |
                                #artist__robert_vonnoh Robert Vonnoh |
                                #artist__mikhail_vrubel Mikhail Vrubel |
                                #artist__louis_wain Louis Wain |
                                #artist__kara_walker Kara Walker |
                                #artist__josephine_wall Josephine Wall |
                                #artist__bruno_walpoth Bruno Walpoth |
                                #artist__chris_ware Chris Ware |
                                #artist__andy_warhol Andy Warhol |
                                #artist__john_william_waterhouse John William Waterhouse |
                                #artist__bill_watterson Bill Watterson |
                                #artist__george_frederic_watts George Frederic Watts |
                                #artist__walter_ernest_webster Walter Ernest Webster |
                                #artist__hendrik_weissenbruch Hendrik Weissenbruch |
                                #artist__neil_welliver Neil Welliver |
                                #artist__catrin_welz_stein Catrin Welz-Stein |
                                #artist__vivienne_westwood Vivienne Westwood |
                                #artist__michael_whelan Michael Whelan |
                                #artist__james_abbott_mcneill_whistler James Abbott McNeill Whistler |
                                #artist__william_whitaker William Whitaker |
                                #artist__tim_white Tim White |
                                #artist__coby_whitmore Coby Whitmore |
                                #artist__david_wiesner David Wiesner |
                                #artist__kehinde_wiley Kehinde Wiley |
                                #artist__cathy_wilkes Cathy Wilkes |
                                #artist__jessie_willcox_smith Jessie Willcox Smith |
                                #artist__gilbert_williams Gilbert Williams |
                                #artist__kyffin_williams Kyffin Williams |
                                #artist__al_williamson Al Williamson |
                                #artist__wes_wilson Wes Wilson |
                                #artist__mike_winkelmann Mike Winkelmann |
                                #artist__bec_winnel Bec Winnel |
                                #artist__franz_xaver_winterhalter Franz Xaver Winterhalter |
                                #artist__nathan_wirth Nathan Wirth |
                                #artist__wlop WLOP |
                                #artist__brandon_woelfel Brandon Woelfel |
                                #artist__liam_wong Liam Wong |
                                #artist__francesca_woodman Francesca Woodman |
                                #artist__jim_woodring Jim Woodring |
                                #artist__patrick_woodroffe Patrick Woodroffe |
                                #artist__frank_lloyd_wright Frank Lloyd Wright |
                                #artist__sulamith_wulfing Sulamith Wulfing |
                                #artist__nc_wyeth N.C. Wyeth |
                                #artist__rose_wylie Rose Wylie |
                                #artist__stanislaw_wyspianski Stanisław Wyspiański |
                                #artist__takato_yamamoto Takato Yamamoto |
                                #artist__gene_luen_yang Gene Luen Yang |
                                #artist__ikenaga_yasunari Ikenaga Yasunari |
                                #artist__kozo_yokai Kozo Yokai |
                                #artist__sean_yoro Sean Yoro |
                                #artist__chie_yoshii Chie Yoshii |
                                #artist__skottie_young Skottie Young |
                                #artist__masaaki_yuasa Masaaki Yuasa |
                                #artist__konstantin_yuon Konstantin Yuon |
                                #artist__yuumei Yuumei |
                                #artist__william_zorach William Zorach |
                                #artist__ander_zorn Ander Zorn
                               }

                        // The matching list of styles:
                        @wizards_artist_styles   := { @#__wizards_artist_styles @__wizards_artist_styles }
                        @__wizards_artist_styles := {
                            ?artist__zacharias_martin_aagaard landscapes, Observational, painting, Romanticism, Slice-of-life |
                            ?artist__slim_aarons fashion, luxury, nostalgia, pastel-colors, photography, photography-color, social-commentary |
                            ?artist__elenore_abbott art-nouveau, dream-like, ethereal, femininity, mythology, pastel-colors, romanticism, watercolor |
                            ?artist__tomma_abts abstract, angular, color-field, contemporary, geometric, minimalism, modern |
                            ?artist__vito_acconci architecture, conceptual, dark, installation, performance, sculpture |
                            ?artist__andreas_achenbach landscapes, Observational, painting, Plein-air, Romanticism |
                            ?artist__ansel_adams American, high-contrast, landscapes, monochromatic, nature, photography, photography-bw |
                            ?artist__josh_adamski atmospheric, colorful, contemporary, high-contrast, impressionism, landscapes, nature, photography, photography-color, serenity |
                            ?artist__charles_addams cartoon, contemporary, Illustration, Social-commentary |
                            ?artist__etel_adnan abstract, color-field, colorful, landscapes, nature, serenity, vibrant |
                            ?artist__alena_aenami atmospheric, digital, dream-like, fantasy, landscapes, serenity, surreal, vibrant |
                            ?artist__leonid_afremov atmospheric, cityscapes, colorful, impressionism, nature, vibrant |
                            ?artist__petros_afshar abstract, contemporary, mixed-media, multimedia |
                            ?artist__yaacov_agam abstract, angular, colorful, illusion, interactive, kinetic, vibrant |
                            ?artist__eileen_agar abstract, collage, femininity, nature, vibrant |
                            ?artist__craigie_aitchison expressionism, figurativism, nature, primitivism, vibrant |
                            ?artist__ivan_aivazovsky Armenian, battle-scenes, dark, landscapes, painting, portraits, romanticism, Russian, seascapes |
                            ?artist__francesco_albani impressionism, landscapes |
                            ?artist__alessio_albi american, expressionism, landscapes, photography, photography-color, portraits |
                            ?artist__miles_aldridge British, Consumerism, fashion, Femininity, Illustration, photography, photography-color, pop-culture |
                            ?artist__john_white_alexander american, art-nouveau, contemporary, expressionism, landscapes, portraits |
                            ?artist__alessandro_allori american, expressionism, landscapes, portraits, renaissance |
                            ?artist__mike_allred comics, illustration, pop-art, superheroes, whimsical |
                            ?artist__lawrence_alma_tadema ancient, flowers, history, opulent, romanticism, Victorian |
                            ?artist__lilia_alvarado american, colorful, contemporary, landscapes, photography, photography-color, portraits |
                            ?artist__tarsila_do_amaral abstract, contemporary, cubism, modern, surreal, vibrant |
                            ?artist__ghada_amer abstract, contemporary, messy, portraits |
                            ?artist__cuno_amiet impressionism, landscapes, portraits |
                            ?artist__el_anatsui abstract, African, contemporary, Ghanaian, recycled-materials, sculpture, textiles |
                            ?artist__helga_ancher impressionism, Observational, painting, Realism, Slice-of-life |
                            ?artist__sarah_andersen cartoon, collage, comics, contemporary, fashion, femininity, mixed-media |
                            ?artist__richard_anderson dark, digital, fantasy, gothic, grungy, horror, messy, psychedelic, surreal |
                            ?artist__sophie_gengembre_anderson childhood, femininity, painting, portraits, rural-life, Victorian |
                            ?artist__wes_anderson colorful, film, nostalgia, pastel-colors, photography, photography-color, surreal, whimsical |
                            ?artist__alex_andreev contemporary, Death, Displacement, illustration, surreal |
                            ?artist__sofonisba_anguissola dark, portraits, renaissance |
                            ?artist__louis_anquetin impressionism, portraits |
                            ?artist__mary_jane_ansell contemporary, photorealism, portraits, still-life |
                            ?artist__chiho_aoshima colorful, digital, fantasy, Japanese, pop-art, whimsical |
                            ?artist__sabbas_apterus conceptual, dark, digital, dream-like, surreal |
                            ?artist__hirohiko_araki characters, graphic-novel, illustration, Japanese, manga-anime, pop-culture, surreal |
                            ?artist__howard_arkley architecture, colorful, contemporary, futuristic, playful, pop-art, vibrant, whimsical |
                            ?artist__rolf_armstrong art-deco, art-nouveau, characters, fashion, illustration, modern, posters |
                            ?artist__gerd_arntz flat-colors, geometric, graphic-design, high-contrast, minimalism |
                            ?artist__guy_aroch contemporary, fashion, photography, photography-color, portraits |
                            ?artist__miki_asai contemporary, flowers, insects, landscapes, macro-world, minimalism, nature, photography, photography-color, shallow-depth-of-field, vibrant |
                            ?artist__clemens_ascher architecture, contemporary, geometric, minimalism, photography, photography-color, vibrant |
                            ?artist__henry_asencio contemporary, expressionism, figurativism, impressionism, messy, portraits |
                            ?artist__andrew_atroshenko contemporary, figurativism, impressionism, portraits |
                            ?artist__deborah_azzopardi cartoon, colorful, comics, fashion, femininity, pop-art, whimsical |
                            ?artist__lois_van_baarle characters, digital, fantasy, femininity, illustration, pastel-colors, whimsical |
                            ?artist__ingrid_baars american, contemporary, dark, photography, photography-color, portraits |
                            ?artist__anne_bachelier contemporary, dark, dream-like, portraits |
                            ?artist__francis_bacon abstract, British, dark, distortion, expressionism, figurative, portraits, surreal |
                            ?artist__firmin_baes contemporary, impressionism, landscapes, portraits, still-life |
                            ?artist__tom_bagshaw characters, dark, eerie, fantasy, horror, melancholy, surreal |
                            ?artist__karol_bak Conceptual, contemporary, Impressionism, Metamorphosis, painting |
                            ?artist__christopher_balaskas digital, eerie, futuristic, landscapes, outer-space, science-fiction, vibrant |
                            ?artist__benedick_bana 3D-rendering, characters, cyberpunk, dystopia, grungy, industrial, messy, science-fiction |
                            ?artist__banksy anonymous, graffiti, high-contrast, politics, social-commentary, street-art, urban-life |
                            ?artist__george_barbier art-deco, art-nouveau, costumes, fashion, illustration, romanticism, theater |
                            ?artist__cicely_mary_barker characters, childhood, fairies, flowers, folklore, magic, nostalgia, Victorian, whimsical |
                            ?artist__wayne_barlowe alien-worlds, creatures, dark, dystopia, eerie, fantasy, mythology, science-fiction |
                            ?artist__will_barnet activism, contemporary, painting, Social-commentary |
                            ?artist__matthew_barney conceptual, creatures, film, multimedia, performance, photography, photography-color, sculpture, surreal, video-art |
                            ?artist__angela_barrett animals, fantasy, kids-book, playful, whimsical |
                            ?artist__jean_michel_basquiat African-American, contemporary, expressionism, graffiti, messy, neo-expressionism, punk, street-art |
                            ?artist__lillian_bassman characters, contemporary, fashion, monochromatic, photography, photography-bw, portraits |
                            ?artist__pompeo_batoni baroque, dark, portraits |
                            ?artist__casey_baugh contemporary, dark, drawing, expressionism, portraits |
                            ?artist__chiara_bautista dark, dream-like, fantasy, illusion, magic, mysterious, surreal, whimsical |
                            ?artist__herbert_bayer angular, Bauhaus, colorful, contemporary, flat-colors, graphic-design, typography |
                            ?artist__mary_beale baroque, portraits |
                            ?artist__alan_bean astronauts, metaphysics, outer-space, painting, science-fiction |
                            ?artist__romare_bearden African-American, collage, cubism, expressionism, history, urban-life, vibrant |
                            ?artist__cecil_beaton contemporary, fashion, monochromatic, photography, photography-bw, portraits |
                            ?artist__cecilia_beaux American, elegant, femininity, impressionism, portraits |
                            ?artist__jasmine_becket_griffith big-eyes, childhood, colorful, fairies, fantasy, gothic, magic, portraits, romanticism, whimsical |
                            ?artist__vanessa_beecroft contemporary, expressionism, fashion, feminism, nudes, photography, photography-color, surreal |
                            ?artist__beeple 3D-rendering, conceptual, cyberpunk, digital, futuristic, pastel-colors, science-fiction |
                            ?artist__zdzislaw_beksinski contemporary, dark, dream-like, expressionism, fantasy, horror, illustration, surreal |
                            ?artist__katerina_belkina contemporary, Femininity, identity, painting, Photography, photography-color, portraits |
                            ?artist__julie_bell dragons, fantasy, magic, mythology, nature, wilderness |
                            ?artist__vanessa_bell fauvism, portraits |
                            ?artist__bernardo_bellotto landscapes, Observational, painting, Plein-air, Rococo |
                            ?artist__ambrosius_benson animals, dark, portraits, renaissance |
                            ?artist__stan_berenstain animals, cartoon, family, kids-book, playful, whimsical |
                            ?artist__laura_berger contemporary, flat-colors, geometric, identity, muted-colors |
                            ?artist__jody_bergsma dream-like, ethereal, fairies, fantasy, magic-realism, mythology, watercolor, whimsical |
                            ?artist__john_berkey eerie, fantasy, futuristic, outer-space, science-fiction |
                            ?artist__gian_lorenzo_bernini Allegory, Baroque, Religion, Sculpture |
                            ?artist__marta_bevacqua contemporary, dark, photography, photography-color, portraits |
                            ?artist__john_t_biggers African-American, contemporary, harlem-renaissance, modern, mural-painting, social-commentary |
                            ?artist__enki_bilal comics, cyberpunk, dystopia, futuristic, grungy, science-fiction, surreal, urban-life |
                            ?artist__ivan_bilibin art-nouveau, folklore, horses, illustration, kids-book, mythology, ornate, royalty, Russian, theater |
                            ?artist__butcher_billy characters, colorful, comics, contemporary, feminism, graphic-design, pop-art, vibrant |
                            ?artist__george_caleb_bingham american, hudson-river-school, landscapes, realism |
                            ?artist__ed_binkley dream-like, ethereal, fantasy, magic, mythology, whimsical |
                            ?artist__george_birrell cityscapes, colorful, contemporary, urban-life, vibrant |
                            ?artist__robert_bissell animals, contemporary, fantasy, impressionism, kids-book, mysterious, nature, painting, Plein-air, whimsical, wildlife |
                            ?artist__charles_blackman colorful, painting, portraits |
                            ?artist__mary_blair , animation, characters, childhood, illustration, nature, vibrant, whimsical |
                            ?artist__john_blanche elegant, fantasy, French, portraits, science-fiction |
                            ?artist__don_blanding architecture, art-deco, high-contrast, minimalism |
                            ?artist__albert_bloch Engraving, Impressionism, painting, Realism, Satire, Social-commentary |
                            ?artist__hyman_bloom contemporary, expressionism |
                            ?artist__peter_blume conceptual, dark, fantasy, surreal |
                            ?artist__don_bluth animation, cartoon, colorful, contemporary, fantasy, film, whimsical |
                            ?artist__umberto_boccioni colorful, cubism, futurism, muted-colors |
                            ?artist__anna_bocek colorful, figurativism, messy, portraits |
                            ?artist__lee_bogle dream-like, eerie, ethereal, fantasy, portraits |
                            ?artist__louis_leopold_boily contemporary, French, landscapes, nature, painting |
                            ?artist__giovanni_boldini impressionism, portraits |
                            ?artist__enoch_bolles art-nouveau, characters, contemporary, portraits |
                            ?artist__david_bomberg abstract, battle-scenes, cubism, expressionism, muted-colors |
                            ?artist__chesley_bonestell alien-worlds, futuristic, outer-space, science-fiction |
                            ?artist__lee_bontecou abstract, contemporary, mixed-media, sculpture |
                            ?artist__michael_borremans contemporary, low-contrast, portraits, still-life |
                            ?artist__matt_bors comics, flat-colors, graphic-design, satire, social-commentary |
                            ?artist__flora_borsi animals, contemporary, dream-like, photography, photography-color, portraits |
                            ?artist__hieronymus_bosch allegory, fantasy, mysticism, religion, renaissance, surreal, whimsical |
                            ?artist__sam_bosma animation, cartoon, characters, comics, fantasy, playful, whimsical |
                            ?artist__johfra_bosschart dream-like, ethereal, fantasy, magic, mythology, surreal, whimsical |
                            ?artist__fernando_botero animals, contemporary, dream-like, figurativism, portraits, surreal |
                            ?artist__sandro_botticelli dream-like, femininity, figurative, Italian, mythology, religion, renaissance |
                            ?artist__william_adolphe_bouguereau female-figures, French, muted-colors, mythology, nudes, painting, realism |
                            ?artist__susan_seddon_boulet dream-like, ethereal, fantasy, femininity, magic, magic-realism, nature, whimsical |
                            ?artist__louise_bourgeois expressionism, feminism, horror, insects, kinetic, sculpture, surreal |
                            ?artist__annick_bouvattier colorful, contemporary, female-figures, photography, photography-color, portraits |
                            ?artist__david_michael_bowers animals, contemporary, dream-like, magic-realism, portraits |
                            ?artist__noah_bradley dark, eerie, fantasy, landscapes |
                            ?artist__aleksi_briclot dark, dystopia, fantasy, gothic, grungy, horror |
                            ?artist__frederick_arthur_bridgman orientalism, portraits |
                            ?artist__renie_britenbucher contemporary, Fleeting-moments, painting, Portraits |
                            ?artist__romero_britto colorful, contemporary, playful, pop-art, stained-glass, vibrant, whimsical |
                            ?artist__gerald_brom dark, eerie, fantasy, gothic, horror, pulp |
                            ?artist__bronzino dark, portraits, renaissance |
                            ?artist__herman_brood characters, childhood, pop-art, sports |
                            ?artist__mark_brooks comics, fantasy, science-fiction |
                            ?artist__romaine_brooks contemporary, dream-like, low-contrast, portraits |
                            ?artist__troy_brooks contemporary, dark, dream-like, impressionism, oil-painting, portraits, surreal, vibrant |
                            ?artist__broom_lee furniture, not-a-person, sculpture, contemporary |
                            ?artist__allie_brosh autobiographical, comics, flat-colors, whimsical |
                            ?artist__ford_madox_brown portraits, romanticism |
                            ?artist__charles_le_brun baroque, portraits |
                            ?artist__elisabeth_vigee_le_brun baroque, fashion, femininity, portraits |
                            ?artist__james_bullough contemporary, dream-like, portraits, street-art |
                            ?artist__laurel_burch femininity, illustration, nature, vibrant, whimsical |
                            ?artist__alejandro_burdisio atmospheric, dark, digital, eerie, fantasy, landscapes, magic, science-fiction |
                            ?artist__daniel_buren conceptual, contemporary, installation, minimalism, sculpture, vibrant |
                            ?artist__jon_burgerman colorful, contemporary, illustration, playful, pop-art, vibrant |
                            ?artist__richard_burlet art-nouveau, characters, cityscapes, figurative, French, impressionism, urban-life |
                            ?artist__jim_burns characters, cyberpunk, dark, dystopia, futuristic, noir, science-fiction, urban-life |
                            ?artist__stasia_burrington animals, contemporary, portraits, watercolor, whimsical |
                            ?artist__kaethe_butcher contemporary, messy, portraits |
                            ?artist__saturno_butto contemporary, dream-like, figurativism, portraits |
                            ?artist__paul_cadmus contemporary, nudes, portraits |
                            ?artist__zhichao_cai digital, dream-like, ethereal, fantasy, magic, surreal |
                            ?artist__randolph_caldecott animals, British, illustration, kids-book, nature, playful |
                            ?artist__alexander_calder_milne abstract, geometric, interactive, kinetic, metalwork, minimalism, modern, sculpture |
                            ?artist__clyde_caldwell fantasy, female-figures, mythology, pulp, science-fiction |
                            ?artist__vincent_callebaut 3D-rendering, architecture, cyberpunk, dystopia, fantasy, futuristic, science-fiction, surreal, utopia |
                            ?artist__fred_calleri colorful, expressionism, mixed-media, portraits, sculpture, whimsical |
                            ?artist__charles_camoin colorful, fauvism, landscapes, portraits |
                            ?artist__mike_campau 3D-rendering, conceptual, contemporary, digital, landscapes, urban-life |
                            ?artist__eric_canete characters, comics, fantasy, superheroes |
                            ?artist__josef_capek expressionism, fauvism, portraits |
                            ?artist__leonetto_cappiello art-nouveau, color-field, colorful, graphic-design, mixed-media, muted-colors, posters |
                            ?artist__eric_carle animals, colorful, interactive, kids-book, playful |
                            ?artist__larry_carlson colorful, digital, dream-like, nature, psychedelic, surreal, vibrant |
                            ?artist__bill_carman playful, pop-art, psychedelic, surreal, whimsical |
                            ?artist__jean_baptiste_carpeaux French, portraits, romanticism, sculpture |
                            ?artist__rosalba_carriera baroque, portraits |
                            ?artist__michael_carson characters, contemporary, figurativism, impressionism, portraits |
                            ?artist__felice_casorati expressionism, impressionism, portraits, still-life |
                            ?artist__mary_cassatt characters, impressionism, pastel, portraits |
                            ?artist__a_j_casson contemporary, landscapes, Mathematics, painting, Punk |
                            ?artist__giorgio_barbarelli_da_castelfranco painting, Renaissance, Rococo |
                            ?artist__paul_catherall architecture, flat-colors, geometric, graphic-design, minimalism, urban-life |
                            ?artist__george_catlin animals, contemporary, portraits |
                            ?artist__patrick_caulfield colorful, contemporary, geometric, minimalism, pop-art, vibrant |
                            ?artist__nicoletta_ceccoli animals, big-eyes, childhood, contemporary, dark, dream-like, portraits, surreal, whimsical |
                            ?artist__agnes_cecile contemporary, messy, portraits, watercolor |
                            ?artist__paul_cezanne cubism, geometric, impressionism, landscapes, post-impressionism, romanticism, still-life |
                            ?artist__paul_chabas figurativism, impressionism, nudes, portraits |
                            ?artist__marc_chagall colorful, dream-like, fauvism, folklore, French, impressionism, Jewish, romanticism, Russian |
                            ?artist__tom_chambers contemporary, Fleeting-moments, Illustration, Observational |
                            ?artist__katia_chausheva contemporary, dark, photography, photography-color, portraits |
                            ?artist__hsiao_ron_cheng digital, fashion, femininity, minimalism, mixed-media, pastel-colors, pop-art, portraits |
                            ?artist__yanjun_cheng contemporary, digital, dream-like, eerie, femininity, illustration, portraits, whimsical |
                            ?artist__sandra_chevrier animals, comics, contemporary, dream-like, portraits |
                            ?artist__judy_chicago abstract, activism, empowerment, femininity, feminism, installation, psychedelic, sculpture, vibrant |
                            ?artist__dale_chihuly abstract, contemporary, organic, sculpture, vibrant |
                            ?artist__frank_cho colorful, comics, drawing, fantasy, superheroes |
                            ?artist__james_c_christensen American, dream-like, ethereal, illustration, kids-book, magic, mysterious, mythology, religion, whimsical |
                            ?artist__mikalojus_konstantinas_ciurlionis art-nouveau, dark, Lithuanian, mysticism, spirituality, symbolist |
                            ?artist__alson_skinner_clark atmospheric, impressionism, landscapes, seascapes |
                            ?artist__amanda_clark characters, dream-like, ethereal, landscapes, magic, watercolor, whimsical |
                            ?artist__harry_clarke dark, folklore, illustration, Irish, stained-glass |
                            ?artist__george_clausen Observational, painting, Plein-air, Realism |
                            ?artist__francesco_clemente contemporary, dream-like, figurativism, Italian, portraits |
                            ?artist__alvin_langdon_coburn architecture, atmospheric, photography, photography-bw |
                            ?artist__clifford_coffin colorful, fashion, photography, photography-color, pop-art, portraits, urban-life |
                            ?artist__vince_colletta American, comics, superheroes |
                            ?artist__beth_conklin childhood, contemporary, dream-like, fashion, nature, photography, photography-color, portraits, urban-life |
                            ?artist__john_constable British, dark, landscapes, nature, oil-painting, romanticism, skies |
                            ?artist__darwyn_cooke cartoon, comics, contemporary, illustration |
                            ?artist__richard_corben comics, dark, eerie, horror, science-fiction |
                            ?artist__vittorio_matteo_corcos colorful, fantasy, impressionism, portraits, romanticism |
                            ?artist__paul_corfield cartoon, landscapes, nature, playful, satire, vibrant, whimsical |
                            ?artist__fernand_cormon impressionism, Observational, painting, Realism |
                            ?artist__norman_cornish portraits, realism, watercolor, whimsical |
                            ?artist__camille_corot color-field, femininity, impressionism, landscapes, nature, portraits, romanticism |
                            ?artist__gemma_correll cartoon, flat-colors, graphic-design, high-contrast, playful, whimsical |
                            ?artist__petra_cortright digital, expressionism, impressionism, messy, nature, vibrant |
                            ?artist__lorenzo_costa_the_elder Allegory, painting, Religion, religion, Renaissance |
                            ?artist__olive_cotton Australian, Modern, monochromatic, nature, photography, photography-bw |
                            ?artist__peter_coulson minimalism, monochromatic, nudes, photography, photography-bw, portraits, street-art, urban-life |
                            ?artist__gustave_courbet environmentalism, impressionism, nature, portraits, realism, romanticism, social-commentary, watercolor |
                            ?artist__frank_cadogan_cowper British, history, opulent, romanticism, Victorian |
                            ?artist__kinuko_y_craft American, colorful, dream-like, fantasy, folklore, illustration, kids-book, royalty |
                            ?artist__clayton_crain characters, comics, digital, fantasy, illustration, science-fiction |
                            ?artist__lucas_cranach_the_elder Allegory, painting, Religion, religion, Renaissance |
                            ?artist__lucas_cranach_the_younger femininity, german, history, mythology, portraits, religion, renaissance |
                            ?artist__walter_crane British, engraving, folklore, illustration, kids-book, nostalgia |
                            ?artist__martin_creed abstract, British, conceptual, expressionism, installation, interactive, minimalism, playful |
                            ?artist__gregory_crewdson American, dark, eerie, photography, photography-color, suburbia, surreal |
                            ?artist__debbie_criswell landscapes, playful, surreal, whimsical |
                            ?artist__victoria_crowe figurativism, impressionism, landscapes, nature, portraits, romanticism, whimsical |
                            ?artist__etam_cru colorful, contemporary, graffiti, large-scale, portraits, social-commentary, street-art, urban-life |
                            ?artist__robert_crumb American, characters, comics, counter-culture, satire, underground |
                            ?artist__carlos_cruz_diez Conceptual, illusion, Kinetic, Light-art |
                            ?artist__john_currin characters, conceptual, fashion, femininity, figurativism, portraits, whimsical |
                            ?artist__krenz_cushart characters, digital, fantasy, illustration, manga-anime, portraits, whimsical |
                            ?artist__camilla_derrico big-eyes, childhood, contemporary, fantasy, nature, portraits, vibrant, watercolor, whimsical |
                            ?artist__pino_daeni femininity, figurative, nostalgia, painting, romanticism |
                            ?artist__salvador_dali dark, dream-like, dreams, illusion, metaphysics, oil-painting, Spanish, surreal |
                            ?artist__sunil_das contemporary, figurative, identity, portraits |
                            ?artist__ian_davenport abstract, colorful, contemporary, geometric, modern, vibrant |
                            ?artist__stuart_davis abstract, American, cubism, rural-life, social-realism |
                            ?artist__roger_dean dream-like, eerie, ethereal, fantasy, landscapes, magic, posters, science-fiction |
                            ?artist__michael_deforge cartoon, pop-art, satire, surreal, whimsical |
                            ?artist__edgar_degas ballet, dancers, femininity, French, impressionism, pastel, portraits |
                            ?artist__eugene_delacroix French, history, muted-colors, oil-painting, orientalism, romanticism, sketching |
                            ?artist__robert_delaunay abstract, contemporary, cubism, geometric, modern, vibrant |
                            ?artist__sonia_delaunay abstract, cubism, fashion, fauvism, female-figures, French, geometric, modern |
                            ?artist__gabriele_dellotto comics, fantasy |
                            ?artist__nicolas_delort dark, eerie, fantasy, gothic, horror, labyrinths, monochromatic |
                            ?artist__jean_delville dream-like, fantasy, magic, metaphysics, surreal |
                            ?artist__posuka_demizu adventure, contemporary, fantasy, illustration, manga-anime, playful, whimsical |
                            ?artist__guy_denning colorful, conceptual, expressionism, messy, portraits, social-commentary |
                            ?artist__monsu_desiderio contemporary, figurative, surreal |
                            ?artist__charles_maurice_detmold animals, art-nouveau, botanical, British, delicate, ethereal, illustration, kids-book, nature, opulent, Victorian, watercolor |
                            ?artist__edward_julius_detmold animals, art-nouveau, botanical, British, delicate, illustration, kids-book, nature, opulent, Victorian, watercolor |
                            ?artist__anne_dewailly characters, fashion, figurativism, identity, multimedia, photorealism, portraits, whimsical |
                            ?artist__walt_disney Adventure, Animation, cartoon, characters, contemporary, folklore, whimsical |
                            ?artist__tony_diterlizzi creatures, fantasy, magic, playful, whimsical |
                            ?artist__anna_dittmann digital, dream-like, ethereal, fantasy, mysterious, pastel-colors, portraits |
                            ?artist__dima_dmitriev figure-studies, impressionism, landscapes, nature, oil-painting, romanticism |
                            ?artist__peter_doig British, Canadian, dream-like, figurativism, landscapes, large-scale, nature |
                            ?artist__kees_van_dongen colorful, expressionism, fauvism, femininity, japanese, portraits, urban-life |
                            ?artist__gustave_dore engraving, fantasy, gothic, monochromatic, mythology |
                            ?artist__dave_dorman dark, fantasy, horror, photorealism, science-fiction |
                            ?artist__emilio_giuseppe_dossena Conceptual, contemporary, metaphysics, Sculpture |
                            ?artist__david_downton conceptual, expressionism, high-contrast, minimalism, portraits, whimsical |
                            ?artist__jessica_drossin fantasy, femininity, impressionism, magic-realism, photography, photography-color, portraits, whimsical |
                            ?artist__philippe_druillet comics, contemporary, fantasy, French, science-fiction |
                            ?artist__tj_drysdale dream-like, eerie, ethereal, landscapes, magic, photography, photography-color, shallow-depth-of-field |
                            ?artist__ton_dubbeldam architecture, colorful, conceptual, contemporary, Dutch, geometric, landscapes, pointillism |
                            ?artist__marcel_duchamp conceptual, cubism, dadaism, expressionism, fauvism, impressionism, surreal |
                            ?artist__joseph_ducreux French, portraits, self-portraits, whimsical |
                            ?artist__edmund_dulac dream-like, folklore, French, illustration, kids-book, magic, orientalism, romanticism |
                            ?artist__marlene_dumas African-American, contemporary, expressionism, femininity, impressionism, nature, portraits, watercolor |
                            ?artist__charles_dwyer impressionism, messy, nature, portraits, watercolor, whimsical |
                            ?artist__william_dyce baroque, impressionism, portraits, realism, renaissance, romanticism |
                            ?artist__chris_dyer colorful, contemporary, expressionism, pop-art, psychedelic, surreal, vibrant |
                            ?artist__eyvind_earle colorful, dream-like, high-contrast, magic-realism, surreal, whimsical |
                            ?artist__amy_earles abstract-expressionism, American, characters, dark, gestural, watercolor, whimsical |
                            ?artist__lori_earley big-eyes, contemporary, dream-like, expressionism, figurativism, nature, portraits, whimsical |
                            ?artist__jeff_easley fantasy |
                            ?artist__tristan_eaton characters, collage, colorful, graphic-design, pop-art, street-art, vibrant |
                            ?artist__jason_edmiston characters, dark, eerie, ethereal, fantasy, horror, illustration, portraits |
                            ?artist__alfred_eisenstaedt conceptual, fashion, high-contrast, monochromatic, photography, photography-bw, portraits, whimsical |
                            ?artist__jesper_ejsing adventure, characters, fantasy, illustration, magic, mythology, whimsical |
                            ?artist__olafur_eliasson contemporary, environmentalism, immersive, installation, nature |
                            ?artist__harrison_ellenshaw landscapes, painting, realism |
                            ?artist__christine_ellger dream-like, ethereal, fantasy, folklore, illustration, magic-realism, surreal |
                            ?artist__larry_elmore battle-scenes, fantasy, illustration, medieval, superheroes |
                            ?artist__joseba_elorza collage, dream-like, outer-space, photography, photography-color, science-fiction, surreal |
                            ?artist__peter_elson futuristic, illustration, outer-space, robots-cyborgs, science-fiction, space-ships |
                            ?artist__gil_elvgren American, female-figures, femininity, illustration, pulp |
                            ?artist__ed_emshwiller aliens, colorful, illustration, outer-space, pulp, science-fiction |
                            ?artist__kilian_eng atmospheric, digital, fantasy, illustration, landscapes, science-fiction |
                            ?artist__jason_a_engle creatures, dark, fantasy, illustration |
                            ?artist__max_ernst automatism, collage, Dadaism, expressionism, German, mythology, oil-painting, surreal |
                            ?artist__romain_de_tirtoff_erte art-deco, fashion, luxury, masks, Russian, silhouettes, theater |
                            ?artist__m_c_escher angular, Dutch, geometric, illusion, lithography, mathematics, surreal, woodblock |
                            ?artist__tim_etchells Conceptual, conceptual, contemporary, neon, text-based |
                            ?artist__walker_evans American, documentary, great-depression, monochromatic, photography, photography-bw, portraits, social-commentary |
                            ?artist__jan_van_eyck painting, renaissance |
                            ?artist__glenn_fabry comics, fantasy, illustration, science-fiction, violence |
                            ?artist__ludwig_fahrenkrog eerie, expressionism, German, mysticism, symbolist |
                            ?artist__shepard_fairey flat-colors, graphic-design, high-contrast, politics, social-commentary, street-art |
                            ?artist__andy_fairhurst digital, eerie, fantasy, horror, illustration, science-fiction |
                            ?artist__luis_ricardo_falero dream-like, erotica, fantasy, figurativism, nudes, painting, romanticism |
                            ?artist__jean_fautrier abstract-expressionism, Metaphysics, painting, Sculpture |
                            ?artist__andrew_ferez dream-like, eerie, fantasy, fragmentation, illustration, surreal |
                            ?artist__hugh_ferriss architecture, art-deco, cityscapes, futuristic, geometric, nightlife, urban-life |
                            ?artist__david_finch comics, fantasy, illustration, noir, superheroes |
                            ?artist__callie_fink colorful, contemporary, expressionism, pop-art, portraits, psychedelic, surreal, vibrant |
                            ?artist__virgil_finlay comics, dark, eerie, fantasy, high-contrast, horror, pulp, science-fiction |
                            ?artist__anato_finnstark colorful, digital, fantasy, illustration, magic, playful, whimsical |
                            ?artist__howard_finster colorful, contemporary, dream-like, folk-art, portraits, primitivism, religion, spirituality |
                            ?artist__oskar_fischinger abstract, avant-garde, colorful, contemporary, spirituality, vibrant |
                            ?artist__samuel_melton_fisher flowers, impressionism, nature, portraits, realism, romanticism, whimsical |
                            ?artist__john_anster_fitzgerald fantasy, folklore, illustration, magic, pastel, whimsical |
                            ?artist__tony_fitzpatrick collage, colorful, contemporary, mixed-media, playful, pop-art, vibrant, whimsical |
                            ?artist__hippolyte_flandrin baroque, portraits, realism, religion, renaissance, romanticism |
                            ?artist__dan_flavin conceptual, contemporary, installation, light-art, minimalism, sculpture |
                            ?artist__max_fleischer Animation, comics, contemporary, dark |
                            ?artist__govaert_flinck baroque, expressionism, impressionism, portraits, realism, renaissance, whimsical |
                            ?artist__alex_russell_flint Environmentalism, Illustration, painting, Social-commentary |
                            ?artist__lucio_fontana abstract, conceptual, installation, large-scale, minimalism, modern, sculpture |
                            ?artist__chris_foss alien-worlds, colorful, illustration, outer-space, psychedelic, science-fiction |
                            ?artist__jon_foster contemporary, digital, figurativism, minimalism, modern, portraits |
                            ?artist__jean_fouquet Allegory, painting, Religion, Renaissance, renaissance |
                            ?artist__toby_fox animals, cartoon, childhood, comics, digital, fantasy, nature, whimsical |
                            ?artist__art_frahm femininity, pin-up, portraits |
                            ?artist__lisa_frank childhood, colorful, illustration, playful, vibrant, whimsical |
                            ?artist__helen_frankenthaler abstract, abstract-expressionism, color-field, contemporary, expressionism, feminism, painting, printmaking, watercolor |
                            ?artist__frank_frazetta barbarians, dark, erotica, fantasy, illustration, muscles, pulp |
                            ?artist__kelly_freas adventure, eerie, fantasy, illustration, science-fiction |
                            ?artist__lucian_freud British, expressionism, figurative, flesh, oil-painting, portraits, realism |
                            ?artist__brian_froud dark, fairies, fantasy, illustration, magic, mythology, whimsical |
                            ?artist__wendy_froud dark, fairies, fantasy, illustration, magic, mythology, whimsical |
                            ?artist__tom_fruin architecture, colorful, contemporary, geometric, installation, multimedia, sculpture, stained-glass, vibrant |
                            ?artist__john_wayne_gacy clowns, dark, death, horror, portraits, vibrant |
                            ?artist__justin_gaffrey environmentalism, installation, landscapes, large-scale, minimalism, nature, sculpture |
                            ?artist__hashimoto_gaho Kitsch, Politics, Printmaking, ukiyo-e |
                            ?artist__neil_gaiman comics, conceptual, dream-like, fantasy, portraits, whimsical |
                            ?artist__stephen_gammell dark, eerie, high-contrast, horror, kids-book |
                            ?artist__hope_gangloff colorful, contemporary, expressionism, portraits |
                            ?artist__alex_garant conceptual, contemporary, dream-like, figurativism, impressionism, portraits, surreal, vibrant |
                            ?artist__gilbert_garcin abstract, Conceptual, contemporary, Installation, Sculpture, Surreal |
                            ?artist__michael_and_inessa_garmash conceptual, impressionism, nature, portraits, realism, romanticism, whimsical |
                            ?artist__antoni_gaudi architecture, art-nouveau, mosaic, organic, Spanish |
                            ?artist__jack_gaughan alien-worlds, aliens, colorful, illustration, outer-space, science-fiction |
                            ?artist__paul_gauguin colorful, exoticism, French, impressionism, oil-painting, primitivism, spirituality, tropics |
                            ?artist__giovanni_battista_gaulli baroque, expressionism, impressionism, portraits, realism, renaissance |
                            ?artist__anne_geddes childhood, nature, photography, photography-color, portraits, whimsical |
                            ?artist__bill_gekas childhood, conceptual, expressionism, fashion, photography, photography-color, portraits, whimsical |
                            ?artist__artemisia_gentileschi baroque, expressionism, portraits, realism, religion, renaissance, romanticism |
                            ?artist__orazio_gentileschi baroque, expressionism, portraits, realism, renaissance, romanticism, whimsical |
                            ?artist__daniel_f_gerhartz expressionism, femininity, impressionism, nature, portraits, realism, romanticism, whimsical |
                            ?artist__theodore_gericault conceptual, dark, expressionism, impressionism, portraits, realism, romanticism |
                            ?artist__jean_leon_gerome architecture, figure-studies, French, mythology, Orientalism, painting, romanticism |
                            ?artist__mark_gertler expressionism, figurativism, figure-studies, impressionism, portraits, realism, still-life |
                            ?artist__atey_ghailan characters, digital, dream-like, fantasy, illustration, manga-anime, surreal |
                            ?artist__alberto_giacometti bronze, emaciation, expressionism, figurative, portraits, sculpture, Swiss |
                            ?artist__donato_giancola fantasy, illustration, mythology, science-fiction |
                            ?artist__hr_giger cyberpunk, dark, horror, monochromatic, painting, robots-cyborgs, science-fiction, surreal |
                            ?artist__james_gilleard architecture, colorful, digital, environmentalism, fantasy, flat-colors, futuristic, landscapes, vibrant |
                            ?artist__harold_gilman impressionism, landscapes, nature, portraits, romanticism, whimsical |
                            ?artist__charles_ginner cityscapes, colorful, impressionism, landscapes, urban-life |
                            ?artist__jean_giraud comics, dream-like, fantasy, illustration, psychedelic, science-fiction, surreal |
                            ?artist__anne_louis_girodet expressionism, impressionism, portraits, realism, renaissance, romanticism |
                            ?artist__milton_glaser colorful, contemporary, graphic-design, pop-art, vibrant, whimsical |
                            ?artist__warwick_goble art-nouveau, folklore, kids-book, muted-colors, nature, whimsical |
                            ?artist__john_william_godward characters, impressionism, portraits, realism, renaissance, romanticism |
                            ?artist__sacha_goldberger characters, contemporary, identity, immigrants, mixed-media, photography, photography-color, portraits |
                            ?artist__nan_goldin conceptual, contemporary, expressionism, photography, photography-color, portraits, realism, whimsical |
                            ?artist__josan_gonzalez atmospheric, cyberpunk, futuristic, illustration, science-fiction, technology |
                            ?artist__felix_gonzalez_torres conceptual, contemporary, installation, LGBTQ, minimalism |
                            ?artist__derek_gores colorful, contemporary, expressionism, portraits |
                            ?artist__edward_gorey dark, eerie, gothic, horror, kids-book, monochromatic, mysterious |
                            ?artist__arshile_gorky abstract-Expressionism, painting |
                            ?artist__alessandro_gottardo characters, dream-like, flat-colors, illustration, playful, whimsical |
                            ?artist__adolph_gottlieb abstract, abstract-expressionism, color-field, contemporary, geometric |
                            ?artist__francisco_goya dark, etching, horror, oil-painting, politics, portraits, romanticism, satire, social-commentary, Spanish |
                            ?artist__laurent_grasso Conceptual, contemporary, Sculpture, Surreal, surreal |
                            ?artist__mab_graves big-eyes, conceptual, contemporary, dream-like, expressionism, magic-realism, portraits, whimsical |
                            ?artist__eileen_gray abstract, architecture, Friendship, Loneliness, modern, painting |
                            ?artist__kate_greenaway British, childhood, fashion, illustration, kids-book, romanticism, Victorian |
                            ?artist__alex_grey abstract-expressionism, colorful, contemporary, dream-like, psychedelic, surreal, vibrant |
                            ?artist__carne_griffiths conceptual, contemporary, expressionism, messy, portraits, whimsical |
                            ?artist__gris_grimly comics, dark, eerie, fantasy, gothic, illustration, kids-book, surreal, whimsical |
                            ?artist__brothers_grimm characters, dark, folklore, kids-book, magic |
                            ?artist__tracie_grimwood colorful, dream-like, fantasy, kids-book, playful, whimsical |
                            ?artist__matt_groening cartoon, colorful, pop-culture, satire, whimsical |
                            ?artist__alex_gross contemporary, portraits, surreal, whimsical |
                            ?artist__tom_grummett comics, contemporary, illustration, superheroes |
                            ?artist__huang_guangjian contemporary, impressionism, landscapes, oil-painting |
                            ?artist__wu_guanzhong contemporary, Feminism, Homo-eroticism, Illustration, landscapes |
                            ?artist__rebecca_guay digital, dream-like, ethereal, fantasy, illustration, magic, watercolor |
                            ?artist__guercino baroque, italian, painting, religion |
                            ?artist__jeannette_guichard_bunel conceptual, contemporary, expressionism, figurativism, portraits, whimsical |
                            ?artist__scott_gustafson fantasy, illustration, kids-book, magic-realism, playful, whimsical |
                            ?artist__wade_guyton contemporary, mixed-media, pop-art |
                            ?artist__hans_haacke conceptual, contemporary, environmentalism, installation, politics, sculpture |
                            ?artist__robert_hagan colorful, dream-like, impressionism, landscapes, nature, romanticism, vibrant |
                            ?artist__philippe_halsman conceptual, monochromatic, photography, photography-bw, portraits, whimsical |
                            ?artist__maggi_hambling american, conceptual, contemporary, expressionism, installation, portraits, vibrant |
                            ?artist__richard_hamilton Consumerism, Mixed-media, Pop-art, Pop-Art |
                            ?artist__bess_hamiti contemporary, dream-like, impressionism, landscapes, magic-realism, surreal, vibrant, whimsical |
                            ?artist__tom_hammick dream-like, figurativism, flat-colors, landscapes, multimedia, nature, vibrant |
                            ?artist__david_hammons abstract, African-American, conceptual, contemporary, installation, social-commentary |
                            ?artist__ren_hang characters, contemporary, impressionism, nudes, photography, photography-color, portraits |
                            ?artist__erin_hanson atmospheric, colorful, dream-like, impressionism, landscapes, nature, serenity, vibrant |
                            ?artist__keith_haring activism, expressionism, flat-colors, graffiti, high-contrast, LGBTQ, pop-art, street-art, vibrant |
                            ?artist__alexei_harlamoff childhood, impressionism, portraits, realism |
                            ?artist__charley_harper animals, flat-colors, folk-art, illustration, muted-colors, nature, playful, whimsical |
                            ?artist__john_harris dark, dystopia, illustration, outer-space, science-fiction |
                            ?artist__florence_harrison art-nouveau, delicate, dream-like, kids-book, romanticism, whimsical |
                            ?artist__marsden_hartley abstract, American, expressionism, landscapes, modern, portraits, primitivism |
                            ?artist__ryohei_hase creatures, digital, dream-like, ethereal, fantasy, illustration, magic-realism, mysterious, surreal |
                            ?artist__childe_hassam American, cityscapes, impressionism, landscapes |
                            ?artist__ben_hatke adventure, cartoon, characters, kids-book, playful, whimsical |
                            ?artist__mona_hatoum body-art, conceptual, contemporary, displacement, installation, sculpture |
                            ?artist__pam_hawkes ceramics, contemporary, delicate, figurative, figurativism, nature, organic, portraits |
                            ?artist__jamie_hawkesworth contemporary, nature, photography, photography-color, portraits, street-art, urban-life, vibrant |
                            ?artist__stuart_haygarth angular, colorful, conceptual, contemporary, installation, vibrant |
                            ?artist__erich_heckel expressionism, german, landscapes, modern, portraits |
                            ?artist__valerie_hegarty metamorphosis, painting, sculpture, Social-commentary |
                            ?artist__mary_heilmann abstract, colorful, contemporary, geometric, minimalism, vibrant |
                            ?artist__michael_heizer angular, earthworks, installation, land-art, landscapes, large-scale, nature |
                            ?artist__gottfried_helnwein childhood, contemporary, dark, horror, photography, photography-color, portraits, social-commentary |
                            ?artist__barkley_l_hendricks african-american, contemporary, expressionism, femininity, figurativism, identity, portraits |
                            ?artist__bill_henson conceptual, contemporary, dark, landscapes, photography, photography-color, portraits, whimsical |
                            ?artist__barbara_hepworth abstract, modern, nature, organic, sculpture |
                            ?artist__herge belgian, comics, contemporary |
                            ?artist__carolina_herrera characters, contemporary, fashion, femininity, celebrity |
                            ?artist__george_herriman comics, contemporary, Illustration, politics, Satire |
                            ?artist__don_hertzfeldt animation, dark, drawing, surreal, whimsical |
                            ?artist__prudence_heward colorful, expressionism, feminism, nature, portraits |
                            ?artist__ryan_hewett cubism, mysticism, portraits |
                            ?artist__nora_heysen Consumerism, contemporary, Femininity, landscapes, painting |
                            ?artist__george_elgar_hicks impressionism, landscapes |
                            ?artist__lorenz_hideyoshi cyberpunk, dark, digital, dystopia, futuristic, illustration, science-fiction |
                            ?artist__brothers_hildebrandt fantasy, illustration, painting, superheroes, vibrant |
                            ?artist__dan_hillier contemporary, graffiti, monochromatic, portraits, street-art, urban-life |
                            ?artist__lewis_hine activism, documentary, monochromatic, photography, photography-bw, social-commentary, social-realism |
                            ?artist__miho_hirano characters, contemporary, fantasy, japanese, magic-realism, portraits, whimsical |
                            ?artist__harumi_hironaka dream-like, femininity, manga-anime, pastel-colors, portraits, serenity, watercolor |
                            ?artist__hiroshige Edo-period, Japanese, landscapes, nature, printmaking, ukiyo-e, woodblock |
                            ?artist__morris_hirshfield animals, contemporary, illustration, minimalism, whimsical |
                            ?artist__damien_hirst animals, British, conceptual, contemporary, death, installation, mixed-media, sculpture, shock-art |
                            ?artist__fan_ho Chinese, contemporary, film, high-contrast, monochromatic, photography, photography-bw |
                            ?artist__meindert_hobbema Dutch-Golden-Age, landscapes, Observational, painting, Plein-air |
                            ?artist__david_hockney British, colorful, cubism, pools, pop-art, portraits |
                            ?artist__filip_hodas , 3D-rendering, contemporary, dark, digital, dream-like, pop-culture, science-fiction, surreal |
                            ?artist__howard_hodgkin abstract, color-field, contemporary, modern, nature, vibrant |
                            ?artist__ferdinand_hodler characters, contemporary, impressionism, landscapes, nature, portraits, swiss |
                            ?artist__tiago_hoisel characters, contemporary, illustration, whimsical |
                            ?artist__katsushika_hokusai Edo-period, high-contrast, Japanese, japanese, nature, ukiyo-e, waves, woodblock |
                            ?artist__hans_holbein_the_younger anthropomorphism, painting, portraits, Renaissance |
                            ?artist__frank_holl colorful, impressionism, portraits, street-art, urban-life |
                            ?artist__carsten_holler contemporary, experiential, immersive, interactive, playful |
                            ?artist__zena_holloway animals, British, fashion, female-figures, Photography, photography-color, portraits, underwater |
                            ?artist__edward_hopper American, architecture, impressionism, landscapes, loneliness, nostalgia, oil-painting, realism, solitude, urban-life |
                            ?artist__aaron_horkey comics, etching, fantasy, illustration |
                            ?artist__alex_horley characters, dark, fantasy, grungy, horror, illustration |
                            ?artist__roni_horn American, conceptual, environmentalism, installation, LGBTQ, minimalism, nature, photography, photography-color, sculpture |
                            ?artist__john_howe characters, dark, eerie, fantasy, landscapes, nature, portraits |
                            ?artist__alex_howitt contemporary, Fleeting-moments, Illustration, monochromatic, painting, Slice-of-life |
                            ?artist__meghan_howland contemporary, dream-like, figurativism, identity, portraits |
                            ?artist__john_hoyland abstract, color-field, contemporary, geometric, messy, modern, vibrant |
                            ?artist__shilin_huang characters, dream-like, fantasy, magic, mysterious, mythology |
                            ?artist__arthur_hughes impressionism, landscapes, nature, portraits, romanticism |
                            ?artist__edward_robert_hughes characters, dream-like, ethereal, fantasy, impressionism, nostalgia, romanticism, whimsical |
                            ?artist__jack_hughes contemporary, expressionism, flat-colors, portraits, vibrant |
                            ?artist__talbot_hughes impressionism, landscapes, nature, portraits, romanticism |
                            ?artist__pieter_hugo contemporary, dutch, environmentalism, landscapes, photography, photography-color, portraits, social-commentary |
                            ?artist__gary_hume abstract, flat-colors, geometric, minimalism, modern, painting |
                            ?artist__friedensreich_hundertwasser abstract, colorful, contemporary, expressionism, organic, vibrant, whimsical |
                            ?artist__william_holman_hunt impressionism, landscapes, nature, portraits, romanticism |
                            ?artist__george_hurrell contemporary, fashion, high-contrast, luxury, photography, photography-bw, portraits |
                            ?artist__fabio_hurtado contemporary, cubism, figurativism, modern, multimedia, portraits |
                            ?artist__hush Activism, messy, painting, Street-art |
                            ?artist__michael_hutter dream-like, eerie, fantasy, horror, science-fiction, surreal |
                            ?artist__pierre_huyghe conceptual, contemporary, multimedia, surreal |
                            ?artist__doug_hyde contemporary, illustration, kids-book, playful, whimsical |
                            ?artist__louis_icart art-deco, dancers, femininity, impressionism, low-contrast, romanticism, urban-life |
                            ?artist__robert_indiana contemporary, flat-colors, graphic-design, pop-art, typography, vibrant |
                            ?artist__jean_auguste_dominique_ingres french, portraits, realism, romanticism |
                            ?artist__robert_irwin angular, contemporary, environmentalism, installation, minimalism |
                            ?artist__gabriel_isak contemporary, melancholy, surreal, Swedish |
                            ?artist__junji_ito contemporary, dark, fantasy, horror, manga-anime, monochromatic, portraits, surreal |
                            ?artist__christophe_jacrot architecture, atmospheric, cityscapes, photography, photography-color, urban-life |
                            ?artist__louis_janmot characters, french, impressionism, portraits, romanticism |
                            ?artist__frieke_janssens conceptual, contemporary, photography, photography-color, portraits |
                            ?artist__alexander_jansson dark, dream-like, fantasy, mythology, surreal, whimsical |
                            ?artist__tove_jansson adventure, cartoon, kids-book, playful, whimsical |
                            ?artist__aaron_jasinski characters, colorful, comics, contemporary, pop-art, portraits, whimsical |
                            ?artist__alexej_von_jawlensky colorful, expressionism, german, modern, portraits, spirituality, vibrant |
                            ?artist__james_jean fantasy, muted-colors, mysterious, mythology, pastel-colors |
                            ?artist__oliver_jeffers cartoon, colorful, kids-book, playful, whimsical |
                            ?artist__lee_jeffries conceptual, contemporary, high-contrast, monochromatic, portraits, social-commentary |
                            ?artist__georg_jensen jewelry, sculpture |
                            ?artist__ellen_jewett digital, expressionism, installation, nature, sculpture, surreal, whimsical |
                            ?artist__he_jiaying contemporary, Femininity, identity, painting, Realism |
                            ?artist__chantal_joffe contemporary, expressionism, figurativism, portraits, social-commentary |
                            ?artist__martine_johanna colorful, contemporary, femininity, figurativism, identity, portraits |
                            ?artist__augustus_john British, color-field, impressionism, landscapes, nature, portraits |
                            ?artist__gwen_john contemporary, femininity, impressionism, nature, portraits, watercolor, whimsical |
                            ?artist__jasper_johns abstract-Expressionism, Mysticism, painting |
                            ?artist__eastman_johnson american, contemporary, impressionism, landscapes, nature, portraits, urban-life |
                            ?artist__alfred_cheney_johnston conceptual, contemporary, minimalism, monochromatic, photography, photography-bw, portraits |
                            ?artist__dorothy_johnstone contemporary, femininity, figurativism, impressionism, landscapes, nature, portraits |
                            ?artist__android_jones colorful, conceptual, digital, dream-like, geometric, psychedelic, surreal |
                            ?artist__erik_jones collage, colorful, cubism, portraits, vibrant |
                            ?artist__jeffrey_catherine_jones fantasy, figurativism, posters, pulp, realism |
                            ?artist__peter_andrew_jones alien-worlds, eerie, fantasy, futuristic, outer-space, science-fiction |
                            ?artist__loui_jover contemporary, eerie, Illustration, satire |
                            ?artist__amy_judd contemporary, fantasy, nature, photorealism, portraits, surreal |
                            ?artist__donald_judd angular, contemporary, installation, metalwork, minimalism, sculpture |
                            ?artist__jean_jullien cartoon, flat-colors, graphic-design, high-contrast, minimalism, playful |
                            ?artist__matthias_jung architecture, conceptual, digital, dream-like, environmentalism, futuristic, minimalism, surreal |
                            ?artist__joe_jusko comics, fantasy |
                            ?artist__frida_kahlo dream-like, feminism, Mexican, portraits, self-portraits, vibrant |
                            ?artist__hayv_kahraman contemporary, fantasy, femininity, figurativism, portraits, whimsical |
                            ?artist__mw_kaluta dream-like, ethereal, fantasy, nostalgia, romanticism, victorian, whimsical |
                            ?artist__nadav_kander conceptual, contemporary, landscapes, minimalism, photography, photography-color, portraits, street-art, urban-life |
                            ?artist__wassily_kandinsky abstract, Bauhaus, expressionism, modern, Russian, spirituality, vibrant |
                            ?artist__jun_kaneko abstract, contemporary, geometric, organic, sculpture, vibrant |
                            ?artist__titus_kaphar African-American, conceptual, contemporary, figurativism, portraits, social-commentary |
                            ?artist__michal_karcz digital, eerie, fantasy, futuristic, landscapes, photorealism, science-fiction, surreal |
                            ?artist__gertrude_kasebier American, family, female-figures, monochromatic, photography, photography-bw, portraits, rural-life |
                            ?artist__terada_katsuya fantasy, magic, manga-anime, portraits |
                            ?artist__audrey_kawasaki art-nouveau, contemporary, fantasy, japanese, magic-realism, manga-anime, portraits, whimsical |
                            ?artist__hasui_kawase landscapes, Plein-air, Printmaking, Slice-of-life, ukiyo-e |
                            ?artist__glen_keane adventure, cartoon, characters, drawing, kids-book, playful, whimsical |
                            ?artist__margaret_keane big-eyes, cartoon, childhood, colorful, contemporary, femininity, pop-art, portraits, whimsical |
                            ?artist__ellsworth_kelly abstract, color-field, contemporary, flat-colors, geometric, minimalism |
                            ?artist__michael_kenna British, contemporary, high-contrast, landscapes, minimalism, monochromatic, photography, photography-bw |
                            ?artist__thomas_benjamin_kennington figurativism, impressionism, portraits, realism |
                            ?artist__william_kentridge African, animation, contemporary, drawing, messy, monochromatic, politics, printmaking |
                            ?artist__hendrik_kerstens conceptual, contemporary, fashion, photography, photography-color, portraits, whimsical |
                            ?artist__jeremiah_ketner activism, big-eyes, contemporary, female-figures, femininity, illustration, Social-commentary |
                            ?artist__fernand_khnopff metaphysics, painting, Sculpture, Symbolist |
                            ?artist__hideyuki_kikuchi dark, eerie, fantasy, horror, manga-anime |
                            ?artist__tom_killion contemporary, landscapes, Observational, Plein-air, Printmaking |
                            ?artist__thomas_kinkade color-field, contemporary, impressionism, landscapes, nature, portraits |
                            ?artist__jack_kirby comics, science-fiction, superheroes |
                            ?artist__ernst_ludwig_kirchner expressionism, german, landscapes, modern, portraits |
                            ?artist__tatsuro_kiuchi colorful, digital, flat-colors, landscapes, nature, street-art, urban-life, whimsical |
                            ?artist__jon_klassen animals, dream-like, kids-book, nature, playful, watercolor, whimsical |
                            ?artist__paul_klee abstract, Bauhaus, expressionism, German, playful |
                            ?artist__william_klein American, fashion, minimalism, monochromatic, photography, photography-bw, urban-life |
                            ?artist__yves_klein abstract, color-field, expressionism, fashion, French, modern, monochromatic, performance |
                            ?artist__carl_kleiner abstract, American, collage, digital, graphic-design, pop-art, portraits |
                            ?artist__gustav_klimt art-nouveau, Austrian, erotica, female-figures, golden, mosaic, portraits |
                            ?artist__godfrey_kneller baroque, impressionism, portraits, realism |
                            ?artist__emily_kame_kngwarreye Aboriginal, abstract, australian, colorful, dream-like, expressionism, landscapes, nature |
                            ?artist__chad_knight collage, colorful, digital, playful, pop-art, surreal |
                            ?artist__nick_knight Adventure, Fantasy, fashion, pastel-colors, photography, photography-color, Pop-art, surreal |
                            ?artist__helene_knoop characters, conceptual, contemporary, feminism, figurativism, minimalism, portraits |
                            ?artist__phil_koch atmospheric, colorful, contemporary, landscapes, nature, photography, photography-color, serenity, vibrant |
                            ?artist__kazuo_koike comics, fantasy, manga-anime |
                            ?artist__oskar_kokoschka Austrian, expressionism, german, landscapes, modern, portraits |
                            ?artist__kathe_kollwitz contemporary, expressionism, high-contrast, monochromatic, portraits, social-commentary |
                            ?artist__michael_komarck battle-scenes, contemporary, fantasy, illustration, painting |
                            ?artist__satoshi_kon dream-like, fantasy, manga-anime, surreal, whimsical |
                            ?artist__jeff_koons colorful, consumerism, contemporary, kitsch, pop-art, post-modern, sculpture |
                            ?artist__caia_koopman big-eyes, colorful, conceptual, contemporary, femininity, pop-art, portraits, surreal, whimsical |
                            ?artist__konstantin_korovin impressionism, Impressionism, painting, Plein-air |
                            ?artist__mark_kostabi figurative, modern, politics |
                            ?artist__bella_kotak conceptual, contemporary, fashion, photography, photography-color, portraits, urban-life |
                            ?artist__andrea_kowch contemporary, dark, fantasy, magic-realism, portraits, whimsical |
                            ?artist__lee_krasner abstract, abstract-expressionism, color-field, expressionism, feminism, gestural, improvisation |
                            ?artist__barbara_kruger advertising, conceptual, contemporary, feminism, graphic-design, high-contrast, montage, text-based |
                            ?artist__brad_kunkle conceptual, contemporary, dream-like, photography, photography-color, portraits |
                            ?artist__yayoi_kusama contemporary, fashion, feminism, infinity-rooms, installation, polka-dots, pop-art, vibrant |
                            ?artist__michael_k_kutsche characters, dark, dream-like, fantasy, mysterious, mythology |
                            ?artist__ilya_kuvshinov digital, dream-like, ethereal, fantasy, manga-anime, romanticism, surreal, vibrant |
                            ?artist__david_lachapelle conceptual, contemporary, luxury, photography, photography-color, pop-art, vibrant |
                            ?artist__raphael_lacoste atmospheric, dark, dream-like, eerie, fantasy, landscapes, mysterious |
                            ?artist__lev_lagorio landscapes, Observational, painting, Plein-air, Realism |
                            ?artist__rene_lalique art-deco, art-nouveau, French, glasswork, jewelry, luxury, nature, sculpture |
                            ?artist__abigail_larson dark, eerie, fantasy, kids-book, whimsical |
                            ?artist__gary_larson American, animals, cartoon, comics, newspaper, pop-culture, satire, slice-of-life |
                            ?artist__denys_lasdun Architecture, contemporary, metaphysics |
                            ?artist__maria_lassnig expressionism, figurative, self-portraits |
                            ?artist__dorothy_lathrop art-nouveau, delicate, dream-like, kids-book, romanticism, whimsical |
                            ?artist__melissa_launay contemporary, painting |
                            ?artist__john_lavery contemporary, impressionism, irish, landscapes, nature, portraits |
                            ?artist__jacob_lawrence African-American, angular, contemporary, cubism, harlem-renaissance, modern, social-realism |
                            ?artist__thomas_lawrence characters, femininity, impressionism, portraits, realism, romanticism |
                            ?artist__ernest_lawson American, everyday-life, impressionism, landscapes |
                            ?artist__bastien_lecouffe_deharme characters, dark, digital, ethereal, fantasy, magic, surreal |
                            ?artist__alan_lee dream-like, ethereal, fantasy, mythology, nostalgia, romanticism |
                            ?artist__minjae_lee contemporary, expressionism, fantasy, messy, portraits, South-Korean, whimsical |
                            ?artist__nina_leen conceptual, contemporary, monochromatic, photography, photography-bw, portraits, street-art, urban-life |
                            ?artist__fernand_leger abstract, colorful, cubism, geometric, modern |
                            ?artist__paul_lehr colorful, eerie, fantasy, futuristic, science-fiction, surreal |
                            ?artist__frederic_leighton expressionism, landscapes, portraits, romanticism |
                            ?artist__alayna_lemmer contemporary, expressionism, mixed-media |
                            ?artist__tamara_de_lempicka art-deco, cubism, fashion, luxury, portraits, romanticism |
                            ?artist__sol_lewitt abstract, conceptual, contemporary, geometric, minimalism, sculpture, serial-art, wall-drawings |
                            ?artist__jc_leyendecker American, illustration, nostalgia, pop-culture, portraits, posters |
                            ?artist__andre_lhote Cubism, impressionism, painting |
                            ?artist__roy_lichtenstein American, comics, expressionism, flat-colors, pop-art, portraits |
                            ?artist__rob_liefeld comics, fantasy, science-fiction, superheroes |
                            ?artist__fang_lijun contemporary, dutch, figurativism, portraits, realism, vibrant |
                            ?artist__maya_lin architecture, contemporary, environmentalism, identity, installation, land-art |
                            ?artist__filippino_lippi expressionism, landscapes, portraits, renaissance |
                            ?artist__herbert_list German, monochromatic, photography, photography-bw, portraits |
                            ?artist__richard_long British, contemporary, land-art, sculpture |
                            ?artist__yoann_lossel animals, fantasy, golden, illustration, realism |
                            ?artist__morris_louis abstract-expressionism, color-field, minimalism, painting |
                            ?artist__sarah_lucas contemporary, Femininity, feminism, sculpture, surreal |
                            ?artist__maximilien_luce , french, impressionism, landscapes, nature, oil-painting, plein-air, romanticism, vibrant |
                            ?artist__loretta_lux american, childhood, contemporary, impressionism, installation, photography, photography-color, portraits |
                            ?artist__george_platt_lynes fashion, figure-studies, homo-eroticism, LGBTQ, monochromatic, nudes, photography, photography-bw |
                            ?artist__frances_macdonald Allegory, impressionism, landscapes, Nostalgia, painting |
                            ?artist__august_macke abstract, colorful, expressionism, impressionism, modern, serenity, vibrant |
                            ?artist__stephen_mackey contemporary, dark, dream-like, expressionism, landscapes, surreal |
                            ?artist__rachel_maclean colorful, contemporary, photography, photography-color, portraits, Scottish, whimsical |
                            ?artist__raimundo_de_madrazo_y_garreta expressionism, impressionism, landscapes, portraits |
                            ?artist__joe_madureira comics, fantasy, superheroes |
                            ?artist__rene_magritte Belgian, cloudscapes, cubism, illusion, impressionism, surreal |
                            ?artist__jim_mahfood comics, graffiti, pop-art, street-art |
                            ?artist__vivian_maier contemporary, expressionism, landscapes, monochromatic, photography, photography-bw, portraits |
                            ?artist__aristide_maillol female-figures, modern, painting, Sculpture |
                            ?artist__don_maitz eerie, fantasy, futuristic, science-fiction, surreal |
                            ?artist__laura_makabresku contemporary, dark, Femininity, muted-colors, photography, photography-color, portraits, shallow-depth-of-field, surreal |
                            ?artist__alex_maleev comics, dark, fantasy, noir |
                            ?artist__keith_mallett dark, figurativism, minimalism, modern, muted-colors, sculpture, urban-life |
                            ?artist__johji_manabe comics, contemporary, Illustration, manga-anime, Metamorphosis, Science-fiction |
                            ?artist__milo_manara Comics, Controversy, erotica, Femininity, Illustration |
                            ?artist__edouard_manet controversy, femininity, French, impressionism, modern-life, portraits, realism, still-life |
                            ?artist__henri_manguin colorful, fauvism, impressionism, painting |
                            ?artist__jeremy_mann contemporary, dark, expressionism, grungy, messy, portraits, urban-life |
                            ?artist__sally_mann childhood, family, monochromatic, photography, photography-bw, social-commentary, suburbia |
                            ?artist__andrea_mantegna mythology, painting, religion, renaissance, spanish |
                            ?artist__antonio_j_manzanedo characters, dark, fantasy, mysterious |
                            ?artist__robert_mapplethorpe BDSM, figure-studies, homo-eroticism, LGBTQ, monochromatic, nudes, photography, photography-bw, portraits |
                            ?artist__franz_marc animals, colorful, cubism, expressionism, spirituality, vibrant |
                            ?artist__ivan_marchuk contemporary, expressionism, painting |
                            ?artist__brice_marden abstract, contemporary, minimalism |
                            ?artist__andrei_markin contemporary, expressionism, figurativism, impressionism, portraits |
                            ?artist__kerry_james_marshall collage, contemporary, expressionism, landscapes, portraits |
                            ?artist__serge_marshennikov contemporary, expressionism, impressionism, landscapes, portraits |
                            ?artist__agnes_martin abstract-expressionism, color-field, contemporary, grids, minimalism, spirituality |
                            ?artist__adam_martinakis 3D-rendering, conceptual, digital, dream-like, futuristic, multimedia, sculpture, virtual-reality |
                            ?artist__stephan_martiniere atmospheric, dark, fantasy, futuristic, landscapes, science-fiction, surreal |
                            ?artist__ilya_mashkov expressionism, painting, russian, Symbolist |
                            ?artist__henri_matisse collage, color-field, colorful, cut-outs, fauvism, French, impressionism, sculpture |
                            ?artist__rodney_matthews colorful, eerie, fantasy, futuristic, science-fiction |
                            ?artist__anton_mauve impressionism, landscapes, painting |
                            ?artist__peter_max colorful, contemporary, pop-art, surreal, vibrant |
                            ?artist__mike_mayhew comics, fantasy, portraits |
                            ?artist__angus_mcbride battle-scenes, British, fantasy, history, horses, illustration |
                            ?artist__anne_mccaffrey adventure, dragons, fantasy, magic, mythology, science-fiction |
                            ?artist__robert_mccall futuristic, outer-space, science-fiction |
                            ?artist__scott_mccloud comics, contemporary, pop-art |
                            ?artist__steve_mccurry documentary, photography, photography-color, portraits, rural-life, shallow-depth-of-field, social-commentary |
                            ?artist__todd_mcfarlane comics, dark, fantasy |
                            ?artist__barry_mcgee contemporary, painting, street-art, urban-life |
                            ?artist__ryan_mcginley colorful, contemporary, dream-like, nudes, photography, photography-color, portraits, vibrant |
                            ?artist__robert_mcginnis dream-like, erotica, figurative, illustration, pulp, romanticism |
                            ?artist__richard_mcguire colorful, conceptual, flat-colors, illustration, whimsical |
                            ?artist__patrick_mchale cartoon, contemporary, drawing |
                            ?artist__kelly_mckernan contemporary, expressionism, magic-realism, portraits, watercolor, whimsical |
                            ?artist__angus_mckie fantasy, futuristic, science-fiction |
                            ?artist__alasdair_mclellan american, contemporary, fashion, impressionism, installation, photography, photography-bw, photography-color, portraits |
                            ?artist__jon_mcnaught cartoon, flat-colors, illustration, playful |
                            ?artist__dan_mcpharlin dream-like, ethereal, magic, science-fiction, surreal |
                            ?artist__tara_mcpherson american, contemporary, impressionism, installation, pop-art, portraits, surreal |
                            ?artist__ralph_mcquarrie eerie, futuristic, landscapes, science-fiction |
                            ?artist__ian_mcque dark, fantasy, grungy, messy, science-fiction, surreal |
                            ?artist__syd_mead angular, flat-colors, futuristic, minimalism, modern, science-fiction, technology |
                            ?artist__richard_meier architecture, conceptual, geometric, minimalism, sculpture |
                            ?artist__maria_sibylla_merian biological, botanical, insects, naturalist, nature, observational |
                            ?artist__willard_metcalf American, landscapes, muted-colors, tonalism |
                            ?artist__gabriel_metsu baroque, expressionism, portraits, still-life |
                            ?artist__jean_metzinger cubism, geometric, modern, vibrant |
                            ?artist__michelangelo ceiling-painting, figurative, frescoes, Italian, religion, renaissance, sculpture |
                            ?artist__nicolas_mignard baroque, expressionism, landscapes, portraits |
                            ?artist__mike_mignola comics, dark, high-contrast, high-contrast |
                            ?artist__dimitra_milan contemporary, expressionism, messy, portraits, whimsical |
                            ?artist__john_everett_millais expressionism, impressionism, landscapes, portraits |
                            ?artist__marilyn_minter erotica, messy, painting, photography, photography-color, photorealism, portraits |
                            ?artist__januz_miralles contemporary, low-contrast, monochromatic, portraits, watercolor |
                            ?artist__joan_miro abstract, color-field, colorful, modern, playful, sculpture, Spanish |
                            ?artist__joan_mitchell abstract, expressionism, large-scale, messy |
                            ?artist__hayao_miyazaki adventure, animation, fantasy, film, Japanese, kids-book, manga-anime, whimsical |
                            ?artist__paula_modersohn_becker expressionism, family, female-figures, femininity, German, painting, portraits, self-portraits |
                            ?artist__amedeo_modigliani expressionism, fauvism, Italian, modern, portraits, romanticism, sculpture |
                            ?artist__moebius comics, dream-like, fantasy, psychedelic, science-fiction, surreal |
                            ?artist__peter_mohrbacher dark, dream-like, ethereal, fantasy, mythology, surreal, whimsical |
                            ?artist__piet_mondrian abstract, angular, Dutch, geometric, primary-colors, vibrant |
                            ?artist__claude_monet color-field, French, impressionism, landscapes, plein-air, seascapes, water-lilies |
                            ?artist__jean_baptiste_monge dark, eerie, fantasy, mysterious, surreal |
                            ?artist__alyssa_monks contemporary, expressionism, figurativism, messy, photorealism, portraits |
                            ?artist__alan_moore comics, dark, dystopia, fantasy, graphic-novel, grungy, horror, noir, science-fiction |
                            ?artist__antonio_mora american, contemporary, landscapes, monochromatic, photography, photography-bw, portraits, surreal |
                            ?artist__edward_moran american, hudson-river-school, landscapes, painting, seascapes |
                            ?artist__koji_morimoto contemporary, cute, illustration, Japanese, monsters, surreal |
                            ?artist__berthe_morisot domestic-scenes, feminism, fleeting-moments, French, impressionism, landscapes, portraits, still-life |
                            ?artist__daido_moriyama documentary, grungy, Japanese, monochromatic, photography, photography-bw, post-war, urban-life |
                            ?artist__james_wilson_morrice impressionism, landscapes, painting, plein-air |
                            ?artist__sarah_morris abstract, contemporary, Femininity, identity, painting |
                            ?artist__john_lowrie_morrison contemporary, impressionism, landscapes, vibrant |
                            ?artist__igor_morski american, contemporary, portraits, surreal |
                            ?artist__john_kenn_mortensen dark, eerie, horror, kids-book, monochromatic |
                            ?artist__victor_moscoso colorful, pop-art, psychedelic, typography, vibrant |
                            ?artist__inna_mosina Ballet, contemporary, Femininity, identity, Photography, photography-color, Sculpture, shallow-depth-of-field |
                            ?artist__richard_mosse battle-scenes, colorful, documentary, landscapes, photography, photography-color, surreal, vibrant |
                            ?artist__thomas_edwin_mostyn British, landscapes, mysticism, portraits, pre-raphaelite, romanticism, still-life |
                            ?artist__marcel_mouly abstract, colorful, contemporary, fauvism, French, modern, vibrant |
                            ?artist__emmanuelle_moureaux abstract, colorful, contemporary, environmentalism, installation, multimedia, sculpture, vibrant |
                            ?artist__alphonse_mucha art-nouveau, commercial-art, Czech, femininity, portraits, posters, stained-glass |
                            ?artist__craig_mullins dark, dream-like, fantasy, horror, mythology, surreal |
                            ?artist__augustus_edwin_mulready Commercial-art, painting, Realism, Romanticism, Symbolist |
                            ?artist__dan_mumford colorful, digital, dreams, fantasy, psychedelic, surreal, vibrant |
                            ?artist__edvard_munch anxiety, dark, expressionism, impressionism, melancholy, Norwegian, oil-painting |
                            ?artist__alfred_munnings horses, modern, painting |
                            ?artist__gabriele_munter expressionism, Expressionism, painting, Symbolist |
                            ?artist__takashi_murakami contemporary, cute, flat-colors, Japanese, manga-anime, pop-art |
                            ?artist__patrice_murciano colorful, contemporary, expressionism, messy, pop-art, portraits, surreal, vibrant |
                            ?artist__scott_musgrove Adventure, Advertising, contemporary, Illustration, landscapes |
                            ?artist__wangechi_mutu Collage, contemporary, Feminism, identity, Mixed-media |
                            ?artist__go_nagai childhood, manga-anime, portraits |
                            ?artist__hiroshi_nagai cityscapes, flat-colors, japanese, landscapes, minimalism, urban-life |
                            ?artist__patrick_nagel contemporary, flat-colors, high-contrast, pop-art, portraits |
                            ?artist__tibor_nagy contemporary, metaphysics, Sculpture, Symbolist |
                            ?artist__scott_naismith colorful, impressionism, landscapes, messy, seascapes, serenity, vibrant |
                            ?artist__juliana_nan contemporary, macro-world, photography, photography-color |
                            ?artist__ted_nasmith atmospheric, ethereal, fantasy, landscapes, magic, mythology |
                            ?artist__todd_nauck adventure, characters, comics, science-fiction, superheroes |
                            ?artist__bruce_nauman conceptual, contemporary, neon, performance, sculpture |
                            ?artist__ernst_wilhelm_nay abstract, colorful, expressionism, figurativism, german, modern, vibrant |
                            ?artist__alice_neel contemporary, expressionism, feminism, figurative, portraits, social-realism |
                            ?artist__keith_negley collage, colorful, graphic-design, illustration, mixed-media, pop-art |
                            ?artist__leroy_neiman colorful, contemporary, messy, painting, sports |
                            ?artist__kadir_nelson African-American, contemporary, expressionism, impressionism, landscapes, portraits |
                            ?artist__odd_nerdrum characters, dark, fantasy, figurative, melancholy |
                            ?artist__shirin_neshat contemporary, feminism, identity, Iranian, photography, photography-bw, video-art |
                            ?artist__mikhail_nesterov Figurative, painting, Religion, religion, Romanticism, spirituality |
                            ?artist__jane_newland botanical, colorful, nature, serenity, watercolor |
                            ?artist__victo_ngai colorful, dream-like, illustration, kids-book, playful, surreal |
                            ?artist__william_nicholson Modern, Observational, painting, Slice-of-life |
                            ?artist__florian_nicolle contemporary, expressionism, messy, portraits, watercolor |
                            ?artist__kay_nielsen American, Danish, elegant, exoticism, Fantasy, fantasy, illustration, kids-book, orientalism, painting, whimsical |
                            ?artist__tsutomu_nihei alien-worlds, cyberpunk, dark, dystopia, industrial, manga-anime, monochromatic, science-fiction |
                            ?artist__victor_nizovtsev colorful, dream-like, fantasy, magic, magic-realism, mysterious, surreal, whimsical |
                            ?artist__isamu_noguchi Japanese, landscape-architecture, organic, sculpture |
                            ?artist__catherine_nolin conceptual, contemporary, feminism, portraits |
                            ?artist__francois_de_nome baroque, expressionism, mixed-media |
                            ?artist__earl_norem battle-scenes, dark, fantasy, mythology |
                            ?artist__phil_noto american, characters, comics, contemporary, impressionism, installation, portraits |
                            ?artist__georgia_okeeffe abstract, American, figurativism, flowers, landscapes, modern, precisionism, southwest |
                            ?artist__terry_oakes adventure, fantasy, magic, outer-space, science-fiction |
                            ?artist__chris_ofili afro-futurism, contemporary, expressionism, figurative, mixed-media, painting, post-colonialism, watercolor |
                            ?artist__jack_ohman comics, contemporary, Illustration, politics, Satire |
                            ?artist__noriyoshi_ohrai fantasy, futuristic, posters, science-fiction, vibrant |
                            ?artist__helio_oiticica abstract, angular, contemporary, installation, interactive, multimedia |
                            ?artist__taro_okamoto avant-garde, gutai, Japanese, performance, sculpture, surreal |
                            ?artist__tim_okamura African-American, contemporary, expressionism, graffiti, landscapes, portraits, street-art |
                            ?artist__naomi_okubo collage, colorful, empowerment, feminism, identity, politics |
                            ?artist__atelier_olschinsky abstract, cityscapes, digital, geometric, minimalism, modern |
                            ?artist__greg_olsen contemporary, outer-space, painting, spirituality, Wildlife |
                            ?artist__oleg_oprisco american, contemporary, flowers, impressionism, photography, photography-color, portraits |
                            ?artist__tony_orrico contemporary, installation, minimalism, sculpture |
                            ?artist__mamoru_oshii Animation, contemporary, manga-anime, Metaphysics, Science-fiction |
                            ?artist__ida_rentoul_outhwaite art-nouveau, dream-like, fantasy, femininity, folklore, kids-book, nature, watercolor, whimsical |
      ?artist__yigal_ozeri contemporary, Observational, painting, Realism, Slice-of-life |
      ?artist__gabriel_pacheco contemporary, dark, figurative, painting, surreal |
      ?artist__michael_page colorful, contemporary, expressionism, playful, pop-art, vibrant, whimsical |
      ?artist__rui_palha conceptual, contemporary, installation, monochromatic, photography, photography-bw |
      ?artist__polixeni_papapetrou contemporary, photography, photography-color, portraits, surreal |
      ?artist__julio_le_parc abstract, colorful, graphic-design, playful, pop-art, vibrant |
      ?artist__michael_parkes dream-like, ethereal, fantasy, magic-realism, spirituality |
      ?artist__philippe_parreno conceptual, contemporary, film, installation, multimedia, post-modern |
      ?artist__maxfield_parrish Art-Nouveau, Fantasy, Nostalgia, painting |
      ?artist__alice_pasquini contemporary, Documentary, Mural-painting, Public-Art, Social-realism, Street-art |
      ?artist__james_mcintosh_patrick contemporary, mixed-media, painting |
      ?artist__john_pawson abstract, architecture, British, contemporary, minimalism |
      ?artist__max_pechstein colorful, expressionism, modern, vibrant |
      ?artist__agnes_lawrence_pelton abstract, color-field, contemporary, ethereal, modern, serenity, spirituality |
      ?artist__irving_penn characters, contemporary, expressionism, monochromatic, photography, photography-bw, portraits |
      ?artist__bruce_pennington colorful, fantasy, futuristic, landscapes, outer-space, science-fiction |
      ?artist__john_perceval abstract, expressionism, messy |
      ?artist__george_perez contemporary, mixed-media, street-art |
      ?artist__constant_permeke expressionism, Expressionism, painting, Sculpture, Symbolist |
      ?artist__lilla_cabot_perry American, gardens, impressionism, interiors |
      ?artist__gaetano_pesce architecture, contemporary, organic, vibrant |
      ?artist__cleon_peterson characters, contemporary, flat-colors, geometric, graphic-design, social-commentary |
      ?artist__daria_petrilli american, contemporary, impressionism, low-contrast, portraits, whimsical |
      ?artist__raymond_pettibon comics, contemporary, drawing, high-contrast |
      ?artist__coles_phillips advertising, art-deco, fashion, femininity, illustration, nostalgia |
      ?artist__francis_picabia avant-garde, Dadaism, French, painting, surreal |
      ?artist__pablo_picasso collage, cubism, impressionism, modern, sculpture, Spanish, surreal |
      ?artist__sopheap_pich contemporary, installation, sculpture |
      ?artist__otto_piene contemporary, installation, kinetic |
      ?artist__jerry_pinkney characters, fantasy, illustration, kids-book |
      ?artist__pinturicchio Allegory, painting, Religion, Renaissance |
      ?artist__sebastiano_del_piombo expressionism, landscapes, portraits, renaissance, sculpture |
      ?artist__camille_pissarro impressionism, Impressionism, Observational, painting, Printmaking |
      ?artist__ferris_plock contemporary, illustration, whimsical |
      ?artist__bill_plympton animation, cartoon, sketching, whimsical |
      ?artist__willy_pogany American, fantasy, Hungarian, illustration, kids-book, ornate, whimsical |
      ?artist__patricia_polacco animals, colorful, family, illustration, kids-book, nostalgia |
      ?artist__jackson_pollock abstract, action-painting, American, drip-painting, expressionism, messy |
      ?artist__beatrix_potter animals, book-illustration, British, kids-book, nature, watercolor, whimsical |
      ?artist__edward_henry_potthast impressionism, landscapes, painting |
      ?artist__simon_prades conceptual, contemporary, digital, dream-like, magic-realism, pop-art, surreal |
      ?artist__maurice_prendergast impressionism, Impressionism, Observational, painting |
      ?artist__dod_procter expressionism, impressionism, landscapes, portraits |
      ?artist__leo_putz art-Nouveau, expressionism, impressionism, mixed-media |
      ?artist__howard_pyle adventure, American, history, illustration, kids-book, posters |
      ?artist__arthur_rackham British, creatures, fantasy, illustration, kids-book, magic |
      ?artist__natalia_rak childhood, colorful, contemporary, expressionism, portraits, street-art, whimsical |
      ?artist__paul_ranson abstract, art-nouveau, dream-like, nature, vibrant, whimsical |
      ?artist__raphael painting, Renaissance |
      ?artist__abraham_rattner expressionism, Expressionism, painting, Sculpture, Symbolist |
      ?artist__jan_van_ravesteyn Architecture, Baroque, Observational, Plein-air, Sculpture |
      ?artist__aliza_razell conceptual, dream-like, eerie, ethereal, fantasy, photography, photography-color, surreal |
      ?artist__paula_rego contemporary, expressionism, impressionism, landscapes, portraits |
      ?artist__lotte_reiniger animation, folklore, German, nostalgia, puppets, silhouettes |
      ?artist__valentin_rekunenko dream-like, fantasy, surreal, whimsical |
      ?artist__christoffer_relander american, contemporary, impressionism, monochromatic, nature, photography, photography-bw, portraits |
      ?artist__andrey_remnev baroque, characters, contemporary, expressionism, portraits, renaissance |
      ?artist__pierre_auguste_renoir female-figures, femininity, French, impressionism, landscapes, outdoor-scenes, pastel, plein-air, portraits |
      ?artist__ilya_repin expressionism, impressionism, landscapes, portraits |
      ?artist__joshua_reynolds expressionism, landscapes, portraits, romanticism |
      ?artist__rhads digital, landscapes, magic-realism, mixed-media, surreal, vibrant |
      ?artist__bettina_rheims celebrity, contemporary, fashion, identity, photography, photography-bw, portraits |
      ?artist__jason_rhoades conceptual, contemporary, installation, sculpture |
      ?artist__georges_ribemont_dessaignes avant-garde, Dadaism, French |
      ?artist__jusepe_de_ribera baroque, dark, expressionism, portraits |
      ?artist__gerhard_richter abstract, blurry, contemporary, German, multimedia, oil-painting, photorealism |
      ?artist__chris_riddell cartoon, creatures, fantasy, illustration, kids-book, watercolor, whimsical |
      ?artist__hyacinthe_rigaud baroque, expressionism, landscapes, portraits |
      ?artist__rembrandt_van_rijn baroque, Dutch, etching, history, portraits, religion, self-portraits |
      ?artist__faith_ringgold activism, African-American, contemporary, expressionism, feminism, pop-art, quilting |
      ?artist__jozsef_rippl_ronai hungarian, landscapes, post-impressionism, realism |
      ?artist__pipilotti_rist colorful, dream-like, female-figures, immersive, installation, playful, Swiss, vibrant, video-art |
      ?artist__charles_robinson painting, politics, Realism, Satire |
      ?artist__theodore_robinson contemporary, mixed-media |
      ?artist__kenneth_rocafort comics, contemporary, Fantasy, Graphic-novel, illustration, Illustration, Science-fiction, superheroes |
      ?artist__andreas_rocha atmospheric, dark, digital, fantasy, landscapes |
      ?artist__norman_rockwell American, illustration, nostalgia, painting, pop-culture, realism, slice-of-life |
      ?artist__ludwig_mies_van_der_rohe architecture, modern |
      ?artist__fatima_ronquillo contemporary, expressionism, landscapes, portraits, whimsical |
      ?artist__salvator_rosa baroque, painting, renaissance, sculpture |
      ?artist__kerby_rosanes contemporary, illustration, whimsical |
      ?artist__conrad_roset contemporary, expressionism, impressionism, pastel-colors, portraits, watercolor |
      ?artist__bob_ross Commercial-art, Consumerism, contemporary, landscapes, painting |
      ?artist__dante_gabriel_rossetti contemporary, expressionism, landscapes, portraits, romanticism |
      ?artist__jessica_rossier conceptual, dark, digital, landscapes, outer-space, spirituality, surreal, whimsical |
      ?artist__marianna_rothen conceptual, contemporary, femininity, identity, muted-colors, photography, photography-color |
      ?artist__mark_rothko abstract, American, color-field, expressionism, large-scale, minimalism, spirituality |
      ?artist__eva_rothschild contemporary, Irish, sculpture |
      ?artist__georges_rousse Femininity, Impressionism, Mysticism, Neo-Impressionism, painting, Post-Impressionism |
      ?artist__luis_royo contemporary, fantasy, landscapes, messy, portraits |
      ?artist__joao_ruas characters, comics, dark, fantasy, gothic, horror, noir |
      ?artist__peter_paul_rubens baroque, Flemish, history, mythology, nudes, oil-painting, painting, renaissance, romanticism |
      ?artist__rachel_ruysch baroque, painting, still-life |
      ?artist__albert_pinkham_ryder dream-like, impressionism, painting, seascapes |
      ?artist__mark_ryden big-eyes, childhood, contemporary, creatures, dark, dream-like, illustration, surreal |
      ?artist__ursula_von_rydingsvard abstract, Metamorphosis, Minimalism, Sculpture |
      ?artist__theo_van_rysselberghe expressionism, impressionism, landscapes, portraits |
      ?artist__eero_saarinen Architecture, metaphysics, modern, Modern |
      ?artist__wlad_safronow angular, colorful, contemporary, expressionism, portraits |
      ?artist__amanda_sage contemporary, expressionism, playful, psychedelic, surreal, whimsical |
      ?artist__antoine_de_saint_exupery adventure, French, illustration, kids-book, spirituality, whimsical |
      ?artist__nicola_samori contemporary, dark, expressionism, landscapes, portraits |
      ?artist__rebeca_saray conceptual, contemporary, digital, fashion, femininity, identity, photography, photography-color, portraits |
      ?artist__john_singer_sargent expressionism, impressionism, landscapes, portraits |
      ?artist__martiros_saryan colorful, impressionism, landscapes, nature, serenity, vibrant, wildlife |
      ?artist__viviane_sassen conceptual, contemporary, geometric, photography, photography-color, surreal, vibrant |
      ?artist__nike_savvas abstract, contemporary, large-scale, painting |
      ?artist__richard_scarry animals, anthropomorphism, colorful, contemporary, illustration, kids-book, playful, whimsical |
      ?artist__godfried_schalcken American, contemporary, Dutch, muscles, portraits |
      ?artist__miriam_schapiro abstract, contemporary, expressionism, feminism, politics, vibrant |
      ?artist__kenny_scharf colorful, playful, pop-art, psychedelic, surreal, vibrant, whimsical |
      ?artist__jerry_schatzberg characters, monochromatic, noir, nostalgia, photography, photography-bw, portraits, urban-life |
      ?artist__ary_scheffer dutch, mythology, neo-classicism, portraits, religion, romanticism |
      ?artist__kees_scherer color-field, contemporary, impressionism, landscapes |
      ?artist__helene_schjerfbeck expressionism, finnish, identity, portraits, self-portraits |
      ?artist__christian_schloe dream-like, fantasy, mysterious, portraits, romanticism, surreal |
      ?artist__karl_schmidt_rottluff abstract, colorful, expressionism, figurativism, german, japanese, landscapes, vibrant, woodblock |
      ?artist__julian_schnabel figurative, messy, neo-expressionism, painting |
      ?artist__fritz_scholder color-field, expressionism, identity, native-american, portraits, spirituality |
      ?artist__charles_schulz American, cartoon, characters, childhood, comics, nostalgia, social-commentary |
      ?artist__sean_scully abstract, angular, grids, minimalism |
      ?artist__ronald_searle cartoon, comics, illustration, whimsical |
      ?artist__mark_seliger American, Anxiety, celebrity, contemporary, monochromatic, Photography, photography-bw, Portraits |
      ?artist__anton_semenov contemporary, dark, digital, horror, illustration, painting, shock-art, surreal |
      ?artist__edmondo_senatore atmospheric, monochromatic, photography, photography-bw, portraits |
      ?artist__maurice_sendak American, fantasy, illustration, kids-book, whimsical, wilderness |
      ?artist__richard_serra contemporary, installation, large-scale, minimalism, sculpture |
      ?artist__georges_seurat color-field, impressionism, landscapes, nature, painting, pointillism |
      ?artist__dr_seuss cartoon, characters, colorful, kids-book, playful, whimsical |
      ?artist__tanya_shatseva contemporary, eerie, painting, Russian, surreal |
      ?artist__natalie_shau characters, digital, dream-like, fantasy, femininity, mixed-media, pastel-colors, photorealism, surreal, whimsical |
      ?artist__barclay_shaw angular, cyberpunk, dark, futuristic, industrial, science-fiction |
      ?artist__e_h_shepard animals, drawing, illustration, kids-book, nature, nostalgia, watercolor, whimsical |
      ?artist__amrita_sher_gil female-figures, folklore, Indian, modern, painting, portraits, social-commentary |
      ?artist__irene_sheri femininity, flowers, impressionism, nature, pastel, portraits, romanticism, serenity |
      ?artist__duffy_sheridan interiors, photorealism, pop-culture, portraits |
      ?artist__cindy_sherman conceptual, contemporary, feminism, identity, photography, photography-color, portraits, post-modern, self-portraits |
      ?artist__shozo_shimamoto abstract, action-painting, collaborative, gutai, Japanese, messy, mixed-media, performance, post-war |
      ?artist__hikari_shimoda big-eyes, childhood, colorful, digital, fantasy, japanese, manga-anime, portraits, vibrant |
      ?artist__makoto_shinkai contemporary, Film, Fleeting-moments, manga-anime, Slice-of-life |
      ?artist__chiharu_shiota conceptual, environmentalism, immersive, installation, low-contrast, messy, vibrant |
      ?artist__elizabeth_shippen_green American, dream-like, fairies, illustration, kids-book |
      ?artist__masamune_shirow cartoon, characters, comics, fantasy, manga-anime, robots-cyborgs, science-fiction |
      ?artist__tim_shumate animals, big-eyes, cartoon, childhood, dreams, portraits, whimsical |
      ?artist__yuri_shwedoff contemporary, Fantasy, Illustration, Surreal |
      ?artist__malick_sidibe African-American, Documentary, Harlem-Renaissance, monochromatic, Photography, photography-bw, Slice-of-life |
      ?artist__jeanloup_sieff erotica, fashion, landscapes, monochromatic, nudes, photography, photography-bw, portraits |
      ?artist__bill_sienkiewicz comics, dark, expressionism, figurativism, grungy, messy, pop-art, superheroes, watercolor |
      ?artist__marc_simonetti dark, digital, dream-like, fantasy, landscapes, surreal |
      ?artist__david_sims British, contemporary, fashion, photography, photography-bw, photography-color |
      ?artist__andy_singer American, celebrity, consumerism, pop-art |
      ?artist__alfred_sisley french, impressionism, landscapes, nature, plein-air, portraits |
      ?artist__sandy_skoglund conceptual, contemporary, installation, still-life, surreal, vibrant, whimsical |
      ?artist__jeffrey_smart dream-like, Scottish, surreal |
      ?artist__berndnaut_smilde cloudscapes, Dutch, installation, Metamorphosis, Photography, photography-color, Surreal |
      ?artist__rodney_smith fashion, monochromatic, photography, photography-bw, portraits |
      ?artist__samantha_keely_smith abstract, abstract-Expressionism, contemporary, Dream-like, Loneliness, painting |
      ?artist__robert_smithson conceptual, earthworks, environmentalism, land-art, post-minimalism, sculpture |
      ?artist__barbara_stauffacher_solomon Commercial-art, contemporary, Graphic-Design, Graphic-design, Pop-art |
      ?artist__simeon_solomon Jewish, LGBTQ, Metaphysics, painting, pre-raphaelite, Symbolist |
      ?artist__hajime_sorayama characters, erotica, futuristic, robots-cyborgs, science-fiction, technology |
      ?artist__joaquin_sorolla beach-scenes, impressionism, landscapes, portraits, seascapes, spanish |
      ?artist__ettore_sottsass architecture, art-deco, colorful, furniture, playful, sculpture |
      ?artist__amadeo_de_souza_cardoso cubism, futurism, modern, painting, Portuguese |
      ?artist__millicent_sowerby botanical, British, flowers, illustration, kids-book, nature |
      ?artist__moses_soyer figurative, painting, portraits, realism |
      ?artist__sparth digital, fantasy, futuristic, landscapes, minimalism, science-fiction, surreal |
      ?artist__jack_spencer contemporary, muted-colors, photography, photography-color |
      ?artist__art_spiegelman American, animals, autobiographical, cartoon, comics, graphic-novel, history, Holocaust |
      ?artist__simon_stalenhag digital, eerie, futurism, landscapes, nostalgia, rural-life, science-fiction, suburbia |
      ?artist__ralph_steadman cartoon, dark, grungy, illustration, messy, satire, surreal, whimsical |
      ?artist__philip_wilson_steer atmospheric, british, impressionism, landscapes, portraits, seascapes |
      ?artist__william_steig colorful, illustration, kids-book, playful, watercolor |
      ?artist__fred_stein contemporary, impressionism, landscapes, realism |
      ?artist__theophile_steinlen Allegory, Art-Nouveau, Observational, Printmaking |
      ?artist__brian_stelfreeze Activism, comics, contemporary, digital, Illustration, Social-realism |
      ?artist__frank_stella abstract, angular, colorful, cubism, expressionism, geometric, modern, vibrant |
      ?artist__joseph_stella angular, colorful, cubism, expressionism, geometric, minimalism, modern |
      ?artist__irma_stern expressionism, figurativism, portraits |
      ?artist__alfred_stevens fashion, femininity, impressionism, luxury, portraits |
      ?artist__marie_spartali_stillman femininity, medieval, mythology, portraits, pre-raphaelite, romanticism, vibrant |
      ?artist__stinkfish Colombian, colorful, graffiti, portraits, street-art, surreal, urban-life, vibrant |
      ?artist__anne_stokes characters, dark, eerie, fantasy, gothic, mysterious, whimsical |
      ?artist__william_stout dark, fantasy, gothic, mythology |
      ?artist__paul_strand American, landscapes, minimalism, monochromatic, photography, photography-bw, portraits, still-life, urban-life |
      ?artist__linnea_strid childhood, femininity, nostalgia, photography, photography-color, portraits |
      ?artist__john_melhuish_strudwick mythology, pre-raphaelite, romanticism, victorian |
      ?artist__drew_struzan fantasy, nostalgia, portraits, posters, science-fiction |
      ?artist__tatiana_suarez collage, colorful, pop-art, pop-culture, portraits |
      ?artist__eustache_le_sueur Baroque, Fleeting-moments, impressionism, painting, portraits |
      ?artist__rebecca_sugar contemporary, feminism, installation, mixed-media |
      ?artist__hiroshi_sugimoto architecture, conceptual, geometric, Japanese, long-exposure, monochromatic, photography, photography-bw, seascapes |
      ?artist__graham_sutherland battle-scenes, British, distortion, eerie, expressionism, landscapes, messy, portraits |
      ?artist__jan_svankmajer animation, dark, horror, puppets, sculpture, surreal |
      ?artist__raymond_swanland atmospheric, dark, digital, eerie, fantasy |
      ?artist__annie_swynnerton femininity, feminism, mythology, portraits, spirituality |
      ?artist__stanislaw_szukalski Metaphysics, Mysticism, primitivism, Sculpture, surreal |
      ?artist__philip_taaffe abstract, contemporary, painting, Symbolist |
      ?artist__hiroyuki_mitsume_takahashi childhood, colorful, comics, contemporary, japanese, manga-anime, portraits, social-commentary |
      ?artist__dorothea_tanning dream-like, eerie, figure-studies, metamorphosis, surreal |
      ?artist__margaret_tarrant British, colorful, dream-like, folklore, illustration, kids-book, whimsical |
      ?artist__genndy_tartakovsky animation, cartoon, characters, contemporary, playful, whimsical |
      ?artist__teamlab colorful, digital, immersive, installation, interactive, light-art, technology, vibrant |
      ?artist__raina_telgemeier autobiographical, comics, contemporary, graphic-novel, Graphic-novel, Slice-of-life |
      ?artist__john_tenniel drawing, fantasy, kids-book, whimsical |
      ?artist__sir_john_tenniel British, fantasy, illustration, kids-book, Victorian, whimsical |
      ?artist__howard_terpning contemporary, landscapes, realism |
      ?artist__osamu_tezuka animation, cartoon, characters, Japanese, manga-anime, robots-cyborgs, science-fiction |
      ?artist__abbott_handerson_thayer american, atmospheric, landscapes, portraits, romanticism, serenity, tonalism |
      ?artist__heather_theurer baroque, dream-like, erotica, ethereal, fantasy, mythology, renaissance, romanticism |
      ?artist__mickalene_thomas African-American, Collage, contemporary, Femininity, identity, painting, Portraits |
      ?artist__tom_thomson art-nouveau, Canadian, expressionism, impressionism, landscapes, nature, wilderness |
      ?artist__titian dark, Italian, mythology, oil-painting, painting, portraits, religion, renaissance |
      ?artist__mark_tobey abstract, modern, painting, spirituality |
      ?artist__greg_tocchini contemporary, expressionism, sculpture |
      ?artist__roland_topor animation, dark, eerie, horror, satire, surreal |
      ?artist__sergio_toppi fantasy, illustration, whimsical |
      ?artist__alex_toth animals, bronze, cartoon, comics, figurative, wildlife |
      ?artist__henri_de_toulouse_lautrec art-nouveau, cabaret, French, impressionism, lithography, nightlife, portraits, posters |
      ?artist__ross_tran conceptual, digital, femininity, figurativism, manga-anime, minimalism, pastel-colors, portraits, realism |
      ?artist__philip_treacy avant-garde, fashion, hats, luxury, opulent, photography, photography-color, portraits |
      ?artist__anne_truitt Conceptual, minimalism, Minimalism, Sculpture |
      ?artist__henry_scott_tuke figure-studies, impressionism, landscapes, realism |
      ?artist__jmw_turner atmospheric, British, landscapes, painting, romanticism, seascapes |
      ?artist__james_turrell architecture, colorful, contemporary, geometric, installation, light-art, minimalism, sculpture, vibrant |
      ?artist__john_henry_twachtman American, impressionism, landscapes, nature, pastel-colors |
      ?artist__naomi_tydeman contemporary, impressionism, landscapes, watercolor |
      ?artist__euan_uglow british, figurativism, interiors, portraits, still-life |
      ?artist__daniela_uhlig characters, contemporary, digital, dream-like, ethereal, German, landscapes, portraits, surreal |
      ?artist__kitagawa_utamaro Edo-period, fashion, female-figures, genre-scenes, Japanese, nature, portraits, ukiyo-e, woodblock |
      ?artist__christophe_vacher cloudscapes, dream-like, ethereal, fantasy, landscapes, magic-realism |
      ?artist__suzanne_valadon mysterious, nudes, post-impressionism |
      ?artist__thiago_valdi Brazilian, colorful, contemporary, street-art, urban-life |
      ?artist__chris_van_allsburg adventure, American, illustration, kids-book, mysterious, psychedelic |
      ?artist__francine_van_hove drawing, expressionism, female-figures, nudes, portraits, slice-of-life |
      ?artist__jan_van_kessel_the_elder Allegory, Baroque, Nature, Observational, painting, Still-Life |
      ?artist__remedios_varo low-contrast, magic-realism, Spanish, surreal |
      ?artist__nick_veasey contemporary, monochromatic, photography, photography-bw, urban-life |
      ?artist__diego_velazquez baroque, history, oil-painting, portraits, realism, religion, royalty, Spanish |
      ?artist__eve_ventrue characters, costumes, dark, digital, fantasy, femininity, gothic, illustration |
      ?artist__johannes_vermeer baroque, domestic-scenes, Dutch, genre-scenes, illusion, interiors, portraits |
      ?artist__charles_vess comics, dream-like, fantasy, magic, mythology, romanticism, watercolor, whimsical |
      ?artist__roman_vishniac documentary, jewish, photography, photography-bw |
      ?artist__kelly_vivanco big-eyes, consumerism, contemporary, femininity, sculpture |
      ?artist__brian_m_viveros contemporary, digital, dream-like, fantasy, femininity, gothic, portraits, surreal |
      ?artist__elke_vogelsang animals, contemporary, painting |
      ?artist__vladimir_volegov femininity, impressionism, landscapes, portraits, romanticism, russian |
      ?artist__robert_vonnoh American, bronze, impressionism, sculpture |
      ?artist__mikhail_vrubel painting, Religion, Sculpture, Symbolist |
      ?artist__louis_wain animals, colorful, creatures, fantasy, kids-book, playful, psychedelic, whimsical |
      ?artist__kara_walker African-American, contemporary, identity, silhouettes |
      ?artist__josephine_wall colorful, digital, femininity, pop-art, portraits, psychedelic, whimsical |
      ?artist__bruno_walpoth figurative, photorealism, sculpture |
      ?artist__chris_ware American, cartoon, characters, comics, graphic-novel, modern-life, slice-of-life |
      ?artist__andy_warhol celebrity, contemporary, pop-art, portraits, vibrant |
      ?artist__john_william_waterhouse fantasy, femininity, mythology, portraits, pre-raphaelite, romanticism |
      ?artist__bill_watterson American, characters, childhood, friendship, loneliness, melancholy, nostalgia |
      ?artist__george_frederic_watts mysticism, portraits, spirituality |
      ?artist__walter_ernest_webster expressionism, painting, portraits |
      ?artist__hendrik_weissenbruch landscapes, Observational, painting, Plein-air |
      ?artist__neil_welliver contemporary, environmentalism, landscapes, realism |
      ?artist__catrin_welz_stein digital, fantasy, magic, portraits, surreal, whimsical |
      ?artist__vivienne_westwood contemporary, fashion, feminism, messy |
      ?artist__michael_whelan alien-worlds, dream-like, eerie, fantasy, outer-space, science-fiction, surreal |
      ?artist__james_abbott_mcneill_whistler American, drawing, etching, interiors, low-contrast, portraits, tonalism, whimsical |
      ?artist__william_whitaker contemporary, Documentary, landscapes, painting, Social-realism |
      ?artist__tim_white atmospheric, fantasy, immersive, landscapes, science-fiction |
      ?artist__coby_whitmore childhood, figure-studies, nostalgia, portraits |
      ?artist__david_wiesner cartoon, kids-book, playful, whimsical |
      ?artist__kehinde_wiley African-American, baroque, colorful, contemporary, identity, photorealism, portraits, vibrant |
      ?artist__cathy_wilkes Activism, contemporary, Photography, photography-color, Social-commentary, surreal |
      ?artist__jessie_willcox_smith American, childhood, folklore, illustration, kids-book, nostalgia, whimsical |
      ?artist__gilbert_williams fantasy, landscapes, magic, nostalgia, whimsical |
      ?artist__kyffin_williams contemporary, landscapes, painting |
      ?artist__al_williamson adventure, comics, fantasy, mythology, science-fiction |
      ?artist__wes_wilson contemporary, psychedelic |
      ?artist__mike_winkelmann color-field, conceptual, contemporary, digital, geometric, minimalism |
      ?artist__bec_winnel ethereal, femininity, flowers, pastel, portraits, romanticism, serenity |
      ?artist__franz_xaver_winterhalter fashion, luxury, portraits, romanticism, royalty |
      ?artist__nathan_wirth atmospheric, contemporary, landscapes, monochromatic, nature, photography, photography-bw |
      ?artist__wlop characters, digital, fantasy, femininity, manga-anime, portraits |
      ?artist__brandon_woelfel cityscapes, neon, nightlife, photography, photography-color, shallow-depth-of-field, urban-life |
      ?artist__liam_wong colorful, dystopia, futuristic, photography, photography-color, science-fiction, urban-life, vibrant |
      ?artist__francesca_woodman American, contemporary, female-figures, feminism, monochromatic, nudes, photography, photography-bw, self-portraits |
      ?artist__jim_woodring aliens, American, characters, comics, creatures, dream-like, fantasy, pen-and-ink, psychedelic, surreal |
      ?artist__patrick_woodroffe dream-like, eerie, illusion, science-fiction, surreal |
      ?artist__frank_lloyd_wright angular, architecture, art-deco, environmentalism, furniture, nature, organic |
      ?artist__sulamith_wulfing dream-like, ethereal, fantasy, German, illustration, kids-book, spirituality, whimsical |
      ?artist__nc_wyeth American, illustration, kids-book, nature, nostalgia, realism, rural-life |
      ?artist__rose_wylie contemporary, figurative, observational, painting, portraits |
      ?artist__stanislaw_wyspianski painting, polish, romanticism |
      ?artist__takato_yamamoto dreams, fantasy, mysterious, portraits |
      ?artist__gene_luen_yang contemporary, graphic-novel, illustration, manga-anime |
      ?artist__ikenaga_yasunari contemporary, femininity, japanese, portraits |
      ?artist__kozo_yokai colorful, folklore, illustration, Japanese, kids-book, magic, monsters, playful |
      ?artist__sean_yoro activism, identity, portraits, public-art, social-commentary, street-art, urban-life |
      ?artist__chie_yoshii characters, childhood, colorful, illustration, manga-anime, pop-culture, portraits, whimsical |
                                                      ?artist__skottie_young cartoon, comics, contemporary, illustration, playful, whimsical |
                                                      ?artist__masaaki_yuasa animation, colorful, eerie, fantasy, Japanese, surreal |
                                                      ?artist__konstantin_yuon color-field, impressionism, landscapes |
                                                      ?artist__yuumei characters, digital, dream-like, environmentalism, fantasy, femininity, manga-anime, whimsical |
                                                      ?artist__william_zorach cubism, expressionism, folk-art, modern, sculpture |
                                                      ?artist__ander_zorn etching, nudes, painting, portraits, Swedish
                                                     }
                                `;
// ---------------------------------------------------------------------------------------
let prelude_parse_result = null;
// ---------------------------------------------------------------------------------------
function load_prelude(into_context = new Context()) {
  if (! prelude_parse_result) {
    const old_log_match_enabled = log_match_enabled;
    log_match_enabled = false; 
    prelude_parse_result = Prompt.match(prelude_text);
    log_match_enabled = old_log_match_enabled;
  }
  
  const ignored = expand_wildcards(prelude_parse_result.value, into_context);

  return into_context;
}
// ---------------------------------------------------------------------------------------


// =======================================================================================
// the AST-walking function that I'll be using for the SD prompt grammar's output:
// =======================================================================================
function expand_wildcards(thing, context = new Context()) {
  function walk(thing, context) {
    // -----------------------------------------------------------------------------------
    // basic types (strings and Arrays):
    // -----------------------------------------------------------------------------------
    if (typeof thing === 'string')
      return thing
    else if (Array.isArray(thing)) {
      // return thing.map(x => walk(x, context));
      
      const ret = [];

      for (const t of thing) {
        if (context.noisy)
          console.log(`WALKING ` +
                      typeof t === 'object'
                      ? inspect_fun(t)
                      : `${typeof t} '${t}'`);
        
        const val = walk(t, context);

        ret.push(val);
      }

      return ret;
    }
    // -----------------------------------------------------------------------------------
    // Flags:
    // -----------------------------------------------------------------------------------
    else if (thing instanceof ASTSetFlag) {
      // console.log(`SET FLAG '${thing.name}'.`);
      
      context.flags.add(thing.name);

      return ''; // produce nothing
    }
    // -----------------------------------------------------------------------------------
    // References:
    // -----------------------------------------------------------------------------------
    else if (thing instanceof ASTNamedWildcardReference) {
      const got = context.named_wildcards.get(thing.name);

      if (!got)
        return `\\<ERROR: NAMED WILDCARD '${thing.name}' NOT FOUND!>`;

      const res = [ walk(got, context) ];

      if (thing.capitalize)
        res[0] = capitalize(res[0]);

      const count = rand_int(thing.min_count, thing.max_count);
      
      for (let ix = 1; ix < count; ix++) {
        let val = walk(got, context);
        
        for (let iix = 0; iix < (Math.max(5, got.options.length * 2)); iix++) {
          if (! res.includes(val))
            break;

          val = walk(got, context);
        }

        res.push(val);
      }

      return thing.joiner == ','
        ? res.join(", ")
        : (thing.joiner == '&'
           ? pretty_list(res)
           : res.join(" "));
    }
    // -----------------------------------------------------------------------------------
    else if (thing instanceof ASTScalarReference) {
      let got = context.scalar_variables.get(thing.name) ??
          `SCALAR '${thing.name}' NOT FOUND}`;

      if (thing.capitalize)
        got = capitalize(got);

      return got;
    }
    // -----------------------------------------------------------------------------------
    // NamedWildcards:
    // -----------------------------------------------------------------------------------
    else if (thing instanceof ASTLatchNamedWildcard) {
      const got = context.named_wildcards.get(thing.name);
      
      if (!got)
        return `ERROR: Named wildcard ${thing.name} not found!`;

      if (got instanceof ASTLatchedNamedWildcardedValue) {
        if (context.noisy)
          console.log(`FLAG ${thing.name} ALREADY LATCHED...`);

        return '';
      }

      const latched = new ASTLatchedNamedWildcardedValue(walk(got, context), got);

      if (context.noisy)
        console.log(`LATCHED ${thing.name} TO ${inspect_fun(latched.latched_value)}`);
      
      context.named_wildcards.set(thing.name, latched);

      return '';
    }
    // -----------------------------------------------------------------------------------
    else if (thing instanceof ASTUnlatchNamedWildcard) {
      let got = context.named_wildcards.get(thing.name);

      if (!got)
        return `ERROR: Named wildcard ${thing.name} not found!`;

      if (! (got instanceof ASTLatchedNamedWildcardedValue))
        throw new Error(`NOT LATCHED: '${thing.name}'`);

      context.named_wildcards.set(thing.name, got.original_value);

      if (context.noisy)
        console.log(`UNLATCHED ${thing.name} TO ${inspect_fun(got.original_value)}`);

      return ''; // produce no text.
    } 
    // -----------------------------------------------------------------------------------
    else if (thing instanceof ASTNamedWildcardDefinition) {
      if (context.named_wildcards.has(thing.destination))
        console.log(`WARNING: redefining named wildcard '${thing.destination.name}'.`);
      // else
      //   console.log(`SETTING ${inspect_fun(thing)} IN ${inspect_fun(context.named_wildcards)}` );

      context.named_wildcards.set(thing.destination, thing.wildcard);

      return '';
    }
    // -----------------------------------------------------------------------------------
    // internal objects:
    // -----------------------------------------------------------------------------------
    else if (thing instanceof ASTLatchedNamedWildcardedValue) {
      return thing.latched_value;
    }
    // -----------------------------------------------------------------------------------
    // scalar assignment:
    // -----------------------------------------------------------------------------------
    else if (thing instanceof ASTScalarAssignment) {
      if (context.noisy) {
        console.log();
        console.log(`ASSIGNING ${inspect_fun(thing.source)} ` +
                    `TO '${thing.destination.name}'`);
      }

      const val = walk(thing.source, context);

      if (context.noisy)
        console.log(`ASSIGNED ${inspect_fun(val)} TO "${thing.destination.name}'`);
      
      context.scalar_variables.set(thing.destination.name, val);

      if (context.noisy)
        console.log(`VARS AFTER: ${inspect_fun(context.scalar_variables)}`);
      
      return '';
    }
    // -----------------------------------------------------------------------------------
    // AnonWildcards:
    // -----------------------------------------------------------------------------------
    else if (thing instanceof ASTAnonWildcard) {
      const new_picker = new WildcardPicker();

      for (const option of thing.options) {
        let skip = false;

        // if (option.not_flags.length > 1)
        //   console.log(`alternative ${inspect_fun(option.body).replace(/\s+/, ' ')} is guarded against ${inspect_fun(option.not_flags.map(nf => nf.name).join(", "))}`);
        
        for (const not_flag of option.not_flags) {
          // console.log(`CHECKING FOR NOT ${inspect_fun(not_flag.name)} in ${inspect_fun(Array.from(context.flags))}...`);

          if (context.flags.has(not_flag.name)) {
            // console.log(`FOUND ${inspect_fun(not_flag.name)} in ${inspect_fun(Array.from(context.flags))}, forbid!`);
            skip = true;
            break;
          }
        }

        if (skip)
          continue;
        
        for (const check_flag of option.check_flags) {
          // if (context.noisy)
          //   console.log(`CHECKING FOR ${inspect_fun(check_flag.name)}...`);

          let found = false;
          
          for (const name of check_flag.names) {
            // console.log(`check for ${name} in ${inspect_fun(Array.from(context.flags))}: ${context.flags.has(name)} during ${inspect_fun(option.body)}`);
            
            if (context.flags.has(name)) {
              // console.log(`FOUND ${name} in ${inspect_fun(Array.from(context.flags))}, allow!`);
              found = true;
              break;
            }
          }

          if (!found) {
            skip = true;
            break;
          }
        }

        if (skip)
          continue;

        new_picker.add(option.weight, option.body);
      }

      if (new_picker.options.length == 0)
        return '';
      
      const pick = new_picker.pick();

      // console.log(`PICKED ${inspect_fun(pick)}`);
      
      return smart_join(walk(pick, context).flat(Infinity).filter(s => s !== ''));
      // return walk(pick, context);
    }
    // -----------------------------------------------------------------------------------
    // TLDs, not yet implemented:
    // -----------------------------------------------------------------------------------
    else if (thing instanceof ASTSpecialFunction) {
      console.log(`IGNORING ${inspect_fun(thing)}`);
    }
    // -----------------------------------------------------------------------------------
    // error case, unrecognized objects:
    // -----------------------------------------------------------------------------------
    else {
      throw new Error(`confusing thing: ` +
                      (typeof thing === 'object'
                       ? thing.constructor.name
                       : typeof thing) +
                      ' ' +
                      inspect_fun(thing));
    }
  }
  return smart_join(walk(thing, context).flat(Infinity).filter(s => s !== ''));
}
// ---------------------------------------------------------------------------------------


// =======================================================================================
// SD PROMPT AST CLASSES:
// ---------------------------------------------------------------------------------------
// Flags:
// ---------------------------------------------------------------------------------------
class ASTSetFlag {
  constructor(name) {
    this.name = name;
  }
}
// ----------------------------------------------------------------------------------------
class ASTCheckFlag {
  constructor(names) {
    this.names = names;
  }
}
// ---------------------------------------------------------------------------------------
class ASTNotFlag  {
  constructor(name, set_immediately) {
    this.name = name;
    this.set_immediately = set_immediately;
    // if (this.set_immediately)
    //   console.log(`SET IMMEDIATELY = '${inspect_fun(this.set_immediately)}'`);
  }
}
// ---------------------------------------------------------------------------------------
// References:
// ---------------------------------------------------------------------------------------
class ASTNamedWildcardReference {
  constructor(name, joiner, capitalize, min_count, max_count) {
    this.name       = name;
    this.min_count  = min_count;
    this.max_count  = max_count;
    this.joiner     = joiner;
    this.capitalize = capitalize;
    // console.log(`BUILT ${inspect_fun(this)}`);
  }
}
// ---------------------------------------------------------------------------------------
class ASTScalarReference {
  constructor(name, capitalize) {
    this.name       = name;
    this.capitalize = capitalize;
  }
}
// ---------------------------------------------------------------------------------------
// NamedWildcards:
// ---------------------------------------------------------------------------------------
class ASTLatchNamedWildcard {
  constructor(name) {
    this.name = name;
  }
}
// ---------------------------------------------------------------------------------------
class ASTUnlatchNamedWildcard {
  constructor(name) {
    this.name = name;
  }
}
// ---------------------------------------------------------------------------------------
class ASTNamedWildcardDefinition {
  constructor(destination, wildcard) {
    this.destination = destination;
    this.wildcard    = wildcard;
  }
}
// ---------------------------------------------------------------------------------------
// internal usage.. might not /really/ be part of the AST per se?
// ---------------------------------------------------------------------------------------
class ASTLatchedNamedWildcardedValue {
  constructor(latched_value, original_value) {
    this.latched_value  = latched_value;
    this.original_value = original_value;
  }
}
// ---------------------------------------------------------------------------------------
// scalar assignment:
// ---------------------------------------------------------------------------------------
class ASTScalarAssignment  {
  constructor(destination, source) {
    this.destination = destination;
    this.source = source;
  }
}
// ---------------------------------------------------------------------------------------
// Directives:
// ---------------------------------------------------------------------------------------
class ASTSpecialFunction {
  constructor(directive, args) {
    this.directive = directive;
    this.args = args;
  }
}
// ---------------------------------------------------------------------------------------
// AnonWildcards:
// ---------------------------------------------------------------------------------------
class ASTAnonWildcard {
  constructor(options) {
    this.options = options;
  }
}
// ---------------------------------------------------------------------------------------
class ASTAnonWildcardAlternative {
  constructor(weight, check_flags, not_flags, body) {
    this.weight = weight;
    this.check_flags = check_flags;
    this.not_flags = not_flags;
    this.body = body;
  }
}
// ---------------------------------------------------------------------------------------


// =======================================================================================
// SD PROMPT GRAMMAR:
// =======================================================================================
// helper funs used by xforms:
// ---------------------------------------------------------------------------------------
const make_ASTAnonWildcardAlternative = arr => {
  // console.log(`ARR: ${inspect_fun(arr)}`);
  const flags = ([ ...arr[0], ...arr[2] ]);
  const set_flags   = flags.filter(f => f instanceof ASTSetFlag);
  const check_flags = flags.filter(f => f instanceof ASTCheckFlag);
  const not_flags   = flags.filter(f => f instanceof ASTNotFlag);
  const set_immediately_not_flags = not_flags
        .filter(f => f.set_immediately)
        .map(f => new ASTSetFlag(f.name)) ;
  
  return new ASTAnonWildcardAlternative(
    arr[1][0],
    check_flags,
    not_flags,
    [
      ...set_immediately_not_flags,
      ...set_flags,
      ...arr[3]
    ]);
}
// ---------------------------------------------------------------------------------------
const make_ASTFlagCmd = (klass, ...rules) =>
      xform(ident => new klass(ident),
            second(seq(...rules, ident, /(?=\s|[{|}]|$)/)));
// ---------------------------------------------------------------------------------------
// terminals:
const plaintext               = /[^{|}\s]+/;
const low_pri_text            = /[\(\)\[\]\,\.\?\!\:\;]+/;
const wb_uint                 = xform(parseInt, /\b\d+(?=\s|[{|}]|$)/);
const ident                   = /[a-zA-Z_-][0-9a-zA-Z_-]*\b/;
const comment                 = discard(choice(c_block_comment, c_line_comment));
const assignment_operator     = xform(arr => {
  // console.log(`A_R RETURNING ${arr.toString()}`);
  return arr;
}, discard(seq(wst_star(comment), ':=', wst_star(comment))));
// ---------------------------------------------------------------------------------------
// flag-related non-terminals:
const SetFlag                 = make_ASTFlagCmd(ASTSetFlag,   '#');
// const CheckFlag               = make_ASTFlagCmd(ASTCheckFlag, '?');
const CheckFlag               = xform(ident => new ASTCheckFlag(ident),
                                      second(seq('?', plus(ident, ','), /(?=\s|[{|}]|$)/)))
const MalformedNotSetCombo    = unexpected('#!');
const NotFlag                 = xform((arr => {
  //console.log(`ARR: ${inspect_fun(arr)}`);
  return new ASTNotFlag(arr[2], arr[1][0]);
}),
                                      seq('!', optional('#'),
                                          ident, /(?=\s|[{|}]|$)/));
const TestFlag                = choice(CheckFlag, MalformedNotSetCombo, NotFlag);
// ---------------------------------------------------------------------------------------
const tld_fun = arr =>
      new ASTSpecialFunction(arr[0][1],
                             arr[1]
                             .map(s => unescape(s)));
// ---------------------------------------------------------------------------------------
// other non-terminals:
const SpecialFunctionName     = choice('include', 'fake'); // choice('include', 'models');
const SpecialFunction         = xform(tld_fun,
                                      c_funcall(seq('%', SpecialFunctionName), json));
const AnonWildcardAlternative      = xform(make_ASTAnonWildcardAlternative,
                                           seq(wst_star(choice(comment, TestFlag, SetFlag)),
                                               optional(wb_uint, 1),
                                               wst_star(choice(comment, TestFlag, SetFlag)),
                                               () => ContentStar));
const AnonWildcard                  = xform(arr => new ASTAnonWildcard(arr),
                                            brc_enc(wst_star(AnonWildcardAlternative, '|')));
const NamedWildcardReference        = xform(seq(discard('@'),
                                                optional('^'),                            // 0
                                                optional(xform(parseInt, /\d+/)),         // 1
                                                optional(xform(parseInt,
                                                               second(seq('-', /\d+/)))), // 2
                                                optional(/[,&]/),                         // 3
                                                ident),                                   // 4
                                            arr => {
                                              // console.log(`NWR ARR: ${inspect_fun(arr)}`);

                                              const ident  = arr[4];
                                              const min_ct = arr[1][0] ?? 1;
                                              const max_ct = arr[2][0] ?? min_ct;
                                              const join   = arr[3][0] ?? '';
                                              const caret  = arr[0][0];
                                              
                                              // console.log(inspect_fun([ident, min_ct, (typeof join), join, caret]));
                                              
                                              return new ASTNamedWildcardReference(ident,
                                                                                   join,
                                                                                   caret,
                                                                                   min_ct,
                                                                                   max_ct);
                                            });
const NamedWildcardDesignator = second(seq('@', ident));                                      
const NamedWildcardDefinition = xform(arr => {
  // console.log(`NWCD ARR: ${JSON.stringify(arr)}`);
  
  return new ASTNamedWildcardDefinition(...arr);
},
                                      wst_seq(NamedWildcardDesignator,
                                              assignment_operator,
                                              AnonWildcard));
const NamedWildcardUsage      = xform(seq('@', optional("!"), optional("#"), ident),
                                      arr => {
                                        const [ bang, hash, ident, objs ] =
                                              [ arr[1][0], arr[2][0], arr[3], []];
                                        
                                        if (!bang && !hash)
                                          return new ASTNamedWildcardReference(ident);

                                        if (bang) // goes before hash so that "@!#" works correctly.
                                          objs.push(new ASTUnlatchNamedWildcard(ident));

                                        if (hash)
                                          objs.push(new ASTLatchNamedWildcard(ident));

                                        return objs;
                                      });
const ScalarReference         = xform(seq(discard('$'), optional('^'), ident),
                                      arr => new ASTScalarReference(arr[1], arr[0][0]));
const ScalarAssignmentSource  = choice(ScalarReference, NamedWildcardReference,
                                       AnonWildcard);
const ScalarAssignment        = xform(arr => new ASTScalarAssignment(...arr),
                                      wst_seq(ScalarReference,
                                              assignment_operator,
                                              ScalarAssignmentSource));
const Content                 = choice(NamedWildcardReference, NamedWildcardUsage, SetFlag,
                                       AnonWildcard, comment, ScalarReference,
                                       low_pri_text, plaintext);
const ContentStar             = xform(wst_star(Content), arr => arr.flat(1));
// const PromptBody              = wst_star(choice(NamedWildcardDefinition,
//                                                 ScalarAssignment,
//                                                 Content));
const PromptBody              = wst_star(choice(SpecialFunction,
                                                NamedWildcardDefinition,
                                                ScalarAssignment,
                                                Content));
// const Prompt                  = (dt_hosted
//                                  ? PromptBody
//                                  : xform(arr => arr.flat(1),
//                                          wst_seq(
//                                            wst_star(SpecialFunction),
//                                            PromptBody)));
const Prompt                  = xform(arr => arr.flat(Infinity), PromptBody);
// ---------------------------------------------------------------------------------------
Prompt.finalize();
// =====================================================================================
// DEV NOTE: Copy into wildcards-plus.js starting through this line!
// =====================================================================================


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

  if (args.length == 0) 
    throw new Error(`Usage: ./wildcards-plus-tool.js [--post|--confirm] ` +
                    `(--stdin | <input-file>) [<count>]`);

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
  let result = null;
  
  if (from_stdin) {
    // Read all stdin into a string
    prompt_input = await new Promise((resolve, reject) => {
      let data = '';
      input.setEncoding('utf8');
      input.on('data', chunk => data += chunk);
      input.on('end', () => resolve(data));
      input.on('error', err => reject(err));
    });
    result = Prompt.match(prompt_input);
  } else if (args.length === 0) {
    throw new Error("Error: No input file provided.");
  }
  else {
    result = parse_file(args[0]);
  }

  // -------------------------------------------------------------------------------------
  // just for debugging, comment next line to see result:
  // -------------------------------------------------------------------------------------
  if (false)
  {
    console.log(`result: ${inspect_fun(result.value)}`);
    console.log(`result (JSON): ${JSON.stringify(result.value)}`);
  }
  
  // -------------------------------------------------------------------------------------
  // check that the parsed result is complete and expand:
  // -------------------------------------------------------------------------------------

  if (! result.is_finished)
    throw new Error("error parsing prompt!");

  const base_context = load_prelude(new Context({files: from_stdin ? [] : [args[0]]}));
  let   AST          = result.value;
  
  // do some new special walk over AST to handle 'include' SpecialFunctions,
  // updating files as we go and bodging result back onto (or replacing?) AST?

  AST = process_includes(AST, base_context);

  if (false) // comment to see AST after includes...
    console.log(`after process_includes: ${inspect_fun(AST)}`);
  
  // base_context.reset_temporaries(); // might not need to do this here after all?

  console.log('--------------------------------------------------------------------------------');
  console.log(`Expansion${count > 1 ? "s" : ''}:`);

  let posted_count    = 0;
  let prior_expansion = null;

  while (posted_count < count) {
    console.log('--------------------------------------------------------------------------------');
    // console.log(`posted_count = ${posted_count}`);

    const context  = base_context.clone();
    const expanded = expand_wildcards(AST, context);

    // expansion may have included files, copy the files list back to the base context.
    // ED: might not be needed here after all...
    // context_with_prelude.files = context.files;
    
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

        const question = `POST this prompt as #${posted_count+1} out of ${count} ` +
              `(enter /y.*/ for yes, positive integer for multiple images, or /p.*/ to ` +
              `POST the prior prompt)? `;
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

  // let json_str = `[false, null, {"foo": 123, "bar": 456}]`;
  // console.log(inspect_fun(json.match(json_str)));
  // console.log(JSON.stringify(json.match(json_str).value));
  // json_str = `"bar.txt"`;
  // console.log(inspect_fun(json.match(json_str)));
  // console.log(JSON.stringify(json.match(json_str).value));
}

// ---------------------------------------------------------------------------------------
main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
