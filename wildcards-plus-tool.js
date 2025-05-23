#!/usr/bin/env node
// -*- fill-column: 100; eval: (display-fill-column-indicator-mode 1); -*-
// =======================================================================================
// THIS FILE IS NOT THE DRAW THINGS SCRIPT: that's over in wildcards-plus.js.
//
// This script is a tool that you can use at the command line (you'll need to have Node.js
// installed) to test out wildcards-plus prompts that you're working on to see how they'll
// be expanded by wildcards-plus. It can also POST image requests for the expanded prompts
// to Draw Things.
//
// The script takes a file name as its first argument, and an optional second argument
// specifying how many expansions you'd like to see.
//
// Usage: ./wildcards-plus-tool.js [-p|-c] <input-file> [<counut>]
// 
// -p: POST the image generation requests to a local instance of Draw Things.
// -c: as -p, but prompting for confirmation before POSTing each prompt.
//
// Example of usage:
// $ ./wildcards-plus-tester.js ./sample-prompts/fantasy-character.txt 3
// ------------------------------------------------------------------------------------------
// Expansions:
// ------------------------------------------------------------------------------------------
// dark fantasy, masterpiece, ultra high resolution, 8k, detailed background, wide shot, 
// An oil painting for the cover of a fantasy novel published in the 1990s, in the style of the artist Brom, which depicts a seductive, ominous and antediluvian cultist on a starlit night, cradling her jewel-encrusted spell book while standing in a crumbling church, glowering up at the viewer pridefully while commanding a coterie of demonic swarming slaves.
//
// dark fantasy, masterpiece, ultra high resolution, 8k, detailed background, wide shot, 
// An oil painting for the cover of a fantasy novel published in the 1980s, in the style of Yoshiaki Kawajiri, depicting an athletic, handsome and charming cataphract while laying on his throne in a shadowy arcane library and inviting past the viewer.
//
// epic fantasy, masterpiece, ultra high resolution, 8k, detailed background, wide shot, 
// A promotional poster for an award winning video game, which depicts a heroic, strong and athletic paladin wearing blood-smeared wargear holding his bejeweled flail while standing in an eerily lit lair, smiling towards the viewer victoriously.
// =================================================================================================
import * as util     from 'util';
import * as http     from 'http';
import * as fs       from 'fs';
import * as readline from 'readline';
import path          from 'path';
import { stdin as input, stdout as output } from 'process';
// -------------------------------------------------------------------------------------------------


// =================================================================================================
// NODE-ONLY HELPER FUNCTIONS SECTION (these won't work inside of DT!): 
// =================================================================================================
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
// -------------------------------------------------------------------------------------------------
function parse_file(filename) {
  const prompt_input = fs.readFileSync(filename, 'utf8');
  const result       = Prompt.match(prompt_input);

  return result;
}
// -------------------------------------------------------------------------------------------------
function post_prompt({ prompt = '', configuration = {}, hostname = '127.0.0.1', port = 7860 }) {
  // console.log(`POSTing with configuration: ${JSON.stringify(configuration)}`);

  const data        = { prompt: prompt, ...configuration };
  const string_data = JSON.stringify(data);

  if (log_post_enabled)
    console.log(`POST data is: ${inspect_fun(data)}`);
  
  const options = {
    hostname: hostname,
    port: port,
    path: '/sdapi/v1/txt2img',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': string_data.length
    }
  };

  save_post_request(options, data);

  const req = http.request(options);

  req.on('socket', (socket) => {
    socket.on('connect', () => {
      req.write(string_data);
      req.end();

      let printed = false;
      
      if (fire_and_forget_post_enabled) {
        socket.destroy(); // don't wait for the response.
      }
      else {
        console.log(`POSTing..`);
        socket.on('data', chunk => {
          if (! printed)
            console.log(`Response: ${abbreviate(chunk.toString(), 1000)}`);
          printed = true;
        });
      }
    });
  });

  req.on('error', (error) => {
    if (error.message !== 'socket hang up')
      console.error(`ERROR: ${error}`);
  });
}
// -------------------------------------------------------------------------------------------------
function save_post_request(options, data) {
  if (! save_post_requests_enable)
    return true;

  const json      = JSON.stringify(data, null, 2);
  const timestamp = Math.floor(Date.now() / 1000);
  const dir       = 'posts';
  const filename  = data.seed
        ? `./${dir}/${timestamp}__${data.seed == -1 ? "random" : data.seed}.req`
        : `./${dir}/${timestamp}.req`;
  const file_data = `POST http://${options.hostname}:` +
        `${options.port}${options.path}\n` +
        `Content-Type: application/json\n` + 
        `${json}`;
  
  if (log_post_enabled)
    console.log(`Saving POST data to '${filename}'...`);

  if (!fs.existsSync(dir))
    fs.mkdirSync(dir, { recursive: true });

  try {
    fs.writeFileSync(filename, file_data);
    console.log(`Saved  POST data.`);
    
    return true;
  }
  catch (err) {
    console.error(`ERROR WHILE SAVING: ${err}`);

    return false;
  }
}
// -------------------------------------------------------------------------------------------------
function process_includes(thing, context = new Context()) {
  function walk(thing, context) {
    if (thing instanceof ASTInclude) {
      const current_file = context.files[context.files.length - 1];
      const res = []

      // console.log(`INSPECT: ${inspect_fun(thing, null, 2)}`);
      
      for (let filename of thing.args) {
        if (typeof filename !== 'string')
          throw new Error(`include's arguments must be strings, got ${inspect_fun(filename)}`);
        
        filename = path.join(path.dirname(current_file), filename);
        
        if (context.files.includes(filename)) {
          console.log(`WARNING: skipping duplicate include of '${filename}'.`);
          continue;
        }

        context.files.push(filename);

        const parse_file_result = parse_file(filename);

        if (! parse_file_result.is_finished)
          throw new Error(`error parsing ${filename}! ${inspect_fun(parse_file_result)}`);
        
        res.push(walk(parse_file_result.value, context.shallow_copy()));
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
// =================================================================================================
// END OF NODE-ONLY HELPER FUNCTIONS SECTION.
// =================================================================================================


// =================================================================================================
// SET inspect_fun APPROPRIATELY FOR node.js:
// =================================================================================================
let inspect_fun           = (thing, no_break = false) =>
    util.inspect(thing,
                 { breakLength: (no_break ? Infinity: 80),
                   maxArrayLength: Infinity,
                   depth: 2,
                 });
let dt_hosted             = false;
let test_structured_clone = true;
// =================================================================================================


// =================================================================================================
if (false)
  // ===============================================================================================
  // DEV NOTE: Copy into wildcards-plus.js starting from this line onwards!
  // ===============================================================================================
{
  inspect_fun           = (thing, no_break = false) => JSON.stringify(thing, null, no_break ? 0 : 2);
  dt_hosted             = true;
  test_structured_clone = false;
}
// -------------------------------------------------------------------------------------------------


// -------------------------------------------------------------------------------------------------
// GLOBAL VARIABLES:
// -------------------------------------------------------------------------------------------------
let fire_and_forget_post_enabled      = true;
let unnecessary_choice_is_error       = false;
let print_ast_enabled                 = false;
let print_ast_json_enabled            = false;
let log_enabled                       = true;
let log_configuration_enabled         = true;
let log_finalize_enabled              = false;
let log_flags_enabled                 = false;
let log_match_enabled                 = false;
let log_name_lookups_enabled          = false;
let log_picker_enabled                = false;
let log_post_enabled                  = true;
let log_smart_join_enabled            = false;
let log_expand_and_walk_enabled       = false;  
let disable_prelude                   = false;
let print_ast_before_includes_enabled = false;
let print_ast_after_includes_enabled  = false;
let save_post_requests_enable         = true;
// =================================================================================================



// =================================================================================================
// find a better spot for this: 
// =================================================================================================
Array.prototype.toString = function() {
  return this.length > 0 ? compress(`[ ${this.join(", ")} ]`) : '[]';
}
// =================================================================================================



// =================================================================================================
// GRAMMAR.JS CONTENT SECTION:
// =================================================================================================
// Code in this section originally copy/pasted from the grammar.js file in my 'jparse'
// project circa ac2979f but updated since.
// 
// Not all of this section is actually used by the wildcards-plus script right 
// now, but it's easier to just copy/paste in the whole file than it is to
// bother working out which parts can be removed and snipping them out, and who
// knows, maybe I'll use more of it in the future.
// 
// Original project at: https://github.com/ariane-emory/jparse/
// =================================================================================================
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
// -------------------------------------------------------------------------------------------------
const DISCARD = Symbol('DISCARD');
// -------------------------------------------------------------------------------------------------

// -------------------------------------------------------------------------------------------------
// trailing_separator_modes 'enum':
// -------------------------------------------------------------------------------------------------
const trailing_separator_modes = Object.freeze({
  allowed:   'allowed',
  required:  'required',
  forbidden: 'forbidden'
});
// -------------------------------------------------------------------------------------------------

// -------------------------------------------------------------------------------------------------
// Rule class
// -------------------------------------------------------------------------------------------------
class Rule {
  // -----------------------------------------------------------------------------------------------
  abbreviate_str_repr(str) {
    if (str)
      this.__impl_toString   = () => str;
    
    this.__direct_children = () => [];
  }
  // -----------------------------------------------------------------------------------------------
  direct_children() {
    const ret = this.__direct_children();

    if (ret.includes(undefined))
      throw new Error(`__direct_children ` +
                      `${inspect_fun(ret)} ` +
                      `included undefined for ` +
                      `${inspect_fun(this)}`);

    return ret;
  }
  // -----------------------------------------------------------------------------------------------
  __direct_children() {
    throw new Error(`__direct_children is not implemented by ${this.constructor.name}`);
  }
  // -----------------------------------------------------------------------------------------------
  collect_ref_counts(ref_counts = new Map()) {
    if (ref_counts.has(this)) {
      ref_counts.set(this, ref_counts.get(this) + 1);
      return ref_counts;
    }

    ref_counts.set(this, 1);

    for (const direct_child of this.direct_children()) {
      // console.log(`direct_child = ${inspect_fun(direct_child)}`);
      this.__vivify(direct_child).collect_ref_counts(ref_counts);
    }

    return ref_counts;
  }
  // -----------------------------------------------------------------------------------------------
  match(input, index = 0, indent = 0) {
    if (typeof input !== 'string') {
      throw new Error(`not a string: ${typeof input} ${abbreviate(inspect_fun(input))}!`);
    }
    
    if (log_match_enabled) {
      if (index_is_at_end_of_input(index, input))
        log(indent,
            `Matching ${this.constructor.name} ${this.toString()}, ` +
            `but at end of token stream!`);
      else 
        log(indent,
            `Matching ${this.constructor.name} ${this.toString()} at ` +
            `char ${index}, ` +
            `token #${index}: ` +
            `${abbreviate(input.substring(index))}`)
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
  // -----------------------------------------------------------------------------------------------
  __match(indent, input, index) {
    throw new Error(`__match is not implemented by ${this.constructor.name}`);
  }
  // -----------------------------------------------------------------------------------------------
  finalize(indent = 0) {
    this.__finalize(indent, new Set());
  }
  // -----------------------------------------------------------------------------------------------
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
  // -----------------------------------------------------------------------------------------------
  __impl_finalize(indent, visited) {
    throw new Error(`__impl_finalize is not implemented by ${this.constructor.name}`);    
  }
  // -----------------------------------------------------------------------------------------------
  toString() {
    const ref_counts = this.collect_ref_counts();
    const next_id    = { value: 0 };

    // if (ref_counts.size > 0) {
    //   console.log(`REF_COUNTS:`);
    //   console.log('{');
    
    //   for (const [key, value] of ref_counts)
    //     console.log(`  ${inspect_fun(key, true)} ` +
    //                 `=> ${value},`);
    
    //   console.log('}');
    // }
    
    return this.__toString(new Map(), next_id, ref_counts).replace('() => ', '');
  }
  // -----------------------------------------------------------------------------------------------
  __toString(visited, next_id, ref_counts) {
    if (ref_counts === undefined)
      throw new Error('got undefined ref_counts!');

    const __call_impl_toString = () => this
          .__impl_toString(visited, next_id, ref_counts)
          .replace('() => ', '');
    
    if (this.direct_children().length == 0) {
      return abbreviate(__call_impl_toString(), 32);
      // return __call_impl_toString();
    }
    
    if (visited.has(this)) {
      const got_id = visited.get(this);
      return `#${visited.get(this)}`;
    }

    // mark as visited (but not yet emitted)
    visited.set(this, NaN);

    const got_ref_count  = ref_counts.get(this);
    let should_assign_id = got_ref_count > 1;

    if (should_assign_id) {
      // pre-assign ID now so recursive calls can reference it
      next_id.value += 1;
      visited.set(this, next_id.value);
    }

    let ret = __call_impl_toString();

    if (should_assign_id) 
      return `#${visited.get(this)}#=${ret}`;
    
    return ret;
  }
  // -----------------------------------------------------------------------------------------------
  __impl_toString(visited, next_id, ref_counts) {
    throw new Error(`__impl_toString is not implemented by ` +
                    `${this.constructor.name}`);
  }
  // -----------------------------------------------------------------------------------------------
  __vivify(thing) {
    if (thing instanceof ForwardReference)
      thing = thing.func;
    
    if (typeof thing === 'function') 
      thing = thing();
    
    return thing;
  }
}
// -------------------------------------------------------------------------------------------------

// -------------------------------------------------------------------------------------------------
// Quantified class
// -------------------------------------------------------------------------------------------------
class Quantified extends Rule {
  // -----------------------------------------------------------------------------------------------
  constructor(rule, separator_rule = null,
              trailing_separator_mode = trailing_separator_modes.forbidden) {
    super();
    this.rule                    = make_rule_func(rule);
    this.separator_rule          = make_rule_func(separator_rule);
    this.trailing_separator_mode = trailing_separator_mode;
  }
  // -----------------------------------------------------------------------------------------------
  __direct_children() {
    return this.separator_rule
      ? [ this.rule, this.separator_rule ]
      : [ this.rule ];
  }
  // -----------------------------------------------------------------------------------------------
  __impl_finalize(indent, visited) {
    this.rule            = this.__vivify(this.rule);
    this.separator_rule  = this.__vivify(this.separator_rule);
    this.rule           .__finalize(indent + 1, visited);
    this.separator_rule?.__finalize(indent + 1, visited);
  }
  // -----------------------------------------------------------------------------------------------
  __quantified_match(indent, input, index) {
    const values        = [];
    let prev_index      = null;
    const rewind_index  = ()   => index = prev_index;
    const update_index  = (ix) => {
      prev_index = index;
      index      = ix;
    };

    indent += 1;

    let match_result = this.rule.match(input, index, indent + 1);

    if (match_result === undefined)
      throw new Error("left");
    
    if (match_result === false)
      throw new Error("right");
    
    if (match_result === null)
      return new MatchResult([], input, index); // empty array happens here

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
// -------------------------------------------------------------------------------------------------

// -------------------------------------------------------------------------------------------------
// Plus class
// -------------------------------------------------------------------------------------------------
class Plus extends Quantified {
  // -----------------------------------------------------------------------------------------------
  __match(indent, input, index) {
    const __quantified_match_result =
          this.__quantified_match(indent, input, index);

    return __quantified_match_result?.value.length == 0
      ? null
      : __quantified_match_result;
  }
  // -----------------------------------------------------------------------------------------------
  __impl_toString(visited, next_id, ref_counts) {
    return this.separator_rule
      ? (`${this.__vivify(this.rule).__toString(visited, next_id, ref_counts)}` +
         // `\\${this.separator_rule}+`)
         `::${this.separator_rule}+`)
      : `${this.__vivify(this.rule).__toString(visited, next_id, ref_counts)}+`;
  }
}
// -------------------------------------------------------------------------------------------------
function plus(rule, // convenience constructor
              separator_value = null,
              trailing_separator_mode =
              trailing_separator_modes.forbidden) {
  return new Plus(rule, separator_value, trailing_separator_mode);
}
// -------------------------------------------------------------------------------------------------

// -------------------------------------------------------------------------------------------------
// Star class
// -------------------------------------------------------------------------------------------------
class Star extends Quantified {
  // -----------------------------------------------------------------------------------------------
  __match(indent, input, index) {
    return this.__quantified_match(indent, input, index);
  }
  // -----------------------------------------------------------------------------------------------
  __impl_toString(visited, next_id, ref_counts) {
    // return `${this.__vivify(this.rule).__toString(visited, next_id)}*`;
    return this.separator_rule
      ? (`${this.__vivify(this.rule).__toString(visited, next_id, ref_counts)}` +
         `::${this.separator_rule}*`)
      : `${this.__vivify(this.rule).__toString(visited, next_id, ref_counts)}*`;
  }
}
// -------------------------------------------------------------------------------------------------
function // convenience constructor
star(value,
     separator_value = null,
     trailing_separator_mode = trailing_separator_modes.forbidden) {
  return new Star(value, separator_value, trailing_separator_mode);
}
// -------------------------------------------------------------------------------------------------

// -------------------------------------------------------------------------------------------------
// Choice class
// -------------------------------------------------------------------------------------------------
class Choice extends Rule  {
  // -----------------------------------------------------------------------------------------------
  constructor(...options) {
    super();
    this.options = options.map(make_rule_func);
  }
  // -----------------------------------------------------------------------------------------------
  __direct_children() {
    return this.options;
  }
  // -----------------------------------------------------------------------------------------------
  __impl_finalize(indent, visited) {
    for (let ix = 0; ix < this.options.length; ix++) {
      this.options[ix] = this.__vivify(this.options[ix]);
      this.options[ix].__finalize(indent + 1, visited);
    }
  }
  // -----------------------------------------------------------------------------------------------
  __match(indent, input, index) {
    let ix = 0;
    
    for (const option of this.options) {
      ix += 1;
      
      if (log_match_enabled)
        log(indent + 1, `Try option #${ix}: ${option}`);
      
      const match_result = option.match(
        input, index, indent + 2);
      
      if (match_result) { 
        // if (match_result.value === DISCARD) {
        //   index = match_result.index;
        
        //   continue;
        // }

        if (log_match_enabled)
          log(indent + 1, `Chose option #${ix}!`);
        
        return match_result;
      }

      if (log_match_enabled)
        log(indent + 1, `Rejected option #${ix}.`);
    }

    return null;
  }
  // -----------------------------------------------------------------------------------------------
  __impl_toString(visited, next_id, ref_counts) {
    // return `{ ${this.options
    //             .map(x =>
    //                    this.__vivify(x)
    //                    .__toString(visited, next_id, ref_counts)).join(' | ')} }`;
    return `{ ${this.options
                .map(x =>
                       this.__vivify(x)
                       .__toString(visited, next_id, ref_counts)).join(' | ')} }`;
  }
}
// -------------------------------------------------------------------------------------------------
function choice(...options) { // convenience constructor
  if (options.length == 1) {
    console.log("WARNING: unnecessary use of choice!");

    if (unnecessary_choice_is_error)
      throw new Error("unnecessary use of choice");
    
    return make_rule_func(options[0]);
  }
  
  return new Choice(...options)
}
// -------------------------------------------------------------------------------------------------

// -------------------------------------------------------------------------------------------------
// Discard class
// -------------------------------------------------------------------------------------------------
class Discard extends Rule {
  // -----------------------------------------------------------------------------------------------
  constructor(rule) {
    super();
    this.rule = make_rule_func(rule);
  }
  // -----------------------------------------------------------------------------------------------
  __direct_children() {
    return [ this.rule ];
  }
  // -----------------------------------------------------------------------------------------------
  __impl_finalize(indent, visited) {
    this.rule = this.__vivify(this.rule);    
    this.rule?.__finalize(indent + 1, visited);
  }
  // -----------------------------------------------------------------------------------------------
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
  // -----------------------------------------------------------------------------------------------
  __impl_toString(visited, next_id, ref_counts) {
    return `-${this.__vivify(this.rule).__toString(visited, next_id, ref_counts)}`;
  }
}
// -------------------------------------------------------------------------------------------------
function discard(rule) { // convenience constructor
  return new Discard(rule)
}
// -------------------------------------------------------------------------------------------------

// -------------------------------------------------------------------------------------------------
// Element class
// -------------------------------------------------------------------------------------------------
class Element extends Rule {
  // -----------------------------------------------------------------------------------------------
  constructor(index, rule) {
    super();
    this.index = index;
    this.rule  = make_rule_func(rule);
  }
  // -----------------------------------------------------------------------------------------------
  __direct_children() {
    return [ this.rule ];
  }
  // -----------------------------------------------------------------------------------------------
  __impl_finalize(indent, visited) {
    this.rule = this.__vivify(this.rule);
    this.rule.__finalize(indent + 1, visited);
  }
  // -----------------------------------------------------------------------------------------------
  __match(indent, input, index) {
    const rule_match_result = this.rule.match(input, index, indent + 1);

    if (! rule_match_result)
      return null;

    // if (log_match_enabled) {
    //   log(indent, `taking elem ${this.index} from ` +
    //       `${inspect_fun(rule_match_result)}'s value.`);
    // }

    const ret = rule_match_result.value[this.index] === undefined
          ? DISCARD
          : rule_match_result.value[this.index];
    
    if (log_match_enabled) {
      log(indent, `GET ELEM ${this.index} FROM ${inspect_fun(rule_match_result.value)} = ` +
          `${typeof ret === 'symbol' ? ret.toString() : inspect_fun(ret)}`);
    }
    
    rule_match_result.value = ret;
    
    return rule_match_result
  }
  // -----------------------------------------------------------------------------------------------
  __impl_toString(visited, next_id, ref_counts) {
    // const rule     = this.__vivify(this.rule);
    // const rule_str = rule.__toString(visited, next_id, ref_counts);
    const rule_str = this.rule.__toString(visited, next_id, ref_counts);

    return `elem(${this.index}, ${rule_str})`;
    // return `[${this.index}]${rule_str}`;
  }
}
// -------------------------------------------------------------------------------------------------
function elem(index, rule) { // convenience constructor
  return new Element(index, rule);
}
// -------------------------------------------------------------------------------------------------
function first(rule) {
  rule = new Element(0, rule);

  rule.__impl_toString = function(visited, next_id, ref_counts) {
    // const rule     = this.__vivify(this.rule);
    // const rule_str = rule.__toString(visited, next_id, ref_counts);
    const rule_str = this.rule.__toString(visited, next_id, ref_counts);

    return `1st(${rule_str})`;
    // return `first(${rule_str})`;
  }
  
  return rule;
}
// -------------------------------------------------------------------------------------------------
function second(rule) {
  rule = new Element(1, rule);

  rule.__impl_toString = function(visited, next_id, ref_counts) {
    // const rule     = this.__vivify(this.rule);
    // const rule_str = rule.__toString(visited, next_id, ref_counts);
    const rule_str = this.rule.__toString(visited, next_id, ref_counts);

    return `2nd(${rule_str})`;
    // return `second(${rule_str})`;
  }
  
  return rule;
}
// -------------------------------------------------------------------------------------------------
function third(rule) {
  rule = new Element(2, rule);

  rule.__impl_toString = function(visited, next_id, ref_counts) {
    // const rule     = this.__vivify(this.rule);
    // const rule_str = rule.__toString(visited, next_id, ref_counts);
    const rule_str = this.rule.__toString(visited, next_id, ref_counts);

    return `3rd(${rule_str})`;
    // return `third(${rule_str})`;
  }
  
  return rule;
}
// -------------------------------------------------------------------------------------------------

// -------------------------------------------------------------------------------------------------
// Enclosed class
// -------------------------------------------------------------------------------------------------
class Enclosed extends Rule {
  // i-----------------------------------------------------------------------------------------------
  constructor(start_rule, body_rule, end_rule) {
    super();

    if (! end_rule) {
      // if two args are supplied, they're (body_rule, enclosing_rule):
      start_rule = body_rule;
      body_rule  = start_rule;
      // end_rule   = body_rule;
    }
    
    this.start_rule = make_rule_func(start_rule);
    this.body_rule  = make_rule_func(body_rule); 
    this.end_rule   = make_rule_func(end_rule);  
    
    if (! this.end_rule)
      this.end_rule = this.start_rule;
  }
  // -----------------------------------------------------------------------------------------------
  __direct_children() {
    return [ this.start_rule, this.body_rule, this.end_rule ];
  }
  // -----------------------------------------------------------------------------------------------
  __fail_or_throw_error(start_rule_result, failed_rule_result,
                        input, index) {
    return null;
  }
  // -----------------------------------------------------------------------------------------------
  __impl_finalize(indent, visited) {
    this.start_rule = this.__vivify(this.start_rule);
    this.body_rule  = this.__vivify(this.body_rule);
    this.end_rule   = this.__vivify(this.end_rule);
    this.start_rule.__finalize(indent + 1, visited);
    this.body_rule.__finalize(indent + 1, visited);
    this.end_rule.__finalize(indent + 1, visited);
  }
  // -----------------------------------------------------------------------------------------------
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
  // -----------------------------------------------------------------------------------------------
  __impl_toString(visited, next_id, ref_counts) {
    return `[${this.__vivify(this.start_rule).__toString(visited, next_id, ref_counts)} ` +
      `${this.__vivify(this.body_rule).__toString(visited, next_id, ref_counts)} ` +
      `${this.__vivify(this.end_rule).__toString(visited, next_id, ref_counts)}]`;
  }
}
// -------------------------------------------------------------------------------------------------
function enc(start_rule, body_rule, end_rule) { // convenience constructor
  return new Enclosed(start_rule, body_rule, end_rule);
}
// -------------------------------------------------------------------------------------------------

// -------------------------------------------------------------------------------------------------
// CuttingEnclosed class
// -------------------------------------------------------------------------------------------------
class CuttingEnclosed extends Enclosed {
  // -----------------------------------------------------------------------------------------------
  constructor(start_rule, body_rule, end_rule) {
    super(start_rule, body_rule, end_rule);
  }
  // -----------------------------------------------------------------------------------------------
  __fail_or_throw_error(start_rule_result, failed_rule_result,
                        input, index) {
    throw new Error(// `(#1) ` +
      `expected (${this.body_rule} ${this.end_rule}) ` +
        `after ${this.start_rule} at ` +
        `char ${index}` +
        `, found:\n` +
        `${abbreviate(input.substring(start_rule_result.index))}`);
  }
  // -----------------------------------------------------------------------------------------------
  __impl_toString(visited, next_id, ref_counts) {
    return `[${this.__vivify(this.start_rule).__toString(visited, next_id, ref_counts)}! ` +
      `${this.__vivify(this.body_rule).__toString(visited, next_id, ref_counts)} ` +
      `${this.__vivify(this.end_rule).__toString(visited, next_id, ref_counts)}]`
  }
}
// -------------------------------------------------------------------------------------------------
// convenience constructor:
function cutting_enc(start_rule, body_rule, end_rule) {
  return new CuttingEnclosed(start_rule, body_rule, end_rule);
}
// -------------------------------------------------------------------------------------------------

// -------------------------------------------------------------------------------------------------
// Label class
// -------------------------------------------------------------------------------------------------
class Label extends Rule {
  // -----------------------------------------------------------------------------------------------
  constructor(label, rule) {
    super();
    this.label = label;
    this.rule = make_rule_func(rule);
  }
  // -----------------------------------------------------------------------------------------------
  __direct_children() {
    return [ this.rule ];
  }
  // -----------------------------------------------------------------------------------------------
  __impl_finalize(indent, visited) {
    this.rule = this.__vivify(this.rule);
    this.rule.__finalize(indent + 1, visited);
  }
  // -----------------------------------------------------------------------------------------------
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
  // -----------------------------------------------------------------------------------------------
  __impl_toString(visited, next_id, ref_counts) {
    return `L('${this.label}', ` +
      `${this.__vivify(this.rule).__toString(visited, next_id)})`;
  }
}
// -------------------------------------------------------------------------------------------------
function label(label, rule) {
  return new Label(label, rule);
}
// -------------------------------------------------------------------------------------------------

// -------------------------------------------------------------------------------------------------
// NeverMatch class
// -------------------------------------------------------------------------------------------------
class NeverMatch extends Rule  {
  // -----------------------------------------------------------------------------------------------
  constructor() {
    super();
  }
  // -----------------------------------------------------------------------------------------------
  __direct_children() {
    return [ ];
  }
  // -----------------------------------------------------------------------------------------------
  __impl_finalize(indent, visited) {
    // do nothing.
  }
  // -----------------------------------------------------------------------------------------------
  __match(indent, input, index) {
    return null;
  } 
  // -----------------------------------------------------------------------------------------------
  __impl_toString(visited, next_id, ref_counts) {
    return `<NEVER MATCH>`;
  }
}
// -------------------------------------------------------------------------------------------------
const never_match = new NeverMatch();
// -------------------------------------------------------------------------------------------------

// -------------------------------------------------------------------------------------------------
// Optional class
// -------------------------------------------------------------------------------------------------
class Optional extends Rule {
  // -----------------------------------------------------------------------------------------------
  constructor(rule, default_value = null) {
    super();
    this.rule          = make_rule_func(rule);
    this.default_value = default_value;
  }
  // -----------------------------------------------------------------------------------------------
  __direct_children() {
    return [ this.rule ];
  }
  // -----------------------------------------------------------------------------------------------
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
  // -----------------------------------------------------------------------------------------------
  __impl_finalize(indent, visited) {
    this.rule = this.__vivify(this.rule);
    
    this.rule.__finalize(indent + 1, visited);
  }
  // -----------------------------------------------------------------------------------------------
  __impl_toString(visited, next_id, ref_counts) {
    return `${this.__vivify(this.rule).__toString(visited, next_id, ref_counts)}?`;
  }
}
// -------------------------------------------------------------------------------------------------
function optional(rule, default_value = null) { // convenience constructor
  return new Optional(rule, default_value);
}
// -------------------------------------------------------------------------------------------------

// -------------------------------------------------------------------------------------------------
// Sequence class
// -------------------------------------------------------------------------------------------------
class Sequence extends Rule {
  // -----------------------------------------------------------------------------------------------
  constructor(...elements) {
    super();
    this.elements = elements.map(make_rule_func);
  }
  // -----------------------------------------------------------------------------------------------
  __direct_children() {
    return this.elements;
  }
  // -----------------------------------------------------------------------------------------------
  __fail_or_throw_error(start_rule_result, failed_rule_result,
                        input, index) {
    return null;
  }
  // -----------------------------------------------------------------------------------------------
  __impl_finalize(indent, visited) {
    for (let ix = 0; ix < this.elements.length; ix++) {
      this.elements[ix] = this.__vivify(this.elements[ix]);
      this.elements[ix].__finalize(indent + 1, visited);
    }
  }
  // -----------------------------------------------------------------------------------------------
  __match(indent, input, index) {
    const start_rule = input[0];

    if (log_match_enabled)
      log(indent + 1, `matching first sequence item #0 out of ` +
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
      log(indent + 1, `matched sequence item #0: ` +
          `${JSON.stringify(last_match_result)}.`);
    
    const values = [];
    index        = last_match_result.index;

    if (log_match_enabled)
      log(indent + 1, `last_match_result = ${inspect_fun(last_match_result)}`);

    if (last_match_result.value !== DISCARD) {
      if (log_match_enabled)
        log(indent + 1, `seq pushing ${inspect_fun(last_match_result.value)}`);

      values.push(last_match_result.value);

      // if (values.includes(null))
      //   throw new Error("STOP @ PUSH 1");
    }
    else if (log_match_enabled)
      log(indent + 1, `discarding ${inspect_fun(last_match_result)}!`);

    for (let ix = 1; ix < this.elements.length; ix++) {
      if (log_match_enabled)
        log(indent + 1, `matching sequence item #${ix} out of ` +
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
          log(indent + 1, `seq pushing ${inspect_fun(last_match_result.value)}`);

        values.push(last_match_result.value);

        // if (values.includes(null))
        //   throw new Error(`STOP @ PUSH 2 AFTER ${this.elements[ix]}`);
      }

      index = last_match_result.index;
    }

    // if (values.includes(null))
    //   throw new Error("STOP @ RET");
    
    const mr = new MatchResult(values, input, last_match_result.index);
    // console.log(`SEQ MR = ${inspect_fun(mr)}`);
    return mr;
  }
  // -----------------------------------------------------------------------------------------------
  __impl_toString(visited, next_id, ref_counts) {
    const elem_strs = this.elements.map(x => this.__vivify(x) .__toString(visited,
                                                                          next_id,
                                                                          ref_counts));
    const str       = elem_strs.join(' ');
    return `[${str}]`;
    // return `(${str})`;
  }
}
// -------------------------------------------------------------------------------------------------
function seq(...elements) { // convenience constructor
  return new Sequence(...elements);
}
// -------------------------------------------------------------------------------------------------

// -------------------------------------------------------------------------------------------------
// CuttingSequence class
// -------------------------------------------------------------------------------------------------
class CuttingSequence extends Sequence {
  // -----------------------------------------------------------------------------------------------
  constructor(leading_rule, ...expected_rules) {
    super(leading_rule, ...expected_rules);
  }
  // -----------------------------------------------------------------------------------------------
  __fail_or_throw_error(start_rule_result, failed_rule_result,
                        input, index) {
    throw new Error(// `(#2) ` +
      `expected (${this.elements.slice(1).join(" ")}) ` +
        `after ${this.elements[0]} at ` +
        `char ${index}` +
        `, found:\n` +
        `${abbreviate(input.substr(start_rule_result.index))}`);
  }
  // -----------------------------------------------------------------------------------------------
  __impl_toString(visited, next_id, ref_counts) {
    const first_str = `${this.__vivify(this.elements[0]).__toString(visited, next_id, ref_counts)}!`;
    const rest_strs = this.elements.slice(1).map(x => this.__vivify(x)
                                                 .__toString(visited, next_id, ref_counts));
    const str       = [ first_str, ...rest_strs ].join(' ');
    return `[${str}]`;
  }
}
// -------------------------------------------------------------------------------------------------
// convenience constructor:
function cutting_seq(leading_rule, ...expected_rules) {
  return new CuttingSequence(leading_rule, ...expected_rules);
}
// -------------------------------------------------------------------------------------------------

// -------------------------------------------------------------------------------------------------
// Xform class
// -------------------------------------------------------------------------------------------------
class Xform extends Rule {
  // -----------------------------------------------------------------------------------------------
  constructor(rule, xform_func) {
    super();
    this.xform_func = xform_func;
    this.rule       = make_rule_func(rule);
  }
  // -----------------------------------------------------------------------------------------------
  __direct_children() {
    return this.__vivify(this.rule).direct_children();
  }
  // -----------------------------------------------------------------------------------------------
  __impl_finalize(indent, visited) {
    this.rule = this.__vivify(this.rule);
    this.rule.__finalize(indent + 1, visited);
  }
  // -----------------------------------------------------------------------------------------------
  __match(indent, input, index) {
    const rule_match_result = this.rule.match(
      input, index, indent + 1);

    if (! rule_match_result)
      return null;

    rule_match_result.value = this.xform_func(rule_match_result.value);

    return rule_match_result
  }
  // -----------------------------------------------------------------------------------------------
  __impl_toString(visited, next_id, ref_counts) {
    return `λ(${this.__vivify(this.rule).__toString(visited, next_id, ref_counts)})`;
    // return `λ${this.__vivify(this.rule).__toString(visited, next_id, ref_counts)}`;
  }
}
// -------------------------------------------------------------------------------------------------
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
// -------------------------------------------------------------------------------------------------

// -------------------------------------------------------------------------------------------------
// Expect class
// -------------------------------------------------------------------------------------------------
class Expect extends Rule {
  // -----------------------------------------------------------------------------------------------
  constructor(rule, error_func = null) {
    super();
    this.rule       = make_rule_func(rule);
    this.error_func = error_func;
  }
  // -----------------------------------------------------------------------------------------------
  __direct_children() {
    return [ this.rule ];
  }
  // -----------------------------------------------------------------------------------------------
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
        throw new Error(// `(#3) ` +
          `expected ${this.rule} at ` +
            `char ${input[index].start}` +
            `, found:\n` +
            `[ ${input.slice(index).join(", ")}` +
            ` ]`);
      }
    };

    return match_result;
  }
  // -----------------------------------------------------------------------------------------------
  __impl_finalize(indent, visited) {
    this.rule = this.__vivify(this.rule);    
    this.rule.__finalize(indent + 1, visited);
  }
  // -----------------------------------------------------------------------------------------------
  __impl_toString(visited, next_id, ref_counts) {
    return `${this.__vivify(this.rule).__toString(visited, next_id)}!`;
  }
}
// -------------------------------------------------------------------------------------------------
function expect(rule, error_func = null) { // convenience constructor
  return new Expect(rule, error_func);
}
// -------------------------------------------------------------------------------------------------

// -------------------------------------------------------------------------------------------------
// Unexpected class
// -------------------------------------------------------------------------------------------------
class Unexpected extends Rule {
  // -----------------------------------------------------------------------------------------------
  constructor(rule, error_func = null) {
    super();
    this.rule       = make_rule_func(rule);
    this.error_func = error_func;
  }
  // -----------------------------------------------------------------------------------------------
  __direct_children() {
    return [ this.rule ];
  }
  // -----------------------------------------------------------------------------------------------
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
        foo(bar(baz(quux(corge(grault())))));

        throw new Error(// `(#4) ` +
          `unexpected ${this.rule} at ` +
            `char ${index}` +
            `, found:\n` +
            input.substring(index, index + 20) +
            `...`);
        foo(bar(baz(quux(corge(grault())))));                      
      }
    };
    
    return null; // new MatchResult(null, input, match_result.index);
  }
  // -----------------------------------------------------------------------------------------------
  __impl_finalize(indent, visited) {
    this.rule = this.__vivify(this.rule);    
    this.rule.__finalize(indent + 1, visited);
  }
  // -----------------------------------------------------------------------------------------------
  __impl_toString(visited, next_id, ref_counts) {
    return `!${this.__vivify(this.rule).__toString(visited, next_id)}!`;
  }
}
// -------------------------------------------------------------------------------------------------
function unexpected(rule, error_func = null) { // convenience constructor
  return new Unexpected(rule, error_func);
}
// -------------------------------------------------------------------------------------------------

// -------------------------------------------------------------------------------------------------
// Fail class
// -------------------------------------------------------------------------------------------------
class Fail extends Rule {
  // -----------------------------------------------------------------------------------------------
  constructor(error_func = null) {
    super();
    this.error_func = error_func;
  }
  // -----------------------------------------------------------------------------------------------
  __direct_children() {
    return [];
  }
  // -----------------------------------------------------------------------------------------------
  __match(indent, input, index) {
    throw this.error_func
      ? this.error_func(this, index, input)
      : new Error(// `(#5) ` +
        `unexpected ${this.rule} at ` +
          `char ${input[index].start}` +
          `, found:\n` +
          `[ ${input.slice(index).join(", ")}` +
          ` ]`);
  }
  // -----------------------------------------------------------------------------------------------
  __impl_finalize(indent, visited) {
    // do nothing
  }
  // -----------------------------------------------------------------------------------------------
  __impl_toString(visited, next_id, ref_counts) {
    return `<FAIL!>`;
  }
}
// -------------------------------------------------------------------------------------------------
function fail(error_func = null) { // convenience constructor
  return new Fail(error_func);
}
// -------------------------------------------------------------------------------------------------

// -------------------------------------------------------------------------------------------------
// TokenLabel class
// -------------------------------------------------------------------------------------------------
class TokenLabel extends Rule {
  // -----------------------------------------------------------------------------------------------
  constructor(label) {
    super();
    this.label  = label;
  }
  // -----------------------------------------------------------------------------------------------
  __direct_children() {
    return [];
  }
  // -----------------------------------------------------------------------------------------------
  __impl_finalize(indent, visited) {
    // do nothing.
  }
  // -----------------------------------------------------------------------------------------------
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
  // -----------------------------------------------------------------------------------------------
  __impl_toString(visited, next_id, ref_counts) {
    return `'${this.label}'`;
  }
}
// -------------------------------------------------------------------------------------------------
function tok(label) { // convenience constructor
  return new TokenLabel(label);
}
// -------------------------------------------------------------------------------------------------

// -------------------------------------------------------------------------------------------------
// Literal class
// -------------------------------------------------------------------------------------------------
class Literal extends Rule {
  // -----------------------------------------------------------------------------------------------
  constructor(string) {
    super();
    this.string  = string;
  }
  // -----------------------------------------------------------------------------------------------
  __direct_children() {
    return [];
  }
  // -----------------------------------------------------------------------------------------------
  __impl_finalize(indent, visited) {
    // do nothing.
  }
  // -----------------------------------------------------------------------------------------------
  __match(indent, input, index) {
    if (index_is_at_end_of_input(index, input))
      return null;

    if (! input.startsWith(this.string, index))
      return null;

    return new MatchResult(this.string,
                           input,
                           index + this.string.length)
  }
  // -----------------------------------------------------------------------------------------------
  __impl_toString(visited, next_id, ref_counts) {
    return `'${this.string}'`;
  }
}
// -------------------------------------------------------------------------------------------------
function l(first_arg, second_arg) { // convenience constructor
  if (second_arg)
    return new Label(first_arg, new Literal(second_arg));
  
  return new Literal(first_arg);
}
// -------------------------------------------------------------------------------------------------

// -------------------------------------------------------------------------------------------------
// Regex class
// -------------------------------------------------------------------------------------------------
class Regex extends Rule {
  // -----------------------------------------------------------------------------------------------
  constructor(regexp) {
    super();
    this.regexp  = this.#ensure_RegExp_sticky_flag(regexp);
  }
  // -----------------------------------------------------------------------------------------------
  #ensure_RegExp_sticky_flag(regexp) {
    // e.ensure_thing_has_class(RegExp, regexp);

    return regexp.sticky
      ? regexp
      : new RegExp(regexp.source, regexp.flags + 'y');
  }
  // -----------------------------------------------------------------------------------------------
  __direct_children() {
    return [];
  }
  // -----------------------------------------------------------------------------------------------
  __impl_finalize(indent, visited) {
    // do nothing.
  }
  // -----------------------------------------------------------------------------------------------
  __match(indent, input, index) {
    this.regexp.lastIndex = index;

    if (log_match_enabled)
      log(indent, `testing  /${this.regexp.source}/ at char ${index} of ` +
          `'${abbreviate(input.substring(index))}'`); 

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
  // -----------------------------------------------------------------------------------------------
  __impl_toString(visited, next_id, ref_counts) {
    return `/${this.regexp.source}/`;
  }
}
// -------------------------------------------------------------------------------------------------
function r(first_arg, second_arg) { // convenience constructor
  if (second_arg)
    return new Label(first_arg, new Regex(second_arg));
  
  return new Regex(first_arg);
}
// -------------------------------------------------------------------------------------------------

// -------------------------------------------------------------------------------------------------
// ForwardReference class, possibly delete this.
// -------------------------------------------------------------------------------------------------
class ForwardReference {
  // -----------------------------------------------------------------------------------------------
  constructor(func) {
    this.func = func;
  }
  // -----------------------------------------------------------------------------------------------
  __direct_children() {
    return [ this.func() ];
  }
  // -----------------------------------------------------------------------------------------------
  __toString() {
    return "???";
  }
  // -----------------------------------------------------------------------------------------------
  __impl_toString() {
    return "???";
  }
}
// -------------------------------------------------------------------------------------------------
const ref = (func) => new ForwardReference(func);
// -------------------------------------------------------------------------------------------------

// -------------------------------------------------------------------------------------------------
// LabeledValue class
// -------------------------------------------------------------------------------------------------
class LabeledValue {
  // -----------------------------------------------------------------------------------------------
  constructor(label, value) {
    this.label  = label;
    this.value  = value;
  }
  // -----------------------------------------------------------------------------------------------
  __direct_children() {
    return [];
  }
}
// -------------------------------------------------------------------------------------------------

// -------------------------------------------------------------------------------------------------
// MatchResult class
// -------------------------------------------------------------------------------------------------
class MatchResult {
  // -----------------------------------------------------------------------------------------------
  constructor(value, input, index) {
    this.value       = value;
    this.index       = index; // a number.
    this.is_finished = index == input.length; 
  }
  // -----------------------------------------------------------------------------------------------
  __direct_children() {
    return [];
  }
}
// -------------------------------------------------------------------------------------------------

// -------------------------------------------------------------------------------------------------
// helper functions and related vars:
// -------------------------------------------------------------------------------------------------
function compress(str) {
  return str.replace(/\s+/g, ' ');
}
// -------------------------------------------------------------------------------------------------
function abbreviate(str, len = 100) {
  if (str.length < len) {
    return str
  }
  else {
    const bracing_pairs = [
      ['/',  '/'],
      ['(',  ')'],
      ['[',  ']'],
      ['{',  '}'],
      ['<',  '>'],
      ['λ(', ')'],
    ];

    for (const [left, right] of bracing_pairs) {
      if (str.startsWith(left) && str.endsWith(right)) { // special case for regex source strings
        // throw new Error(`bomb ${inspect_fun(str)}`);
        str = str.substring(left.length, len - 3 - right.length);
        const ret = `${left}${str.replace("\n","").trim()}...${right}`;
        // console.log(`re: ${str} =>\n    ${ret}`);
        return ret;
      }
    }
    
    return `${str.substring(0, len - 3).replace("\n","").trim()}...`;
  }
}
// -------------------------------------------------------------------------------------------------
function index_is_at_end_of_input(index, input) {
  return index == input.length
}
// -------------------------------------------------------------------------------------------------
function log(indent, str = "", indent_str = "| ") {
  if (! log_enabled)
    return;

  console.log(`${indent_str.repeat(indent)}${str}`);
}
// -------------------------------------------------------------------------------------------------
function maybe_make_TokenLabel_from_string(thing) {
  if (typeof thing === 'string')
    return new TokenLabel(thing);

  return thing
}
// -------------------------------------------------------------------------------------------------
function maybe_make_RE_or_Literal_from_Regexp_or_string(thing) {
  if (typeof thing === 'string')
    return new Literal(thing);
  else if (thing instanceof RegExp)
    return new Regex(thing);
  else
    return thing;
}
// -------------------------------------------------------------------------------------------------
let make_rule_func = maybe_make_RE_or_Literal_from_Regexp_or_string
// -------------------------------------------------------------------------------------------------
function compose_funs(...fns) {
  return fns.length === 0
    ? x => x
    : pipe_funs(...[...fns].reverse());
}
// -------------------------------------------------------------------------------------------------
function pipe_funs(...fns) {
  if (fns.length === 0)
    return x => x;
  else if (fns.length === 1)
    return fns[0];

  const [head, ...rest] = fns;

  return rest.reduce((acc, fn) => x => fn(acc(x)), head);
}
// =================================================================================================
// END OF GRAMMAR.JS CONTENT SECTION.
// =================================================================================================


// =================================================================================================
// COMMON-GRAMMAR.JS CONTENT SECTION:
// =================================================================================================
// Code in this section originally copy/pasted from the common-grammar.js file in my
// 'jparse' project circa ac2979f but updated since
// 
// Not all of this section is actually used by the wildcards-plus script right 
// now, but it's easier to just copy/paste in the whole file than it is to
// bother working out which parts can be removed and snipping them out, and who
// knows, maybe I'll use more of it in the future.
// 
// Original project at: https://github.com/ariane-emory/jparse/
// =================================================================================================
// Convenient Rules/combinators for common terminals and constructs:
// =================================================================================================
// simple 'words':
const alpha_snake             = r(/[a-zA-Z_]+/);
const lc_alpha_snake          = r(/[a-z_]+/);
const uc_alpha_snake          = r(/[A-Z_]+/);
alpha_snake.abbreviate_str_repr('alpha_snake');
lc_alpha_snake.abbreviate_str_repr('lc_alpha_snake');
uc_alpha_snake.abbreviate_str_repr('uc_alpha_snake');
// -------------------------------------------------------------------------------------------------
// whitespace:
const whites_star        = r(/\s*/);
const whites_plus        = r(/\s+/);
whites_star.__impl_toString = () => 'Whites*';
whites_plus.__impl_toString = () => 'Whites+';
const d_whites_star      = discard(whites_star);
const d_whites_plus      = discard(whites_plus);
// -------------------------------------------------------------------------------------------------
// leading/trailing whitespace:
const lws                = rule => {
  rule = second(seq(whites_star, rule));
  
  rule.__impl_toString = function(visited, next_id, ref_counts) {
    const rule_str = this.rule.elements[1].__toString(visited, next_id, ref_counts);
    return `LWS(${rule_str})`;
  }

  return rule;
};
const tws                = rule => {
  rule = first(seq(rule, whites_star));

  rule.__impl_toString = function(visited, next_id, ref_counts) {
    const rule_str = this.rule.elements[1].__toString(visited, next_id, ref_counts);
    return `TWS(${rule_str})`;
  }
};
// -------------------------------------------------------------------------------------------------
// common numbers:
const udecimal           = r(/\d+\.\d+/);
const urational          = r(/\d+\/[1-9]\d*/);
const uint               = r(/\d+/);
const sdecimal           = r(/[+-]?\d+\.\d+/);
const srational          = r(/[+-]?\d+\/[1-9]\d*/);
const sint               = r(/[+-]?\d+/)
udecimal.__impl_toString = () => 'udecimal';
urational.__impl_toString = () => 'urational';
uint.__impl_toString     = () => 'uint';
sdecimal.__impl_toString = () => 'sdecimal';
srational.__impl_toString = () => 'srational';
sint.__impl_toString = () => 'sint';
// -------------------------------------------------------------------------------------------------
// common separated quantified rules:
const star_comma_sep     = rule => star(rule, /\s*\,\s*/);
const plus_comma_sep     = rule => plus(rule, /\s*\,\s*/);
const star_whites_sep    = rule => star(rule, whites_plus);
const plus_whites_sep    = rule => plus(rule, whites_plus);
// -------------------------------------------------------------------------------------------------
// string-like terminals:
const stringlike         = quote => r(new RegExp(String.raw`${quote}(?:[^${quote}\\]|\\.)*${quote}`));
const dq_string          = stringlike('"');
const sq_string          = stringlike("'");
const triple_dq_string   = r(/"""(?:[^\\]|\\.|\\n)*?"""/);
const raw_dq_string      = r(/r"[^"]*"/);
const template_string    = r(/`(?:[^\\`]|\\.)*`/);
// -------------------------------------------------------------------------------------------------
// keyword helper:
const keyword            = word => {
  if (word instanceof Regex)
    return keyword(word.regexp);

  if (word instanceof RegExp)
    return keyword(word.source);
  
  return r(new RegExp(String.raw(`\b${word}\b`)));
};
// -------------------------------------------------------------------------------------------------
// parenthesis-like terminals:
const lpar               = l('(');
const rpar               = l(')');
const lbrc               = l('{}'[0]); // dumb hack to keep rainbow brackets extension happy.
const rbrc               = l('{}'[1]); 
const lsqr               = l('[]'[0]);
const rsqr               = l('[]'[1]);
const lt                 = l('<');
const gt                 = l('>');
// -------------------------------------------------------------------------------------------------
// common enclosed rules:
const par_enc            = rule => cutting_enc(lpar, rule, rpar);
const brc_enc            = rule => cutting_enc(lbrc, rule, rbrc);
const sqr_enc            = rule => cutting_enc(lsqr, rule, rsqr);
const tri_enc            = rule => cutting_enc(lt,   rule, gt);
// const wse                = rule => enc(whites_star, rule, whites_star);
const wse                = rule => {
  rule = enc(whites_star, rule, whites_star);
  
  rule.__impl_toString = function(visited, next_id, ref_counts) {
    const rule_str = this.body_rule.__toString(visited, next_id, ref_counts);
    return `WSE(${rule_str})`;
  }

  return rule;
};
// -------------------------------------------------------------------------------------------------
// basic arithmetic ops:
const factor_op          = r(/[\/\*\%]/);
const term_op            = r(/[\+\-]/);
// -------------------------------------------------------------------------------------------------
// Pascal-like terminals:
const pascal_assign_op   = l('=');
// -------------------------------------------------------------------------------------------------
// Python-like terminals:
const python_exponent_op = l('**');
const python_logic_word  = r(/and|or|not|xor/);
// -------------------------------------------------------------------------------------------------
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
// -------------------------------------------------------------------------------------------------
// C-like numbers:
const c_bin              = r(/0b[01]/);
const c_char             = r(/'\\?[^\']'/);
const c_hex              = r(/0x[0-9a-f]+/);
const c_ident            = r(/[a-zA-Z_][0-9a-zA-Z_]*/);
const c_octal            = r(/0o[0-7]+/);
const c_sfloat           = r(/[+-]?\d*\.\d+(e[+-]?\d+)?/i);
const c_sint             = sint;
const c_snumber          = choice(c_hex, c_octal, c_sfloat, c_sint);
const c_ufloat           = r(/\d*\.\d+(e[+-]?\d+)?/i);
const c_uint             = uint;
const c_unumber          = choice(c_hex, c_octal, c_ufloat, c_uint);
c_bin                    .abbreviate_str_repr('c_bin');
c_char                   .abbreviate_str_repr('c_char');
c_hex                    .abbreviate_str_repr('c_hex');
c_ident                  .abbreviate_str_repr('c_ident');
c_octal                  .abbreviate_str_repr('c_octal');
c_sfloat                 .abbreviate_str_repr('c_sfloat');
c_sint                   .abbreviate_str_repr('c_sint');
c_snumber                .abbreviate_str_repr('c_snumber');
c_ufloat                 .abbreviate_str_repr('c_ufloat');
c_uint                   .abbreviate_str_repr('c_uint');
// -------------------------------------------------------------------------------------------------
// other C-like terminals:
const c_arith_assign     = r(/\+=|\-=|\*=|\/=|\%=/)
const c_bitwise_and      = l('&');
const c_bitwise_bool_op  = r(/&&|\|\|/);
const c_bitwise_not      = l('~');
const c_bitwise_or       = l('|');
const c_bitwise_xor      = caret; 
const c_bool             = choice('true', 'false');
const c_ccomparison_op   = r(/<=?|>=?|[!=]/);
const c_incr_decr        = r(/\+\+|--/);
const c_shift            = r(/<<|>>/);
const c_shift_assign     = r(/<<=|>>=/);
const c_unicode_ident    = r(/[\p{L}_][\p{L}\p{N}_]*/u);
c_arith_assign           .abbreviate_str_repr('c_arith_assign');
c_bitwise_and            .abbreviate_str_repr('c_bitwise_and');
c_bitwise_bool_op        .abbreviate_str_repr('c_bitwise_bool_ops');
c_bitwise_not            .abbreviate_str_repr('c_bitwise_not');
c_bitwise_or             .abbreviate_str_repr('c_bitwise_or');
c_bitwise_xor            .abbreviate_str_repr('c_bitwise_xor');
c_bool                   .abbreviate_str_repr('c_bool');
c_ccomparison_op         .abbreviate_str_repr('c_ccomparison_op');
c_incr_decr              .abbreviate_str_repr('c_incr_decr');
c_shift                  .abbreviate_str_repr('c_shift');
c_shift_assign           .abbreviate_str_repr('c_shift_assign');
c_unicode_ident          .abbreviate_str_repr('c_unicode_ident');
// -------------------------------------------------------------------------------------------------
// dotted chains:
const dot_chain          = rule => plus(rule, dot); 
// -------------------------------------------------------------------------------------------------
// common comment styles:
const c_block_comment    = r(/\/\*[^]*?\*\//);
const c_comment          = choice(() => c_line_comment,
                                  () => c_block_comment);
const c_line_comment     = r(/\/\/[^\n]*/);
const py_line_comment    = r(/#[^\n]*/); 
c_block_comment          .abbreviate_str_repr('c_block_comment');
c_comment                .abbreviate_str_repr('c_comment');
c_line_comment           .abbreviate_str_repr('c_line_comment');
py_line_comment          .abbreviate_str_repr('py_line_comment');
// -------------------------------------------------------------------------------------------------
// ternary helper combinator:
const ternary            =
      ((cond_rule, then_rule = cond_rule, else_rule = then_rule) =>
        xform(seq(cond_rule, question, then_rule, colon, else_rule),
              arr => [ arr[0], arr[2], arr[4] ]));
// -------------------------------------------------------------------------------------------------
// misc unsorted Rules:
const kebab_ident = r(/[a-z]+(?:-[a-z0-9]+)*/);
kebab_ident.abbreviate_str_repr('kebab_ident');
// -------------------------------------------------------------------------------------------------
// C-like function calls:
const c_funcall = (fun_rule, arg_rule, open = '(', close = ')', sep = ',') =>
      seq(fun_rule,
          wst_cutting_enc(open,
                          wst_star(arg_rule, sep),
                          close));
// -------------------------------------------------------------------------------------------------
// whitespace tolerant combinators:
// -------------------------------------------------------------------------------------------------
const __make_wst_quantified_combinator = base_combinator => 
      ((rule, sep = null) => base_combinator(wse(rule), sep));
const __make_wst_quantified_combinator_alt = base_combinator =>
      ((rule, sep = null) =>
        lws(base_combinator(tws(rule),
                            sep ? seq(sep, whites_star) : null)));
const __make_wst_seq_combinator = base_combinator =>
      //      (...rules) => tws(base_combinator(...rules.map(x => lws(x))));
      (...rules) => base_combinator(...rules.map(x => lws(x)));
// -------------------------------------------------------------------------------------------------
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
// -------------------------------------------------------------------------------------------------
// convenience combinators:
// -------------------------------------------------------------------------------------------------
const push            = ((value, rule) =>
  xform(rule, arr => [value, ...arr]));
const enclosing       = (left, enclosed, right) =>
      xform(arr => [ arr[0], arr[2] ], seq(left, enclosed, right)); 
// =================================================================================================
// END of COMMON-GRAMMAR.JS CONTENT SECTION.
// =================================================================================================


// =================================================================================================
// BASIC JSON GRAMMAR SECTION:
// =================================================================================================
// JSON ← S? ( Object / Array / String / True / False / Null / Number ) S?
const json = choice(() => JsonObject,  () => JsonArray,
                    () => json_string, () => json_true,   () => json_false,
                    () => json_null,   () => json_number);
// Object ← "{" ( String ":" JSON ( "," String ":" JSON )*  / S? ) "}"
const JsonObject = xform(arr =>  Object.fromEntries(arr), 
                         wst_cutting_enc('{',
                                         wst_star(
                                           xform(arr => [arr[0], arr[2]],
                                                 wst_seq(() => json_string, ':', json)),
                                           ','),
                                         '}'));
// Array ← "[" ( JSON ( "," JSON )*  / S? ) "]"
const JsonArray = wst_cutting_enc('[', wst_star(json, ','), ']');
// String ← S? ["] ( [^ " \ U+0000-U+001F ] / Escape )* ["] S?
const json_string = xform(JSON.parse,
                          /"(?:[^"\\\u0000-\u001F]|\\["\\/bfnrt]|\\u[0-9a-fA-F]{4})*"/);
// UnicodeEscape ← "u" [0-9A-Fa-f]{4}
const json_unicodeEscape = r(/u[0-9A-Fa-f]{4}/);
// Escape ← [\] ( [ " / \ b f n r t ] / UnicodeEscape )
const json_escape = seq('\\', choice(/["\\/bfnrt]/, json_unicodeEscape));
// True ← "true"
const json_true = xform(x => true, 'true');
// False ← "false"
const json_false = xform(x => false, 'false');
// Null ← "null"
const json_null = xform(x => null, 'null');
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
  const number          = multiplier * ((integer_part + fractional_part)**exponent);

  // console.log(`ARR: ${inspect_fun(arr)}`);
  return number;
  // return arr;
};
const json_number = xform(reify_json_number,
                          seq(optional(json_minus),
                              xform(parseInt, json_integralPart), 
                              xform(arr => {
                                // console.log(`fractional part ARR: ${inspect_fun(arr)}`);
                                return parseFloat(arr[0]);
                              }, optional(json_fractionalPart, 0.0)),
                              xform(parseInt, first(optional(json_exponentPart, 1)))));
// S ← [ U+0009 U+000A U+000D U+0020 ]+
const json_S = whites_plus;
JsonObject.abbreviate_str_repr('JsonObject');
JsonArray.abbreviate_str_repr('JsonArray');
json_string.__impl_toString = () => 'json_string';
json_unicodeEscape.abbreviate_str_repr('json_unicodeEscape');
json_escape.abbreviate_str_repr('json_escape');
json_true.abbreviate_str_repr('json_true');
json_false.abbreviate_str_repr('json_false');
json_null.abbreviate_str_repr('json_null');
json_minus.abbreviate_str_repr('json_minus');
json_integralPart.abbreviate_str_repr('json_integralPart');
json_fractionalPart.abbreviate_str_repr('json_fractionalPart');
json_exponentPart.abbreviate_str_repr('json_exponentPart');
json_number.abbreviate_str_repr('json_number');
json_S.abbreviate_str_repr('json_S');
// -------------------------------------------------------------------------------------------------
json.finalize(); // .finalize-ing resolves the thunks that were used the in json and JsonObject for forward references to not-yet-defined rules.
// =================================================================================================
// END OF BASIC JSON GRAMMAR SECTION.
// =================================================================================================


// =================================================================================================
// JSONC GRAMMAR SECTION:
// =================================================================================================
const jsonc_comments = wst_star(choice(c_block_comment, c_line_comment));
const Jsonc = second(wst_seq(jsonc_comments,
                             choice(() => JsoncObject,  () => JsoncArray,
                                    () => json_string,  () => json_true, () => json_false,
                                    () => json_null,    () => json_number),
                             jsonc_comments));
const JsoncArray =
      wst_cutting_enc('[',
                      wst_star(second(seq(jsonc_comments,
                                          Jsonc,
                                          jsonc_comments)),
                               ','),
                      ']');
const JsoncObject =
      choice(
        xform(arr => ({}), wst_seq('{', '}')),
        xform(arr => {
          // console.log(`\nARR:  ${JSON.stringify(arr, null, 2)}`);
          const new_arr = [ [arr[0], arr[2] ], ...(arr[4][0]??[]) ];
          // console.log(`ARR2: ${JSON.stringify(arr2, null, 2)}`);
          return Object.fromEntries(new_arr);
        },
              wst_cutting_seq(
                wst_enc('{}'[0], () => json_string, ":"), // dumb hack for rainbow brackets sake
                jsonc_comments,
                Jsonc,
                jsonc_comments,
                optional(second(wst_seq(',',
                                        wst_star(
                                          xform(arr =>  [arr[1], arr[5]],
                                                wst_seq(jsonc_comments,
                                                        () => json_string,
                                                        jsonc_comments,
                                                        ':',
                                                        jsonc_comments,
                                                        Jsonc, 
                                                        jsonc_comments
                                                       ))             
                                          , ',')),
                               )),
                '{}'[1]))); // dumb hack for rainbow brackets sake
jsonc_comments.abbreviate_str_repr('jsonc_comments');
JsoncArray.abbreviate_str_repr('JsoncArray');
JsoncObject.abbreviate_str_repr('JsoncObject');
// -------------------------------------------------------------------------------------------------
Jsonc.finalize(); 
// =================================================================================================
// END OF JSONC GRAMMAR SECTION.
// =================================================================================================


// =================================================================================================
// 'relaxed' JSONC GRAMMAR SECTION: JSONC but with relaxed key quotation.
// =================================================================================================
const rJsonc = second(wst_seq(jsonc_comments,
                              choice(() => rJsoncObject,  () => JsoncArray,
                                     () => json_string,   () => json_true, () => json_false,
                                     () => json_null,     () => json_number),
                              jsonc_comments));
const rJsoncObject =
      choice(
        xform(arr => ({}), wst_seq('{', '}')),
        xform(arr => {
          const new_arr = [ [arr[0], arr[2]], ...(arr[4][0]??[]) ];
          return Object.fromEntries(new_arr);
        },
              wst_cutting_seq(
                wst_enc('{}'[0], () => choice(json_string, c_ident), ":"), // dumb hack for rainbow brackets sake
                jsonc_comments,
                Jsonc,
                jsonc_comments,
                optional(second(wst_seq(',',
                                        wst_star(
                                          xform(arr =>  [arr[1], arr[5]],
                                                wst_seq(jsonc_comments,
                                                        choice(json_string, c_ident),
                                                        jsonc_comments,
                                                        ':',
                                                        jsonc_comments,
                                                        Jsonc, 
                                                        jsonc_comments
                                                       ))             
                                          , ',')),
                               )),
                '{}'[1]))); // dumb hack for rainbow brackets sake
rJsoncObject.abbreviate_str_repr('rJsoncObject');
// -------------------------------------------------------------------------------------------------
rJsonc.finalize(); 
// =================================================================================================
// END OF 'relaxed' JSONC GRAMMAR SECTION.
// =================================================================================================


// =================================================================================================
// WeightedPicker CLASS AND RELATED VARS:
// =================================================================================================
const always = () => true;
const never  = () => false;
const picker_priority = Object.freeze({
  avoid_repetition_short:        'Avoiding repetition (short term only)',
  avoid_repetition_long:         'Avoiding repetition', 
  ensure_weighted_distribution:  'Ensuring a weighted distribution',
  true_randomness:               'Just plain old randomness',
});
const picker_priority_names        = Object.entries(picker_priority).map(([k, v]) => k);
const picker_priority_descriptions = Object.entries(picker_priority).map(([k, v]) => v);
// const picker_priority_descriptions_to_names = new Map(
//   Object.entries(picker_priority).map(([k, v]) => [v, k])
// );
// -------------------------------------------------------------------------------------------------
class WeightedPicker {
  // -----------------------------------------------------------------------------------------------
  constructor(initialOptions = []) {
    // console.log(`CONSTRUCT WITH ${JSON.stringify(initialOptions)}`);
    
    this.options = []; // array of [weight, value]
    this.used_indices = new Map();
    this.last_pick_index = null;

    for (const [weight, value] of initialOptions)
      this.add(weight, value);
  }
  // -----------------------------------------------------------------------------------------------
  add(weight, value) {
    if (! value instanceof ASTAnonWildcardAlternative)
      throw new Error(`bad value: ${inspect_fun(value)}`);
    
    this.options.push({weight: weight, value: value });
  }
  // -----------------------------------------------------------------------------------------------
  __record_index_usage(index) {
    this.used_indices.set(index, (this.used_indices.get(index)??0) + 1);
    this.last_pick_index = index;
  }
  // -----------------------------------------------------------------------------------------------
  pick(min_count = 1, max_count = min_count,
       allow_if = always, forbid_if = never,
       priority = null) {
    if (! priority)
      throw new Error("no priority");

    if ((min_count > 1 || max_count > 1) && 
        priority === picker_priority.avoid_repetition_short)
      this.__clear_used_indices();
    
    if (log_picker_enabled)
      console.log(`PICK ${min_count}-${max_count}`);
    
    const count = Math.floor(Math.random() * (max_count - min_count + 1)) + min_count;
    const res = [];
    
    for (let ix = 0; ix < count; ix++)
      res.push(this.pick_one(allow_if, forbid_if, priority));

    if (log_picker_enabled)
      console.log(`PICKED ITEMS: ${inspect_fun(res)}`);

    return res;
  }
  // -----------------------------------------------------------------------------------------------
  __gather_legal_option_indices(allow_if, forbid_if) {
    const legal_option_indices = [];
    
    for (let ix = 0; ix < this.options.length; ix++) {
      const option = this.options[ix];
      
      if (option.weight !== 0 &&
          allow_if(option.value) &&
          !forbid_if(option.value))
        legal_option_indices.push(ix);
    }

    return legal_option_indices;
  }
  // -----------------------------------------------------------------------------------------------
  __clear_used_indices() {
    this.used_indices.clear();
    this.last_pick_index = null;

    if (log_picker_enabled)
      console.log(`AFTER __clear: ${inspect_fun(this.used_indices)}`);
  }
  // -----------------------------------------------------------------------------------------------  
  __indices_are_exhausted(option_indices, priority) {
    if (log_picker_enabled) {
      console.log(`this.options      = ${inspect_fun(this.options)}`);
      console.log(`this.used_indices = ${inspect_fun(this.used_indices)}`);
    }
    
    if (! priority)
      throw new Error(`missing arg: ${inspect_fun(arguments)}`);

    if (this.used_indices.size == 0)
      return false;

    let exhausted_indices = null;
    
    if (priority === picker_priority.avoid_repetition_long ||
        priority === picker_priority.avoid_repetition_short) {
      exhausted_indices = new Set(this.used_indices.keys());
    }
    else if (priority == picker_priority.ensure_weighted_distribution) {
      exhausted_indices = new Set();

      for (const [used_index, usage_count] of this.used_indices) {
        const option = this.options[used_index];

        if (usage_count >= option.weight)
          exhausted_indices.add(used_index);
      }
    }
    else if (priority === picker_priority.true_randomness) {
      return false;
    }
    else {
      throw new Error(`bad priority: ${inspect_fun(priority)}`);
    }
    
    return exhausted_indices.isSupersetOf(new Set(option_indices));
  }
  // -----------------------------------------------------------------------------------------------
  __effective_weight(option_index, priority) {
    if (! ((option_index || option_index === 0) && priority))
      throw new Error(`missing arg: ${inspect_fun(arguments)}`);
    
    let ret = null;
    
    if (priority === picker_priority.avoid_repetition_long ||
        priority === picker_priority.avoid_repetition_short) {
      ret = this.used_indices.has(option_index) ? 0 : this.options[option_index].weight;
    }
    else if (priority === picker_priority.ensure_weighted_distribution) {
      ret = this.options[option_index].weight - (this.used_indices.get(option_index) ?? 0);
    }
    else if (priority === picker_priority.true_randomness) {
      ret = this.options[option_index].weight;
    }
    else {
      throw Error("unexpected priority");
    }

    if (log_picker_enabled)
      console.log(`RET IS ${typeof ret} ${inspect_fun(ret)}`);
    
    return Math.max(0, ret);
  };
  // -----------------------------------------------------------------------------------------------
  pick_one(allow_if, forbid_if, priority) {
    if (log_picker_enabled) {
      console.log(`PICK ONE =================================================================================`);
      console.log(`PRIORITY        = ${inspect_fun(priority)}`);
      console.log(`USED_INDICES    = ${inspect_fun(this.used_indices)}`);
      console.log(`LAST_PICK_INDEX = ${inspect_fun(this.last_pick_index)}`);
    }
    
    if (! (priority && allow_if && forbid_if))
      throw new Error(`missing arg: ${inspect_fun(arguments)}`);

    if (log_picker_enabled) {
      console.log(`PICK_ONE!`);
      console.log(`PICK FROM ${JSON.stringify(this)}`);
    }

    if (this.options.length === 0) {
      if (log_picker_enabled)
        console.log(`PICK_ONE: NO OPTIONS 1!`);
      
      return null;
    }

    let legal_option_indices = this.__gather_legal_option_indices(allow_if, forbid_if);
    
    if (this.__indices_are_exhausted(legal_option_indices, priority)) {
      if (log_picker_enabled)
        console.log(`PICK_ONE: CLEARING ${inspect_fun(this.used_indices)}!`);
      
      if (priority === picker_priority.avoid_repetition_long) {
        if (this.last_pick_index !== null) {
          const last_pick_index = this.last_pick_index;
          this.__clear_used_indices();
          this.__record_index_usage(last_pick_index);
        }
        else /* ensure_weighted_distribution, true_randomness */ {
          this.__clear_used_indices();
        }
      }
      else {
        this.__clear_used_indices();
      }

      if (log_picker_enabled)
        console.log(`AFTER CLEARING: ${inspect_fun(this.used_indices)}`);
      
      legal_option_indices = this.__gather_legal_option_indices(allow_if, forbid_if);
    }
    
    if (legal_option_indices.length === 0) {
      if (log_picker_enabled)
        console.log(`PICK_ONE: NO LEGAL OPTIONS 2!`);

      return null;
    }

    if (legal_option_indices.length === 1) {
      if (log_picker_enabled)
        console.log(`only one legal option in ${inspect_fun(legal_option_indices)}!`);
      
      this.__record_index_usage(legal_option_indices[0]);

      if (log_picker_enabled)
        console.log(`BEFORE BAIL 2: ${inspect_fun(this.used_indices)}`);
      
      return this.options[legal_option_indices[0]].value;
    }

    if (log_picker_enabled)
      console.log(`pick from ${legal_option_indices.length} legal options ${inspect_fun(legal_option_indices)}`);

    let total_weight = 0;

    if (log_picker_enabled)
      console.log(`BEFORE TOTAL_WEIGHT, ${priority}: ${inspect_fun(this.used_indices)}`);
    
    for (const legal_option_ix of legal_option_indices) {
      const adjusted_weight = this.__effective_weight(legal_option_ix, priority);

      if (log_picker_enabled) {
        console.log(`effective weight of option #${legal_option_ix} = ${adjusted_weight}`);
        console.log(`COUNTING ${inspect_fun(this.options[legal_option_ix])} = ${adjusted_weight}`);
        console.log(`ADJUSTED BY ${adjusted_weight}, ${priority}`);
      }
      
      total_weight += adjusted_weight;
    }

    // Since we now avoid adding options with a weight of 0, this should never be true:
    if (total_weight === 0) {
      throw new Error(`PICK_ONE: TOTAL WEIGHT === 0, this should not happen? ` +
                      `legal_options = ${JSON.stringify(legal_option_indices.map(ix =>
                                                   [
                                                     ix,
                                                     this.__effective_weight(ix, priority),
                                                     this.options[ix]
                                                   ]
                                                 ), null, 2)}, ` +
                      `used_indices = ${JSON.stringify(this.used_indices, null, 2)}`);
    }
    
    let random = Math.random() * total_weight;

    if (log_picker_enabled) {
      console.log(`----------------------------------------------------------------------------------`);
      console.log(`RANDOM IS ${random}`);
      console.log(`TOTAL_WEIGHT IS ${total_weight}`);
      console.log(`USED_INDICES ARE ${inspect_fun(this.used_indices)}`);
    }
    
    for (const legal_option_ix of legal_option_indices) {
      const option          = this.options[legal_option_ix];
      const adjusted_weight = this.__effective_weight(legal_option_ix, priority);

      if (adjusted_weight === 0)
        continue;
      
      if (log_picker_enabled)
        console.log(`ADJUSTED_WEIGHT OF ${JSON.stringify(option)} IS ${adjusted_weight}`);
      
      if (random < adjusted_weight) {
        this.__record_index_usage(legal_option_ix);
        return option.value;
      }

      random -= adjusted_weight;
    }

    throw new Error("random selection failed");
  }
}
// =================================================================================================
// END OF WeightedPicker CLASS AND RELATED VARS.
// =================================================================================================


// =================================================================================================
// MISCELLANEOUS HELPER FUNCTIONS SECTION:
// =================================================================================================
// DT's JavaScriptCore env doesn't seem to have structuredClone, so we'll define our own version:
// -------------------------------------------------------------------------------------------------
function structured_clone(value, {
  seen = new WeakMap(),           // For shared reference reuse
  ancestors = new WeakSet(),      // For cycle detection
  unshare = false
} = {}) {
  if (value === null || typeof value !== "object")
    return value;

  if (ancestors.has(value))
    throw new TypeError("Cannot clone cyclic structure");
  
  if (!unshare && seen.has(value))
    return seen.get(value);

  ancestors.add(value); // Add to call stack tracking

  let clone;

  if (Array.isArray(value)) {
    clone = [];

    if (!unshare)
      seen.set(value, clone);

    for (const item of value) 
      clone.push(structured_clone(item, { seen, ancestors, unshare }));
  }
  else if (value instanceof Set) {
    clone = new Set();

    if (!unshare)
      seen.set(value, clone);

    for (const item of value) 
      clone.add(structured_clone(item, { seen, ancestors, unshare }));    
  }
  else if (value instanceof Map) {
    clone = new Map();

    if (!unshare)
      seen.set(value, clone);
    
    for (const [k, v] of value.entries()) 
      clone.set(structured_clone(k, { seen, ancestors, unshare }),
                structured_clone(v, { seen, ancestors, unshare }));
    
  }
  else if (value instanceof Date) {
    clone = new Date(value);
  }
  else if (value instanceof RegExp) {
    clone = new RegExp(value);
  }
  else {
    clone = {};

    if (!unshare)
      seen.set(value, clone);

    for (const key of Object.keys(value)) 
      clone[key] = structured_clone(value[key], { seen, ancestors, unshare });
  }

  ancestors.delete(value); // Cleanup recursion tracking

  return clone;
}
// -------------------------------------------------------------------------------------------------
if (test_structured_clone) {
  const shared = { msg: "hi" };
  let obj = { a: shared, b: shared };
  // test #1: preserve shared references, this one seems to work:
  {
    const clone = structured_clone(obj);

    if (clone.a !== clone.b)
      throw new Error(`${inspect_fun(clone.a)} !== ${inspect_fun(clone.b)}`);

    console.log(`test #1 succesfully cloned object ${inspect_fun(obj)}`);
  }
  // test #2: break shared references (unshare), this one seems to work:
  {
    const clone = structured_clone(obj, { unshare: true });

    if (clone.a === clone.b)
      throw new Error(`${inspect_fun(clone.a)} === ${inspect_fun(clone.b)}`);

    console.log(`test #2 succesfully cloned object ${inspect_fun(obj)}`);
  }
  // test #4: should fail do to cycle, with unshare = false:
  try {
    obj = {};
    obj.self = obj; // Create a cycle
    structured_clone(obj);

    // If we get here, no error was thrown = fail
    throw new Error(`test #3 should have failed.`);
  } catch (err) {
    if (err.message === 'test #3 should have failed.')
      throw err;
    else 
      console.log(`test #3 failed as intended.`);
  }
  // test #4: should fail do to cycle, with unshare = true:
  try {
    obj = {};
    obj.self = obj; // Create a cycle
    structured_clone(obj, { unshare: true }); 

    throw new Error(`test #4 should have failed.`);
  } catch (err) {
    if (err.message === 'test #4 should have failed.') 
      throw err;
    else
      console.log(`test #3 failed as intended.`);
  }
}
// -------------------------------------------------------------------------------------------------
function arr_is_prefix_of_arr(prefix_arr, full_arr) {
  if (prefix_arr.length > full_arr.length)
    return false;

  for (let ix = 0; ix < prefix_arr.length; ix++)
    if (prefix_arr[ix] !== full_arr[ix])
      return false;
  
  return true;
}
// -------------------------------------------------------------------------------------------------
function is_empty_object(obj) {
  return obj && typeof obj === 'object' &&
    Object.keys(obj).length === 0 &&
    obj.constructor === Object;
}
// -------------------------------------------------------------------------------------------------
function rand_int(x, y) {
  y ||= x;
  const min = Math.min(x, y);
  const max = Math.max(x, y);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
// -------------------------------------------------------------------------------------------------
function pretty_list(arr) {
  const items = arr.map(String); // Convert everything to strings like "null" and 7 → "7"

  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;

  const ret = `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
  
  return ret;
}
// -------------------------------------------------------------------------------------------------
function capitalize(string) {
  // console.log(`Capitalizing ${typeof string} ${inspect_fun(string)}`);
  return string.charAt(0).toUpperCase() + string.slice(1);
}
// -------------------------------------------------------------------------------------------------
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
// -------------------------------------------------------------------------------------------------
function unescape(str) {
  if (typeof str !== 'string')
    return str;
  
  return str
    .replace(/\\n/g,   '\n')
    .replace(/\\ /g,   ' ')
    .replace(/\\(.)/g, '$1')
};
// -------------------------------------------------------------------------------------------------
function smart_join(arr) {
  if (! arr)
    return arr;
  
  if (typeof arr === 'string')
    return arr;
  
  arr = [...arr.flat(Infinity).filter(x=> x)];

  if (arr.length === 0) // investigate why this is necessary.
    return '';
  
  if (log_smart_join_enabled)
    console.log(`JOINING ${inspect_fun(arr)}`);

  // const vowelp       = (ch)  => "aeiou".includes(ch.toLowerCase()); 
  const punctuationp = (ch)  => "_-,.?!;:".includes(ch);
  const linkingp     = (ch)  => "_-".includes(ch);
  // const whitep       = (ch)  => " \n".includes(ch);
  
  // handle "a" → "an" if necessary:
  const articleCorrection = (originalArticle, nextWord) => {
    const expected = choose_indefinite_article(nextWord);
    if (originalArticle.toLowerCase() === 'a' && expected === 'an') {
      return originalArticle === 'A' ? 'An' : 'an';
    }
    return originalArticle;
  };
  
  let left_word = arr[0]; // ?.toString() ?? "";
  let str       = left_word;
  
  for (let ix = 1; ix < arr.length; ix++)  {
    let right_word           = null;
    let prev_char            = null;
    let prev_char_is_escaped = null;
    let next_char_is_escaped = null;
    let next_char            = null;

    const add_a_space = () => {
      if (log_smart_join_enabled)
        console.log(`SPACE!`);

      prev_char  = ' ';
      str       += ' ';
    }

    const chomp_left_side = () => {
      if (log_smart_join_enabled)
        console.log(`CHOMP LEFT!`);
      
      str      = str.slice(0, -1);
      left_word = left_word.slice(0, -1);
      
      update_pos_vars();
    };
    
    const chomp_right_side = () => {
      if (log_smart_join_enabled)
        console.log(`CHOMP RIGHT!`);

      arr[ix] = arr[ix].slice(1);

      update_pos_vars();
    }

    const consume_right_word = () => {
      if (log_smart_join_enabled)
        console.log(`CONSUME ${inspect_fun(right_word)}!`);

      left_word  = right_word;
      str       += left_word;
    }

    const move_chars_left = (n) => {
      if (log_smart_join_enabled)
        console.log(`SHIFT ${n} CHARACTERS!`);

      const overcut     = str.endsWith('\\...') ? 0 : str.endsWith('...') ? 3 : 1; 
      const shifted_str = right_word.substring(0, n);

      arr[ix]   = right_word.substring(n);
      str       = str.substring(0, str.length - overcut) + shifted_str;
      left_word = left_word.substring(0, left_word.length - overcut) + shifted_str;
      
      update_pos_vars();
    };
    
    const update_pos_vars = () => {
      right_word           = arr[ix]; // ?.toString() ?? "";
      prev_char            = left_word[left_word.length - 1] ?? "";
      prev_char_is_escaped = left_word[left_word.length - 2] === '\\';
      next_char            = right_word[0] ?? '';
      next_char_is_escaped = right_word[0] === '\\';

      if (log_smart_join_enabled)
        console.log(`ix = ${inspect_fun(ix)}, ` +
                    `str = ${inspect_fun(str)}, ` +
                    `left_word = ${inspect_fun(left_word)}, ` +         
                    `right_word = ${inspect_fun(right_word)}, ` +       
                    `prev_char = ${inspect_fun(prev_char)}, ` +         
                    `next_char = ${inspect_fun(next_char)}, ` + 
                    `prev_char_is_escaped = ${prev_char_is_escaped}. ` + 
                    `next_char_is_escaped = ${next_char_is_escaped}`);
    };
    
    update_pos_vars();
    
    if (right_word === '') {
      if (log_smart_join_enabled)
        console.log(`JUMP EMPTY!`);

      continue;
    }

    while  (",.!?".includes(prev_char) && right_word.startsWith('...'))
      move_chars_left(3);
    
    while (",.!?".includes(prev_char) && next_char && ",.!?".includes(next_char))
      move_chars_left(1);
    
    // Normalize article if needed:
    const article_match = str.match(/(?:^|\s)([Aa])$/);
    
    if (article_match) {
      const originalArticle = article_match[1];
      const updatedArticle = articleCorrection(originalArticle, right_word);

      if (updatedArticle !== originalArticle) 
        str = str.slice(0, -originalArticle.length) + updatedArticle;
    }

    let chomped = false;

    if (!prev_char_is_escaped && prev_char === '<') {
      chomp_left_side();
      chomped = true;
    }
    
    if (right_word.startsWith('<')) {
      chomp_right_side();
      chomped = true;
    }

    if (right_word === '') {
      if (log_smart_join_enabled)
        console.log(`JUMP EMPTY (LATE)!`);

      continue;
    }

    if (!chomped &&
        (prev_char_is_escaped && !' n'.includes(prev_char) || 
         (!(prev_char_is_escaped && ' n'.includes(prev_char)) &&
          // !(next_char_is_escaped && ",.!?".includes(right_word[1])) && 
          !right_word.startsWith('\\n') &&
          !right_word.startsWith('\\ ') && 
          !punctuationp (next_char)     && 
          !linkingp     (prev_char)     &&
          !linkingp     (next_char)     &&
          !'([])'.substring(0,2).includes(prev_char) && // dumb hack for rainbow brackets' sake
          !'([])'.substring(2,4).includes(next_char))))
      add_a_space();

    consume_right_word();
  }

  if (log_smart_join_enabled)
    console.log(`JOINED ${inspect_fun(str)}`);
  
  return str;
}
// =================================================================================================
// END OF MISCELLANEOUS HELPER FUNCTIONS SECTION.
// =================================================================================================


// =================================================================================================
// HELPER FUNCTIONS/VARS FOR DEALING WITH DIFFERING KEY NAMES BETWEEN DT AND A1111,
// =================================================================================================
// these are used by the context.munge_configuration() method and some walk cases.
// var values adapted from the file config.fbs in
// https://github.com/drawthingsai/draw-things-community.git circa 7aef74d:
// ----------------------------------------------------------------------------------------------------
const dt_samplers = [   // order is significant, do not rearrange!
  'DPM++ 2M Karras',    // 0
  'Euler a',            // 1
  'DDIM',               // 2
  'PLMS',               // 3
  'DPM++ SDE Karras',   // 4
  'UniPC',              // 5
  'LCM',                // 6
  'Euler A Substep',    // 7
  'DPM++ SDE Substep',  // 8
  'TCD',                // 9
  'Euler A Trailing',   // 10
  'DPM++ SDE Trailing', // 11
  'DPM++ 2M AYS',       // 12
  'Euler A AYS',        // 13
  'DPM++ SDE AYS',      // 14
  'DPM++ 2M Trailing',  // 15
  'DDIM Trailing',      // 16
];
const dt_samplers_caps_correction = new Map(dt_samplers.map(s => [ s.toLowerCase(), s ]));
// -------------------------------------------------------------------------------------------------
const configuration_key_names = [
  // [ dt_name, automatic1111_name ],
  // -----------------------------------------------------------------------------------------------
  // identical keys:
  // -----------------------------------------------------------------------------------------------
  { dt_name: 'controls',                          automatic1111_name: 'controls'                                   },
  { dt_name: 'fps',                               automatic1111_name: 'fps'                                        },
  { dt_name: 'height',                            automatic1111_name: 'height'                                     },
  { dt_name: 'loras',                             automatic1111_name: 'loras'                                      },
  { dt_name: 'model',                             automatic1111_name: 'model'                                      },
  { dt_name: 'prompt',                            automatic1111_name: 'prompt'                                     },
  { dt_name: 'sampler',                           automatic1111_name: 'sampler',
    shorthands: ['sampler_index', 'sampler_name',                                                                ] },
  { dt_name: 'seed',                              automatic1111_name: 'seed'                                       },
  { dt_name: 'sharpness',                         automatic1111_name: 'sharpness'                                  },
  { dt_name: 'shift',                             automatic1111_name: 'shift'                                      },
  { dt_name: 'strength',                          automatic1111_name: 'strength'                                   },
  { dt_name: 'steps',                             automatic1111_name: 'steps'                                      },
  { dt_name: 'width',                             automatic1111_name: 'width'                                      },
  { dt_name: 'upscaler',                          automatic1111_name: 'upscaler'                                   },
  // -----------------------------------------------------------------------------------------------
  // differing keys:
  // -----------------------------------------------------------------------------------------------
  { dt_name: 'aestheticScore',                    automatic1111_name: 'aesthetic_score'                            },
  { dt_name: 'batchCount',                        automatic1111_name: 'batch_count'                                },
  { dt_name: 'batchCount',                        automatic1111_name: 'n_iter'                                     },
  { dt_name: 'batchSize',                         automatic1111_name: 'batch_size'                                 },
  { dt_name: 'clipLText',                         automatic1111_name: 'clip_l_text',
    shorthands: [ 'clip_l', 'clipl' ] },
  { dt_name: 'clipSkip',                          automatic1111_name: 'clip_skip'                                  },
  { dt_name: 'clipWeight',                        automatic1111_name: 'clip_weight'                                },
  { dt_name: 'cropLeft',                          automatic1111_name: 'crop_left'                                  },
  { dt_name: 'cropTop',                           automatic1111_name: 'crop_top'                                   },
  { dt_name: 'decodingTileHeight',                automatic1111_name: 'decoding_tile_height' /* _explanation' */   },
  { dt_name: 'decodingTileOverlap',               automatic1111_name: 'decoding_tile_overlap' /* _explanation' */  },
  { dt_name: 'decodingTileWidth',                 automatic1111_name: 'decoding_tile_width' /* _explanation' */    },
  { dt_name: 'diffusionTileHeight',               automatic1111_name: 'diffusion_tile_height' /* _explanation' */  },
  { dt_name: 'diffusionTileOverlap',              automatic1111_name: 'diffusion_tile_overlap' /* _explanation' */ },
  { dt_name: 'diffusionTileWidth',                automatic1111_name: 'diffusion_tile_width' /* _explanation' */   },
  { dt_name: 'guidanceEmbed',                     automatic1111_name: 'guidance_embed'                             },
  { dt_name: 'guidanceScale',                     automatic1111_name: 'cfg_scale',
    shorthands: [ 'guidance',                                                                                    ] },
  { dt_name: 'guidingFrameNoise',                 automatic1111_name: 'cond_aug'                                   },
  { dt_name: 'hiresFix',                          automatic1111_name: 'high_resolution_fix',
    shorthands: [ 'enable_hr',                                                                                   ] },
  { dt_name: 'hiresFixHeight',                    automatic1111_name: 'hires_first_pass_height_explanation',
    shorthands: [ 'firstphase_height',                                                                           ] },
  { dt_name: 'hiresFixStrength',                  automatic1111_name: 'hires_second_pass_strength_detail'          },
  { dt_name: 'hiresFixWidth',                     automatic1111_name: 'hires_first_pass_width_explanation',
    shorthands: [ 'firstphase_width',                                                                            ] },
  { dt_name: 'imageGuidanceScale',                automatic1111_name: 'image_guidance'                             },
  { dt_name: 'imagePriorSteps',                   automatic1111_name: 'image_prior_steps'                          },
  { dt_name: 'maskBlur',                          automatic1111_name: 'mask_blur'                                  },
  { dt_name: 'maskBlurOutset',                    automatic1111_name: 'mask_blur_outset'                           },
  { dt_name: 'motionScale',                       automatic1111_name: 'motion_scale'                               },
  { dt_name: 'negativeAestheticScore',            automatic1111_name: 'negative_aesthetic_score'                   },
  { dt_name: 'negativeOriginalHeight',            automatic1111_name: 'negative_original_height'                   },
  { dt_name: 'negativeOriginalWidth',             automatic1111_name: 'negative_original_width'                    },
  { dt_name: 'negativePrompt',                    automatic1111_name: 'negative_prompt',
    shorthands: ['neg', 'negative' ] },
  { dt_name: 'negativePromptForImagePrior',       automatic1111_name: 'negative_prompt_for_image_prior'            },
  { dt_name: 'openClipGText',                     automatic1111_name: 'open_clip_g_text',
    shorthands: ['clipgtext', 'clip_g_text', 'clip_g', 'clipg',                                                  ] },
  { dt_name: 'originalHeight',                    automatic1111_name: 'original_height'                            },
  { dt_name: 'originalWidth',                     automatic1111_name: 'original_width'                             },
  { dt_name: 'preserveOriginalAfterInpaint',      automatic1111_name: 'preserve_original_after_inpaint'            },
  { dt_name: 'refinerModel',                      automatic1111_name: 'num_frames'                                 },
  { dt_name: 'refinerStart',                      automatic1111_name: 'refiner_start'                              },
  { dt_name: 'resolutionDependentShift',          automatic1111_name: 'resolution_dependent_shift'                 },
  { dt_name: 'seedMode',                          automatic1111_name: 'seed_mode'                                  },
  { dt_name: 'separateClipL',                     automatic1111_name: 'separate_clip_l',
    shorthands: [ 'separate_clipl',                                                                              ] },  
  { dt_name: 'separateOpenClipG',                 automatic1111_name: 'separate_open_clip_g',
    shorthands: [ 'separate_clipg', 'separate_clip_g',                                                           ] },
  { dt_name: 'separateT5',                        automatic1111_name: 'separate_t5'                                },
  { dt_name: 'speedUpWithGuidanceEmbedParameter', automatic1111_name: 'speed_up_with_guidance_embed'               },
  { dt_name: 'stage2Cfg',                         automatic1111_name: 'stage_2_cfg'                                },
  { dt_name: 'stage2Shift',                       automatic1111_name: 'stage_2_shift'                              },
  { dt_name: 'stage2Steps',                       automatic1111_name: 'stage_2_steps'                              },
  { dt_name: 'startFrameGuidance',                automatic1111_name: 'start_frame_guidance'                       },
  { dt_name: 'stochasticSamplingGamma',           automatic1111_name: 'strategic_stochastic_sampling'              },
  { dt_name: 'strength',                          automatic1111_name: 'denoising_strength'                         },
  { dt_name: 't5Text',                            automatic1111_name: 't5_text',
    shorthands: [ 't5' ] },
  { dt_name: 't5TextEncoder',                     automatic1111_name: 't5_text_encoder'                            },
  { dt_name: 'targetHeight',                      automatic1111_name: 'target_height'                              },
  { dt_name: 'targetWidth',                       automatic1111_name: 'target_width'                               },
  { dt_name: 'teaCache',                          automatic1111_name: 'tea_cache'                                  },
  { dt_name: 'teaCacheEnd',                       automatic1111_name: 'tea_cache_end'                              },
  { dt_name: 'teaCacheMaxSkipSteps',              automatic1111_name: 'tea_cache_max_skip_steps'                   },
  { dt_name: 'teaCacheStart',                     automatic1111_name: 'tea_cache_start'                            },
  { dt_name: 'teaCacheThreshold',                 automatic1111_name: 'tea_cache_threshold'                        },
  { dt_name: 'tiledDecoding',                     automatic1111_name: 'tiled_decoding'                             },
  { dt_name: 'tiledDiffusion',                    automatic1111_name: 'tiled_diffusion'                            },
  { dt_name: 'upscalerScaleFactor',               automatic1111_name: 'upscaler_scale_factor'                      },
  { dt_name: 'zeroNegativePrompt',                automatic1111_name: 'zero_negative_prompt'                       },
];
// -------------------------------------------------------------------------------------------------
function get_other_name(return_key, find_key, find_value) {
  if (log_name_lookups_enabled)
    console.log(`\nLOOKING UP ${return_key} FOR ` +
                `${inspect_fun(find_key)} ` +
                `${inspect_fun(find_value)}`);

  let find_value_lc = find_value.toLowerCase();

  // -----------------------------------------------------------------------------------------------
  // is find_value a shorthand?
  // -----------------------------------------------------------------------------------------------
  let got     = configuration_key_names.find(obj => 
    obj?.shorthands?.includes(find_value_lc))

  if (got) {
    if (log_name_lookups_enabled)
      console.log(`RETURN FROM SHORTHAND ${inspect_fun(got[return_key])}\n`);

    return got[return_key];
  }

  // -----------------------------------------------------------------------------------------------
  // is it just miscapitalized?
  // -----------------------------------------------------------------------------------------------
  got = configuration_key_names.find(obj => {
    if (log_name_lookups_enabled)
      console.log(`test ${inspect_fun(obj[return_key].toLowerCase())} === ` +
                  `${inspect_fun(find_value_lc)} = ` +
                  `${obj[return_key].toLowerCase() === find_value_lc}`);
    return obj[return_key].toLowerCase() === find_value_lc;
  });

  if (got) {
    if (log_name_lookups_enabled)
      console.log(`RETURNING CASE-CORRECTED ${return_key} ${inspect_fun(got[return_key])}\n`);
    
    return got[return_key];
  } 

  // -----------------------------------------------------------------------------------------------
  // look up the alternate key:
  // -----------------------------------------------------------------------------------------------
  got = configuration_key_names.find(obj => obj[find_key].toLowerCase() === find_value_lc);

  if (got) {
    if (log_name_lookups_enabled)
      console.log(`GOT ${return_key} FOR ` +
                  `${inspect_fun(find_key)} ${inspect_fun(find_value)}`);
    
    return got[return_key];
  }

  // -----------------------------------------------------------------------------------------------
  // didn't find it on either sise, just return the argument:
  // -----------------------------------------------------------------------------------------------
  if (log_name_lookups_enabled) 
    console.log(`RETURNING ARGUMENT ${inspect_fun(find_value)}\n`);

  // possibly an error? maybe not always.
  return find_value;
}
// -------------------------------------------------------------------------------------------------
function get_dt_name(name) {
  return get_other_name('dt_name',            'automatic1111_name', name);
}
// -------------------------------------------------------------------------------------------------
function get_automatic1111_name(name) {
  return get_other_name('automatic1111_name', 'dt_name',            name);
}
// -------------------------------------------------------------------------------------------------
function get_our_name(name) {
  const res = (dt_hosted
               ? get_dt_name
               : get_automatic1111_name)(name);

  // console.log(`got our name for ${name}: ${res}`);
  
  return res;
}
// =================================================================================================
// END OF HELPER FUNCTIONS/VARS FOR DEALING WITH DIFFERING KEY NAMES BETWEEN DT AND A1111.
// =================================================================================================


// =================================================================================================
// Context CLASS:
// =================================================================================================
var last_context_id = 0;
// -------------------------------------------------------------------------------------------------
function get_next_context_id() {
  last_context_id += 1;
  return last_context_id;
}
// -------------------------------------------------------------------------------------------------
class Context {
  constructor({ 
    flags                        = [], 
    scalar_variables             = new Map(),
    named_wildcards              = new Map(),
    noisy                        = false,
    files                        = [],
    configuration                = {},
    top_file                     = true,
    pick_one_priority            = picker_priority.ensure_weighted_distribution,
    pick_multiple_priority       = picker_priority.avoid_repetition_short,
    prior_pick_one_priority      = pick_one_priority,
    prior_pick_multiple_priority = pick_multiple_priority,
    negative_prompt              = null,
  } = {}) {
    this.context_id                   = get_next_context_id();
    this.flags                        = flags;
    this.scalar_variables             = scalar_variables;
    this.named_wildcards              = named_wildcards;
    this.noisy                        = noisy;
    this.files                        = files;
    this.configuration                = structured_clone(configuration, { unshare: true });
    this.top_file                     = top_file;
    this.pick_one_priority            = pick_one_priority;
    this.prior_pick_one_priority      = prior_pick_one_priority;
    this.pick_multiple_priority       = pick_multiple_priority;
    this.prior_pick_multiple_priority = prior_pick_multiple_priority;

    if (dt_hosted && !this.flag_is_set(["dt_hosted"]))
      this.set_flag(["dt_hosted"]);
  }
  // -----------------------------------------------------------------------------------------------
  add_lora_uniquely(lora, { indent = 0, replace = true } = {}) {
    this.configuration.loras ||= [];

    const log = msg => console.log(`${' '.repeat(log_expand_and_walk_enabled ? indent*2 : 0)}${msg}`);
    const index = this.configuration.loras.findIndex(existing => existing.file === lora.file);

    if (index !== -1) {
      if (! replace)
        return;
      
      this.configuration.splice(index, 1); // Remove the existing entry
    }
    
    this.configuration.loras.push(lora);

    if (log_configuration_enabled)
      log(`ADDED ${compress(inspect_fun(lora))} TO ${this}`);
  }
  // -------------------------------------------------------------------------------------------------
  flag_is_set(test_flag) {
    let res = false;

    for (const flag of this.flags) {
      if (arr_is_prefix_of_arr(test_flag, flag)) {
        res = true;
        break;
      }
    }
    
    return res;
  }
  // -----------------------------------------------------------------------------------------------
  set_flag(new_flag) {
    if (log_flags_enabled)
      console.log(`\nADDING ${inspect_fun(new_flag)} TO FLAGS: ${inspect_fun(this.flags)}`);

    // skip already set flags:
    if (this.flags.some(existing_flag => arr_is_prefix_of_arr(new_flag, existing_flag))) {
      if (log_flags_enabled)
        console.log(`SKIPPING, ALREADY SET`);
      return;
    }

    const new_flag_head = new_flag.slice(0, -1);
    
    this.flags = this.flags.filter(existing_flag => {
      if (arr_is_prefix_of_arr(existing_flag, new_flag)) {
        if (log_flags_enabled)
          console.log(`DISCARD ${inspect_fun(existing_flag)} BECAUSE IT IS A PREFIX OF ` +
                      `NEW FLAG ${inspect_fun(new_flag)}`);
        return false;
      }
      
      if (new_flag_head.length != 0 && arr_is_prefix_of_arr(new_flag_head, existing_flag)) {
        if (log_flags_enabled)
          console.log(`DISCARD ${inspect_fun(existing_flag)} BECAUSE IT IS A SUFFIX OF ` +
                      `NEW FLAG'S HEAD ${inspect_fun(new_flag_head)}`);
        return false; 
      }
      
      return true;
    });

    this.flags.push(new_flag);
  }
  // -----------------------------------------------------------------------------------------------
  unset_flag(flag) {
    if (log_flags_enabled)
      console.log(`BEFORE UNSETTING ${inspect_fun(flag)}: ${inspect_fun(this.flags)}`);
    
    this.flags = this.flags.filter(f => ! arr_is_prefix_of_arr(flag, f));

    if (log_flags_enabled)
      console.log(`AFTER  UNSETTING ${inspect_fun(flag)}: ${inspect_fun(this.flags)}`);
  }
  // -----------------------------------------------------------------------------------------------
  reset_temporaries() {
    this.flags = [];
    this.scalar_variables = new Map();
  }
  // -----------------------------------------------------------------------------------------------
  clone() {
    // console.log(`CLONING CONTEXT ${inspect_fun(this)}`);
    
    const copy = new Context({
      flags:                        structured_clone(this.flags),
      scalar_variables:             new Map(this.scalar_variables), // slightly shared
      named_wildcards:              new Map(this.named_wildcards),  // slightly shared
      noisy:                        this.noisy,
      files:                        structured_clone(this.files),
      configuration:                structured_clone(this.configuration, { unshare: true }),
      top_file:                     this.top_file,
      pick_one_priority:            this.pick_one_priority,
      prior_pick_one_priority:      this.prior_pick_one_priority,
      pick_multiple_priority:       this.pick_multiple_priority,      
      prior_pick_multiple_priority: this.pick_multiple_priority,
    });

    if (this.configuration.loras && copy.configuration.loras &&
        this.configuration.loras === copy.configuration.loras)
      throw new Error("oh no");

    // console.log(`CLONED CONTEXT`);
    
    return copy;
  }
  // -----------------------------------------------------------------------------------------------
  shallow_copy() {
    return new Context({
      flags:                        this.flags,
      scalar_variables:             this.scalar_variables,
      named_wildcards:              this.named_wildcards,
      noisy:                        this.noisy,
      files:                        this.files,
      configuration:                this.configuration,
      top_file:                     false, // deliberately not copied!
      pick_one_priority:            this.pick_one_priority,
      prior_pick_one_priority:      this.prior_pick_one_priority,
      pick_multiple_priority:       this.pick_multiple_priority,
      prior_pick_multiple_priority: this.pick_multiple_priority,      
      negative_prompt:              this.negative_prompt,
    });
  }
  // -------------------------------------------------------------------------------------------------
  munge_configuration({ indent = 0, replace = true, is_dt_hosted = dt_hosted } = {}) {
    const log = msg => console.log(`${' '.repeat(log_expand_and_walk_enabled ? indent*2 : 0)}${msg}`);

    // console.log(`MUNGING (with ${configuration?.loras?.length} loras) ${inspect_fun(configuration)}`);

    const munged_configuration = structured_clone(this.configuration);

    if (is_empty_object(munged_configuration))
      return munged_configuration;

    if (munged_configuration.model === '') {
      log(`WARNING: munged_configuration.model is an empty string, deleting key! This probably isn't ` +
          `what you meant to do, your prompt template may contain an error!`);
      delete munged_configuration.model;
    }
    else if (munged_configuration.model) {
      munged_configuration.model = munged_configuration.model.toLowerCase();

      if (munged_configuration.model.endsWith('.ckpt')) {
        // do nothing
      }
      else if (munged_configuration.model.endsWith('_svd')) 
        munged_configuration.model = `${munged_configuration.model}.ckpt`;
      else if (munged_configuration.model.endsWith('_q5p')) 
        munged_configuration.model = `${munged_configuration.model}.ckpt`;
      else if (munged_configuration.model.endsWith('_q8p')) 
        munged_configuration.model = `${munged_configuration.model}.ckpt`;
      else if (munged_configuration.model.endsWith('_f16')) 
        munged_configuration.model = `${munged_configuration.model}.ckpt`;
      else 
        munged_configuration.model= `${munged_configuration.model}_f16.ckpt`;
      
    }
    
    // I always mistype 'Euler a' as 'Euler A', so lets fix dumb errors like that:
    if (munged_configuration.sampler && typeof munged_configuration.sampler === 'string') {
      const lc  = munged_configuration.sampler.toLowerCase();
      const got = dt_samplers_caps_correction.get(lc);

      if (got)
        munged_configuration.sampler = got;
    }
    
    if (is_dt_hosted) { // when running in DT, sampler needs to be an index:
      if (munged_configuration.sampler !== undefined && typeof munged_configuration.sampler === 'string') {
        log(`Correcting munged_configuration.sampler = ${inspect_fun(munged_configuration.sampler)} to ` +
            `munged_configuration.sampler = ${dt_samplers.indexOf(munged_configuration.sampler)}.`);
        munged_configuration.sampler = dt_samplers.indexOf(munged_configuration.sampler);
      }
    }
    // when running in Node.js, sampler needs to be a string::
    else if (munged_configuration.sampler !== undefined && typeof munged_configuration.sampler ===  'number') {
      log(`Correcting munged_configuration.sampler = ${munged_configuration.sampler} to ` +
          `munged_configuration.sampler = ${inspect_fun(dt_samplers[munged_configuration.sampler])}.`);
      munged_configuration.sampler = dt_samplers[munged_configuration.sampler];
    }

    // 'fix' seed if n_iter > 1, doing this seems convenient?
    if (! munged_configuration.seed ||
        (munged_configuration?.n_iter >1 && munged_configuration.seed !== -1)) {
      const n_iter_key = get_our_name('n_iter');

      if (munged_configuration[n_iter_key] && (typeof munged_configuration[n_iter_key] === 'number') && munged_configuration[n_iter_key] > 1) {
        if (log_configuration_enabled)
          log(`%seed = -1 due to n_iter > 1`);

        munged_configuration.seed = -1;
      }
      else if (typeof munged_configuration.seed !== 'number') {
        const random = Math.floor(Math.random() * (2 ** 32));
        
        if (log_configuration_enabled)
          log(`%seed = ${random} due to no seed`);

        munged_configuration.seed = random;
      }
    }

    // if (log_configuration_enabled)
    //   log(`MUNGED CONFIGURATION IS: ${inspect_fun(munged_configuration, null, 2)}`);

    this.configuration =  munged_configuration;
  }
  // -----------------------------------------------------------------------------------------------
  toString() {
    return `Context<#${this.context_id}>`;
  }
}
// =================================================================================================
// END OF Context CLASS.
// =================================================================================================


// =================================================================================================
// HELPER FUNCTIONS/VARS FOR DEALING WITH THE PRELUDE.
// =================================================================================================
const prelude_text = disable_prelude ? '' : `
@__set_gender_if_unset  = {{?female #gender.female // just to make forcing an option a little terser.
                           |?male   #gender.male
                           |?neuter #gender.neuter}
                           {3 !gender.#female #female
                           |2 !gender.#male   #male
                           |1 !gender.#neuter #neuter}}
@gender                 = {@__set_gender_if_unset
                           {?gender.female woman
                           |?gender.male   man
                           |?gender.neuter androgyne }}
@pro_3rd_subj           = {@__set_gender_if_unset
                           {?gender.female she
                           |?gender.male   he
                           |?gender.neuter it        }}
@pro_3rd_obj            = {@__set_gender_if_unset
                           {?gender.female her
                           |?gender.male   him
                           |?gender.neuter it        }}
@pro_pos_adj            = {@__set_gender_if_unset
                           {?gender.female her
                           |?gender.male   his
                           |?gender.neuter its       }}
@pro_pos                = {@__set_gender_if_unset
                           {?gender.female hers
                           |?gender.male   his
                           |?gender.neuter its       }}
@any_digit              = {\\0|\\1|\\2|\\3|\\4
                          |\\5|\\6|\\7|\\8|\\9}
@low_digit              = {\\0|\\1|\\2|\\3|\\4}
@high_digit             = {\\5|\\6|\\7|\\8|\\9}
@low_random_weight      = {0.< @low_digit }
@lt1_random_weight      = {0.< @any_digit } 
@lowish_random_weight   = {0.< @high_digit}
@random_weight          = {1.< @any_digit }
@highish_random_weight  = {1.< @low_digit }
@gt1_random_weight      = {1.< @any_digit }
@high_random_weight     = {1.< @high_digit}
@pony_score_9           = {score_9,                                                            }
@pony_score_8_up        = {score_9, score_8_up,                                                }
@pony_score_7_up        = {score_9, score_8_up, score_7_up,                                    }
@pony_score_6_up        = {score_9, score_8_up, score_7_up, score_6_up,                        }
@pony_score_5_up        = {score_9, score_8_up, score_7_up, score_6_up, score_5_up,            }
@pony_score_4_up        = {score_9, score_8_up, score_7_up, score_6_up, score_5_up, score_4_up,}
@aris_defaults          = {masterpiece, best quality, absurdres, aesthetic, 8k,
                           high depth of field, ultra high resolution, detailed background,
                           wide shot,}

//--------------------------------------------------------------------------------------------------
// Integrated conntent adapted from @Wizard Whitebeard's 'Wizard's Large Scroll of
// Artist Summoning':
//--------------------------------------------------------------------------------------------------

@__set_wizards_artists_artist_if_unset =
{ !wizards_artist.#zacharias_martin_aagaard
| !wizards_artist.#slim_aarons
| !wizards_artist.#elenore_abbott
| !wizards_artist.#tomma_abts
| !wizards_artist.#vito_acconci
| !wizards_artist.#andreas_achenbach
| !wizards_artist.#ansel_adams
| !wizards_artist.#josh_adamski
| !wizards_artist.#charles_addams
| !wizards_artist.#etel_adnan
| !wizards_artist.#alena_aenami
| !wizards_artist.#leonid_afremov
| !wizards_artist.#petros_afshar
| !wizards_artist.#yaacov_agam
| !wizards_artist.#eileen_agar
| !wizards_artist.#craigie_aitchison
| !wizards_artist.#ivan_aivazovsky
| !wizards_artist.#francesco_albani
| !wizards_artist.#alessio_albi
| !wizards_artist.#miles_aldridge
| !wizards_artist.#john_white_alexander
| !wizards_artist.#alessandro_allori
| !wizards_artist.#mike_allred
| !wizards_artist.#lawrence_alma_tadema
| !wizards_artist.#lilia_alvarado
| !wizards_artist.#tarsila_do_amaral
| !wizards_artist.#ghada_amer
| !wizards_artist.#cuno_amiet
| !wizards_artist.#el_anatsui
| !wizards_artist.#helga_ancher
| !wizards_artist.#sarah_andersen
| !wizards_artist.#richard_anderson
| !wizards_artist.#sophie_gengembre_anderson
| !wizards_artist.#wes_anderson
| !wizards_artist.#alex_andreev
| !wizards_artist.#sofonisba_anguissola
| !wizards_artist.#louis_anquetin
| !wizards_artist.#mary_jane_ansell
| !wizards_artist.#chiho_aoshima
| !wizards_artist.#sabbas_apterus
| !wizards_artist.#hirohiko_araki
| !wizards_artist.#howard_arkley
| !wizards_artist.#rolf_armstrong
| !wizards_artist.#gerd_arntz
| !wizards_artist.#guy_aroch
| !wizards_artist.#miki_asai
| !wizards_artist.#clemens_ascher
| !wizards_artist.#henry_asencio
| !wizards_artist.#andrew_atroshenko
| !wizards_artist.#deborah_azzopardi
| !wizards_artist.#lois_van_baarle
| !wizards_artist.#ingrid_baars
| !wizards_artist.#anne_bachelier
| !wizards_artist.#francis_bacon
| !wizards_artist.#firmin_baes
| !wizards_artist.#tom_bagshaw
| !wizards_artist.#karol_bak
| !wizards_artist.#christopher_balaskas
| !wizards_artist.#benedick_bana
| !wizards_artist.#banksy
| !wizards_artist.#george_barbier
| !wizards_artist.#cicely_mary_barker
| !wizards_artist.#wayne_barlowe
| !wizards_artist.#will_barnet
| !wizards_artist.#matthew_barney
| !wizards_artist.#angela_barrett
| !wizards_artist.#jean_michel_basquiat
| !wizards_artist.#lillian_bassman
| !wizards_artist.#pompeo_batoni
| !wizards_artist.#casey_baugh
| !wizards_artist.#chiara_bautista
| !wizards_artist.#herbert_bayer
| !wizards_artist.#mary_beale
| !wizards_artist.#alan_bean
| !wizards_artist.#romare_bearden
| !wizards_artist.#cecil_beaton
| !wizards_artist.#cecilia_beaux
| !wizards_artist.#jasmine_becket_griffith
| !wizards_artist.#vanessa_beecroft
| !wizards_artist.#beeple
| !wizards_artist.#zdzislaw_beksinski
| !wizards_artist.#katerina_belkina
| !wizards_artist.#julie_bell
| !wizards_artist.#vanessa_bell
| !wizards_artist.#bernardo_bellotto
| !wizards_artist.#ambrosius_benson
| !wizards_artist.#stan_berenstain
| !wizards_artist.#laura_berger
| !wizards_artist.#jody_bergsma
| !wizards_artist.#john_berkey
| !wizards_artist.#gian_lorenzo_bernini
| !wizards_artist.#marta_bevacqua
| !wizards_artist.#john_t_biggers
| !wizards_artist.#enki_bilal
| !wizards_artist.#ivan_bilibin
| !wizards_artist.#butcher_billy
| !wizards_artist.#george_caleb_bingham
| !wizards_artist.#ed_binkley
| !wizards_artist.#george_birrell
| !wizards_artist.#robert_bissell
| !wizards_artist.#charles_blackman
| !wizards_artist.#mary_blair
| !wizards_artist.#john_blanche
| !wizards_artist.#don_blanding
| !wizards_artist.#albert_bloch
| !wizards_artist.#hyman_bloom
| !wizards_artist.#peter_blume
| !wizards_artist.#don_bluth
| !wizards_artist.#umberto_boccioni
| !wizards_artist.#anna_bocek
| !wizards_artist.#lee_bogle
| !wizards_artist.#louis_leopold_boily
| !wizards_artist.#giovanni_boldini
| !wizards_artist.#enoch_bolles
| !wizards_artist.#david_bomberg
| !wizards_artist.#chesley_bonestell
| !wizards_artist.#lee_bontecou
| !wizards_artist.#michael_borremans
| !wizards_artist.#matt_bors
| !wizards_artist.#flora_borsi
| !wizards_artist.#hieronymus_bosch
| !wizards_artist.#sam_bosma
| !wizards_artist.#johfra_bosschart
| !wizards_artist.#fernando_botero
| !wizards_artist.#sandro_botticelli
| !wizards_artist.#william_adolphe_bouguereau
| !wizards_artist.#susan_seddon_boulet
| !wizards_artist.#louise_bourgeois
| !wizards_artist.#annick_bouvattier
| !wizards_artist.#david_michael_bowers
| !wizards_artist.#noah_bradley
| !wizards_artist.#aleksi_briclot
| !wizards_artist.#frederick_arthur_bridgman
| !wizards_artist.#renie_britenbucher
| !wizards_artist.#romero_britto
| !wizards_artist.#gerald_brom
| !wizards_artist.#bronzino
| !wizards_artist.#herman_brood
| !wizards_artist.#mark_brooks
| !wizards_artist.#romaine_brooks
| !wizards_artist.#troy_brooks
| !wizards_artist.#broom_lee
| !wizards_artist.#allie_brosh
| !wizards_artist.#ford_madox_brown
| !wizards_artist.#charles_le_brun
| !wizards_artist.#elisabeth_vigee_le_brun
| !wizards_artist.#james_bullough
| !wizards_artist.#laurel_burch
| !wizards_artist.#alejandro_burdisio
| !wizards_artist.#daniel_buren
| !wizards_artist.#jon_burgerman
| !wizards_artist.#richard_burlet
| !wizards_artist.#jim_burns
| !wizards_artist.#stasia_burrington
| !wizards_artist.#kaethe_butcher
| !wizards_artist.#saturno_butto
| !wizards_artist.#paul_cadmus
| !wizards_artist.#zhichao_cai
| !wizards_artist.#randolph_caldecott
| !wizards_artist.#alexander_calder_milne
| !wizards_artist.#clyde_caldwell
| !wizards_artist.#vincent_callebaut
| !wizards_artist.#fred_calleri
| !wizards_artist.#charles_camoin
| !wizards_artist.#mike_campau
| !wizards_artist.#eric_canete
| !wizards_artist.#josef_capek
| !wizards_artist.#leonetto_cappiello
| !wizards_artist.#eric_carle
| !wizards_artist.#larry_carlson
| !wizards_artist.#bill_carman
| !wizards_artist.#jean_baptiste_carpeaux
| !wizards_artist.#rosalba_carriera
| !wizards_artist.#michael_carson
| !wizards_artist.#felice_casorati
| !wizards_artist.#mary_cassatt
| !wizards_artist.#a_j_casson
| !wizards_artist.#giorgio_barbarelli_da_castelfranco
| !wizards_artist.#paul_catherall
| !wizards_artist.#george_catlin
| !wizards_artist.#patrick_caulfield
| !wizards_artist.#nicoletta_ceccoli
| !wizards_artist.#agnes_cecile
| !wizards_artist.#paul_cezanne
| !wizards_artist.#paul_chabas
| !wizards_artist.#marc_chagall
| !wizards_artist.#tom_chambers
| !wizards_artist.#katia_chausheva
| !wizards_artist.#hsiao_ron_cheng
| !wizards_artist.#yanjun_cheng
| !wizards_artist.#sandra_chevrier
| !wizards_artist.#judy_chicago
| !wizards_artist.#dale_chihuly
| !wizards_artist.#frank_cho
| !wizards_artist.#james_c_christensen
| !wizards_artist.#mikalojus_konstantinas_ciurlionis
| !wizards_artist.#alson_skinner_clark
| !wizards_artist.#amanda_clark
| !wizards_artist.#harry_clarke
| !wizards_artist.#george_clausen
| !wizards_artist.#francesco_clemente
| !wizards_artist.#alvin_langdon_coburn
| !wizards_artist.#clifford_coffin
| !wizards_artist.#vince_colletta
| !wizards_artist.#beth_conklin
| !wizards_artist.#john_constable
| !wizards_artist.#darwyn_cooke
| !wizards_artist.#richard_corben
| !wizards_artist.#vittorio_matteo_corcos
| !wizards_artist.#paul_corfield
| !wizards_artist.#fernand_cormon
| !wizards_artist.#norman_cornish
| !wizards_artist.#camille_corot
| !wizards_artist.#gemma_correll
| !wizards_artist.#petra_cortright
| !wizards_artist.#lorenzo_costa_the_elder
| !wizards_artist.#olive_cotton
| !wizards_artist.#peter_coulson
| !wizards_artist.#gustave_courbet
| !wizards_artist.#frank_cadogan_cowper
| !wizards_artist.#kinuko_y_craft
| !wizards_artist.#clayton_crain
| !wizards_artist.#lucas_cranach_the_elder
| !wizards_artist.#lucas_cranach_the_younger
| !wizards_artist.#walter_crane
| !wizards_artist.#martin_creed
| !wizards_artist.#gregory_crewdson
| !wizards_artist.#debbie_criswell
| !wizards_artist.#victoria_crowe
| !wizards_artist.#etam_cru
| !wizards_artist.#robert_crumb
| !wizards_artist.#carlos_cruz_diez
| !wizards_artist.#john_currin
| !wizards_artist.#krenz_cushart
| !wizards_artist.#camilla_derrico
| !wizards_artist.#pino_daeni
| !wizards_artist.#salvador_dali
| !wizards_artist.#sunil_das
| !wizards_artist.#ian_davenport
| !wizards_artist.#stuart_davis
| !wizards_artist.#roger_dean
| !wizards_artist.#michael_deforge
| !wizards_artist.#edgar_degas
| !wizards_artist.#eugene_delacroix
| !wizards_artist.#robert_delaunay
| !wizards_artist.#sonia_delaunay
| !wizards_artist.#gabriele_dellotto
| !wizards_artist.#nicolas_delort
| !wizards_artist.#jean_delville
| !wizards_artist.#posuka_demizu
| !wizards_artist.#guy_denning
| !wizards_artist.#monsu_desiderio
| !wizards_artist.#charles_maurice_detmold
| !wizards_artist.#edward_julius_detmold
| !wizards_artist.#anne_dewailly
| !wizards_artist.#walt_disney
| !wizards_artist.#tony_diterlizzi
| !wizards_artist.#anna_dittmann
| !wizards_artist.#dima_dmitriev
| !wizards_artist.#peter_doig
| !wizards_artist.#kees_van_dongen
| !wizards_artist.#gustave_dore
| !wizards_artist.#dave_dorman
| !wizards_artist.#emilio_giuseppe_dossena
| !wizards_artist.#david_downton
| !wizards_artist.#jessica_drossin
| !wizards_artist.#philippe_druillet
| !wizards_artist.#tj_drysdale
| !wizards_artist.#ton_dubbeldam
| !wizards_artist.#marcel_duchamp
| !wizards_artist.#joseph_ducreux
| !wizards_artist.#edmund_dulac
| !wizards_artist.#marlene_dumas
| !wizards_artist.#charles_dwyer
| !wizards_artist.#william_dyce
| !wizards_artist.#chris_dyer
| !wizards_artist.#eyvind_earle
| !wizards_artist.#amy_earles
| !wizards_artist.#lori_earley
| !wizards_artist.#jeff_easley
| !wizards_artist.#tristan_eaton
| !wizards_artist.#jason_edmiston
| !wizards_artist.#alfred_eisenstaedt
| !wizards_artist.#jesper_ejsing
| !wizards_artist.#olafur_eliasson
| !wizards_artist.#harrison_ellenshaw
| !wizards_artist.#christine_ellger
| !wizards_artist.#larry_elmore
| !wizards_artist.#joseba_elorza
| !wizards_artist.#peter_elson
| !wizards_artist.#gil_elvgren
| !wizards_artist.#ed_emshwiller
| !wizards_artist.#kilian_eng
| !wizards_artist.#jason_a_engle
| !wizards_artist.#max_ernst
| !wizards_artist.#romain_de_tirtoff_erte
| !wizards_artist.#m_c_escher
| !wizards_artist.#tim_etchells
| !wizards_artist.#walker_evans
| !wizards_artist.#jan_van_eyck
| !wizards_artist.#glenn_fabry
| !wizards_artist.#ludwig_fahrenkrog
| !wizards_artist.#shepard_fairey
| !wizards_artist.#andy_fairhurst
| !wizards_artist.#luis_ricardo_falero
| !wizards_artist.#jean_fautrier
| !wizards_artist.#andrew_ferez
| !wizards_artist.#hugh_ferriss
| !wizards_artist.#david_finch
| !wizards_artist.#callie_fink
| !wizards_artist.#virgil_finlay
| !wizards_artist.#anato_finnstark
| !wizards_artist.#howard_finster
| !wizards_artist.#oskar_fischinger
| !wizards_artist.#samuel_melton_fisher
| !wizards_artist.#john_anster_fitzgerald
| !wizards_artist.#tony_fitzpatrick
| !wizards_artist.#hippolyte_flandrin
| !wizards_artist.#dan_flavin
| !wizards_artist.#max_fleischer
| !wizards_artist.#govaert_flinck
| !wizards_artist.#alex_russell_flint
| !wizards_artist.#lucio_fontana
| !wizards_artist.#chris_foss
| !wizards_artist.#jon_foster
| !wizards_artist.#jean_fouquet
| !wizards_artist.#toby_fox
| !wizards_artist.#art_frahm
| !wizards_artist.#lisa_frank
| !wizards_artist.#helen_frankenthaler
| !wizards_artist.#frank_frazetta
| !wizards_artist.#kelly_freas
| !wizards_artist.#lucian_freud
| !wizards_artist.#brian_froud
| !wizards_artist.#wendy_froud
| !wizards_artist.#tom_fruin
| !wizards_artist.#john_wayne_gacy
| !wizards_artist.#justin_gaffrey
| !wizards_artist.#hashimoto_gaho
| !wizards_artist.#neil_gaiman
| !wizards_artist.#stephen_gammell
| !wizards_artist.#hope_gangloff
| !wizards_artist.#alex_garant
| !wizards_artist.#gilbert_garcin
| !wizards_artist.#michael_and_inessa_garmash
| !wizards_artist.#antoni_gaudi
| !wizards_artist.#paul_gauguin
| !wizards_artist.#giovanni_battista_gaulli
| !wizards_artist.#anne_geddes
| !wizards_artist.#bill_gekas
| !wizards_artist.#artemisia_gentileschi
| !wizards_artist.#orazio_gentileschi
| !wizards_artist.#daniel_f_gerhartz
| !wizards_artist.#theodore_gericault
| !wizards_artist.#jean_leon_gerome
| !wizards_artist.#mark_gertler
| !wizards_artist.#atey_ghailan
| !wizards_artist.#alberto_giacometti
| !wizards_artist.#donato_giancola
| !wizards_artist.#hr_giger
| !wizards_artist.#james_gilleard
| !wizards_artist.#harold_gilman
| !wizards_artist.#charles_ginner
| !wizards_artist.#jean_giraud
| !wizards_artist.#anne_louis_girodet
| !wizards_artist.#milton_glaser
| !wizards_artist.#warwick_goble
| !wizards_artist.#john_william_godward
| !wizards_artist.#sacha_goldberger
| !wizards_artist.#nan_goldin
| !wizards_artist.#josan_gonzalez
| !wizards_artist.#felix_gonzalez_torres
| !wizards_artist.#derek_gores
| !wizards_artist.#edward_gorey
| !wizards_artist.#arshile_gorky
| !wizards_artist.#alessandro_gottardo
| !wizards_artist.#adolph_gottlieb
| !wizards_artist.#francisco_goya
| !wizards_artist.#laurent_grasso
| !wizards_artist.#mab_graves
| !wizards_artist.#eileen_gray
| !wizards_artist.#kate_greenaway
| !wizards_artist.#alex_grey
| !wizards_artist.#carne_griffiths
| !wizards_artist.#gris_grimly
| !wizards_artist.#brothers_grimm
| !wizards_artist.#tracie_grimwood
| !wizards_artist.#matt_groening
| !wizards_artist.#alex_gross
| !wizards_artist.#tom_grummett
| !wizards_artist.#huang_guangjian
| !wizards_artist.#wu_guanzhong
| !wizards_artist.#rebecca_guay
| !wizards_artist.#guercino
| !wizards_artist.#jeannette_guichard_bunel
| !wizards_artist.#scott_gustafson
| !wizards_artist.#wade_guyton
| !wizards_artist.#hans_haacke
| !wizards_artist.#robert_hagan
| !wizards_artist.#philippe_halsman
| !wizards_artist.#maggi_hambling
| !wizards_artist.#richard_hamilton
| !wizards_artist.#bess_hamiti
| !wizards_artist.#tom_hammick
| !wizards_artist.#david_hammons
| !wizards_artist.#ren_hang
| !wizards_artist.#erin_hanson
| !wizards_artist.#keith_haring
| !wizards_artist.#alexei_harlamoff
| !wizards_artist.#charley_harper
| !wizards_artist.#john_harris
| !wizards_artist.#florence_harrison
| !wizards_artist.#marsden_hartley
| !wizards_artist.#ryohei_hase
| !wizards_artist.#childe_hassam
| !wizards_artist.#ben_hatke
| !wizards_artist.#mona_hatoum
| !wizards_artist.#pam_hawkes
| !wizards_artist.#jamie_hawkesworth
| !wizards_artist.#stuart_haygarth
| !wizards_artist.#erich_heckel
| !wizards_artist.#valerie_hegarty
| !wizards_artist.#mary_heilmann
| !wizards_artist.#michael_heizer
| !wizards_artist.#gottfried_helnwein
| !wizards_artist.#barkley_l_hendricks
| !wizards_artist.#bill_henson
| !wizards_artist.#barbara_hepworth
| !wizards_artist.#herge
| !wizards_artist.#carolina_herrera
| !wizards_artist.#george_herriman
| !wizards_artist.#don_hertzfeldt
| !wizards_artist.#prudence_heward
| !wizards_artist.#ryan_hewett
| !wizards_artist.#nora_heysen
| !wizards_artist.#george_elgar_hicks
| !wizards_artist.#lorenz_hideyoshi
| !wizards_artist.#brothers_hildebrandt
| !wizards_artist.#dan_hillier
| !wizards_artist.#lewis_hine
| !wizards_artist.#miho_hirano
| !wizards_artist.#harumi_hironaka
| !wizards_artist.#hiroshige
| !wizards_artist.#morris_hirshfield
| !wizards_artist.#damien_hirst
| !wizards_artist.#fan_ho
| !wizards_artist.#meindert_hobbema
| !wizards_artist.#david_hockney
| !wizards_artist.#filip_hodas
| !wizards_artist.#howard_hodgkin
| !wizards_artist.#ferdinand_hodler
| !wizards_artist.#tiago_hoisel
| !wizards_artist.#katsushika_hokusai
| !wizards_artist.#hans_holbein_the_younger
| !wizards_artist.#frank_holl
| !wizards_artist.#carsten_holler
| !wizards_artist.#zena_holloway
| !wizards_artist.#edward_hopper
| !wizards_artist.#aaron_horkey
| !wizards_artist.#alex_horley
| !wizards_artist.#roni_horn
| !wizards_artist.#john_howe
| !wizards_artist.#alex_howitt
| !wizards_artist.#meghan_howland
| !wizards_artist.#john_hoyland
| !wizards_artist.#shilin_huang
| !wizards_artist.#arthur_hughes
| !wizards_artist.#edward_robert_hughes
| !wizards_artist.#jack_hughes
| !wizards_artist.#talbot_hughes
| !wizards_artist.#pieter_hugo
| !wizards_artist.#gary_hume
| !wizards_artist.#friedensreich_hundertwasser
| !wizards_artist.#william_holman_hunt
| !wizards_artist.#george_hurrell
| !wizards_artist.#fabio_hurtado
| !wizards_artist.#hush
| !wizards_artist.#michael_hutter
| !wizards_artist.#pierre_huyghe
| !wizards_artist.#doug_hyde
| !wizards_artist.#louis_icart
| !wizards_artist.#robert_indiana
| !wizards_artist.#jean_auguste_dominique_ingres
| !wizards_artist.#robert_irwin
| !wizards_artist.#gabriel_isak
| !wizards_artist.#junji_ito
| !wizards_artist.#christophe_jacrot
| !wizards_artist.#louis_janmot
| !wizards_artist.#frieke_janssens
| !wizards_artist.#alexander_jansson
| !wizards_artist.#tove_jansson
| !wizards_artist.#aaron_jasinski
| !wizards_artist.#alexej_von_jawlensky
| !wizards_artist.#james_jean
| !wizards_artist.#oliver_jeffers
| !wizards_artist.#lee_jeffries
| !wizards_artist.#georg_jensen
| !wizards_artist.#ellen_jewett
| !wizards_artist.#he_jiaying
| !wizards_artist.#chantal_joffe
| !wizards_artist.#martine_johanna
| !wizards_artist.#augustus_john
| !wizards_artist.#gwen_john
| !wizards_artist.#jasper_johns
| !wizards_artist.#eastman_johnson
| !wizards_artist.#alfred_cheney_johnston
| !wizards_artist.#dorothy_johnstone
| !wizards_artist.#android_jones
| !wizards_artist.#erik_jones
| !wizards_artist.#jeffrey_catherine_jones
| !wizards_artist.#peter_andrew_jones
| !wizards_artist.#loui_jover
| !wizards_artist.#amy_judd
| !wizards_artist.#donald_judd
| !wizards_artist.#jean_jullien
| !wizards_artist.#matthias_jung
| !wizards_artist.#joe_jusko
| !wizards_artist.#frida_kahlo
| !wizards_artist.#hayv_kahraman
| !wizards_artist.#mw_kaluta
| !wizards_artist.#nadav_kander
| !wizards_artist.#wassily_kandinsky
| !wizards_artist.#jun_kaneko
| !wizards_artist.#titus_kaphar
| !wizards_artist.#michal_karcz
| !wizards_artist.#gertrude_kasebier
| !wizards_artist.#terada_katsuya
| !wizards_artist.#audrey_kawasaki
| !wizards_artist.#hasui_kawase
| !wizards_artist.#glen_keane
| !wizards_artist.#margaret_keane
| !wizards_artist.#ellsworth_kelly
| !wizards_artist.#michael_kenna
| !wizards_artist.#thomas_benjamin_kennington
| !wizards_artist.#william_kentridge
| !wizards_artist.#hendrik_kerstens
| !wizards_artist.#jeremiah_ketner
| !wizards_artist.#fernand_khnopff
| !wizards_artist.#hideyuki_kikuchi
| !wizards_artist.#tom_killion
| !wizards_artist.#thomas_kinkade
| !wizards_artist.#jack_kirby
| !wizards_artist.#ernst_ludwig_kirchner
| !wizards_artist.#tatsuro_kiuchi
| !wizards_artist.#jon_klassen
| !wizards_artist.#paul_klee
| !wizards_artist.#william_klein
| !wizards_artist.#yves_klein
| !wizards_artist.#carl_kleiner
| !wizards_artist.#gustav_klimt
| !wizards_artist.#godfrey_kneller
| !wizards_artist.#emily_kame_kngwarreye
| !wizards_artist.#chad_knight
| !wizards_artist.#nick_knight
| !wizards_artist.#helene_knoop
| !wizards_artist.#phil_koch
| !wizards_artist.#kazuo_koike
| !wizards_artist.#oskar_kokoschka
| !wizards_artist.#kathe_kollwitz
| !wizards_artist.#michael_komarck
| !wizards_artist.#satoshi_kon
| !wizards_artist.#jeff_koons
| !wizards_artist.#caia_koopman
| !wizards_artist.#konstantin_korovin
| !wizards_artist.#mark_kostabi
| !wizards_artist.#bella_kotak
| !wizards_artist.#andrea_kowch
| !wizards_artist.#lee_krasner
| !wizards_artist.#barbara_kruger
| !wizards_artist.#brad_kunkle
| !wizards_artist.#yayoi_kusama
| !wizards_artist.#michael_k_kutsche
| !wizards_artist.#ilya_kuvshinov
| !wizards_artist.#david_lachapelle
| !wizards_artist.#raphael_lacoste
| !wizards_artist.#lev_lagorio
| !wizards_artist.#rene_lalique
| !wizards_artist.#abigail_larson
| !wizards_artist.#gary_larson
| !wizards_artist.#denys_lasdun
| !wizards_artist.#maria_lassnig
| !wizards_artist.#dorothy_lathrop
| !wizards_artist.#melissa_launay
| !wizards_artist.#john_lavery
| !wizards_artist.#jacob_lawrence
| !wizards_artist.#thomas_lawrence
| !wizards_artist.#ernest_lawson
| !wizards_artist.#bastien_lecouffe_deharme
| !wizards_artist.#alan_lee
| !wizards_artist.#minjae_lee
| !wizards_artist.#nina_leen
| !wizards_artist.#fernand_leger
| !wizards_artist.#paul_lehr
| !wizards_artist.#frederic_leighton
| !wizards_artist.#alayna_lemmer
| !wizards_artist.#tamara_de_lempicka
| !wizards_artist.#sol_lewitt
| !wizards_artist.#jc_leyendecker
| !wizards_artist.#andre_lhote
| !wizards_artist.#roy_lichtenstein
| !wizards_artist.#rob_liefeld
| !wizards_artist.#fang_lijun
| !wizards_artist.#maya_lin
| !wizards_artist.#filippino_lippi
| !wizards_artist.#herbert_list
| !wizards_artist.#richard_long
| !wizards_artist.#yoann_lossel
| !wizards_artist.#morris_louis
| !wizards_artist.#sarah_lucas
| !wizards_artist.#maximilien_luce
| !wizards_artist.#loretta_lux
| !wizards_artist.#george_platt_lynes
| !wizards_artist.#frances_macdonald
| !wizards_artist.#august_macke
| !wizards_artist.#stephen_mackey
| !wizards_artist.#rachel_maclean
| !wizards_artist.#raimundo_de_madrazo_y_garreta
| !wizards_artist.#joe_madureira
| !wizards_artist.#rene_magritte
| !wizards_artist.#jim_mahfood
| !wizards_artist.#vivian_maier
| !wizards_artist.#aristide_maillol
| !wizards_artist.#don_maitz
| !wizards_artist.#laura_makabresku
| !wizards_artist.#alex_maleev
| !wizards_artist.#keith_mallett
| !wizards_artist.#johji_manabe
| !wizards_artist.#milo_manara
| !wizards_artist.#edouard_manet
| !wizards_artist.#henri_manguin
| !wizards_artist.#jeremy_mann
| !wizards_artist.#sally_mann
| !wizards_artist.#andrea_mantegna
| !wizards_artist.#antonio_j_manzanedo
| !wizards_artist.#robert_mapplethorpe
| !wizards_artist.#franz_marc
| !wizards_artist.#ivan_marchuk
| !wizards_artist.#brice_marden
| !wizards_artist.#andrei_markin
| !wizards_artist.#kerry_james_marshall
| !wizards_artist.#serge_marshennikov
| !wizards_artist.#agnes_martin
| !wizards_artist.#adam_martinakis
| !wizards_artist.#stephan_martiniere
| !wizards_artist.#ilya_mashkov
| !wizards_artist.#henri_matisse
| !wizards_artist.#rodney_matthews
| !wizards_artist.#anton_mauve
| !wizards_artist.#peter_max
| !wizards_artist.#mike_mayhew
| !wizards_artist.#angus_mcbride
| !wizards_artist.#anne_mccaffrey
| !wizards_artist.#robert_mccall
| !wizards_artist.#scott_mccloud
| !wizards_artist.#steve_mccurry
| !wizards_artist.#todd_mcfarlane
| !wizards_artist.#barry_mcgee
| !wizards_artist.#ryan_mcginley
| !wizards_artist.#robert_mcginnis
| !wizards_artist.#richard_mcguire
| !wizards_artist.#patrick_mchale
| !wizards_artist.#kelly_mckernan
| !wizards_artist.#angus_mckie
| !wizards_artist.#alasdair_mclellan
| !wizards_artist.#jon_mcnaught
| !wizards_artist.#dan_mcpharlin
| !wizards_artist.#tara_mcpherson
| !wizards_artist.#ralph_mcquarrie
| !wizards_artist.#ian_mcque
| !wizards_artist.#syd_mead
| !wizards_artist.#richard_meier
| !wizards_artist.#maria_sibylla_merian
| !wizards_artist.#willard_metcalf
| !wizards_artist.#gabriel_metsu
| !wizards_artist.#jean_metzinger
| !wizards_artist.#michelangelo
| !wizards_artist.#nicolas_mignard
| !wizards_artist.#mike_mignola
| !wizards_artist.#dimitra_milan
| !wizards_artist.#john_everett_millais
| !wizards_artist.#marilyn_minter
| !wizards_artist.#januz_miralles
| !wizards_artist.#joan_miro
| !wizards_artist.#joan_mitchell
| !wizards_artist.#hayao_miyazaki
| !wizards_artist.#paula_modersohn_becker
| !wizards_artist.#amedeo_modigliani
| !wizards_artist.#moebius
| !wizards_artist.#peter_mohrbacher
| !wizards_artist.#piet_mondrian
| !wizards_artist.#claude_monet
| !wizards_artist.#jean_baptiste_monge
| !wizards_artist.#alyssa_monks
| !wizards_artist.#alan_moore
| !wizards_artist.#antonio_mora
| !wizards_artist.#edward_moran
| !wizards_artist.#koji_morimoto
| !wizards_artist.#berthe_morisot
| !wizards_artist.#daido_moriyama
| !wizards_artist.#james_wilson_morrice
| !wizards_artist.#sarah_morris
| !wizards_artist.#john_lowrie_morrison
| !wizards_artist.#igor_morski
| !wizards_artist.#john_kenn_mortensen
| !wizards_artist.#victor_moscoso
| !wizards_artist.#inna_mosina
| !wizards_artist.#richard_mosse
| !wizards_artist.#thomas_edwin_mostyn
| !wizards_artist.#marcel_mouly
| !wizards_artist.#emmanuelle_moureaux
| !wizards_artist.#alphonse_mucha
| !wizards_artist.#craig_mullins
| !wizards_artist.#augustus_edwin_mulready
| !wizards_artist.#dan_mumford
| !wizards_artist.#edvard_munch
| !wizards_artist.#alfred_munnings
| !wizards_artist.#gabriele_munter
| !wizards_artist.#takashi_murakami
| !wizards_artist.#patrice_murciano
| !wizards_artist.#scott_musgrove
| !wizards_artist.#wangechi_mutu
| !wizards_artist.#go_nagai
| !wizards_artist.#hiroshi_nagai
| !wizards_artist.#patrick_nagel
| !wizards_artist.#tibor_nagy
| !wizards_artist.#scott_naismith
| !wizards_artist.#juliana_nan
| !wizards_artist.#ted_nasmith
| !wizards_artist.#todd_nauck
| !wizards_artist.#bruce_nauman
| !wizards_artist.#ernst_wilhelm_nay
| !wizards_artist.#alice_neel
| !wizards_artist.#keith_negley
| !wizards_artist.#leroy_neiman
| !wizards_artist.#kadir_nelson
| !wizards_artist.#odd_nerdrum
| !wizards_artist.#shirin_neshat
| !wizards_artist.#mikhail_nesterov
| !wizards_artist.#jane_newland
| !wizards_artist.#victo_ngai
| !wizards_artist.#william_nicholson
| !wizards_artist.#florian_nicolle
| !wizards_artist.#kay_nielsen
| !wizards_artist.#tsutomu_nihei
| !wizards_artist.#victor_nizovtsev
| !wizards_artist.#isamu_noguchi
| !wizards_artist.#catherine_nolin
| !wizards_artist.#francois_de_nome
| !wizards_artist.#earl_norem
| !wizards_artist.#phil_noto
| !wizards_artist.#georgia_okeeffe
| !wizards_artist.#terry_oakes
| !wizards_artist.#chris_ofili
| !wizards_artist.#jack_ohman
| !wizards_artist.#noriyoshi_ohrai
| !wizards_artist.#helio_oiticica
| !wizards_artist.#taro_okamoto
| !wizards_artist.#tim_okamura
| !wizards_artist.#naomi_okubo
| !wizards_artist.#atelier_olschinsky
| !wizards_artist.#greg_olsen
| !wizards_artist.#oleg_oprisco
| !wizards_artist.#tony_orrico
| !wizards_artist.#mamoru_oshii
| !wizards_artist.#ida_rentoul_outhwaite
| !wizards_artist.#yigal_ozeri
| !wizards_artist.#gabriel_pacheco
| !wizards_artist.#michael_page
| !wizards_artist.#rui_palha
| !wizards_artist.#polixeni_papapetrou
| !wizards_artist.#julio_le_parc
| !wizards_artist.#michael_parkes
| !wizards_artist.#philippe_parreno
| !wizards_artist.#maxfield_parrish
| !wizards_artist.#alice_pasquini
| !wizards_artist.#james_mcintosh_patrick
| !wizards_artist.#john_pawson
| !wizards_artist.#max_pechstein
| !wizards_artist.#agnes_lawrence_pelton
| !wizards_artist.#irving_penn
| !wizards_artist.#bruce_pennington
| !wizards_artist.#john_perceval
| !wizards_artist.#george_perez
| !wizards_artist.#constant_permeke
| !wizards_artist.#lilla_cabot_perry
| !wizards_artist.#gaetano_pesce
| !wizards_artist.#cleon_peterson
| !wizards_artist.#daria_petrilli
| !wizards_artist.#raymond_pettibon
| !wizards_artist.#coles_phillips
| !wizards_artist.#francis_picabia
| !wizards_artist.#pablo_picasso
| !wizards_artist.#sopheap_pich
| !wizards_artist.#otto_piene
| !wizards_artist.#jerry_pinkney
| !wizards_artist.#pinturicchio
| !wizards_artist.#sebastiano_del_piombo
| !wizards_artist.#camille_pissarro
| !wizards_artist.#ferris_plock
| !wizards_artist.#bill_plympton
| !wizards_artist.#willy_pogany
| !wizards_artist.#patricia_polacco
| !wizards_artist.#jackson_pollock
| !wizards_artist.#beatrix_potter
| !wizards_artist.#edward_henry_potthast
| !wizards_artist.#simon_prades
| !wizards_artist.#maurice_prendergast
| !wizards_artist.#dod_procter
| !wizards_artist.#leo_putz
| !wizards_artist.#howard_pyle
| !wizards_artist.#arthur_rackham
| !wizards_artist.#natalia_rak
| !wizards_artist.#paul_ranson
| !wizards_artist.#raphael
| !wizards_artist.#abraham_rattner
| !wizards_artist.#jan_van_ravesteyn
| !wizards_artist.#aliza_razell
| !wizards_artist.#paula_rego
| !wizards_artist.#lotte_reiniger
| !wizards_artist.#valentin_rekunenko
| !wizards_artist.#christoffer_relander
| !wizards_artist.#andrey_remnev
| !wizards_artist.#pierre_auguste_renoir
| !wizards_artist.#ilya_repin
| !wizards_artist.#joshua_reynolds
| !wizards_artist.#rhads
| !wizards_artist.#bettina_rheims
| !wizards_artist.#jason_rhoades
| !wizards_artist.#georges_ribemont_dessaignes
| !wizards_artist.#jusepe_de_ribera
| !wizards_artist.#gerhard_richter
| !wizards_artist.#chris_riddell
| !wizards_artist.#hyacinthe_rigaud
| !wizards_artist.#rembrandt_van_rijn
| !wizards_artist.#faith_ringgold
| !wizards_artist.#jozsef_rippl_ronai
| !wizards_artist.#pipilotti_rist
| !wizards_artist.#charles_robinson
| !wizards_artist.#theodore_robinson
| !wizards_artist.#kenneth_rocafort
| !wizards_artist.#andreas_rocha
| !wizards_artist.#norman_rockwell
| !wizards_artist.#ludwig_mies_van_der_rohe
| !wizards_artist.#fatima_ronquillo
| !wizards_artist.#salvator_rosa
| !wizards_artist.#kerby_rosanes
| !wizards_artist.#conrad_roset
| !wizards_artist.#bob_ross
| !wizards_artist.#dante_gabriel_rossetti
| !wizards_artist.#jessica_rossier
| !wizards_artist.#marianna_rothen
| !wizards_artist.#mark_rothko
| !wizards_artist.#eva_rothschild
| !wizards_artist.#georges_rousse
| !wizards_artist.#luis_royo
| !wizards_artist.#joao_ruas
| !wizards_artist.#peter_paul_rubens
| !wizards_artist.#rachel_ruysch
| !wizards_artist.#albert_pinkham_ryder
| !wizards_artist.#mark_ryden
| !wizards_artist.#ursula_von_rydingsvard
| !wizards_artist.#theo_van_rysselberghe
| !wizards_artist.#eero_saarinen
| !wizards_artist.#wlad_safronow
| !wizards_artist.#amanda_sage
| !wizards_artist.#antoine_de_saint_exupery
| !wizards_artist.#nicola_samori
| !wizards_artist.#rebeca_saray
| !wizards_artist.#john_singer_sargent
| !wizards_artist.#martiros_saryan
| !wizards_artist.#viviane_sassen
| !wizards_artist.#nike_savvas
| !wizards_artist.#richard_scarry
| !wizards_artist.#godfried_schalcken
| !wizards_artist.#miriam_schapiro
| !wizards_artist.#kenny_scharf
| !wizards_artist.#jerry_schatzberg
| !wizards_artist.#ary_scheffer
| !wizards_artist.#kees_scherer
| !wizards_artist.#helene_schjerfbeck
| !wizards_artist.#christian_schloe
| !wizards_artist.#karl_schmidt_rottluff
| !wizards_artist.#julian_schnabel
| !wizards_artist.#fritz_scholder
| !wizards_artist.#charles_schulz
| !wizards_artist.#sean_scully
| !wizards_artist.#ronald_searle
| !wizards_artist.#mark_seliger
| !wizards_artist.#anton_semenov
| !wizards_artist.#edmondo_senatore
| !wizards_artist.#maurice_sendak
| !wizards_artist.#richard_serra
| !wizards_artist.#georges_seurat
| !wizards_artist.#dr_seuss
| !wizards_artist.#tanya_shatseva
| !wizards_artist.#natalie_shau
| !wizards_artist.#barclay_shaw
| !wizards_artist.#e_h_shepard
| !wizards_artist.#amrita_sher_gil
| !wizards_artist.#irene_sheri
| !wizards_artist.#duffy_sheridan
| !wizards_artist.#cindy_sherman
| !wizards_artist.#shozo_shimamoto
| !wizards_artist.#hikari_shimoda
| !wizards_artist.#makoto_shinkai
| !wizards_artist.#chiharu_shiota
| !wizards_artist.#elizabeth_shippen_green
| !wizards_artist.#masamune_shirow
| !wizards_artist.#tim_shumate
| !wizards_artist.#yuri_shwedoff
| !wizards_artist.#malick_sidibe
| !wizards_artist.#jeanloup_sieff
| !wizards_artist.#bill_sienkiewicz
| !wizards_artist.#marc_simonetti
| !wizards_artist.#david_sims
| !wizards_artist.#andy_singer
| !wizards_artist.#alfred_sisley
| !wizards_artist.#sandy_skoglund
| !wizards_artist.#jeffrey_smart
| !wizards_artist.#berndnaut_smilde
| !wizards_artist.#rodney_smith
| !wizards_artist.#samantha_keely_smith
| !wizards_artist.#robert_smithson
| !wizards_artist.#barbara_stauffacher_solomon
| !wizards_artist.#simeon_solomon
| !wizards_artist.#hajime_sorayama
| !wizards_artist.#joaquin_sorolla
| !wizards_artist.#ettore_sottsass
| !wizards_artist.#amadeo_de_souza_cardoso
| !wizards_artist.#millicent_sowerby
| !wizards_artist.#moses_soyer
| !wizards_artist.#sparth
| !wizards_artist.#jack_spencer
| !wizards_artist.#art_spiegelman
| !wizards_artist.#simon_stalenhag
| !wizards_artist.#ralph_steadman
| !wizards_artist.#philip_wilson_steer
| !wizards_artist.#william_steig
| !wizards_artist.#fred_stein
| !wizards_artist.#theophile_steinlen
| !wizards_artist.#brian_stelfreeze
| !wizards_artist.#frank_stella
| !wizards_artist.#joseph_stella
| !wizards_artist.#irma_stern
| !wizards_artist.#alfred_stevens
| !wizards_artist.#marie_spartali_stillman
| !wizards_artist.#stinkfish
| !wizards_artist.#anne_stokes
| !wizards_artist.#william_stout
| !wizards_artist.#paul_strand
| !wizards_artist.#linnea_strid
| !wizards_artist.#john_melhuish_strudwick
| !wizards_artist.#drew_struzan
| !wizards_artist.#tatiana_suarez
| !wizards_artist.#eustache_le_sueur
| !wizards_artist.#rebecca_sugar
| !wizards_artist.#hiroshi_sugimoto
| !wizards_artist.#graham_sutherland
| !wizards_artist.#jan_svankmajer
| !wizards_artist.#raymond_swanland
| !wizards_artist.#annie_swynnerton
| !wizards_artist.#stanislaw_szukalski
| !wizards_artist.#philip_taaffe
| !wizards_artist.#hiroyuki_mitsume_takahashi
| !wizards_artist.#dorothea_tanning
| !wizards_artist.#margaret_tarrant
| !wizards_artist.#genndy_tartakovsky
| !wizards_artist.#teamlab
| !wizards_artist.#raina_telgemeier
| !wizards_artist.#john_tenniel
| !wizards_artist.#sir_john_tenniel
| !wizards_artist.#howard_terpning
| !wizards_artist.#osamu_tezuka
| !wizards_artist.#abbott_handerson_thayer
| !wizards_artist.#heather_theurer
| !wizards_artist.#mickalene_thomas
| !wizards_artist.#tom_thomson
| !wizards_artist.#titian
| !wizards_artist.#mark_tobey
| !wizards_artist.#greg_tocchini
| !wizards_artist.#roland_topor
| !wizards_artist.#sergio_toppi
| !wizards_artist.#alex_toth
| !wizards_artist.#henri_de_toulouse_lautrec
| !wizards_artist.#ross_tran
| !wizards_artist.#philip_treacy
| !wizards_artist.#anne_truitt
| !wizards_artist.#henry_scott_tuke
| !wizards_artist.#jmw_turner
| !wizards_artist.#james_turrell
| !wizards_artist.#john_henry_twachtman
| !wizards_artist.#naomi_tydeman
| !wizards_artist.#euan_uglow
| !wizards_artist.#daniela_uhlig
| !wizards_artist.#kitagawa_utamaro
| !wizards_artist.#christophe_vacher
| !wizards_artist.#suzanne_valadon
| !wizards_artist.#thiago_valdi
| !wizards_artist.#chris_van_allsburg
| !wizards_artist.#francine_van_hove
| !wizards_artist.#jan_van_kessel_the_elder
| !wizards_artist.#remedios_varo
| !wizards_artist.#nick_veasey
| !wizards_artist.#diego_velazquez
| !wizards_artist.#eve_ventrue
| !wizards_artist.#johannes_vermeer
| !wizards_artist.#charles_vess
| !wizards_artist.#roman_vishniac
| !wizards_artist.#kelly_vivanco
| !wizards_artist.#brian_m_viveros
| !wizards_artist.#elke_vogelsang
| !wizards_artist.#vladimir_volegov
| !wizards_artist.#robert_vonnoh
| !wizards_artist.#mikhail_vrubel
| !wizards_artist.#louis_wain
| !wizards_artist.#kara_walker
| !wizards_artist.#josephine_wall
| !wizards_artist.#bruno_walpoth
| !wizards_artist.#chris_ware
| !wizards_artist.#andy_warhol
| !wizards_artist.#john_william_waterhouse
| !wizards_artist.#bill_watterson
| !wizards_artist.#george_frederic_watts
| !wizards_artist.#walter_ernest_webster
| !wizards_artist.#hendrik_weissenbruch
| !wizards_artist.#neil_welliver
| !wizards_artist.#catrin_welz_stein
| !wizards_artist.#vivienne_westwood
| !wizards_artist.#michael_whelan
| !wizards_artist.#james_abbott_mcneill_whistler
| !wizards_artist.#william_whitaker
| !wizards_artist.#tim_white
| !wizards_artist.#coby_whitmore
| !wizards_artist.#david_wiesner
| !wizards_artist.#kehinde_wiley
| !wizards_artist.#cathy_wilkes
| !wizards_artist.#jessie_willcox_smith
| !wizards_artist.#gilbert_williams
| !wizards_artist.#kyffin_williams
| !wizards_artist.#al_williamson
| !wizards_artist.#wes_wilson
| !wizards_artist.#mike_winkelmann
| !wizards_artist.#bec_winnel
| !wizards_artist.#franz_xaver_winterhalter
| !wizards_artist.#nathan_wirth
| !wizards_artist.#wlop
| !wizards_artist.#brandon_woelfel
| !wizards_artist.#liam_wong
| !wizards_artist.#francesca_woodman
| !wizards_artist.#jim_woodring
| !wizards_artist.#patrick_woodroffe
| !wizards_artist.#frank_lloyd_wright
| !wizards_artist.#sulamith_wulfing
| !wizards_artist.#nc_wyeth
| !wizards_artist.#rose_wylie
| !wizards_artist.#stanislaw_wyspianski
| !wizards_artist.#takato_yamamoto
| !wizards_artist.#gene_luen_yang
| !wizards_artist.#ikenaga_yasunari
| !wizards_artist.#kozo_yokai
| !wizards_artist.#sean_yoro
| !wizards_artist.#chie_yoshii
| !wizards_artist.#skottie_young
| !wizards_artist.#masaaki_yuasa
| !wizards_artist.#konstantin_yuon
| !wizards_artist.#yuumei
| !wizards_artist.#william_zorach
| !wizards_artist.#ander_zorn
// artists added by me (ariane-emory)
| 3 !wizards_artist.#ian_miller
| 3 !wizards_artist.#john_zeleznik
| 3 !wizards_artist.#keith_parkinson
| 3 !wizards_artist.#kevin_fales
| 3 !wizards_artist.#boris_vallejo
}

@wizards_artists = { @__set_wizards_artists_artist_if_unset
{ ?wizards_artist.zacharias_martin_aagaard Zacharias Martin Aagaard
| ?wizards_artist.slim_aarons Slim Aarons
| ?wizards_artist.elenore_abbott Elenore Abbott
| ?wizards_artist.tomma_abts Tomma Abts
| ?wizards_artist.vito_acconci Vito Acconci
| ?wizards_artist.andreas_achenbach Andreas Achenbach
| ?wizards_artist.ansel_adams Ansel Adams
| ?wizards_artist.josh_adamski Josh Adamski
| ?wizards_artist.charles_addams Charles Addams
| ?wizards_artist.etel_adnan Etel Adnan
| ?wizards_artist.alena_aenami Alena Aenami
| ?wizards_artist.leonid_afremov Leonid Afremov
| ?wizards_artist.petros_afshar Petros Afshar
| ?wizards_artist.yaacov_agam Yaacov Agam
| ?wizards_artist.eileen_agar Eileen Agar
| ?wizards_artist.craigie_aitchison Craigie Aitchison
| ?wizards_artist.ivan_aivazovsky Ivan Aivazovsky
| ?wizards_artist.francesco_albani Francesco Albani
| ?wizards_artist.alessio_albi Alessio Albi
| ?wizards_artist.miles_aldridge Miles Aldridge
| ?wizards_artist.john_white_alexander John White Alexander
| ?wizards_artist.alessandro_allori Alessandro Allori
| ?wizards_artist.mike_allred Mike Allred
| ?wizards_artist.lawrence_alma_tadema Lawrence Alma-Tadema
| ?wizards_artist.lilia_alvarado Lilia Alvarado
| ?wizards_artist.tarsila_do_amaral Tarsila do Amaral
| ?wizards_artist.ghada_amer Ghada Amer
| ?wizards_artist.cuno_amiet Cuno Amiet
| ?wizards_artist.el_anatsui El Anatsui
| ?wizards_artist.helga_ancher Helga Ancher
| ?wizards_artist.sarah_andersen Sarah Andersen
| ?wizards_artist.richard_anderson Richard Anderson
| ?wizards_artist.sophie_gengembre_anderson Sophie Gengembre Anderson
| ?wizards_artist.wes_anderson Wes Anderson
| ?wizards_artist.alex_andreev Alex Andreev
| ?wizards_artist.sofonisba_anguissola Sofonisba Anguissola
| ?wizards_artist.louis_anquetin Louis Anquetin
| ?wizards_artist.mary_jane_ansell Mary Jane Ansell
| ?wizards_artist.chiho_aoshima Chiho Aoshima
| ?wizards_artist.sabbas_apterus Sabbas Apterus
| ?wizards_artist.hirohiko_araki Hirohiko Araki
| ?wizards_artist.howard_arkley Howard Arkley
| ?wizards_artist.rolf_armstrong Rolf Armstrong
| ?wizards_artist.gerd_arntz Gerd Arntz
| ?wizards_artist.guy_aroch Guy Aroch
| ?wizards_artist.miki_asai Miki Asai
| ?wizards_artist.clemens_ascher Clemens Ascher
| ?wizards_artist.henry_asencio Henry Asencio
| ?wizards_artist.andrew_atroshenko Andrew Atroshenko
| ?wizards_artist.deborah_azzopardi Deborah Azzopardi
| ?wizards_artist.lois_van_baarle Lois van Baarle
| ?wizards_artist.ingrid_baars Ingrid Baars
| ?wizards_artist.anne_bachelier Anne Bachelier
| ?wizards_artist.francis_bacon Francis Bacon
| ?wizards_artist.firmin_baes Firmin Baes
| ?wizards_artist.tom_bagshaw Tom Bagshaw
| ?wizards_artist.karol_bak Karol Bak
| ?wizards_artist.christopher_balaskas Christopher Balaskas
| ?wizards_artist.benedick_bana Benedick Bana
| ?wizards_artist.banksy Banksy
| ?wizards_artist.george_barbier George Barbier
| ?wizards_artist.cicely_mary_barker Cicely Mary Barker
| ?wizards_artist.wayne_barlowe Wayne Barlowe
| ?wizards_artist.will_barnet Will Barnet
| ?wizards_artist.matthew_barney Matthew Barney
| ?wizards_artist.angela_barrett Angela Barrett
| ?wizards_artist.jean_michel_basquiat Jean-Michel Basquiat
| ?wizards_artist.lillian_bassman Lillian Bassman
| ?wizards_artist.pompeo_batoni Pompeo Batoni
| ?wizards_artist.casey_baugh Casey Baugh
| ?wizards_artist.chiara_bautista Chiara Bautista
| ?wizards_artist.herbert_bayer Herbert Bayer
| ?wizards_artist.mary_beale Mary Beale
| ?wizards_artist.alan_bean Alan Bean
| ?wizards_artist.romare_bearden Romare Bearden
| ?wizards_artist.cecil_beaton Cecil Beaton
| ?wizards_artist.cecilia_beaux Cecilia Beaux
| ?wizards_artist.jasmine_becket_griffith Jasmine Becket-Griffith
| ?wizards_artist.vanessa_beecroft Vanessa Beecroft
| ?wizards_artist.beeple Beeple
| ?wizards_artist.zdzislaw_beksinski Zdzisław Beksiński
| ?wizards_artist.katerina_belkina Katerina Belkina
| ?wizards_artist.julie_bell Julie Bell
| ?wizards_artist.vanessa_bell Vanessa Bell
| ?wizards_artist.bernardo_bellotto Bernardo Bellotto
| ?wizards_artist.ambrosius_benson Ambrosius Benson
| ?wizards_artist.stan_berenstain Stan Berenstain
| ?wizards_artist.laura_berger Laura Berger
| ?wizards_artist.jody_bergsma Jody Bergsma
| ?wizards_artist.john_berkey John Berkey
| ?wizards_artist.gian_lorenzo_bernini Gian Lorenzo Bernini
| ?wizards_artist.marta_bevacqua Marta Bevacqua
| ?wizards_artist.john_t_biggers John T. Biggers
| ?wizards_artist.enki_bilal Enki Bilal
| ?wizards_artist.ivan_bilibin Ivan Bilibin
| ?wizards_artist.butcher_billy Butcher Billy
| ?wizards_artist.george_caleb_bingham George Caleb Bingham
| ?wizards_artist.ed_binkley Ed Binkley
| ?wizards_artist.george_birrell George Birrell
| ?wizards_artist.robert_bissell Robert Bissell
| ?wizards_artist.charles_blackman Charles Blackman
| ?wizards_artist.mary_blair Mary Blair
| ?wizards_artist.john_blanche John Blanche
| ?wizards_artist.don_blanding Don Blanding
| ?wizards_artist.albert_bloch Albert Bloch
| ?wizards_artist.hyman_bloom Hyman Bloom
| ?wizards_artist.peter_blume Peter Blume
| ?wizards_artist.don_bluth Don Bluth
| ?wizards_artist.umberto_boccioni Umberto Boccioni
| ?wizards_artist.anna_bocek Anna Bocek
| ?wizards_artist.lee_bogle Lee Bogle
| ?wizards_artist.louis_leopold_boily Louis-Léopold Boily
| ?wizards_artist.giovanni_boldini Giovanni Boldini
| ?wizards_artist.enoch_bolles Enoch Bolles
| ?wizards_artist.david_bomberg David Bomberg
| ?wizards_artist.chesley_bonestell Chesley Bonestell
| ?wizards_artist.lee_bontecou Lee Bontecou
| ?wizards_artist.michael_borremans Michael Borremans
| ?wizards_artist.matt_bors Matt Bors
| ?wizards_artist.flora_borsi Flora Borsi
| ?wizards_artist.hieronymus_bosch Hieronymus Bosch
| ?wizards_artist.sam_bosma Sam Bosma
| ?wizards_artist.johfra_bosschart Johfra Bosschart
| ?wizards_artist.fernando_botero Fernando Botero
| ?wizards_artist.sandro_botticelli Sandro Botticelli
| ?wizards_artist.william_adolphe_bouguereau William-Adolphe Bouguereau
| ?wizards_artist.susan_seddon_boulet Susan Seddon Boulet
| ?wizards_artist.louise_bourgeois Louise Bourgeois
| ?wizards_artist.annick_bouvattier Annick Bouvattier
| ?wizards_artist.david_michael_bowers David Michael Bowers
| ?wizards_artist.noah_bradley Noah Bradley
| ?wizards_artist.aleksi_briclot Aleksi Briclot
| ?wizards_artist.frederick_arthur_bridgman Frederick Arthur Bridgman
| ?wizards_artist.renie_britenbucher Renie Britenbucher
| ?wizards_artist.romero_britto Romero Britto
| ?wizards_artist.gerald_brom Gerald Brom
| ?wizards_artist.bronzino Bronzino
| ?wizards_artist.herman_brood Herman Brood
| ?wizards_artist.mark_brooks Mark Brooks
| ?wizards_artist.romaine_brooks Romaine Brooks
| ?wizards_artist.troy_brooks Troy Brooks
| ?wizards_artist.broom_lee Broom Lee
| ?wizards_artist.allie_brosh Allie Brosh
| ?wizards_artist.ford_madox_brown Ford Madox Brown
| ?wizards_artist.charles_le_brun Charles Le Brun
| ?wizards_artist.elisabeth_vigee_le_brun Élisabeth Vigée Le Brun
| ?wizards_artist.james_bullough James Bullough
| ?wizards_artist.laurel_burch Laurel Burch
| ?wizards_artist.alejandro_burdisio Alejandro Burdisio
| ?wizards_artist.daniel_buren Daniel Buren
| ?wizards_artist.jon_burgerman Jon Burgerman
| ?wizards_artist.richard_burlet Richard Burlet
| ?wizards_artist.jim_burns Jim Burns
| ?wizards_artist.stasia_burrington Stasia Burrington
| ?wizards_artist.kaethe_butcher Kaethe Butcher
| ?wizards_artist.saturno_butto Saturno Butto
| ?wizards_artist.paul_cadmus Paul Cadmus
| ?wizards_artist.zhichao_cai Zhichao Cai
| ?wizards_artist.randolph_caldecott Randolph Caldecott
| ?wizards_artist.alexander_calder_milne Alexander Calder Milne
| ?wizards_artist.clyde_caldwell Clyde Caldwell
| ?wizards_artist.vincent_callebaut Vincent Callebaut
| ?wizards_artist.fred_calleri Fred Calleri
| ?wizards_artist.charles_camoin Charles Camoin
| ?wizards_artist.mike_campau Mike Campau
| ?wizards_artist.eric_canete Eric Canete
| ?wizards_artist.josef_capek Josef Capek
| ?wizards_artist.leonetto_cappiello Leonetto Cappiello
| ?wizards_artist.eric_carle Eric Carle
| ?wizards_artist.larry_carlson Larry Carlson
| ?wizards_artist.bill_carman Bill Carman
| ?wizards_artist.jean_baptiste_carpeaux Jean-Baptiste Carpeaux
| ?wizards_artist.rosalba_carriera Rosalba Carriera
| ?wizards_artist.michael_carson Michael Carson
| ?wizards_artist.felice_casorati Felice Casorati
| ?wizards_artist.mary_cassatt Mary Cassatt
| ?wizards_artist.a_j_casson A. J. Casson
| ?wizards_artist.giorgio_barbarelli_da_castelfranco Giorgio Barbarelli da Castelfranco
| ?wizards_artist.paul_catherall Paul Catherall
| ?wizards_artist.george_catlin George Catlin
| ?wizards_artist.patrick_caulfield Patrick Caulfield
| ?wizards_artist.nicoletta_ceccoli Nicoletta Ceccoli
| ?wizards_artist.agnes_cecile Agnes Cecile
| ?wizards_artist.paul_cezanne Paul Cézanne
| ?wizards_artist.paul_chabas Paul Chabas
| ?wizards_artist.marc_chagall Marc Chagall
| ?wizards_artist.tom_chambers Tom Chambers
| ?wizards_artist.katia_chausheva Katia Chausheva
| ?wizards_artist.hsiao_ron_cheng Hsiao-Ron Cheng
| ?wizards_artist.yanjun_cheng Yanjun Cheng
| ?wizards_artist.sandra_chevrier Sandra Chevrier
| ?wizards_artist.judy_chicago Judy Chicago
| ?wizards_artist.dale_chihuly Dale Chihuly
| ?wizards_artist.frank_cho Frank Cho
| ?wizards_artist.james_c_christensen James C. Christensen
| ?wizards_artist.mikalojus_konstantinas_ciurlionis Mikalojus Konstantinas Ciurlionis
| ?wizards_artist.alson_skinner_clark Alson Skinner Clark
| ?wizards_artist.amanda_clark Amanda Clark
| ?wizards_artist.harry_clarke Harry Clarke
| ?wizards_artist.george_clausen George Clausen
| ?wizards_artist.francesco_clemente Francesco Clemente
| ?wizards_artist.alvin_langdon_coburn Alvin Langdon Coburn
| ?wizards_artist.clifford_coffin Clifford Coffin
| ?wizards_artist.vince_colletta Vince Colletta
| ?wizards_artist.beth_conklin Beth Conklin
| ?wizards_artist.john_constable John Constable
| ?wizards_artist.darwyn_cooke Darwyn Cooke
| ?wizards_artist.richard_corben Richard Corben
| ?wizards_artist.vittorio_matteo_corcos Vittorio Matteo Corcos
| ?wizards_artist.paul_corfield Paul Corfield
| ?wizards_artist.fernand_cormon Fernand Cormon
| ?wizards_artist.norman_cornish Norman Cornish
| ?wizards_artist.camille_corot Camille Corot
| ?wizards_artist.gemma_correll Gemma Correll
| ?wizards_artist.petra_cortright Petra Cortright
| ?wizards_artist.lorenzo_costa_the_elder Lorenzo Costa the Elder
| ?wizards_artist.olive_cotton Olive Cotton
| ?wizards_artist.peter_coulson Peter Coulson
| ?wizards_artist.gustave_courbet Gustave Courbet
| ?wizards_artist.frank_cadogan_cowper Frank Cadogan Cowper
| ?wizards_artist.kinuko_y_craft Kinuko Y. Craft
| ?wizards_artist.clayton_crain Clayton Crain
| ?wizards_artist.lucas_cranach_the_elder Lucas Cranach the Elder
| ?wizards_artist.lucas_cranach_the_younger Lucas Cranach the Younger
| ?wizards_artist.walter_crane Walter Crane
| ?wizards_artist.martin_creed Martin Creed
| ?wizards_artist.gregory_crewdson Gregory Crewdson
| ?wizards_artist.debbie_criswell Debbie Criswell
| ?wizards_artist.victoria_crowe Victoria Crowe
| ?wizards_artist.etam_cru Etam Cru
| ?wizards_artist.robert_crumb Robert Crumb
| ?wizards_artist.carlos_cruz_diez Carlos Cruz-Diez
| ?wizards_artist.john_currin John Currin
| ?wizards_artist.krenz_cushart Krenz Cushart
| ?wizards_artist.camilla_derrico Camilla d'Errico
| ?wizards_artist.pino_daeni Pino Daeni
| ?wizards_artist.salvador_dali Salvador Dalí
| ?wizards_artist.sunil_das Sunil Das
| ?wizards_artist.ian_davenport Ian Davenport
| ?wizards_artist.stuart_davis Stuart Davis
| ?wizards_artist.roger_dean Roger Dean
| ?wizards_artist.michael_deforge Michael Deforge
| ?wizards_artist.edgar_degas Edgar Degas
| ?wizards_artist.eugene_delacroix Eugene Delacroix
| ?wizards_artist.robert_delaunay Robert Delaunay
| ?wizards_artist.sonia_delaunay Sonia Delaunay
| ?wizards_artist.gabriele_dellotto Gabriele Dell'otto
| ?wizards_artist.nicolas_delort Nicolas Delort
| ?wizards_artist.jean_delville Jean Delville
| ?wizards_artist.posuka_demizu Posuka Demizu
| ?wizards_artist.guy_denning Guy Denning
| ?wizards_artist.monsu_desiderio Monsù Desiderio
| ?wizards_artist.charles_maurice_detmold Charles Maurice Detmold
| ?wizards_artist.edward_julius_detmold Edward Julius Detmold
| ?wizards_artist.anne_dewailly Anne Dewailly
| ?wizards_artist.walt_disney Walt Disney
| ?wizards_artist.tony_diterlizzi Tony DiTerlizzi
| ?wizards_artist.anna_dittmann Anna Dittmann
| ?wizards_artist.dima_dmitriev Dima Dmitriev
| ?wizards_artist.peter_doig Peter Doig
| ?wizards_artist.kees_van_dongen Kees van Dongen
| ?wizards_artist.gustave_dore Gustave Doré
| ?wizards_artist.dave_dorman Dave Dorman
| ?wizards_artist.emilio_giuseppe_dossena Emilio Giuseppe Dossena
| ?wizards_artist.david_downton David Downton
| ?wizards_artist.jessica_drossin Jessica Drossin
| ?wizards_artist.philippe_druillet Philippe Druillet
| ?wizards_artist.tj_drysdale TJ Drysdale
| ?wizards_artist.ton_dubbeldam Ton Dubbeldam
| ?wizards_artist.marcel_duchamp Marcel Duchamp
| ?wizards_artist.joseph_ducreux Joseph Ducreux
| ?wizards_artist.edmund_dulac Edmund Dulac
| ?wizards_artist.marlene_dumas Marlene Dumas
| ?wizards_artist.charles_dwyer Charles Dwyer
| ?wizards_artist.william_dyce William Dyce
| ?wizards_artist.chris_dyer Chris Dyer
| ?wizards_artist.eyvind_earle Eyvind Earle
| ?wizards_artist.amy_earles Amy Earles
| ?wizards_artist.lori_earley Lori Earley
| ?wizards_artist.jeff_easley Jeff Easley
| ?wizards_artist.tristan_eaton Tristan Eaton
| ?wizards_artist.jason_edmiston Jason Edmiston
| ?wizards_artist.alfred_eisenstaedt Alfred Eisenstaedt
| ?wizards_artist.jesper_ejsing Jesper Ejsing
| ?wizards_artist.olafur_eliasson Olafur Eliasson
| ?wizards_artist.harrison_ellenshaw Harrison Ellenshaw
| ?wizards_artist.christine_ellger Christine Ellger
| ?wizards_artist.larry_elmore Larry Elmore
| ?wizards_artist.joseba_elorza Joseba Elorza
| ?wizards_artist.peter_elson Peter Elson
| ?wizards_artist.gil_elvgren Gil Elvgren
| ?wizards_artist.ed_emshwiller Ed Emshwiller
| ?wizards_artist.kilian_eng Kilian Eng
| ?wizards_artist.jason_a_engle Jason A. Engle
| ?wizards_artist.max_ernst Max Ernst
| ?wizards_artist.romain_de_tirtoff_erte Romain de Tirtoff Erté
| ?wizards_artist.m_c_escher M. C. Escher
| ?wizards_artist.tim_etchells Tim Etchells
| ?wizards_artist.walker_evans Walker Evans
| ?wizards_artist.jan_van_eyck Jan van Eyck
| ?wizards_artist.glenn_fabry Glenn Fabry
| ?wizards_artist.ludwig_fahrenkrog Ludwig Fahrenkrog
| ?wizards_artist.shepard_fairey Shepard Fairey
| ?wizards_artist.andy_fairhurst Andy Fairhurst
| ?wizards_artist.luis_ricardo_falero Luis Ricardo Falero
| ?wizards_artist.jean_fautrier Jean Fautrier
| ?wizards_artist.andrew_ferez Andrew Ferez
| ?wizards_artist.hugh_ferriss Hugh Ferriss
| ?wizards_artist.david_finch David Finch
| ?wizards_artist.callie_fink Callie Fink
| ?wizards_artist.virgil_finlay Virgil Finlay
| ?wizards_artist.anato_finnstark Anato Finnstark
| ?wizards_artist.howard_finster Howard Finster
| ?wizards_artist.oskar_fischinger Oskar Fischinger
| ?wizards_artist.samuel_melton_fisher Samuel Melton Fisher
| ?wizards_artist.john_anster_fitzgerald John Anster Fitzgerald
| ?wizards_artist.tony_fitzpatrick Tony Fitzpatrick
| ?wizards_artist.hippolyte_flandrin Hippolyte Flandrin
| ?wizards_artist.dan_flavin Dan Flavin
| ?wizards_artist.max_fleischer Max Fleischer
| ?wizards_artist.govaert_flinck Govaert Flinck
| ?wizards_artist.alex_russell_flint Alex Russell Flint
| ?wizards_artist.lucio_fontana Lucio Fontana
| ?wizards_artist.chris_foss Chris Foss
| ?wizards_artist.jon_foster Jon Foster
| ?wizards_artist.jean_fouquet Jean Fouquet
| ?wizards_artist.toby_fox Toby Fox
| ?wizards_artist.art_frahm Art Frahm
| ?wizards_artist.lisa_frank Lisa Frank
| ?wizards_artist.helen_frankenthaler Helen Frankenthaler
| ?wizards_artist.frank_frazetta Frank Frazetta
| ?wizards_artist.kelly_freas Kelly Freas
| ?wizards_artist.lucian_freud Lucian Freud
| ?wizards_artist.brian_froud Brian Froud
| ?wizards_artist.wendy_froud Wendy Froud
| ?wizards_artist.tom_fruin Tom Fruin
| ?wizards_artist.john_wayne_gacy John Wayne Gacy
| ?wizards_artist.justin_gaffrey Justin Gaffrey
| ?wizards_artist.hashimoto_gaho Hashimoto Gahō
| ?wizards_artist.neil_gaiman Neil Gaiman
| ?wizards_artist.stephen_gammell Stephen Gammell
| ?wizards_artist.hope_gangloff Hope Gangloff
| ?wizards_artist.alex_garant Alex Garant
| ?wizards_artist.gilbert_garcin Gilbert Garcin
| ?wizards_artist.michael_and_inessa_garmash Michael and Inessa Garmash
| ?wizards_artist.antoni_gaudi Antoni Gaudi
| 3 ?wizards_artist.jack_gaughan Jack Gaughan
| ?wizards_artist.paul_gauguin Paul Gauguin
| ?wizards_artist.giovanni_battista_gaulli Giovanni Battista Gaulli
| ?wizards_artist.anne_geddes Anne Geddes
| ?wizards_artist.bill_gekas Bill Gekas
| ?wizards_artist.artemisia_gentileschi Artemisia Gentileschi
| ?wizards_artist.orazio_gentileschi Orazio Gentileschi
| ?wizards_artist.daniel_f_gerhartz Daniel F. Gerhartz
| ?wizards_artist.theodore_gericault Théodore Géricault
| ?wizards_artist.jean_leon_gerome Jean-Léon Gérôme
| ?wizards_artist.mark_gertler Mark Gertler
| ?wizards_artist.atey_ghailan Atey Ghailan
| ?wizards_artist.alberto_giacometti Alberto Giacometti
| ?wizards_artist.donato_giancola Donato Giancola
| ?wizards_artist.hr_giger H.R. Giger
| ?wizards_artist.james_gilleard James Gilleard
| ?wizards_artist.harold_gilman Harold Gilman
| ?wizards_artist.charles_ginner Charles Ginner
| ?wizards_artist.jean_giraud Jean Giraud
| ?wizards_artist.anne_louis_girodet Anne-Louis Girodet
| ?wizards_artist.milton_glaser Milton Glaser
| ?wizards_artist.warwick_goble Warwick Goble
| ?wizards_artist.john_william_godward John William Godward
| ?wizards_artist.sacha_goldberger Sacha Goldberger
| ?wizards_artist.nan_goldin Nan Goldin
| ?wizards_artist.josan_gonzalez Josan Gonzalez
| ?wizards_artist.felix_gonzalez_torres Felix Gonzalez-Torres
| ?wizards_artist.derek_gores Derek Gores
| ?wizards_artist.edward_gorey Edward Gorey
| ?wizards_artist.arshile_gorky Arshile Gorky
| ?wizards_artist.alessandro_gottardo Alessandro Gottardo
| ?wizards_artist.adolph_gottlieb Adolph Gottlieb
| ?wizards_artist.francisco_goya Francisco Goya
| ?wizards_artist.laurent_grasso Laurent Grasso
| ?wizards_artist.mab_graves Mab Graves
| ?wizards_artist.eileen_gray Eileen Gray
| ?wizards_artist.kate_greenaway Kate Greenaway
| ?wizards_artist.alex_grey Alex Grey
| ?wizards_artist.carne_griffiths Carne Griffiths
| ?wizards_artist.gris_grimly Gris Grimly
| ?wizards_artist.brothers_grimm Brothers Grimm
| ?wizards_artist.tracie_grimwood Tracie Grimwood
| ?wizards_artist.matt_groening Matt Groening
| ?wizards_artist.alex_gross Alex Gross
| ?wizards_artist.tom_grummett Tom Grummett
| ?wizards_artist.huang_guangjian Huang Guangjian
| ?wizards_artist.wu_guanzhong Wu Guanzhong
| ?wizards_artist.rebecca_guay Rebecca Guay
| ?wizards_artist.guercino Guercino
| ?wizards_artist.jeannette_guichard_bunel Jeannette Guichard-Bunel
| ?wizards_artist.scott_gustafson Scott Gustafson
| ?wizards_artist.wade_guyton Wade Guyton
| ?wizards_artist.hans_haacke Hans Haacke
| ?wizards_artist.robert_hagan Robert Hagan
| ?wizards_artist.philippe_halsman Philippe Halsman
| ?wizards_artist.maggi_hambling Maggi Hambling
| ?wizards_artist.richard_hamilton Richard Hamilton
| ?wizards_artist.bess_hamiti Bess Hamiti
| ?wizards_artist.tom_hammick Tom Hammick
| ?wizards_artist.david_hammons David Hammons
| ?wizards_artist.ren_hang Ren Hang
| ?wizards_artist.erin_hanson Erin Hanson
| ?wizards_artist.keith_haring Keith Haring
| ?wizards_artist.alexei_harlamoff Alexei Harlamoff
| ?wizards_artist.charley_harper Charley Harper
| ?wizards_artist.john_harris John Harris
| ?wizards_artist.florence_harrison Florence Harrison
| ?wizards_artist.marsden_hartley Marsden Hartley
| ?wizards_artist.ryohei_hase Ryohei Hase
| ?wizards_artist.childe_hassam Childe Hassam
| ?wizards_artist.ben_hatke Ben Hatke
| ?wizards_artist.mona_hatoum Mona Hatoum
| ?wizards_artist.pam_hawkes Pam Hawkes
| ?wizards_artist.jamie_hawkesworth Jamie Hawkesworth
| ?wizards_artist.stuart_haygarth Stuart Haygarth
| ?wizards_artist.erich_heckel Erich Heckel
| ?wizards_artist.valerie_hegarty Valerie Hegarty
| ?wizards_artist.mary_heilmann Mary Heilmann
| ?wizards_artist.michael_heizer Michael Heizer
| ?wizards_artist.gottfried_helnwein Gottfried Helnwein
| ?wizards_artist.barkley_l_hendricks Barkley L. Hendricks
| ?wizards_artist.bill_henson Bill Henson
| ?wizards_artist.barbara_hepworth Barbara Hepworth
| ?wizards_artist.herge Hergé
| ?wizards_artist.carolina_herrera Carolina Herrera
| ?wizards_artist.george_herriman George Herriman
| ?wizards_artist.don_hertzfeldt Don Hertzfeldt
| ?wizards_artist.prudence_heward Prudence Heward
| ?wizards_artist.ryan_hewett Ryan Hewett
| ?wizards_artist.nora_heysen Nora Heysen
| ?wizards_artist.george_elgar_hicks George Elgar Hicks
| ?wizards_artist.lorenz_hideyoshi Lorenz Hideyoshi
| ?wizards_artist.brothers_hildebrandt Brothers Hildebrandt
| ?wizards_artist.dan_hillier Dan Hillier
| ?wizards_artist.lewis_hine Lewis Hine
| ?wizards_artist.miho_hirano Miho Hirano
| ?wizards_artist.harumi_hironaka Harumi Hironaka
| ?wizards_artist.hiroshige Hiroshige
| ?wizards_artist.morris_hirshfield Morris Hirshfield
| ?wizards_artist.damien_hirst Damien Hirst
| ?wizards_artist.fan_ho Fan Ho
| ?wizards_artist.meindert_hobbema Meindert Hobbema
| ?wizards_artist.david_hockney David Hockney
| ?wizards_artist.filip_hodas Filip Hodas
| ?wizards_artist.howard_hodgkin Howard Hodgkin
| ?wizards_artist.ferdinand_hodler Ferdinand Hodler
| ?wizards_artist.tiago_hoisel Tiago Hoisel
| ?wizards_artist.katsushika_hokusai Katsushika Hokusai
| ?wizards_artist.hans_holbein_the_younger Hans Holbein the Younger
| ?wizards_artist.frank_holl Frank Holl
| ?wizards_artist.carsten_holler Carsten Holler
| ?wizards_artist.zena_holloway Zena Holloway
| ?wizards_artist.edward_hopper Edward Hopper
| ?wizards_artist.aaron_horkey Aaron Horkey
| ?wizards_artist.alex_horley Alex Horley
| ?wizards_artist.roni_horn Roni Horn
| ?wizards_artist.john_howe John Howe
| ?wizards_artist.alex_howitt Alex Howitt
| ?wizards_artist.meghan_howland Meghan Howland
| ?wizards_artist.john_hoyland John Hoyland
| ?wizards_artist.shilin_huang Shilin Huang
| ?wizards_artist.arthur_hughes Arthur Hughes
| ?wizards_artist.edward_robert_hughes Edward Robert Hughes
| ?wizards_artist.jack_hughes Jack Hughes
| ?wizards_artist.talbot_hughes Talbot Hughes
| ?wizards_artist.pieter_hugo Pieter Hugo
| ?wizards_artist.gary_hume Gary Hume
| ?wizards_artist.friedensreich_hundertwasser Friedensreich Hundertwasser
| ?wizards_artist.william_holman_hunt William Holman Hunt
| ?wizards_artist.george_hurrell George Hurrell
| ?wizards_artist.fabio_hurtado Fabio Hurtado
| ?wizards_artist.hush HUSH
| ?wizards_artist.michael_hutter Michael Hutter
| ?wizards_artist.pierre_huyghe Pierre Huyghe
| ?wizards_artist.doug_hyde Doug Hyde
| ?wizards_artist.louis_icart Louis Icart
| ?wizards_artist.robert_indiana Robert Indiana
| ?wizards_artist.jean_auguste_dominique_ingres Jean Auguste Dominique Ingres
| ?wizards_artist.robert_irwin Robert Irwin
| ?wizards_artist.gabriel_isak Gabriel Isak
| ?wizards_artist.junji_ito Junji Ito
| ?wizards_artist.christophe_jacrot Christophe Jacrot
| ?wizards_artist.louis_janmot Louis Janmot
| ?wizards_artist.frieke_janssens Frieke Janssens
| ?wizards_artist.alexander_jansson Alexander Jansson
| ?wizards_artist.tove_jansson Tove Jansson
| ?wizards_artist.aaron_jasinski Aaron Jasinski
| ?wizards_artist.alexej_von_jawlensky Alexej von Jawlensky
| ?wizards_artist.james_jean James Jean
| ?wizards_artist.oliver_jeffers Oliver Jeffers
| ?wizards_artist.lee_jeffries Lee Jeffries
| ?wizards_artist.georg_jensen Georg Jensen
| ?wizards_artist.ellen_jewett Ellen Jewett
| ?wizards_artist.he_jiaying He Jiaying
| ?wizards_artist.chantal_joffe Chantal Joffe
| ?wizards_artist.martine_johanna Martine Johanna
| ?wizards_artist.augustus_john Augustus John
| ?wizards_artist.gwen_john Gwen John
| ?wizards_artist.jasper_johns Jasper Johns
| ?wizards_artist.eastman_johnson Eastman Johnson
| ?wizards_artist.alfred_cheney_johnston Alfred Cheney Johnston
| ?wizards_artist.dorothy_johnstone Dorothy Johnstone
| ?wizards_artist.android_jones Android Jones
| ?wizards_artist.erik_jones Erik Jones
| ?wizards_artist.jeffrey_catherine_jones Jeffrey Catherine Jones
| ?wizards_artist.peter_andrew_jones Peter Andrew Jones
| ?wizards_artist.loui_jover Loui Jover
| ?wizards_artist.amy_judd Amy Judd
| ?wizards_artist.donald_judd Donald Judd
| ?wizards_artist.jean_jullien Jean Jullien
| ?wizards_artist.matthias_jung Matthias Jung
| ?wizards_artist.joe_jusko Joe Jusko
| ?wizards_artist.frida_kahlo Frida Kahlo
| ?wizards_artist.hayv_kahraman Hayv Kahraman
| ?wizards_artist.mw_kaluta M.W. Kaluta
| ?wizards_artist.nadav_kander Nadav Kander
| ?wizards_artist.wassily_kandinsky Wassily Kandinsky
| ?wizards_artist.jun_kaneko Jun Kaneko
| ?wizards_artist.titus_kaphar Titus Kaphar
| ?wizards_artist.michal_karcz Michal Karcz
| ?wizards_artist.gertrude_kasebier Gertrude Käsebier
| ?wizards_artist.terada_katsuya Terada Katsuya
| ?wizards_artist.audrey_kawasaki Audrey Kawasaki
| ?wizards_artist.hasui_kawase Hasui Kawase
| ?wizards_artist.glen_keane Glen Keane
| ?wizards_artist.margaret_keane Margaret Keane
| ?wizards_artist.ellsworth_kelly Ellsworth Kelly
| ?wizards_artist.michael_kenna Michael Kenna
| ?wizards_artist.thomas_benjamin_kennington Thomas Benjamin Kennington
| ?wizards_artist.william_kentridge William Kentridge
| ?wizards_artist.hendrik_kerstens Hendrik Kerstens
| ?wizards_artist.jeremiah_ketner Jeremiah Ketner
| ?wizards_artist.fernand_khnopff Fernand Khnopff
| ?wizards_artist.hideyuki_kikuchi Hideyuki Kikuchi
| ?wizards_artist.tom_killion Tom Killion
| ?wizards_artist.thomas_kinkade Thomas Kinkade
| ?wizards_artist.jack_kirby Jack Kirby
| ?wizards_artist.ernst_ludwig_kirchner Ernst Ludwig Kirchner
| ?wizards_artist.tatsuro_kiuchi Tatsuro Kiuchi
| ?wizards_artist.jon_klassen Jon Klassen
| ?wizards_artist.paul_klee Paul Klee
| ?wizards_artist.william_klein William Klein
| ?wizards_artist.yves_klein Yves Klein
| ?wizards_artist.carl_kleiner Carl Kleiner
| ?wizards_artist.gustav_klimt Gustav Klimt
| ?wizards_artist.godfrey_kneller Godfrey Kneller
| ?wizards_artist.emily_kame_kngwarreye Emily Kame Kngwarreye
| ?wizards_artist.chad_knight Chad Knight
| ?wizards_artist.nick_knight Nick Knight
| ?wizards_artist.helene_knoop Helene Knoop
| ?wizards_artist.phil_koch Phil Koch
| ?wizards_artist.kazuo_koike Kazuo Koike
| ?wizards_artist.oskar_kokoschka Oskar Kokoschka
| ?wizards_artist.kathe_kollwitz Käthe Kollwitz
| ?wizards_artist.michael_komarck Michael Komarck
| ?wizards_artist.satoshi_kon Satoshi Kon
| ?wizards_artist.jeff_koons Jeff Koons
| ?wizards_artist.caia_koopman Caia Koopman
| ?wizards_artist.konstantin_korovin Konstantin Korovin
| ?wizards_artist.mark_kostabi Mark Kostabi
| ?wizards_artist.bella_kotak Bella Kotak
| ?wizards_artist.andrea_kowch Andrea Kowch
| ?wizards_artist.lee_krasner Lee Krasner
| ?wizards_artist.barbara_kruger Barbara Kruger
| ?wizards_artist.brad_kunkle Brad Kunkle
| ?wizards_artist.yayoi_kusama Yayoi Kusama
| ?wizards_artist.michael_k_kutsche Michael K Kutsche
| ?wizards_artist.ilya_kuvshinov Ilya Kuvshinov
| ?wizards_artist.david_lachapelle David LaChapelle
| ?wizards_artist.raphael_lacoste Raphael Lacoste
| ?wizards_artist.lev_lagorio Lev Lagorio
| ?wizards_artist.rene_lalique René Lalique
| ?wizards_artist.abigail_larson Abigail Larson
| ?wizards_artist.gary_larson Gary Larson
| ?wizards_artist.denys_lasdun Denys Lasdun
| ?wizards_artist.maria_lassnig Maria Lassnig
| ?wizards_artist.dorothy_lathrop Dorothy Lathrop
| ?wizards_artist.melissa_launay Melissa Launay
| ?wizards_artist.john_lavery John Lavery
| ?wizards_artist.jacob_lawrence Jacob Lawrence
| ?wizards_artist.thomas_lawrence Thomas Lawrence
| ?wizards_artist.ernest_lawson Ernest Lawson
| ?wizards_artist.bastien_lecouffe_deharme Bastien Lecouffe-Deharme
| ?wizards_artist.alan_lee Alan Lee
| ?wizards_artist.minjae_lee Minjae Lee
| ?wizards_artist.nina_leen Nina Leen
| ?wizards_artist.fernand_leger Fernand Leger
| ?wizards_artist.paul_lehr Paul Lehr
| ?wizards_artist.frederic_leighton Frederic Leighton
| ?wizards_artist.alayna_lemmer Alayna Lemmer
| ?wizards_artist.tamara_de_lempicka Tamara de Lempicka
| ?wizards_artist.sol_lewitt Sol LeWitt
| ?wizards_artist.jc_leyendecker J.C. Leyendecker
| ?wizards_artist.andre_lhote André Lhote
| ?wizards_artist.roy_lichtenstein Roy Lichtenstein
| ?wizards_artist.rob_liefeld Rob Liefeld
| ?wizards_artist.fang_lijun Fang Lijun
| ?wizards_artist.maya_lin Maya Lin
| ?wizards_artist.filippino_lippi Filippino Lippi
| ?wizards_artist.herbert_list Herbert List
| ?wizards_artist.richard_long Richard Long
| ?wizards_artist.yoann_lossel Yoann Lossel
| ?wizards_artist.morris_louis Morris Louis
| ?wizards_artist.sarah_lucas Sarah Lucas
| ?wizards_artist.maximilien_luce Maximilien Luce
| ?wizards_artist.loretta_lux Loretta Lux
| ?wizards_artist.george_platt_lynes George Platt Lynes
| ?wizards_artist.frances_macdonald Frances MacDonald
| ?wizards_artist.august_macke August Macke
| ?wizards_artist.stephen_mackey Stephen Mackey
| ?wizards_artist.rachel_maclean Rachel Maclean
| ?wizards_artist.raimundo_de_madrazo_y_garreta Raimundo de Madrazo y Garreta
| ?wizards_artist.joe_madureira Joe Madureira
| ?wizards_artist.rene_magritte Rene Magritte
| ?wizards_artist.jim_mahfood Jim Mahfood
| ?wizards_artist.vivian_maier Vivian Maier
| ?wizards_artist.aristide_maillol Aristide Maillol
| ?wizards_artist.don_maitz Don Maitz
| ?wizards_artist.laura_makabresku Laura Makabresku
| ?wizards_artist.alex_maleev Alex Maleev
| ?wizards_artist.keith_mallett Keith Mallett
| ?wizards_artist.johji_manabe Johji Manabe
| ?wizards_artist.milo_manara Milo Manara
| ?wizards_artist.edouard_manet Édouard Manet
| ?wizards_artist.henri_manguin Henri Manguin
| ?wizards_artist.jeremy_mann Jeremy Mann
| ?wizards_artist.sally_mann Sally Mann
| ?wizards_artist.andrea_mantegna Andrea Mantegna
| ?wizards_artist.antonio_j_manzanedo Antonio J. Manzanedo
| ?wizards_artist.robert_mapplethorpe Robert Mapplethorpe
| ?wizards_artist.franz_marc Franz Marc
| ?wizards_artist.ivan_marchuk Ivan Marchuk
| ?wizards_artist.brice_marden Brice Marden
| ?wizards_artist.andrei_markin Andrei Markin
| ?wizards_artist.kerry_james_marshall Kerry James Marshall
| ?wizards_artist.serge_marshennikov Serge Marshennikov
| ?wizards_artist.agnes_martin Agnes Martin
| ?wizards_artist.adam_martinakis Adam Martinakis
| ?wizards_artist.stephan_martiniere Stephan Martinière
| ?wizards_artist.ilya_mashkov Ilya Mashkov
| ?wizards_artist.henri_matisse Henri Matisse
| ?wizards_artist.rodney_matthews Rodney Matthews
| ?wizards_artist.anton_mauve Anton Mauve
| ?wizards_artist.peter_max Peter Max
| ?wizards_artist.mike_mayhew Mike Mayhew
| ?wizards_artist.angus_mcbride Angus McBride
| ?wizards_artist.anne_mccaffrey Anne McCaffrey
| ?wizards_artist.robert_mccall Robert McCall
| ?wizards_artist.scott_mccloud Scott McCloud
| ?wizards_artist.steve_mccurry Steve McCurry
| ?wizards_artist.todd_mcfarlane Todd McFarlane
| ?wizards_artist.barry_mcgee Barry McGee
| ?wizards_artist.ryan_mcginley Ryan McGinley
| ?wizards_artist.robert_mcginnis Robert McGinnis
| ?wizards_artist.richard_mcguire Richard McGuire
| ?wizards_artist.patrick_mchale Patrick McHale
| ?wizards_artist.kelly_mckernan Kelly McKernan
| ?wizards_artist.angus_mckie Angus McKie
| ?wizards_artist.alasdair_mclellan Alasdair McLellan
| ?wizards_artist.jon_mcnaught Jon McNaught
| ?wizards_artist.dan_mcpharlin Dan McPharlin
| ?wizards_artist.tara_mcpherson Tara McPherson
| ?wizards_artist.ralph_mcquarrie Ralph McQuarrie
| ?wizards_artist.ian_mcque Ian McQue
| ?wizards_artist.syd_mead Syd Mead
| ?wizards_artist.richard_meier Richard Meier
| ?wizards_artist.maria_sibylla_merian Maria Sibylla Merian
| ?wizards_artist.willard_metcalf Willard Metcalf
| ?wizards_artist.gabriel_metsu Gabriel Metsu
| ?wizards_artist.jean_metzinger Jean Metzinger
| ?wizards_artist.michelangelo Michelangelo
| ?wizards_artist.nicolas_mignard Nicolas Mignard
| ?wizards_artist.mike_mignola Mike Mignola
| ?wizards_artist.dimitra_milan Dimitra Milan
| ?wizards_artist.john_everett_millais John Everett Millais
| ?wizards_artist.marilyn_minter Marilyn Minter
| ?wizards_artist.januz_miralles Januz Miralles
| ?wizards_artist.joan_miro Joan Miró
| ?wizards_artist.joan_mitchell Joan Mitchell
| ?wizards_artist.hayao_miyazaki Hayao Miyazaki
| ?wizards_artist.paula_modersohn_becker Paula Modersohn-Becker
| ?wizards_artist.amedeo_modigliani Amedeo Modigliani
| ?wizards_artist.moebius Moebius
| ?wizards_artist.peter_mohrbacher Peter Mohrbacher
| ?wizards_artist.piet_mondrian Piet Mondrian
| ?wizards_artist.claude_monet Claude Monet
| ?wizards_artist.jean_baptiste_monge Jean-Baptiste Monge
| ?wizards_artist.alyssa_monks Alyssa Monks
| ?wizards_artist.alan_moore Alan Moore
| ?wizards_artist.antonio_mora Antonio Mora
| ?wizards_artist.edward_moran Edward Moran
| ?wizards_artist.koji_morimoto Kōji Morimoto
| ?wizards_artist.berthe_morisot Berthe Morisot
| ?wizards_artist.daido_moriyama Daido Moriyama
| ?wizards_artist.james_wilson_morrice James Wilson Morrice
| ?wizards_artist.sarah_morris Sarah Morris
| ?wizards_artist.john_lowrie_morrison John Lowrie Morrison
| ?wizards_artist.igor_morski Igor Morski
| ?wizards_artist.john_kenn_mortensen John Kenn Mortensen
| ?wizards_artist.victor_moscoso Victor Moscoso
| ?wizards_artist.inna_mosina Inna Mosina
| ?wizards_artist.richard_mosse Richard Mosse
| ?wizards_artist.thomas_edwin_mostyn Thomas Edwin Mostyn
| ?wizards_artist.marcel_mouly Marcel Mouly
| ?wizards_artist.emmanuelle_moureaux Emmanuelle Moureaux
| ?wizards_artist.alphonse_mucha Alphonse Mucha
| ?wizards_artist.craig_mullins Craig Mullins
| ?wizards_artist.augustus_edwin_mulready Augustus Edwin Mulready
| ?wizards_artist.dan_mumford Dan Mumford
| ?wizards_artist.edvard_munch Edvard Munch
| ?wizards_artist.alfred_munnings Alfred Munnings
| ?wizards_artist.gabriele_munter Gabriele Münter
| ?wizards_artist.takashi_murakami Takashi Murakami
| ?wizards_artist.patrice_murciano Patrice Murciano
| ?wizards_artist.scott_musgrove Scott Musgrove
| ?wizards_artist.wangechi_mutu Wangechi Mutu
| ?wizards_artist.go_nagai Go Nagai
| ?wizards_artist.hiroshi_nagai Hiroshi Nagai
| ?wizards_artist.patrick_nagel Patrick Nagel
| ?wizards_artist.tibor_nagy Tibor Nagy
| ?wizards_artist.scott_naismith Scott Naismith
| ?wizards_artist.juliana_nan Juliana Nan
| ?wizards_artist.ted_nasmith Ted Nasmith
| ?wizards_artist.todd_nauck Todd Nauck
| ?wizards_artist.bruce_nauman Bruce Nauman
| ?wizards_artist.ernst_wilhelm_nay Ernst Wilhelm Nay
| ?wizards_artist.alice_neel Alice Neel
| ?wizards_artist.keith_negley Keith Negley
| ?wizards_artist.leroy_neiman LeRoy Neiman
| ?wizards_artist.kadir_nelson Kadir Nelson
| ?wizards_artist.odd_nerdrum Odd Nerdrum
| ?wizards_artist.shirin_neshat Shirin Neshat
| ?wizards_artist.mikhail_nesterov Mikhail Nesterov
| ?wizards_artist.jane_newland Jane Newland
| ?wizards_artist.victo_ngai Victo Ngai
| ?wizards_artist.william_nicholson William Nicholson
| ?wizards_artist.florian_nicolle Florian Nicolle
| ?wizards_artist.kay_nielsen Kay Nielsen
| ?wizards_artist.tsutomu_nihei Tsutomu Nihei
| ?wizards_artist.victor_nizovtsev Victor Nizovtsev
| ?wizards_artist.isamu_noguchi Isamu Noguchi
| ?wizards_artist.catherine_nolin Catherine Nolin
| ?wizards_artist.francois_de_nome François De Nomé
| ?wizards_artist.earl_norem Earl Norem
| ?wizards_artist.phil_noto Phil Noto
| ?wizards_artist.georgia_okeeffe Georgia O'Keeffe
| ?wizards_artist.terry_oakes Terry Oakes
| ?wizards_artist.chris_ofili Chris Ofili
| ?wizards_artist.jack_ohman Jack Ohman
| ?wizards_artist.noriyoshi_ohrai Noriyoshi Ohrai
| ?wizards_artist.helio_oiticica Helio Oiticica
| ?wizards_artist.taro_okamoto Tarō Okamoto
| ?wizards_artist.tim_okamura Tim Okamura
| ?wizards_artist.naomi_okubo Naomi Okubo
| ?wizards_artist.atelier_olschinsky Atelier Olschinsky
| ?wizards_artist.greg_olsen Greg Olsen
| ?wizards_artist.oleg_oprisco Oleg Oprisco
| ?wizards_artist.tony_orrico Tony Orrico
| ?wizards_artist.mamoru_oshii Mamoru Oshii
| ?wizards_artist.ida_rentoul_outhwaite Ida Rentoul Outhwaite
| ?wizards_artist.yigal_ozeri Yigal Ozeri
| ?wizards_artist.gabriel_pacheco Gabriel Pacheco
| ?wizards_artist.michael_page Michael Page
| ?wizards_artist.rui_palha Rui Palha
| ?wizards_artist.polixeni_papapetrou Polixeni Papapetrou
| ?wizards_artist.julio_le_parc Julio Le Parc
| ?wizards_artist.michael_parkes Michael Parkes
| ?wizards_artist.philippe_parreno Philippe Parreno
| ?wizards_artist.maxfield_parrish Maxfield Parrish
| ?wizards_artist.alice_pasquini Alice Pasquini
| ?wizards_artist.james_mcintosh_patrick James McIntosh Patrick
| ?wizards_artist.john_pawson John Pawson
| ?wizards_artist.max_pechstein Max Pechstein
| ?wizards_artist.agnes_lawrence_pelton Agnes Lawrence Pelton
| ?wizards_artist.irving_penn Irving Penn
| ?wizards_artist.bruce_pennington Bruce Pennington
| ?wizards_artist.john_perceval John Perceval
| ?wizards_artist.george_perez George Perez
| ?wizards_artist.constant_permeke Constant Permeke
| ?wizards_artist.lilla_cabot_perry Lilla Cabot Perry
| ?wizards_artist.gaetano_pesce Gaetano Pesce
| ?wizards_artist.cleon_peterson Cleon Peterson
| ?wizards_artist.daria_petrilli Daria Petrilli
| ?wizards_artist.raymond_pettibon Raymond Pettibon
| ?wizards_artist.coles_phillips Coles Phillips
| ?wizards_artist.francis_picabia Francis Picabia
| ?wizards_artist.pablo_picasso Pablo Picasso
| ?wizards_artist.sopheap_pich Sopheap Pich
| ?wizards_artist.otto_piene Otto Piene
| ?wizards_artist.jerry_pinkney Jerry Pinkney
| ?wizards_artist.pinturicchio Pinturicchio
| ?wizards_artist.sebastiano_del_piombo Sebastiano del Piombo
| ?wizards_artist.camille_pissarro Camille Pissarro
| ?wizards_artist.ferris_plock Ferris Plock
| ?wizards_artist.bill_plympton Bill Plympton
| ?wizards_artist.willy_pogany Willy Pogany
| ?wizards_artist.patricia_polacco Patricia Polacco
| ?wizards_artist.jackson_pollock Jackson Pollock
| ?wizards_artist.beatrix_potter Beatrix Potter
| ?wizards_artist.edward_henry_potthast Edward Henry Potthast
| ?wizards_artist.simon_prades Simon Prades
| ?wizards_artist.maurice_prendergast Maurice Prendergast
| ?wizards_artist.dod_procter Dod Procter
| ?wizards_artist.leo_putz Leo Putz
| ?wizards_artist.howard_pyle Howard Pyle
| ?wizards_artist.arthur_rackham Arthur Rackham
| ?wizards_artist.natalia_rak Natalia Rak
| ?wizards_artist.paul_ranson Paul Ranson
| ?wizards_artist.raphael Raphael
| ?wizards_artist.abraham_rattner Abraham Rattner
| ?wizards_artist.jan_van_ravesteyn Jan van Ravesteyn
| ?wizards_artist.aliza_razell Aliza Razell
| ?wizards_artist.paula_rego Paula Rego
| ?wizards_artist.lotte_reiniger Lotte Reiniger
| ?wizards_artist.valentin_rekunenko Valentin Rekunenko
| ?wizards_artist.christoffer_relander Christoffer Relander
| ?wizards_artist.andrey_remnev Andrey Remnev
| ?wizards_artist.pierre_auguste_renoir Pierre-Auguste Renoir
| ?wizards_artist.ilya_repin Ilya Repin
| ?wizards_artist.joshua_reynolds Joshua Reynolds
| ?wizards_artist.rhads RHADS
| ?wizards_artist.bettina_rheims Bettina Rheims
| ?wizards_artist.jason_rhoades Jason Rhoades
| ?wizards_artist.georges_ribemont_dessaignes Georges Ribemont-Dessaignes
| ?wizards_artist.jusepe_de_ribera Jusepe de Ribera
| ?wizards_artist.gerhard_richter Gerhard Richter
| ?wizards_artist.chris_riddell Chris Riddell
| ?wizards_artist.hyacinthe_rigaud Hyacinthe Rigaud
| ?wizards_artist.rembrandt_van_rijn Rembrandt van Rijn
| ?wizards_artist.faith_ringgold Faith Ringgold
| ?wizards_artist.jozsef_rippl_ronai József Rippl-Rónai
| ?wizards_artist.pipilotti_rist Pipilotti Rist
| ?wizards_artist.charles_robinson Charles Robinson
| ?wizards_artist.theodore_robinson Theodore Robinson
| ?wizards_artist.kenneth_rocafort Kenneth Rocafort
| ?wizards_artist.andreas_rocha Andreas Rocha
| ?wizards_artist.norman_rockwell Norman Rockwell
| ?wizards_artist.ludwig_mies_van_der_rohe Ludwig Mies van der Rohe
| ?wizards_artist.fatima_ronquillo Fatima Ronquillo
| ?wizards_artist.salvator_rosa Salvator Rosa
| ?wizards_artist.kerby_rosanes Kerby Rosanes
| ?wizards_artist.conrad_roset Conrad Roset
| ?wizards_artist.bob_ross Bob Ross
| ?wizards_artist.dante_gabriel_rossetti Dante Gabriel Rossetti
| ?wizards_artist.jessica_rossier Jessica Rossier
| ?wizards_artist.marianna_rothen Marianna Rothen
| ?wizards_artist.mark_rothko Mark Rothko
| ?wizards_artist.eva_rothschild Eva Rothschild
| ?wizards_artist.georges_rousse Georges Rousse
| ?wizards_artist.luis_royo Luis Royo
| ?wizards_artist.joao_ruas Joao Ruas
| ?wizards_artist.peter_paul_rubens Peter Paul Rubens
| ?wizards_artist.rachel_ruysch Rachel Ruysch
| ?wizards_artist.albert_pinkham_ryder Albert Pinkham Ryder
| ?wizards_artist.mark_ryden Mark Ryden
| ?wizards_artist.ursula_von_rydingsvard Ursula von Rydingsvard
| ?wizards_artist.theo_van_rysselberghe Theo van Rysselberghe
| ?wizards_artist.eero_saarinen Eero Saarinen
| ?wizards_artist.wlad_safronow Wlad Safronow
| ?wizards_artist.amanda_sage Amanda Sage
| ?wizards_artist.antoine_de_saint_exupery Antoine de Saint-Exupery
| ?wizards_artist.nicola_samori Nicola Samori
| ?wizards_artist.rebeca_saray Rebeca Saray
| ?wizards_artist.john_singer_sargent John Singer Sargent
| ?wizards_artist.martiros_saryan Martiros Saryan
| ?wizards_artist.viviane_sassen Viviane Sassen
| ?wizards_artist.nike_savvas Nike Savvas
| ?wizards_artist.richard_scarry Richard Scarry
| ?wizards_artist.godfried_schalcken Godfried Schalcken
| ?wizards_artist.miriam_schapiro Miriam Schapiro
| ?wizards_artist.kenny_scharf Kenny Scharf
| ?wizards_artist.jerry_schatzberg Jerry Schatzberg
| ?wizards_artist.ary_scheffer Ary Scheffer
| ?wizards_artist.kees_scherer Kees Scherer
| ?wizards_artist.helene_schjerfbeck Helene Schjerfbeck
| ?wizards_artist.christian_schloe Christian Schloe
| ?wizards_artist.karl_schmidt_rottluff Karl Schmidt-Rottluff
| ?wizards_artist.julian_schnabel Julian Schnabel
| ?wizards_artist.fritz_scholder Fritz Scholder
| ?wizards_artist.charles_schulz Charles Schulz
| ?wizards_artist.sean_scully Sean Scully
| ?wizards_artist.ronald_searle Ronald Searle
| ?wizards_artist.mark_seliger Mark Seliger
| ?wizards_artist.anton_semenov Anton Semenov
| ?wizards_artist.edmondo_senatore Edmondo Senatore
| ?wizards_artist.maurice_sendak Maurice Sendak
| ?wizards_artist.richard_serra Richard Serra
| ?wizards_artist.georges_seurat Georges Seurat
| ?wizards_artist.dr_seuss Dr. Seuss
| ?wizards_artist.tanya_shatseva Tanya Shatseva
| ?wizards_artist.natalie_shau Natalie Shau
| ?wizards_artist.barclay_shaw Barclay Shaw
| ?wizards_artist.e_h_shepard E. H. Shepard
| ?wizards_artist.amrita_sher_gil Amrita Sher-Gil
| ?wizards_artist.irene_sheri Irene Sheri
| ?wizards_artist.duffy_sheridan Duffy Sheridan
| ?wizards_artist.cindy_sherman Cindy Sherman
| ?wizards_artist.shozo_shimamoto Shozo Shimamoto
| ?wizards_artist.hikari_shimoda Hikari Shimoda
| ?wizards_artist.makoto_shinkai Makoto Shinkai
| ?wizards_artist.chiharu_shiota Chiharu Shiota
| ?wizards_artist.elizabeth_shippen_green Elizabeth Shippen Green
| ?wizards_artist.masamune_shirow Masamune Shirow
| ?wizards_artist.tim_shumate Tim Shumate
| ?wizards_artist.yuri_shwedoff Yuri Shwedoff
| ?wizards_artist.malick_sidibe Malick Sidibé
| ?wizards_artist.jeanloup_sieff Jeanloup Sieff
| ?wizards_artist.bill_sienkiewicz Bill Sienkiewicz
| ?wizards_artist.marc_simonetti Marc Simonetti
| ?wizards_artist.david_sims David Sims
| ?wizards_artist.andy_singer Andy Singer
| ?wizards_artist.alfred_sisley Alfred Sisley
| ?wizards_artist.sandy_skoglund Sandy Skoglund
| ?wizards_artist.jeffrey_smart Jeffrey Smart
| ?wizards_artist.berndnaut_smilde Berndnaut Smilde
| ?wizards_artist.rodney_smith Rodney Smith
| ?wizards_artist.samantha_keely_smith Samantha Keely Smith
| ?wizards_artist.robert_smithson Robert Smithson
| ?wizards_artist.barbara_stauffacher_solomon Barbara Stauffacher Solomon
| ?wizards_artist.simeon_solomon Simeon Solomon
| ?wizards_artist.hajime_sorayama Hajime Sorayama
| ?wizards_artist.joaquin_sorolla Joaquín Sorolla
| ?wizards_artist.ettore_sottsass Ettore Sottsass
| ?wizards_artist.amadeo_de_souza_cardoso Amadeo de Souza-Cardoso
| ?wizards_artist.millicent_sowerby Millicent Sowerby
| ?wizards_artist.moses_soyer Moses Soyer
| ?wizards_artist.sparth Sparth
| ?wizards_artist.jack_spencer Jack Spencer
| ?wizards_artist.art_spiegelman Art Spiegelman
| ?wizards_artist.simon_stalenhag Simon Stålenhag
| ?wizards_artist.ralph_steadman Ralph Steadman
| ?wizards_artist.philip_wilson_steer Philip Wilson Steer
| ?wizards_artist.william_steig William Steig
| ?wizards_artist.fred_stein Fred Stein
| ?wizards_artist.theophile_steinlen Théophile Steinlen
| ?wizards_artist.brian_stelfreeze Brian Stelfreeze
| ?wizards_artist.frank_stella Frank Stella
| ?wizards_artist.joseph_stella Joseph Stella
| ?wizards_artist.irma_stern Irma Stern
| ?wizards_artist.alfred_stevens Alfred Stevens
| ?wizards_artist.marie_spartali_stillman Marie Spartali Stillman
| ?wizards_artist.stinkfish Stinkfish
| ?wizards_artist.anne_stokes Anne Stokes
| ?wizards_artist.william_stout William Stout
| ?wizards_artist.paul_strand Paul Strand
| ?wizards_artist.linnea_strid Linnea Strid
| ?wizards_artist.john_melhuish_strudwick John Melhuish Strudwick
| ?wizards_artist.drew_struzan Drew Struzan
| ?wizards_artist.tatiana_suarez Tatiana Suarez
| ?wizards_artist.eustache_le_sueur Eustache Le Sueur
| ?wizards_artist.rebecca_sugar Rebecca Sugar
| ?wizards_artist.hiroshi_sugimoto Hiroshi Sugimoto
| ?wizards_artist.graham_sutherland Graham Sutherland
| ?wizards_artist.jan_svankmajer Jan Svankmajer
| ?wizards_artist.raymond_swanland Raymond Swanland
| ?wizards_artist.annie_swynnerton Annie Swynnerton
| ?wizards_artist.stanislaw_szukalski Stanisław Szukalski
| ?wizards_artist.philip_taaffe Philip Taaffe
| ?wizards_artist.hiroyuki_mitsume_takahashi Hiroyuki-Mitsume Takahashi
| ?wizards_artist.dorothea_tanning Dorothea Tanning
| ?wizards_artist.margaret_tarrant Margaret Tarrant
| ?wizards_artist.genndy_tartakovsky Genndy Tartakovsky
| ?wizards_artist.teamlab teamLab
| ?wizards_artist.raina_telgemeier Raina Telgemeier
| ?wizards_artist.john_tenniel John Tenniel
| ?wizards_artist.sir_john_tenniel Sir John Tenniel
| ?wizards_artist.howard_terpning Howard Terpning
| ?wizards_artist.osamu_tezuka Osamu Tezuka
| ?wizards_artist.abbott_handerson_thayer Abbott Handerson Thayer
| ?wizards_artist.heather_theurer Heather Theurer
| ?wizards_artist.mickalene_thomas Mickalene Thomas
| ?wizards_artist.tom_thomson Tom Thomson
| ?wizards_artist.titian Titian
| ?wizards_artist.mark_tobey Mark Tobey
| ?wizards_artist.greg_tocchini Greg Tocchini
| ?wizards_artist.roland_topor Roland Topor
| ?wizards_artist.sergio_toppi Sergio Toppi
| ?wizards_artist.alex_toth Alex Toth
| ?wizards_artist.henri_de_toulouse_lautrec Henri de Toulouse-Lautrec
| ?wizards_artist.ross_tran Ross Tran
| ?wizards_artist.philip_treacy Philip Treacy
| ?wizards_artist.anne_truitt Anne Truitt
| ?wizards_artist.henry_scott_tuke Henry Scott Tuke
| ?wizards_artist.jmw_turner J.M.W. Turner
| ?wizards_artist.james_turrell James Turrell
| ?wizards_artist.john_henry_twachtman John Henry Twachtman
| ?wizards_artist.naomi_tydeman Naomi Tydeman
| ?wizards_artist.euan_uglow Euan Uglow
| ?wizards_artist.daniela_uhlig Daniela Uhlig
| ?wizards_artist.kitagawa_utamaro Kitagawa Utamaro
| ?wizards_artist.christophe_vacher Christophe Vacher
| ?wizards_artist.suzanne_valadon Suzanne Valadon
| ?wizards_artist.thiago_valdi Thiago Valdi
| ?wizards_artist.chris_van_allsburg Chris van Allsburg
| ?wizards_artist.francine_van_hove Francine Van Hove
| ?wizards_artist.jan_van_kessel_the_elder Jan van Kessel the Elder
| ?wizards_artist.remedios_varo Remedios Varo
| ?wizards_artist.nick_veasey Nick Veasey
| ?wizards_artist.diego_velazquez Diego Velázquez
| ?wizards_artist.eve_ventrue Eve Ventrue
| ?wizards_artist.johannes_vermeer Johannes Vermeer
| ?wizards_artist.charles_vess Charles Vess
| ?wizards_artist.roman_vishniac Roman Vishniac
| ?wizards_artist.kelly_vivanco Kelly Vivanco
| ?wizards_artist.brian_m_viveros Brian M. Viveros
| ?wizards_artist.elke_vogelsang Elke Vogelsang
| ?wizards_artist.vladimir_volegov Vladimir Volegov
| ?wizards_artist.robert_vonnoh Robert Vonnoh
| ?wizards_artist.mikhail_vrubel Mikhail Vrubel
| ?wizards_artist.louis_wain Louis Wain
| ?wizards_artist.kara_walker Kara Walker
| ?wizards_artist.josephine_wall Josephine Wall
| ?wizards_artist.bruno_walpoth Bruno Walpoth
| ?wizards_artist.chris_ware Chris Ware
| ?wizards_artist.andy_warhol Andy Warhol
| ?wizards_artist.john_william_waterhouse John William Waterhouse
| ?wizards_artist.bill_watterson Bill Watterson
| ?wizards_artist.george_frederic_watts George Frederic Watts
| ?wizards_artist.walter_ernest_webster Walter Ernest Webster
| ?wizards_artist.hendrik_weissenbruch Hendrik Weissenbruch
| ?wizards_artist.neil_welliver Neil Welliver
| ?wizards_artist.catrin_welz_stein Catrin Welz-Stein
| ?wizards_artist.vivienne_westwood Vivienne Westwood
| ?wizards_artist.michael_whelan Michael Whelan
| ?wizards_artist.james_abbott_mcneill_whistler James Abbott McNeill Whistler
| ?wizards_artist.william_whitaker William Whitaker
| ?wizards_artist.tim_white Tim White
| ?wizards_artist.coby_whitmore Coby Whitmore
| ?wizards_artist.david_wiesner David Wiesner
| ?wizards_artist.kehinde_wiley Kehinde Wiley
| ?wizards_artist.cathy_wilkes Cathy Wilkes
| ?wizards_artist.jessie_willcox_smith Jessie Willcox Smith
| ?wizards_artist.gilbert_williams Gilbert Williams
| ?wizards_artist.kyffin_williams Kyffin Williams
| ?wizards_artist.al_williamson Al Williamson
| ?wizards_artist.wes_wilson Wes Wilson
| ?wizards_artist.mike_winkelmann Mike Winkelmann
| ?wizards_artist.bec_winnel Bec Winnel
| ?wizards_artist.franz_xaver_winterhalter Franz Xaver Winterhalter
| ?wizards_artist.nathan_wirth Nathan Wirth
| ?wizards_artist.wlop WLOP
| ?wizards_artist.brandon_woelfel Brandon Woelfel
| ?wizards_artist.liam_wong Liam Wong
| ?wizards_artist.francesca_woodman Francesca Woodman
| ?wizards_artist.jim_woodring Jim Woodring
| ?wizards_artist.patrick_woodroffe Patrick Woodroffe
| ?wizards_artist.frank_lloyd_wright Frank Lloyd Wright
| ?wizards_artist.sulamith_wulfing Sulamith Wulfing
| ?wizards_artist.nc_wyeth N.C. Wyeth
| ?wizards_artist.rose_wylie Rose Wylie
| ?wizards_artist.stanislaw_wyspianski Stanisław Wyspiański
| ?wizards_artist.takato_yamamoto Takato Yamamoto
| ?wizards_artist.gene_luen_yang Gene Luen Yang
| ?wizards_artist.ikenaga_yasunari Ikenaga Yasunari
| ?wizards_artist.kozo_yokai Kozo Yokai
| ?wizards_artist.sean_yoro Sean Yoro
| ?wizards_artist.chie_yoshii Chie Yoshii
| ?wizards_artist.skottie_young Skottie Young
| ?wizards_artist.masaaki_yuasa Masaaki Yuasa
| ?wizards_artist.konstantin_yuon Konstantin Yuon
| ?wizards_artist.yuumei Yuumei
| ?wizards_artist.william_zorach William Zorach
| ?wizards_artist.ander_zorn Ander Zorn
// artists added by me (ariane-emory)
| ?wizards_artist.ian_miller Ian Miller
| ?wizards_artist.john_zeleznik John Zeleznik
| ?wizards_artist.keith_parkinson Keith Parkinson
| ?wizards_artist.kevin_fales Kevin Fales
| ?wizards_artist.boris_vallejo Boris Vallejo
}}

// The matching list of styles:
@wizards_artist_styles = { @__set_wizards_artists_artist_if_unset
{ ?wizards_artist.zacharias_martin_aagaard landscapes, observational, painting, romanticism, slice-of-life,
| ?wizards_artist.slim_aarons fashion, luxury, nostalgia, pastel-colors, photography, photography-color, social-commentary,
| ?wizards_artist.elenore_abbott art-nouveau, dream-like, ethereal, femininity, mythology, pastel-colors, romanticism, watercolor,
| ?wizards_artist.tomma_abts abstract, angular, color-field, contemporary, geometric, minimalism, modern,
| ?wizards_artist.vito_acconci architecture, conceptual, dark, installation, performance, sculpture,
| ?wizards_artist.andreas_achenbach landscapes, observational, painting, plein-air, romanticism,
| ?wizards_artist.ansel_adams American, high-contrast, landscapes, monochromatic, nature, photography, photography-bw,
| ?wizards_artist.josh_adamski atmospheric, colorful, contemporary, high-contrast, impressionism, landscapes, nature, photography, photography-color, serenity,
| ?wizards_artist.charles_addams cartoon, contemporary, illustration, social-commentary,
| ?wizards_artist.etel_adnan abstract, color-field, colorful, landscapes, nature, serenity, vibrant,
| ?wizards_artist.alena_aenami atmospheric, digital, dream-like, fantasy, landscapes, serenity, surreal, vibrant,
| ?wizards_artist.leonid_afremov atmospheric, cityscapes, colorful, impressionism, nature, vibrant,
| ?wizards_artist.petros_afshar abstract, contemporary, mixed-media, multimedia,
| ?wizards_artist.yaacov_agam abstract, angular, colorful, illusion, interactive, kinetic, vibrant,
| ?wizards_artist.eileen_agar abstract, collage, femininity, nature, vibrant,
| ?wizards_artist.craigie_aitchison expressionism, figurativism, nature, primitivism, vibrant,
| ?wizards_artist.ivan_aivazovsky armenian, battle-scenes, dark, landscapes, painting, portraits, romanticism, russian, seascapes,
| ?wizards_artist.francesco_albani impressionism, landscapes,
| ?wizards_artist.alessio_albi American, expressionism, landscapes, photography, photography-color, portraits,
| ?wizards_artist.miles_aldridge British, consumerism, fashion, femininity, illustration, photography, photography-color, pop-culture,
| ?wizards_artist.john_white_alexander American, art-nouveau, contemporary, expressionism, landscapes, portraits,
| ?wizards_artist.alessandro_allori American, expressionism, landscapes, portraits, renaissance,
| ?wizards_artist.mike_allred comics, illustration, pop-art, superheroes, whimsical,
| ?wizards_artist.lawrence_alma_tadema ancient, flowers, history, opulent, romanticism, victorian,
| ?wizards_artist.lilia_alvarado American, colorful, contemporary, landscapes, photography, photography-color, portraits,
| ?wizards_artist.tarsila_do_amaral abstract, contemporary, cubism, modern, surreal, vibrant,
| ?wizards_artist.ghada_amer abstract, contemporary, messy, portraits,
| ?wizards_artist.cuno_amiet impressionism, landscapes, portraits,
| ?wizards_artist.el_anatsui abstract, African, contemporary, ghanaian, recycled-materials, sculpture, textiles,
| ?wizards_artist.helga_ancher impressionism, observational, painting, realism, slice-of-life,
| ?wizards_artist.sarah_andersen cartoon, collage, comics, contemporary, fashion, femininity, mixed-media,
| ?wizards_artist.richard_anderson dark, digital, fantasy, gothic, grungy, horror, messy, psychedelic, surreal,
| ?wizards_artist.sophie_gengembre_anderson childhood, femininity, painting, portraits, rural-life, victorian,
| ?wizards_artist.wes_anderson colorful, film, nostalgia, pastel-colors, photography, photography-color, surreal, whimsical,
| ?wizards_artist.alex_andreev contemporary, death, displacement, illustration, surreal,
| ?wizards_artist.sofonisba_anguissola dark, portraits, renaissance,
| ?wizards_artist.louis_anquetin impressionism, portraits,
| ?wizards_artist.mary_jane_ansell contemporary, photorealism, portraits, still-life,
| ?wizards_artist.chiho_aoshima colorful, digital, fantasy, Japanese, pop-art, whimsical,
| ?wizards_artist.sabbas_apterus conceptual, dark, digital, dream-like, surreal,
| ?wizards_artist.hirohiko_araki characters, graphic-novel, illustration, Japanese, manga-anime, pop-culture, surreal,
| ?wizards_artist.howard_arkley architecture, colorful, contemporary, futuristic, playful, pop-art, vibrant, whimsical,
| ?wizards_artist.rolf_armstrong art-deco, art-nouveau, characters, fashion, illustration, modern, posters,
| ?wizards_artist.gerd_arntz flat-colors, geometric, graphic-design, high-contrast, minimalism,
| ?wizards_artist.guy_aroch contemporary, fashion, photography, photography-color, portraits,
| ?wizards_artist.miki_asai contemporary, flowers, insects, landscapes, macro-world, minimalism, nature, photography, photography-color, shallow-depth-of-field, vibrant,
| ?wizards_artist.clemens_ascher architecture, contemporary, geometric, minimalism, photography, photography-color, vibrant,
| ?wizards_artist.henry_asencio contemporary, expressionism, figurativism, impressionism, messy, portraits,
| ?wizards_artist.andrew_atroshenko contemporary, figurativism, impressionism, portraits,
| ?wizards_artist.deborah_azzopardi cartoon, colorful, comics, fashion, femininity, pop-art, whimsical,
| ?wizards_artist.lois_van_baarle characters, digital, fantasy, femininity, illustration, pastel-colors, whimsical,
| ?wizards_artist.ingrid_baars American, contemporary, dark, photography, photography-color, portraits,
| ?wizards_artist.anne_bachelier contemporary, dark, dream-like, portraits,
| ?wizards_artist.francis_bacon abstract, British, dark, distortion, expressionism, figurative, portraits, surreal,
| ?wizards_artist.firmin_baes contemporary, impressionism, landscapes, portraits, still-life,
| ?wizards_artist.tom_bagshaw characters, dark, eerie, fantasy, horror, melancholy, surreal,
| ?wizards_artist.karol_bak conceptual, contemporary, impressionism, metamorphosis, painting,
| ?wizards_artist.christopher_balaskas digital, eerie, futuristic, landscapes, outer-space, science-fiction, vibrant,
| ?wizards_artist.benedick_bana 3d-rendering, characters, cyberpunk, dystopia, grungy, industrial, messy, science-fiction,
| ?wizards_artist.banksy anonymous, graffiti, high-contrast, politics, social-commentary, street-art, urban-life,
| ?wizards_artist.george_barbier art-deco, art-nouveau, costumes, fashion, illustration, romanticism, theater,
| ?wizards_artist.cicely_mary_barker characters, childhood, fairies, flowers, folklore, magic, nostalgia, victorian, whimsical,
| ?wizards_artist.wayne_barlowe alien-worlds, creatures, dark, dystopia, eerie, fantasy, mythology, science-fiction,
| ?wizards_artist.will_barnet activism, contemporary, painting, social-commentary,
| ?wizards_artist.matthew_barney conceptual, creatures, film, multimedia, performance, photography, photography-color, sculpture, surreal, video-art,
| ?wizards_artist.angela_barrett animals, fantasy, kids-book, playful, whimsical,
| ?wizards_artist.jean_michel_basquiat African-American, contemporary, expressionism, graffiti, messy, neo-expressionism, punk, street-art,
| ?wizards_artist.lillian_bassman characters, contemporary, fashion, monochromatic, photography, photography-bw, portraits,
| ?wizards_artist.pompeo_batoni baroque, dark, portraits,
| ?wizards_artist.casey_baugh contemporary, dark, drawing, expressionism, portraits,
| ?wizards_artist.chiara_bautista dark, dream-like, fantasy, illusion, magic, mysterious, surreal, whimsical,
| ?wizards_artist.herbert_bayer angular, bauhaus, colorful, contemporary, flat-colors, graphic-design, typography,
| ?wizards_artist.mary_beale baroque, portraits,
| ?wizards_artist.alan_bean astronauts, metaphysics, outer-space, painting, science-fiction,
| ?wizards_artist.romare_bearden African-American, collage, cubism, expressionism, history, urban-life, vibrant,
| ?wizards_artist.cecil_beaton contemporary, fashion, monochromatic, photography, photography-bw, portraits,
| ?wizards_artist.cecilia_beaux American, elegant, femininity, impressionism, portraits,
| ?wizards_artist.jasmine_becket_griffith big-eyes, childhood, colorful, fairies, fantasy, gothic, magic, portraits, romanticism, whimsical,
| ?wizards_artist.vanessa_beecroft contemporary, expressionism, fashion, feminism, nudes, photography, photography-color, surreal,
| ?wizards_artist.beeple 3d-rendering, conceptual, cyberpunk, digital, futuristic, pastel-colors, science-fiction,
| ?wizards_artist.zdzislaw_beksinski contemporary, dark, dream-like, expressionism, fantasy, horror, illustration, surreal,
| ?wizards_artist.katerina_belkina contemporary, femininity, identity, painting, photography, photography-color, portraits,
| ?wizards_artist.julie_bell dragons, fantasy, magic, mythology, nature, wilderness,
| ?wizards_artist.vanessa_bell fauvism, portraits,
| ?wizards_artist.bernardo_bellotto landscapes, observational, painting, plein-air, rococo,
| ?wizards_artist.ambrosius_benson animals, dark, portraits, renaissance,
| ?wizards_artist.stan_berenstain animals, cartoon, family, kids-book, playful, whimsical,
| ?wizards_artist.laura_berger contemporary, flat-colors, geometric, identity, muted-colors,
| ?wizards_artist.jody_bergsma dream-like, ethereal, fairies, fantasy, magic-realism, mythology, watercolor, whimsical,
| ?wizards_artist.john_berkey eerie, fantasy, futuristic, outer-space, science-fiction,
| ?wizards_artist.gian_lorenzo_bernini allegory, baroque, religion, sculpture,
| ?wizards_artist.marta_bevacqua contemporary, dark, photography, photography-color, portraits,
| ?wizards_artist.john_t_biggers African-American, contemporary, harlem-renaissance, modern, mural-painting, social-commentary,
| ?wizards_artist.enki_bilal comics, cyberpunk, dystopia, futuristic, grungy, science-fiction, surreal, urban-life,
| ?wizards_artist.ivan_bilibin art-nouveau, folklore, horses, illustration, kids-book, mythology, ornate, royalty, russian, theater,
| ?wizards_artist.butcher_billy characters, colorful, comics, contemporary, feminism, graphic-design, pop-art, vibrant,
| ?wizards_artist.george_caleb_bingham American, hudson-river-school, landscapes, realism,
| ?wizards_artist.ed_binkley dream-like, ethereal, fantasy, magic, mythology, whimsical,
| ?wizards_artist.george_birrell cityscapes, colorful, contemporary, urban-life, vibrant,
| ?wizards_artist.robert_bissell animals, contemporary, fantasy, impressionism, kids-book, mysterious, nature, painting, plein-air, whimsical, wildlife,
| ?wizards_artist.charles_blackman colorful, painting, portraits,
| ?wizards_artist.mary_blair animation, characters, childhood, illustration, nature, vibrant, whimsical,
| ?wizards_artist.john_blanche elegant, fantasy, French, portraits, science-fiction, warhammer,
| ?wizards_artist.don_blanding architecture, art-deco, high-contrast, minimalism,
| ?wizards_artist.albert_bloch engraving, impressionism, painting, realism, satire, social-commentary,
| ?wizards_artist.hyman_bloom contemporary, expressionism,
| ?wizards_artist.peter_blume conceptual, dark, fantasy, surreal,
| ?wizards_artist.don_bluth animation, cartoon, colorful, contemporary, fantasy, film, whimsical,
| ?wizards_artist.umberto_boccioni colorful, cubism, futurism, muted-colors,
| ?wizards_artist.anna_bocek colorful, figurativism, messy, portraits,
| ?wizards_artist.lee_bogle dream-like, eerie, ethereal, fantasy, portraits,
| ?wizards_artist.louis_leopold_boily contemporary, French, landscapes, nature, painting,
| ?wizards_artist.giovanni_boldini impressionism, portraits,
| ?wizards_artist.enoch_bolles art-nouveau, characters, contemporary, portraits,
| ?wizards_artist.david_bomberg abstract, battle-scenes, cubism, expressionism, muted-colors,
| ?wizards_artist.chesley_bonestell alien-worlds, futuristic, outer-space, science-fiction,
| ?wizards_artist.lee_bontecou abstract, contemporary, mixed-media, sculpture,
| ?wizards_artist.michael_borremans contemporary, low-contrast, portraits, still-life,
| ?wizards_artist.matt_bors comics, flat-colors, graphic-design, satire, social-commentary,
| ?wizards_artist.flora_borsi animals, contemporary, dream-like, photography, photography-color, portraits,
| ?wizards_artist.hieronymus_bosch allegory, fantasy, mysticism, religion, renaissance, surreal, whimsical,
| ?wizards_artist.sam_bosma animation, cartoon, characters, comics, fantasy, playful, whimsical,
| ?wizards_artist.johfra_bosschart dream-like, ethereal, fantasy, magic, mythology, surreal, whimsical,
| ?wizards_artist.fernando_botero animals, contemporary, dream-like, figurativism, portraits, surreal,
| ?wizards_artist.sandro_botticelli dream-like, femininity, figurative, italian, mythology, religion, renaissance,
| ?wizards_artist.william_adolphe_bouguereau female-figures, French, muted-colors, mythology, nudes, painting, realism,
| ?wizards_artist.susan_seddon_boulet dream-like, ethereal, fantasy, femininity, magic, magic-realism, nature, whimsical,
| ?wizards_artist.louise_bourgeois expressionism, feminism, horror, insects, kinetic, sculpture, surreal,
| ?wizards_artist.annick_bouvattier colorful, contemporary, female-figures, photography, photography-color, portraits,
| ?wizards_artist.david_michael_bowers animals, contemporary, dream-like, magic-realism, portraits,
| ?wizards_artist.noah_bradley dark, eerie, fantasy, landscapes,
| ?wizards_artist.aleksi_briclot dark, dystopia, fantasy, gothic, grungy, horror,
| ?wizards_artist.frederick_arthur_bridgman orientalism, portraits,
| ?wizards_artist.renie_britenbucher contemporary, fleeting-moments, painting, portraits,
| ?wizards_artist.romero_britto colorful, contemporary, playful, pop-art, stained-glass, vibrant, whimsical,
| ?wizards_artist.gerald_brom dark, eerie, fantasy, gothic, horror, pulp,
| ?wizards_artist.bronzino dark, portraits, renaissance,
| ?wizards_artist.herman_brood characters, childhood, pop-art, sports,
| ?wizards_artist.mark_brooks comics, fantasy, science-fiction,
| ?wizards_artist.romaine_brooks contemporary, dream-like, low-contrast, portraits,
| ?wizards_artist.troy_brooks contemporary, dark, dream-like, impressionism, oil-painting, portraits, surreal, vibrant,
| ?wizards_artist.broom_lee furniture, not-a-person, sculpture, contemporary,
| ?wizards_artist.allie_brosh autobiographical, comics, flat-colors, whimsical,
| ?wizards_artist.ford_madox_brown portraits, romanticism,
| ?wizards_artist.charles_le_brun baroque, portraits,
| ?wizards_artist.elisabeth_vigee_le_brun baroque, fashion, femininity, portraits,
| ?wizards_artist.james_bullough contemporary, dream-like, portraits, street-art,
| ?wizards_artist.laurel_burch femininity, illustration, nature, vibrant, whimsical,
| ?wizards_artist.alejandro_burdisio atmospheric, dark, digital, eerie, fantasy, landscapes, magic, science-fiction,
| ?wizards_artist.daniel_buren conceptual, contemporary, installation, minimalism, sculpture, vibrant,
| ?wizards_artist.jon_burgerman colorful, contemporary, illustration, playful, pop-art, vibrant,
| ?wizards_artist.richard_burlet art-nouveau, characters, cityscapes, figurative, French, impressionism, urban-life,
| ?wizards_artist.jim_burns characters, cyberpunk, dark, dystopia, futuristic, noir, science-fiction, urban-life,
| ?wizards_artist.stasia_burrington animals, contemporary, portraits, watercolor, whimsical,
| ?wizards_artist.kaethe_butcher contemporary, messy, portraits,
| ?wizards_artist.saturno_butto contemporary, dream-like, figurativism, portraits,
| ?wizards_artist.paul_cadmus contemporary, nudes, portraits,
| ?wizards_artist.zhichao_cai digital, dream-like, ethereal, fantasy, magic, surreal,
| ?wizards_artist.randolph_caldecott animals, British, illustration, kids-book, nature, playful,
| ?wizards_artist.alexander_calder_milne abstract, geometric, interactive, kinetic, metalwork, minimalism, modern, sculpture,
| ?wizards_artist.clyde_caldwell fantasy, female-figures, mythology, pulp, science-fiction,
| ?wizards_artist.vincent_callebaut 3d-rendering, architecture, cyberpunk, dystopia, fantasy, futuristic, science-fiction, surreal, utopia,
| ?wizards_artist.fred_calleri colorful, expressionism, mixed-media, portraits, sculpture, whimsical,
| ?wizards_artist.charles_camoin colorful, fauvism, landscapes, portraits,
| ?wizards_artist.mike_campau 3d-rendering, conceptual, contemporary, digital, landscapes, urban-life,
| ?wizards_artist.eric_canete characters, comics, fantasy, superheroes,
| ?wizards_artist.josef_capek expressionism, fauvism, portraits,
| ?wizards_artist.leonetto_cappiello art-nouveau, color-field, colorful, graphic-design, mixed-media, muted-colors, posters,
| ?wizards_artist.eric_carle animals, colorful, interactive, kids-book, playful,
| ?wizards_artist.larry_carlson colorful, digital, dream-like, nature, psychedelic, surreal, vibrant,
| ?wizards_artist.bill_carman playful, pop-art, psychedelic, surreal, whimsical,
| ?wizards_artist.jean_baptiste_carpeaux French, portraits, romanticism, sculpture,
| ?wizards_artist.rosalba_carriera baroque, portraits,
| ?wizards_artist.michael_carson characters, contemporary, figurativism, impressionism, portraits,
| ?wizards_artist.felice_casorati expressionism, impressionism, portraits, still-life,
| ?wizards_artist.mary_cassatt characters, impressionism, pastel, portraits,
| ?wizards_artist.a_j_casson contemporary, landscapes, mathematics, painting, punk,
| ?wizards_artist.giorgio_barbarelli_da_castelfranco painting, renaissance, rococo,
| ?wizards_artist.paul_catherall architecture, flat-colors, geometric, graphic-design, minimalism, urban-life,
| ?wizards_artist.george_catlin animals, contemporary, portraits,
| ?wizards_artist.patrick_caulfield colorful, contemporary, geometric, minimalism, pop-art, vibrant,
| ?wizards_artist.nicoletta_ceccoli animals, big-eyes, childhood, contemporary, dark, dream-like, portraits, surreal, whimsical,
| ?wizards_artist.agnes_cecile contemporary, messy, portraits, watercolor,
| ?wizards_artist.paul_cezanne cubism, geometric, impressionism, landscapes, post-impressionism, romanticism, still-life,
| ?wizards_artist.paul_chabas figurativism, impressionism, nudes, portraits,
| ?wizards_artist.marc_chagall colorful, dream-like, fauvism, folklore, French, impressionism, jewish, romanticism, russian,
| ?wizards_artist.tom_chambers contemporary, fleeting-moments, illustration, observational,
| ?wizards_artist.katia_chausheva contemporary, dark, photography, photography-color, portraits,
| ?wizards_artist.hsiao_ron_cheng digital, fashion, femininity, minimalism, mixed-media, pastel-colors, pop-art, portraits,
| ?wizards_artist.yanjun_cheng contemporary, digital, dream-like, eerie, femininity, illustration, portraits, whimsical,
| ?wizards_artist.sandra_chevrier animals, comics, contemporary, dream-like, portraits,
| ?wizards_artist.judy_chicago abstract, activism, empowerment, femininity, feminism, installation, psychedelic, sculpture, vibrant,
| ?wizards_artist.dale_chihuly abstract, contemporary, organic, sculpture, vibrant,
| ?wizards_artist.frank_cho colorful, comics, drawing, fantasy, superheroes,
| ?wizards_artist.james_c_christensen American, dream-like, ethereal, illustration, kids-book, magic, mysterious, mythology, religion, whimsical,
| ?wizards_artist.mikalojus_konstantinas_ciurlionis art-nouveau, dark, lithuanian, mysticism, spirituality, symbolist,
| ?wizards_artist.alson_skinner_clark atmospheric, impressionism, landscapes, seascapes,
| ?wizards_artist.amanda_clark characters, dream-like, ethereal, landscapes, magic, watercolor, whimsical,
| ?wizards_artist.harry_clarke dark, folklore, illustration, irish, stained-glass,
| ?wizards_artist.george_clausen observational, painting, plein-air, realism,
| ?wizards_artist.francesco_clemente contemporary, dream-like, figurativism, italian, portraits,
| ?wizards_artist.alvin_langdon_coburn architecture, atmospheric, photography, photography-bw,
| ?wizards_artist.clifford_coffin colorful, fashion, photography, photography-color, pop-art, portraits, urban-life,
| ?wizards_artist.vince_colletta American, comics, superheroes,
| ?wizards_artist.beth_conklin childhood, contemporary, dream-like, fashion, nature, photography, photography-color, portraits, urban-life,
| ?wizards_artist.john_constable British, dark, landscapes, nature, oil-painting, romanticism, skies,
| ?wizards_artist.darwyn_cooke cartoon, comics, contemporary, illustration,
| ?wizards_artist.richard_corben comics, dark, eerie, horror, science-fiction,
| ?wizards_artist.vittorio_matteo_corcos colorful, fantasy, impressionism, portraits, romanticism,
| ?wizards_artist.paul_corfield cartoon, landscapes, nature, playful, satire, vibrant, whimsical,
| ?wizards_artist.fernand_cormon impressionism, observational, painting, realism,
| ?wizards_artist.norman_cornish portraits, realism, watercolor, whimsical,
| ?wizards_artist.camille_corot color-field, femininity, impressionism, landscapes, nature, portraits, romanticism,
| ?wizards_artist.gemma_correll cartoon, flat-colors, graphic-design, high-contrast, playful, whimsical,
| ?wizards_artist.petra_cortright digital, expressionism, impressionism, messy, nature, vibrant,
| ?wizards_artist.lorenzo_costa_the_elder allegory, painting, religion, religion, renaissance,
| ?wizards_artist.olive_cotton australian, modern, monochromatic, nature, photography, photography-bw,
| ?wizards_artist.peter_coulson minimalism, monochromatic, nudes, photography, photography-bw, portraits, street-art, urban-life,
| ?wizards_artist.gustave_courbet environmentalism, impressionism, nature, portraits, realism, romanticism, social-commentary, watercolor,
| ?wizards_artist.frank_cadogan_cowper British, history, opulent, romanticism, victorian,
| ?wizards_artist.kinuko_y_craft American, colorful, dream-like, fantasy, folklore, illustration, kids-book, royalty,
| ?wizards_artist.clayton_crain characters, comics, digital, fantasy, illustration, science-fiction,
| ?wizards_artist.lucas_cranach_the_elder allegory, painting, religion, religion, renaissance,
| ?wizards_artist.lucas_cranach_the_younger femininity, German, history, mythology, portraits, religion, renaissance,
| ?wizards_artist.walter_crane British, engraving, folklore, illustration, kids-book, nostalgia,
| ?wizards_artist.martin_creed abstract, British, conceptual, expressionism, installation, interactive, minimalism, playful,
| ?wizards_artist.gregory_crewdson American, dark, eerie, photography, photography-color, suburbia, surreal,
| ?wizards_artist.debbie_criswell landscapes, playful, surreal, whimsical,
| ?wizards_artist.victoria_crowe figurativism, impressionism, landscapes, nature, portraits, romanticism, whimsical,
| ?wizards_artist.etam_cru colorful, contemporary, graffiti, large-scale, portraits, social-commentary, street-art, urban-life,
| ?wizards_artist.robert_crumb American, characters, comics, counter-culture, satire, underground,
| ?wizards_artist.carlos_cruz_diez conceptual, illusion, kinetic, light-art,
| ?wizards_artist.john_currin characters, conceptual, fashion, femininity, figurativism, portraits, whimsical,
| ?wizards_artist.krenz_cushart characters, digital, fantasy, illustration, manga-anime, portraits, whimsical,
| ?wizards_artist.camilla_derrico big-eyes, childhood, contemporary, fantasy, nature, portraits, vibrant, watercolor, whimsical,
| ?wizards_artist.pino_daeni femininity, figurative, nostalgia, painting, romanticism,
| ?wizards_artist.salvador_dali dark, dream-like, dreams, illusion, metaphysics, oil-painting, spanish, surreal,
| ?wizards_artist.sunil_das contemporary, figurative, identity, portraits,
| ?wizards_artist.ian_davenport abstract, colorful, contemporary, geometric, modern, vibrant,
| ?wizards_artist.stuart_davis abstract, American, cubism, rural-life, social-realism,
| ?wizards_artist.roger_dean dream-like, eerie, ethereal, fantasy, landscapes, magic, posters, science-fiction,
| ?wizards_artist.michael_deforge cartoon, pop-art, satire, surreal, whimsical,
| ?wizards_artist.edgar_degas ballet, dancers, femininity, French, impressionism, pastel, portraits,
| ?wizards_artist.eugene_delacroix French, history, muted-colors, oil-painting, orientalism, romanticism, sketching,
| ?wizards_artist.robert_delaunay abstract, contemporary, cubism, geometric, modern, vibrant,
| ?wizards_artist.sonia_delaunay abstract, cubism, fashion, fauvism, female-figures, French, geometric, modern,
| ?wizards_artist.gabriele_dellotto comics, fantasy,
| ?wizards_artist.nicolas_delort dark, eerie, fantasy, gothic, horror, labyrinths, monochromatic,
| ?wizards_artist.jean_delville dream-like, fantasy, magic, metaphysics, surreal,
| ?wizards_artist.posuka_demizu adventure, contemporary, fantasy, illustration, manga-anime, playful, whimsical,
| ?wizards_artist.guy_denning colorful, conceptual, expressionism, messy, portraits, social-commentary,
| ?wizards_artist.monsu_desiderio contemporary, figurative, surreal,
| ?wizards_artist.charles_maurice_detmold animals, art-nouveau, botanical, British, delicate, ethereal, illustration, kids-book, nature, opulent, victorian, watercolor,
| ?wizards_artist.edward_julius_detmold animals, art-nouveau, botanical, British, delicate, illustration, kids-book, nature, opulent, victorian, watercolor,
| ?wizards_artist.anne_dewailly characters, fashion, figurativism, identity, multimedia, photorealism, portraits, whimsical,
| ?wizards_artist.walt_disney adventure, animation, cartoon, characters, contemporary, folklore, whimsical,
| ?wizards_artist.tony_diterlizzi creatures, fantasy, magic, playful, whimsical,
| ?wizards_artist.anna_dittmann digital, dream-like, ethereal, fantasy, mysterious, pastel-colors, portraits,
| ?wizards_artist.dima_dmitriev figure-studies, impressionism, landscapes, nature, oil-painting, romanticism,
| ?wizards_artist.peter_doig British, canadian, dream-like, figurativism, landscapes, large-scale, nature,
| ?wizards_artist.kees_van_dongen colorful, expressionism, fauvism, femininity, Japanese, portraits, urban-life,
| ?wizards_artist.gustave_dore engraving, fantasy, gothic, monochromatic, mythology,
| ?wizards_artist.dave_dorman dark, fantasy, horror, photorealism, science-fiction,
| ?wizards_artist.emilio_giuseppe_dossena conceptual, contemporary, metaphysics, sculpture,
| ?wizards_artist.david_downton conceptual, expressionism, high-contrast, minimalism, portraits, whimsical,
| ?wizards_artist.jessica_drossin fantasy, femininity, impressionism, magic-realism, photography, photography-color, portraits, whimsical,
| ?wizards_artist.philippe_druillet comics, contemporary, fantasy, French, science-fiction,
| ?wizards_artist.tj_drysdale dream-like, eerie, ethereal, landscapes, magic, photography, photography-color, shallow-depth-of-field,
| ?wizards_artist.ton_dubbeldam architecture, colorful, conceptual, contemporary, Dutch, geometric, landscapes, pointillism,
| ?wizards_artist.marcel_duchamp conceptual, cubism, dadaism, expressionism, fauvism, impressionism, surreal,
| ?wizards_artist.joseph_ducreux French, portraits, self-portraits, whimsical,
| ?wizards_artist.edmund_dulac dream-like, folklore, French, illustration, kids-book, magic, orientalism, romanticism,
| ?wizards_artist.marlene_dumas African-American, contemporary, expressionism, femininity, impressionism, nature, portraits, watercolor,
| ?wizards_artist.charles_dwyer impressionism, messy, nature, portraits, watercolor, whimsical,
| ?wizards_artist.william_dyce baroque, impressionism, portraits, realism, renaissance, romanticism,
| ?wizards_artist.chris_dyer colorful, contemporary, expressionism, pop-art, psychedelic, surreal, vibrant,
| ?wizards_artist.eyvind_earle colorful, dream-like, high-contrast, magic-realism, surreal, whimsical,
| ?wizards_artist.amy_earles abstract-expressionism, American, characters, dark, gestural, watercolor, whimsical,
| ?wizards_artist.lori_earley big-eyes, contemporary, dream-like, expressionism, figurativism, nature, portraits, whimsical,
| ?wizards_artist.jeff_easley fantasy,
| ?wizards_artist.tristan_eaton characters, collage, colorful, graphic-design, pop-art, street-art, vibrant,
| ?wizards_artist.jason_edmiston characters, dark, eerie, ethereal, fantasy, horror, illustration, portraits,
| ?wizards_artist.alfred_eisenstaedt conceptual, fashion, high-contrast, monochromatic, photography, photography-bw, portraits, whimsical,
| ?wizards_artist.jesper_ejsing adventure, characters, fantasy, illustration, magic, mythology, whimsical,
| ?wizards_artist.olafur_eliasson contemporary, environmentalism, immersive, installation, nature,
| ?wizards_artist.harrison_ellenshaw landscapes, painting, realism,
| ?wizards_artist.christine_ellger dream-like, ethereal, fantasy, folklore, illustration, magic-realism, surreal,
| ?wizards_artist.larry_elmore battle-scenes, fantasy, illustration, medieval, superheroes,
| ?wizards_artist.joseba_elorza collage, dream-like, outer-space, photography, photography-color, science-fiction, surreal,
| ?wizards_artist.peter_elson futuristic, illustration, outer-space, robots-cyborgs, science-fiction, space-ships,
| ?wizards_artist.gil_elvgren American, female-figures, femininity, illustration, pulp,
| ?wizards_artist.ed_emshwiller aliens, colorful, illustration, outer-space, pulp, science-fiction,
| ?wizards_artist.kilian_eng atmospheric, digital, fantasy, illustration, landscapes, science-fiction,
| ?wizards_artist.jason_a_engle creatures, dark, fantasy, illustration,
| ?wizards_artist.max_ernst automatism, collage, dadaism, expressionism, German, mythology, oil-painting, surreal,
| ?wizards_artist.romain_de_tirtoff_erte art-deco, fashion, luxury, masks, russian, silhouettes, theater,
| ?wizards_artist.m_c_escher angular, Dutch, geometric, illusion, lithography, mathematics, surreal, woodblock,
| ?wizards_artist.tim_etchells conceptual, conceptual, contemporary, neon, text-based,
| ?wizards_artist.walker_evans American, documentary, great-depression, monochromatic, photography, photography-bw, portraits, social-commentary,
| ?wizards_artist.jan_van_eyck painting, renaissance,
| ?wizards_artist.glenn_fabry comics, fantasy, illustration, science-fiction, violence,
| ?wizards_artist.ludwig_fahrenkrog eerie, expressionism, German, mysticism, symbolist,
| ?wizards_artist.shepard_fairey flat-colors, graphic-design, high-contrast, politics, social-commentary, street-art,
| ?wizards_artist.andy_fairhurst digital, eerie, fantasy, horror, illustration, science-fiction,
| ?wizards_artist.luis_ricardo_falero dream-like, erotica, fantasy, figurativism, nudes, painting, romanticism,
| ?wizards_artist.jean_fautrier abstract-expressionism, metaphysics, painting, sculpture,
| ?wizards_artist.andrew_ferez dream-like, eerie, fantasy, fragmentation, illustration, surreal,
| ?wizards_artist.hugh_ferriss architecture, art-deco, cityscapes, futuristic, geometric, nightlife, urban-life,
| ?wizards_artist.david_finch comics, fantasy, illustration, noir, superheroes,
| ?wizards_artist.callie_fink colorful, contemporary, expressionism, pop-art, portraits, psychedelic, surreal, vibrant,
| ?wizards_artist.virgil_finlay comics, dark, eerie, fantasy, high-contrast, horror, pulp, science-fiction,
| ?wizards_artist.anato_finnstark colorful, digital, fantasy, illustration, magic, playful, whimsical,
| ?wizards_artist.howard_finster colorful, contemporary, dream-like, folk-art, portraits, primitivism, religion, spirituality,
| ?wizards_artist.oskar_fischinger abstract, avant-garde, colorful, contemporary, spirituality, vibrant,
| ?wizards_artist.samuel_melton_fisher flowers, impressionism, nature, portraits, realism, romanticism, whimsical,
| ?wizards_artist.john_anster_fitzgerald fantasy, folklore, illustration, magic, pastel, whimsical,
| ?wizards_artist.tony_fitzpatrick collage, colorful, contemporary, mixed-media, playful, pop-art, vibrant, whimsical,
| ?wizards_artist.hippolyte_flandrin baroque, portraits, realism, religion, renaissance, romanticism,
| ?wizards_artist.dan_flavin conceptual, contemporary, installation, light-art, minimalism, sculpture,
| ?wizards_artist.max_fleischer animation, comics, contemporary, dark,
| ?wizards_artist.govaert_flinck baroque, expressionism, impressionism, portraits, realism, renaissance, whimsical,
| ?wizards_artist.alex_russell_flint environmentalism, illustration, painting, social-commentary,
| ?wizards_artist.lucio_fontana abstract, conceptual, installation, large-scale, minimalism, modern, sculpture,
| ?wizards_artist.chris_foss alien-worlds, colorful, illustration, outer-space, psychedelic, science-fiction,
| ?wizards_artist.jon_foster contemporary, digital, figurativism, minimalism, modern, portraits,
| ?wizards_artist.jean_fouquet allegory, painting, religion, renaissance, renaissance,
| ?wizards_artist.toby_fox animals, cartoon, childhood, comics, digital, fantasy, nature, whimsical,
| ?wizards_artist.art_frahm femininity, pin-up, portraits,
| ?wizards_artist.lisa_frank childhood, colorful, illustration, playful, vibrant, whimsical,
| ?wizards_artist.helen_frankenthaler abstract, abstract-expressionism, color-field, contemporary, expressionism, feminism, painting, printmaking, watercolor,
| ?wizards_artist.frank_frazetta barbarians, dark, erotica, fantasy, illustration, muscles, pulp,
| ?wizards_artist.kelly_freas adventure, eerie, fantasy, illustration, science-fiction,
| ?wizards_artist.lucian_freud British, expressionism, figurative, flesh, oil-painting, portraits, realism,
| ?wizards_artist.brian_froud dark, fairies, fantasy, illustration, magic, mythology, whimsical,
| ?wizards_artist.wendy_froud dark, fairies, fantasy, illustration, magic, mythology, whimsical,
| ?wizards_artist.tom_fruin architecture, colorful, contemporary, geometric, installation, multimedia, sculpture, stained-glass, vibrant,
| ?wizards_artist.john_wayne_gacy clowns, dark, death, horror, portraits, vibrant,
| ?wizards_artist.justin_gaffrey environmentalism, installation, landscapes, large-scale, minimalism, nature, sculpture,
| ?wizards_artist.hashimoto_gaho kitsch, politics, printmaking, ukiyo-e,
| ?wizards_artist.neil_gaiman comics, conceptual, dream-like, fantasy, portraits, whimsical,
| ?wizards_artist.stephen_gammell dark, eerie, high-contrast, horror, kids-book,
| ?wizards_artist.hope_gangloff colorful, contemporary, expressionism, portraits,
| ?wizards_artist.alex_garant conceptual, contemporary, dream-like, figurativism, impressionism, portraits, surreal, vibrant,
| ?wizards_artist.gilbert_garcin abstract, conceptual, contemporary, installation, sculpture, surreal,
| ?wizards_artist.michael_and_inessa_garmash conceptual, impressionism, nature, portraits, realism, romanticism, whimsical,
| ?wizards_artist.antoni_gaudi architecture, art-nouveau, mosaic, organic, spanish,
| ?wizards_artist.jack_gaughan alien-worlds, aliens, colorful, illustration, outer-space, science-fiction,
| ?wizards_artist.paul_gauguin colorful, exoticism, French, impressionism, oil-painting, primitivism, spirituality, tropics,
| ?wizards_artist.giovanni_battista_gaulli baroque, expressionism, impressionism, portraits, realism, renaissance,
| ?wizards_artist.anne_geddes childhood, nature, photography, photography-color, portraits, whimsical,
| ?wizards_artist.bill_gekas childhood, conceptual, expressionism, fashion, photography, photography-color, portraits, whimsical,
| ?wizards_artist.artemisia_gentileschi baroque, expressionism, portraits, realism, religion, renaissance, romanticism,
| ?wizards_artist.orazio_gentileschi baroque, expressionism, portraits, realism, renaissance, romanticism, whimsical,
| ?wizards_artist.daniel_f_gerhartz expressionism, femininity, impressionism, nature, portraits, realism, romanticism, whimsical,
| ?wizards_artist.theodore_gericault conceptual, dark, expressionism, impressionism, portraits, realism, romanticism,
| ?wizards_artist.jean_leon_gerome architecture, figure-studies, French, mythology, orientalism, painting, romanticism,
| ?wizards_artist.mark_gertler expressionism, figurativism, figure-studies, impressionism, portraits, realism, still-life,
| ?wizards_artist.atey_ghailan characters, digital, dream-like, fantasy, illustration, manga-anime, surreal,
| ?wizards_artist.alberto_giacometti bronze, emaciation, expressionism, figurative, portraits, sculpture, swiss,
| ?wizards_artist.donato_giancola fantasy, illustration, mythology, science-fiction,
| ?wizards_artist.hr_giger cyberpunk, dark, horror, monochromatic, painting, robots-cyborgs, science-fiction, surreal,
| ?wizards_artist.james_gilleard architecture, colorful, digital, environmentalism, fantasy, flat-colors, futuristic, landscapes, vibrant,
| ?wizards_artist.harold_gilman impressionism, landscapes, nature, portraits, romanticism, whimsical,
| ?wizards_artist.charles_ginner cityscapes, colorful, impressionism, landscapes, urban-life,
| ?wizards_artist.jean_giraud comics, dream-like, fantasy, illustration, psychedelic, science-fiction, surreal,
| ?wizards_artist.anne_louis_girodet expressionism, impressionism, portraits, realism, renaissance, romanticism,
| ?wizards_artist.milton_glaser colorful, contemporary, graphic-design, pop-art, vibrant, whimsical,
| ?wizards_artist.warwick_goble art-nouveau, folklore, kids-book, muted-colors, nature, whimsical,
| ?wizards_artist.john_william_godward characters, impressionism, portraits, realism, renaissance, romanticism,
| ?wizards_artist.sacha_goldberger characters, contemporary, identity, immigrants, mixed-media, photography, photography-color, portraits,
| ?wizards_artist.nan_goldin conceptual, contemporary, expressionism, photography, photography-color, portraits, realism, whimsical,
| ?wizards_artist.josan_gonzalez atmospheric, cyberpunk, futuristic, illustration, science-fiction, technology,
| ?wizards_artist.felix_gonzalez_torres conceptual, contemporary, installation, lgbtq, minimalism,
| ?wizards_artist.derek_gores colorful, contemporary, expressionism, portraits,
| ?wizards_artist.edward_gorey dark, eerie, gothic, horror, kids-book, monochromatic, mysterious,
| ?wizards_artist.arshile_gorky abstract-expressionism, painting,
| ?wizards_artist.alessandro_gottardo characters, dream-like, flat-colors, illustration, playful, whimsical,
| ?wizards_artist.adolph_gottlieb abstract, abstract-expressionism, color-field, contemporary, geometric,
| ?wizards_artist.francisco_goya dark, etching, horror, oil-painting, politics, portraits, romanticism, satire, social-commentary, spanish,
| ?wizards_artist.laurent_grasso conceptual, contemporary, sculpture, surreal, surreal,
| ?wizards_artist.mab_graves big-eyes, conceptual, contemporary, dream-like, expressionism, magic-realism, portraits, whimsical,
| ?wizards_artist.eileen_gray abstract, architecture, friendship, loneliness, modern, painting,
| ?wizards_artist.kate_greenaway British, childhood, fashion, illustration, kids-book, romanticism, victorian,
| ?wizards_artist.alex_grey abstract-expressionism, colorful, contemporary, dream-like, psychedelic, surreal, vibrant,
| ?wizards_artist.carne_griffiths conceptual, contemporary, expressionism, messy, portraits, whimsical,
| ?wizards_artist.gris_grimly comics, dark, eerie, fantasy, gothic, illustration, kids-book, surreal, whimsical,
| ?wizards_artist.brothers_grimm characters, dark, folklore, kids-book, magic,
| ?wizards_artist.tracie_grimwood colorful, dream-like, fantasy, kids-book, playful, whimsical,
| ?wizards_artist.matt_groening cartoon, colorful, pop-culture, satire, whimsical,
| ?wizards_artist.alex_gross contemporary, portraits, surreal, whimsical,
| ?wizards_artist.tom_grummett comics, contemporary, illustration, superheroes,
| ?wizards_artist.huang_guangjian contemporary, impressionism, landscapes, oil-painting,
| ?wizards_artist.wu_guanzhong contemporary, feminism, homo-eroticism, illustration, landscapes,
| ?wizards_artist.rebecca_guay digital, dream-like, ethereal, fantasy, illustration, magic, watercolor,
| ?wizards_artist.guercino baroque, italian, painting, religion,
| ?wizards_artist.jeannette_guichard_bunel conceptual, contemporary, expressionism, figurativism, portraits, whimsical,
| ?wizards_artist.scott_gustafson fantasy, illustration, kids-book, magic-realism, playful, whimsical,
| ?wizards_artist.wade_guyton contemporary, mixed-media, pop-art,
| ?wizards_artist.hans_haacke conceptual, contemporary, environmentalism, installation, politics, sculpture,
| ?wizards_artist.robert_hagan colorful, dream-like, impressionism, landscapes, nature, romanticism, vibrant,
| ?wizards_artist.philippe_halsman conceptual, monochromatic, photography, photography-bw, portraits, whimsical,
| ?wizards_artist.maggi_hambling American, conceptual, contemporary, expressionism, installation, portraits, vibrant,
| ?wizards_artist.richard_hamilton consumerism, mixed-media, pop-art, pop-art,
| ?wizards_artist.bess_hamiti contemporary, dream-like, impressionism, landscapes, magic-realism, surreal, vibrant, whimsical,
| ?wizards_artist.tom_hammick dream-like, figurativism, flat-colors, landscapes, multimedia, nature, vibrant,
| ?wizards_artist.david_hammons abstract, African-American, conceptual, contemporary, installation, social-commentary,
| ?wizards_artist.ren_hang characters, contemporary, impressionism, nudes, photography, photography-color, portraits,
| ?wizards_artist.erin_hanson atmospheric, colorful, dream-like, impressionism, landscapes, nature, serenity, vibrant,
| ?wizards_artist.keith_haring activism, expressionism, flat-colors, graffiti, high-contrast, lgbtq, pop-art, street-art, vibrant,
| ?wizards_artist.alexei_harlamoff childhood, impressionism, portraits, realism,
| ?wizards_artist.charley_harper animals, flat-colors, folk-art, illustration, muted-colors, nature, playful, whimsical,
| ?wizards_artist.john_harris dark, dystopia, illustration, outer-space, science-fiction,
| ?wizards_artist.florence_harrison art-nouveau, delicate, dream-like, kids-book, romanticism, whimsical,
| ?wizards_artist.marsden_hartley abstract, American, expressionism, landscapes, modern, portraits, primitivism,
| ?wizards_artist.ryohei_hase creatures, digital, dream-like, ethereal, fantasy, illustration, magic-realism, mysterious, surreal,
| ?wizards_artist.childe_hassam American, cityscapes, impressionism, landscapes,
| ?wizards_artist.ben_hatke adventure, cartoon, characters, kids-book, playful, whimsical,
| ?wizards_artist.mona_hatoum body-art, conceptual, contemporary, displacement, installation, sculpture,
| ?wizards_artist.pam_hawkes ceramics, contemporary, delicate, figurative, figurativism, nature, organic, portraits,
| ?wizards_artist.jamie_hawkesworth contemporary, nature, photography, photography-color, portraits, street-art, urban-life, vibrant,
| ?wizards_artist.stuart_haygarth angular, colorful, conceptual, contemporary, installation, vibrant,
| ?wizards_artist.erich_heckel expressionism, German, landscapes, modern, portraits,
| ?wizards_artist.valerie_hegarty metamorphosis, painting, sculpture, social-commentary,
| ?wizards_artist.mary_heilmann abstract, colorful, contemporary, geometric, minimalism, vibrant,
| ?wizards_artist.michael_heizer angular, earthworks, installation, land-art, landscapes, large-scale, nature,
| ?wizards_artist.gottfried_helnwein childhood, contemporary, dark, horror, photography, photography-color, portraits, social-commentary,
| ?wizards_artist.barkley_l_hendricks African-American, contemporary, expressionism, femininity, figurativism, identity, portraits,
| ?wizards_artist.bill_henson conceptual, contemporary, dark, landscapes, photography, photography-color, portraits, whimsical,
| ?wizards_artist.barbara_hepworth abstract, modern, nature, organic, sculpture,
| ?wizards_artist.herge belgian, comics, contemporary,
| ?wizards_artist.carolina_herrera characters, contemporary, fashion, femininity, celebrity,
| ?wizards_artist.george_herriman comics, contemporary, illustration, politics, satire,
| ?wizards_artist.don_hertzfeldt animation, dark, drawing, surreal, whimsical,
| ?wizards_artist.prudence_heward colorful, expressionism, feminism, nature, portraits,
| ?wizards_artist.ryan_hewett cubism, mysticism, portraits,
| ?wizards_artist.nora_heysen consumerism, contemporary, femininity, landscapes, painting,
| ?wizards_artist.george_elgar_hicks impressionism, landscapes,
| ?wizards_artist.lorenz_hideyoshi cyberpunk, dark, digital, dystopia, futuristic, illustration, science-fiction,
| ?wizards_artist.brothers_hildebrandt fantasy, illustration, painting, superheroes, vibrant,
| ?wizards_artist.dan_hillier contemporary, graffiti, monochromatic, portraits, street-art, urban-life,
| ?wizards_artist.lewis_hine activism, documentary, monochromatic, photography, photography-bw, social-commentary, social-realism,
| ?wizards_artist.miho_hirano characters, contemporary, fantasy, Japanese, magic-realism, portraits, whimsical,
| ?wizards_artist.harumi_hironaka dream-like, femininity, manga-anime, pastel-colors, portraits, serenity, watercolor,
| ?wizards_artist.hiroshige edo-period, Japanese, landscapes, nature, printmaking, ukiyo-e, woodblock,
| ?wizards_artist.morris_hirshfield animals, contemporary, illustration, minimalism, whimsical,
| ?wizards_artist.damien_hirst animals, British, conceptual, contemporary, death, installation, mixed-media, sculpture, shock-art,
| ?wizards_artist.fan_ho chinese, contemporary, film, high-contrast, monochromatic, photography, photography-bw,
| ?wizards_artist.meindert_hobbema Dutch-golden-age, landscapes, observational, painting, plein-air,
| ?wizards_artist.david_hockney British, colorful, cubism, pools, pop-art, portraits,
| ?wizards_artist.filip_hodas 3d-rendering, contemporary, dark, digital, dream-like, pop-culture, science-fiction, surreal,
| ?wizards_artist.howard_hodgkin abstract, color-field, contemporary, modern, nature, vibrant,
| ?wizards_artist.ferdinand_hodler characters, contemporary, impressionism, landscapes, nature, portraits, swiss,
| ?wizards_artist.tiago_hoisel characters, contemporary, illustration, whimsical,
| ?wizards_artist.katsushika_hokusai edo-period, high-contrast, Japanese, Japanese, nature, ukiyo-e, waves, woodblock,
| ?wizards_artist.hans_holbein_the_younger anthropomorphism, painting, portraits, renaissance,
| ?wizards_artist.frank_holl colorful, impressionism, portraits, street-art, urban-life,
| ?wizards_artist.carsten_holler contemporary, experiential, immersive, interactive, playful,
| ?wizards_artist.zena_holloway animals, British, fashion, female-figures, photography, photography-color, portraits, underwater,
| ?wizards_artist.edward_hopper American, architecture, impressionism, landscapes, loneliness, nostalgia, oil-painting, realism, solitude, urban-life,
| ?wizards_artist.aaron_horkey comics, etching, fantasy, illustration,
| ?wizards_artist.alex_horley characters, dark, fantasy, grungy, horror, illustration,
| ?wizards_artist.roni_horn American, conceptual, environmentalism, installation, lgbtq, minimalism, nature, photography, photography-color, sculpture,
| ?wizards_artist.john_howe characters, dark, eerie, fantasy, landscapes, nature, portraits,
| ?wizards_artist.alex_howitt contemporary, fleeting-moments, illustration, monochromatic, painting, slice-of-life,
| ?wizards_artist.meghan_howland contemporary, dream-like, figurativism, identity, portraits,
| ?wizards_artist.john_hoyland abstract, color-field, contemporary, geometric, messy, modern, vibrant,
| ?wizards_artist.shilin_huang characters, dream-like, fantasy, magic, mysterious, mythology,
| ?wizards_artist.arthur_hughes impressionism, landscapes, nature, portraits, romanticism,
| ?wizards_artist.edward_robert_hughes characters, dream-like, ethereal, fantasy, impressionism, nostalgia, romanticism, whimsical,
| ?wizards_artist.jack_hughes contemporary, expressionism, flat-colors, portraits, vibrant,
| ?wizards_artist.talbot_hughes impressionism, landscapes, nature, portraits, romanticism,
| ?wizards_artist.pieter_hugo contemporary, Dutch, environmentalism, landscapes, photography, photography-color, portraits, social-commentary,
| ?wizards_artist.gary_hume abstract, flat-colors, geometric, minimalism, modern, painting,
| ?wizards_artist.friedensreich_hundertwasser abstract, colorful, contemporary, expressionism, organic, vibrant, whimsical,
| ?wizards_artist.william_holman_hunt impressionism, landscapes, nature, portraits, romanticism,
| ?wizards_artist.george_hurrell contemporary, fashion, high-contrast, luxury, photography, photography-bw, portraits,
| ?wizards_artist.fabio_hurtado contemporary, cubism, figurativism, modern, multimedia, portraits,
| ?wizards_artist.hush activism, messy, painting, street-art,
| ?wizards_artist.michael_hutter dream-like, eerie, fantasy, horror, science-fiction, surreal,
| ?wizards_artist.pierre_huyghe conceptual, contemporary, multimedia, surreal,
| ?wizards_artist.doug_hyde contemporary, illustration, kids-book, playful, whimsical,
| ?wizards_artist.louis_icart art-deco, dancers, femininity, impressionism, low-contrast, romanticism, urban-life,
| ?wizards_artist.robert_indiana contemporary, flat-colors, graphic-design, pop-art, typography, vibrant,
| ?wizards_artist.jean_auguste_dominique_ingres French, portraits, realism, romanticism,
| ?wizards_artist.robert_irwin angular, contemporary, environmentalism, installation, minimalism,
| ?wizards_artist.gabriel_isak contemporary, melancholy, surreal, Swedish,
| ?wizards_artist.junji_ito contemporary, dark, fantasy, horror, manga-anime, monochromatic, portraits, surreal,
| ?wizards_artist.christophe_jacrot architecture, atmospheric, cityscapes, photography, photography-color, urban-life,
| ?wizards_artist.louis_janmot characters, French, impressionism, portraits, romanticism,
| ?wizards_artist.frieke_janssens conceptual, contemporary, photography, photography-color, portraits,
| ?wizards_artist.alexander_jansson dark, dream-like, fantasy, mythology, surreal, whimsical,
| ?wizards_artist.tove_jansson adventure, cartoon, kids-book, playful, whimsical,
| ?wizards_artist.aaron_jasinski characters, colorful, comics, contemporary, pop-art, portraits, whimsical,
| ?wizards_artist.alexej_von_jawlensky colorful, expressionism, German, modern, portraits, spirituality, vibrant,
| ?wizards_artist.james_jean fantasy, muted-colors, mysterious, mythology, pastel-colors,
| ?wizards_artist.oliver_jeffers cartoon, colorful, kids-book, playful, whimsical,
| ?wizards_artist.lee_jeffries conceptual, contemporary, high-contrast, monochromatic, portraits, social-commentary,
| ?wizards_artist.georg_jensen jewelry, sculpture,
| ?wizards_artist.ellen_jewett digital, expressionism, installation, nature, sculpture, surreal, whimsical,
| ?wizards_artist.he_jiaying contemporary, femininity, identity, painting, realism,
| ?wizards_artist.chantal_joffe contemporary, expressionism, figurativism, portraits, social-commentary,
| ?wizards_artist.martine_johanna colorful, contemporary, femininity, figurativism, identity, portraits,
| ?wizards_artist.augustus_john British, color-field, impressionism, landscapes, nature, portraits,
| ?wizards_artist.gwen_john contemporary, femininity, impressionism, nature, portraits, watercolor, whimsical,
| ?wizards_artist.jasper_johns abstract-expressionism, mysticism, painting,
| ?wizards_artist.eastman_johnson American, contemporary, impressionism, landscapes, nature, portraits, urban-life,
| ?wizards_artist.alfred_cheney_johnston conceptual, contemporary, minimalism, monochromatic, photography, photography-bw, portraits,
| ?wizards_artist.dorothy_johnstone contemporary, femininity, figurativism, impressionism, landscapes, nature, portraits,
| ?wizards_artist.android_jones colorful, conceptual, digital, dream-like, geometric, psychedelic, surreal,
| ?wizards_artist.erik_jones collage, colorful, cubism, portraits, vibrant,
| ?wizards_artist.jeffrey_catherine_jones fantasy, figurativism, posters, pulp, realism,
| ?wizards_artist.peter_andrew_jones alien-worlds, eerie, fantasy, futuristic, outer-space, science-fiction,
| ?wizards_artist.loui_jover contemporary, eerie, illustration, satire,
| ?wizards_artist.amy_judd contemporary, fantasy, nature, photorealism, portraits, surreal,
| ?wizards_artist.donald_judd angular, contemporary, installation, metalwork, minimalism, sculpture,
| ?wizards_artist.jean_jullien cartoon, flat-colors, graphic-design, high-contrast, minimalism, playful,
| ?wizards_artist.matthias_jung architecture, conceptual, digital, dream-like, environmentalism, futuristic, minimalism, surreal,
| ?wizards_artist.joe_jusko comics, fantasy,
| ?wizards_artist.frida_kahlo dream-like, feminism, mexican, portraits, self-portraits, vibrant,
| ?wizards_artist.hayv_kahraman contemporary, fantasy, femininity, figurativism, portraits, whimsical,
| ?wizards_artist.mw_kaluta dream-like, ethereal, fantasy, nostalgia, romanticism, victorian, whimsical,
| ?wizards_artist.nadav_kander conceptual, contemporary, landscapes, minimalism, photography, photography-color, portraits, street-art, urban-life,
| ?wizards_artist.wassily_kandinsky abstract, bauhaus, expressionism, modern, russian, spirituality, vibrant,
| ?wizards_artist.jun_kaneko abstract, contemporary, geometric, organic, sculpture, vibrant,
| ?wizards_artist.titus_kaphar African-American, conceptual, contemporary, figurativism, portraits, social-commentary,
| ?wizards_artist.michal_karcz digital, eerie, fantasy, futuristic, landscapes, photorealism, science-fiction, surreal,
| ?wizards_artist.gertrude_kasebier American, family, female-figures, monochromatic, photography, photography-bw, portraits, rural-life,
| ?wizards_artist.terada_katsuya fantasy, magic, manga-anime, portraits,
| ?wizards_artist.audrey_kawasaki art-nouveau, contemporary, fantasy, Japanese, magic-realism, manga-anime, portraits, whimsical,
| ?wizards_artist.hasui_kawase landscapes, plein-air, printmaking, slice-of-life, ukiyo-e,
| ?wizards_artist.glen_keane adventure, cartoon, characters, drawing, kids-book, playful, whimsical,
| ?wizards_artist.margaret_keane big-eyes, cartoon, childhood, colorful, contemporary, femininity, pop-art, portraits, whimsical,
| ?wizards_artist.ellsworth_kelly abstract, color-field, contemporary, flat-colors, geometric, minimalism,
| ?wizards_artist.michael_kenna British, contemporary, high-contrast, landscapes, minimalism, monochromatic, photography, photography-bw,
| ?wizards_artist.thomas_benjamin_kennington figurativism, impressionism, portraits, realism,
| ?wizards_artist.william_kentridge African, animation, contemporary, drawing, messy, monochromatic, politics, printmaking,
| ?wizards_artist.hendrik_kerstens conceptual, contemporary, fashion, photography, photography-color, portraits, whimsical,
| ?wizards_artist.jeremiah_ketner activism, big-eyes, contemporary, female-figures, femininity, illustration, social-commentary,
| ?wizards_artist.fernand_khnopff metaphysics, painting, sculpture, symbolist,
| ?wizards_artist.hideyuki_kikuchi dark, eerie, fantasy, horror, manga-anime,
| ?wizards_artist.tom_killion contemporary, landscapes, observational, plein-air, printmaking,
| ?wizards_artist.thomas_kinkade color-field, contemporary, impressionism, landscapes, nature, portraits,
| ?wizards_artist.jack_kirby comics, science-fiction, superheroes,
| ?wizards_artist.ernst_ludwig_kirchner expressionism, German, landscapes, modern, portraits,
| ?wizards_artist.tatsuro_kiuchi colorful, digital, flat-colors, landscapes, nature, street-art, urban-life, whimsical,
| ?wizards_artist.jon_klassen animals, dream-like, kids-book, nature, playful, watercolor, whimsical,
| ?wizards_artist.paul_klee abstract, bauhaus, expressionism, German, playful,
| ?wizards_artist.william_klein American, fashion, minimalism, monochromatic, photography, photography-bw, urban-life,
| ?wizards_artist.yves_klein abstract, color-field, expressionism, fashion, French, modern, monochromatic, performance,
| ?wizards_artist.carl_kleiner abstract, American, collage, digital, graphic-design, pop-art, portraits,
| ?wizards_artist.gustav_klimt art-nouveau, austrian, erotica, female-figures, golden, mosaic, portraits,
| ?wizards_artist.godfrey_kneller baroque, impressionism, portraits, realism,
| ?wizards_artist.emily_kame_kngwarreye aboriginal, abstract, australian, colorful, dream-like, expressionism, landscapes, nature,
| ?wizards_artist.chad_knight collage, colorful, digital, playful, pop-art, surreal,
| ?wizards_artist.nick_knight adventure, fantasy, fashion, pastel-colors, photography, photography-color, pop-art, surreal,
| ?wizards_artist.helene_knoop characters, conceptual, contemporary, feminism, figurativism, minimalism, portraits,
| ?wizards_artist.phil_koch atmospheric, colorful, contemporary, landscapes, nature, photography, photography-color, serenity, vibrant,
| ?wizards_artist.kazuo_koike comics, fantasy, manga-anime,
| ?wizards_artist.oskar_kokoschka austrian, expressionism, German, landscapes, modern, portraits,
| ?wizards_artist.kathe_kollwitz contemporary, expressionism, high-contrast, monochromatic, portraits, social-commentary,
| ?wizards_artist.michael_komarck battle-scenes, contemporary, fantasy, illustration, painting,
| ?wizards_artist.satoshi_kon dream-like, fantasy, manga-anime, surreal, whimsical,
| ?wizards_artist.jeff_koons colorful, consumerism, contemporary, kitsch, pop-art, post-modern, sculpture,
| ?wizards_artist.caia_koopman big-eyes, colorful, conceptual, contemporary, femininity, pop-art, portraits, surreal, whimsical,
| ?wizards_artist.konstantin_korovin impressionism, impressionism, painting, plein-air,
| ?wizards_artist.mark_kostabi figurative, modern, politics,
| ?wizards_artist.bella_kotak conceptual, contemporary, fashion, photography, photography-color, portraits, urban-life,
| ?wizards_artist.andrea_kowch contemporary, dark, fantasy, magic-realism, portraits, whimsical,
| ?wizards_artist.lee_krasner abstract, abstract-expressionism, color-field, expressionism, feminism, gestural, improvisation,
| ?wizards_artist.barbara_kruger advertising, conceptual, contemporary, feminism, graphic-design, high-contrast, montage, text-based,
| ?wizards_artist.brad_kunkle conceptual, contemporary, dream-like, photography, photography-color, portraits,
| ?wizards_artist.yayoi_kusama contemporary, fashion, feminism, infinity-rooms, installation, polka-dots, pop-art, vibrant,
| ?wizards_artist.michael_k_kutsche characters, dark, dream-like, fantasy, mysterious, mythology,
| ?wizards_artist.ilya_kuvshinov digital, dream-like, ethereal, fantasy, manga-anime, romanticism, surreal, vibrant,
| ?wizards_artist.david_lachapelle conceptual, contemporary, luxury, photography, photography-color, pop-art, vibrant,
| ?wizards_artist.raphael_lacoste atmospheric, dark, dream-like, eerie, fantasy, landscapes, mysterious,
| ?wizards_artist.lev_lagorio landscapes, observational, painting, plein-air, realism,
| ?wizards_artist.rene_lalique art-deco, art-nouveau, French, glasswork, jewelry, luxury, nature, sculpture,
| ?wizards_artist.abigail_larson dark, eerie, fantasy, kids-book, whimsical,
| ?wizards_artist.gary_larson American, animals, cartoon, comics, newspaper, pop-culture, satire, slice-of-life,
| ?wizards_artist.denys_lasdun architecture, contemporary, metaphysics,
| ?wizards_artist.maria_lassnig expressionism, figurative, self-portraits,
| ?wizards_artist.dorothy_lathrop art-nouveau, delicate, dream-like, kids-book, romanticism, whimsical,
| ?wizards_artist.melissa_launay contemporary, painting,
| ?wizards_artist.john_lavery contemporary, impressionism, irish, landscapes, nature, portraits,
| ?wizards_artist.jacob_lawrence African-American, angular, contemporary, cubism, harlem-renaissance, modern, social-realism,
| ?wizards_artist.thomas_lawrence characters, femininity, impressionism, portraits, realism, romanticism,
| ?wizards_artist.ernest_lawson American, everyday-life, impressionism, landscapes,
| ?wizards_artist.bastien_lecouffe_deharme characters, dark, digital, ethereal, fantasy, magic, surreal,
| ?wizards_artist.alan_lee dream-like, ethereal, fantasy, mythology, nostalgia, romanticism,
| ?wizards_artist.minjae_lee contemporary, expressionism, fantasy, messy, portraits, south-korean, whimsical,
| ?wizards_artist.nina_leen conceptual, contemporary, monochromatic, photography, photography-bw, portraits, street-art, urban-life,
| ?wizards_artist.fernand_leger abstract, colorful, cubism, geometric, modern,
| ?wizards_artist.paul_lehr colorful, eerie, fantasy, futuristic, science-fiction, surreal,
| ?wizards_artist.frederic_leighton expressionism, landscapes, portraits, romanticism,
| ?wizards_artist.alayna_lemmer contemporary, expressionism, mixed-media,
| ?wizards_artist.tamara_de_lempicka art-deco, cubism, fashion, luxury, portraits, romanticism,
| ?wizards_artist.sol_lewitt abstract, conceptual, contemporary, geometric, minimalism, sculpture, serial-art, wall-drawings,
| ?wizards_artist.jc_leyendecker American, illustration, nostalgia, pop-culture, portraits, posters,
| ?wizards_artist.andre_lhote cubism, impressionism, painting,
| ?wizards_artist.roy_lichtenstein American, comics, expressionism, flat-colors, pop-art, portraits,
| ?wizards_artist.rob_liefeld comics, fantasy, science-fiction, superheroes,
| ?wizards_artist.fang_lijun contemporary, Dutch, figurativism, portraits, realism, vibrant,
| ?wizards_artist.maya_lin architecture, contemporary, environmentalism, identity, installation, land-art,
| ?wizards_artist.filippino_lippi expressionism, landscapes, portraits, renaissance,
| ?wizards_artist.herbert_list German, monochromatic, photography, photography-bw, portraits,
| ?wizards_artist.richard_long British, contemporary, land-art, sculpture,
| ?wizards_artist.yoann_lossel animals, fantasy, golden, illustration, realism,
| ?wizards_artist.morris_louis abstract-expressionism, color-field, minimalism, painting,
| ?wizards_artist.sarah_lucas contemporary, femininity, feminism, sculpture, surreal,
| ?wizards_artist.maximilien_luce French, impressionism, landscapes, nature, oil-painting, plein-air, romanticism, vibrant,
| ?wizards_artist.loretta_lux American, childhood, contemporary, impressionism, installation, photography, photography-color, portraits,
| ?wizards_artist.george_platt_lynes fashion, figure-studies, homo-eroticism, lgbtq, monochromatic, nudes, photography, photography-bw,
| ?wizards_artist.frances_macdonald allegory, impressionism, landscapes, nostalgia, painting,
| ?wizards_artist.august_macke abstract, colorful, expressionism, impressionism, modern, serenity, vibrant,
| ?wizards_artist.stephen_mackey contemporary, dark, dream-like, expressionism, landscapes, surreal,
| ?wizards_artist.rachel_maclean colorful, contemporary, photography, photography-color, portraits, Scottish, whimsical,
| ?wizards_artist.raimundo_de_madrazo_y_garreta expressionism, impressionism, landscapes, portraits,
| ?wizards_artist.joe_madureira comics, fantasy, superheroes,
| ?wizards_artist.rene_magritte belgian, cloudscapes, cubism, illusion, impressionism, surreal,
| ?wizards_artist.jim_mahfood comics, graffiti, pop-art, street-art,
| ?wizards_artist.vivian_maier contemporary, expressionism, landscapes, monochromatic, photography, photography-bw, portraits,
| ?wizards_artist.aristide_maillol female-figures, modern, painting, sculpture,
| ?wizards_artist.don_maitz eerie, fantasy, futuristic, science-fiction, surreal,
| ?wizards_artist.laura_makabresku contemporary, dark, femininity, muted-colors, photography, photography-color, portraits, shallow-depth-of-field, surreal,
| ?wizards_artist.alex_maleev comics, dark, fantasy, noir,
| ?wizards_artist.keith_mallett dark, figurativism, minimalism, modern, muted-colors, sculpture, urban-life,
| ?wizards_artist.johji_manabe comics, contemporary, illustration, manga-anime, metamorphosis, science-fiction,
| ?wizards_artist.milo_manara comics, controversy, erotica, femininity, illustration,
| ?wizards_artist.edouard_manet controversy, femininity, French, impressionism, modern-life, portraits, realism, still-life,
| ?wizards_artist.henri_manguin colorful, fauvism, impressionism, painting,
| ?wizards_artist.jeremy_mann contemporary, dark, expressionism, grungy, messy, portraits, urban-life,
| ?wizards_artist.sally_mann childhood, family, monochromatic, photography, photography-bw, social-commentary, suburbia,
| ?wizards_artist.andrea_mantegna mythology, painting, religion, renaissance, spanish,
| ?wizards_artist.antonio_j_manzanedo characters, dark, fantasy, mysterious,
| ?wizards_artist.robert_mapplethorpe bdsm, figure-studies, homo-eroticism, lgbtq, monochromatic, nudes, photography, photography-bw, portraits,
| ?wizards_artist.franz_marc animals, colorful, cubism, expressionism, spirituality, vibrant,
| ?wizards_artist.ivan_marchuk contemporary, expressionism, painting,
| ?wizards_artist.brice_marden abstract, contemporary, minimalism,
| ?wizards_artist.andrei_markin contemporary, expressionism, figurativism, impressionism, portraits,
| ?wizards_artist.kerry_james_marshall collage, contemporary, expressionism, landscapes, portraits,
| ?wizards_artist.serge_marshennikov contemporary, expressionism, impressionism, landscapes, portraits,
| ?wizards_artist.agnes_martin abstract-expressionism, color-field, contemporary, grids, minimalism, spirituality,
| ?wizards_artist.adam_martinakis 3d-rendering, conceptual, digital, dream-like, futuristic, multimedia, sculpture, virtual-reality,
| ?wizards_artist.stephan_martiniere atmospheric, dark, fantasy, futuristic, landscapes, science-fiction, surreal,
| ?wizards_artist.ilya_mashkov expressionism, painting, russian, symbolist,
| ?wizards_artist.henri_matisse collage, color-field, colorful, cut-outs, fauvism, French, impressionism, sculpture,
| ?wizards_artist.rodney_matthews colorful, eerie, fantasy, futuristic, science-fiction,
| ?wizards_artist.anton_mauve impressionism, landscapes, painting,
| ?wizards_artist.peter_max colorful, contemporary, pop-art, surreal, vibrant,
| ?wizards_artist.mike_mayhew comics, fantasy, portraits,
| ?wizards_artist.angus_mcbride battle-scenes, British, fantasy, history, horses, illustration,
| ?wizards_artist.anne_mccaffrey adventure, dragons, fantasy, magic, mythology, science-fiction,
| ?wizards_artist.robert_mccall futuristic, outer-space, science-fiction,
| ?wizards_artist.scott_mccloud comics, contemporary, pop-art,
| ?wizards_artist.steve_mccurry documentary, photography, photography-color, portraits, rural-life, shallow-depth-of-field, social-commentary,
| ?wizards_artist.todd_mcfarlane comics, dark, fantasy,
| ?wizards_artist.barry_mcgee contemporary, painting, street-art, urban-life,
| ?wizards_artist.ryan_mcginley colorful, contemporary, dream-like, nudes, photography, photography-color, portraits, vibrant,
| ?wizards_artist.robert_mcginnis dream-like, erotica, figurative, illustration, pulp, romanticism,
| ?wizards_artist.richard_mcguire colorful, conceptual, flat-colors, illustration, whimsical,
| ?wizards_artist.patrick_mchale cartoon, contemporary, drawing,
| ?wizards_artist.kelly_mckernan contemporary, expressionism, magic-realism, portraits, watercolor, whimsical,
| ?wizards_artist.angus_mckie fantasy, futuristic, science-fiction,
| ?wizards_artist.alasdair_mclellan American, contemporary, fashion, impressionism, installation, photography, photography-bw, photography-color, portraits,
| ?wizards_artist.jon_mcnaught cartoon, flat-colors, illustration, playful,
| ?wizards_artist.dan_mcpharlin dream-like, ethereal, magic, science-fiction, surreal,
| ?wizards_artist.tara_mcpherson American, contemporary, impressionism, installation, pop-art, portraits, surreal,
| ?wizards_artist.ralph_mcquarrie eerie, futuristic, landscapes, science-fiction,
| ?wizards_artist.ian_mcque dark, fantasy, grungy, messy, science-fiction, surreal,
| ?wizards_artist.syd_mead angular, flat-colors, futuristic, minimalism, modern, science-fiction, technology,
| ?wizards_artist.richard_meier architecture, conceptual, geometric, minimalism, sculpture,
| ?wizards_artist.maria_sibylla_merian biological, botanical, insects, naturalist, nature, observational,
| ?wizards_artist.willard_metcalf American, landscapes, muted-colors, tonalism,
| ?wizards_artist.gabriel_metsu baroque, expressionism, portraits, still-life,
| ?wizards_artist.jean_metzinger cubism, geometric, modern, vibrant,
| ?wizards_artist.michelangelo ceiling-painting, figurative, frescoes, italian, religion, renaissance, sculpture,
| ?wizards_artist.nicolas_mignard baroque, expressionism, landscapes, portraits,
| ?wizards_artist.mike_mignola comics, dark, high-contrast, high-contrast,
| ?wizards_artist.dimitra_milan contemporary, expressionism, messy, portraits, whimsical,
| ?wizards_artist.john_everett_millais expressionism, impressionism, landscapes, portraits,
| ?wizards_artist.marilyn_minter erotica, messy, painting, photography, photography-color, photorealism, portraits,
| ?wizards_artist.januz_miralles contemporary, low-contrast, monochromatic, portraits, watercolor,
| ?wizards_artist.joan_miro abstract, color-field, colorful, modern, playful, sculpture, spanish,
| ?wizards_artist.joan_mitchell abstract, expressionism, large-scale, messy,
| ?wizards_artist.hayao_miyazaki adventure, animation, fantasy, film, Japanese, kids-book, manga-anime, whimsical,
| ?wizards_artist.paula_modersohn_becker expressionism, family, female-figures, femininity, German, painting, portraits, self-portraits,
| ?wizards_artist.amedeo_modigliani expressionism, fauvism, italian, modern, portraits, romanticism, sculpture,
| ?wizards_artist.moebius comics, dream-like, fantasy, psychedelic, science-fiction, surreal,
| ?wizards_artist.peter_mohrbacher dark, dream-like, ethereal, fantasy, mythology, surreal, whimsical,
| ?wizards_artist.piet_mondrian abstract, angular, Dutch, geometric, primary-colors, vibrant,
| ?wizards_artist.claude_monet color-field, French, impressionism, landscapes, plein-air, seascapes, water-lilies,
| ?wizards_artist.jean_baptiste_monge dark, eerie, fantasy, mysterious, surreal,
| ?wizards_artist.alyssa_monks contemporary, expressionism, figurativism, messy, photorealism, portraits,
| ?wizards_artist.alan_moore comics, dark, dystopia, fantasy, graphic-novel, grungy, horror, noir, science-fiction,
| ?wizards_artist.antonio_mora American, contemporary, landscapes, monochromatic, photography, photography-bw, portraits, surreal,
| ?wizards_artist.edward_moran American, hudson-river-school, landscapes, painting, seascapes,
| ?wizards_artist.koji_morimoto contemporary, cute, illustration, Japanese, monsters, surreal,
| ?wizards_artist.berthe_morisot domestic-scenes, feminism, fleeting-moments, French, impressionism, landscapes, portraits, still-life,
| ?wizards_artist.daido_moriyama documentary, grungy, Japanese, monochromatic, photography, photography-bw, post-war, urban-life,
| ?wizards_artist.james_wilson_morrice impressionism, landscapes, painting, plein-air,
| ?wizards_artist.sarah_morris abstract, contemporary, femininity, identity, painting,
| ?wizards_artist.john_lowrie_morrison contemporary, impressionism, landscapes, vibrant,
| ?wizards_artist.igor_morski American, contemporary, portraits, surreal,
| ?wizards_artist.john_kenn_mortensen dark, eerie, horror, kids-book, monochromatic,
| ?wizards_artist.victor_moscoso colorful, pop-art, psychedelic, typography, vibrant,
| ?wizards_artist.inna_mosina ballet, contemporary, femininity, identity, photography, photography-color, sculpture, shallow-depth-of-field,
| ?wizards_artist.richard_mosse battle-scenes, colorful, documentary, landscapes, photography, photography-color, surreal, vibrant,
| ?wizards_artist.thomas_edwin_mostyn British, landscapes, mysticism, portraits, pre-raphaelite, romanticism, still-life,
| ?wizards_artist.marcel_mouly abstract, colorful, contemporary, fauvism, French, modern, vibrant,
| ?wizards_artist.emmanuelle_moureaux abstract, colorful, contemporary, environmentalism, installation, multimedia, sculpture, vibrant,
| ?wizards_artist.alphonse_mucha art-nouveau, commercial-art, czech, femininity, portraits, posters, stained-glass,
| ?wizards_artist.craig_mullins dark, dream-like, fantasy, horror, mythology, surreal,
| ?wizards_artist.augustus_edwin_mulready commercial-art, painting, realism, romanticism, symbolist,
| ?wizards_artist.dan_mumford colorful, digital, dreams, fantasy, psychedelic, surreal, vibrant,
| ?wizards_artist.edvard_munch anxiety, dark, expressionism, impressionism, melancholy, norwegian, oil-painting,
| ?wizards_artist.alfred_munnings horses, modern, painting,
| ?wizards_artist.gabriele_munter expressionism, expressionism, painting, symbolist,
| ?wizards_artist.takashi_murakami contemporary, cute, flat-colors, Japanese, manga-anime, pop-art,
| ?wizards_artist.patrice_murciano colorful, contemporary, expressionism, messy, pop-art, portraits, surreal, vibrant,
| ?wizards_artist.scott_musgrove adventure, advertising, contemporary, illustration, landscapes,
| ?wizards_artist.wangechi_mutu collage, contemporary, feminism, identity, mixed-media,
| ?wizards_artist.go_nagai childhood, manga-anime, portraits,
| ?wizards_artist.hiroshi_nagai cityscapes, flat-colors, Japanese, landscapes, minimalism, urban-life,
| ?wizards_artist.patrick_nagel contemporary, flat-colors, high-contrast, pop-art, portraits,
| ?wizards_artist.tibor_nagy contemporary, metaphysics, sculpture, symbolist,
| ?wizards_artist.scott_naismith colorful, impressionism, landscapes, messy, seascapes, serenity, vibrant,
| ?wizards_artist.juliana_nan contemporary, macro-world, photography, photography-color,
| ?wizards_artist.ted_nasmith atmospheric, ethereal, fantasy, landscapes, magic, mythology,
| ?wizards_artist.todd_nauck adventure, characters, comics, science-fiction, superheroes,
| ?wizards_artist.bruce_nauman conceptual, contemporary, neon, performance, sculpture,
| ?wizards_artist.ernst_wilhelm_nay abstract, colorful, expressionism, figurativism, German, modern, vibrant,
| ?wizards_artist.alice_neel contemporary, expressionism, feminism, figurative, portraits, social-realism,
| ?wizards_artist.keith_negley collage, colorful, graphic-design, illustration, mixed-media, pop-art,
| ?wizards_artist.leroy_neiman colorful, contemporary, messy, painting, sports,
| ?wizards_artist.kadir_nelson African-American, contemporary, expressionism, impressionism, landscapes, portraits,
| ?wizards_artist.odd_nerdrum characters, dark, fantasy, figurative, melancholy,
| ?wizards_artist.shirin_neshat contemporary, feminism, identity, iranian, photography, photography-bw, video-art,
| ?wizards_artist.mikhail_nesterov figurative, painting, religion, religion, romanticism, spirituality,
| ?wizards_artist.jane_newland botanical, colorful, nature, serenity, watercolor,
| ?wizards_artist.victo_ngai colorful, dream-like, illustration, kids-book, playful, surreal,
| ?wizards_artist.william_nicholson modern, observational, painting, slice-of-life,
| ?wizards_artist.florian_nicolle contemporary, expressionism, messy, portraits, watercolor,
| ?wizards_artist.kay_nielsen American, danish, elegant, exoticism, fantasy, fantasy, illustration, kids-book, orientalism, painting, whimsical,
| ?wizards_artist.tsutomu_nihei alien-worlds, cyberpunk, dark, dystopia, industrial, manga-anime, monochromatic, science-fiction,
| ?wizards_artist.victor_nizovtsev colorful, dream-like, fantasy, magic, magic-realism, mysterious, surreal, whimsical,
| ?wizards_artist.isamu_noguchi Japanese, landscape-architecture, organic, sculpture,
| ?wizards_artist.catherine_nolin conceptual, contemporary, feminism, portraits,
| ?wizards_artist.francois_de_nome baroque, expressionism, mixed-media,
| ?wizards_artist.earl_norem battle-scenes, dark, fantasy, mythology,
| ?wizards_artist.phil_noto American, characters, comics, contemporary, impressionism, installation, portraits,
| ?wizards_artist.georgia_okeeffe abstract, American, figurativism, flowers, landscapes, modern, precisionism, southwest,
| ?wizards_artist.terry_oakes adventure, fantasy, magic, outer-space, science-fiction,
| ?wizards_artist.chris_ofili afro-futurism, contemporary, expressionism, figurative, mixed-media, painting, post-colonialism, watercolor,
| ?wizards_artist.jack_ohman comics, contemporary, illustration, politics, satire,
| ?wizards_artist.noriyoshi_ohrai fantasy, futuristic, posters, science-fiction, vibrant,
| ?wizards_artist.helio_oiticica abstract, angular, contemporary, installation, interactive, multimedia,
| ?wizards_artist.taro_okamoto avant-garde, gutai, Japanese, performance, sculpture, surreal,
| ?wizards_artist.tim_okamura African-American, contemporary, expressionism, graffiti, landscapes, portraits, street-art,
| ?wizards_artist.naomi_okubo collage, colorful, empowerment, feminism, identity, politics,
| ?wizards_artist.atelier_olschinsky abstract, cityscapes, digital, geometric, minimalism, modern,
| ?wizards_artist.greg_olsen contemporary, outer-space, painting, spirituality, wildlife,
| ?wizards_artist.oleg_oprisco American, contemporary, flowers, impressionism, photography, photography-color, portraits,
| ?wizards_artist.tony_orrico contemporary, installation, minimalism, sculpture,
| ?wizards_artist.mamoru_oshii animation, contemporary, manga-anime, metaphysics, science-fiction,
| ?wizards_artist.ida_rentoul_outhwaite art-nouveau, dream-like, fantasy, femininity, folklore, kids-book, nature, watercolor, whimsical,
| ?wizards_artist.yigal_ozeri contemporary, observational, painting, realism, slice-of-life,
| ?wizards_artist.gabriel_pacheco contemporary, dark, figurative, painting, surreal,
| ?wizards_artist.michael_page colorful, contemporary, expressionism, playful, pop-art, vibrant, whimsical,
| ?wizards_artist.rui_palha conceptual, contemporary, installation, monochromatic, photography, photography-bw,
| ?wizards_artist.polixeni_papapetrou contemporary, photography, photography-color, portraits, surreal,
| ?wizards_artist.julio_le_parc abstract, colorful, graphic-design, playful, pop-art, vibrant,
| ?wizards_artist.michael_parkes dream-like, ethereal, fantasy, magic-realism, spirituality,
| ?wizards_artist.philippe_parreno conceptual, contemporary, film, installation, multimedia, post-modern,
| ?wizards_artist.maxfield_parrish art-nouveau, fantasy, nostalgia, painting,
| ?wizards_artist.alice_pasquini contemporary, documentary, mural-painting, public-art, social-realism, street-art,
| ?wizards_artist.james_mcintosh_patrick contemporary, mixed-media, painting,
| ?wizards_artist.john_pawson abstract, architecture, British, contemporary, minimalism,
| ?wizards_artist.max_pechstein colorful, expressionism, modern, vibrant,
| ?wizards_artist.agnes_lawrence_pelton abstract, color-field, contemporary, ethereal, modern, serenity, spirituality,
| ?wizards_artist.irving_penn characters, contemporary, expressionism, monochromatic, photography, photography-bw, portraits,
| ?wizards_artist.bruce_pennington colorful, fantasy, futuristic, landscapes, outer-space, science-fiction,
| ?wizards_artist.john_perceval abstract, expressionism, messy,
| ?wizards_artist.george_perez contemporary, mixed-media, street-art,
| ?wizards_artist.constant_permeke expressionism, expressionism, painting, sculpture, symbolist,
| ?wizards_artist.lilla_cabot_perry American, gardens, impressionism, interiors,
| ?wizards_artist.gaetano_pesce architecture, contemporary, organic, vibrant,
| ?wizards_artist.cleon_peterson characters, contemporary, flat-colors, geometric, graphic-design, social-commentary,
| ?wizards_artist.daria_petrilli American, contemporary, impressionism, low-contrast, portraits, whimsical,
| ?wizards_artist.raymond_pettibon comics, contemporary, drawing, high-contrast,
| ?wizards_artist.coles_phillips advertising, art-deco, fashion, femininity, illustration, nostalgia,
| ?wizards_artist.francis_picabia avant-garde, dadaism, French, painting, surreal,
| ?wizards_artist.pablo_picasso collage, cubism, impressionism, modern, sculpture, spanish, surreal,
| ?wizards_artist.sopheap_pich contemporary, installation, sculpture,
| ?wizards_artist.otto_piene contemporary, installation, kinetic,
| ?wizards_artist.jerry_pinkney characters, fantasy, illustration, kids-book,
| ?wizards_artist.pinturicchio allegory, painting, religion, renaissance,
| ?wizards_artist.sebastiano_del_piombo expressionism, landscapes, portraits, renaissance, sculpture,
| ?wizards_artist.camille_pissarro impressionism, impressionism, observational, painting, printmaking,
| ?wizards_artist.ferris_plock contemporary, illustration, whimsical,
| ?wizards_artist.bill_plympton animation, cartoon, sketching, whimsical,
| ?wizards_artist.willy_pogany American, fantasy, hungarian, illustration, kids-book, ornate, whimsical,
| ?wizards_artist.patricia_polacco animals, colorful, family, illustration, kids-book, nostalgia,
| ?wizards_artist.jackson_pollock abstract, action-painting, American, drip-painting, expressionism, messy,
| ?wizards_artist.beatrix_potter animals, book-illustration, British, kids-book, nature, watercolor, whimsical,
| ?wizards_artist.edward_henry_potthast impressionism, landscapes, painting,
| ?wizards_artist.simon_prades conceptual, contemporary, digital, dream-like, magic-realism, pop-art, surreal,
| ?wizards_artist.maurice_prendergast impressionism, impressionism, observational, painting,
| ?wizards_artist.dod_procter expressionism, impressionism, landscapes, portraits,
| ?wizards_artist.leo_putz art-nouveau, expressionism, impressionism, mixed-media,
| ?wizards_artist.howard_pyle adventure, American, history, illustration, kids-book, posters,
| ?wizards_artist.arthur_rackham British, creatures, fantasy, illustration, kids-book, magic,
| ?wizards_artist.natalia_rak childhood, colorful, contemporary, expressionism, portraits, street-art, whimsical,
| ?wizards_artist.paul_ranson abstract, art-nouveau, dream-like, nature, vibrant, whimsical,
| ?wizards_artist.raphael painting, renaissance,
| ?wizards_artist.abraham_rattner expressionism, expressionism, painting, sculpture, symbolist,
| ?wizards_artist.jan_van_ravesteyn architecture, baroque, observational, plein-air, sculpture,
| ?wizards_artist.aliza_razell conceptual, dream-like, eerie, ethereal, fantasy, photography, photography-color, surreal,
| ?wizards_artist.paula_rego contemporary, expressionism, impressionism, landscapes, portraits,
| ?wizards_artist.lotte_reiniger animation, folklore, German, nostalgia, puppets, silhouettes,
| ?wizards_artist.valentin_rekunenko dream-like, fantasy, surreal, whimsical,
| ?wizards_artist.christoffer_relander American, contemporary, impressionism, monochromatic, nature, photography, photography-bw, portraits,
| ?wizards_artist.andrey_remnev baroque, characters, contemporary, expressionism, portraits, renaissance,
| ?wizards_artist.pierre_auguste_renoir female-figures, femininity, French, impressionism, landscapes, outdoor-scenes, pastel, plein-air, portraits,
| ?wizards_artist.ilya_repin expressionism, impressionism, landscapes, portraits,
| ?wizards_artist.joshua_reynolds expressionism, landscapes, portraits, romanticism,
| ?wizards_artist.rhads digital, landscapes, magic-realism, mixed-media, surreal, vibrant,
| ?wizards_artist.bettina_rheims celebrity, contemporary, fashion, identity, photography, photography-bw, portraits,
| ?wizards_artist.jason_rhoades conceptual, contemporary, installation, sculpture,
| ?wizards_artist.georges_ribemont_dessaignes avant-garde, dadaism, French,
| ?wizards_artist.jusepe_de_ribera baroque, dark, expressionism, portraits,
| ?wizards_artist.gerhard_richter abstract, blurry, contemporary, German, multimedia, oil-painting, photorealism,
| ?wizards_artist.chris_riddell cartoon, creatures, fantasy, illustration, kids-book, watercolor, whimsical,
| ?wizards_artist.hyacinthe_rigaud baroque, expressionism, landscapes, portraits,
| ?wizards_artist.rembrandt_van_rijn baroque, Dutch, etching, history, portraits, religion, self-portraits,
| ?wizards_artist.faith_ringgold activism, African-American, contemporary, expressionism, feminism, pop-art, quilting,
| ?wizards_artist.jozsef_rippl_ronai hungarian, landscapes, post-impressionism, realism,
| ?wizards_artist.pipilotti_rist colorful, dream-like, female-figures, immersive, installation, playful, swiss, vibrant, video-art,
| ?wizards_artist.charles_robinson painting, politics, realism, satire,
| ?wizards_artist.theodore_robinson contemporary, mixed-media,
| ?wizards_artist.kenneth_rocafort comics, contemporary, fantasy, graphic-novel, illustration, illustration, science-fiction, superheroes,
| ?wizards_artist.andreas_rocha atmospheric, dark, digital, fantasy, landscapes,
| ?wizards_artist.norman_rockwell American, illustration, nostalgia, painting, pop-culture, realism, slice-of-life,
| ?wizards_artist.ludwig_mies_van_der_rohe architecture, modern,
| ?wizards_artist.fatima_ronquillo contemporary, expressionism, landscapes, portraits, whimsical,
| ?wizards_artist.salvator_rosa baroque, painting, renaissance, sculpture,
| ?wizards_artist.kerby_rosanes contemporary, illustration, whimsical,
| ?wizards_artist.conrad_roset contemporary, expressionism, impressionism, pastel-colors, portraits, watercolor,
| ?wizards_artist.bob_ross commercial-art, consumerism, contemporary, landscapes, painting,
| ?wizards_artist.dante_gabriel_rossetti contemporary, expressionism, landscapes, portraits, romanticism,
| ?wizards_artist.jessica_rossier conceptual, dark, digital, landscapes, outer-space, spirituality, surreal, whimsical,
| ?wizards_artist.marianna_rothen conceptual, contemporary, femininity, identity, muted-colors, photography, photography-color,
| ?wizards_artist.mark_rothko abstract, American, color-field, expressionism, large-scale, minimalism, spirituality,
| ?wizards_artist.eva_rothschild contemporary, irish, sculpture,
| ?wizards_artist.georges_rousse femininity, impressionism, mysticism, neo-impressionism, painting, post-impressionism,
| ?wizards_artist.luis_royo contemporary, fantasy, landscapes, messy, portraits,
| ?wizards_artist.joao_ruas characters, comics, dark, fantasy, gothic, horror, noir,
| ?wizards_artist.peter_paul_rubens baroque, flemish, history, mythology, nudes, oil-painting, painting, renaissance, romanticism,
| ?wizards_artist.rachel_ruysch baroque, painting, still-life,
| ?wizards_artist.albert_pinkham_ryder dream-like, impressionism, painting, seascapes,
| ?wizards_artist.mark_ryden big-eyes, childhood, contemporary, creatures, dark, dream-like, illustration, surreal,
| ?wizards_artist.ursula_von_rydingsvard abstract, metamorphosis, minimalism, sculpture,
| ?wizards_artist.theo_van_rysselberghe expressionism, impressionism, landscapes, portraits,
| ?wizards_artist.eero_saarinen architecture, metaphysics, modern, modern,
| ?wizards_artist.wlad_safronow angular, colorful, contemporary, expressionism, portraits,
| ?wizards_artist.amanda_sage contemporary, expressionism, playful, psychedelic, surreal, whimsical,
| ?wizards_artist.antoine_de_saint_exupery adventure, French, illustration, kids-book, spirituality, whimsical,
| ?wizards_artist.nicola_samori contemporary, dark, expressionism, landscapes, portraits,
| ?wizards_artist.rebeca_saray conceptual, contemporary, digital, fashion, femininity, identity, photography, photography-color, portraits,
| ?wizards_artist.john_singer_sargent expressionism, impressionism, landscapes, portraits,
| ?wizards_artist.martiros_saryan colorful, impressionism, landscapes, nature, serenity, vibrant, wildlife,
| ?wizards_artist.viviane_sassen conceptual, contemporary, geometric, photography, photography-color, surreal, vibrant,
| ?wizards_artist.nike_savvas abstract, contemporary, large-scale, painting,
| ?wizards_artist.richard_scarry animals, anthropomorphism, colorful, contemporary, illustration, kids-book, playful, whimsical,
| ?wizards_artist.godfried_schalcken American, contemporary, Dutch, muscles, portraits,
| ?wizards_artist.miriam_schapiro abstract, contemporary, expressionism, feminism, politics, vibrant,
| ?wizards_artist.kenny_scharf colorful, playful, pop-art, psychedelic, surreal, vibrant, whimsical,
| ?wizards_artist.jerry_schatzberg characters, monochromatic, noir, nostalgia, photography, photography-bw, portraits, urban-life,
| ?wizards_artist.ary_scheffer Dutch, mythology, neo-classicism, portraits, religion, romanticism,
| ?wizards_artist.kees_scherer color-field, contemporary, impressionism, landscapes,
| ?wizards_artist.helene_schjerfbeck expressionism, finnish, identity, portraits, self-portraits,
| ?wizards_artist.christian_schloe dream-like, fantasy, mysterious, portraits, romanticism, surreal,
| ?wizards_artist.karl_schmidt_rottluff abstract, colorful, expressionism, figurativism, German, Japanese, landscapes, vibrant, woodblock,
| ?wizards_artist.julian_schnabel figurative, messy, neo-expressionism, painting,
| ?wizards_artist.fritz_scholder color-field, expressionism, identity, native-American, portraits, spirituality,
| ?wizards_artist.charles_schulz American, cartoon, characters, childhood, comics, nostalgia, social-commentary,
| ?wizards_artist.sean_scully abstract, angular, grids, minimalism,
| ?wizards_artist.ronald_searle cartoon, comics, illustration, whimsical,
| ?wizards_artist.mark_seliger American, anxiety, celebrity, contemporary, monochromatic, photography, photography-bw, portraits,
| ?wizards_artist.anton_semenov contemporary, dark, digital, horror, illustration, painting, shock-art, surreal,
| ?wizards_artist.edmondo_senatore atmospheric, monochromatic, photography, photography-bw, portraits,
| ?wizards_artist.maurice_sendak American, fantasy, illustration, kids-book, whimsical, wilderness,
| ?wizards_artist.richard_serra contemporary, installation, large-scale, minimalism, sculpture,
| ?wizards_artist.georges_seurat color-field, impressionism, landscapes, nature, painting, pointillism,
| ?wizards_artist.dr_seuss cartoon, characters, colorful, kids-book, playful, whimsical,
| ?wizards_artist.tanya_shatseva contemporary, eerie, painting, russian, surreal,
| ?wizards_artist.natalie_shau characters, digital, dream-like, fantasy, femininity, mixed-media, pastel-colors, photorealism, surreal, whimsical,
| ?wizards_artist.barclay_shaw angular, cyberpunk, dark, futuristic, industrial, science-fiction,
| ?wizards_artist.e_h_shepard animals, drawing, illustration, kids-book, nature, nostalgia, watercolor, whimsical,
| ?wizards_artist.amrita_sher_gil female-figures, folklore, Indian, modern, painting, portraits, social-commentary,
| ?wizards_artist.irene_sheri femininity, flowers, impressionism, nature, pastel, portraits, romanticism, serenity,
| ?wizards_artist.duffy_sheridan interiors, photorealism, pop-culture, portraits,
| ?wizards_artist.cindy_sherman conceptual, contemporary, feminism, identity, photography, photography-color, portraits, post-modern, self-portraits,
| ?wizards_artist.shozo_shimamoto abstract, action-painting, collaborative, gutai, Japanese, messy, mixed-media, performance, post-war,
| ?wizards_artist.hikari_shimoda big-eyes, childhood, colorful, digital, fantasy, Japanese, manga-anime, portraits, vibrant,
| ?wizards_artist.makoto_shinkai contemporary, film, fleeting-moments, manga-anime, slice-of-life,
| ?wizards_artist.chiharu_shiota conceptual, environmentalism, immersive, installation, low-contrast, messy, vibrant,
| ?wizards_artist.elizabeth_shippen_green American, dream-like, fairies, illustration, kids-book,
| ?wizards_artist.masamune_shirow cartoon, characters, comics, fantasy, manga-anime, robots-cyborgs, science-fiction,
| ?wizards_artist.tim_shumate animals, big-eyes, cartoon, childhood, dreams, portraits, whimsical,
| ?wizards_artist.yuri_shwedoff contemporary, fantasy, illustration, surreal,
| ?wizards_artist.malick_sidibe African-American, documentary, harlem-renaissance, monochromatic, photography, photography-bw, slice-of-life,
| ?wizards_artist.jeanloup_sieff erotica, fashion, landscapes, monochromatic, nudes, photography, photography-bw, portraits,
| ?wizards_artist.bill_sienkiewicz comics, dark, expressionism, figurativism, grungy, messy, pop-art, superheroes, watercolor,
| ?wizards_artist.marc_simonetti dark, digital, dream-like, fantasy, landscapes, surreal,
| ?wizards_artist.david_sims British, contemporary, fashion, photography, photography-bw, photography-color,
| ?wizards_artist.andy_singer American, celebrity, consumerism, pop-art,
| ?wizards_artist.alfred_sisley French, impressionism, landscapes, nature, plein-air, portraits,
| ?wizards_artist.sandy_skoglund conceptual, contemporary, installation, still-life, surreal, vibrant, whimsical,
| ?wizards_artist.jeffrey_smart dream-like, Scottish, surreal,
| ?wizards_artist.berndnaut_smilde cloudscapes, Dutch, installation, metamorphosis, photography, photography-color, surreal,
| ?wizards_artist.rodney_smith fashion, monochromatic, photography, photography-bw, portraits,
| ?wizards_artist.samantha_keely_smith abstract, abstract-expressionism, contemporary, dream-like, loneliness, painting,
| ?wizards_artist.robert_smithson conceptual, earthworks, environmentalism, land-art, post-minimalism, sculpture,
| ?wizards_artist.barbara_stauffacher_solomon commercial-art, contemporary, graphic-design, graphic-design, pop-art,
| ?wizards_artist.simeon_solomon jewish, lgbtq, metaphysics, painting, pre-Raphaelite, symbolist,
| ?wizards_artist.hajime_sorayama characters, erotica, futuristic, robots-cyborgs, science-fiction, technology,
| ?wizards_artist.joaquin_sorolla beach-scenes, impressionism, landscapes, portraits, seascapes, spanish,
| ?wizards_artist.ettore_sottsass architecture, art-deco, colorful, furniture, playful, sculpture,
| ?wizards_artist.amadeo_de_souza_cardoso cubism, futurism, modern, painting, portuguese,
| ?wizards_artist.millicent_sowerby botanical, British, flowers, illustration, kids-book, nature,
| ?wizards_artist.moses_soyer figurative, painting, portraits, realism,
| ?wizards_artist.sparth digital, fantasy, futuristic, landscapes, minimalism, science-fiction, surreal,
| ?wizards_artist.jack_spencer contemporary, muted-colors, photography, photography-color,
| ?wizards_artist.art_spiegelman American, animals, autobiographical, cartoon, comics, graphic-novel, history, holocaust,
| ?wizards_artist.simon_stalenhag digital, eerie, futurism, landscapes, nostalgia, rural-life, science-fiction, suburbia,
| ?wizards_artist.ralph_steadman cartoon, dark, grungy, illustration, messy, satire, surreal, whimsical,
| ?wizards_artist.philip_wilson_steer atmospheric, British, impressionism, landscapes, portraits, seascapes,
| ?wizards_artist.william_steig colorful, illustration, kids-book, playful, watercolor,
| ?wizards_artist.fred_stein contemporary, impressionism, landscapes, realism,
| ?wizards_artist.theophile_steinlen allegory, art-nouveau, observational, printmaking,
| ?wizards_artist.brian_stelfreeze activism, comics, contemporary, digital, illustration, social-realism,
| ?wizards_artist.frank_stella abstract, angular, colorful, cubism, expressionism, geometric, modern, vibrant,
| ?wizards_artist.joseph_stella angular, colorful, cubism, expressionism, geometric, minimalism, modern,
| ?wizards_artist.irma_stern expressionism, figurativism, portraits,
| ?wizards_artist.alfred_stevens fashion, femininity, impressionism, luxury, portraits,
| ?wizards_artist.marie_spartali_stillman femininity, medieval, mythology, portraits, pre-raphaelite, romanticism, vibrant,
| ?wizards_artist.stinkfish colombian, colorful, graffiti, portraits, street-art, surreal, urban-life, vibrant,
| ?wizards_artist.anne_stokes characters, dark, eerie, fantasy, gothic, mysterious, whimsical,
| ?wizards_artist.william_stout dark, fantasy, gothic, mythology,
| ?wizards_artist.paul_strand American, landscapes, minimalism, monochromatic, photography, photography-bw, portraits, still-life, urban-life,
| ?wizards_artist.linnea_strid childhood, femininity, nostalgia, photography, photography-color, portraits,
| ?wizards_artist.john_melhuish_strudwick mythology, pre-raphaelite, romanticism, victorian,
| ?wizards_artist.drew_struzan fantasy, nostalgia, portraits, posters, science-fiction,
| ?wizards_artist.tatiana_suarez collage, colorful, pop-art, pop-culture, portraits,
| ?wizards_artist.eustache_le_sueur baroque, fleeting-moments, impressionism, painting, portraits,
| ?wizards_artist.rebecca_sugar contemporary, feminism, installation, mixed-media,
| ?wizards_artist.hiroshi_sugimoto architecture, conceptual, geometric, Japanese, long-exposure, monochromatic, photography, photography-bw, seascapes,
| ?wizards_artist.graham_sutherland battle-scenes, British, distortion, eerie, expressionism, landscapes, messy, portraits,
| ?wizards_artist.jan_svankmajer animation, dark, horror, puppets, sculpture, surreal,
| ?wizards_artist.raymond_swanland atmospheric, dark, digital, eerie, fantasy,
| ?wizards_artist.annie_swynnerton femininity, feminism, mythology, portraits, spirituality,
| ?wizards_artist.stanislaw_szukalski metaphysics, mysticism, primitivism, sculpture, surreal,
| ?wizards_artist.philip_taaffe abstract, contemporary, painting, symbolist,
| ?wizards_artist.hiroyuki_mitsume_takahashi childhood, colorful, comics, contemporary, Japanese, manga-anime, portraits, social-commentary,
| ?wizards_artist.dorothea_tanning dream-like, eerie, figure-studies, metamorphosis, surreal,
| ?wizards_artist.margaret_tarrant British, colorful, dream-like, folklore, illustration, kids-book, whimsical,
| ?wizards_artist.genndy_tartakovsky animation, cartoon, characters, contemporary, playful, whimsical,
| ?wizards_artist.teamlab colorful, digital, immersive, installation, interactive, light-art, technology, vibrant,
| ?wizards_artist.raina_telgemeier autobiographical, comics, contemporary, graphic-novel, graphic-novel, slice-of-life,
| ?wizards_artist.john_tenniel drawing, fantasy, kids-book, whimsical,
| ?wizards_artist.sir_john_tenniel British, fantasy, illustration, kids-book, victorian, whimsical,
| ?wizards_artist.howard_terpning contemporary, landscapes, realism,
| ?wizards_artist.osamu_tezuka animation, cartoon, characters, Japanese, manga-anime, robots-cyborgs, science-fiction,
| ?wizards_artist.abbott_handerson_thayer American, atmospheric, landscapes, portraits, romanticism, serenity, tonalism,
| ?wizards_artist.heather_theurer baroque, dream-like, erotica, ethereal, fantasy, mythology, renaissance, romanticism,
| ?wizards_artist.mickalene_thomas African-American, collage, contemporary, femininity, identity, painting, portraits,
| ?wizards_artist.tom_thomson art-nouveau, canadian, expressionism, impressionism, landscapes, nature, wilderness,
| ?wizards_artist.titian dark, italian, mythology, oil-painting, painting, portraits, religion, renaissance,
| ?wizards_artist.mark_tobey abstract, modern, painting, spirituality,
| ?wizards_artist.greg_tocchini contemporary, expressionism, sculpture,
| ?wizards_artist.roland_topor animation, dark, eerie, horror, satire, surreal,
| ?wizards_artist.sergio_toppi fantasy, illustration, whimsical,
| ?wizards_artist.alex_toth animals, bronze, cartoon, comics, figurative, wildlife,
| ?wizards_artist.henri_de_toulouse_lautrec art-nouveau, cabaret, French, impressionism, lithography, nightlife, portraits, posters,
| ?wizards_artist.ross_tran conceptual, digital, femininity, figurativism, manga-anime, minimalism, pastel-colors, portraits, realism,
| ?wizards_artist.philip_treacy avant-garde, fashion, hats, luxury, opulent, photography, photography-color, portraits,
| ?wizards_artist.anne_truitt conceptual, minimalism, minimalism, sculpture,
| ?wizards_artist.henry_scott_tuke figure-studies, impressionism, landscapes, realism,
| ?wizards_artist.jmw_turner atmospheric, British, landscapes, painting, romanticism, seascapes,
| ?wizards_artist.james_turrell architecture, colorful, contemporary, geometric, installation, light-art, minimalism, sculpture, vibrant,
| ?wizards_artist.john_henry_twachtman American, impressionism, landscapes, nature, pastel-colors,
| ?wizards_artist.naomi_tydeman contemporary, impressionism, landscapes, watercolor,
| ?wizards_artist.euan_uglow British, figurativism, interiors, portraits, still-life,
| ?wizards_artist.daniela_uhlig characters, contemporary, digital, dream-like, ethereal, German, landscapes, portraits, surreal,
| ?wizards_artist.kitagawa_utamaro edo-period, fashion, female-figures, genre-scenes, Japanese, nature, portraits, ukiyo-e, woodblock,
| ?wizards_artist.christophe_vacher cloudscapes, dream-like, ethereal, fantasy, landscapes, magic-realism,
| ?wizards_artist.suzanne_valadon mysterious, nudes, post-impressionism,
| ?wizards_artist.thiago_valdi brazilian, colorful, contemporary, street-art, urban-life,
| ?wizards_artist.chris_van_allsburg adventure, American, illustration, kids-book, mysterious, psychedelic,
| ?wizards_artist.francine_van_hove drawing, expressionism, female-figures, nudes, portraits, slice-of-life,
| ?wizards_artist.jan_van_kessel_the_elder allegory, baroque, nature, observational, painting, still-life,
| ?wizards_artist.remedios_varo low-contrast, magic-realism, spanish, surreal,
| ?wizards_artist.nick_veasey contemporary, monochromatic, photography, photography-bw, urban-life,
| ?wizards_artist.diego_velazquez baroque, history, oil-painting, portraits, realism, religion, royalty, spanish,
| ?wizards_artist.eve_ventrue characters, costumes, dark, digital, fantasy, femininity, gothic, illustration,
| ?wizards_artist.johannes_vermeer baroque, domestic-scenes, Dutch, genre-scenes, illusion, interiors, portraits,
| ?wizards_artist.charles_vess comics, dream-like, fantasy, magic, mythology, romanticism, watercolor, whimsical,
| ?wizards_artist.roman_vishniac documentary, jewish, photography, photography-bw,
| ?wizards_artist.kelly_vivanco big-eyes, consumerism, contemporary, femininity, sculpture,
| ?wizards_artist.brian_m_viveros contemporary, digital, dream-like, fantasy, femininity, gothic, portraits, surreal,
| ?wizards_artist.elke_vogelsang animals, contemporary, painting,
| ?wizards_artist.vladimir_volegov femininity, impressionism, landscapes, portraits, romanticism, russian,
| ?wizards_artist.robert_vonnoh American, bronze, impressionism, sculpture,
| ?wizards_artist.mikhail_vrubel painting, religion, sculpture, symbolist,
| ?wizards_artist.louis_wain animals, colorful, creatures, fantasy, kids-book, playful, psychedelic, whimsical,
| ?wizards_artist.kara_walker African-American, contemporary, identity, silhouettes,
| ?wizards_artist.josephine_wall colorful, digital, femininity, pop-art, portraits, psychedelic, whimsical,
| ?wizards_artist.bruno_walpoth figurative, photorealism, sculpture,
| ?wizards_artist.chris_ware American, cartoon, characters, comics, graphic-novel, modern-life, slice-of-life,
| ?wizards_artist.andy_warhol celebrity, contemporary, pop-art, portraits, vibrant,
| ?wizards_artist.john_william_waterhouse fantasy, femininity, mythology, portraits, pre-raphaelite, romanticism,
| ?wizards_artist.bill_watterson American, characters, childhood, friendship, loneliness, melancholy, nostalgia,
| ?wizards_artist.george_frederic_watts mysticism, portraits, spirituality,
| ?wizards_artist.walter_ernest_webster expressionism, painting, portraits,
| ?wizards_artist.hendrik_weissenbruch landscapes, observational, painting, plein-air,
| ?wizards_artist.neil_welliver contemporary, environmentalism, landscapes, realism,
| ?wizards_artist.catrin_welz_stein digital, fantasy, magic, portraits, surreal, whimsical,
| ?wizards_artist.vivienne_westwood contemporary, fashion, feminism, messy,
| ?wizards_artist.michael_whelan alien-worlds, dream-like, eerie, fantasy, outer-space, science-fiction, surreal,
| ?wizards_artist.james_abbott_mcneill_whistler American, drawing, etching, interiors, low-contrast, portraits, tonalism, whimsical,
| ?wizards_artist.william_whitaker contemporary, documentary, landscapes, painting, social-realism,
| ?wizards_artist.tim_white atmospheric, fantasy, immersive, landscapes, science-fiction,
| ?wizards_artist.coby_whitmore childhood, figure-studies, nostalgia, portraits,
| ?wizards_artist.david_wiesner cartoon, kids-book, playful, whimsical,
| ?wizards_artist.kehinde_wiley African-American, baroque, colorful, contemporary, identity, photorealism, portraits, vibrant,
| ?wizards_artist.cathy_wilkes activism, contemporary, photography, photography-color, social-commentary, surreal,
| ?wizards_artist.jessie_willcox_smith American, childhood, folklore, illustration, kids-book, nostalgia, whimsical,
| ?wizards_artist.gilbert_williams fantasy, landscapes, magic, nostalgia, whimsical,
| ?wizards_artist.kyffin_williams contemporary, landscapes, painting,
| ?wizards_artist.al_williamson adventure, comics, fantasy, mythology, science-fiction,
| ?wizards_artist.wes_wilson contemporary, psychedelic,
| ?wizards_artist.mike_winkelmann color-field, conceptual, contemporary, digital, geometric, minimalism,
| ?wizards_artist.bec_winnel ethereal, femininity, flowers, pastel, portraits, romanticism, serenity,
| ?wizards_artist.franz_xaver_winterhalter fashion, luxury, portraits, romanticism, royalty,
| ?wizards_artist.nathan_wirth atmospheric, contemporary, landscapes, monochromatic, nature, photography, photography-bw,
| ?wizards_artist.wlop characters, digital, fantasy, femininity, manga-anime, portraits,
| ?wizards_artist.brandon_woelfel cityscapes, neon, nightlife, photography, photography-color, shallow-depth-of-field, urban-life,
| ?wizards_artist.liam_wong colorful, dystopia, futuristic, photography, photography-color, science-fiction, urban-life, vibrant,
| ?wizards_artist.francesca_woodman American, contemporary, female-figures, feminism, monochromatic, nudes, photography, photography-bw, self-portraits,
| ?wizards_artist.jim_woodring aliens, American, characters, comics, creatures, dream-like, fantasy, pen-and-ink, psychedelic, surreal,
| ?wizards_artist.patrick_woodroffe dream-like, eerie, illusion, science-fiction, surreal,
| ?wizards_artist.frank_lloyd_wright angular, architecture, art-deco, environmentalism, furniture, nature, organic,
| ?wizards_artist.sulamith_wulfing dream-like, ethereal, fantasy, German, illustration, kids-book, spirituality, whimsical,
| ?wizards_artist.nc_wyeth American, illustration, kids-book, nature, nostalgia, realism, rural-life,
| ?wizards_artist.rose_wylie contemporary, figurative, observational, painting, portraits,
| ?wizards_artist.stanislaw_wyspianski painting, polish, romanticism,
| ?wizards_artist.takato_yamamoto dreams, fantasy, mysterious, portraits,
| ?wizards_artist.gene_luen_yang contemporary, graphic-novel, illustration, manga-anime,
| ?wizards_artist.ikenaga_yasunari contemporary, femininity, Japanese, portraits,
| ?wizards_artist.kozo_yokai colorful, folklore, illustration, Japanese, kids-book, magic, monsters, playful,
| ?wizards_artist.sean_yoro activism, identity, portraits, public-art, social-commentary, street-art, urban-life,
| ?wizards_artist.chie_yoshii characters, childhood, colorful, illustration, manga-anime, pop-culture, portraits, whimsical,
| ?wizards_artist.skottie_young cartoon, comics, contemporary, illustration, playful, whimsical,
| ?wizards_artist.masaaki_yuasa animation, colorful, eerie, fantasy, Japanese, surreal,
| ?wizards_artist.konstantin_yuon color-field, impressionism, landscapes,
| ?wizards_artist.yuumei characters, digital, dream-like, environmentalism, fantasy, femininity, manga-anime, whimsical,
| ?wizards_artist.william_zorach cubism, expressionism, folk-art, modern, sculpture,
| ?wizards_artist.ander_zorn etching, nudes, painting, portraits, Swedish,
// artists added by me (ariane-emory)
| ?wizards_artist.ian_miller fantasy, warhammer, pen and ink, rapidograph, technical pen, pen and ink, illustration, cross-hatching, eerie ,
| ?wizards_artist.john_zeleznik science-fiction, rifts, palladium-books, painting,
| ?wizards_artist.keith_parkinson fantasy, medieval, Tsr, magic-the-gathering, MTG, painting,
| ?wizards_artist.kevin_fales atmospheric, dark, fantasy, medieval, oil-painting, Rifts, palladium-books,
| ?wizards_artist.boris_vallejo fantasy, science-fiction, magic, nature, muscles, femininity,
}}
`;
// -------------------------------------------------------------------------------------------------
let prelude_parse_result = null;
// -------------------------------------------------------------------------------------------------
function load_prelude(into_context = new Context()) {
  if (! prelude_parse_result) {
    const old_log_match_enabled = log_match_enabled;
    log_match_enabled = false; 
    prelude_parse_result = Prompt.match(prelude_text);
    log_match_enabled = old_log_match_enabled;
  }
  
  const ignored = expand_wildcards(prelude_parse_result.value, into_context);

  if (ignored === undefined)
    throw new Error("crap");
  
  return into_context;
}
// =================================================================================================
// END OF PRELUDE HELPER FUNCTIONS/VARS FOR DEALING WITH THE PRELUDE.
// =================================================================================================


// =================================================================================================
// THE MAIN AST-WALKING FUNCTION THAT I'LL BE USING FOR THE SD PROMPT GRAMMAR'S OUTPUT:
// =================================================================================================
function expand_wildcards(thing, context = new Context(), indent = 0) {
  // ---------------------------------------------------------------------------------------------
  function forbid_fun(option) {
    for (const not_flag of option.not_flags)
      if (context.flag_is_set(not_flag.flag))
        return true;
    return false;
  };
  // -----------------------------------------------------------------------------------------------
  function allow_fun(option) {
    let allowed = true;
    
    for (const check_flag of option.check_flags) {
      let found = false;
      
      for (const flag of check_flag.flags) {
        if (context.flag_is_set(flag)) {
          found = true;
          break;
        }
      }
      
      if (!found) {
        allowed = false;
        break;
      }
    }
    
    return allowed;
  };
  // -----------------------------------------------------------------------------------------------
  const thing_str_repr = thing => {
    const type_str  = typeof thing === 'object' ? thing.constructor.name : typeof thing;
    const thing_str = abbreviate(Array.isArray(thing)
                                 ? thing.join(' ')
                                 : (typeof thing === 'string'
                                    ? inspect_fun(thing)
                                    : thing.toString()));
    return `${type_str} ${thing_str}`
  }
  // -----------------------------------------------------------------------------------------------
  const thing_type_str = thing =>
        typeof thing === 'object' ? thing.constructor.name : typeof thing;
  // -----------------------------------------------------------------------------------------------
  const log = (guard_bool, msg) => { 
    if (! msg && msg !== '') throw new Error("bomb 1");
    if (guard_bool) console.log(`${' '.repeat(log_expand_and_walk_enabled ? indent*2 : 0)}${msg}`);
  };
  // -----------------------------------------------------------------------------------------------
  function walk(thing, indent = 0) {
    const log = (guard_bool, msg) => {
      if (! msg && msg !== '') throw new Error("bomb 1");
      if (guard_bool) console.log(`${' '.repeat(log_expand_and_walk_enabled ? indent*2 : 0)}${msg}`);
    };

    // log(log_expand_and_walk_enabled,
    //     `walk thing: ${abbreviate(Array.isArray(thing) ? thing.join(' ') : thing.toString())}`);
    
    log(log_expand_and_walk_enabled,
        `Walking ` +
        // `${thing_type_str(thing)} ` +
        `${thing_str_repr(thing)} in ` + 
        `${context}`);
    
    // ---------------------------------------------------------------------------------------------
    // basic types (strings and Arrays):
    // ---------------------------------------------------------------------------------------------
    if (typeof thing === 'string')
      return thing;
    // ---------------------------------------------------------------------------------------------
    else if (Array.isArray(thing)) {
      const ret = [];

      for (const t of thing) 
        ret.push(walk(t, indent + 1));

      return ret;
    }
    // ---------------------------------------------------------------------------------------------
    // flags:
    // ---------------------------------------------------------------------------------------------
    else if (thing instanceof ASTSetFlag) {
      // log(`SET FLAG '${thing.name}'.`);
      
      context.set_flag(thing.flag);

      return ''; // produce nothing
    }
    // ---------------------------------------------------------------------------------------------
    else if (thing instanceof ASTUnsetFlag) {
      log(log_flags_enabled,
          `UNSETTING FLAG '${thing.flag}'.`);

      context.unset_flag(thing.flag);
      
      return ''; // produce nothing
    }
    // ---------------------------------------------------------------------------------------------
    // references:
    // ---------------------------------------------------------------------------------------------
    else if (thing instanceof ASTNamedWildcardReference) {
      const got = context.named_wildcards.get(thing.name);

      if (!got)
        return `\\<ERROR: NAMED WILDCARD '${thing.name}' NOT FOUND!>`;

      let res = [];
      
      if (got instanceof ASTLatchedNamedWildcardValue) {
        for (let ix = 0; ix < rand_int(thing.min_count, thing.max_count); ix++)
          res.push(expand_wildcards(got, context, indent + 1)); // not walk!
      }
      else {
        const priority = thing.min_count === 1 && thing.max_count === 1
              ? context.pick_one_priority
              : context.pick_multiple_priority;
        
        const picks = got.pick(thing.min_count, thing.max_count,
                               allow_fun, forbid_fun,
                               priority);
        
        res.push(...picks.map(p => expand_wildcards(p?.body ?? '', context, indent + 1))); // not walk!
      }
      
      res = res.filter(s => s !== '');

      if (thing.capitalize && res.length > 0) {
        res[0] = capitalize(res[0]);
      }

      return thing.joiner == ','
        ? res.join(", ")
        : (thing.joiner == '&'
           ? pretty_list(res)
           : res.join(" "));
    }
    // ---------------------------------------------------------------------------------------------
    else if (thing instanceof ASTScalarReference) {
      let got = context.scalar_variables.get(thing.name) ??
          `SCALAR '${thing.name}' NOT FOUND}`;

      if (thing.capitalize)
        got = capitalize(got);

      return got;
    }
    // ---------------------------------------------------------------------------------------------
    // NamedWildcards:
    // ---------------------------------------------------------------------------------------------
    else if (thing instanceof ASTLatchNamedWildcard) {
      const got = context.named_wildcards.get(thing.name);
      
      if (!got)
        return `<ERROR: Named wildcard ${thing.name} not found!>`;

      if (got instanceof ASTLatchedNamedWildcardValue) {
        log(context.noisy,
            `NAMED WILDCARD ${thing.name} ALREADY LATCHED...`);

        return '';
      }

      const latched = new ASTLatchedNamedWildcardValue(walk(got, indent + 1), got);

      log(context.noisy,
          `LATCHED ${thing.name} TO ${inspect_fun(latched.latched_value)}`);
      
      context.named_wildcards.set(thing.name, latched);

      return '';
    }
    // ---------------------------------------------------------------------------------------------
    else if (thing instanceof ASTUnlatchNamedWildcard) {
      let got = context.named_wildcards.get(thing.name);

      if (!got)
        return `ERROR: Named wildcard ${thing.name} not found!`;

      if (! (got instanceof ASTLatchedNamedWildcardValue))
        throw new Error(`NOT LATCHED: '${thing.name}'`);

      context.named_wildcards.set(thing.name, got.original_value);

      log(context.noisy,
          `UNLATCHED ${thing.name} TO ${inspect_fun(got.original_value)}`);

      return ''; // produce no text.
    } 
    // ---------------------------------------------------------------------------------------------
    else if (thing instanceof ASTNamedWildcardDefinition) {
      if (context.named_wildcards.has(thing.destination))
        log(true, `WARNING: redefining named wildcard '${thing.destination.name}'.`);

      context.named_wildcards.set(thing.destination, thing.wildcard);

      return '';
    }
    // ---------------------------------------------------------------------------------------------
    // internal objects:
    // ---------------------------------------------------------------------------------------------
    else if (thing instanceof ASTLatchedNamedWildcardValue) {
      return thing.latched_value;
    }
    // ---------------------------------------------------------------------------------------------
    // scalar assignment:
    // ---------------------------------------------------------------------------------------------
    else if (thing instanceof ASTUpdateScalar) {
      log(context.noisy, '');
      log(context.noisy,
          `ASSIGNING ${inspect_fun(thing.source)} ` +
          `TO '${thing.destination.name}'`);
      
      let   new_val = walk(thing.source, indent + 1);
      const old_val = context.scalar_variables.get(thing.destination.name)??'';

      if (! thing.assign)
        new_val = smart_join([ old_val, new_val ]);
      
      context.scalar_variables.set(thing.destination.name, new_val);

      log(context.noisy,
          `ASSIGN ${inspect_fun(new_val)} TO "${thing.destination.name}'`);
      log(context.noisy,
          `VARS AFTER: ${inspect_fun(context.scalar_variables)}`);
      
      return '';
    }
    // ---------------------------------------------------------------------------------------------
    // AnonWildcards:
    // ---------------------------------------------------------------------------------------------
    else if (thing instanceof ASTAnonWildcard) {
      const pick = thing.pick_one(allow_fun, forbid_fun,
                                  context.pick_one_priority)?.body;

      if (! pick)
        return ''; // inelegant... investigate why this is necessary?
      
      return walk(pick, indent + 1);
    }
    // ---------------------------------------------------------------------------------------------
    else if (thing instanceof ASTUpdateConfigurationUnary ||
             thing instanceof ASTUpdateConfigurationBinary) {
      let value = thing.value;

      if (value instanceof ASTNode) {
        const expanded_value = expand_wildcards(thing.value, context, indent + 1); // not walk!
        const jsconc_parsed_expanded_value = (thing instanceof ASTUpdateConfigurationUnary
                                              ? rJsoncObject
                                              : rJsonc).match(expanded_value);

        if (thing instanceof ASTUpdateConfigurationBinary) {
          value = jsconc_parsed_expanded_value?.is_finished
            ? jsconc_parsed_expanded_value.value
            : expanded_value;
        }
        else { // ASTUpdateConfigurationUnary
          throw new Error(`${thing.constructor.name}.value must expand to produce a valid ` +
                          `rJSONC object, rJsonc.match(...) result was ` +
                          inspect_fun(jsconc_parsed_expanded_value));
        }
      }
      else {
        value = structured_clone(value);
      }

      if (thing instanceof ASTUpdateConfigurationUnary) { // ASTUpdateConfigurationUnary
        let new_obj = value;

        for (const key of Object.keys(value)) {
          new_obj[get_our_name(key)??key] = value[key]
        }
        
        context.configuration = thing.assign
          ? new_obj
          : { ...context.configuration, ...new_obj };

        log(log_configuration_enabled,
            `%config ${thing.assign ? '=' : '+='} ` +
            `${inspect_fun(new_obj, true)}`
            // + `, configuration is now: ` +
            // `${inspect_fun(context.configuration, true)}`
           );
      }
      else { // ASTUpdateConfigurationBinary
        const our_name = get_our_name(thing.key); 
        
        if (thing.assign) {
          context.configuration[our_name] = value;
        }
        else { // increment
          if (Array.isArray(value)) {
            const tmp_arr = context.configuration[our_name]??[];

            if (! Array.isArray(tmp_arr))
              throw new Error(`can't add array ${inspect_fun(value)} ` +
                              `to non-array ${inspect_fun(tmp_arr)}`);
            
            const new_arr = [ ...tmp_arr, ...value ];
            // log(true, `current value ${inspect_fun(context.configuration[our_name])}, ` +
            //           `increment by array ${inspect_fun(value)}, ` +
            //           `total ${inspect_fun(new_arr)}`);
            context.configuration[our_name] = new_arr;
          }
          else if (typeof value === 'object') {
            const tmp_obj = context.configuration[our_name]??{};

            if (typeof tmp_obj !== 'object')
              throw new Error(`can't add object ${inspect_fun(value)} `+
                              `to non-object ${inspect_fun(tmp_obj)}`);

            const new_obj = { ...tmp_obj, ...value };
            // log(true, `current value ${inspect_fun(context.configuration[our_name])}, ` +
            //           `increment by object ${inspect_fun(value)}, ` +
            //           `total ${inspect_fun(new_obj)}`);
            context.configuration[our_name] = new_obj;
          }
          else if (typeof value === 'number') {
            const tmp_num = context.configuration[our_name]??0;
            
            if (typeof tmp_num !== 'number')
              throw new Error(`can't add number ${inspect_fun(value)} `+
                              `to non-number ${inspect_fun(tmp_num)}`);

            // log(true, `current value ${inspect_fun(context.configuration[our_name])}, ` +
            //           `increment by number ${inspect_fun(value)}, ` +
            //           `total ${inspect_fun((context.configuration[our_name]??0) + value)}`);
            context.configuration[our_name] = tmp_num + value;
          }
          else if (typeof value === 'string') {
            const tmp_str = context.configuration[our_name]??'';

            if (typeof tmp_str !== 'string')
              throw new Error(`can't add string ${inspect_fun(value)} `+
                              `to non-string ${inspect_fun(tmp_str)}`);

            // log(true, `current value ${inspect_fun(context.configuration[our_name])}, ` +
            //           `increment by string ${inspect_fun(value)}, ` +
            //           `total ${inspect_fun((context.configuration[our_name]??'') + value)}`);
            context.configuration[our_name] = smart_join([tmp_str, value]);
          }
          else {
            // probly won't work most of the time, but let's try anyhow, I guess.
            // log(true, `current value ${inspect_fun(context.configuration[our_name])}, ` +
            //           `increment by unknown ${inspect_fun(value)}, ` +
            //           `total ${inspect_fun(context.configuration[our_name]??null + value)}`);
            context.configuration[our_name] = (context.configuration[our_name]??null) + value;
          }
        }

        log(log_configuration_enabled,
            `%${our_name} ` +
            `${thing.assign ? '=' : '+='} ` +
            `${inspect_fun(value, true)}`
            // + `, configuration is now: ` +
            // `${inspect_fun(context.configuration, true)}`
           );
      }
      
      return '';
    }
    // ---------------------------------------------------------------------------------------------
    else if (thing instanceof ASTSetPickSingle || 
             thing instanceof ASTSetPickMultiple) {
      const cur_key = thing instanceof ASTSetPickSingle
            ? 'pick_one_priority'
            : 'pick_multiple_priority';
      const prior_key = thing instanceof ASTSetPickSingle
            ? 'prior_pick_one_priority'
            : 'prior_pick_multiple_priority';
      const cur_val   = context[cur_key];
      const prior_val = context[prior_key];
      const walked    = picker_priority[expand_wildcards(thing.limited_content,
                                                         context, indent + 1).toLowerCase()];

      // if (log_configuration_enabled)
      //   log(`SET PICK DATA: ` +
      //               `${inspect_fun({cur_key: cur_key, prior_key: prior_key,
      //                               cur_val: cur_val, prior_val: prior_val,
      //                               walked: walked})}`);
      
      if (! picker_priority_descriptions.includes(walked))
        throw new Error(`invalid priority value: ${inspect_fun(walked)}`);

      context[prior_key] = context[cur_key];
      context[cur_key]   = walked;

      log(log_configuration_enabled,
          `Updated ${cur_key} from ${inspect_fun(cur_val)} to ` +
          `${inspect_fun(walked)}.`);
      
      return '';
    }
    // ---------------------------------------------------------------------------------------------
    else if (thing instanceof ASTRevertPickSingle || 
             thing instanceof ASTRevertPickMultiple) {
      const cur_key = thing instanceof ASTRevertPickSingle
            ? 'pick_one_priority'
            : 'pick_multiple_priority';
      const prior_key = thing instanceof ASTRevertPickSingle
            ? 'prior_pick_one_priority'
            : 'prior_pick_multiple_priority';
      const cur_val   = context[cur_key];
      const prior_val = context[prior_key];

      // if (log_configuration_enabled)
      //   log(`REVERT PICK DATA: ` +
      //               `${inspect_fun({cur_key: cur_key, prior_key: prior_key,
      //                               cur_val: cur_val, prior_val: prior_val })}`);
      
      // log(`Reverting ${cur_key} from ${inspect_fun(cur_val)} to ` +
      //             `${inspect_fun(prior_val)}: ${cur_key}, ${prior_key}, ${inspect_fun(context)}`);
      log(log_configuration_enabled,
          `Reverting ${cur_key} from ${inspect_fun(cur_val)} to ` +
          `${inspect_fun(prior_val)}.`);
      
      context[cur_key]   = prior_val;
      context[prior_key] = cur_val;

      return '';
    }
    // ---------------------------------------------------------------------------------------------
    // ASTLora:
    // ---------------------------------------------------------------------------------------------
    else if (thing instanceof ASTLora) {
      log(log_expand_and_walk_enabled,
          `ENCOUNTERED LORA ${thing} IN ${context}`);
      
      let walked_file = expand_wildcards(thing.file, context, indent + 1); // not walk!

      // log(`walked_file is ${typeof walked_file} ` +
      //             `${walked_file.constructor.name} ` +
      //             `${inspect_fun(walked_file)} ` +
      //             `${Array.isArray(walked_file)}`);

      // if (Array.isArray(walked_file))
      //   walked_file = smart_join(walked_file); // unnecessary/impossible maybe?

      // if (Array.isArray(thing.weight))
      //   throw new Error("boom");
      
      let walked_weight = expand_wildcards(thing.weight, context, indent + 1); // not walk!
      
      // if (Array.isArray(walked_weight) || walked_weight.startsWith('['))
      //   throw "bomb";
      
      // log(`walked_weight is ${typeof walked_weight} ` +
      //             `${walked_weight.constructor.name} ` +
      //             `${inspect_fun(walked_weight)} ` +
      //             `${Array.isArray(walked_weight)}`);
      
      // if (Array.isArray(walked_weight))
      //   walked_weight = smart_join(walked_weight);

      const weight_match_result = json_number.match(walked_weight);

      if (!weight_match_result || !weight_match_result.is_finished)
        throw new Error(`LoRA weight must be a number, got ` +
                        `${inspect_fun(walked_weight)}`);

      let file = walked_file.toLowerCase();

      if (file === '')
        throw new Error(`LoRA file name is empty!`);
      
      // if (file.endsWith('_lora_f16.ckpt')) {
      if (file.endsWith('.ckpt')) {
        // do nothing 
      }
      else if (file.endsWith('_lora_f16')) {
        file = `${file}.ckpt`;
      }
      else if (file.endsWith('_lora')) {
        file = `${file}_f16.ckpt`;
      }
      else {
        file = `${file}_lora_f16.ckpt`;
      }

      const weight = weight_match_result.value;
      
      context.add_lora_uniquely({ file: file, weight: weight }, { indent: indent });
      
      return '';
    }
    // ---------------------------------------------------------------------------------------------
    // ASTUpdateNegativePrompt:
    // ---------------------------------------------------------------------------------------------
    // else if (thing instanceof ASTUpdateNegativePrompt) {
    //   const temporaryNode = new ASTUpdateConfigurationBinary("negative_prompt", thing.value, thing.assign);
    //   return expand_wildcards(temporaryNode, context, indent + 1);
    // }
    // ---------------------------------------------------------------------------------------------
    // uncrecognized type:
    // ---------------------------------------------------------------------------------------------
    else {
      throw new Error(`confusing thing: ` +
                      (typeof thing === 'object'
                       ? thing?.constructor.name
                       : typeof thing) +
                      ' ' +
                      inspect_fun(thing));
    }
  }

  log(log_expand_and_walk_enabled,
      `Expanding wildcards in ` +
      // `${thing_type_str(thing)} ` +
      `${thing_str_repr(thing)} in ` + 
      `${context}`);
  
  const ret = unescape(smart_join(walk(thing, indent + 1)));

  context.munge_configuration({indent: indent + 1});
  
  log(log_expand_and_walk_enabled,
      `Expanded into ${inspect_fun(ret)}`);
  
  // if (ret === undefined)
  //   throw new Error("what");
  
  // if (ret.match(/^\s+$/))
  //   throw "bombλ";
  
  return ret;
}
// =================================================================================================
// END OF THE MAIN AST-WALKING FUNCTION.
// =================================================================================================


// =================================================================================================
// SD PROMPT AST CLASSES SECTION:
// =================================================================================================
class ASTNode {}
// -------------------------------------------------------------------------------------------------
// Flags:
// -------------------------------------------------------------------------------------------------
class ASTSetFlag extends ASTNode {
  constructor(flag_arr) {
    // if (! Array.isArray(flag_arr))
    //   throw new Error(`NOT AN ARRAY: ${inspect_fun(flag_arr)}`);

    super();
    this.flag = flag_arr;
    
    // if (this.flag === undefined)
    //   throw new Error("stop after constructing ASTSetFlag");
  }
  // --------------------------------------------------------------------------------------------------
  toString() {
    return `#${this.flag.join('.')}`;
  }
}
// --------------------------------------------------------------------------------------------------
class ASTUnsetFlag extends ASTNode {
  constructor(flag_arr) {
    // if (! Array.isArray(flag_arr))
    //   throw new Error(`${this.constructor.name} ` +
    //                   `ARG NOT AN ARRAY: ${inspect_fun(flag_arr)}`);

    super();
    this.flag = flag_arr;
  }
  // --------------------------------------------------------------------------------------------------
  toString() {
    return `#!${this.flag.join('.')}`;
  }
}
// --------------------------------------------------------------------------------------------------
class ASTCheckFlags extends ASTNode {
  constructor(flag_arrs, consequently_set_flag_tail) {
    // if (! flag_arrs.every(flag_arr => Array.isArray(flag_arr)))
    //   throw new Error(`NOT ALL ARRAYS: ${inspect_fun(flag_arrs)}`);
    super();

    if (consequently_set_flag_tail && flag_arrs.length != 1 )
      throw new Error(`don't supply consequently_set_flag_tail when flag_arrs.length != 1`);

    this.flags = flag_arrs;
    this.consequently_set_flag_tail = consequently_set_flag_tail;

    if (log_flags_enabled)
      console.log(`constructed ${inspect_fun(this)}`)
  }
  // -----------------------------------------------------------------------------------------------
  toString() {
    let str = '?';

    const flag_strs = [];
    
    for (const flag of this.flags)
      flag_strs.push(flag.join('.'));

    str += flag_strs.join(',');

    if (this.consequently_set_flag_tail) {
      str += '.#';
      str += this.consequently_set_flag_tail.join('.');
    }

    return str;
    // return `?${this.flag_arrs.map(x => x.join('.')).join(',')}`;
  }
}
// -------------------------------------------------------------------------------------------------
class ASTNotFlag extends ASTNode  { 
  constructor(flag_arr, { set_immediately = undefined,
                          consequently_set_flag_tail = undefined } = {}) {
    // if (! Array.isArray(flag_arr))
    //   throw new Error(`NOT AN ARRAY: ${inspect_fun(flag_arr)}`);

    super();

    if (set_immediately && consequently_set_flag_tail)
      throw new Error(`don't supply both set_immediately and consequently_set_flag_tail`);

    this.flag                       = flag_arr;
    this.consequently_set_flag_tail = consequently_set_flag_tail
    this.set_immediately            = set_immediately;

    if (log_flags_enabled)
      console.log(`constructed ${inspect_fun(this)}`)
    
    // if (this.set_immediately)
    //   console.log(`SET IMMEDIATELY = '${inspect_fun(this.set_immediately)}'`);
  }
  // -------------------------------------------------------------------------------------------------
  toString() {
    let str = `!`;

    if (this.set_immediately)
      str += '#';

    str += this.flag.join('.');

    if (this.consequently_set_flag_tail) {
      str += '.#';
      str += this.consequently_set_flag_tail.join('.');
    }

    return str;
  }
}
// -------------------------------------------------------------------------------------------------
// NamedWildcard references:
// -------------------------------------------------------------------------------------------------
class ASTNamedWildcardReference extends ASTNode {
  constructor(name, joiner = '', capitalize = '', min_count = 1, max_count = 1) {
    super();
    this.name       = name;
    this.min_count  = min_count;
    this.max_count  = max_count;
    this.joiner     = joiner;
    this.capitalize = capitalize;
    // console.log(`BUILT ${inspect_fun(this)}`);
  }
  // -----------------------------------------------------------------------------------------------
  toString() {
    var str = '@';

    if (this.capitalize)
      str += this.capitalize;

    if (this.min_count != 1  || this.max_count != 1) {
      if (this.min_count !== this.max_count)
        str += `${this.min_count}-${this.max_count}`;
      else
        str += `${this.max_count}`;

      str += this.joiner;
    }

    str += this.name;
    
    return str;
  };
}
// -------------------------------------------------------------------------------------------------
// Scalar references:
// -------------------------------------------------------------------------------------------------
class ASTScalarReference extends ASTNode {
  constructor(name, capitalize) {
    super();
    this.name       = name;
    this.capitalize = capitalize;
  }
  // -----------------------------------------------------------------------------------------------
  toString() {
    let str = '$';

    if (this.capitalize)
      str += this.capitalize;

    str += this.name;
    
    return str;
  }
}
// -------------------------------------------------------------------------------------------------
// Scalar assignment:
// -------------------------------------------------------------------------------------------------
class ASTUpdateScalar extends ASTNode  {
  constructor(destination, source, assign) {
    super();
    this.destination = destination;
    this.source      = source;
    this.assign      = assign;
  }
  // -----------------------------------------------------------------------------------------------
  toString() {
    return `$${this.destination} ${this.assign? '=' : '+='} ${this.destination}`;
  }
}
// -------------------------------------------------------------------------------------------------
// A1111-style Loras:
// -------------------------------------------------------------------------------------------------
class ASTLora extends ASTNode {
  constructor(file, weight) {
    super();
    this.file   = file;
    this.weight = weight;
    // console.log(`Constructed LoRa ${this}!`);
  }
  // -----------------------------------------------------------------------------------------------
  toString(with_types = false ) {
    return `<lora:${with_types ? `${this.file.constructor.name} ` : ``}${this.file}: ` +
      `${with_types ? `${this.weight.constructor.name} ` : ``}${this.weight}>`;
  }
}
// -------------------------------------------------------------------------------------------------
// Latch a NamedWildcard:
// -------------------------------------------------------------------------------------------------
class ASTLatchNamedWildcard extends ASTNode {
  constructor(name) {
    super();
    this.name = name;
  }
  // -----------------------------------------------------------------------------------------------
  toString() {
    return `@#${this.name}`;
  }
}
// -------------------------------------------------------------------------------------------------
// Unlatch a NamedWildcard:
// -------------------------------------------------------------------------------------------------
class ASTUnlatchNamedWildcard extends ASTNode {
  constructor(name) {
    super();
    this.name = name;
  }
  // -----------------------------------------------------------------------------------------------
  toString() {
    return `@!${this.name}`;
  }
}
// -------------------------------------------------------------------------------------------------
// Named wildcard definitions:
// -------------------------------------------------------------------------------------------------
class ASTNamedWildcardDefinition extends ASTNode {
  constructor(destination, wildcard) {
    super();
    this.destination = destination;
    this.wildcard    = wildcard;
  }
  // -----------------------------------------------------------------------------------------------
  toString() {
    return `@${this.destination} = ${this.wildcard}`;
  }
}
// -------------------------------------------------------------------------------------------------
// Internal usage.. might not /really/ be part of the AST per se?
// -------------------------------------------------------------------------------------------------
class ASTLatchedNamedWildcardValue extends ASTNode {
  constructor(latched_value, original_value) {
    super();
    this.latched_value  = latched_value;
    this.original_value = original_value;
  }
  // -----------------------------------------------------------------------------------------------
  toString() {
    return this.original_value.toString();
  }
}
// -------------------------------------------------------------------------------------------------
// AnonWildcards:
// -------------------------------------------------------------------------------------------------
class ASTAnonWildcard  extends ASTNode {
  constructor(options) {
    super();
    this.picker = new WeightedPicker(options
                                     .filter(o => o.weight !== 0)
                                     .map(o => [o.weight, o]));
    // console.log(`CONSTRUCTED ${JSON.stringify(this)}`);
  }
  // -----------------------------------------------------------------------------------------------
  pick(...args) {
    return this.picker.pick(...args);
  }
  // -----------------------------------------------------------------------------------------------
  pick_one(...args) {
    return this.picker.pick_one(...args);
  }
  // -----------------------------------------------------------------------------------------------
  toString() {
    let str = '{';

    for (let ix = 0; ix < this.picker.options.length; ix++) {
      const option     = this.picker.options[ix];
      const repr       = option.value.toString();
      const has_weight = option.weight != 1;
      const is_empty   = repr == '';
      const is_last    = ix == (this.picker.options.length - 1);
      const has_guards = (option.value.check_flags?.length > 0) || (option.value.not_flags?.length > 0);

      // console.log(`option:     ${inspect_fun(option)}`);
      // console.log(`cfs.l:      ${option.value.check_flags?.length}`);
      // console.log(`nfs.l:      ${option.value.not_flags?.length}`);
      // console.log(`has_guards: ${has_guards}`);
      
      if (!is_empty && !has_weight && !has_guards)
        str += ' ';

      str += repr;

      if (!is_empty)
        str += ' ';

      if (!is_last)
        str += '|';
    }
    
    str += '}';
    
    return str;

    // return `{ ${this.picker.options.map(x => x.value).join(" | ")} }`;
  }
}
// -------------------------------------------------------------------------------------------------
class ASTAnonWildcardAlternative extends ASTNode {
  constructor(weight, check_flags, not_flags, body) {
    super();
    this.weight      = weight;
    this.check_flags = check_flags;
    this.not_flags   = not_flags;
    this.body        = body;
  }
  // -----------------------------------------------------------------------------------------------
  toString() {
    var str = '';

    if (this.weight !== 1)
      str += `${this.weight} `;

    var bits = [];

    for (const check of this.check_flags)
      bits.push(check.toString());
    
    for (const not of this.not_flags)
      bits.push(not.toString());
    
    for (const thing of this.body) {
      // console.log(`push bit ${thing.toString()} (${thing.toString().length})`)
      bits.push(thing.toString());
    }

    str += bits.join(' ');

    // console.log(`BITS: ${inspect_fun(bits)}`);
    
    return str;
  }
}
// -------------------------------------------------------------------------------------------------
// ASTInclude:
// -------------------------------------------------------------------------------------------------
class ASTInclude extends ASTNode {
  constructor(args) {
    super();
    this.args      = args;
  }
  // -----------------------------------------------------------------------------------------------
  toString() {
    return `include(${this.args})`;
  }
}
// -------------------------------------------------------------------------------------------------
class ASTUpdateConfigurationUnary extends ASTNode {
  constructor(value, assign) {
    super();
    this.value = value;
    this.assign = assign; // otherwise update
  }
  // -----------------------------------------------------------------------------------------------
  toString() {
    return `%config ${this.assign? '=' : '+='} ` +
      `${this.value instanceof ASTNode || Array.isArray(this.value) ? this.value : inspect_fun(this.value)}`;
  }
}
// -------------------------------------------------------------------------------------------------
class ASTUpdateConfigurationBinary extends ASTNode {
  constructor(key, value, assign) {
    super();
    this.key    = key;
    this.value  = value;
    this.assign = assign;
  }
  // -----------------------------------------------------------------------------------------------
  toString() {
    return `%${get_our_name(this.key)} ${this.assign? '=' : '+='} ` +
      `${this.value instanceof ASTNode || Array.isArray(this.value) ? this.value : inspect_fun(this.value)}`;
  }
}
// -------------------------------------------------------------------------------------------------
class ASTSetPickMultiple extends ASTNode {
  constructor(limited_content) {
    super();
    this.limited_content = limited_content;
  }
  // -----------------------------------------------------------------------------------------------
  toString() {
    return `%set-pick-multiple = ${this.limited_content}`;
  }
}
// -------------------------------------------------------------------------------------------------
class ASTSetPickSingle extends ASTNode {
  constructor(limited_content) {
    super();
    this.limited_content = limited_content;
  }
  // -----------------------------------------------------------------------------------------------
  toString() {
    return `%set-pick-single = ${this.limited_content}`;
  }
}
// -------------------------------------------------------------------------------------------------
class ASTRevertPickMultiple extends ASTNode {
  constructor() {
    super();
  }
  // -----------------------------------------------------------------------------------------------
  toString() {
    return `%revert-pick-multiple`;
  }
}
// -------------------------------------------------------------------------------------------------
class ASTRevertPickSingle extends ASTNode {
  constructor() {
    super();
  }
  // -----------------------------------------------------------------------------------------------
  toString() {
    return `%revert-pick-single`;
  }
}
// =================================================================================================
// END OF SD PROMPT AST CLASSES SECTION.
// =================================================================================================


// =================================================================================================
// SD PROMPT GRAMMAR SECTION:
// =================================================================================================
// terminals:
// -------------------------------------------------------------------------------------------------
// const low_pri_text          = /[\(\)\[\]\,\.\?\!\:\;]+/;
// const plaintext             = /[^{|}\s]+/;
// const plaintext             = r(/(?:(?![{|}\s]|\/\/|\/\*)(?:\\\s|[^\s{|}]))+/);
// const plaintext             = r(/(?:(?![{|}\s]|\/\/|\/\*)[\S])+/); // stop at comments
// const plaintext             = r(/(?:\\\s|[^\s{|}])+/);
// const plaintext_no_parens   = /[^{|}\s()]+/;
const any_assignment_operator  = choice(() => assignment_operator, () => incr_assignment_operator);
const assignment_operator      = second(seq(wst_star(() => comment), '=', wst_star(() => comment)));
const comment                  = discard(c_comment);
const escaped_brc              = second(choice('\\{', '\\}'));
const filename                 = r(/[A-Za-z0-9 ._\-()]+/);
const ident                    = r(/[a-zA-Z_-][0-9a-zA-Z_-]*\b/);
const incr_assignment_operator = second(seq(wst_star(comment), '+=', wst_star(comment)));
const low_pri_text             = r(/[\(\)\[\]\,\.\?\!\:\);]+/);
const plaintext                = r(/(?:(?![{|}\s]|\/\/|\/\*)(?:\\\s|\S))+/);
const wb_uint                  = xform(parseInt, /\b\d+(?=\s|[{|}]|$)/);
const word_break               = r(/(?=\s|[{|}\.\,\?\!\(\)]|$)/);
any_assignment_operator        .abbreviate_str_repr('any_assignment_operator');
assignment_operator            .abbreviate_str_repr('assignment_operator');
comment                        .abbreviate_str_repr(false);
escaped_brc                    .abbreviate_str_repr('escaped_brc');
filename                       .abbreviate_str_repr('filename');
ident                          .abbreviate_str_repr('ident');
incr_assignment_operator       .abbreviate_str_repr('incr_assignment_operator');
low_pri_text                   .abbreviate_str_repr('low_pri_text');
plaintext                      .abbreviate_str_repr('plaintext');
wb_uint                        .abbreviate_str_repr('wb_uint');
word_break                     .abbreviate_str_repr('word_break');
// ^ conservative regex, no unicode or weird symbols
// -------------------------------------------------------------------------------------------------
// discard comments:
// -------------------------------------------------------------------------------------------------
const discarded_comments        = discard(wst_star(comment));
discarded_comments              .abbreviate_str_repr('-comment*');
// -------------------------------------------------------------------------------------------------
// combinators:
// -------------------------------------------------------------------------------------------------
// const unarySpecialFunction = (prefix, rule, xform_func) =>
//       xform(wst_cutting_seq(wst_seq(`%${prefix}`,          // [0][0]
//                                     discarded_comments,     // -
//                                     '(',                   // [0][1]
//                                     discarded_comments),    // -
//                             rule,                          // [1]
//                             discarded_comments,             // -
//                             ')'),                          // [2]
//             arr => xform_func(arr[1]));
// -------------------------------------------------------------------------------------------------
// A1111-style LoRAs:
// -------------------------------------------------------------------------------------------------
const A1111StyleLoraWeight = choice(/\d*\.\d+/, uint);
const A1111StyleLora       =
      xform(arr => new ASTLora(arr[3], arr[4][0]),
            wst_seq('<',                                    // [0]
                    'lora',                                 // [1]
                    ':',                                    // [2]
                    choice(filename, () => LimitedContent), // [3]
                    optional(second(wst_seq(':',
                                            choice(A1111StyleLoraWeight,
                                                   () => LimitedContent))),
                             "1.0"), // [4][0]
                    '>'));
A1111StyleLoraWeight.abbreviate_str_repr('A1111StyleLoraWeight');
A1111StyleLora      .abbreviate_str_repr('A1111StyleLora');
// -------------------------------------------------------------------------------------------------
// helper funs used by xforms:
// -------------------------------------------------------------------------------------------------
const make_ASTAnonWildcardAlternative = arr => {
  // console.log(`ARR: ${inspect_fun(arr)}`);
  const flags = ([ ...arr[0], ...arr[2] ]);
  const check_flags        = flags.filter(f => f instanceof ASTCheckFlags);
  const not_flags          = flags.filter(f => f instanceof ASTNotFlag);
  const set_or_unset_flags = flags.filter(f => f instanceof ASTSetFlag || f instanceof ASTUnsetFlag);

  const ASTSetFlags_for_ASTCheckFlags_with_consequently_set_flag_tails =
        check_flags
        .filter(f => f.consequently_set_flag_tail)
        .map(f => new ASTSetFlag([ ...f.flags[0], ...f.consequently_set_flag_tail ]));

  const ASTSetFlags_for_ASTNotFlags_with_consequently_set_flag_tails =
        not_flags
        .filter(f => f.consequently_set_flag_tail)
        .map(f => new ASTSetFlag([ ...f.flag, ...f.consequently_set_flag_tail ]));
  
  const ASTSetFlags_for_ASTNotFlags_with_set_immediately =
        not_flags
        .filter(f => f.set_immediately)
        .map(f => new ASTSetFlag(f.flag));

  return new ASTAnonWildcardAlternative(
    arr[1][0],
    check_flags,
    not_flags,
    [
      ...ASTSetFlags_for_ASTCheckFlags_with_consequently_set_flag_tails,
      ...ASTSetFlags_for_ASTNotFlags_with_consequently_set_flag_tails,
      ...ASTSetFlags_for_ASTNotFlags_with_set_immediately,
      ...set_or_unset_flags,
      ...arr[3]
    ]);
}
// -------------------------------------------------------------------------------------------------
// flag-related non-terminals:
// -------------------------------------------------------------------------------------------------
const CheckFlagWithOrAlternatives = xform(seq('?', plus(plus(ident, '.'), ','), word_break),
                                          arr => {
                                            const args = [arr[1]];

                                            if (log_flags_enabled) {
                                              console.log(`\nCONSTRUCTING CHECKFLAG (1) GOT ARR ` +
                                                          `${inspect_fun(arr)}`);
                                              console.log(`CONSTRUCTING CHECKFLAG (1) WITH ARGS ` +
                                                          `${inspect_fun(args)}`);
                                            }

                                            return new ASTCheckFlags(...args);
                                          });
const CheckFlagWithSetConsequent  = xform(seq('?',              // [0]
                                              plus(ident, '.'), // [1]
                                              '.#',             // [2]
                                              plus(ident, '.'), // [3]
                                              word_break),      // [-]
                                          arr => {
                                            const args = [ [ arr[1] ], arr[3] ]; 

                                            if (log_flags_enabled) {
                                              console.log(`\nCONSTRUCTING CHECKFLAG (2) GOT ARR ` +
                                                          `${inspect_fun(arr)}`);
                                              console.log(`CONSTRUCTING CHECKFLAG (2) WITH ARGS ` +
                                                          `${inspect_fun(args)}`);
                                            }

                                            return new ASTCheckFlags(...args);
                                          });
const NotFlagWithSetConsequent    = xform(seq('!', plus(ident, '.'), '.#', plus(ident, '.'), word_break),
                                          arr => {
                                            const args = [arr[1],
                                                          { consequently_set_flag_tail: arr[3] }]; 

                                            if (log_flags_enabled) {
                                              console.log(`CONSTRUCTING NOTFLAG (2) GOT arr ` +
                                                          `${inspect_fun(arr)}`);
                                              console.log(`CONSTRUCTING NOTFLAG (2) WITH ARGS ` +
                                                          `${inspect_fun(args)}`);
                                            }
                                            
                                            return new ASTNotFlag(...args);
                                          })
const SimpleNotFlag              = xform(seq('!', optional('#'), plus(ident, '.'), word_break),
                                         arr => {
                                           const args = [arr[2],
                                                         { set_immediately: !!arr[1][0]}];

                                           if (log_flags_enabled) {
                                             console.log(`CONSTRUCTING NOTFLAG (1) GOT arr ` +
                                                         `${inspect_fun(arr)}`);
                                             console.log(`CONSTRUCTING NOTFLAG (1) WITH ARGS ` +
                                                         `${inspect_fun(args)}`);
                                           }

                                           return new ASTNotFlag(...args);
                                         })
const TestFlag                   = choice(CheckFlagWithSetConsequent,
                                          CheckFlagWithOrAlternatives,
                                          NotFlagWithSetConsequent,
                                          SimpleNotFlag);
const SetFlag                  = xform(second(seq('#', plus(ident, '.'), word_break)),
                                       arr => {
                                         if (log_flags_enabled)
                                           if (arr.length > 1)
                                             console.log(`CONSTRUCTING SETFLAG WITH ` +
                                                         `${inspect_fun(arr)}`);
                                         return new ASTSetFlag(arr);
                                       });
const UnsetFlag                = xform(second(seq('#!', plus(ident, '.'), word_break)),
                                       arr => {
                                         if (log_flags_enabled)
                                           if (arr.length > 1)
                                             console.log(`CONSTRUCTING UNSETFLAG WITH` +
                                                         ` ${inspect_fun(arr)}`);
                                         return new ASTUnsetFlag(arr);
                                       });
SimpleNotFlag.abbreviate_str_repr('SimpleNotFlag');
CheckFlagWithSetConsequent.abbreviate_str_repr('CheckFlagWithSetConsequent');
CheckFlagWithOrAlternatives.abbreviate_str_repr('CheckFlagWithOrAlternatives');
NotFlagWithSetConsequent.abbreviate_str_repr('NotFlagWithSetConsequent');
TestFlag.abbreviate_str_repr('TestFlag');
SetFlag.abbreviate_str_repr('SetFlag');
UnsetFlag.abbreviate_str_repr('UnsetFlag');
// -------------------------------------------------------------------------------------------------
// non-terminals for the special functions/variables:
// -------------------------------------------------------------------------------------------------
const SpecialFunctionInclude =
      xform(arr => new ASTInclude(arr[1]),
            c_funcall('include',                          // [0]
                      first(wst_seq(discarded_comments,    // -
                                    json_string,          // [1]
                                    discarded_comments)))) // -
const UnexpectedSpecialFunctionInclude =
      unexpected(SpecialFunctionInclude,
                 () => "%include is only supported when " +
                 "using wildcards-plus-tool.js, NOT when " +
                 "running the wildcards-plus.js script " +
                 "inside Draw Things!");
const SpecialFunctionSetPickSingle =
      xform(arr => new ASTSetPickSingle(arr[1][1]),
            seq('single-pick',                                      // [0]
                wst_seq(discarded_comments,                          // -
                        assignment_operator,                        // [1][0]
                        discarded_comments,                          // -
                        choice(() => LimitedContent, lc_alpha_snake)))); // [1][1]
const SpecialFunctionSetPickMultiple =
      xform(arr => new ASTSetPickSingle(arr[1][1]),
            seq('multi-pick',                                       // [0]
                wst_seq(discarded_comments,                          // -
                        assignment_operator,                        // [1][0]
                        discarded_comments,                          // -
                        choice(() => LimitedContent, lc_alpha_snake)))); // [1][1]
const SpecialFunctionRevertPickSingle =
      xform(() => new ASTRevertPickSingle(),
            seq('revert-single-pick', word_break));
const SpecialFunctionRevertPickMultiple =
      xform(() => new ASTRevertPickMultiple(),
            seq('revert-multi-pick', word_break));
const SpecialFunctionConfigurationUpdateBinary =
      xform(arr => new ASTUpdateConfigurationBinary(arr[0], arr[1][1], arr[1][0] == '='),
            seq(c_ident,                                                          // [0]
                wst_seq(discarded_comments,                                        // -
                        any_assignment_operator,                                  // [1][0]
                        discarded_comments,                                        // -
                        choice(rJsonc, () => LimitedContent, plaintext))));       // [1][1]
const SpecialFunctionConfigurationUpdateUnary =
      xform(arr => new ASTUpdateConfigurationUnary(arr[1][1], arr[1][0] == '='),
            seq(/conf(?:ig)?/,                                                    // [0]
                wst_seq(discarded_comments,                                        // -
                        choice(incr_assignment_operator, assignment_operator),    // [1][0]
                        discarded_comments,                                        // -
                        choice(rJsoncObject, () => LimitedContent, plaintext)))); // [1][1]   
// -------------------------------------------------------------------------------------------------
const NormalSpecialFunction =
      choice(SpecialFunctionSetPickSingle,
             SpecialFunctionSetPickMultiple,
             SpecialFunctionRevertPickSingle,
             SpecialFunctionRevertPickMultiple,
             SpecialFunctionConfigurationUpdateUnary,
             SpecialFunctionConfigurationUpdateBinary);
const SpecialFunctionNotInclude =
      second(cutting_seq('%',
                         NormalSpecialFunction,
                         discarded_comments,
                         lws(optional(';'))));
const AnySpecialFunction =
      second(cutting_seq('%',
                         choice((dt_hosted
                                 ? UnexpectedSpecialFunctionInclude
                                 : SpecialFunctionInclude),
                                NormalSpecialFunction),
                         discarded_comments,
                         lws(optional(';'))));
// -------------------------------------------------------------------------------------------------
// other non-terminals:
// -------------------------------------------------------------------------------------------------
const AnonWildcardAlternative =
      xform(make_ASTAnonWildcardAlternative,
            seq(wst_star(choice(comment, TestFlag, SetFlag, UnsetFlag)),
                optional(wb_uint, 1),
                wst_star(choice(comment, TestFlag, SetFlag, UnsetFlag)),
                () => ContentStar));
const AnonWildcardAlternativeNoLoras =
      xform(make_ASTAnonWildcardAlternative,
            seq(wst_star(choice(comment, TestFlag, SetFlag, UnsetFlag)),
                optional(wb_uint, 1),
                wst_star(choice(comment, TestFlag, SetFlag, UnsetFlag)),
                () => ContentStarNoLoras));
const AnonWildcard            = xform(arr => new ASTAnonWildcard(arr),
                                      brc_enc(wst_star(AnonWildcardAlternative, '|')));
const AnonWildcardNoLoras     = xform(arr => new ASTAnonWildcard(arr),
                                      brc_enc(wst_star(AnonWildcardAlternativeNoLoras, '|')));
const NamedWildcardReference  = xform(seq('@',                                       // [0]
                                          optional('^'),                             // [1]
                                          optional(xform(parseInt, uint)),          // [2]
                                          optional(xform(parseInt,
                                                         second(seq('-', uint)))),  // [3]
                                          optional(/[,&]/),                          // [4]
                                          ident),                                    // [5]
                                      arr => {
                                        const ident  = arr[5];
                                        const min_ct = arr[2][0] ?? 1;
                                        const max_ct = arr[3][0] ?? min_ct;
                                        const join   = arr[4][0] ?? '';
                                        const caret  = arr[1][0];
                                        
                                        return new ASTNamedWildcardReference(ident,
                                                                             join,
                                                                             caret,
                                                                             min_ct,
                                                                             max_ct);
                                      });
NamedWildcardReference.abbreviate_str_repr('NamedWildcardReference');
const NamedWildcardDesignator = second(seq('@', ident)); 
NamedWildcardDesignator.abbreviate_str_repr('NamedWildcardDesignator');
const NamedWildcardDefinition = xform(arr => new ASTNamedWildcardDefinition(arr[0][0], arr[1]),
                                      wst_cutting_seq(wst_seq(NamedWildcardDesignator, // [0][0]
                                                              assignment_operator),    // -
                                                      discarded_comments,
                                                      AnonWildcard));                  // [1]
NamedWildcardDefinition.abbreviate_str_repr('NamedWildcardDefinition');
const NamedWildcardUsage      = xform(seq('@', optional("!"), optional("#"), ident),
                                      arr => {
                                        const [ bang, hash, ident, objs ] =
                                              [ arr[1][0], arr[2][0], arr[3], []];
                                        
                                        if (!bang && !hash)
                                          return new ASTNamedWildcardReference(ident);

                                        // goes before hash so that "@!#" works correctly:
                                        if (bang) 
                                          objs.push(new ASTUnlatchNamedWildcard(ident));

                                        if (hash)
                                          objs.push(new ASTLatchNamedWildcard(ident));

                                        return objs;
                                      });
NamedWildcardUsage.abbreviate_str_repr('NamedWildcardUsage');
const ScalarReference         = xform(seq('$', optional('^'), ident),
                                      arr => new ASTScalarReference(arr[2], arr[1][0]));
ScalarReference.abbreviate_str_repr('ScalarReference');
const ScalarDesignator        = xform(seq('$', ident),
                                      arr => new ASTScalarReference(arr[1]));
ScalarDesignator.abbreviate_str_repr('ScalarDesignator');
const ScalarUpdate            = xform(arr => new ASTUpdateScalar(arr[0][0], arr[1],
                                                                 arr[0][1] == '='),
                                      wst_cutting_seq(wst_seq(ScalarDesignator,             // [0][0]
                                                              discarded_comments,
                                                              choice(incr_assignment_operator,
                                                                     assignment_operator)), // [0][1]
                                                      discarded_comments,                    // [1]
                                                      choice(() => LimitedContent,
                                                             json_string,
                                                             plaintext),
                                                      discarded_comments,
                                                      lws(optional(';'))));
ScalarUpdate.abbreviate_str_repr('ScalarUpdate');
const LimitedContent          = choice(NamedWildcardReference,
                                       ScalarReference,
                                       AnonWildcardNoLoras);
// LimitedContent.abbreviate_str_repr('LimitedContent');
const make_Content_rule          = (anon_wildcard_rule, ...prepended_rules) =>
      choice(...prepended_rules,
             comment,
             NamedWildcardReference,
             NamedWildcardUsage,
             SetFlag,
             UnsetFlag,
             escaped_brc,
             ScalarUpdate,
             ScalarReference,
             AnonWildcard, // sketchy, parent rule should be split into 2
             SpecialFunctionNotInclude,
             low_pri_text,
             plaintext);
const ContentNoLoras = make_Content_rule(AnonWildcardNoLoras);
// ContentNoLoras.abbreviate_str_repr('ContentNoLoras');
const Content                 = make_Content_rule(ContentNoLoras, A1111StyleLora);
// Content.abbreviate_str_repr('Content');
const ContentStar             = wst_star(Content);
// ContentStar.abbreviate_str_repr('ContentStar');
const ContentStarNoLoras      = wst_star(ContentNoLoras);
// ContentStarNoLoras.abbreviate_str_repr('ContentStarNoLoras');
const Prompt                  = wst_star(choice(AnySpecialFunction,
                                                NamedWildcardDefinition,
                                                Content));
// -------------------------------------------------------------------------------------------------
Prompt.finalize();
// =================================================================================================
// END OF SD PROMPT GRAMMAR SECTION.
// =================================================================================================


// =================================================================================================
// DEV NOTE: Copy into wildcards-plus.js through this line!
// =================================================================================================



// =================================================================================================
// MAIN SECTION:
// =================================================================================================
async function main() {
  // -----------------------------------------------------------------------------------------------
  // process the command-line arguments:
  // -----------------------------------------------------------------------------------------------
  const args       = process.argv.slice(2);
  let   count      = 1;
  let   post       = false;
  let   confirm    = false;
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

  if (args.length === 0)
    throw new Error("Error: Must provide --stdin or an input file.");

  if (args[0] === '--stdin') {
    if (confirm)
      throw new Error(`the --confirm and --stdin options are incompatible.`);
    
    from_stdin = true;
  }

  if (args.length > 1) 
    count = parseInt(args[1]);

  // -----------------------------------------------------------------------------------------------
  // read prompt input:
  // -----------------------------------------------------------------------------------------------
  let result = null;
  
  if (from_stdin) {
    // Read all stdin into a string
    let prompt_input = await new Promise((resolve, reject) => {
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
    // log_match_enabled = true;
    
    result = parse_file(args[0]);
  }

  // -----------------------------------------------------------------------------------------------
  // just for debugging:
  // -----------------------------------------------------------------------------------------------
  if (print_ast_enabled)
    console.log(`result: ${inspect_fun(result.value)}`);

  if (print_ast_json_enabled)
    console.log(`result (JSON): ${JSON.stringify(result.value)}`);
  
  // -----------------------------------------------------------------------------------------------
  // check that the parsed result is complete and expand:
  // -----------------------------------------------------------------------------------------------
  if (! result.is_finished)
    throw new Error(`error parsing prompt at ${result.index}!`);

  let   AST          = result.value;
  const base_context = load_prelude(new Context({files: from_stdin ? [] : [args[0]]}));
  
  if (print_ast_before_includes_enabled) {
    console.log('------------------------------------------------------------------------------------------');
    console.log(`before process_includes:`);
    console.log('------------------------------------------------------------------------------------------');
    console.log(`${inspect_fun(AST)}`);
    console.log('------------------------------------------------------------------------------------------');
    console.log(`before process_includes (as JSON):`);
    console.log('------------------------------------------------------------------------------------------');
    console.log(`${JSON.stringify(AST)}`);
  }

  AST = process_includes(AST, base_context);

  if (print_ast_after_includes_enabled) { 
    console.log('------------------------------------------------------------------------------------------');
    console.log(`after process_includes:`);
    console.log('------------------------------------------------------------------------------------------');
    console.log(`${inspect_fun(AST)}`);
    console.log('------------------------------------------------------------------------------------------');
    console.log(`after process_includes (as JSON):`);
    console.log('------------------------------------------------------------------------------------------');
    console.log(`${JSON.stringify(AST)}`);
  }
  
  let posted_count        = 0;
  let prior_prompt        = null;
  let prior_configuration = null;
  
  const stash_priors = (prompt, configuration) => {
    prior_prompt        = prompt;
    prior_configuration = structured_clone(configuration);
  };

  const restore_priors = (prompt, configuration) => {
    const ret = [ prior_prompt, prior_configuration ];
    [ prior_prompt, prior_configuration ] = [ prompt, configuration ];
    return ret;
  };

  const do_post = (prompt, configuration) => {
    post_prompt({ prompt: prompt,  configuration: configuration });
    posted_count += 1; 
  };

  while (posted_count < count) {
    console.log('==========================================================================================');
    console.log(`Expansion #${posted_count + 1} of ${count}:`);
    console.log('==========================================================================================');
    
    const context = base_context.clone();
    const prompt  = expand_wildcards(AST, context);

    if (log_flags_enabled || log_configuration_enabled) {
      console.log(`------------------------------------------------------------------------------------------`);
      console.log(`Flags after:`);
      console.log(`------------------------------------------------------------------------------------------`);
      console.log(`${inspect_fun(context.flags)}`);
    }

    console.log(`------------------------------------------------------------------------------------------`);
    console.log(`Final config is is:`);
    console.log(`------------------------------------------------------------------------------------------`);
    console.log(inspect_fun(context.configuration));

    
    console.log(`------------------------------------------------------------------------------------------`);
    console.log(`Expanded prompt #${posted_count + 1} of ${count} is:`);
    console.log(`------------------------------------------------------------------------------------------`);
    console.log(prompt);

    if (context.configuration.negative_prompt || context.configuration.negative_prompt === '') {
      console.log(`------------------------------------------------------------------------------------------`);
      console.log(`Expanded negative prompt:`);
      console.log(`------------------------------------------------------------------------------------------`);
      console.log(context.configuration.negative_prompt);
    }

    if (!post) {
      posted_count += 1; // a lie to make the counter correct.
    }
    else {
      if (!confirm) {
        console.log(`------------------------------------------------------------------------------------------`);
        do_post(prompt, context.configuration);
        posted_count += 1;
      }
      else  {
        console.log();

        const question = `POST this prompt as #${posted_count+1} out of ${count} ` +
              `(enter /y.*/ for yes, positive integer for multiple images, or /p.*/ to ` +
              `POST the prior prompt)? `;
        const answer   = await ask(question);

        if (! (answer.match(/^[yp].*/i) || answer.match(/^\d+/i))) {
          stash_priors(prompt, context.configuration);
          continue;
        }

        if (answer.match(/^p.*/i)) {
          if (prior_prompt) { 
            console.log(`------------------------------------------------------------------------------------------`);
            [ prompt, context.configuration ] = restore_priors(prompt, context.configuration);
            
            console.log(`POSTing prior prompt '${prompt}'`);
            
            do_post(prompt, context.configuration);
            
            continue;
          }
          else {
            console.log(`can't rewind, no prior prompt`);
          }
        }
        else { // /^y.*/
          console.log(`------------------------------------------------------------------------------------------`);
          const parsed    = parseInt(answer);
          const gen_count = isNaN(parsed) ? 1 : parsed;  
          
          for (let iix = 0; iix < gen_count; iix++)
            do_post(prompt, context.configuration);
        }
      }
    }
    
    stash_priors(prompt, context.configuration);
  }

  console.log('==========================================================================================');
}
// -------------------------------------------------------------------------------------------------
main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
// =================================================================================================
// END OF MAIN SECTION.
// =================================================================================================
// console.log(`${Prompt}`);

// just for demonstration... this is kind of a silly rule since it would only match an infinite series of 'x'-es:
const Z        = l('z');
const TestRule = seq('x', Z, Z, () => TestRule); 
// console.log(`${TestRule}`);
// console.log(``);
console.log(`${Prompt}`);
// console.log(`${NamedWildcardReference}`);

// console.log(`${NormalSpecialFunction}`);
// console.log(`${inspect_fun(NormalSpecialFunction.options)}`);

// for (const [ix, option] of NormalSpecialFunction.options.entries())
//   console.log(`#${ix}: ${option}`)
// console.log(`${CheckFlagWithSetConsequent}`);
// console.log(`${CheckFlagWithOrAlternatives}`);
console.log(lws('a').toString());
console.log(wst_star('a').toString());
