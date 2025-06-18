//@api-1.0
// wildcards-plus
// author ariane-emory (includes some code from wetcircuit's original wildcards.js)
// v0.9
// Draw Things 1.20240502.2
// =================================================================================================


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
let abbreviate_str_repr_enabled        = true;
let fire_and_forget_post_enabled       = false;
let inspect_depth                      = 50;
let log_configuration_enabled          = true;
let log_loading_prelude                = true;
let log_post_enabled                   = true;
let log_finalize_enabled               = false;
let log_intercalate_enabled            = false;
let log_flags_enabled                  = false;
let log_match_enabled                  = false;
let log_name_lookups_enabled           = false;
let log_picker_enabled                 = false;
let log_level__audit                   = 0;
let log_level__expand_and_walk         = 0;
let log_level__smart_join              = 0;
let prelude_disabled                   = false;
let print_ast_then_die                 = false;
let print_ast_before_includes_enabled  = false;
let print_ast_after_includes_enabled   = false;
let print_ast_json_enabled             = false;
let print_packrat_cache_counts_enabled = false;
let packrat_enabled                    = false;
let save_post_requests_enabled         = true;
let unnecessary_choice_is_an_error     = false;
let double_latching_is_an_error        = false;
let double_unlatching_is_an_error      = false;
let rule_match_counter_enabled         = false;
// =================================================================================================


// =================================================================================================
// find a better spot for this: 
// =================================================================================================
Array.prototype.toString = function() {
  return this.length > 0 ? compress(`[ ${this.join(", ")} ]`) : '[]';
}
// =================================================================================================


// =================================================================================================
// new logger class:
// =================================================================================================
class Logger {
  constructor(indent = 0, indent_str = '| ') {
    this.indent     = indent;
    this.indent_str = indent_str;
  }
  // -----------------------------------------------------------------------------------------------
  error(...args) {
    this.#write(console.error, ...args);
  }
  // -----------------------------------------------------------------------------------------------
  log(...args) {
    this.#write(console.log, ...args);
  }
  // -----------------------------------------------------------------------------------------------
  #write(destination, str, with_indent = true) {    
    if ((typeof destination !== 'function') ||
        (typeof str         !== 'string'))
      throw new Error(`bad __write args: ${inspect_fun(arguments)}`);

    const lines = with_indent
          ? this.#indent_lines(str)
          : [ str ];
    
    for (const line of lines)
      destination(line);
  }
  // -----------------------------------------------------------------------------------------------
  #indent_lines(str) {
    // type testing here is likely overkill:
    // if (typeof str !== 'string')
    //   throw new Error(`not a string: ${inspect_fun(str)}`);
    
    const indent_string = this.indent_str.repeat(this.indent);
    const indented_str  = str
          .split("\n")
          .map(line => `${indent_string}${line}`);

    return indented_str;
  }
  // -----------------------------------------------------------------------------------------------
  nest(indent_addend = 1) {
    return new Logger(this.indent + indent_addend, this.indent_str);
  }
}
// -------------------------------------------------------------------------------------------------
const lm = { // logger manager object
  logger_stack: [],
  // -----------------------------------------------------------------------------------------------
  get logger() {
    if (this.logger_stack.length == 0) {
      const new_logger = new Logger(0);
      this.logger_stack.push(new_logger);
      return new_logger;
    }
    return this.logger_stack[this.logger_stack.length - 1];
  },
  // -----------------------------------------------------------------------------------------------
  error(...args) {
    this.logger.error(...args);    
  },
  // -----------------------------------------------------------------------------------------------
  log(...args) {
    this.logger.log(...args);
  },
  // -----------------------------------------------------------------------------------------------
  indent(fn) {
    return this.__indent(fn, 1);
  },
  // -----------------------------------------------------------------------------------------------
  indent2(fn) {
    return this.__indent(fn, 2);
  },
  // -----------------------------------------------------------------------------------------------
  __indent(fn, indent_addend) {
    if (typeof fn            !== 'function' ||
        typeof indent_addend !== 'number')
      throw new Error(`not a number: ${inspect_fun(indent_addend)}`);
    
    this.logger_stack.push(this.logger.nest(indent_addend));

    try {
      return fn();
    }
    finally {
      this.logger_stack.pop();
    }
  },
}
// -------------------------------------------------------------------------------------------------
if (false) {
  lm.log("Top level");
  lm.indent(() => {
    lm.log("2nd level");
    lm.indent(() => {
      lm.log("3rd level");
    });
    lm.log("Back at 2nd level");
  });

  lm.log("Back at top level");

  process.exit(0);
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
//         |-- Lookahead
//         |-- Optional
//         |-- Sequence ------- CuttingSequence
//         |-- Xform
//         |
//         |-- (Quantified) -|-- Plus
//         |                 |-- Star
//         |
//         | Rules triggering failure:
//         |-- Expected
//         |-- Unexpected
//         |-- Fail
//         |-- NeverMatch (non-fatal)
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
//         | Rules for terminals:
//         |
//         |-- Literal
//         |-- Regex
//
// ForwardReference (only needed when calling xform with a weird arg order)
// LabeledValue
// MatchResult
//
// -------------------------------------------------------------------------------------------------
const DISCARD              = Symbol('DISCARD');
const END_QUANTIFIED_MATCH = Symbol('END_QUANTIFIED_MATCH');
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
// FatalParseError class
// -------------------------------------------------------------------------------------------------
function __format_FatalParseError_message(message_body, input, index) {
  return `${message_body} \nat char #${index}, ` +
    `found:\n` +
    `${abbreviate(input.substring(index))}`;
}
// -------------------------------------------------------------------------------------------------
class FatalParseError extends Error {
  constructor(message_body, input, index) {
    if (!(typeof message_body === 'string' &&
          typeof input === 'string' &&
          typeof index === 'number'))
      throw new Error(`bad arges: ${inspect_fun(arguments)}`);
    
    super(__format_FatalParseError_message(message_body, input, index));
    this.name         = 'FatalParseError';
    this.message_body = message_body
    this.input        = input;
    this.index        = index;
  }
  // -----------------------------------------------------------------------------------------------
  get message() {
    return __format_FatalParseError_message(this.message, this.input, this.indent);
  }
}
// -------------------------------------------------------------------------------------------------


// -------------------------------------------------------------------------------------------------
// Rule class
// -------------------------------------------------------------------------------------------------
class Rule {
  static match_counter = 0;
  // -----------------------------------------------------------------------------------------------
  constructor() {
    this.memoize = packrat_enabled;
    // this.abbreviated = false;
  }
  // -----------------------------------------------------------------------------------------------
  abbreviate_str_repr(str) {
    if (this.abbreviated)
      throw new Error(`${inspect_fun(this)} is already abbreviated, ` +
                      `this likely a programmer error`);
    
    if (! abbreviate_str_repr_enabled)
      return;
    
    if (str)
      this.__impl_toString = () => str;
    
    // this.__direct_children = () => [];
    this.abbreviated       = true;

    return this;
  }
  // -----------------------------------------------------------------------------------------------
  direct_children() {
    const ret = this.__direct_children();

    if (ret === null)
      throw new Error(`${this.constructor.name}.__direct children() must return an Array, ` +
                      `got ${inspect_fun(ret)}` +
                      `this most likely indicated a programmer error`);

    if (ret.includes(undefined))
      throw new Error(`direct_children ` +
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

    if (! this.abbreviated)
      for (const direct_child of this.direct_children()) {
        // lm.log(`direct_child = ${inspect_fun(direct_child)}`);
        this.__vivify(direct_child).collect_ref_counts(ref_counts);
      }

    return ref_counts;
  }
  // -----------------------------------------------------------------------------------------------
  finalize(unexpected) {
    if (unexpected !== undefined)
      throw new Error("bad args");
    
    this.__finalize(new Set());
  }
  // -----------------------------------------------------------------------------------------------
  __finalize(visited, unexpected) {
    if (unexpected !== undefined || ! (visited instanceof Set))
      throw new Error(`bad args: (${typeof visited} ${inspect_fun(visited)}, `+
                      `${unexpected}) ` +
                      `args: ${inspect_fun(arguments)}}`);
    
    if (visited.has(this)) {
      if (log_finalize_enabled)
        lm.log(`skipping ${this}.`);

      return;
    }

    visited.add(this);

    if (log_finalize_enabled)
      lm.log(`finalizing ${this}...`);

    this.__impl_finalize(visited);
  }
  // -----------------------------------------------------------------------------------------------
  __impl_finalize(visited) {
    if (unexpected !== undefined)
      throw new Error("bad args");
    
    throw new Error(`__impl_finalize is not implemented by ${this.constructor.name}`);    
  }
  // -----------------------------------------------------------------------------------------------
  match(input, index = 0, cache = new Map()) {
    if (rule_match_counter_enabled)
      Rule.match_counter += 1;
    
    if (! (cache instanceof Map))
      throw new Error(`bad match args: ${inspect_fun(arguments)}`);
    
    if (typeof input !== 'string') 
      throw new Error(`not a string: ${typeof input} ${abbreviate(inspect_fun(input))}!`);
    
    if (log_match_enabled) {
      if (index_is_at_end_of_input(index, input))
        lm.indent(() => lm.log(`Matching ${this.constructor.name} ${this.toString()}, ` +
                               `but at end of input!`));
      else 
        lm.log(`Matching ` +
               // `${this.constructor.name} `+
               `${abbreviate(this.toString())} at ` +
               `char #${index}: ` +
               `'${abbreviate(input.substring(index))}'`);
    }
    
    let rule_cache = null;

    if (this.memoize) {
      rule_cache = cache.get(this);
      
      if (rule_cache) {
        const got = rule_cache.get(index);

        if (got !== undefined) {
          // lm.log(`use cached result for ${this} at ${index} => ${inspect_fun(got)}`) ;        
          return got;
        }
      }
      else {
        // lm.log(`init cache for rule ${this}`);
        rule_cache = new Map();
        cache.set(this, rule_cache);
      }
    }
    
    const ret = this.__match(input, index, cache);

    if (ret && ret?.value === undefined) {
      throw new Error(`got undefined from ${inspect_fun(this)}: ${inspect_fun(ret)}, ` +
                      `this is likely a programmer error`);
    }

    rule_cache?.set(index, ret);

    // if (ret && ret?.value === null) {
    //   throw new Error(`got null from ${inspect_fun(this)}: ${inspect_fun(ret)}, ` +
    //                   `this is likely a programmer error`);
    // }
    
    if (log_match_enabled) {
      // if (ret)
      lm.log(`<= ${this.constructor.name} ${abbreviate(this.toString())} ` +
             `returned: ${abbreviate(compress(inspect_fun(ret)))}`);
      // else
      //   log(indent,
      //       `<= Matching ${this.constructor.name} ${this.toString()} ` +
      //       `returned null.`);
    }

    return ret;
  }
  // -----------------------------------------------------------------------------------------------
  __match(input, index, cache) {
    if (! (cache instanceof Map))
      throw new Error("bad args");

    throw new Error(`__match is not implemented by ${this.constructor.name}`);
  }
  // -----------------------------------------------------------------------------------------------
  toString() {
    const ref_counts = this.collect_ref_counts();
    const next_id    = { value: 0 };

    // if (ref_counts.size > 0) {
    //   lm.log(`REF_COUNTS:`);
    //   lm.log('{');
    
    //   for (const [key, value] of ref_counts)
    //     lm.log(`  ${inspect_fun(key, true)} ` +
    //                 `=> ${value},`);
    
    //   lm.log('}');
    // }
    
    return this.__toString(new Map(), next_id, ref_counts).replace('() => ', '');
  }
  // -----------------------------------------------------------------------------------------------
  __toString(visited, next_id, ref_counts) {
    if (ref_counts === undefined)
      throw new Error('got ref_counts === undefined, this likely indicates a programmer error');

    const __call_impl_toString = () => this
          .__impl_toString(visited, next_id, ref_counts)
          .replace('() => ', '');
    
    if (this.abbreviated || this.direct_children().length == 0)
      return abbreviate(__call_impl_toString(), 64);
    
    if (visited.has(this)) 
      return `#${visited.get(this)}#`;

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
  __impl_finalize(visited) {
    this.rule            = this.__vivify(this.rule);
    this.separator_rule  = this.__vivify(this.separator_rule);
    lm.indent(() => this.rule.__finalize(visited));
    lm.indent(() => this.separator_rule?.__finalize(visited));
  }
  // -----------------------------------------------------------------------------------------------
  __quantified_match(input, index, cache) {
    if (! (cache instanceof Map))
      throw new Error("bad args");
    
    const values        = [];
    let prev_index      = null;
    const rewind_index  = ()   => index = prev_index;
    const update_index  = (ix) => {
      prev_index = index;
      index      = ix;
    };

    let match_result = lm.indent(() => this.rule.match(input, index, cache));

    if (match_result === undefined)
      throw new Error("match_result === undefined, this likely indicates a programmer error");
    
    if (match_result === false)
      throw new Error("math_result === false, this likely indicates a programmer error");
    
    if (match_result === null)
      return new MatchResult([], input, index); // empty array happens here

    if (match_result.value === END_QUANTIFIED_MATCH)
      return new MatchResult([], input, match_result.index);
    
    // if (match_result.value === '' || match_result.value)
    if (match_result.value !== DISCARD)
      values.push(match_result.value);
    
    update_index(match_result.index);

    while (true) {
      if (this.separator_rule) {
        if (log_match_enabled)
          lm.log(`Matching separator rule ${this.separator_rule}...`);
        
        const separator_match_result =
              lm.indent(() => this.separator_rule.match(input, index, cache));

        if (! separator_match_result) {
          // required mode stuff:
          if (this.trailing_separator_mode ==
              trailing_separator_modes.required) {
            rewind_index();
            values.pop();
          }

          if (log_match_enabled)
            lm.log(`did NOT Match separator rule ${this.separator_rule}...`);
          
          break;
        }

        if (log_match_enabled)
          lm.log(`matched separator rule ${this.separator_rule}...`);

        update_index(separator_match_result.index);
      } // end of if (this.separator_rule)

      match_result = lm.indent(() => this.rule.match(input, index, cache));

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

      if (match_result.value === END_QUANTIFIED_MATCH)
        return new MatchResult(values, input, index);
      
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
  __match(input, index, cache) {
    const __quantified_match_result = lm.indent(() => this.__quantified_match(input, index, cache));

    return __quantified_match_result?.value.length > 0
      ? __quantified_match_result
      : null;
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
  __match(input, index, cache) {
    return this.__quantified_match(input, index, cache);
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
  __impl_finalize(visited) {
    for (let ix = 0; ix < this.options.length; ix++) {
      this.options[ix] = this.__vivify(this.options[ix]);
      lm.indent(() => this.options[ix].__finalize(visited));
    }
  }
  // -----------------------------------------------------------------------------------------------
  __match(input, index, cache) {
    let ix = 0;
    
    for (const option of this.options) {
      ix += 1;
      
      if (log_match_enabled)
        lm.indent(() =>
          lm.log(`Try option #${ix} ${option} ` +
                 `at char #${index}: ` +
                 `'${abbreviate(input.substring(index))}'`));
      
      const match_result = lm.indent(() => option.match(input, index, cache));
      
      if (match_result) { 
        // if (match_result.value === DISCARD) {
        //   index = match_result.index;
        
        //   continue;
        // }

        if (log_match_enabled)
          lm.indent(() =>
            lm.log(`Chose option #${ix}, ` +
                   `now at char #${match_result.index}: ` +
                   `'${abbreviate(input.substring(match_result.index))}'`));
        
        return match_result;
      }

      if (log_match_enabled)
        lm.indent(() =>
          lm.log(`Rejected option #${ix}.`));
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
    lm.log("WARNING: unnecessary use of choice!");

    if (unnecessary_choice_is_an_error)
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
  __impl_finalize(visited) {
    this.rule = this.__vivify(this.rule);    
    lm.indent(() => this.rule.__finalize(visited));
  }
  // -----------------------------------------------------------------------------------------------
  __match(input, index, cache) {
    if (! this.rule)
      return new MatchResult(null, input, index);
    
    const match_result = lm.indent(() => this.rule.match(input, index, cache));

    if (! match_result)
      return null;

    const mr = new MatchResult(DISCARD, input, match_result.index);

    // lm.log(`MR: ${inspect_fun(mr)}`);
    
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
  __impl_finalize(visited) {
    this.rule = this.__vivify(this.rule);
    lm.indent(() => this.rule.__finalize(visited));
  }
  // -----------------------------------------------------------------------------------------------
  __match(input, index, cache) {
    const rule_match_result = this.rule.match(input, index, cache);

    if (! rule_match_result)
      return null;

    const ret = rule_match_result.value[this.index] === undefined
          ? DISCARD // <- I forget why I did this? Could be a bad idea?
          : rule_match_result.value[this.index];
    
    if (log_match_enabled) 
      lm.log(`get elem ${this.index} from ` +
             `${compress(inspect_fun(rule_match_result.value))} = ` +
             `${typeof ret === 'symbol' ? ret.toString() : abbreviate(compress(inspect_fun(ret)))}`);
    
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

    return `first(${rule_str})`;
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

    return `second(${rule_str})`;
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

    return `third(${rule_str})`;
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
  __impl_finalize(visited) {
    this.start_rule = this.__vivify(this.start_rule);
    this.body_rule  = this.__vivify(this.body_rule);
    this.end_rule   = this.__vivify(this.end_rule);
    lm.indent(() => this.start_rule.__finalize(visited));
    lm.indent(() => this.body_rule .__finalize(visited));
    lm.indent(() => this.end_rule  .__finalize(visited));
  }
  // -----------------------------------------------------------------------------------------------
  __match(input, index, cache) {
    const start_rule_match_result =
          lm.indent(() => this.start_rule.match(input, index, cache));

    if (! start_rule_match_result)
      return null;

    const body_rule_match_result =
          lm.indent(() => this.body_rule.match(input, start_rule_match_result.index, cache));

    if (! body_rule_match_result)
      return this.__fail_or_throw_error(start_rule_match_result,
                                        body_rule_match_result,
                                        input,
                                        start_rule_match_result.index);

    const end_rule_match_result =
          lm.indent(() => this.end_rule.match(input, body_rule_match_result.index, cache));

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
    throw new FatalParseError(// `(#1) ` +
      `CuttingEnclosed expected [${this.body_rule} ${this.end_rule}] ` +
        `after ${this.start_rule}`,
      input, start_rule_result.index);
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
    lm.indent(() => this.rule.__finalize(visited));
  }
  // -----------------------------------------------------------------------------------------------
  __match(input, index, cache) {
    const rule_match_result = this.rule.match(input, index, indent, cache);

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
  __match(input, index, cache) {
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
// Lookahead class
// -------------------------------------------------------------------------------------------------
class Lookahead extends Rule {
  // -----------------------------------------------------------------------------------------------
  constructor(rule) {
    super();
    this.rule          = make_rule_func(rule);
  }
  // -----------------------------------------------------------------------------------------------
  __direct_children() {
    return [ this.rule ];
  }
  // -----------------------------------------------------------------------------------------------
  __match(input, index, cache) {
    const match_result = lm.indent(() => this.rule.match(input, index, cache));

    if (match_result === null)
      return null;
    
    match_result.index = index;

    return match_result;
  }
  // -----------------------------------------------------------------------------------------------
  __impl_finalize(visited) {
    this.rule = this.__vivify(this.rule);
    
    lm.indent(() => this.rule.__finalize(visited));
  }
  // -----------------------------------------------------------------------------------------------
  __impl_toString(visited, next_id, ref_counts) {
    return `(?=${this.__vivify(this.rule).__toString(visited, next_id, ref_counts)})`;
  }
}
// -------------------------------------------------------------------------------------------------
function lookahead(rule) { // convenience constructor
  return new Lookahead(rule);
}
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
  __match(input, index, cache) {
    const match_result = lm.indent(() => this.rule.match(input, index, cache));

    if (match_result === null) {
      const mr = new MatchResult(this.default_value, input, index);

      if (log_match_enabled)
        lm.log(`returning default ${inspect_fun(mr)}`);

      return mr;
    }
    
    match_result.value = match_result.value;

    return match_result;
  }
  // -----------------------------------------------------------------------------------------------
  __impl_finalize(visited) {
    this.rule = this.__vivify(this.rule);
    
    lm.indent(() => this.rule.__finalize(visited));
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

    if (elements.length == 0)
      throw new Error("empty sequence");
    
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
  __impl_finalize(visited) {
    for (let ix = 0; ix < this.elements.length; ix++) {
      this.elements[ix] = this.__vivify(this.elements[ix]);
      lm.indent(() => this.elements[ix].__finalize(visited));
    }
  }
  // -----------------------------------------------------------------------------------------------
  __match(input, index, cache) {
    const start_rule = input[0];

    if (log_match_enabled)
      lm.indent(() => lm.log(`matching first sequence element #1 out of ` +
                             `${this.elements.length}: ` +
                             `${abbreviate(compress(this.elements[0].toString()))} ` +
                             `at char #${index} ` +
                             `at '${abbreviate(input.substring(index))}'`));
    
    const start_rule_match_result =
          lm.indent2(() => this.elements[0].match(input, index, cache));
    
    let last_match_result = start_rule_match_result;

    // if (log_match_enabled && last_match_result !== null)
    //   log(indent + 1, `first last_match_result = ${abbreviate(inspect_fun(last_match_result))}`);
    
    if (last_match_result === null) {
      if (log_match_enabled)
        lm.indent(() =>
          lm.log(`did not match sequence element #1.`));
      return null;
    }

    const values = [];
    index        = last_match_result.index;

    if (log_match_enabled)
      lm.indent(() => lm.log(`matched first sequence element #1: ` +
                             `${compress(inspect_fun(last_match_result))}, ` +
                             `now at char #${index}: ` +
                             `'${abbreviate(input.substring(index))}'`));

    // if (log_match_enabled)
    //   log(indent + 1, `last_match_result = ${inspect_fun(last_match_result)}`);

    if (last_match_result.value !== DISCARD) {
      if (log_match_enabled)
        lm.indent(() => lm.log(`seq pushing first item ` +
                               `${abbreviate(compress(inspect_fun(last_match_result.value)))}`));

      values.push(last_match_result.value);

      // if (values.includes(null))
      //   throw new Error("STOP @ PUSH 1");
    }
    else if (log_match_enabled)
      lm.indent(() => lm.log(`discarding ${inspect_fun(last_match_result)}!`));

    for (let ix = 1; ix < this.elements.length; ix++) {
      if (log_match_enabled)
        lm.indent(() => lm.log(`matching sequence element #${ix + 1} out of ` +
                               `${this.elements.length}: ` +
                               `${abbreviate(compress(this.elements[ix].toString()))} ` +
                               `at char #${index}: ` +
                               `'${abbreviate(input.substring(index))}'`));
      
      const element = this.elements[ix];

      last_match_result = lm.indent2(() => element.match(input, index, cache));

      if (! last_match_result) {
        if (log_match_enabled)
          lm.indent(() => lm.log(`did not match sequence item #${ix}.`));
        
        return this.__fail_or_throw_error(start_rule_match_result,
                                          last_match_result,
                                          input, index);
      }

      if (log_match_enabled)
        lm.indent(() => lm.log(`matched sequence element #${ix+1}: ` +
                               `${compress(inspect_fun(last_match_result))}, ` +
                               `now at char #${last_match_result.index}: ` +
                               `'${abbreviate(input.substring(last_match_result.index))}'`));

      if (last_match_result.value !== DISCARD) {
        if (log_match_enabled)
          lm.indent(() => lm.log(`seq pushing ` +
                                 `${abbreviate(compress(inspect_fun(last_match_result.value)))}`));

        values.push(last_match_result.value);

        // if (values.includes(null))
        //   throw new Error(`STOP @ PUSH 2 AFTER ${this.elements[ix]}`);
      }

      index = last_match_result.index;
    }

    // if (values.includes(null))
    //   throw new Error("STOP @ RET");
    
    const mr = new MatchResult(values, input, last_match_result.index);
    // lm.log(`SEQ MR = ${inspect_fun(mr)}`);
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
    throw new FatalParseError(// `(#2) ` +
      `CuttingSequence expected ${this.elements[0]} to be followed by ` +
        `[${this.elements.slice(1).join(" ")}]`,
      input, start_rule_result.index);
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
  __impl_finalize(visited) {
    this.rule = this.__vivify(this.rule);
    lm.indent(() => this.rule.__finalize(visited));
  }
  // -----------------------------------------------------------------------------------------------
  __match(input, index, cache) {
    const rule_match_result = lm.indent(() => this.rule.match(input, index, cache));

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
// Expected class
// -------------------------------------------------------------------------------------------------
class Expected extends Rule {
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
  __match(input, index, cache) {
    const match_result = lm.indent(() => this.rule.match(input, index, cache));

    if (! match_result) {
      if (this.error_func)
        throw this.error_func(this, input, index)
      else 
        throw new FatalParseError(`expected ${this.rule}`, input, index);
    };

    return match_result;
  }
  // -----------------------------------------------------------------------------------------------
  __impl_finalize(visited) {
    this.rule = this.__vivify(this.rule);    
    lm.indent(() => this.rule.__finalize(visited))
  }
  // -----------------------------------------------------------------------------------------------
  __impl_toString(visited, next_id, ref_counts) {
    return `${this.__vivify(this.rule).__toString(visited, next_id)}!`;
  }
}
// -------------------------------------------------------------------------------------------------
function expect(rule, error_func = null) { // convenience constructor
  return new Expected(rule, error_func);
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
  __match(input, index, cache) {
    const match_result = lm.indent(() => this.rule.match(input, index, cache));
    
    if (match_result) {
      if (this.error_func) {
        const err = this.error_func(this, input, index, match_result);
        throw err instanceof Error ? err : new FatalParseError(err, input, index);
      }
      else {
        throw new FatalParseError(`unexpected ${this.rule}`, input, index);
      }
    };
    
    return null; // new MatchResult(null, input, match_result.index);
  }
  // -----------------------------------------------------------------------------------------------
  __impl_finalize(visited) {
    this.rule = this.__vivify(this.rule);    
    lm.indent(() => this.rule.__finalize(visited));
  }
  // -----------------------------------------------------------------------------------------------
  __impl_toString(visited, next_id, ref_counts) {
    return `!${this.__vivify(this.rule).__toString(visited, next_id, ref_counts)}!`;
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
  __match(input, index, cache) {
    throw this.error_func
      ? this.error_func(this, index, input)
      : new FatalParseError(`hit automatic failure Rule`, input, index);
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
  __match(input, index, cache) {
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
    regexp = typeof regexp === 'string'
      ? new RegExp(regexp)
      : regexp;
    
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
  __match(input, index, cache) {
    this.regexp.lastIndex = index;

    if (log_match_enabled)
      lm.indent(() => lm.log(`testing /${this.regexp.source}/ at char #${index}: ` +
                             `'${abbreviate(input.substring(index))}'`));

    const re_match = this.regexp.exec(input);
    
    if (! re_match) {
      if (log_match_enabled)
        lm.indent(() => lm.log(`regex did not match`));
      return null;
    }

    if (re_match.groups) {
      const tmp = re_match;
      delete tmp.input;
      
      lm.log(`re_match: ${inspect_fun(tmp)}`);
    }
    
    return new MatchResult(re_match[re_match.length - 1],
                           input,
                           index + re_match[0].length);
  }
  // -----------------------------------------------------------------------------------------------
  __impl_toString(visited, next_id, ref_counts) {
    return `/${this.regexp.source}/`;
  }
}
// -------------------------------------------------------------------------------------------------
function r_raw(strings, ...values) { // convenience constructor
  const regexp = RegExp_raw(strings, ...values);
  return new Regex(regexp);
}
// -------------------------------------------------------------------------------------------------
function r(regexp) { // convenience constructor
  return new Regex(regexp);
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
function abbreviate(str, normalize_newlines = true, length = 100) {
  if (typeof str !== 'string')
    throw new Error(`compress: not a string, got ${typeof str}: ${inspect_fun(str)}`);

  // Normalize all newlines first
  if (normalize_newlines)
    str = str.replace(/\r?\n/g, '\\n');

  // str = compress(str);
  
  if (str.length < length)
    return str;

  const bracing_pairs = [
    ['/',  '/'],
    ['(',  ')'],
    ['[',  ']'],
    ['{',  '}'],
    ['<',  '>'],
    ['\'', '\''],
    ['\"', '\"'],
    ['λ(', ')'],
  ];

  for (const [left, right] of bracing_pairs) {
    if (str.startsWith(left) && str.endsWith(right)) {
      const inner = str.substring(left.length, length - 3 - right.length);
      return `${left}${inner.trim()}...${right}`;
    }
  }

  return `${str.substring(0, length - 3).trim()}...`;
}
// -------------------------------------------------------------------------------------------------
function compress(str) {
  if (typeof str !== 'string')
    throw new Error(`compress: not a string, got ${typeof str}: ${inspect_fun(str)}`);
  
  return str.replace(/\s+/g, ' ');
}
// -------------------------------------------------------------------------------------------------
function index_is_at_end_of_input(index, input) {
  return index == input.length
}
// // ----------------------------------------------------------------------------------------------
// function log(indent, str = "", indent_str = "| ") {
//   if (! log_enabled)
//     return;

//   lm.log(`${indent_str.repeat(indent)}${str}`);
// }
// -------------------------------------------------------------------------------------------------
function LOG_LINE(char = '-', width = LOG_LINE.line_width) {
  lm.log(char.repeat(width));
}
LOG_LINE.line_width = 100;
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
function maybe_make_TokenLabel_from_string(thing) {
  if (typeof thing === 'string')
    return new TokenLabel(thing);

  return thing
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
// Whitespace combinators, these should go somewhere else?
// =================================================================================================
const prettify_whitespace_combinators = true;
// =================================================================================================

// =================================================================================================
const lws0                = rule => {
  rule = second(seq(whites_star, rule));
  
  if (prettify_whitespace_combinators) {
    rule.__impl_toString = function(visited, next_id, ref_counts) {
      const rule_str = this.rule.elements[1].__toString(visited, next_id, ref_counts);
      return `LWS0(${rule_str})`;
    }
  }

  return rule;
};
const tws0                = rule => { 
  rule = first(seq(rule, whites_star));

  if (prettify_whitespace_combinators) {
    rule.__impl_toString = function(visited, next_id, ref_counts) {
      const rule_str = this.rule.elements[0].__toString(visited, next_id, ref_counts);
      return `TWS0(${rule_str})`;
    }
  }
  
  return rule;
};
// =================================================================================================


// =================================================================================================
function make_whitespace_Rule_class_and_factory_fun(class_name_str, builder) {
  let klass = {
    [class_name_str]: class extends Rule {
      // -------------------------------------------------------------------------------------------
      constructor(rule) {
        super();
        this.base_rule = make_rule_func(rule);
        this.rule = builder(this.base_rule);
      }
      // -------------------------------------------------------------------------------------------
      __direct_children() {
        return [this.rule];
      }
      // -------------------------------------------------------------------------------------------
      __impl_finalize(indent, visited) {
        this.rule = this.__vivify(this.rule);
        lm.indent(() => this.rule.__finalize(visited))
        this.base_rule = this.__vivify(this.base_rule);
        lm.indent(() => this.base_rule.__finalize(visited));
      }
      // -------------------------------------------------------------------------------------------
      __match(input, index, cache) {
        return lm.indent(() => this.rule.match(input, index, cache));
      }
      // -------------------------------------------------------------------------------------------
      __impl_toString(visited, next_id, ref_counts) {
        if (typeof this.base_rule.__toString !== 'function')
          throw new Error(inspect_fun(this));
        
        return prettify_whitespace_combinators
          ? `${class_name_str}(${this.base_rule.__toString(visited, next_id, ref_counts)})`
          : this.base_rule.toString();
      }
    }
  }[class_name_str];

  let factory_fun = (rule, noisy = false) => {
    if (noisy)
      throw new Error('noisy bomb');
    
    rule = make_rule_func(rule);

    let stringified_rule = null;

    try {
      stringified_rule = 
        dt_hosted && typeof rule === 'function'
        ? 'function'
        : abbreviate(compress(inspect_fun(rule)));
    }
    catch (err) {
      if (!dt_hosted)
        throw err;
      
      stringified_rule = '<unprintable>';
    }

    if (!rule) {
      if (noisy)
        lm.log(`return original null rule ${stringified_rule}`);
      return rule;
    }

    if (typeof rule === 'function') {
      if (noisy)
        lm.log(`return klassed function ${stringified_rule}`);
      return new klass(rule);
    }
    
    if (rule instanceof klass) {
      if (noisy)
        lm.log(`return original klassed rule ${stringified_rule}`);
      return rule;
    }
    
    if (rule.direct_children().length > 0 && rule.direct_children().every(x => x instanceof klass)) {
      if (noisy)
        lm.log(`return original rule ${stringified_rule}`);
      return rule;
    }

    if (noisy)
      lm.log(`return klassed ${stringified_rule}`);
    
    return new klass(rule);
  }
  
  return [ klass, factory_fun ];
}
// -------------------------------------------------------------------------------------------------
const [ WithLWS, lws1 ] =
      make_whitespace_Rule_class_and_factory_fun("LWS1", rule => second(seq(whites_star, rule)));
const [ WithTWS, tws1 ] =
      make_whitespace_Rule_class_and_factory_fun("TWS1", rule => first(seq(rule, whites_star)));
// =================================================================================================


// =================================================================================================
function make_whitespace_decorator0(name, builder, extractor) {
  return rule => {
    const built = builder(rule);

    if (prettify_whitespace_combinators)
      built.__impl_toString = function(visited, next_id, ref_counts) {
        const rule_str = extractor(this).__toString(visited, next_id, ref_counts);
        return `${name}(${rule_str})`;
      };

    return built;
  }
}
// -------------------------------------------------------------------------------------------------
const lws2 = make_whitespace_decorator0("LWS2",
                                        rule => second(seq(whites_star, rule)),
                                        rule => rule.elements[1]  // your original form
                                       );
const tws2 = make_whitespace_decorator0("TWS2",
                                        rule => first(seq(rule, whites_star)),
                                        rule => rule.elements[0]
                                       );
// =================================================================================================


// =================================================================================================
function make_whitespace_decorator1(name, builder) {
  const tag = Symbol(name);
  
  return function (rule) {
    rule = make_rule_func(rule);

    if (!rule) return rule;

    if (rule[tag]) return rule;
    
    if (rule instanceof Rule  &&
        rule.direct_children().length > 0 &&
        rule.direct_children().every(x => x[tag]))
      return rule;
    
    const built = builder(rule);
    built[tag] = true;

    if (prettify_whitespace_combinators)
      built.__impl_toString = function(visited, next_id, ref_counts) {
        return `${name}(${rule.__toString(visited, next_id, ref_counts)})`;
      };

    return built;
  };
}
// -------------------------------------------------------------------------------------------------
const lws3 = make_whitespace_decorator1("LWS3", rule => second(seq(whites_star, rule)));
const tws3 = make_whitespace_decorator1("TWS3", rule => first(seq(rule, whites_star)));
// =================================================================================================


// =================================================================================================
function make_whitespace_decorator2(name, elem_index, whitespace_rule) {
  const tag = Symbol(name);

  const decorate = function (rule) {
    rule = make_rule_func(rule);

    if (!rule)
      return rule;

    if (rule[tag])
      return rule;

    // Unwrap if Choice of tagged rules
    if (rule instanceof Choice &&
        rule.options.every(option => option[tag])) {
      const unwrapped_options = rule.options.map(option => option.__original_rule || option);
      const rebuilt_choice = new Choice(...unwrapped_options);
      
      // lm.log(`constructed ${inspect_fun(rebuilt_choice)}`);
      const decorated = decorate(rebuilt_choice);  // ✅ Use the same closure with stable tag
      // lm.log(`decorated ${inspect_fun(decorated)}`);
      return decorated;
    }

    if (rule instanceof Sequence) {
      if (elem_index == 1 &&
          rule.elements[0][tag])
        return rule;
      else if (elem_index == 0 &&
               rule.elements[rule.elements.length - 1][tag])
        return rule;
    }
    
    if (rule instanceof Rule &&
        rule.direct_children().length > 0 &&
        rule.direct_children().every(x => x[tag]))
      return rule;

    const builder = elem_index == 0 ? first : second;
    
    const built = builder(elem_index == 0
                          ? seq(rule, whitespace_rule)
                          : seq(whitespace_rule, rule));
    
    built[tag] = true;
    built.__original_rule = rule;

    // if (prettify_whitespace_combinators)
    //   built.__impl_toString = function(visited, next_id, ref_counts) {
    //     return `${name}(${rule.__toString(visited, next_id, ref_counts)})`;
    //   };

    // if (prettify_whitespace_combinators)
    //   built.__impl_toString = function(visited, next_id, ref_counts) {
    //     if (typeof this.__toString !== 'function')
    //       lm.log(`suspiciousa: ${inspect_fun(this)}`);
    //     return `${name}(${this.__original_rule.__toString(visited, next_id, ref_counts)})`;
    //   };

    return built;
  };

  return decorate;
}
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
const ABORT = expect(never_match);
ABORT.abbreviate_str_repr("ABORT");
// -------------------------------------------------------------------------------------------------
// whitespace:
const whites_star        = r(/\s*/);
const whites_plus        = r(/\s+/);
const hwhites_star       = r(/[ \t]*/);
const hwhites_plus       = r(/[ \t]+/);
// whites_star.memoize = false;
// whites_plus.memoize = false;
whites_star.abbreviate_str_repr('whites*');
whites_plus.abbreviate_str_repr('whites+');
hwhites_star.abbreviate_str_repr('hwhites*');
hwhites_plus.abbreviate_str_repr('hwhites+');
// -------------------------------------------------------------------------------------------------
const lws  = make_whitespace_decorator2("LWS",  1, whites_star);
const tws  = make_whitespace_decorator2("TWS",  0, whites_star);
const lhws = make_whitespace_decorator2("LHWS", 1, hwhites_star);
const thws = make_whitespace_decorator2("THWS", 0, hwhites_star);
// -------------------------------------------------------------------------------------------------
// whitespace tolerant combinators:
// -------------------------------------------------------------------------------------------------
const make_wst_quantified_combinator = (base_combinator, lws_rule) => 
      ((rule, sep = null) => base_combinator(lws_rule(rule), lws_rule(sep)));
const make_wst_seq_combinator = (base_combinator, lws_rule) =>
      //      (...rules) => tws(base_combinator(...rules.map(x => lws_rule(x))));
      (...rules) => base_combinator(...rules.map(x => lws_rule(x)));
// -------------------------------------------------------------------------------------------------
const wst_choice      = (...options) => lws(choice(...options));
const wst_star        = make_wst_quantified_combinator(star, lws);
const wst_plus        = make_wst_quantified_combinator(plus, lws);
const wst_seq         = make_wst_seq_combinator(seq, lws);
const wst_enc         = make_wst_seq_combinator(enc, lws);
const wst_cutting_seq = make_wst_seq_combinator(cutting_seq, lws);
const wst_cutting_enc = make_wst_seq_combinator(cutting_enc, lws);
const wst_par_enc     = rule => wst_cutting_enc(lpar, rule, rpar);
const wst_brc_enc     = rule => wst_cutting_enc(lbrc, rule, rbrc);
const wst_sqr_enc     = rule => wst_cutting_enc(lsqr, rule, rsqr);
const wst_tri_enc     = rule => wst_cutting_enc(ltri, rule, rtri);
// -------------------------------------------------------------------------------------------------
const hwst_choice      = (...options) => lws(choice(...options));
const hwst_star        = make_wst_quantified_combinator(star, lhws);
const hwst_plus        = make_wst_quantified_combinator(plus, lhws);
const hwst_seq         = make_wst_seq_combinator(seq, lhws);
const hwst_enc         = make_wst_seq_combinator(enc, lhws);
const hwst_cutting_seq = make_wst_seq_combinator(cutting_seq, lhws);
const hwst_cutting_enc = make_wst_seq_combinator(cutting_enc, lhws);
const hwst_par_enc     = rule => hwst_cutting_enc(lpar, rule, rpar);
const hwst_brc_enc     = rule => hwst_cutting_enc(lbrc, rule, rbrc);
const hwst_sqr_enc     = rule => hwst_cutting_enc(lsqr, rule, rsqr);
const hwst_tri_enc     = rule => hwst_cutting_enc(ltri, rule, rtri);
// -------------------------------------------------------------------------------------------------
// simple 'words':
// -------------------------------------------------------------------------------------------------
const alpha_snake             = r(/[a-zA-Z_]+/);
const lc_alpha_snake          = r(/[a-z_]+/);
const uc_alpha_snake          = r(/[A-Z_]+/);
alpha_snake.abbreviate_str_repr('alpha_snake');
lc_alpha_snake.abbreviate_str_repr('lc_alpha_snake');
uc_alpha_snake.abbreviate_str_repr('uc_alpha_snake');
// -------------------------------------------------------------------------------------------------
// leading/trailing whitespace:
// -------------------------------------------------------------------------------------------------
// common numbers:
const udecimal           = r(/\d+\.\d+/);
const urational          = r(/\d+\/[1-9]\d*/);
const uint               = r(/\d+/);
const sdecimal           = r(/[+-]?\d+\.\d+/);
const srational          = r(/[+-]?\d+\/[1-9]\d*/);
const sint               = r(/[+-]?\d+/)
udecimal.abbreviate_str_repr('udecimal');
urational.abbreviate_str_repr('urational');
uint.abbreviate_str_repr('uint');
sdecimal.abbreviate_str_repr('sdecimal');
srational.abbreviate_str_repr('srational');
sint.abbreviate_str_repr('sint');
// -------------------------------------------------------------------------------------------------
// common separated quantified rules:
const star_comma_sep     = rule => star(rule, /\s*\,\s*/);
const plus_comma_sep     = rule => plus(rule, /\s*\,\s*/);
const star_whites_sep    = rule => star(rule, whites_plus);
const plus_whites_sep    = rule => plus(rule, whites_plus);
// -------------------------------------------------------------------------------------------------
// string-like terminals:
const stringlike         = quote => r_raw`${quote}(?:[^${quote}\\]|\\.)*${quote}`;
const dq_string          = stringlike('"');
const raw_dq_string      = r(/r"[^"]*"/);
const sq_string          = stringlike("'");
const template_string    = r(/`(?:[^\\`]|\\.)*`/);
const triple_dq_string   = r(/"""(?:[^\\]|\\.|\\n)*?"""/);
dq_string.abbreviate_str_repr('dq_string');
raw_dq_string.abbreviate_str_repr('raw_dq_string');
sq_string.abbreviate_str_repr('sq_string');
template_string.abbreviate_str_repr('template_string');
triple_dq_string.abbreviate_str_repr('triple_dq_string');
// -------------------------------------------------------------------------------------------------
// keyword helper:
const keyword            = word => {
  if (word instanceof Regex)
    return keyword(word.regexp);

  if (word instanceof RegExp)
    return keyword(word.source);
  
  return r(RegExp_raw(`\b${word}\b`));
};
// -------------------------------------------------------------------------------------------------
// parenthesis-like terminals:
const gt                 = l('>');
const rtri               = l('>');
const lbrc               = l('{}'[0]); // dumb hack to keep rainbow brackets extension happy.
const lpar               = l('(');
const lsqr               = l('[]'[0]);
const lt                 = l('<');
const ltri               = l('<');
const rbrc               = l('{}'[1]);
const rpar               = l(')');
const rsqr               = l('[]'[1]);
gt.abbreviate_str_repr('gt');
lbrc.abbreviate_str_repr('lbrc');
lpar.abbreviate_str_repr('lpar');
lsqr.abbreviate_str_repr('lsqr');
lt.abbreviate_str_repr('lt');
ltri.abbreviate_str_repr('ltri');
rbrc.abbreviate_str_repr('rbrc');
rpar.abbreviate_str_repr('rpar');
rsqr.abbreviate_str_repr('rsqr');
rtri.abbreviate_str_repr('rtri');
// -------------------------------------------------------------------------------------------------
// common enclosed rules:
const par_enc            = rule => cutting_enc(lpar, rule, rpar);
const brc_enc            = rule => cutting_enc(lbrc, rule, rbrc);
const sqr_enc            = rule => cutting_enc(lsqr, rule, rsqr);
const tri_enc            = rule => cutting_enc(lt,   rule, gt);
// const wse                = rule => enc(whites_star, rule, whites_star);
// const wse                = rule => {
//   rule = enc(whites_star, rule, whites_star);

//   rule.__impl_toString = function(visited, next_id, ref_counts) {
//     const rule_str = this.body_rule.__toString(visited, next_id, ref_counts);
//     return `WSE(${rule_str})`;
//   }

//   return rule;
// };
// -------------------------------------------------------------------------------------------------
// basic arithmetic ops:
const factor_op          = r(/[\/\*\%]/);
const term_op            = r(/[\+\-]/);
factor_op.abbreviate_str_repr('factor_op');
term_op.abbreviate_str_repr('term_op');
// -------------------------------------------------------------------------------------------------
// Pascal-like terminals:
const pascal_assign_op   = l('=');
pascal_assign_op.abbreviate_str_repr('pascal_assign_op');
// -------------------------------------------------------------------------------------------------
// Python-like terminals:
const python_exponent_op = l('**');
const python_logic_word  = r(/and|or|not|xor/);
python_exponent_op.abbreviate_str_repr('python_exponent_op');
python_logic_word.abbreviate_str_repr('python_logic_word');
// -------------------------------------------------------------------------------------------------
// common punctuation:
const at                 = l('@');
const ampersand          = l('&');
const asterisk           = l('*');
const bang               = l('!');
const bslash             = l('\\');
const caret              = l('^');
const colon              = l(':');
const comma              = l(',');
const dash               = l('-');
const dash_arrow         = l('->');
const dollar             = l('$');
const dot                = l('.');
const ellipsis           = l('...');
const equals             = l('=');
const equals_arrow       = l('=>');
const hash               = l('#');
const decr_equals        = l('-=');
const plus_equals        = l('+=');
const percent            = l('%');
const pipe               = l('|');
const pound              = l('#');
const question           = l('?');
const range              = l('..');
const semicolon          = l(';');
const shebang            = l('#!');
const slash              = l('/');
ampersand.abbreviate_str_repr('ampersand');
at.abbreviate_str_repr('at');
asterisk.abbreviate_str_repr('asterisk');
bang.abbreviate_str_repr('bang');
bslash.abbreviate_str_repr('bslash');
caret.abbreviate_str_repr('caret');
colon.abbreviate_str_repr('colon');
comma.abbreviate_str_repr('comma');
dash.abbreviate_str_repr('dash');
dash_arrow.abbreviate_str_repr('dash_arrow');
decr_equals.abbreviate_str_repr('decr_equals');
plus_equals.abbreviate_str_repr('plus_equals');
dollar.abbreviate_str_repr('dollar');
dot.abbreviate_str_repr('dot');
ellipsis.abbreviate_str_repr('ellipsis');
equals_arrow.abbreviate_str_repr('eq_arrow');
equals.abbreviate_str_repr('equals');
hash.abbreviate_str_repr('hash');
percent.abbreviate_str_repr('percent');
pipe.abbreviate_str_repr('pipe');
pound.abbreviate_str_repr('pound');
question.abbreviate_str_repr('question');
range.abbreviate_str_repr('range');
semicolon.abbreviate_str_repr('semicolon');
shebang.abbreviate_str_repr('shebang');
slash.abbreviate_str_repr('slash');
// -------------------------------------------------------------------------------------------------
// C-like numbers:
const c_bin              = r(/0b[01]/);
const c_char             = r(/'\\?[^\']'/);
const c_hex              = r(/0x[0-9a-f]+/);
const c_ident            = r(/[a-zA-Z_][0-9a-zA-Z_]*/);
const c_octal            = r(/0o[0-7]+/);
const c_sfloat           = r(/[+-]?\d*\.\d+(e[+-]?\d+)?/i);
const c_sint             = r(/[+-]?\d+/)
const c_snumber          = choice(c_hex, c_octal, c_sfloat, c_sint);
const c_ufloat           = r(/\d*\.\d+(e[+-]?\d+)?/i);
const c_uint             = r(/\d+/);
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
const c_bitwise_xor      = l('^');
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
const dot_chained        = rule => plus(rule, dot); 
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
const c_funcall = (fun_rule, arg_rule, open = lws(lpar), close = lws(rpar), sep = comma) =>
      seq(fun_rule,
          wst_cutting_enc(open,
                          wst_star(arg_rule, sep),
                          close));
// -------------------------------------------------------------------------------------------------
// convenience combinators:
// -------------------------------------------------------------------------------------------------
const end_quantified_match_if = rule => xform(rule, () => END_QUANTIFIED_MATCH);
const push                    = (value, rule) => xform(rule, arr => [value, ...arr]);
const enclosing               = (left, enclosed, right) =>
      xform(arr => [ arr[0], arr[2] ], seq(left, enclosed, right));
const head                    = (...rules) => first (seq            (...rules));
const cadr                    = (...rules) => second(seq            (...rules));
const wst_head                = (...rules) => first (wst_seq        (...rules));
const wst_cadr                = (...rules) => second(wst_seq        (...rules));
const cutting_head            = (...rules) => first (cutting_seq    (...rules));
const cutting_cadr            = (...rules) => second(cutting_seq    (...rules));
const wst_cutting_head        = (...rules) => first (wst_cutting_seq(...rules));
const wst_cutting_cadr        = (...rules) => second(wst_cutting_seq(...rules));
const flat1                   = rule => flat(rule, 1); 
const flat                    = (rule, depth = Infinity) =>
      xform(rule, arr => arr.flat(depth));
// =================================================================================================
// END of COMMON-GRAMMAR.JS CONTENT SECTION.
// =================================================================================================


// =================================================================================================
// BASIC JSON GRAMMAR SECTION:
// =================================================================================================
const make_JsonArray_rule = (value_rule,
                             trailing_separator_mode = trailing_separator_modes.forbidden) => 
      wst_cutting_enc(lsqr,
                      wst_star(value_rule,
                               comma,
                               trailing_separator_mode),
                      rsqr);
// -------------------------------------------------------------------------------------------------
// JSON ← S? ( Object / Array / String / True / False / Null / Number ) S?
const Json = choice(() => JsonObject,
                    () => JsonArray,
                    () => json_number,
                    () => json_string,
                    () => json_true,
                    () => json_false,
                    () => json_null);
// Object ← "{" ( String ":" JSON ( "," String ":" JSON )*  / S? ) "}"
const JsonObject = xform(arr =>  Object.fromEntries(arr), 
                         wst_cutting_enc(lbrc,
                                         wst_star(
                                           xform(arr => [arr[0], arr[2]],
                                                 wst_seq(() => json_string, colon, Json)),
                                           comma),
                                         rbrc));
// Array ← "[" ( JSON ( "," JSON )*  / S? ) "]"
const JsonArray = make_JsonArray_rule(Json);

// String ← S? ["] ( [^ " \ U+0000-U+001F ] / Escape )* ["] S?
const json_string = xform(JSON.parse,
                          /"(?:[^"\\\u0000-\u001F]|\\["\\/bfnrt]|\\u[0-9a-fA-F]{4})*"/);
// UnicodeEscape ← "u" [0-9A-Fa-f]{4}
const json_unicodeEscape = r(/u[0-9A-Fa-f]{4}/);
// Escape ← [\] ( [ " / \ b f n r t ] / UnicodeEscape )
const json_escape = seq('\\', choice(/["\\/bfnrt]/, json_unicodeEscape));
// True ← "true"
const json_true = xform(x => true, /true\b/);
// False ← "false"
const json_false = xform(x => false, /false\b/);
// Null ← "null"
const json_null = xform(x => null, /null\b/);
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
  // lm.log(`REIFY ${inspect_fun(arr)}`);
  
  const multiplier      = arr[0] ? -1 : 1;
  const integer_part    = arr[1];
  const fractional_part = arr[2];
  const exponent        = arr[3];
  const number          = multiplier * ((integer_part + fractional_part)**exponent);

  // lm.log(`ARR: ${inspect_fun(arr)}`);
  return number;
  // return arr;
};
const json_number = xform(reify_json_number,
                          seq(optional(json_minus),
                              xform(parseInt, json_integralPart),
                              optional(xform(parseFloat, json_fractionalPart), 0.0),
                              xform(parseInt, optional(json_exponentPart, 1))));
// S ← [ U+0009 U+000A U+000D U+0020 ]+
const json_S = r(/\s+/);
Json.abbreviate_str_repr('Json');
JsonObject.abbreviate_str_repr('JsonObject');
JsonArray.abbreviate_str_repr('JsonArray');
json_string.abbreviate_str_repr('json_string');
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
// =================================================================================================
// END OF BASIC JSON GRAMMAR SECTION.
// =================================================================================================


// =================================================================================================
// JSONC GRAMMAR SECTION:
// =================================================================================================
const make_Jsonc_rule = (choice_rule, comment_rule = () => jsonc_comment) =>
      second(wst_seq(wst_star(comment_rule),
                     choice_rule,
                     wst_star(comment_rule)));
const make_JsoncArray_rule = (value_rule,
                              comment_rule = () => jsonc_comment,
                              trailing_separator_mode = trailing_separator_modes.forbidden) => 
      make_JsonArray_rule(second(seq(wst_star(comment_rule),
                                     value_rule,
                                     wst_star(comment_rule))));
const make_JsoncObject_rule = (key_rule, value_rule,
                               { comment_rule = () => jsonc_comment,
                                 sequence_combinator = wst_cutting_seq,
                                 trailing_separator_mode = trailing_separator_modes.forbidden } = {}) => 
      choice(
        xform(arr => ({}), wst_seq(lbrc, rbrc)),
        xform(arr => {
          const new_arr = [ [arr[0], arr[2] ], ...(arr[4]??[]) ];
          return Object.fromEntries(new_arr);
        },
              sequence_combinator(
                wst_enc(lbrc, key_rule, colon),
                wst_star(comment_rule),
                value_rule,
                wst_star(comment_rule),
                optional(second(wst_seq(comma,
                                        wst_star(
                                          xform(arr =>  [arr[1], arr[5]],
                                                wst_seq(wst_star(comment_rule),
                                                        key_rule,
                                                        wst_star(comment_rule),
                                                        colon,
                                                        wst_star(comment_rule),
                                                        value_rule, 
                                                        wst_star(comment_rule)
                                                       )),
                                          comma,
                                          trailing_separator_mode)),
                               )),
                rbrc)))
// -------------------------------------------------------------------------------------------------
const Jsonc = make_Jsonc_rule(
  choice(() => JsoncObject, () => JsoncArray, json_string,
         json_null,           json_true,
         json_false,          json_number));
const JsoncArray = make_JsoncArray_rule(Jsonc);
const JsoncObject = make_JsoncObject_rule(json_string, Json);
const jsonc_comment = choice(c_block_comment, c_line_comment);
Jsonc.abbreviate_str_repr('Jsonc');
JsoncArray.abbreviate_str_repr('JsoncArray');
JsoncObject.abbreviate_str_repr('JsoncObject');
jsonc_comment.abbreviate_str_repr('jsonc_comment');
// =================================================================================================
// END OF JSONC GRAMMAR SECTION.
// =================================================================================================


// =================================================================================================
// 'relaxed' JSONC GRAMMAR SECTION: JSONC but with relaxed key quotation.
// =================================================================================================
const rjsonc_single_quoted_string =
      xform(
        s => JSON.parse('"' + s.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"') + '"'),
        /'(?:[^'\\\u0000-\u001F]|\\['"\\/bfnrt]|\\u[0-9a-fA-F]{4})*'/);
const rjsonc_string = choice(json_string, rjsonc_single_quoted_string);
const Rjsonc = make_Jsonc_rule(
  choice(() => RjsoncObject, () => RjsoncArray, rjsonc_string,
         json_null,           json_true,
         json_false,          json_number));
const RjsoncArray = make_JsoncArray_rule(Rjsonc, trailing_separator_modes.allowed);
const RjsoncObject =
      make_JsoncObject_rule(choice(rjsonc_string, c_ident), Rjsonc,
                            { trailing_separator_mode: trailing_separator_modes.allowed });
rjsonc_string.abbreviate_str_repr('rjsonc_string');
rjsonc_single_quoted_string.abbreviate_str_repr('rjsonc_single_quoted_string');
Rjsonc.abbreviate_str_repr('Rjsonc');
RjsoncArray.abbreviate_str_repr('RjsoncArray');
RjsoncObject.abbreviate_str_repr('RjsoncObject');
// -------------------------------------------------------------------------------------------------
// wst_cutting_enc(lsqr,
//                 wst_star(second(seq(jsonc_comments,
//                                     Rjsonc,
//                                     jsonc_comments)),
//                          comma),
//                 rsqr);


// const make_RjsoncObject_rule = (key_rule, value_rule)  => 
//       choice(
//         xform(arr => ({}), wst_seq(lbrc, rbrc)),
//         xform(arr => {
//           const new_arr = [ [arr[0], arr[2]], ...(arr[4][0]??[]) ];
//           return Object.fromEntries(new_arr);
//         },
//               wst_cutting_seq(
//                 wst_enc(lbrc, key_rule, colon), 
//                 jsonc_comments,
//                 value_rule,
//                 jsonc_comments,
//                 optional(second(wst_seq(comma,
//                                         wst_star(
//                                           xform(arr =>  [arr[1], arr[5]],
//                                                 wst_seq(jsonc_comments,
//                                                         key_rule,
//                                                         jsonc_comments,
//                                                         colon,
//                                                         jsonc_comments,
//                                                         value_rule,
//                                                         jsonc_comments
//                                                        )),
//                                           comma)),
//                                )),
//                 rbrc)));
// =================================================================================================
// END OF 'relaxed' JSONC GRAMMAR SECTION.
// =================================================================================================


// =================================================================================================
// WeightedPicker CLASS AND RELATED VARS:
// =================================================================================================
const always = () => true;
const never  = () => false;
const id     = x  => x;
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
  constructor(options = []) {
    // lm.log(`CONSTRUCT WITH ${inspect_fun(options)}`);
    
    this.options = []; // array of [weight, value]
    this.used_indices = new Map();
    this.last_pick_index = null;

    for (const [weight, value] of options)
      this.add(weight, value);
  }
  // -----------------------------------------------------------------------------------------------
  __clear_used_indices() {
    this.used_indices.clear();
    this.last_pick_index = null;

    if (log_picker_enabled)
      lm.log(`AFTER __clear: ${inspect_fun(this.used_indices)}`);
  }
  // -----------------------------------------------------------------------------------------------
  __effective_weight(option_index, priority) {
    if (! ((option_index || option_index === 0) && priority))
      throw new Error(`missing arg: ${inspect_fun(arguments)}`);
    
    let ret = null;
    
    if (priority === picker_priority.avoid_repetition_long ||
        priority === picker_priority.avoid_repetition_short) 
      ret = this.used_indices.has(option_index) ? 0 : this.options[option_index].weight;
    else if (priority === picker_priority.ensure_weighted_distribution) 
      ret = this.options[option_index].weight - (this.used_indices.get(option_index) ?? 0);
    else if (priority === picker_priority.true_randomness) 
      ret = this.options[option_index].weight;
    else
      throw Error("unexpected priority");
    
    if (log_picker_enabled)
      lm.log(`RET IS ${typeof ret} ${inspect_fun(ret)}`);
    
    return Math.max(0, ret);
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
  __indices_are_exhausted(option_indices, priority) {
    if (log_picker_enabled) {
      lm.log(`this.options      = ${compress(inspect_fun(this.options))}`);
      lm.log(`this.used_indices = ${compress(inspect_fun(this.used_indices))}`);
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
  __record_index_usage(index) {
    this.used_indices.set(index, (this.used_indices.get(index)??0) + 1);
    this.last_pick_index = index;
  }
  // -----------------------------------------------------------------------------------------------
  add(weight, value) {
    if (! value instanceof ASTAnonWildcardAlternative)
      throw new Error(`bad value: ${inspect_fun(value)}`);
    
    this.options.push({weight: weight, value: value });
  }
  // -----------------------------------------------------------------------------------------------
  split_options(allow_if, forbid_if) {
    const legal_option_indices = new Set(this.__gather_legal_option_indices(allow_if, forbid_if));
    const res = { illegal_options: [], legal_options: [] };

    for (const [index, value] of this.options.entries()) 
      (legal_option_indices.has(index) ? res.legal_options : res.illegal_options).push(value);

    return res;
  }
  // // -----------------------------------------------------------------------------------------------
  // illegal_options(allow_if, forbid_if) {
  //   const legal_option_indices = this.__gather_legal_option_indices(allow_if, forbid_if);

  //   return get_indices_from_arr(legal_option_indices,
  //                               this.optiions,
  //                               { invert: true });
  // }
  // // -----------------------------------------------------------------------------------------------
  // legal_options(allow_if, forbid_if) {
  //   const legal_option_indices = this.__gather_legal_option_indices(allow_if, forbid_if);

  //   return get_indices_from_arr(legal_option_indices,
  //                               this.optiions);
  // }
  // -----------------------------------------------------------------------------------------------
  pick(min_count = 1, max_count = min_count,
       allow_if = undefined, forbid_if = undefined, each = id,
       priority = null) {
    if (!(typeof min_count === 'number'   && 
          typeof max_count === 'number'   &&
          typeof allow_if  === 'function' &&
          typeof forbid_if === 'function' &&
          typeof each      === 'function' &&
          typeof priority  === 'string'))
      throw new Error(`bad pick arge: ${inspect_fun(arguments)}`);

    // if (! priority)
    //   throw new Error("no priority");

    if ((min_count > 1 || max_count > 1) && 
        priority === picker_priority.avoid_repetition_short)
      this.__clear_used_indices();
    
    if (log_picker_enabled)
      lm.log(`PICK ${min_count}-${max_count}`);
    
    const count = Math.floor(Math.random() * (max_count - min_count + 1)) + min_count;
    const res = [];
    
    for (let ix = 0; ix < count; ix++)
      res.push(each(this.#pick_one(allow_if, forbid_if, priority)));

    if (log_picker_enabled)
      lm.log(`PICKED ITEMS: ${inspect_fun(res)}`);

    return res;
  }
  // -----------------------------------------------------------------------------------------------
  #pick_one(allow_if, forbid_if, priority) {
    if (!(typeof allow_if  === 'function' &&
          typeof forbid_if === 'function' &&
          typeof priority  === 'string'))
      throw new Error(`bad #pick_one arge: ${inspect_fun(arguments)}`);
    
    if (log_picker_enabled) {
      lm.log(`PICK ONE =================================================================================`);
      lm.log(`PRIORITY        = ${inspect_fun(priority)}`);
      lm.log(`USED_INDICES    = ${inspect_fun(this.used_indices)}`);
      lm.log(`LAST_PICK_INDEX = ${inspect_fun(this.last_pick_index)}`);
    }
    
    if (! (priority && allow_if && forbid_if))
      throw new Error(`missing arg: ${inspect_fun(arguments)}`);

    if (log_picker_enabled) {
      lm.log(`PICK_ONE!`);
      lm.log(`PICK FROM ${inspect_fun(this)}`);
    }

    if (this.options.length === 0) {
      if (log_picker_enabled)
        lm.log(`PICK_ONE: NO OPTIONS 1!`);
      
      return null;
    }

    let legal_option_indices = this.__gather_legal_option_indices(allow_if, forbid_if);
    
    if (this.__indices_are_exhausted(legal_option_indices, priority)) {
      if (log_picker_enabled)
        lm.log(`PICK_ONE: CLEARING ${inspect_fun(this.used_indices)}!`);
      
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
        lm.log(`AFTER CLEARING: ${inspect_fun(this.used_indices)}`);
      
      legal_option_indices = this.__gather_legal_option_indices(allow_if, forbid_if);
    }
    
    if (legal_option_indices.length === 0) {
      if (log_picker_enabled)
        lm.log(`PICK_ONE: NO LEGAL OPTIONS 2!`);

      return null;
    }

    if (legal_option_indices.length === 1) {
      if (log_picker_enabled)
        lm.log(`only one legal option in ${inspect_fun(legal_option_indices)}!`);
      
      this.__record_index_usage(legal_option_indices[0]);

      if (log_picker_enabled)
        lm.log(`BEFORE BAIL 2: ${inspect_fun(this.used_indices)}`);
      
      return this.options[legal_option_indices[0]].value;
    }

    if (log_picker_enabled)
      lm.log(`pick from ${legal_option_indices.length} legal options ` +
             `${inspect_fun(legal_option_indices)}`);

    let total_weight = 0;

    if (log_picker_enabled)
      lm.log(`BEFORE TOTAL_WEIGHT, ${priority}: ${inspect_fun(this.used_indices)}`);
    
    for (const legal_option_ix of legal_option_indices) {
      const adjusted_weight = this.__effective_weight(legal_option_ix, priority);

      if (log_picker_enabled) {
        lm.log(`effective weight of option #${legal_option_ix} = ${adjusted_weight}`);
        lm.log(`COUNTING ${compress(inspect_fun(this.options[legal_option_ix]))} = ` +
               `${adjusted_weight}`);
        lm.log(`ADJUSTED BY ${adjusted_weight}, ${priority}`);
      }
      
      total_weight += adjusted_weight;
    }

    // Since we now avoid adding options with a weight of 0, this should never be true:
    if (total_weight === 0) {
      throw new Error(`PICK_ONE: TOTAL WEIGHT === 0, this should not happen? ` +
                      `legal_options = ${inspect_fun(legal_option_indices.map(ix =>
                          [
                            ix,
                            this.__effective_weight(ix, priority),
                            this.options[ix]
                          ]
                        ))}, ` +
                      `used_indices = ${inspect_fun(this.used_indices)}`);
    }
    
    let random = Math.random() * total_weight;

    if (log_picker_enabled) {
      lm.log(`----------------------------------------------------------------------------------`);
      lm.log(`RANDOM IS ${random}`);
      lm.log(`TOTAL_WEIGHT IS ${total_weight}`);
      lm.log(`USED_INDICES ARE ${inspect_fun(this.used_indices)}`);
    }
    
    for (const legal_option_ix of legal_option_indices) {
      const option          = this.options[legal_option_ix];
      const adjusted_weight = this.__effective_weight(legal_option_ix, priority);

      if (adjusted_weight === 0)
        continue;
      
      if (log_picker_enabled)
        lm.log(`ADJUSTED_WEIGHT OF ${inspect_fun(option)} IS ${adjusted_weight}`);
      
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
const arr_is_prefix_of_arr = (() => {
  const PREFIX_WILDCARD_NOT_SUPPLIED = Symbol('prefix-wildcard-not-supplied-p');

  return function(prefix_arr, full_arr, prefix_wildcard_value = PREFIX_WILDCARD_NOT_SUPPLIED) {
    if (prefix_arr.length > full_arr.length)
      return false;

    for (let ix = 0; ix < prefix_arr.length; ix++) {
      if (prefix_wildcard_value !== PREFIX_WILDCARD_NOT_SUPPLIED &&
          prefix_arr[ix] === prefix_wildcard_value)
        continue;

      if (prefix_arr[ix] !== full_arr[ix])
        return false;
    }

    return true;
  };
})();
// -------------------------------------------------------------------------------------------------
function benchmark(thunk, {
  batch_count    = 50,
  reps_per_batch = 10000,
  print_div      = 10,
  quiet          = true,
} = {}) {
  let running_avg  = 0;
  let result       = null;
  let start_mem    = -Infinity; // placeholder value, don't worry.
  const start_time = performance.now();

  const fn = () => measure_time(() => {
    for (let ix = 0; ix < reps_per_batch; ix++)
      result = thunk();
  });
  
  for (let oix = 0; oix < batch_count; oix++) {
    // lm.log(`oix: ${oix}`);
    
    global.gc(); // triggers GC
    start_mem  = process.memoryUsage().heapUsed;
    
    const time = fn();

    running_avg = (((running_avg * oix) + time) / (oix + 1));

    if (quiet) {
      process.stdout.write('.');
      if (((oix + 1) % 100) == 0)
        process.stdout.write('\n');
    }
    else if (((oix + 1) % print_div) == 0) {
      process.stdout.write('\n');
      lm.log('');
      lm.log(`${ordinal_string(oix + 1)} batch of ` +
             `${format_pretty_number(reps_per_batch)} ` +
             `(out of ${format_pretty_number(batch_count)}): `);
      lm.log(`result:                 ${rjson_stringify(result)}`);
      lm.log(`mem at start:           ${format_pretty_bytes(start_mem)}`);
      const now = process.memoryUsage().heapUsed;
      lm.log(`mem now:                ${format_pretty_bytes(now)}`);
      lm.log(`mem diff:               ${format_pretty_bytes(now - start_mem)}`);
      lm.log(`time/batch              ${format_pretty_number(time.toFixed(3))} ms`);
      lm.log(`time/each (est):        ${(time/reps_per_batch).toFixed(3)} ms`);
      lm.log(`total runtime:          ` +
             `${((performance.now() - start_time)/1000).toFixed(2)} ` +
             `seconds`);
      lm.log(`rounded avg ms/batch:   ${Math.round(running_avg)} ms`);
      lm.log(`est. runs/second:       ${Math.round(runs_per_second_est)}`);
      lm.log(`EST. TIME PER MILLION:  ` +
             `${format_pretty_number(Math.round((1_000_000 / reps_per_batch) * running_avg))} ms`);
      process.stdout.write('\n');
    }
  }
  
  lm.log('');
  lm.log(`batch_count:            ${batch_count}`);
  lm.log(`reps_per_batch:         ${format_pretty_number(reps_per_batch)}`);
  lm.log(`total reps:             ${format_pretty_number(batch_count * reps_per_batch)}`);
  lm.log(`last result:            ${rjson_stringify(result)}`);
  const now = process.memoryUsage().heapUsed;
  lm.log(`final mem diff:         ${format_pretty_bytes(now - start_mem)}`);
  lm.log(`total runtime:          ` +
         `${((performance.now() - start_time)/1000).toFixed(2)} ` +
         `seconds`);
  lm.log(`rounded avg time/batch: ${format_pretty_number(Math.round(running_avg))} ms`);
  const single_run_est = running_avg / reps_per_batch;
  const runs_per_second_est = 1_000_000 / running_avg;
  lm.log(`est. runs/second:       ` +
         `${format_pretty_number(Math.round(runs_per_second_est))}`);
  lm.log(`EST. TIME PER MILLION:  ` +
         `${format_pretty_number(Math.round((1_000_000 / reps_per_batch) * running_avg))} ` +
         `ms`);
  lm.log('');
  return running_avg;
}
// -------------------------------------------------------------------------------------------------
function capitalize(str) {
  // lm.log(`Capitalizing ${typeof str} ${inspect_fun(str)}`);
  if (str === '')
    return str;
  
  return str.charAt(0).toUpperCase() + str.slice(1);
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
function count_occurrences(arr) {
  const counts = new Map();

  for (const item of arr) 
    counts.set(item, (counts.get(item) || 0) + 1);

  return counts;
}
// -------------------------------------------------------------------------------------------------
function format_pretty_bytes(bytes) {
  const units = ['bytes', 'KB', 'MB', 'GB'];
  const base = 1024;
  const sign = Math.sign(bytes);
  let   abs_bytes = Math.abs(bytes);

  let i = 0;
  while (abs_bytes >= base && i < units.length - 1) {
    abs_bytes /= base;
    i++;
  }

  const value = abs_bytes.toFixed(2).replace(/\.?0+$/, '');
  return `${sign < 0 ? '-' : ''}${value} ${units[i]}`;
}
// -------------------------------------------------------------------------------------------------
function format_pretty_list(arr) {
  const items = arr.map(String); // Convert everything to strings like "null" and 7 → "7"

  if (items.length === 0)
    return '';
  if (items.length === 1)
    return items[0];
  if (items.length === 2)
    return `${items[0]} and ${items[1]}`;

  const ret = `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
  
  return ret;
}
// ------------------------------------------------------------------------------------------------
function format_pretty_number(num) {
  const [intPart, fracPart] = num.toString().split(".");
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fracPart ? `${withCommas}.${fracPart}` : withCommas;
}
// -------------------------------------------------------------------------------------------------
function format_simple_time(date = new Date()) {
  return date.toLocaleTimeString('en-US', {
    hour:   'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
}
// -------------------------------------------------------------------------------------------------
// function get_indices_from_arr(indices, arr, { invert = true } = {}) {
//   return indices.map(i => arr[i]);
// }
function get_indices_from_arr(indices, arr, { invert = false } = {}) {
  if (invert) {
    const index_set = new Set(indices);
    return arr.filter((_, i) => !index_set.has(i));
  } else {
    return indices.map(i => arr[i]);
  }
}
// -------------------------------------------------------------------------------------------------
function indent_lines(indent, str, indent_str = "| ") {
  if (typeof str !== 'string')
    throw new Error(`not a string: ${inspect.fun(str)}`);
  
  const indent_string = indent_str.repeat(indent);
  const indented_str  = str
        .split("\n")
        .map(line => `${indent_string}${line}`)
        .join("\n");

  return indented_str;
}
// -------------------------------------------------------------------------------------------------
function intercalate(separator, array, { final_separator = null } = {}) {
  if (log_intercalate_enabled)
    lm.log(`INTERCALATE ARGS: ${compress(inspect_fun(arguments))}`);

  if (array.length === 0) return [];

  const result = [array[0]];

  for (let ix = 1; ix < array.length; ix++) {
    const sep = (final_separator && ix === array.length - 1)
          ? final_separator
          : separator;
    result.push(sep, array[ix]);
  }

  if (log_intercalate_enabled)
    lm.log(`INTERCALATED: ${compress(inspect_fun(result))}`);
  
  return result;
}
// -------------------------------------------------------------------------------------------------
function is_empty_object(obj) {
  return obj && typeof obj === 'object' &&
    Object.keys(obj).length === 0 &&
    obj.constructor === Object;
}
// -------------------------------------------------------------------------------------------------
function is_primitive(val) {
  return val === null ||
    (typeof val !== 'object' && typeof val !== 'function');
}
// -------------------------------------------------------------------------------------------------
function is_plain_object(value) {
  return (
    typeof value === 'object' &&
      value !== null &&
      Object.getPrototypeOf(value) === Object.prototype
  );
}
// -------------------------------------------------------------------------------------------------
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,     // deletion
        dp[i][j - 1] + 1,     // insertion
        dp[i - 1][j - 1] + cost  // substitution
      );
    }
  }

  // lm.log(`Levenshtein distance between '${a}' and '${b}':`);
  // lm.log(`${inspect_fun(dp)}.`);

  return dp[m][n];
}
// -------------------------------------------------------------------------------------------------
function measure_time(fun) {
  const now = dt_hosted
        ? Date.now
        : performance.now.bind(performance);

  const start = now();
  fun();
  const end = now();

  return end - start;
}
// -------------------------------------------------------------------------------------------------
function rand_int(x, y) {
  y ||= x;
  const min = Math.min(x, y);
  const max = Math.max(x, y);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
// -------------------------------------------------------------------------------------------------
function raw(strings, ...values) {
  return String.raw(strings, ...values);
}
// -------------------------------------------------------------------------------------------------
function RegExp_raw(strings, ...values) {
  const raw_source = raw(strings, ...values);
  return new RegExp(raw_source);
}
// -------------------------------------------------------------------------------------------------
function rjson_stringify(obj) {
  if (obj === undefined)
    return 'undefined';
  
  return JSON.stringify(obj)
    .replace(/"(\w+)"\s*:/g, ' $1: ')
    .replace(/{ /g, '{')
    .replace(/},{/g, '}, {');
}
// -------------------------------------------------------------------------------------------------
let smart_join_trap_counter  = 0;
let smart_join_trap_target;
// smart_join_trap_target = 5;
// ------------------------------------------------------------------------------------------------
function smart_join(arr, { correct_articles = undefined } = {}) {
  if (!Array.isArray(arr) ||
      typeof correct_articles !== 'boolean')
    throw new Error(`bad smart_join args: ${inspect_fun(arguments)}`);

  if (log_level__smart_join >= 1 || log_level__expand_and_walk >= 1)
    lm.log(`smart_joining ${thing_str_repr(arr, { length: Infinity})} ` +
           `(#${smart_join_trap_counter})`);

  const maybe_trap = () => {
    if (++smart_join_trap_counter === smart_join_trap_target)
      throw new Error(`SMART_JOIN TRAPPED`);
  };

  maybe_trap();
  
  arr = arr.flat(Infinity).filter(x => x);

  if (arr.length === 0) 
    return '';
  else if (arr.length === 1)
    return arr[0];

  let   str                                 = arr[0];
  let   left_word                           = str;  
  let   ix                                  = 1;
  const linking_chars                       = "_-";      
  const left_collapsible_punctuation_chars  = "_-,.;!?";
  const right_collapsible_punctuation_chars = "_-,.;!?:])";
  const prev_char                           = () => left_word[left_word.length - 1] ?? "";
  const next_char                           = () => right_word()[next_char_is_escaped() ? 1 : 0] ?? '';
  const prev_char_is_escaped                = () => left_word[left_word.length - 2] === '\\';
  const next_char_is_escaped                = () => right_word()[0] === '\\';
  const right_word                          = () => arr[ix];

  const add_a_space = () => {
    if (log_level__smart_join >= 2)
      lm.log(`SPACE!`);

    // prev_char  = ' ';
    str       += ' ';
  };

  const chomp_left_side = () => {
    if (log_level__smart_join >= 2)
      lm.log(`CHOMP LEFT!`);
    
    str       = str.slice(0, -1);
    left_word = left_word.slice(0, -1);

    log_pos_vars();
  };

  const collapse_chars_leftwards = n => {
    if (log_level__smart_join >= 2)
      lm.log(`SHIFT ${n} CHARACTERS!`, true);

    const overcut_length = str.endsWith('\\...') ? 0 : str.endsWith('...') ? 3 : 1; 
    const shifted_str    = right_word().substring(0, n);

    arr[ix]   = right_word().substring(n);
    str       = str.substring(0, str.length - overcut_length) + shifted_str;
    left_word = left_word.substring(0, left_word.length - overcut_length) + shifted_str;

    log_pos_vars();
  };

  const collapse_punctuation = () => {
    while (left_collapsible_punctuation_chars.includes(prev_char()) &&
           // !prev_char_is_escaped() &&
           right_word().startsWith('...'))
      collapse_chars_leftwards(3);

    const test = () =>
          prev_char() !== '' &&
          (!prev_char_is_escaped() &&
           left_collapsible_punctuation_chars.includes(prev_char())) &&
          next_char() !== '' &&
          right_collapsible_punctuation_chars.includes(next_char());

    if (test()) 
      do {
        if (log_level__expand_and_walk >= 2)
          lm.log(`collapsing ${inspect_fun(prev_char())} <= ${inspect_fun(next_char())}`);
        collapse_chars_leftwards(1);
      } while (test());
    else if (log_level__expand_and_walk >= 2)
      lm.log(`not collapsing`);
  };
  
  const log_pos_vars = () => {
    if (log_level__smart_join >= 2)
      lm.log(`ix = ${inspect_fun(ix)}, \n` +
             `str = ${inspect_fun(str)}, \n` +
             `left_word = ${inspect_fun(left_word)}, ` +         
             `right_word = ${inspect_fun(right_word())}, \n` + 
             `prev_char = ${inspect_fun(prev_char())}, ` +         
             `next_char = ${inspect_fun(next_char())}, \n` + 
             `PCIE = ${prev_char_is_escaped()}. ` + 
             `NCIE = ${next_char_is_escaped()}`, true)
  };

  const maybe_correct_articles = () => {
    // correct article if needed:
    if (correct_articles) {
      const article_match = left_word.match(/^([Aa]n?)$/);
      
      if (article_match) {
        const original_article = article_match[1];
        const chose            = choose_indefinite_article(right_word());
        const lower_original   = original_article.toLowerCase();
        let   updated_article; 

        if ((lower_original === 'a' || lower_original === 'an') && lower_original !== chose)
          updated_article = original_article[0] === original_article[0].toUpperCase()
          ? chose[0].toUpperCase() + chose.slice(1)
          : chose;
        else 
          updated_article = original_article;

        if (updated_article !== original_article) 
          str = str.slice(0, -original_article.length) + updated_article;
      }
    }
  };
  
  const shift_ltris_leftwards = () => {
    const test = () => !next_char_is_escaped() && next_char() === '<';
    
    if (test()) {
      left_word += '<';
      str += '<';
      do {
        arr[ix] = arr[ix].slice(1);
        log_pos_vars();
      } while (test());
    }
  }

  const maybe_chomp_left_side_ltris = () =>  {
    let chomped = false;
    while (!prev_char_is_escaped() && prev_char() === '<') {
      chomp_left_side();
      chomped = true;
    }
    return chomped;
  };
  
  for (; ix < arr.length; ix++) {
    log_pos_vars();
    maybe_correct_articles();
    shift_ltris_leftwards();

    if (!right_word())
      continue;

    const chomped = maybe_chomp_left_side_ltris();

    collapse_punctuation();
    
    if (!right_word())
      continue;

    if (prev_char                                                   &&
        !chomped                                                    &&
        !'\n '                               .includes(prev_char()) && // might remove this one..
        !'\n '                               .includes(next_char()) && // and this one.
        !right_collapsible_punctuation_chars .includes(next_char()) && 
        !linking_chars                       .includes(prev_char()) &&
        !linking_chars                       .includes(next_char()) &&
        !'(['                                .includes(prev_char()))
      add_a_space();

    if (log_level__smart_join >= 2)
      lm.log(`CONSUME ${inspect_fun(right_word())}!`);

    str += left_word = right_word();
  }
  
  if (log_level__smart_join >= 1)
    lm.log(`smart_joined  ${thing_str_repr(str, { length: Infinity})} ` +
           `(#${smart_join_trap_counter})`);

  return str;
}
// -------------------------------------------------------------------------------------------------
function smart_join_merge(arr, { correct_articles = true } = {}) {
  const result = [];
  let buffer = [];

  for (const item of arr) {
    if (typeof item === 'string') {
      buffer.push(item);
    } else {
      if (buffer.length) {
        result.push(smart_join(buffer, { correct_articles: correct_articles }));
        buffer = [];
      }
      result.push(item);
    }
  }

  if (buffer.length) {
    result.push(smart_join(buffer, { correct_articles: correct_articles }));
  }

  return result;
}
// -------------------------------------------------------------------------------------------------
function stop() {
  new Error(`STOP`);
}
// -------------------------------------------------------------------------------------------------
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

    lm.log(`test #1 succesfully cloned object ${inspect_fun(obj)}`);
  }
  // test #2: break shared references (unshare), this one seems to work:
  {
    const clone = structured_clone(obj, { unshare: true });

    if (clone.a === clone.b)
      throw new Error(`${inspect_fun(clone.a)} === ${inspect_fun(clone.b)}`);

    lm.log(`test #2 succesfully cloned object ${inspect_fun(obj)}`);
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
      lm.log(`test #3 failed as intended.`);
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
      lm.log(`test #3 failed as intended.`);
  }
}
// -------------------------------------------------------------------------------------------------
function suggest_closest(name, candidates) {
  let closest = null;
  let closest_distance = Infinity;

  for (const cand of candidates) {
    const dist = levenshtein(name, cand);
    if (dist < closest_distance) {
      closest = cand;
      closest_distance = dist;
    }
  }

  // If it's reasonably close (adjust threshold as needed)
  return (closest && closest_distance <= 2)
    ? ` Did you mean '${closest}'?`
    : '';
}
// -------------------------------------------------------------------------------------------------
function thing_str_repr(thing, { length = thing_str_repr.abbrev_length,
                                 always_include_type_str = false } = {}) {
  // lm.log(`length: ${inspect_fun(length)}`);

  // if (length === 100)
  //   throw new Error("stop");
  
  let type_str =
      typeof thing === 'object'
      ? (thing === null
         ? 'null '
         : `${thing.constructor.name} ` ?? 'Object ')
      : `${typeof thing} `;

  if (type_str === '')
    throw new Error("wtf");
  
  let thing_str;

  if (thing instanceof ASTNode) {
    thing_str = thing.toString();
    if (! always_include_type_str)
      type_str  = '';
  }
  else if (Array.isArray(thing)) {
    thing_str =
      abbreviate(compress(thing.map(x => thing_str_repr(x, { length: length })).toString()),
                 true, length);
  }
  else if (typeof thing === 'string') {
    return thing.length === 0
      ? `ε`
      : inspect_fun(thing, true);
  }
  else if (typeof thing === 'object') {
    try {
      thing_str = abbreviate(compress(inspect_fun(thing)), true, length);
    } catch {
      thing_str = thing.toString(); // fallback
    }
  }
  else {
    thing_str = String(thing);
  }

  const compressed_thing_str = compress(thing_str);
  const str_tail = abbreviate(compressed_thing_str, true, length);
  const str = `${type_str}${str_tail}`; 
  return str;
}
thing_str_repr.abbrev_length = 100;
// -------------------------------------------------------------------------------------------------
function unescape(str) {
  if (typeof str !== 'string')
    return str;
  
  return str
    .replace(/\\n/g,   '\n')
    .replace(/\\ /g,   ' ')
    .replace(/\\(.)/g, '$1')
}
// -------------------------------------------------------------------------------------------------
function warning_str(str) {
  return `\\<WARNING: ${str}!>`;
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
// -------------------------------------------------------------------------------------------------
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
  { dt_name: 'controls',                          automatic1111_name: 'controls',
    expected_type: 'object' },
  { dt_name: 'fps',                               automatic1111_name: 'fps',
    expected_type: 'number' },
  { dt_name: 'loras',                             automatic1111_name: 'loras',
    expected_type: 'object' },
  { dt_name: 'model',                             automatic1111_name: 'model',
    expected_type: 'string' },
  { dt_name: 'prompt',                            automatic1111_name: 'prompt',
    expected_type: 'string' },
  { dt_name: 'sampler',                           automatic1111_name: 'sampler',
    expected_type: [ 'string', 'number' ],
    shorthands: ['sampler_index', 'sampler_name', ] },
  { dt_name: 'seed',                              automatic1111_name: 'seed',
    expected_type: 'number' },
  { dt_name: 'sharpness',                         automatic1111_name: 'sharpness',
    expected_type: 'number' },
  { dt_name: 'shift',                             automatic1111_name: 'shift',
    expected_type: 'number' },
  { dt_name: 'strength',                          automatic1111_name: 'strength',
    expected_type: 'number' },
  { dt_name: 'steps',                             automatic1111_name: 'steps',
    expected_type: 'number' },
  { dt_name: 'upscaler',                          automatic1111_name: 'upscaler',
    expected_type: 'string' },
  { dt_name: 'height',                            automatic1111_name: 'height',
    shorthands: [ 'h', 'ih', ],
    expected_type: 'number', },
  { dt_name: 'width',                             automatic1111_name: 'width',
    shorthands: [ 'w', 'iw', ],
    expected_type: 'number', },
  { dt_name: 'negativeOriginalImageHeight',       automatic1111_name: 'negative_original_height',
    shorthands: [ 'noih', 'noh', 'nih', 'nh', 'negativeOriginalHeight', 'negativeImageHeight', ],
    expected_type: 'number', },
  { dt_name: 'negativeOriginalImageWidth',        automatic1111_name: 'negative_original_width',
    shorthands: [ 'noiw', 'now', 'niw', 'nw', 'negativeOriginalWidth', 'negativeImageWidth',  ],
    expected_type: 'number', },
  { dt_name: 'originalImageHeight',               automatic1111_name: 'original_height',
    shorthands: [ 'oih', 'oh', 'originalHeight', ],
    expected_type: 'number', },
  { dt_name: 'originalImageWidth',                automatic1111_name: 'original_width',
    shorthands: [ 'oiw', 'ow', 'originalWidth'   ],
    expected_type: 'number', },
  { dt_name: 'targetImageHeight',                 automatic1111_name: 'target_height',
    shorthands: [ 'tih', 'th', 'targetHeight', ],
    expected_type: 'number', },
  { dt_name: 'targetImageWidth',                  automatic1111_name: 'target_width',
    shorthands: [ 'tiw', 'tw', 'targetWidth',  ],
    expected_type: 'number', },
  // -----------------------------------------------------------------------------------------------
  // differing keys:
  // -----------------------------------------------------------------------------------------------
  { dt_name: 'aestheticScore',                    automatic1111_name: 'aesthetic_score',
    expected_type: 'number', },
  // { dt_name: 'batchCount',                        automatic1111_name: 'batch_count',
  //   expected_type: 'number', },
  { dt_name: 'batchCount',                        automatic1111_name: 'n_iter',
    expected_type: 'number',
    shorthands: [ 'batch_count' ], },
  { dt_name: 'batchSize',                         automatic1111_name: 'batch_size',
    expected_type: 'number', },
  { dt_name: 'clipLText',                         automatic1111_name: 'clip_l_text',
    expected_type: 'string',
    shorthands: [ 'clip_l', 'clipl' ], },
  { dt_name: 'clipSkip',                          automatic1111_name: 'clip_skip',
    expected_type: 'number' },
  { dt_name: 'clipWeight',                        automatic1111_name: 'clip_weight',
    expected_type: 'number', },
  { dt_name: 'cropLeft',                          automatic1111_name: 'crop_left',
    expected_type: 'number', },
  { dt_name: 'cropTop',                           automatic1111_name: 'crop_top',
    expected_type: 'number', },
  { dt_name: 'decodingTileHeight',                automatic1111_name: 'decoding_tile_height',
    expected_type: 'number', },
  { dt_name: 'decodingTileOverlap',               automatic1111_name: 'decoding_tile_overlap',
    expected_type: 'number', },
  { dt_name: 'decodingTileWidth',                 automatic1111_name: 'decoding_tile_width',
    expected_type: 'number', },
  { dt_name: 'diffusionTileHeight',               automatic1111_name: 'diffusion_tile_height',
    expected_type: 'number', },
  { dt_name: 'diffusionTileOverlap',              automatic1111_name: 'diffusion_tile_overlap',
    expected_type: 'number', },
  { dt_name: 'diffusionTileWidth',                automatic1111_name: 'diffusion_tile_width',
    expected_type: 'number', },
  { dt_name: 'guidanceEmbed',                     automatic1111_name: 'guidance_embed', },
  { dt_name: 'guidanceScale',                     automatic1111_name: 'cfg_scale',
    expected_type: 'number',
    shorthands: [ 'guidance', ], },
  { dt_name: 'guidingFrameNoise',                 automatic1111_name: 'cond_aug',
    expected_type: 'number' },
  { dt_name: 'hiresFix',                          automatic1111_name: 'high_resolution_fix',
    expected_type: 'boolean',
    shorthands: [ 'enable_hr', 'hrf' ], },
  { dt_name: 'hiresFixHeight',                    automatic1111_name: 'hires_first_pass_height',
    expected_type: 'number',
    shorthands: [ 'firstphase_height', 'hrfh', ], },
  { dt_name: 'hiresFixStrength',                  automatic1111_name: 'hires_second_pass_strength_detail',
    expected_type: 'number',
    shorthands: [ 'hrf_strength', ] },
  { dt_name: 'hiresFixWidth',                     automatic1111_name: 'hires_first_pass_width',
    expected_type: 'number',
    shorthands: [ 'firstphase_width', 'hrfw', ], },
  { dt_name: 'imageGuidanceScale',                automatic1111_name: 'image_guidance',
    expected_type: 'number', },
  { dt_name: 'imagePriorSteps',                   automatic1111_name: 'image_prior_steps',
    expected_type: 'number', },
  { dt_name: 'maskBlur',                          automatic1111_name: 'mask_blur',
    expected_type: 'number', },
  { dt_name: 'maskBlurOutset',                    automatic1111_name: 'mask_blur_outset',
    expected_type: 'number', },
  { dt_name: 'motionScale',                       automatic1111_name: 'motion_scale',
    expected_type: 'number', },
  { dt_name: 'negativeAestheticScore',            automatic1111_name: 'negative_aesthetic_score',
    expected_type: 'number', },
  { dt_name: 'negativePrompt',                    automatic1111_name: 'negative_prompt',
    expected_type: 'string',
    shorthands: ['neg', 'negative' ], },
  { dt_name: 'negativePromptForImagePrior',       automatic1111_name: 'negative_prompt_for_image_prior',
    expected_type: 'boolean', }, 
  { dt_name: 'numFrames',                         automatic1111_name: 'num_frames',
    expected_type: 'number', },
  { dt_name: 'openClipGText',                     automatic1111_name: 'open_clip_g_text',
    expected_type: 'string',
    shorthands: ['clipgtext', 'clip_g_text', 'clip_g', 'clipg', ] },
  { dt_name: 'preserveOriginalAfterInpaint',      automatic1111_name: 'preserve_original_after_inpaint',
    expected_type: 'boolean', },
  { dt_name: 'refinerModel',                      automatic1111_name: 'refiner_model',
    expected_type: 'string', },
  { dt_name: 'refinerStart',                      automatic1111_name: 'refiner_start',
    expected_type: 'number', },
  { dt_name: 'resolutionDependentShift',          automatic1111_name: 'resolution_dependent_shift',
    expected_type: 'boolean', },
  { dt_name: 'seedMode',                          automatic1111_name: 'seed_mode',
    expected_type: 'number', }, 
  { dt_name: 'separateClipL',                     automatic1111_name: 'separate_clip_l',
    expected_type: 'boolean', 
    shorthands: [ 'separate_clipl', ] },  
  { dt_name: 'separateOpenClipG',                 automatic1111_name: 'separate_open_clip_g',
    expected_type: 'boolean',
    shorthands: [ 'separate_clipg', 'separate_clip_g', ] },
  { dt_name: 'separateT5',                        automatic1111_name: 'separate_t5',
    expected_type: 'boolean', },
  { dt_name: 'speedUpWithGuidanceEmbedParameter', automatic1111_name: 'speed_up_with_guidance_embed',
    expected_type: 'boolean', },
  { dt_name: 'stage2Cfg',                         automatic1111_name: 'stage_2_cfg',
    expected_type: 'number', },
  { dt_name: 'stage2Shift',                       automatic1111_name: 'stage_2_shift',
    expected_type: 'number', },
  { dt_name: 'stage2Steps',                       automatic1111_name: 'stage_2_steps',
    expected_type: 'number', },
  { dt_name: 'startFrameGuidance',                automatic1111_name: 'start_frame_guidance',
    expected_type: 'number', },
  { dt_name: 'stochasticSamplingGamma',           automatic1111_name: 'strategic_stochastic_sampling',
    expected_type: 'number', },
  { dt_name: 'strength',                          automatic1111_name: 'denoising_strength',
    expected_type: 'number', },
  { dt_name: 't5Text',                            automatic1111_name: 't5_text',
    expected_type: 'string',
    shorthands: [ 't5' ], },
  { dt_name: 't5TextEncoder',                     automatic1111_name: 't5_text_encoder',
    expected_type: 'boolean', },
  { dt_name: 'teaCache',                          automatic1111_name: 'tea_cache',
    expected_type: 'boolean', },
  { dt_name: 'teaCacheEnd',                       automatic1111_name: 'tea_cache_end',
    expected_type: 'number', },
  { dt_name: 'teaCacheMaxSkipSteps',              automatic1111_name: 'tea_cache_max_skip_steps',
    expected_type: 'number', },
  { dt_name: 'teaCacheStart',                     automatic1111_name: 'tea_cache_start',
    expected_type: 'number', },
  { dt_name: 'teaCacheThreshold',                 automatic1111_name: 'tea_cache_threshold',
    expected_type: 'number', },
  { dt_name: 'tiledDecoding',                     automatic1111_name: 'tiled_decoding',
    expected_type: 'boolean', },
  { dt_name: 'tiledDiffusion',                    automatic1111_name: 'tiled_diffusion',
    expected_type: 'boolean', },
  { dt_name: 'upscalerScaleFactor',               automatic1111_name: 'upscaler_scale_factor',
    expected_type: 'number', },
  { dt_name: 'zeroNegativePrompt',                automatic1111_name: 'zero_negative_prompt',
    expected_type: 'boolean',
    shorthands: [ "znp" ] },
];
// -------------------------------------------------------------------------------------------------
function get_configuration_key_entry(preferred_needle_key, alternate_needle_key, needle_value) {
  if (log_name_lookups_enabled)
    lm.log(`\nLOOKING UP ${preferred_needle_key} FOR ` +
           `${inspect_fun(alternate_needle_key)} ` +
           `${inspect_fun(needle_value)}`);

  needle_value = needle_value.toLowerCase(); // normalize

  // -----------------------------------------------------------------------------------------------
  // is needle_value a shorthand?
  // -----------------------------------------------------------------------------------------------
  let entry = configuration_key_names.find(obj => 
    obj.shorthands?.includes(needle_value))

  if (entry) {
    if (log_name_lookups_enabled)
      lm.log(`RETURN FROM SHORTHAND ` +
             `${inspect_fun(entry)}\n`);

    return entry;
  }

  // -----------------------------------------------------------------------------------------------
  // is it just a miscapitalized preferred_needle_key?
  // -----------------------------------------------------------------------------------------------
  entry = configuration_key_names.find(obj => obj[preferred_needle_key].toLowerCase() === needle_value);

  if (entry) {
    if (log_name_lookups_enabled)
      lm.log(`RETURNING CASE-CORRECTED ${preferred_needle_key} ` +
             `${inspect_fun(entry[preferred_needle_key])}`);
    
    return entry;
  } 

  // -----------------------------------------------------------------------------------------------
  // look up the needle_key:
  // -----------------------------------------------------------------------------------------------
  entry = configuration_key_names.find(obj => obj[alternate_needle_key].toLowerCase() === needle_value);

  if (entry) {
    if (log_name_lookups_enabled)
      lm.log(`ENTRY ${preferred_needle_key} FOR ` +
             `${inspect_fun(alternate_needle_key)} ${inspect_fun(needle_value)}`);
    
    return entry;
  }

  // -----------------------------------------------------------------------------------------------
  // didn't find it on either side, return null.
  // -----------------------------------------------------------------------------------------------
  if (log_name_lookups_enabled) 
    lm.log(`RETURNING NULL FROM LOOKUP FOR ` +
           `${inspect_fun(needle_value)}\n`);

  // possibly an error? maybe not always.
  return null;
}
// -------------------------------------------------------------------------------------------------
function get_configuration_key_entry_prefer_dt_configuration_key_name(key_name) {
  return get_configuration_key_entry('dt_name', 'automatic1111_name', key_name);
}
// -------------------------------------------------------------------------------------------------
function get_configuration_key_entry_prefer_automatic1111_configuration_key_name(key_name) {
  return get_configuration_key_entry('automatic1111_name', 'dt_name', key_name);
}
// -------------------------------------------------------------------------------------------------
function get_our_configuration_key_entry(key_name) {
  return (dt_hosted
          ? get_configuration_key_entry_prefer_dt_configuration_key_name(key_name)
          : get_configuration_key_entry_prefer_automatic1111_configuration_key_name(key_name));
}
// // -------------------------------------------------------------------------------------------------
// function get_dt_configuration_key_name(key_name) {
//   const entry = get_configuration_key_entry_prefer_dt_configuration_key_name(key_name);
//   return entry ? entry['dt_name'] : key_name;
// }
// // -------------------------------------------------------------------------------------------------
// function get_automatic1111_configuration_key_name(key_name) {
//   const entry = get_configuration_key_entry_prefer_automatic1111_configuration_key_name(key_name);
//   return entry ? entry['automatic1111_name'] : key_name;
// }
// -------------------------------------------------------------------------------------------------
function get_our_configuration_key_name(key_name) {
  const entry = get_our_configuration_key_entry(key_name); 

  return (entry
          ? entry[dt_hosted ? 'dt_name' : 'automatic1111_name']
          : key_name);
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
  #configuration;
  #picker_allow_fun;
  #picker_forbid_fun;
  // -----------------------------------------------------------------------------------------------
  constructor({ 
    flags                        = [], 
    scalar_variables             = new Map(),
    named_wildcards              = new Map(),
    noisy                        = false,
    files                        = [], 
    configuration                = {}, 
    top_file                     = true,
    pick_one_priority            = picker_priority.ensure_weighted_distribution,
    pick_multiple_priority       = picker_priority.avoid_repetition_long,
    prior_pick_one_priority      = pick_one_priority,
    prior_pick_multiple_priority = pick_multiple_priority,
    negative_prompt              = null,
    in_lora                      = false,
  } = {}) {
    this.context_id                   = get_next_context_id();
    this.flags                        = flags;
    this.scalar_variables             = scalar_variables;
    this.named_wildcards              = named_wildcards;
    this.noisy                        = noisy;
    this.files                        = files;
    this.configuration                = configuration;
    this.top_file                     = top_file;
    this.pick_one_priority            = pick_one_priority;
    this.prior_pick_one_priority      = prior_pick_one_priority;
    this.pick_multiple_priority       = pick_multiple_priority;
    this.prior_pick_multiple_priority = prior_pick_multiple_priority;
    this.in_lora                      = in_lora;

    if (dt_hosted && !this.flag_is_set(["dt_hosted"]))
      this.set_flag(["dt_hosted"]);
  }
  // -----------------------------------------------------------------------------------------------
  get picker_allow_fun() {
    this.#picker_allow_fun ??=  option => {
      for (const check_flag of option.check_flags) {
        let found = false;
        
        for (const flag of check_flag.flags) 
          if (this.flag_is_set(flag)) {
            found = true;
            break;
          }
        
        if (!found)
          return false;
      }

      return true;
    };
    
    return this.#picker_allow_fun;
  }
  // -----------------------------------------------------------------------------------------------
  get picker_forbid_fun() {
    this.#picker_forbid_fun ??= option => {
      for (const not_flag of option.not_flags)
        if (this.flag_is_set(not_flag.flag))
          return true;
      return false;
    };

    return this.#picker_forbid_fun;
  }
  // -----------------------------------------------------------------------------------------------
  clone(obj = {}) {
    // lm.log(`CLONING CONTEXT ${inspect_fun(this)}`);
    
    const copy = new Context({
      flags:                        structured_clone(this.flags),
      scalar_variables:             new Map(this.scalar_variables), 
      named_wildcards:              new Map(this.named_wildcards),  // some sharing
      noisy:                        this.noisy,
      files:                        structured_clone(this.files),
      configuration:                this.configuration,  // constructer calls settar that copies for us automatically
      top_file:                     this.top_file,
      pick_one_priority:            this.pick_one_priority,
      prior_pick_one_priority:      this.prior_pick_one_priority,
      pick_multiple_priority:       this.pick_multiple_priority,
      prior_pick_multiple_priority: this.pick_multiple_priority,
    });

    if (this.configuration.loras && copy.configuration.loras &&
        this.configuration.loras === copy.configuration.loras)
      throw new Error("oh no");

    // lm.log(`CLONED CONTEXT`);
    
    Object.assign(copy, obj);

    return copy;
  }
  // -----------------------------------------------------------------------------------------------
  shallow_copy(obj = {}) {
    var copy = new Context({
      flags:                        this.flags,
      scalar_variables:             this.scalar_variables,
      named_wildcards:              this.named_wildcards,
      noisy:                        this.noisy,
      files:                        this.files,
      top_file:                     this.top_file,
      pick_one_priority:            this.pick_one_priority,
      prior_pick_one_priority:      this.prior_pick_one_priority,
      pick_multiple_priority:       this.pick_multiple_priority,
      prior_pick_multiple_priority: this.prior_pick_multiple_priority,      
      negative_prompt:              this.negative_prompt,
    });

    // avoid copying this by assigning to '#configuration' instead of using
    // configuration argument to constructor (which would use the 'set configuration' setter (which
    // would ccopy it)
    copy.#configuration = this.configuration;

    Object.assign(copy, obj);
    
    return copy;
  }
  // -----------------------------------------------------------------------------------------------
  get configuration() {
    return this.#configuration;
  }
  // -----------------------------------------------------------------------------------------------
  set configuration(config) {
    // lm.log(`CLONING CONFIGURATION!`);
    this.#configuration = structured_clone(config, { unshare: true });
  }
  // -----------------------------------------------------------------------------------------------
  add_lora_uniquely(lora, { indent = 0, replace = true } = {}) {
    this.configuration.loras ||= [];

    const index = this.configuration.loras.findIndex(existing => existing.file === lora.file);

    if (index !== -1) {
      if (! replace)
        return;
      
      this.configuration.loras.splice(index, 1); // Remove the existing entry
    }
    
    this.configuration.loras.push(lora);

    // if (log_configuration_enabled)
    //   log(`added LoRA ${compress(inspect_fun(lora))} to ${this}`);
  }
  // -------------------------------------------------------------------------------------------------
  flag_is_set(test_flag) {
    let res = false;
    
    for (const flag of this.flags) 
      if (arr_is_prefix_of_arr(test_flag, flag, '*')) {
        res = true;
        break;
      }

    return res;
  }
  // -----------------------------------------------------------------------------------------------
  set_flag(new_flag, replace_existing = true) {
    // skip already set flags:
    if (this.flags.some(existing_flag => arr_is_prefix_of_arr(new_flag, existing_flag))) {
      // if (log_flags_enabled)
      //   lm.log(`skipping, already set`);
      return;
    }
    
    if (log_flags_enabled) 
      lm.log(`adding ${compress(inspect_fun(new_flag))} to flags ` +
             `${abbreviate(compress(inspect_fun(this.flags)))}`);

    //if (replace_existing)
    {
      const new_flag_head = new_flag.slice(0, -1);

      this.flags = this.flags.filter(existing_flag => {
        if (arr_is_prefix_of_arr(existing_flag, new_flag)) {
          // if (log_flags_enabled)
          //   lm.log(`discard ${inspect_fun(existing_flag)} because it is a prefix of ` +
          //          `new flag ${compress(inspect_fun(new_flag))}`);
          return false;
        }

        if (replace_existing)
          if (new_flag_head.length != 0 &&
              arr_is_prefix_of_arr(new_flag_head, existing_flag)) {
            // if (log_flags_enabled)
            //   lm.log(`discard ${inspect_fun(existing_flag)} because it is a child of ` +
            //          `new flag's head ${compress(inspect_fun(new_flag_head))}`);
            return false; 
          }
        
        return true;
      });
    }

    this.flags.push(new_flag);
  }
  // -----------------------------------------------------------------------------------------------
  unset_flag(flag) {
    // if (log_flags_enabled)
    //   lm.log(`BEFORE UNSETTING ${inspect_fun(flag)}: ${inspect_fun(this.flags)}`);
    
    this.flags = this.flags.filter(f => ! arr_is_prefix_of_arr(flag, f));

    // if (log_flags_enabled)
    //   lm.log(`AFTER  UNSETTING ${inspect_fun(flag)}: ${inspect_fun(this.flags)}`);
  }
  // -----------------------------------------------------------------------------------------------
  reset_variables() {
    this.flags = [];
    this.scalar_variables = new Map();
    this.named_wildcards = new Map();
    
    for (const [name, nwc] of this.named_wildcards)
      if (nwc instanceof ASTLatchedNamedWildcard) {
        // lm.log(`unlatching @${name} ${abbreviate(nwc.original_value.toString())} during reset`);
        this.named_wildcards.set(name, nwc.original_value);
      } /* else {
           lm.log(`NOT unlatching @${name} ${abbreviate(nwc.toString())} during reset`);
           } */
  }
  // -------------------------------------------------------------------------------------------------
  munge_configuration() {
    const munged_configuration = structured_clone(this.configuration);

    if (is_empty_object(munged_configuration))
      return munged_configuration;

    if (munged_configuration.model === '') {
      lm.log(`WARNING: munged_configuration.model is an empty string, deleting key! This ` +
             `probably isn't what you meant to do, your prompt template may contain an error!`,
             log_level__expand_and_walk);
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
        munged_configuration.model = `${munged_configuration.model}_f16.ckpt`;
    }
    
    if (munged_configuration.sampler === '') {
      lm.log(`WARNING: munged_configuration.sampler is an empty string, deleting key! This ` +
             `probably isn't what you meant to do, your prompt template may contain an error!`,
             log_level__expand_and_walk);
      delete munged_configuration.sampler;
    }
    // I always mistype 'Euler a' as 'Euler A', so lets fix dumb errors like that:
    else if (munged_configuration.sampler &&
             typeof munged_configuration.sampler === 'string') {
      const lc  = munged_configuration.sampler.toLowerCase();
      const got = dt_samplers_caps_correction.get(lc);

      if (got)
        munged_configuration.sampler = got;
      else
        lm.log(`WARNING: did not find sampler ` +
               `'${munged_configuration.sampler}', ` +
               `we're probably going to crash in a moment`);
    }

    // when running in DT, sampler needs to be an index:
    if (dt_hosted && typeof munged_configuration.sampler === 'string') { 
      lm.log(`correcting munged_configuration.sampler = ` +
             `${inspect_fun(munged_configuration.sampler)} to ` +
             `munged_configuration.sampler = ` +
             `${dt_samplers.indexOf(munged_configuration.sampler)}.`,
             log_level__expand_and_walk);

      const index = dt_samplers.indexOf(munged_configuration.sampler);

      if (index === -1) {
        lm.log(`WARNING: could not find index of sampler ` +
               `'${munged_configuration.sampler}'. `+
               `Are you sure you used the correct name? ` +
               `deleting sampler from configuration`);

        delete munged_configuration.sampler;
      }
      else {
        munged_configuration.sampler = index;
      }
    }
    // when running in Node.js, sampler needs to be a string:
    else if (!dt_hosted && typeof munged_configuration.sampler === 'number') {
      lm.log(`correcting munged_configuration.sampler = ` +
             `${munged_configuration.sampler} to ` +
             `munged_configuration.sampler = ` +
             `${inspect_fun(dt_samplers[munged_configuration.sampler])}.`,
             log_level__expand_and_walk);
      munged_configuration.sampler = dt_samplers[munged_configuration.sampler];
    }

    // 'fix' seed if n_iter > 1, doing this seems convenient?
    const n_iter_key = get_our_configuration_key_name('n_iter');
    const n_iter_val = munged_configuration[n_iter_key];

    if (n_iter_val > 1 && munged_configuration.seed !== -1) {
      if (log_configuration_enabled)
        lm.log(`%seed = -1 due to n_iter > 1`,
               log_level__expand_and_walk);

      munged_configuration.seed = -1;
    }
    else if (typeof munged_configuration.seed !== 'number') {
      const random = Math.floor(Math.random() * (2 ** 32));
      
      if (log_configuration_enabled)
        lm.log(`%seed = ${random} due to no seed`,
               log_level__expand_and_walk);

      munged_configuration.seed = random;
    }    

    // if (log_configuration_enabled)
    //   lm.log(`MUNGED CONFIGURATION IS: ${inspect_fun(munged_configuration)}`);

    this.configuration = munged_configuration;
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
const prelude_text = `
@__set_gender_if_unset  = {  ?female           #gender.female 
                          |  ?male             #gender.male
                          |  ?neuter           #gender.neuter 
                          |3 !gender.#female   #female
                          |2 !gender.#male     #male
                          |1 !gender.#neuter   #neuter }
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

@digit                  = {\\0|\\1|\\2|\\3|\\4
                          |\\5|\\6|\\7|\\8|\\9}
@low_digit              = {\\0|\\1|\\2|\\3|\\4}
@high_digit             = {\\5|\\6|\\7|\\8|\\9}

@low_random_weight      = {0.< @low_digit  }
@lt1_random_weight      = {0.< @digit      } 
@lowish_random_weight   = {0.< @high_digit }
@random_weight          = {1.< @digit      }
@highish_random_weight  = {1.< @low_digit  }
@gt1_random_weight      = {1.< @digit      }
@high_random_weight     = {1.< @high_digit }

@pony_score_9           = { score_9,                                                             }
@pony_score_8_up        = { score_9, score_8_up,                                                 }
@pony_score_7_up        = { score_9, score_8_up, score_7_up,                                     }
@pony_score_6_up        = { score_9, score_8_up, score_7_up, score_6_up,                         }
@pony_score_5_up        = { score_9, score_8_up, score_7_up, score_6_up, score_5_up,             }
@pony_score_4_up        = { score_9, score_8_up, score_7_up, score_6_up, score_5_up, score_4_up, }

@colors = { brown  | red    | orange | yellow | green  | blue    | indigo
          | violet | purple | black  | grey   | white  | silver  | gold }

@pony_scores =
{0
|@pony score_4_up
|@pony score_5_up
|@pony score_6_up
|@pony score_7_up
|@pony score_8_up
|@pony score_9
}

@high_pony_scores =
{0
|@pony_score_7_up
|@pony_score_8_up
|@pony_score_9
}

@aris_defaults          = { masterpiece, best quality, absurdres, aesthetic, 8k,
                            high depth of field, ultra high resolution, detailed background,
                            wide shot,}


// =================================================================================================
// content based on XL Magic Config:
// =================================================================================================

// -------------------------------------------------------------------------------------------------
// small
// -------------------------------------------------------------------------------------------------

@xl_magic_small_1_to_1 =
{ %w    = 512;  %h    = 512;   
  %ow   = 768;  %oh   = 576;
  %tw   = 1024; %th   = 768;   
  %nw   = 1792; %nh   = 1344;  
  %hrf = false;
  #xl_magic_size.small
  #xl_magic_orientation.square
  #xl_magic_aspect_ratio.1.1
  #xl_magic_object_scaling.4
}
// {
// "width": 512,
// "height": 512,
// "originalImageWidth": 768,
// "originalImageHeight": 576,
// "targetImageWidth": 1024,
// "targetImageHeight": 768,
// "negativeOriginalImageWidth": 1792,
// "negativeOriginalImageHeight": 1344,
// "hiresFix": false
// }

@xl_magic_small_1_to_1_os6 =
{ %w    = 512;  %h    = 512;   
  %ow   = 768;  %oh   = 576;   
  %tw   = 1536; %th   = 1152;  
  %nw   = 1792; %nh   = 1344;  
  %hrf = false;
  #xl_magic_size.small
  #xl_magic_orientation.square
  #xl_magic_aspect_ratio.1.1
  #xl_magic_object_scaling.6
}
// {
// "width": 512,
// "height": 512,
// "originalImageWidth": 768,
// "originalImageHeight": 576,
// "targetImageWidth": 1536,
// "targetImageHeight": 1152,
// "negativeOriginalImageWidth": 1792,
// "negativeOriginalImageHeight": 1344,
// "hiresFix": false
// }

@xl_magic_small_3_to_2 =
{ %w    = 768;  %h    = 512;   
  %ow   = 768;  %oh   = 576;   
  %tw   = 1024; %th   = 768;   
  %nw   = 1792; %nh   = 1344;  
  %hrf  = false;
  #xl_magic_size.small
  #xl_magic_orientation.landscape
  #xl_magic_aspect_ratio.3.2
  #xl_magic_object_scaling.4
}
// {
// "width": 768,
// "height": 512,
// "originalImageWidth": 768,
// "originalImageHeight": 576,
// "targetImageWidth": 1024,
// "targetImageHeight": 768,
// "negativeOriginalImageWidth": 1792,
// "negativeOriginalImageHeight": 1344,
// "hiresFix": false
// }

@xl_magic_small_3_to_2_os6 =
{ %w    = 768;  %h    = 512;   
  %ow   = 768;  %oh   = 576;   
  %tw   = 1536; %th   = 1152;  
  %nw   = 1792; %nh   = 1344;  
  %hrf  = false;
  #xl_magic_size.small
  #xl_magic_orientation.landscape
  #xl_magic_aspect_ratio.3.2
  #xl_magic_object_scaling.6
}
// {
// "width": 768,
// "height": 512,
// "originalImageWidth": 768,
// "originalImageHeight": 576,
// "targetImageWidth": 1536,
// "targetImageHeight": 1152,
// "negativeOriginalImageWidth": 1792,
// "negativeOriginalImageHeight": 1344,
// "hiresFix": false
// }

@xl_magic_small_2_to_3 =
{ %w    = 512;  %h    = 768;   
  %ow   = 576;  %oh   = 768;
  %tw   = 768;  %th   = 1024;
  %nw   = 1344; %nh   = 1792;
  %hrf  = false;
  #xl_magic_size.small
  #xl_magic_orientation.portrait
  #xl_magic_aspect_ratio.2.3
  #xl_magic_object_scaling.4
}
// {
// "width": 512,
// "height": 768,
// "originalImageWidth": 768,
// "originalImageHeight": 576,
// "targetImageWidth": 1024,
// "targetImageHeight": 768,
// "negativeOriginalImageWidth": 1792,
// "negativeOriginalImageHeight": 1344,
// "hiresFix": false
// }

@xl_magic_small_2_to_3_os6 =
{ %w    = 512;  %h    = 768;   
  %ow   = 576;  %oh   = 768;
  %tw   = 1152; %th   = 1536;
  %nw   = 1344; %nh   = 1792;
  %hrf  = false;
  #xl_magic_size.small
  #xl_magic_orientation.portrait
  #xl_magic_aspect_ratio.2.3
  #xl_magic_object_scaling.6
}
// {
// "width": 512,
// "height": 768,
// "originalImageWidth": 768,
// "originalImageHeight": 576,
// "targetImageWidth": 1536,
// "targetImageHeight": 1152,
// "negativeOriginalImageWidth": 1792,
// "negativeOriginalImageHeight": 1344,
// "hiresFix": false
// }

@xl_magic_small_4_to_3 =
{ %w   = 768;  %h     = 576;    
  %ow  = 768;  %oh    = 576;    
  %tw  = 1024; %th    = 768;    
  %nw  = 1792; %nh    = 1344;   
  %hrf = false;
  #xl_magic_size.small
  #xl_magic_orientation.landscape
  #xl_magic_aspect_ratio.4.3
  #xl_magic_object_scaling.4
}
// {
// "width": 768,
// "height": 576,
// "originalImageWidth": 768,
// "originalImageHeight": 576,
// "targetImageWidth": 1024,
// "targetImageHeight": 768,
// "negativeOriginalImageWidth": 1792,
// "negativeOriginalImageHeight": 1344,
// "hiresFix": false
// }

@xl_magic_small_4_to_3_os6 = 
{ %w   = 768;  %h     = 576;    
  %ow  = 768;  %oh    = 576;    
  %tw  = 1536; %th    = 1152;   
  %nw  = 1792; %nh    = 1344;   
  %hrf = false;
  #xl_magic_size.small
  #xl_magic_orientation.landscape
  #xl_magic_aspect_ratio.4.3
  #xl_magic_object_scaling.6
}
// {
// "width": 768,
// "height": 576,
// "originalImageWidth": 768,
// "originalImageHeight": 576,
// "targetImageWidth": 1536,
// "targetImageHeight": 1152,
// "negativeOriginalImageWidth": 1792,
// "negativeOriginalImageHeight": 1344,
// "hiresFix": false
// }

@xl_magic_small_3_to_4 =
{ %w   = 576;  %h     = 768;    
  %ow  = 576;  %oh    = 768;
  %tw  = 768; %th    = 1024;
  %nw  = 1344; %nh    = 1792;
  %hrf = false;
  #xl_magic_size.small
  #xl_magic_orientation.portrait
  #xl_magic_aspect_ratio.3.4
  #xl_magic_object_scaling.4
}
// {
// "width": 576,
// "height": 768,
// "originalImageWidth": 768,
// "originalImageHeight": 576,
// "targetImageWidth": 1024,
// "targetImageHeight": 768,
// "negativeOriginalImageWidth": 1792,
// "negativeOriginalImageHeight": 1344,
// "hiresFix": false
// }

@xl_magic_small_3_to_4_os6 = 
{ %w   = 576;  %h     = 768;    
  %ow  = 576;  %oh    = 768;
  %tw  = 1152; %th    = 1536;
  %nw  = 1344; %nh    = 1792;
  %hrf = false;
  #xl_magic_size.small
  #xl_magic_orientation.portrait
  #xl_magic_aspect_ratio.3.4
  #xl_magic_object_scaling.6
}
// {
// "width": 576,
// "height": 768,
// "originalImageWidth": 768,
// "originalImageHeight": 576,
// "targetImageWidth": 1536,
// "targetImageHeight": 1152,
// "negativeOriginalImageWidth": 1792,
// "negativeOriginalImageHeight": 1344,
// "hiresFix": false
// }

@xl_magic_small_16_to_9 =
{ %w   = 1024;  %h    = 576;    
  %ow  = 768;   %oh   = 576;    
  %tw  = 1024;  %th   = 768;    
  %nw  = 1792;  %nh   = 1344;   
  %hrf = false;
  #xl_magic_size.small
  #xl_magic_orientation.landscape
  #xl_magic_aspect_ratio.16.9
  #xl_magic_object_scaling.4
}
// {
// "width": 1024,
// "height": 576,
// "originalImageWidth": 768,
// "originalImageHeight": 576,
// "targetImageWidth": 1024,
// "targetImageHeight": 768,
// "negativeOriginalImageWidth": 1792,
// "negativeOriginalImageHeight": 1344,
// "hiresFix": false
// }

@xl_magic_small_16_to_9_os6 = 
{ %w   = 1024;  %h    = 576;    
  %ow  = 768;   %oh   = 576;    
  %tw  = 1536;  %th   = 1152;   
  %nw  = 1792;  %nh   = 1344;   
  %hrf = false;
  #xl_magic_size.small
  #xl_magic_orientation.landscape
  #xl_magic_aspect_ratio.16.9
  #xl_magic_object_scaling.6
}
// {
// "width": 1024,
// "height": 576,
// "originalImageWidth": 768,
// "originalImageHeight": 576,
// "targetImageWidth": 1536,
// "targetImageHeight": 1152,
// "negativeOriginalImageWidth": 1792,
// "negativeOriginalImageHeight": 1344,
// "hiresFix": false
// }

@xl_magic_small_9_to_16 =
{ %w   = 576;  %h     = 1024;   
  %ow  = 576;  %oh    = 768;
  %tw  = 768;  %th    = 1024;
  %nw  = 1344; %nh    = 1792;
  %hrf = false;
  #xl_magic_size.small
  #xl_magic_orientation.portrait
  #xl_magic_aspect_ratio.9.16
  #xl_magic_object_scaling.4
}
// {
// "width": 576,
// "height": 1024,
// "originalImageWidth": 768,
// "originalImageHeight": 576,
// "targetImageWidth": 1024,
// "negativeOriginalImageWidth": 1792,
// "negativeOriginalImageHeight": 1344,
// "hiresFix": false
// }

@xl_magic_small_9_to_16_os6 = 
{ %w   = 576;  %h     = 1024;   
  %ow  = 576;  %oh    = 768;
  %tw  = 1152; %th    = 1536;
  %nw  = 1344; %nh    = 1792;
  %hrf = false;
  #xl_magic_size.small
  #xl_magic_orientation.portrait
  #xl_magic_aspect_ratio.9.16
  #xl_magic_object_scaling.6
}
// {
// "width": 576,
// "height": 1024,
// "originalImageWidth": 768,
// "originalImageHeight": 576,
// "targetImageWidth": 1536,
// "targetImageHeight": 1152,
// "negativeOriginalImageWidth": 1792,
// "negativeOriginalImageHeight": 1344,
// "hiresFix": false
// }

// -------------------------------------------------------------------------------------------------
// medium:
// -------------------------------------------------------------------------------------------------

@xl_magic_medium_1_to_1 =
{ %h   = 1024;  %w    = 1024;   
  %ow  = 768;   %oh   = 576;    
  %tw  = 1024;  %th   = 768;    
  %nw  = 1792;  %nh   = 1344;   
  %hrf = false;
  #xl_magic.aspect_ratio_1_to_1
  #xl_magic_size.medium
}
// {
// "width": 1024,
// "height": 1024,
// "originalImageWidth": 768,
// "originalImageHeight": 576,
// "targetImageWidth": 1024,
// "targetImageHeight": 768,
// "negativeOriginalImageWidth": 1792,
// "negativeOriginalImageHeight": 1344,
// "hiresFix": false
// }

@xl_magic_medium_1_to_1_os6 =
{ %h   = 1024;  %w    = 1024;   
  %ow  = 768;   %oh   = 576;    
  %tw  = 1536;  %th   = 1152;
  %nw  = 1792;  %nh   = 1344;   
  %hrf = false;
  #xl_magic_size.medium
  #xl_magic_orientation.square
  #xl_magic_aspect_ratio.1.1
  #xl_magic_object_scaling.6
}
// {
// "width": 1024,
// "height": 1024,
// "originalImageWidth": 768,
// "originalImageHeight": 576,
// "targetImageWidth": 1536,
// "targetImageHeight": 1152,
// "negativeOriginalImageWidth": 1792,
// "negativeOriginalImageHeight": 1344,
// "hiresFix": false
// }

@xl_magic_medium_2_to_3 =
{ %w   = 832;   %h    = 1216;   
  %ow  = 576;   %oh   = 768;
  %tw  = 768;   %th   = 1024;
  %nw  = 1344;  %nh   = 1792;
  %hrf = false;
  #xl_magic_size.medium
  #xl_magic_orientation.portrait
  #xl_magic_aspect_ratio.2.3
  #xl_magic_object_scaling.4
}
// {
// "width": 832,
// "height": 1216,
// "originalImageWidth": 768,
// "originalImageHeight": 576,
// "targetImageWidth": 1024,
// "targetImageHeight": 768,
// "negativeOriginalImageWidth": 1792,
// "negativeOriginalImageHei// "hiresFix": false
// }

@xl_magic_medium_2_to_3_os6 =
{ %w   = 832;   %h    = 1216;   
  %ow  = 576;   %oh   = 768;
  %tw  = 1152;  %th   = 1536;
  %nw  = 1344;  %nh   = 1792;
  %hrf = false;
  #xl_magic_size.medium
  #xl_magic_orientation.portrait
  #xl_magic_aspect_ratio.2.3
  #xl_magic_object_scaling.6
}
// {
// "width": 832,
// "height": 1216,
// "originalImageWidth": 768,
// "originalImageHeight": 576,
// "targetImageWidth": 1536,
// "targetImageHeight": 1152,
// "negativeOriginalImageWidth": 1792,
// "negativeOriginalImageHeight": 1344,
// "hiresFix": false
// }

@xl_magic_medium_3_to_2 =
{ %w   = 1216;  %h    = 832;    
  %ow  = 768;   %oh   = 576;    
  %tw  = 1024;  %th   = 768;    
  %nw  = 1792;  %nh   = 1344;   
  %hrf = false;
  #xl_magic_size.medium
  #xl_magic_orientation.landscape
  #xl_magic_aspect_ratio.3.2
  #xl_magic_object_scaling.4
}
// {
// "width": 1216,
// "height": 832,
// "originalImageWidth": 768,
// "originalImageHeight": 576,
// "targetImageWidth": 1024,
// "targetImageHeight": 768,
// "negativeOriginalImageWidth": 1792,
// "negativeOriginalImageHeight": 1344,
// "hiresFix": false
// }

@xl_magic_medium_3_to_2_os6 =
{ %w   = 1216;  %h    = 832; 
  %ow  = 768;   %oh   = 576;    
  %tw  = 1536;  %th   = 1152;   
  %nw  = 1792;  %nh   = 1344;   
  %hrf = false;
  #xl_magic_size.medium
  #xl_magic_orientation.landscape
  #xl_magic_aspect_ratio.3.2
  #xl_magic_object_scaling.6
}
// {
// "width": 1216,
// "height": 832,
// "originalImageWidth": 768,
// "originalImageHeight": 576,
// "targetImageWidth": 1536,
// "targetImageHeight": 1152,
// "negativeOriginalImageWidth": 1792,
// "negativeOriginalImageHeight": 1344,
// "hiresFix": false
// }

@xl_magic_medium_3_to_4 =
{ %w   = 896;   %h    = 1152;   
  %ow  = 576;   %oh   = 768;
  %tw  = 768;   %th   = 1024;
  %nw  = 1344;  %nh   = 1792;
  %hrf = false;
  #xl_magic_size.medium
  #xl_magic_orientation.portrait
  #xl_magic_aspect_ratio.3.4
  #xl_magic_object_scaling.4
}
// {
// "width": 896,
// "height": 1152,
// "originalImageWidth": 768,
// "originalImageHeight": 576,
// "targetImageWidth": 1024,
// "targetImageHeight": 768,
// "negativeOriginalImageWidth": 1792,
// "negativeOriginalImageHeight": 1344,
// "hiresFix": false
// }

@xl_magic_medium_4_to_3 =
{ %w    = 1152; %h    = 896;    
  %ow   = 768;  %oh   = 576;    
  %tw   = 1024; %th   = 768;    
  %nw   = 1792; %nh   = 1344;   
  %hrf = false;
  #xl_magic_size.medium
  #xl_magic_orientation.landscape
  #xl_magic_aspect_ratio.4.3
  #xl_magic_object_scaling.4
}
// {
// "width": 1152,
// "height": 896,
// "originalImageWidth": 768,
// "originalImageHeight": 576,
// "targetImageWidth": 1024,
// "targetImageHeight": 768,
// "negativeOriginalImageWidth": 1792,
// "negativeOriginalImageHeight": 1344,
// "hiresFix": false
// }

@xl_magic_medium_4_to_3_os6 =
{ %w    = 1152; %h    = 896;     
  %ow   = 768;  %oh   = 576;    
  %tw   = 1536; %th   = 1152 
  %nw   = 1792; %nh   = 1344;   
  %hrf = false;
  #xl_magic_size.medium
  #xl_magic_orientation.landscape
  #xl_magic_aspect_ratio.4.3
  #xl_magic_object_scaling.6
}
// {
// "width": 1152,
// "height": 896,
// "originalImageWidth": 768,
// "originalImageHeight": 576,
// "targetImageWidth": 1536,
// "targetImageHeight": 1152,
// "negativeOriginalImageWidth": 1792,
// "negativeOriginalImageHeight": 1344,
// "hiresFix": false
// }

@xl_magic_medium_3_to_4_os6 =
{ %w   = 896;   %h    = 1152;   
  %ow  = 576;   %oh   = 768;
  %tw  = 1152;  %th   = 1536;
  %nw  = 1344;  %nh   = 1792;
  %hrf = false;
  #xl_magic_size.medium
  #xl_magic_orientation.portrait
  #xl_magic_aspect_ratio.3.4
  #xl_magic_object_scaling.6
}
// {
// "width": 896,
// "height": 1152,
// "originalImageWidth": 768,
// "originalImageHeight": 576,
// "targetImageWidth": 1536,
// "targetImageHeight": 1152,
// "negativeOriginalImageWidth": 1792,
// "negativeOriginalImageHeight": 1344,
// "hiresFix": false
// }

@xl_magic_medium_9_to_16 =
{ %w   = 768;   %h    = 1344;   
  %ow  = 576;   %oh   = 768;
  %tw  = 768;   %th   = 1024;
  %nw  = 1344;  %nh   = 1792;
  %hrf = false;
  #xl_magic_size.medium
  #xl_magic_orientation.portrait
  #xl_magic_aspect_ratio.9.16
  #xl_magic_object_scaling.4
}
// {
// "width": 768,
// "height": 1344,
// "originalImageWidth": 768,
// "originalImageHeight": 576,
// "targetImageWidth": 1024,
// "targetImageHeight": 768,
// "negativeOriginalImageWidth": 1792,
// "negativeOriginalImageHeight": 1344,
// "hiresFix": false
// }

@xl_magic_medium_9_to_16_os6 = 
{ %w   = 768;   %h    = 1344;   
  %ow  = 576;   %oh   = 768;
  %tw  = 1152;  %th   = 1536;
  %nw  = 1344;  %nh   = 1792;
  %hrf = false;
  #xl_magic_size.medium
  #xl_magic_orientation.portrait
  #xl_magic_aspect_ratio.9.16
  #xl_magic_object_scaling.6
}
// {
// "width": 768,
// "height": 1344,
// "originalImageWidth": 768,
// "originalImageHeight": 576,
// "targetImageWidth": 1536,
// "targetImageHeight": 1152,
// "negativeOriginalImageWidth": 1792,
// "negativeOriginalImageHeight": 1344,
// "hiresFix": false
// }

@xl_magic_medium_16_to_9 =
{ %w   = 1344;  %h    = 768;    
  %ow  = 768;   %oh   = 576;    
  %tw  = 1024;  %th   = 768;    
  %nw  = 1792;  %nh   = 1344;   
  %hrf = false;
  #xl_magic_size.medium
  #xl_magic_orientation.landscape
  #xl_magic_aspect_ratio.16.9
  #xl_magic_object_scaling.4
}
// {
// "width": 1344,
// "height": 768,
// "originalImageWidth": 768,
// "originalImageHeight": 576,
// "targetImageWidth": 1024,
// "targetImageHeight": 768,
// "negativeOriginalImageWidth": 1792,
// "negativeOriginalImageHeight": 1344,
// "hiresFix": false
// }

@xl_magic_medium_16_to_9_os6 =
{ %w   = 1344;  %h    = 768;    
  %ow  = 768;   %oh   = 576;    
  %tw  = 1536;  %th   = 1152    
  %nw  = 1792;  %nh   = 1344;   
  %hrf = false;
  #xl_magic_size.medium
  #xl_magic_orientation.landscape
  #xl_magic_aspect_ratio.16.9
  #xl_magic_object_scaling.6
}
// {
// "width": 1344,
// "height": 768,
// "originalImageWidth": 768,
// "originalImageHeight": 576,
// "targetImageWidth": 1536,
// "targetImageHeight": 1152,
// "negativeOriginalImageWidth": 1792,
// "negativeOriginalImageHeight": 1344,
// "hiresFix": false
// }

// -------------------------------------------------------------------------------------------------
// large:
// -------------------------------------------------------------------------------------------------

@xl_magic_large_1_to_1 = 
{ %w    = 1536; %h    = 1536;   
  %ow   = 768;  %oh   = 576;    
  %tw   = 1024; %th   = 768;    
  %nw   = 1792; %nh   = 1344;   
  %hrfw = 512;  %hrfh = 512;
  %hrf  = true;
  %hrf_strength = 0.6;
  #xl_magic_size.large
  #xl_magic_orientation.square
  #xl_magic_aspect_ratio.1.1
  #xl_magic_object_scaling.4
}

@xl_magic_large_2_to_3 =
{ %w    = 1280; %h    = 1920;   
  %ow   = 576;  %oh   = 768;    
  %tw   = 768;  %th   = 1024;   
  %nw   = 1344; %nh   = 1792;   
  %hrfw = 512;  %hrfh = 768;
  %hrf  = true;
  %hrf_strength = 0.6;
  #xl_magic_size.large
  #xl_magic_orientation.portrait
  #xl_magic_aspect_ratio.2.3
  #xl_magic_object_scaling.4
}

@xl_magic_large_3_to_2 =
{ %w    = 1920; %h    = 1280;   
  %ow   = 768;  %oh   = 576;    
  %tw   = 1024; %th   = 768;    
  %nw   = 1792; %nh   = 1344;   
  %hrfw = 768;  %hrfh = 512;
  %hrf  = true;
  %hrf_strength = 0.6;
  #xl_magic_size.large
  #xl_magic_orientation.landscape
  #xl_magic_aspect_ratio.3.2
  #xl_magic_object_scaling.4
}

@xl_magic_large_3_to_4 =
{ %w    = 1344; %h    = 1792;   
  %ow   = 576;  %oh   = 768;    
  %tw   = 768;  %th   = 1024;   
  %nw   = 1344; %nh   = 1792;   
  %hrfw = 576;  %hrfh = 768;
  %hrf  = true;
  %hrf_strength = 0.6;
  #xl_magic_size.large
  #xl_magic_orientation.portrait
  #xl_magic_aspect_ratio.3.4
  #xl_magic_object_scaling.4
}

@xl_magic_large_4_to_3 =
{ %w    = 1792; %h    = 1344;   
  %ow   = 768;  %oh   = 576;    
  %tw   = 1024; %th   = 768;    
  %nw   = 1792; %nh   = 1344;   
  %hrfw = 768;  %hrfh = 576;
  %hrf  = true;
  %hrf_strength = 0.6;
  #xl_magic_size.large
  #xl_magic_orientation.landscape
  #xl_magic_aspect_ratio.4.3
  #xl_magic_object_scaling.4
}

@xl_magic_large_9_to_16 =
{ %w    = 1152; %h    = 2048;   
  %ow   = 576;  %oh   = 768;    
  %tw   = 768;  %th   = 1024;   
  %nw   = 1344; %nh   = 1792;   
  %hrfw = 576;  %hrfh = 1024;
  %hrf  = true;
  %hrf_strength = 0.6;
  #xl_magic_size.large
  #xl_magic_orientation.landscape
  #xl_magic_aspect_ratio.9.16
  #xl_magic_object_scaling.4
}

@xl_magic_large_16_to_9 =
{ %w    = 2048; %h    = 1152;   
  %ow   = 768;  %oh   = 576;    
  %tw   = 1024; %th   = 768;    
  %nw   = 1792; %nh   = 1344;   
  %hrfw = 1024; %hrfh = 576;
  %hrf  = true;
  %hrf_strength = 0.6;
  #xl_magic_size.large
  #xl_magic_orientation.landscape
  #xl_magic_aspect_ratio.16.9
  #xl_magic_object_scaling.4
}

@xl_magic_large_1_to_1_os6 =
{ %w    = 1536: %h    = 1536;
  %ow   = 768;  %oh   = 576;
  %tw   = 1536; %th   = 1152;
  %nw   = 1792; %nh   = 1344;
  %hrfw = 512;  %hrfh = 512;
  %hrf  = true;
  %hrf_strength = 0.6;
  #xl_magic_size.large
  #xl_magic_orientation.square
  #xl_magic_aspect_ratio.1.1
  #xl.magic_object_scaling.6
}
// 1:1 os6
// {
// "width": 1536,
// "height": 1536,
// "originalImageWidth": 768,
// "originalImageHeight": 576,
// "targetImageWidth": 1536,
// "targetImageHeight": 1152,
// "negativeOriginalImageWidth": 1792,
// "negativeOriginalImageHeight": 1344,
// "hiresFix": true,
// "hiresFixWidth": 512,
// "hiresFixHeight": 512,
// "hiresFixStrength": 0.6
// }

@xl_magic_large_2_to_3_os6 =
{ %w    = 1280: %h    = 1920;
  %ow   = 576;  %oh   = 768;
  %tw   = 1152; %th   = 1536;
  %nw   = 1344; %nh   = 1792;
  %hrfw = 512;  %hrfh = 768;
  %hrf  = true;
  %hrf_strength = 0.6;
  #xl_magic_size.large
  #xl_magic_orientation.portrait
  #xl_magic_aspect_ratio.2.3
  #xl.magic_object_scaling.6
}
// 2:3 os6
// {
// "width": 1280,
// "height": 1920,
// "originalImageWidth": 576,
// "originalImageHeight": 768,
// "targetImageWidth": 1152,
// "targetImageHeight": 1536,
// "negativeOriginalImageWidth": 1344,
// "negativeOriginalImageHeight": 1792,
// "hiresFix": true,
// "hiresFixWidth": 512,
// "hiresFixHeight": 768,
// "hiresFixStrength": 0.6
// }

@xl_magic_large_3_to_2_os6 =
{ %w    = 1920: %h    = 1280;
  %ow   = 768;  %oh   = 576;
  %tw   = 1536; %th   = 1152;
  %nw   = 1792; %nh   = 1344;
  %hrfw = 768;  %hrfh = 512;
  %hrf  = true;
  %hrf_strength = 0.6;
  #xl_magic_size.large
  #xl_magic_orientation.landscape
  #xl_magic_aspect_ratio.3.2
  #xl.magic_object_scaling.6
}
// 3:2 os6
// {
// "width": 1920,
// "height": 1280,
// "originalImageWidth": 768,
// "originalImageHeight": 576,
// "targetImageWidth": 1536,
// "targetImageHeight": 1152,
// "negativeOriginalImageWidth": 1792,
// "negativeOriginalImageHeight": 1344,
// "hiresFix": true,
// "hiresFixWidth": 768,
// "hiresFixHeight": 512,
// "hiresFixStrength": 0.6
// }

@xl_magic_large_3_to_4_os6 =
{ %w    = 1344: %h    = 1796;
  %ow   = 576;  %oh   = 768;
  %tw   = 1152; %th   = 1536;
  %nw   = 1344; %nh   = 1792;
  %hrfw = 576;  %hrfh = 768;
  %hrf  = true;
  %hrf_strength = 0.6;
  #xl_magic_size.large
  #xl_magic_orientation.portrait
  #xl_magic_aspect_ratio.3.4
  #xl.magic_object_scaling.6
}
// 3:4 os6
// {
// "width": 1344,
// "height": 1796,
// "originalImageWidth": 576,
// "originalImageHeight": 768,
// "targetImageWidth": 1152,
// "targetImageHeight": 1536,
// "negativeOriginalImageWidth": 1344,
// "negativeOriginalImageHeight": 1792,
// "hiresFix": true,
// "hiresFixWidth": 576,
// "hiresFixHeight": 768,
// "hiresFixStrength": 0.6
// }

@xl_magic_large_4_to_3_os6 = 
{ %w    = 1792; %h    = 1344;
  %ow   = 768;  %oh   = 576;
  %tw   = 1536; %th   = 1152;
  %nw   = 1792; %nh   = 1344;
  %hrfw = 768;  %hrfh = 576;
  %hrf  = true;
  %hrf_strength = 0.6;
  #xl_magic_size.large
  #xl_magic_orientation.landscale
  #xl_magic_aspect_ratio.4.3
  #xl.magic_object_scaling.6

}
// {
// "width": 1792,
// "height": 1344,
// "originalImageWidth": 768,
// "originalImageHeight": 576,
// "targetImageWidth": 1536,
// "targetImageHeight": 1152,
// "negativeOriginalImageWidth": 1792,
// "negativeOriginalImageHeight": 1344,
// "hiresFix": true,
// "hiresFixWidth": 768,
// "hiresFixHeight": 576,
// "hiresFixStrength": 0.6
// }

@xl_magic_large_9_to_16_os6 =
{ %w    = 1152: %h    = 2048;
  %ow   = 576;  %oh   = 768;
  %tw   = 1152; %th   = 1536;
  %nw   = 1344; %nh   = 1792;
  %hrfw = 576;  %hrfh = 1024;
  %hrf  = true;
  %hrf_strength = 0.6;
  #xl_magic_size.large
  #xl_magic_orientation.portrait
  #xl_magic_aspect_ratio.9.16
  #xl.magic_object_scaling.6
}
// 9:16 os6
// {
// "width": 1152,
// "height": 2048,
// "originalImageWidth": 576,
// "originalImageHeight": 768,
// "targetImageWidth": 1152,
// "targetImageHeight": 1536,
// "negativeOriginalImageWidth": 1344,
// "negativeOriginalImageHeight": 1792,
// "hiresFix": true,
// "hiresFixWidth": 576,
// "hiresFixHeight": 1024,
// "hiresFixStrength": 0.6
// }

@xl_magic_large_16_to_9_os6 =
{ %w    = 2048: %h    = 1152;
  %ow   = 768;  %oh   = 576;
  %tw   = 1536; %th   = 1152;
  %nw   = 1792; %nh   = 1344;
  %hrfw = 1024; %hrfh = 576;
  %hrf  = true;
  %hrf_strength = 0.6;
  #xl_magic_size.large
  #xl_magic_orientation.landscape
  #xl_magic_aspect_ratio.16.9
  #xl.magic_object_scaling.6
}
// 16:9 os6
// {
// "width": 2048,
// "height": 1152,
// "originalImageWidth": 768,
// "originalImageHeight": 576,
// "targetImageWidth": 1536,
// "targetImageHeight": 1152,
// "negativeOriginalImageWidth": 1792,
// "negativeOriginalImageHeight": 1344,
// "hiresFix": true,
// "hiresFixWidth": 1024,
// "hiresFixHeight": 576,
// "hiresFixStrength": 0.6
// }


// --------------------------------------------------------------------------------------------------
// pickers:
// -------------------------------------------------------------------------------------------------

@xl_magic_small_random =
{ @xl_magic_small_1_to_1
| @xl_magic_small_2_to_3
| @xl_magic_small_3_to_2
| @xl_magic_small_3_to_4
| @xl_magic_small_4_to_3
| @xl_magic_small_9_to_16
| @xl_magic_small_16_to_9
}

@xl_magic_small_random_os6 = 
{ @xl_magic_small_1_to_1_os6
| @xl_magic_small_2_to_3_os6
| @xl_magic_small_3_to_2_os6
| @xl_magic_small_3_to_4_os6
| @xl_magic_small_4_to_3_os6
| @xl_magic_small_9_to_16_os6
| @xl_magic_small_16_to_9_os6
}

@xl_magic_medium_random =
{ @xl_magic_medium_1_to_1
| @xl_magic_medium_2_to_3
| @xl_magic_medium_3_to_2
| @xl_magic_medium_3_to_4
| @xl_magic_medium_4_to_3
| @xl_magic_medium_9_to_16
| @xl_magic_medium_16_to_9
}

@xl_magic_medium_random_os6 =
{ @xl_magic_medium_1_to_1_os6
| @xl_magic_medium_2_to_3_os6
| @xl_magic_medium_3_to_2_os6
| @xl_magic_medium_3_to_4_os6
| @xl_magic_medium_4_to_3_os6
| @xl_magic_medium_9_to_16_os6
| @xl_magic_medium_16_to_9_os6
}

@xl_magic_large_random =
{ @xl_magic_large_1_to_1
| @xl_magic_large_2_to_3
| @xl_magic_large_3_to_2
| @xl_magic_large_3_to_4
| @xl_magic_large_4_to_3
| @xl_magic_large_9_to_16
| @xl_magic_large_16_to_9
}

@xl_magic_large_random_os6 =
{ @xl_magic_large_1_to_1_os6
| @xl_magic_large_2_to_3_os6
| @xl_magic_large_3_to_2_os6
| @xl_magic_large_3_to_4_os6
| @xl_magic_large_4_to_3_os6
| @xl_magic_large_9_to_16_os6
| @xl_magic_large_16_to_9_os6
}

//--------------------------------------------------------------------------------------------------
// Integrated content adapted from @Wizard Whitebeard's 'Wizard's Large Scroll of
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
| !wizards_artist.#jack_gaughan
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
| ?wizards_artist.jack_gaughan Jack Gaughan
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
  if (prelude_disabled)
    return into_context;
  
  if (log_loading_prelude)
    lm.log(`loading prelude...`);

  const elapsed = measure_time(() => {
    const old_log_flags_enabled = log_flags_enabled;
    log_flags_enabled = false;
    
    if (! prelude_parse_result) {
      const old_log_match_enabled = log_match_enabled;
      log_match_enabled = false; 
      prelude_parse_result = Prompt.match(prelude_text);
      log_match_enabled = old_log_match_enabled;
    }

    // lm.log(`prelude AST:\n${inspect_fun(prelude_parse_result)}`);
    const ignored = expand_wildcards(prelude_parse_result.value, into_context,
                                     { correct_articles: true });
    
    log_flags_enabled = old_log_flags_enabled;

    // log_flags_enabled = true;
    
    if (ignored === undefined)
      throw new Error("crap");

    // lm.log(`NWCS: ${inspect_fun(into_context.named_wildcards)}`);
  });
  
  if (log_loading_prelude) {
    lm.log(`loading prelude took ${elapsed.toFixed(3)} ms`);
    if (rule_match_counter_enabled)
      lm.log(`MATCH_COUNT = ${format_pretty_number(Rule.match_counter)}`);
  }
  
  return into_context;
}
// =================================================================================================
// END OF PRELUDE HELPER FUNCTIONS/VARS FOR DEALING WITH THE PRELUDE.
// =================================================================================================


// =================================================================================================
// THE MAIN AST WALKING FUNCTION THAT I'LL BE USING FOR THE SD PROMPT GRAMMAR'S OUTPUT:
// =================================================================================================
let expand_wildcards_trap_counter = 0; // not yet used
// -------------------------------------------------------------------------------------------------
function expand_wildcards(thing, context, { correct_articles = true } = {}) {
  if (thing === undefined           ||
      !(context instanceof Context) || 
      typeof correct_articles !== 'boolean')
    throw new Error(`bad expand_wildcards args: ${abbreviate(compress(inspect_fun(arguments)))}`);
  // -----------------------------------------------------------------------------------------------
  if (typeof thing === 'string') {
    if (log_level__expand_and_walk >= 1)
      lm.log(`nothing to expand in ${thing_str_repr(thing)} => ${thing_str_repr(thing)}`);
    return thing;
  }
  // -----------------------------------------------------------------------------------------------
  function picker_each(pick) {
    // lm.log(`pick => ${thing_str_repr(pick, { always_include_type_str: true })}`);
    return lm.indent(() => {
      const ret = walk(pick?.body ?? '', { correct_articles: correct_articles });

      // if (log_level__expand_and_walk >= 2)
      //   lm.log(`picker_each: ${abbreviate(compress(inspect_fun(pick)))} ` +
      //          `<${thing_str_repr(pick)}> => ` + 
      //          `${thing_str_repr(ret)}`, true)

      return ret;
    });
  }
  // -----------------------------------------------------------------------------------------------
  // const log = (guard_bool, msg, with_indentation = true) => { 
  //   if (! msg && msg !== '') throw new Error("bomb 1");
  //   if (guard_bool) lm.log(msg, with_indentation);
  // };
  // -----------------------------------------------------------------------------------------------
  function walk(thing, { correct_articles = undefined } = {}) {
    if (correct_articles === undefined)
      throw new Error(`bad walk args: ${abbreviate(compress(inspect_fun(arguments)))}`);

    // const log = (guard_bool, msg, with_indentation = true) => {
    //   if (! msg && msg !== '') throw new Error("bomb 1");
    //   if (guard_bool) lm.log(msg, with_indentation);
    // };

    class ThrownReturn {
      constructor(value, quiet = false) {
        this.value = value;
        this.quiet = quiet;
      }
    }

    if (typeof thing === 'string') {
      if (log_level__expand_and_walk)
        lm.log(`nothing to walk in ${thing_str_repr(thing)} => ${thing_str_repr(thing)}`);
      return thing;
    }

    if (log_level__expand_and_walk)
      lm.log(`Walking ${thing_str_repr(thing,
                                       { always_include_type_str: true, length: 200 })}`);

    try {
      // -------------------------------------------------------------------------------------------
      // Arrays:
      // -------------------------------------------------------------------------------------------
      if (Array.isArray(thing)) {
        const ret = [];

        lm.indent(() => {
          for (let ix = 0; ix < thing.length; ix++) {
            if (log_level__expand_and_walk)
              lm.log(`Walking array element #${ix + 1} `+
                     `of ${thing.length} ` +
                     `${thing_str_repr(thing[ix],
                                       { always_include_type_str: true, length: 200 })} `
                    );

            const elem_ret =
                  lm.indent(() => walk(thing[ix], { correct_articles: correct_articles }));

            if (elem_ret)
              ret.push(elem_ret);

            if (log_level__expand_and_walk)
              lm.log(`walking array element #${ix + 1} `+
                     `of ${thing.length} ` +
                     `${thing_str_repr(thing[ix])} ` +
                     `=> ${thing_str_repr(elem_ret,
                                          { always_include_type_str: true, length: 200 })}`
                    );
          }

          const str = smart_join(ret, { correct_articles: correct_articles });
          throw new ThrownReturn(str);
        });
      }
      // -------------------------------------------------------------------------------------------
      // flags:
      // -------------------------------------------------------------------------------------------
      else if (thing instanceof ASTSetFlag) {
        if (log_flags_enabled >= 2)
          lm.log(`setting flag '${thing.flag}'.`);

        context.set_flag(thing.flag);

        throw new ThrownReturn(''); // produce nothing
      }
      // -------------------------------------------------------------------------------------------
      else if (thing instanceof ASTUnsetFlag) {
        if (log_flags_enabled >= 2)
          lm.log(`unsetting flag '${thing.flag}'.`);

        context.unset_flag(thing.flag);
        
        throw new ThrownReturn(''); // produce nothing
      }
      // -------------------------------------------------------------------------------------------
      // AnonWildcards:
      // -------------------------------------------------------------------------------------------
      else if (thing instanceof ASTAnonWildcard) {
        let str = thing.pick(1, 1,
                             context.picker_allow_fun,
                             context.picker_forbid_fun,
                             picker_each, 
                             context.pick_one_priority)[0];

        if (log_level__expand_and_walk)
          lm.indent(() => lm.log(`picked item = ${thing_str_repr(str)}`));
        
        if (thing.trailer && str.length > 0)
          str = smart_join([str, thing.trailer],
                           { correct_articles: false });
        // ^ don't need to correct articles for trailers since punctuation can't trigger an
        //   article correction anyhow.

        throw new ThrownReturn(str);
      }
      // -------------------------------------------------------------------------------------------
      // NamedWildcardReferences;
      // -------------------------------------------------------------------------------------------
      else if (thing instanceof ASTNamedWildcardReference) {
        const got = context.named_wildcards.get(thing.name);
        // ^ an ASTAnonWildcard or an ASTLatchedNamedWildcard 
        
        if (!got)
          throw new ThrownReturn(warning_str(`named wildcard '${thing.name}' not found`));

        let res;
        let anon_wildcard;
        
        if (got instanceof ASTLatchedNamedWildcard) {          
          anon_wildcard = got.original_value;
          res           = Array(rand_int(thing.min_count, thing.max_count)).fill(got.latched_value);
        }
        else { // ASTAnonWildcard
          anon_wildcard = got;
          
          const picker_priority = thing.min_count === 1 && thing.max_count === 1
                ? context.pick_one_priority
                : context.pick_multiple_priority;
          
          res = anon_wildcard.pick(thing.min_count, thing.max_count,
                                   context.picker_allow_fun,
                                   context.picker_forbid_fun,
                                   picker_each, 
                                   picker_priority);
          
          if (log_level__expand_and_walk)
            lm.indent(() => lm.log(`picked items ${thing_str_repr(res)}`));
        }

        res = res.filter(x => x);
        
        if (thing.capitalize && res.length > 0) 
          res[0] = capitalize(res[0]);

        // compute effective_trailer:
        const effective_trailer = thing.trailer
              ? thing.trailer
              : anon_wildcard.trailer; // might be null, but that should be okay
        
        let effective_joiner = null;   // might remain null, but that should be okay      
        let intercalate_options = {}

        // compute effective_joiner:
        if (thing.joiner === '&') {
          effective_joiner = ',';
          intercalate_options.final_separator = 'and';
        }
        else if (thing.joiner)
          effective_joiner = thing.joiner;
        else if (',.'.includes(anon_wildcard.trailer))
          effective_joiner = anon_wildcard.trailer; // might be null, but that should be okay
        
        // log effective joiner/trailers:
        if (log_level__expand_and_walk >= 2)
          lm.indent(() => {
            lm.log(`EFFECTIVE_JOINER:  ${inspect_fun(effective_joiner)}`);
            lm.log(`EFFECTIVE_TRAILER: ${inspect_fun(effective_trailer)}`);
            lm.log(`ANON_WILDCARD:     ${thing_str_repr(anon_wildcard)}`);
          });

        lm.indent(() => {
          let str = smart_join(intercalate(effective_joiner, res, intercalate_options),
                               { correct_articles: false });
          // ^ don't need to correct articles here since punctuation and the word 'and' both can't
          //   trigger an article correction anyhow.
          
          if (effective_trailer && str.length > 0)
            str = smart_join([str, effective_trailer],
                             { correct_articles: false });
          // ^ don't need to correct articles for trailers since punctuation can't trigger an
          //   article correction anyhow.

          throw new ThrownReturn(str);
        });
      }
      // -------------------------------------------------------------------------------------------
      // scalar references:
      // -------------------------------------------------------------------------------------------
      else if (thing instanceof ASTScalarReference) {
        let got = context.scalar_variables.get(thing.name) ??
            warning_str(`scalar '${thing.name}' not found`);

        if (thing.capitalize)
          got = capitalize(got);

        if (thing.trailer && got.length > 0)
          lm.indent(() => got = smart_join([got, thing.trailer],
                                           { correct_articles: false }));
        // ^ never need to correct articles for trailers since punctuation couldn't trigger correction
        
        throw new ThrownReturn(got);
      }
      // -------------------------------------------------------------------------------------------
      // NamedWildcards:
      // -------------------------------------------------------------------------------------------
      else if (thing instanceof ASTLatchNamedWildcard) {
        const got = context.named_wildcards.get(thing.target.name);
        
        if (!got)
          throw new ThrownReturn(
            warning_str(`Named wildcard @${thing.target.name} not found`));

        if (got instanceof ASTLatchedNamedWildcard) {
          if (double_latching_is_an_error)
            throw new ThrownReturn(
              warning_str(`tried to latch already-latched named wildcard ` +
                          `'${thing.target.name}', check your template`));
          else 
            throw new ThrownReturn(''); // produce nothing
        }

        lm.indent(() => {
          const latched =
                new ASTLatchedNamedWildcard(
                  walk(got, { correct_articles: correct_articles }), got);

          if (log_level__expand_and_walk)
            lm.log(`latched @${thing.target.name} to value: ` +
                   `${typeof latched.latched_value} ` +
                   `${abbreviate(compress(inspect_fun(latched.latched_value)))}`);

          context.named_wildcards.set(thing.target.name, latched);
        });
        
        throw new ThrownReturn(''); // produce nothing
      }
      // -------------------------------------------------------------------------------------------
      else if (thing instanceof ASTUnlatchNamedWildcard) {
        let got = context.named_wildcards.get(thing.name);

        if (!got)
          throw new ThrownReturn(warning_str(`Named wildcard '${thing.name}' not found`));

        if (! (got instanceof ASTLatchedNamedWildcard)) {
          if (double_unlatching_is_an_error)
            throw new ThrownReturn(warning_str(`tried to unlatch already-unlatched NamedWildcard ` +
                                               `'${thing.name}', check your template`));
          else
            throw new ThrownReturn(''); // produce nothing
        }
        
        context.named_wildcards.set(thing.name, got.original_value);

        if (context.noisy)
          lm.indent(() => lm.log(`unlatched ${thing.name} back to ` +
                                 `${thing_str_repr(got.original_value)}`));

        throw new ThrownReturn(''); // produce no text.
      } 
      // -------------------------------------------------------------------------------------------
      else if (thing instanceof ASTNamedWildcardDefinition) {
        if (context.named_wildcards.has(thing.name))
          if (true)
            lm.log(`WARNING: redefining named wildcard @${thing.name}, ` +
                   `you may not have intended to do this, check your template!`,
                   log_level__expand_and_walk);

        context.named_wildcards.set(thing.name, thing.wildcard);

        throw new ThrownReturn(''); // produce nothing
      }
      // -------------------------------------------------------------------------------------------
      // internal objects:
      // -------------------------------------------------------------------------------------------
      else if (thing instanceof ASTLatchedNamedWildcard) {
        throw new Error(`something has gone awry, ASTLatchedNamedWildcards shouldn't be ` +
                        `reached by walk, stop`);
        
      }
      // -------------------------------------------------------------------------------------------
      // scalar assignment:
      // -------------------------------------------------------------------------------------------
      else if (thing instanceof ASTScalarAssignment) {
        lm.indent(() =>  {
          // if (log_level__expand_and_walk >= 2)
          //   lm.log(`assigning ${thing_str_repr(thing.source)} ` +
          //          `to '${thing.destination.name}'`);
          
          let new_val = walk(thing.source,
                             { correct_articles: correct_articles });

          if (! thing.assign) {
            const old_val = context.scalar_variables.get(thing.destination.name)??'';
            new_val = smart_join([old_val, new_val],
                                 { correct_articles: correct_articles }); 
          }
          
          context.scalar_variables.set(thing.destination.name, new_val);

          if (true)
            lm.log(`$${thing.destination.name} = ${inspect_fun(new_val)}`,
                   log_level__expand_and_walk);
          
          throw new ThrownReturn(''); // produce nothing
        });
      }
      // -------------------------------------------------------------------------------------------
      // UpdateConfigurations:
      // -------------------------------------------------------------------------------------------
      else if (thing instanceof ASTUpdateConfigurationUnary ||
               thing instanceof ASTUpdateConfigurationBinary) {
        try {
          const type_is_okay = (val, type_or_types) =>
                (!type_or_types
                 ? true
                 : (Array.isArray(type_or_types)
                    ? type_or_types.includes(typeof val)
                    : typeof val === type_or_types));
          const fatal_errors = false;
          const error_fun = fatal_errors
                ? msg => { throw new Error(msg); }
                : msg => { throw new ThrownReturn(warning_str(msg)); };

          let value = thing.value;
          
          if (value instanceof ASTNode) {
            const expanded_value = lm.indent(() =>
              // don't correct articles in config values so that we don't mess up, e.g.,
              // %sampled = { Euler A AYS };
              expand_wildcards(thing.value, context, 
                               { correct_articles: false })); 
            // ^ not walk or correct_articles because we're going to parse it as JSON
            
            const jsconc_parsed_expanded_value = (thing instanceof ASTUpdateConfigurationUnary
                                                  ? RjsoncObject
                                                  : Rjsonc).match(expanded_value);

            if (thing instanceof ASTUpdateConfigurationBinary) {
              value = jsconc_parsed_expanded_value?.is_finished
                ? jsconc_parsed_expanded_value.value
                : expanded_value;
            }
            else { // ASTUpdateConfigurationUnary
              error_fun(`${thing.constructor.name}.value st expand to produce a valid ` +
                        `rJSONC object, Rjsonc.match(...) result was ` +
                        inspect_fun(jsconc_parsed_expanded_value));
            }
          }
          else {
            value = structured_clone(value); // do we need to clone this? I forget.
          }

          if (thing instanceof ASTUpdateConfigurationUnary) { 
            const new_obj  = {};
            const warnings = [];
            
            for (const key_name of Object.keys(value)) {
              const our_entry = get_our_configuration_key_entry(key_name);
              const our_name  = our_entry
                    ? our_entry[dt_hosted? 'dt_name' : 'automatic1111_name']
                    : key_name;

              if (!type_is_okay(value[key_name], our_entry?.expected_type)) {
                warnings.push(warning_str(`not assigning ${typeof value[key_name]} ` +
                                          `${inspect_fun(value[key_name])} ` + 
                                          `to configuration key '${our_name}', ` +
                                          `expected ${our_entry.expected_type}`));
                continue;
              }

              // lm.log(`set key ${our_name} to ${inspect_fun(value[key_name])} in new_obj`);
              
              new_obj[our_name] = value[key_name];
            }

            context.configuration = thing.assign
              ? new_obj
              : { ...context.configuration, ...new_obj };

            if (log_configuration_enabled)
              lm.indent(() => lm.log(`%config ${thing.assign ? '=' : '+='} ` +
                                     `${inspect_fun(new_obj, true)}`,
                                     log_level__expand_and_walk));
            if (warnings.length > 0)
              throw new ThrownReturn(warnings.join(' '));          
          }
          else { // ASTUpdateConfigurationBinary
            const our_entry = get_our_configuration_key_entry(thing.key);
            const our_name  = our_entry
                  ? our_entry[dt_hosted? 'dt_name' : 'automatic1111_name']
                  : thing.key;

            // lm.log(`FOUND ENTRY: ${abbreviate(compress(inspect_fun(our_entry)), false)}`);

            if (!type_is_okay(value, our_entry?.expected_type))
              throw new ThrownReturn(warning_str(`not assigning ${typeof value} ` +
                                                 `${inspect_fun(value)} ` + 
                                                 `to configuration key '${our_name}', ` +
                                                 `expected ${our_entry.expected_type}`));
            
            if (thing.assign) {
              context.configuration[our_name] = value;
            }
            else { // increment
              if (Array.isArray(value)) {
                const tmp_arr = context.configuration[our_name]??[];

                if (! Array.isArray(tmp_arr))
                  error_fun(`can't add array ${inspect_fun(value)} ` +
                            `to non-array ${inspect_fun(tmp_arr)} ` +
                            `in key ${inspect_fun(our_name)}`);
                
                const new_arr = [ ...tmp_arr, ...value ];

                if (log_level__expand_and_walk >= 2)
                  lm.log(`current value in key ${inspect_fun(our_name)} = ` + 
                         `${inspect_fun(context.configuration[our_name])}, ` +      
                         `increment by array ${inspect_fun(value)}, ` +             
                         `total ${inspect_fun(new_arr)}`); 
                
                context.configuration[our_name] = new_arr;
              }
              else if (typeof value === 'object') {
                const tmp_obj = context.configuration[our_name]??{};

                if (typeof tmp_obj !== 'object')
                  error_fun(`can't add object ${inspect_fun(value)} `+
                            `to non-object ${inspect_fun(tmp_obj)} ` +
                            `in key ${inspect_fun(our_name)}`);

                const new_obj = { ...tmp_obj, ...value };

                if (log_level__expand_and_walk >= 2)
                  lm.log(`current value in key ${inspect_fun(our_name)} = ` + 
                         `${inspect_fun(context.configuration[our_name])}, ` +      
                         `increment by object ${inspect_fun(value)}, ` +             
                         `total ${inspect_fun(new_obj)}`); 

                context.configuration[our_name] = new_obj;
              }
              else if (typeof value === 'number') {
                const tmp_num = context.configuration[our_name]??0;
                
                if (typeof tmp_num !== 'number')
                  error_fun(`can't add number ${inspect_fun(value)} `+
                            `to non-number ${inspect_fun(tmp_num)} ` +
                            `in key ${inspect_fun(our_name)}`);

                if (log_level__expand_and_walk >= 2)
                  lm.log(`current value in key ${inspect_fun(our_name)} = ` + 
                         `${inspect_fun(context.configuration[our_name])}, ` +
                         `increment by number ${inspect_fun(value)}, ` +
                         `total ${inspect_fun((context.configuration[our_name]??0) + value)}`);
                
                context.configuration[our_name] = tmp_num + value;
              }
              else if (typeof value === 'string') {
                const tmp_str = context.configuration[our_name]??'';

                if (typeof tmp_str !== 'string')
                  error_fun(`can't add string ${inspect_fun(value)} `+
                            `to non-string ${inspect_fun(tmp_str)} ` +
                            `in key ${inspect_fun(our_name)}`);

                if (log_level__expand_and_walk >= 2)
                  lm.log(`current value in key ${inspect_fun(our_name)} = ` + 
                         `${inspect_fun(context.configuration[our_name])}, ` +
                         `increment by string ${inspect_fun(value)}, ` +
                         `total ${inspect_fun((context.configuration[our_name]??'') + value)}`);

                context.configuration[our_name] =
                  lm.indent(() => smart_join([tmp_str, value],
                                             { correct_articles: false }));
                // ^ never correct here to avoid 'Euler An'
              }
              else {
                // probly won't work most of the time, but let's try anyhow, I guess:

                if (log_level__expand_and_walk >= 2)
                  lm.log(`current value in key ${inspect_fun(our_name)} = ` + 
                         `${inspect_fun(context.configuration[our_name])}, ` 
                         `incrementing by unknown type value ${inspect_fun(value)}, ` +
                         `total ${inspect_fun(context.configuration[our_name]??null + value)}`);

                context.configuration[our_name] = (context.configuration[our_name]??null) + value;
              }
            }

            if (log_configuration_enabled)
              lm.indent(() => lm.log(`%${our_name} ` +
                                     `${thing.assign ? '=' : '+='} ` +
                                     `${inspect_fun(value, true)}`,
                                     log_level__expand_and_walk));
          }

          throw new ThrownReturn(''); // produce nothing
        }
        finally {
          context.munge_configuration();
        }
      }
      // -------------------------------------------------------------------------------------------
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
        const walked    = picker_priority[lm.indent(() =>
          expand_wildcards(thing.limited_content,
                           context,
                           { correct_articles: false })).toLowerCase()];

        if (! picker_priority_descriptions.includes(walked))
          throw new Error(`invalid priority value: ${inspect_fun(walked)}`);

        context[prior_key] = context[cur_key];
        context[cur_key]   = walked;

        if (log_level__expand_and_walk >= 2)
          lm.indent(() => lm.log(`updated ${cur_key} from ${inspect_fun(cur_val)} to ` +
                                 `${inspect_fun(walked)}.`));
        
        throw new ThrownReturn(''); // produce nothing
      }
      // -------------------------------------------------------------------------------------------
      else if (thing instanceof ASTUIPrompt || thing instanceof ASTUINegPrompt) {
        const sub_prompt = thing instanceof ASTUIPrompt
              ? { desc: 'UI prompt', text: ui_prompt }
              : { desc: 'UI negative prompt', text: ui_neg_prompt };
        
        if (log_level__expand_and_walk >= 2)
          lm.log(`expanding ${sub_prompt.desc} ${inspect_fun(sub_prompt.text)}`);

        let res = null;

        try {
          res = Prompt.match(sub_prompt.text, 0, new Map());
        }
        catch(err) {
          if (err instanceof FatalParseError)
            throw new ThrownReturn(warning_str(`parsing ${sub_prompt.desc} failed: ${err}`));
          else
            throw err;
        }

        if (!res || !res.is_finished)
          throw new ThrownReturn(warning_str(`parsing ${sub_prompt.desc} did not finish`));

        let str = lm.indent(() => walk(res.value, { correct_articles: correct_articles })); ;
        
        if (thing.trailer && str.length > 0)
          str = smart_join([str, thing.trailer],
                           { correct_articles: false });
        
        throw new ThrownReturn(str);
      }
      // -------------------------------------------------------------------------------------------
      else if (thing instanceof ASTRevertPickSingle || 
               thing instanceof ASTRevertPickMultiple) {
        const cur_key = thing instanceof ASTRevertPickSingle
              ? 'pick_one_priority'
              : 'pick_multiple_priority';
        const prior_key = thing instanceof ASTRevertPickSingle
              ? 'pick_one_priority'
              : 'pick_multiple_priority';
        const cur_val   = context[cur_key];
        const prior_val = context[prior_key];
        
        if (log_configuration_enabled)
          lm.log(`Reverting ${cur_key} from ${inspect_fun(cur_val)} to ` +
                 `${inspect_fun(prior_val)}.`);
        
        context[cur_key]   = prior_val;
        context[prior_key] = cur_val;

        throw new ThrownReturn(''); // produce nothing
      }
      // -------------------------------------------------------------------------------------------
      // ASTLora:
      // -------------------------------------------------------------------------------------------
      else if (thing instanceof ASTLora) {
        if (context.in_lora)
          throw new Error(`don't nest LoRA inclusions, it's needlessly confusing!`);

        const in_lora_context = context.shallow_copy({ in_lora: true });
        
        let walked_file = null;

        lm.indent(() => {
          if (log_level__expand_and_walk)
            lm.log(`Expanding LoRA file ` +
                   `${thing_str_repr(thing.file,
                                     { always_include_type_str: true, length: 200 })}`);
          
          walked_file = lm.indent(() => expand_wildcards(thing.file, in_lora_context,
                                                         { correct_articles: false })); // not walk!

          if (log_level__expand_and_walk)
            lm.log(`expanded LoRa file `+
                   `${thing_str_repr(thing.file,
                                     { always_include_type_str: true, length: 200 })}`+
                   `is ` +
                   `${thing_str_repr(walked_file,
                                     { always_include_type_str: true, length: 200 })} `);
        });
        
        let walked_weight = null;
        
        lm.indent(() => {
          if (log_level__expand_and_walk)
            lm.log(`Expanding LoRA weight  ` +
                   `${thing_str_repr(thing.weight,
                                     { always_include_type_str: true, length: 200 })}`);
          
          walked_weight = lm.indent(() => expand_wildcards(thing.weight, in_lora_context,
                                                           { correct_articles: false })); // not walk!

          if (log_level__expand_and_walk)
            lm.log(`expanded LoRA weight ` +
                   `${thing_str_repr(thing.weight,
                                     { always_include_type_str: true, length: 200 })} is ` +
                   `${thing_str_repr(walked_weight,
                                     { always_include_type_str: true, length: 200 })}`);
        });

        const weight_match_result = json_number.match(walked_weight);

        if (!weight_match_result || !weight_match_result.is_finished)
          throw new Error(`LoRA weight must be a number, got ` +
                          `${inspect_fun(walked_weight)}`);

        let file = walked_file.toLowerCase();

        if (file === '')
          throw new Error(`LoRA file name is empty!`);
        
        if (file.endsWith('.ckpt')) {
          // do nothing 
        }
        else if (file.endsWith('_lora_f16'))
          file = `${file}.ckpt`;
        else if (file.endsWith('_lora'))
          file = `${file}_f16.ckpt`;
        else
          file = `${file}_lora_f16.ckpt`;

        const weight = weight_match_result.value;
        
        context.add_lora_uniquely({ file: file, weight: weight });
        
        throw new ThrownReturn(''); // produce nothing
      }
      // ------------------------ -------------------------------------------------------------------
      // uncrecognized type:
      // -------------------------------------------------------------------------------------------
      else {
        throw new Error(`confusing thing: ` +
                        (typeof thing === 'object'
                         ? thing?.constructor.name
                         : typeof thing) +
                        ' ' +
                        inspect_fun(thing));
      }
    }
    catch (obj) {
      if (! (obj instanceof ThrownReturn))
        throw obj;

      if (! obj.quiet)
        if (log_level__expand_and_walk)
          lm.log(`walking ` +
                 `${thing_str_repr(thing, { always_include_type_str: true, length: 200})} ` + 
                 //`in ${context} ` +
                 `=> ` +
                 `${thing_str_repr(obj.value, { always_include_type_str: true, length: 200 })}`);

      return obj.value;
    }
  }

  if (log_level__expand_and_walk)
    lm.log(`Expanding wildcards in ` +
           `${thing_str_repr(thing, { always_include_type_str: true, length: 200 })} `);

  let ret;

  lm.indent(() => {
    const walked = walk(thing, { correct_articles: correct_articles })
    ret = walked;
  });

  if (log_level__expand_and_walk)
    lm.log(`expanding wildcards in ` +
           `${thing_str_repr(thing)} ` + 
           `=> ` +
           `${thing_str_repr(ret, { always_include_type_str: true, length: 200 })}`);

  if (ret === '""' || ret === "''")
    throw new Error(`sus expansion ${inspect_fun(ret)} of ${inspect_fun(thing)}`);

  return ret.replace(/\\</g, '<');
}
// =================================================================================================
// END OF THE MAIN AST-WALKING FUNCTION.
// =================================================================================================


// =================================================================================================
// SEMANTICS AUDITING FUNCTION.
// =================================================================================================
const audit_semantics_modes = Object.freeze({
  throw_error: 'error',
  warnings:    'warnings',
  // no_track:          'no_track',
});
// -------------------------------------------------------------------------------------------------
function audit_semantics(root_ast_node,
                         { base_context = null,
                           audit_semantics_mode = audit_semantics_modes.warnings } = {}) {
  if (root_ast_node === undefined)
    throw new Error(`bad audit_semantics args: ` +
                    `${abbreviate(compress(inspect_fun(arguments)))}, ` +
                    `this likely indicates a programmer error`);
  // -----------------------------------------------------------------------------------------------
  function walk_children(thing, mode, warnings_arr, as_if_parallel, visited, no_errors) {
    if (!(thing &&
          Object.values(audit_semantics_modes).includes(mode) &&
          Array.isArray(warnings_arr) &&
          typeof as_if_parallel == 'boolean' &&
          visited instanceof Set && 
          typeof no_errors == 'boolean'))
      throw new Error(`bad walk_children args: ` +
                      `${abbreviate(compress(inspect_fun(arguments)))}`);
    
    const children = thing.direct_children().filter(child => !is_primitive(child));

    if (children.length > 0)
      walk(children, mode, warnings_arr, as_if_parallel, visited, no_errors); 
  }
  // -----------------------------------------------------------------------------------------------
  function warn_or_throw(msg, warnings_arr, mode, no_errors) {
    if (!(typeof msg === 'string' &&
          Array.isArray(warnings_arr) &&
          Object.values(audit_semantics_modes).includes(mode) &&
          typeof no_errors === 'boolean'))
      throw new Error(`bad warn_or_throw args: ` +
                      `${inspect_fun(arguments)}`);

    // if (no_errors)
    //   throw new Error("trap");
    
    if (no_errors)
      return; // only like 80% sure on this?
    
    // if (mode === audit_semantics_modes.no_errors)
    //   mode = audit_semantics_modes.warnings;
    
    msg = `${mode.toUpperCase()}: ${msg}`;

    if (mode === audit_semantics_mode.throw_error) {
      throw new Error(msg);
    }
    else if (mode === audit_semantics_modes.warnings) {  
      if (log_level__audit >= 2)
        lm.log(`PUSH WARNING '${msg}'`);
      warnings_arr.push(msg);
    }
    // else if (mode == audit_semantics_modes.no_errors) {
    //   //   msg = `${mode.toUpperCase()}: ${msg}`;
    //   //   if (log_level__audit >= 2)
    //   //     lm.log(`PUSH WARNING '${msg}'`);
    //   //   warnings_arr.push(msg);
    // }
    else
      throw new Error(`what do?" ${inspect_fun(mode)}`);
  }
  // -----------------------------------------------------------------------------------------------
  function warn_or_throw_unless_flag_could_be_set_by_now(verb, flag, warnings_arr, mode, visited, no_errors) {
    if (!(typeof verb == 'string' &&
          Array.isArray(flag) &&
          Array.isArray(warnings_arr) &&
          Object.values(audit_semantics_modes).includes(mode) &&
          visited instanceof Set && 
          typeof no_errors === 'boolean'))
      throw new Error(`bad warn_or_throw_unless_flag_could_be_set_by_now args: ` +
                      `${abbreviate(compress(inspect_fun(arguments)))}`);

    // if (no_errors)
    //   throw new Error("trap");
    
    // if (mode === audit_semantics_modes.no_errors) {
    //   if (log_level__audit >= 1)
    //     lm.log(`skip checking flag ${flag} because no_errors`);
    //   return;
    // }
    
    if (dummy_context.flag_is_set(flag)) {
      if (log_level__audit >= 1)
        lm.log(`flag ${flag} could be set by now`);
      return;
    }
    
    const flag_str = flag.join(".").toLowerCase();
    const known_flags = dummy_context.flags.map(f => f.join("."));
    const suggestion = suggest_closest(flag_str, known_flags);
    warn_or_throw(`flag '${flag_str}' is ${verb} before it could possibly be set. ` +
                  `Maybe this was intentional, but it could suggest that you may made have ` +
                  `a typo or other error in your template.${suggestion}`,
                  warnings_arr,
                  mode,
                  no_errors);
  }
  // -----------------------------------------------------------------------------------------------
  function visited_hash(thing) {
    let str = '';

    str += thing_str_repr(thing, { length: Infinity, always_include_type_str: true });
    str += thing_str_repr(dummy_context.flags, { length: Infinity, always_include_type_str: true });
    
    return str;
  }
  // ===============================================================================================
  function walk(thing, local_audit_semantics_mode, warnings_arr, as_if_parallel, visited, no_errors) { 
    if (!(thing &&
          Object.values(audit_semantics_modes).includes(local_audit_semantics_mode) &&
          Array.isArray(warnings_arr) &&
          typeof as_if_parallel == 'boolean' &&
          visited instanceof Set && 
          typeof no_errors == 'boolean'))
      throw new Error(`bad walk args: ${inspect_fun(arguments)}`);
    // ---------------------------------------------------------------------------------------------
    if (is_primitive(thing))
      return;

    const hash = thing;
    // const hash = visited_hash(thing);
    
    if (visited.has(hash)) {
      if (log_level__audit >= 2)
        lm.log(`already audited ` +
               `${compress(thing_str_repr(thing, { always_include_type_str: true, length: 200}))}`);
      
      return;
    }

    // if (!as_if_parallel && // not sure if prudent
    //     !no_errors)
    visited.add(hash);

    if (log_level__audit >= 2)
      lm.log(
        `(${local_audit_semantics_mode[0].toUpperCase()}) ` + 
          `${as_if_parallel? 'speculatively ' : ''}audit semantics in ` +
          `${compress(thing_str_repr(thing, { always_include_type_str: true, length: 200}))}, ` +
          `flags: ${abbreviate(compress(inspect_fun(dummy_context.flags)), 200)}`);

    lm.indent(() => {
      // ======================================g=====================================================
      // typecases:
      // ===========================================================================================
      if (Array.isArray(thing)) {
        for (const elem of thing)
          if (!is_primitive(elem))
            walk(elem, local_audit_semantics_mode, warnings_arr, as_if_parallel, visited, no_errors);
        // ^ propagate local_audit_semantics_mode
      }
      // -------------------------------------------------------------------------------------------
      else if (thing instanceof ASTNamedWildcardDefinition) {
        if (dummy_context.named_wildcards.has(thing.name)) {
          if (no_errors)
            return;
          
          warn_or_throw(`redefining named wildcard @${thing.name}, ` +
                        `you may not have intended to do this, check your template!`,
                        warnings_arr);
        }
        
        dummy_context.named_wildcards.set(thing.name, thing.wildcard);
      }
      // -------------------------------------------------------------------------------------------
      else if (thing instanceof ASTNamedWildcardReference) {
        const got = dummy_context.named_wildcards.get(thing.name);
        
        if (!got) {
          if (no_errors)
            return;
          
          const known_names = Array.from(dummy_context.named_wildcards.keys());
          const suggestion  = suggest_closest(thing.name, known_names);
          warn_or_throw(`named wildcard @${thing.name} referenced before definition, ` +
                        `this suggests that you may have a typo or other error in your template.` +
                        `${suggestion}`,
                        warnings_arr);
        }

        walk(got, local_audit_semantics_mode, warnings_arr, true, visited, no_errors); // start as_if_parallel
      }
      // -------------------------------------------------------------------------------------------
      else if (thing instanceof ASTAnonWildcard) {
        const all_options = thing.picker.options.map(x => x.value);
        
        if (as_if_parallel) {
          const currently_legal_options =
                thing.picker
                .split_options(dummy_context.picker_allow_fun,
                               dummy_context.picker_forbid_fun)
                .legal_options.map(x => x.value);

          // to avoid infinite loops while performing the first pass, we'll use copy of visited.
          // then, for the second pass we'll switch back to the original to allow revisiting:
          const visited_copy = new Set(visited);
          
          if (log_level__audit >= 1)
            lm.log(`NO_ERRORS PASS (legal):`);
          lm.indent(() =>
            walk(currently_legal_options,
                 local_audit_semantics_mode,
                 warnings_arr,
                 as_if_parallel, // or maybe false?
                 visited_copy,
                 true));

          if (log_level__audit >= 1)
            lm.log(`${local_audit_semantics_mode.toUpperCase()} PASS:`);
          lm.indent(() =>
            walk(all_options,
                 local_audit_semantics_mode,
                 warnings_arr,
                 false, // not 100% sure 'bout this yet but it seems to work.
                 visited,
                 no_errors)); 
        }
        else {
          walk(all_options,
               local_audit_semantics_mode,
               warnings_arr,
               as_if_parallel,
               visited,
               no_errors);
        }
      }
      // -------------------------------------------------------------------------------------------
      else if (thing instanceof ASTScalarReference) {
        if (!dummy_context.scalar_variables.has(thing.name)) {
          if (no_errors)
            return;
          
          const known_names = Array.from(dummy_context.scalar_variables.keys());
          const suggestion = suggest_closest(thing.name, known_names);
          warn_or_throw(`scalar variable $${thing.name} referenced before definition, ` +
                        `this suggests that you may have a made typo or other error in your ` +
                        `template.${suggestion}`,
                        warnings_arr,
                        local_audit_semantics_mode,
                        no_errors);
        }
        else {
          const got = dummy_context.scalar_variables.get(thing.name);

          // lm.log(`GOT: ${got}`);
          
          walk(got, local_audit_semantics_mode, warnings_arr, as_if_parallel, visited, no_errors); // ??
          // ^ propagate local_audit_semantics_mode
        }
      }
      // -------------------------------------------------------------------------------------------
      else if (thing instanceof ASTScalarAssignment) {
        dummy_context.scalar_variables.set(thing.destination.name, "doesn't matter");
        walk_children(thing, local_audit_semantics_mode, warnings_arr, as_if_parallel, visited, no_errors);
        // ^ propagate local_audit_semantics_mode
      }
      // -------------------------------------------------------------------------------------------
      else if (thing instanceof ASTCheckFlags) {
        if (thing.consequently_set_flag_tail) {
          // undecided on whether this case deserves a warning... for now, let's avoid one:
          dummy_context.set_flag([ ...thing.flags[0], ...thing.consequently_set_flag_tail ], false);
        }
        else if (!no_errors) {
          for (const flag of thing.flags) 
            warn_or_throw_unless_flag_could_be_set_by_now('checked',
                                                          flag, warnings_arr,
                                                          local_audit_semantics_mode,
                                                          visited,
                                                          no_errors);
        }
      }
      // -------------------------------------------------------------------------------------------
      else if (thing instanceof ASTNotFlag) {
        if (thing.consequently_set_flag_tail)
          // undecided on whether this case deserves a warning... for now, let's avoid one:
          dummy_context.set_flag([ ...thing.flag, ...thing.consequently_set_flag_tail ], false);
        else if (thing.set_immediately) 
          // this case probably doesn't deserve a warning, avoid one:
          dummy_context.set_flag(thing.flag, false);
        else if (!no_errors)
          warn_or_throw_unless_flag_could_be_set_by_now('checked',
                                                        thing.flag, warnings_arr,
                                                        local_audit_semantics_mode,
                                                        visited,
                                                        no_errors);
      }
      // -------------------------------------------------------------------------------------------
      else if (thing instanceof ASTSetFlag) {
        dummy_context.set_flag(thing.flag, false);
      } 
      // -------------------------------------------------------------------------------------------
      else if (thing instanceof ASTUnsetFlag) {
        if (no_errors)
          return;
        warn_or_throw_unless_flag_could_be_set_by_now('unset',
                                                      thing.flag, warnings_arr,
                                                      local_audit_semantics_mode,
                                                      visited,
                                                      no_errors);
      }
      // -------------------------------------------------------------------------------------------
      else if (thing instanceof ASTAnonWildcardAlternative) {
        walk_children(thing, local_audit_semantics_mode, warnings_arr, as_if_parallel, visited, no_errors);
        // ^ propagate local_audit_semantics_mode
      }
      // -------------------------------------------------------------------------------------------
      else if (thing instanceof ASTNode) {
        walk_children(thing, local_audit_semantics_mode, warnings_arr, as_if_parallel, visited, no_errors);
        // ^ try allowing propagate here
        
        // lm.log(`won't propagate local mode through ${thing.constructor.name}`);
        // walk_children(thing, audit_semantics_mode, warnings_arr);
        // // ^ don't propagate local_audit_semantics_mode to other node types by default?
      }
      // -------------------------------------------------------------------------------------------
      else {
        throw new Error(`unrecognized thing: ${thing_str_repr(thing)}`);
      }
    });
  }

  const dummy_context = base_context
        ? base_context.clone()
        : new Context();
  const warnings =  [];

  walk(root_ast_node, audit_semantics_mode, warnings, false, new Set(), false);

  if (log_level__audit >= 1)
    lm.log(`all flags: ${inspect_fun(dummy_context.flags)}`);

  return warnings;
}
// =================================================================================================
// END OF THE SEMANTICS AUDITING FUNCTION.
// =================================================================================================


// =================================================================================================
// SD PROMPT AST CLASSES SECTION:
// =================================================================================================
class ASTNode {
  // -----------------------------------------------------------------------------------------------
  direct_children() {
    const ret = Array.from(this.__direct_children());
    
    return ret;
  }
  // -----------------------------------------------------------------------------------------------
  __direct_children() {
    // doesn't necessarily need to (but could) include whildren that are not ASTNodes.
    throw new Error(`__direct_children is not implemented by ${this.constructor.name}`);
  }
}
// -------------------------------------------------------------------------------------------------
class ASTLeafNode extends ASTNode {
  // -----------------------------------------------------------------------------------------------
  __direct_children() {
    return [];
  }
}
// -------------------------------------------------------------------------------------------------
// Flags:
// -------------------------------------------------------------------------------------------------
class ASTSetFlag extends ASTLeafNode {
  constructor(flag_arr) {
    super();
    this.flag = flag_arr;
  }
  // -----------------------------------------------------------------------------------------------
  toString() {
    return `#${this.flag.join('.')}`;
  }
}
// --------------------------------------------------------------------------------------------------
class ASTUnsetFlag extends ASTLeafNode {
  constructor(flag_arr) {
    super();
    this.flag = flag_arr;
  }
  // -----------------------------------------------------------------------------------------------
  toString() {
    return `#!${this.flag.join('.')}`;
  }
}
// --------------------------------------------------------------------------------------------------
class ASTCheckFlags extends ASTLeafNode {
  constructor(flag_arrs, consequently_set_flag_tail) {
    super();

    if (consequently_set_flag_tail && flag_arrs.length != 1 )
      throw new Error(`don't supply consequently_set_flag_tail when flag_arrs.length != 1`);

    this.flags = flag_arrs;
    this.consequently_set_flag_tail = consequently_set_flag_tail;
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
  }
}
// -------------------------------------------------------------------------------------------------
class ASTNotFlag extends ASTLeafNode  { 
  constructor(flag_arr, { set_immediately = undefined,
                          consequently_set_flag_tail = undefined } = {}) {
    super();

    if (set_immediately && consequently_set_flag_tail)
      throw new Error(`don't supply both set_immediately and consequently_set_flag_tail`);

    this.flag                       = flag_arr;
    this.consequently_set_flag_tail = consequently_set_flag_tail
    this.set_immediately            = set_immediately;
  }
  // ----------------------------------------------------------------------------------------------
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
// ASTNamedWildcardDefinition;
// -------------------------------------------------------------------------------------------------
class ASTNamedWildcardDefinition extends ASTNode {
  constructor(name, wildcard) {
    super();
    this.name = name;
    this.wildcard = wildcard;
  }
  // -----------------------------------------------------------------------------------------------
  __direct_children() {
    return [ this.wildcard ];
  }
  // -----------------------------------------------------------------------------------------------
  toString() {
    return `@${this.name} = ${this.wildcard}`;
  }
}
// -------------------------------------------------------------------------------------------------
// ASTNamedWildcardReference:
// -------------------------------------------------------------------------------------------------
class ASTNamedWildcardReference extends ASTLeafNode {
  constructor(name, joiner = '', capitalize = '', min_count = 1, max_count = 1, trailer = '') {
    super();
    this.name       = name;
    this.joiner     = joiner;
    this.capitalize = capitalize;
    this.min_count  = min_count;
    this.max_count  = max_count;
    this.trailer    = trailer;
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
    }

    if (this.joiner)
      str += this.joiner;

    str += this.name;

    if (this.trailer)
      str += this.trailer;
    
    return str;
  };
}
// -------------------------------------------------------------------------------------------------
// Scalar references:
// -------------------------------------------------------------------------------------------------
class ASTScalarReference extends ASTLeafNode {
  constructor(name, capitalize = '', trailer = '') {
    super();
    this.name       = name;
    this.capitalize = capitalize;
    this.trailer    = trailer;
  }
  // -----------------------------------------------------------------------------------------------
  toString() {
    let str = '$';

    if (this.capitalize)
      str += this.capitalize;

    str += this.name;
    
    if (this.trailer)
      str += this.trailer;
    
    return str;
  }
}
// -------------------------------------------------------------------------------------------------
// Scalar assignment:
// -------------------------------------------------------------------------------------------------
class ASTScalarAssignment extends ASTNode  {
  constructor(destination, source, assign) {
    super();
    this.destination = destination;
    this.source      = source;
    this.assign      = assign;
  }
  // -----------------------------------------------------------------------------------------------
  __direct_children() {
    return [ this.source ]; // exclude this.destination, it's just a boxed name
  }
  // -----------------------------------------------------------------------------------------------
  toString() {
    return `$${this.destination.name} ${this.assign? '=' : '+='} ${this.source.toString()}`;
  }
}
// -------------------------------------------------------------------------------------------------
// ASTLora (for A1111-style LoRA syntax);
// -------------------------------------------------------------------------------------------------
class ASTLora extends ASTNode {
  constructor(file, weight) {
    super();
    this.file   = file;
    this.weight = weight;
  }
  // -----------------------------------------------------------------------------------------------
  __direct_children() {
    return [ this.file, this.weight ];
  }
  // -----------------------------------------------------------------------------------------------
  toString(with_types = false ) {
    return `<lora:${with_types ? `${this.file.constructor.name} ` : ``}${this.file}: ` +
      `${with_types ? `${this.weight.constructor.name} ` : ``}${this.weight}>`;
  }
}
// -------------------------------------------------------------------------------------------------
// ASTLatchNamedWildcard:
// -------------------------------------------------------------------------------------------------
class ASTLatchNamedWildcard extends ASTNode {
  constructor(ident) {
    super();
    this.target = new ASTNamedWildcardReference(ident);
  }
  // -----------------------------------------------------------------------------------------------
  __direct_children() {
    return [ this.target ]; 
  }
  // -----------------------------------------------------------------------------------------------
  toString() {
    return `@#${this.target.name}`;
  }
}
// -------------------------------------------------------------------------------------------------
// ASTUnlatchNamedWildcard:
// -------------------------------------------------------------------------------------------------
class ASTUnlatchNamedWildcard extends ASTLeafNode {
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
// ASTLatchedNamedWildcard:
// -------------------------------------------------------------------------------------------------
class ASTLatchedNamedWildcard extends ASTNode {
  constructor(latched_value, original_value) {
    super();
    this.latched_value  = latched_value;
    this.original_value = original_value;
  }
  // -----------------------------------------------------------------------------------------------
  __direct_children() {
    return [ this.original_value, /* this.latched_value */ ]; // not sure?
  }
  // -----------------------------------------------------------------------------------------------
  toString() {
    return this.original_value.toString();
  }
}
// -------------------------------------------------------------------------------------------------
// ASTAnonWildcard:
// -------------------------------------------------------------------------------------------------
class ASTAnonWildcard extends ASTNode {
  constructor(options, { trailer = null } = {}) {
    super();
    this.picker = new WeightedPicker(options
                                     .filter(o => o.weight !== 0)
                                     .map(o => [o.weight, o]));
    this.trailer = trailer;
  }
  // -----------------------------------------------------------------------------------------------
  __direct_children() {
    return this.picker.options.values().map(x => x.value);
  }
  // -----------------------------------------------------------------------------------------------
  pick(...args) {
    return this.picker.pick(...args);
  }
  // -----------------------------------------------------------------------------------------------
  toString() {
    let str = '';
    
    str += '{';

    for (let ix = 0; ix < this.picker.options.length; ix++) {
      const option     = this.picker.options[ix];
      const repr       = option.value.toString();
      const has_weight = option.weight != 1;
      const is_empty   = repr == '';
      const is_last    = ix == (this.picker.options.length - 1);
      const has_guards = (option.value.check_flags?.length > 0 ||
                          option.value.not_flags?.length   > 0);
      
      if (!is_empty && !has_weight && !has_guards)
        str += ' ';

      str += repr;

      if (!is_empty)
        str += ' ';

      if (!is_last)
        str += '|';
    }
    
    str += '}';
    
    if (this.trailer)
      str += this.trailer;
    
    return str;
  }
}
// -------------------------------------------------------------------------------------------------
// ASTAnonWildcardsAlternative:
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
  __direct_children() {
    return  [
      ...this.check_flags,
      ...this.not_flags,
      ...this.body,
    ];
  }
  // -----------------------------------------------------------------------------------------------
  toString() {
    var str = '';

    if (this.weight !== 1)
      str += `${this.weight} `;

    var strs = [];

    for (const check of this.check_flags)
      strs.push(check.toString());
    
    for (const not of this.not_flags)
      strs.push(not.toString());

    if (this.body.length >= 1)
      for (const thing of this.body)
        strs.push(thing.toString());
    else
      strs.push(`ε`);

    str += strs.join(' ');
    
    return str;
  }
}
// -------------------------------------------------------------------------------------------------
// ASTInclude:
// -------------------------------------------------------------------------------------------------
class ASTInclude extends ASTLeafNode {
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
// ASTUpdateConfigurationUnary:
// -------------------------------------------------------------------------------------------------
class ASTUpdateConfigurationUnary extends ASTNode {
  constructor(value, assign) {
    super();
    this.value = value;
    this.assign = assign; // otherwise update
  }
  // -----------------------------------------------------------------------------------------------
  __direct_children() {
    return is_plain_object(this.value) ? [] : [ this.value ];
  }
  // -----------------------------------------------------------------------------------------------
  toString() {
    return `%config ${this.assign? '=' : '+='} ` +
      `${this.value instanceof ASTNode || Array.isArray(this.value)
         ? this.value
         : inspect_fun(this.value)}`;
  }
}
// -------------------------------------------------------------------------------------------------
// ASTUpdateConfigurationBinary:
// -------------------------------------------------------------------------------------------------
class ASTUpdateConfigurationBinary extends ASTNode {
  constructor(key, value, assign) {
    super();
    this.key    = key;
    this.value  = value;
    this.assign = assign;
  }
  // -----------------------------------------------------------------------------------------------
  __direct_children() {
    return is_primitive(this.value) ? [] :  [ this.value ];
  }
  // -----------------------------------------------------------------------------------------------
  toString() {
    return `%${get_our_configuration_key_name(this.key)} ${this.assign? '=' : '+='} ` +
      `${this.value instanceof ASTNode || Array.isArray(this.value)
           ? this.value
           : inspect_fun(this.value)}`;
  }
}
// -------------------------------------------------------------------------------------------------
// ASTSetPickMultiple:
// -------------------------------------------------------------------------------------------------
class ASTSetPickMultiple extends ASTNode {
  constructor(limited_content) {
    super();
    this.limited_content = limited_content;
  }
  // -----------------------------------------------------------------------------------------------
  __direct_children() {
    return [ this.limited_content ];
  }
  // -----------------------------------------------------------------------------------------------
  toString() {
    return `%multi-pick = ${this.limited_content}`;
  }
}
// -------------------------------------------------------------------------------------------------
// ASTSetPickSingle:
// -------------------------------------------------------------------------------------------------
class ASTSetPickSingle extends ASTNode {
  constructor(limited_content) {
    super();
    this.limited_content = limited_content;
  }
  // -----------------------------------------------------------------------------------------------
  __direct_children() {
    return [ this.limited_content ];
  }
  // -----------------------------------------------------------------------------------------------
  toString() {
    return `%single-pick = ${this.limited_content}`;
  }
}
// -------------------------------------------------------------------------------------------------
// ASTRevertPickMultiple:
// -------------------------------------------------------------------------------------------------
class ASTRevertPickMultiple extends ASTLeafNode {
  constructor() {
    super();
  }
  // -----------------------------------------------------------------------------------------------
  toString() {
    return `%revert-pick-multi`;
  }
}
// -------------------------------------------------------------------------------------------------
// ASTRevertPickSingle:
// -------------------------------------------------------------------------------------------------
class ASTRevertPickSingle extends ASTLeafNode {
  constructor() {
    super();
  }
  // -----------------------------------------------------------------------------------------------
  toString() {
    return `%revert-pick-single`;
  }
}
// -------------------------------------------------------------------------------------------------
// ASTUIPrompt:
// -------------------------------------------------------------------------------------------------
class ASTUIPrompt extends ASTLeafNode {
  constructor(trailer) {
    super();
    this.trailer = trailer;
  }
  // -----------------------------------------------------------------------------------------------
  toString() {
    let str = `%ui-prompt`;
    
    if (this.trailer)
      str += this.trailer;
    
    return str;
  }
}
// -------------------------------------------------------------------------------------------------
// ASTUINegPrompt:
// -------------------------------------------------------------------------------------------------
class ASTUINegPrompt extends ASTLeafNode {
  constructor(trailer) {
    super();
    this.trailer = trailer;
  }
  // -----------------------------------------------------------------------------------------------
  toString() {
    let str = `%ui-neg-prompt`;
    
    if (this.trailer)
      str += this.trailer;
    
    return str;
  }
}
// =================================================================================================
// END OF SD PROMPT AST CLASSES SECTION.
// =================================================================================================


// =================================================================================================
// SD PROMPT GRAMMAR SECTION:
// =================================================================================================
// structural_word_break and its helper combinators:
// =================================================================================================
const comment_beginning       = raw`\/\/|\/\*`;
const structural_chars            = '{|}';
// const structural_word_break_ahead = r_raw`(?=[\s${structural_chars}]|$|${comment_beginning})`
const structural_word_break_ahead = r_raw`(?=[\s${structural_chars}]|${comment_beginning}|$)`
      .abbreviate_str_repr('structural_word_break_ahead');
const structural_close_ahead      = r(/(?=\s*})/)
      .abbreviate_str_repr('structural_close_ahead');
// -------------------------------------------------------------------------------------------------
const with_swb                = rule => head(rule, structural_word_break_ahead);
const cutting_with_swb        = rule => cutting_head(rule, structural_word_break_ahead);
const sj_merge                = (rule, { correct_articles = true } = {}) =>
      xform(arr => smart_join_merge(arr, { correct_articles: correct_articles }), rule);
// =================================================================================================
// terminals:
// =================================================================================================
const any_assignment_operator = choice(equals, plus_equals)
      .abbreviate_str_repr('any_assignment_operator');
const comments                = wst_star(c_comment)
      .abbreviate_str_repr('comments');
const discarded_comment       = discard(c_comment)
      .abbreviate_str_repr('discarded_comment');
const discarded_comments      = discard(wst_star(c_comment))
      .abbreviate_str_repr('discarded_comments');
const dot_hash                = l('.#')
      .abbreviate_str_repr('dot_hash');
const filename                = r(/[A-Za-z0-9 ._\-()]+/)
      .abbreviate_str_repr('filename');
const ident                   =
      xform(r(/[a-zA-Z_-][0-9a-zA-Z_-]*\b/),
            str => str.toLowerCase().replace(/-/g, '_'))
      .abbreviate_str_repr('ident');
const swb_uint                = xform(parseInt, with_swb(uint))
      .abbreviate_str_repr('swb_uint');
const punctuation_trailer          = r(/(?:\.\.\.|[,.!?])/);
const optional_punctuation_trailer = optional(punctuation_trailer)
      .abbreviate_str_repr('optional_punctuation_trailer');
const unexpected_punctuation_trailer = unexpected(punctuation_trailer)
      .abbreviate_str_repr('unexpected_punctuation_trailer');
// =================================================================================================
// plain_text terminal variants:
// =================================================================================================
const syntax_chars            = raw`@#$%`;
// const pseudo_structural_chars = raw`<\(\)\[\]`;
// -------------------------------------------------------------------------------------------------
const make_plain_text_rule = (additional_excluded_chars = '') => {
  const plain_text_re_front_part =
        raw`(?:` +
        raw  `(?:\\.|(?![\s${syntax_chars}${structural_chars}${additional_excluded_chars}]|${comment_beginning})\S)` +
        raw  `(?:\\.|(?![\s${structural_chars}${additional_excluded_chars}]|${comment_beginning})\S)*?` +
        raw`)`;

  const alternative_1 = plain_text_re_front_part + `?` + raw`(?:<+|[(\[]+)(?=[@$])`;
  const alternative_2 = plain_text_re_front_part +       raw`(?:<+|(?=[\s${structural_chars}]|$))`;

  const plain_text_re_src = alternative_1 + `|`  + alternative_2;

  // lm.log(`RE: ${plain_text_re_src}`);

  return xform(r(plain_text_re_src),
               str => str
               .replace(/^<+/,    '<')
               .replace(/<+$/,    '<')
               .replace(/\\n/g,   '\n')
               .replace(/\\ /g,   ' ')
               .replace(/\\([^<])/g, '$1'));
};
// -------------------------------------------------------------------------------------------------
const plain_text           = make_plain_text_rule()
      .abbreviate_str_repr('plain_text');
const plain_text_no_semis  = make_plain_text_rule(';')
      .abbreviate_str_repr('plain_text_no_semis');
// =================================================================================================
// A1111-style LoRAs:
// =================================================================================================
const A1111StyleLoraWeight = choice(/\d*\.\d+/, uint)
      .abbreviate_str_repr('A1111StyleLoraWeight');
const A1111StyleLora =
      xform(arr => new ASTLora(arr[2], arr[3]),
            wst_cutting_seq(
              seq(ltri, lws('lora')),                              // [0]
              colon,                                               // [1] 
              choice(filename, () => LimitedContentNoAwcSJMergeArticleCorrectionOrTrailer), // [2]
              optional(wst_cadr(colon,                             // [3]
                                choice(A1111StyleLoraWeight,
                                       () => LimitedContentNoAwcSJMergeArticleCorrectionOrTrailer)),
                       "1.0"),
              rtri))
      .abbreviate_str_repr('A1111StyleLora');
// =================================================================================================
// mod RJSONC:
// =================================================================================================
const ExposedRjsonc = 
      make_Jsonc_rule(choice(head(choice(RjsoncObject,
                                         RjsoncArray,
                                         rjsonc_string),
                                  optional(() => SpecialFunctionTail)),
                             head(choice(json_null,
                                         json_true,
                                         json_false,
                                         json_number),
                                  () => SpecialFunctionTail))); 
// =================================================================================================
// flag-related rules:
// =================================================================================================
const make_flag_ident_rule = (additional_choices = []) =>
      xform(seq(additional_choices.length == 0 ? ident : choice(ident, ...additional_choices),
                star(cadr('.', choice(xform(parseInt, /\d+\b/), ident, ...additional_choices)))),
            arr => [arr[0], ...arr[1]]);
const flag_ident = make_flag_ident_rule('*');
const flag_ident_no_wcs = make_flag_ident_rule();
const SimpleCheckFlag =
      xform(with_swb(seq(question,
                         flag_ident)),
            arr => {
              const args = [arr[1]];
              return new ASTCheckFlags(args);
            })
      .abbreviate_str_repr('SimpleCheckFlag');
const SimpleNotFlag =
      xform(with_swb(seq(bang,
                         optional(hash),
                         flag_ident)),
            arr => {
              const args = [arr[2],
                            { set_immediately: !!arr[1]}];
              return new ASTNotFlag(...args);
            })
      .abbreviate_str_repr('SimpleNotFlag');
const CheckFlagWithSetConsequent =
      xform(cutting_with_swb(seq(question,     // [0]
                                 flag_ident,   // [1]
                                 dot_hash,     // [2]
                                 flag_ident_no_wcs)), // [3]
            arr => {
              const args = [ [ arr[1] ], arr[3] ]; 
              return new ASTCheckFlags(...args);
            })
      .abbreviate_str_repr('CheckFlagWithSetConsequent');
const CheckFlagWithOrAlternatives = // last check alternative, therefore cutting_seq
      xform(cutting_seq(question,                     // [0]
                        plus(flag_ident, comma),      // [1]
                        structural_word_break_ahead), // [2]
            arr => {
              const args = [arr[1]];
              return new ASTCheckFlags(...args);
            })
      .abbreviate_str_repr('CheckFlagWithOrAlternatives');
const NotFlagWithSetConsequent = // last not alternative, therefore cutting_seq
      xform(cutting_seq(bang,                         // [0]
                        flag_ident,                   // [1]
                        dot_hash,                     // [2]
                        flag_ident_no_wcs,            // [3]
                        structural_word_break_ahead), // - 
            arr => {
              const args = [arr[1],
                            { consequently_set_flag_tail: arr[3]}]; 
              return new ASTNotFlag(...args);
            })
      .abbreviate_str_repr('NotFlagWithSetConsequent');
// -------------------------------------------------------------------------------------------------
const SetFlag   =
      xform(arr => new ASTSetFlag(arr),
            cutting_cadr(hash, flag_ident_no_wcs, structural_word_break_ahead))
      .abbreviate_str_repr('SetFlag');
const UnsetFlag =
      xform(arr=> new ASTUnsetFlag(arr),
            cutting_cadr(shebang, flag_ident_no_wcs, structural_word_break_ahead))
      .abbreviate_str_repr('UnsetFlag');
// -------------------------------------------------------------------------------------------------
const unexpected_TestFlag_at_top_level = rule => 
      unexpected(rule, (rule, input, index) =>
        new FatalParseError(`check/not flag guards without set consequents at the top level ` +
                            `would serve no purpose and so are not permitted`,
                            input, index));
const innapropriately_placed_TestFlag  = rule => 
      unexpected(rule, (rule, input, index) =>
        new FatalParseError(`innapropriately placed test flag`,
                            input, index));
const wrap_TestFlag_in_AnonWildcard    = rule =>
      xform(rule, flag =>
        new ASTAnonWildcard([make_ASTAnonWildcardAlternative([[], [1], [flag], []])]));
// -------------------------------------------------------------------------------------------------
const TestFlagInGuardPosition =
      choice(SimpleCheckFlag,
             SimpleNotFlag,
             CheckFlagWithSetConsequent,
             NotFlagWithSetConsequent,
             CheckFlagWithOrAlternatives);
const TopLevelTestFlag =
      choice(unexpected_TestFlag_at_top_level(SimpleCheckFlag)
             .abbreviate_str_repr('UnexpectedSimpleCheckFlagAtTopLevel'),
             unexpected_TestFlag_at_top_level(SimpleNotFlag)
             .abbreviate_str_repr('UnexpectedSimpleNotFlagAtTopLevel'),
             wrap_TestFlag_in_AnonWildcard(CheckFlagWithSetConsequent)
             .abbreviate_str_repr('WrappedTopLevelCheckFlagWithSetConsequent'),
             wrap_TestFlag_in_AnonWildcard(NotFlagWithSetConsequent)
             .abbreviate_str_repr('WrappedNotFlagWithSetConsequent'),
             unexpected_TestFlag_at_top_level(CheckFlagWithOrAlternatives)
             .abbreviate_str_repr('UnexpectedCheckFlagWithOrAlternativesAtTopLevel'));
const TestFlagInAlternativeContent =
      choice(innapropriately_placed_TestFlag(SimpleCheckFlag)
             .abbreviate_str_repr('InappropriatelyPlacedSimpleCheckFlag'),
             innapropriately_placed_TestFlag(SimpleNotFlag)
             .abbreviate_str_repr('InappropriatelyPlacedSimpleNotFlag'),
             innapropriately_placed_TestFlag(CheckFlagWithSetConsequent)
             .abbreviate_str_repr('InappropriatelyPlacedCheckFlagWithSetConsequent'),
             innapropriately_placed_TestFlag(NotFlagWithSetConsequent)
             .abbreviate_str_repr('InappropriatelyPlacedNotFlagWithSetConsequent'),
             innapropriately_placed_TestFlag(CheckFlagWithOrAlternatives)
             .abbreviate_str_repr('InappropriatelyPlacedCheckFlagWithOrAlternatives'));
// =================================================================================================
// AnonWildcard-related rules:
// =================================================================================================
const make_ASTAnonWildcardAlternative = arr => {
  const weight = arr[1];

  if (weight == 0)
    return DISCARD;
  
  const flags = [ ...arr[0], ...arr[2] ];
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
    weight,
    check_flags,
    not_flags,
    [
      ...ASTSetFlags_for_ASTCheckFlags_with_consequently_set_flag_tails,
      ...ASTSetFlags_for_ASTNotFlags_with_consequently_set_flag_tails,
      ...ASTSetFlags_for_ASTNotFlags_with_set_immediately,
      ...set_or_unset_flags,
      ...arr[3]
    ]);
};
// -------------------------------------------------------------------------------------------------
const AnonWildcardHeaderItems =
      // maybe remove last two choices?
      wst_star(choice(TestFlagInGuardPosition, discarded_comment/*, UnsetFlag, SetFlag*/))
      .abbreviate_str_repr('AnonWildcardHeaderItems');
// -------------------------------------------------------------------------------------------------
const make_AnonWildcardAlternative_rule = (content_rule,
                                           { sj_merge_correct_articles = true } = {}) =>
      xform(make_ASTAnonWildcardAlternative,
            seq(AnonWildcardHeaderItems,
                lws(optional(swb_uint, 1)),                                 
                AnonWildcardHeaderItems,
                sj_merge(flat1(wst_star(content_rule)),
                         { correct_articles: sj_merge_correct_articles })));
// -------------------------------------------------------------------------------------------------
const AnonWildcardAlternative  =
      make_AnonWildcardAlternative_rule(
        () => ContentInAnonWildcardAlternative,
        { sj_merge_correct_articles: true })
      .abbreviate_str_repr('AnonWildcardAlternative');
const AnonWildcardAlternativeNoSJMergeArticleCorrection =
      make_AnonWildcardAlternative_rule(
        () => ContentInAnonWildcardAlternativeNoSJMergeArticleCorrection,
        { sj_merge_correct_articles: false })
      .abbreviate_str_repr('AnonWildcardAlternativeNoSJMergeArticleCorrection');
// -------------------------------------------------------------------------------------------------
const make_AnonWildcard_rule            =
      (alternative_rule, { can_have_trailer = false, empty_value = undefined } = {}) => {
        const new_ASTAnonWildcard = arr =>
              new ASTAnonWildcard(arr[0], { trailer: arr[1] });
        const body_rule = lws(wst_brc_enc(wst_star(alternative_rule, pipe)));
        const tail_rule = can_have_trailer
              ? optional_punctuation_trailer
              : unexpected_punctuation_trailer;
        const xform_fun = empty_value === undefined
              ? arr => new_ASTAnonWildcard(arr)
              : arr => (arr.length === 0
                        ? empty_value
                        : new_ASTAnonWildcard(arr));
        return xform(xform_fun,
                     seq(discarded_comments,
                         body_rule,
                         tail_rule));
      };
// -------------------------------------------------------------------------------------------------
const AnonWildcard =
      make_AnonWildcard_rule(AnonWildcardAlternative,
                             { can_have_trailer: true, empty_value: DISCARD })
      .abbreviate_str_repr('AnonWildcard');
// no empty value because values that are going to go on the rhs of context.named_wildcards need
// to actually be ASTAnonWildcards:
const AnonWildcardInDefinition =
      make_AnonWildcard_rule(AnonWildcardAlternative,
                             { can_have_trailer: true, empty_value: undefined })
      .abbreviate_str_repr('AnonWildcardInDefinition');
// note differing empty values due their contexts of use:
const AnonWildcardNoSJMergeArticleCorrection =
      make_AnonWildcard_rule(AnonWildcardAlternativeNoSJMergeArticleCorrection,
                             { can_have_trailer: true, empty_value: DISCARD })
      .abbreviate_str_repr('AnonWildcardNoSJMergeArticleCorrection');
const AnonWildcardNoSJMergeArticleCorrectionOrTrailer =
      make_AnonWildcard_rule(AnonWildcardAlternativeNoSJMergeArticleCorrection,
                             { can_have_trailer: false, empty_value:  '' })
      .abbreviate_str_repr('AnonWildcardNoSJMergeArticleCorrectionOrTrailer');
// =================================================================================================
// non-terminals for the special functions/variables:
// =================================================================================================
const SpecialFunctionTail =
      choice(seq(discarded_comments, lws(semicolon)),
             structural_word_break_ahead)
      .abbreviate_str_repr('SpecialFunctionTail');
// -------------------------------------------------------------------------------------------------
const SpecialFunctionUIPrompt =
      xform(seq('ui-prompt', optional(punctuation_trailer), SpecialFunctionTail),
            arr => new ASTUIPrompt(arr[1]))
      .abbreviate_str_repr('SpecialFunctionUIPrompt');
// -------------------------------------------------------------------------------------------------
const UnexpectedSpecialFunctionUIPrompt =
      unexpected(SpecialFunctionUIPrompt,
                 (rule, input, index) =>
                 new FatalParseError("%ui-prompt is only supported when " +
                                     "using wildcards-plus.js inside Draw Things, " +
                                     "NOT when running the wildcards-plus-tool.js script",
                                     input, index - 1))
      .abbreviate_str_repr('UnexpectedSpecialFunctionUIPrompt');
// -------------------------------------------------------------------------------------------------
const SpecialFunctionUINegPrompt =
      xform(seq('ui-neg-prompt', optional(punctuation_trailer), SpecialFunctionTail),
            arr => new ASTUINegPrompt(arr[1]))
      .abbreviate_str_repr('SpecialFunctionUINegPrompt');
// -------------------------------------------------------------------------------------------------
const UnexpectedSpecialFunctionUINegPrompt =
      unexpected(SpecialFunctionUINegPrompt,
                 (rule, input, index) =>
                 new FatalParseError("%ui-neg-prompt is only supported when " +
                                     "using wildcards-plus.js inside Draw Things, " +
                                     "NOT when running the wildcards-plus-tool.js script",
                                     input, index - 1))
      .abbreviate_str_repr('UnexpectedSpecialFunctionUINegPrompt');
// -------------------------------------------------------------------------------------------------
const SpecialFunctionInclude =
      xform(arr => new ASTInclude(arr[1]),
            head(c_funcall('%include',              // [0][0]
                           head(discarded_comments, // -
                                lws(rjsonc_string), // [0][1]
                                discarded_comments, // -
                               )),  
                 optional(SpecialFunctionTail)))
      .abbreviate_str_repr('SpecialFunctionInclude');
// -------------------------------------------------------------------------------------------------
const UnexpectedSpecialFunctionInclude =
      unexpected(SpecialFunctionInclude,
                 (rule, input, index) =>
                 new FatalParseError("%include is only supported when " +
                                     `using wildcards-plus-tool.js, ` +
                                     `NOT when ` +
                                     "running the wildcards-plus.js script " +
                                     "inside Draw Things",
                                     input, index - 1))
      .abbreviate_str_repr('UnexpectedSpecialFunctionInclude');
// -------------------------------------------------------------------------------------------------
const SpecialFunctionSetPickSingle =
      xform(arr => new ASTSetPickSingle(arr[1][1]),
            seq('single-pick',                                            // [0]
                discarded_comments,                                       // -
                cutting_seq(lws(equals),                                  // [1][0]
                            discarded_comments,                           // -
                            lws(choice(() => LimitedContentNoAwcSJMergeArticleCorrectionOrTrailer, // [1][1]
                                       lc_alpha_snake)),        
                            optional(SpecialFunctionTail))))
      .abbreviate_str_repr('SpecialFunctionSetPickSingle');
// -------------------------------------------------------------------------------------------------
const SpecialFunctionSetPickMultiple =
      xform(arr => new ASTSetPickMultiple(arr[1][1]),
            seq('multi-pick',                                             // [0]
                discarded_comments,                                       // -
                cutting_seq(lws(equals),                                  // [1][0]
                            discarded_comments,                           // -
                            lws(choice(() => LimitedContentNoAwcSJMergeArticleCorrectionOrTrailer, // [1][1]
                                       lc_alpha_snake)),
                            optional(SpecialFunctionTail)))) 
      .abbreviate_str_repr('SpecialFunctionSetPickMultiple');
// -------------------------------------------------------------------------------------------------
const SpecialFunctionRevertPickSingle =
      xform(seq('revert-single-pick',
                optional(SpecialFunctionTail)),
            () => new ASTRevertPickSingle())
      .abbreviate_str_repr('SpecialFunctionRevertPickSingle');
// -------------------------------------------------------------------------------------------------
const SpecialFunctionRevertPickMultiple =
      xform(seq('revert-multi-pick',
                optional(SpecialFunctionTail)),
            () => new ASTRevertPickMultiple())
      .abbreviate_str_repr('SpecialFunctionRevertPickMultiple');
// -------------------------------------------------------------------------------------------------
const SpecialFunctionUpdateConfigurationBinary =
      xform(arr => new ASTUpdateConfigurationBinary(arr[0][0], arr[1], arr[0][1] == '='),
            cutting_seq(seq(c_ident,                                        // [0][0]
                            discarded_comments,                             // -
                            lws(any_assignment_operator),                   // [0][1]
                            discarded_comments),                            // -
                        lws(choice(ExposedRjsonc,                           // [1]
                                   head(() => LimitedContentNoAWCArticleCorrection,
                                        optional(SpecialFunctionTail))))))  // [1][1]
      .abbreviate_str_repr('SpecialFunctionUpdateConfigurationBinary');
// -------------------------------------------------------------------------------------------------
const SpecialFunctionUpdateConfigurationUnary =
      xform(arr => 
        new ASTUpdateConfigurationUnary(arr[1][1], arr[1][0] == '='),
        seq(/conf(?:ig)?/,                                                  // [0]
            discarded_comments,                                             // -
            cutting_seq(lws(choice(plus_equals, equals)),                   // [1][0]
                        discarded_comments,                                 // -
                        lws(choice(head(RjsoncObject,
                                        optional(SpecialFunctionTail)),
                                   head(() => LimitedContentNoAwcSJMergeArticleCorrectionOrTrailer,
                                        optional(SpecialFunctionTail))))))) // [1][1]
      .abbreviate_str_repr('SpecialFunctionUpdateConfigurationUnary');
// -------------------------------------------------------------------------------------------------
const SpecialFunctionNotInclude =
      cutting_cadr(percent,
                   choice(
                     SpecialFunctionUpdateConfigurationUnary,  // before binary!
                     SpecialFunctionUpdateConfigurationBinary,
                     (dt_hosted
                      ? SpecialFunctionUIPrompt
                      : UnexpectedSpecialFunctionUIPrompt),
                     (dt_hosted
                      ? SpecialFunctionUINegPrompt
                      : UnexpectedSpecialFunctionUINegPrompt),
                     SpecialFunctionSetPickSingle,
                     SpecialFunctionSetPickMultiple,
                     SpecialFunctionRevertPickSingle,
                     SpecialFunctionRevertPickMultiple,
                   ))
      .abbreviate_str_repr('SpecialFunctionNotInclude');
// =================================================================================================
// other non-terminals:
// =================================================================================================
const NamedWildcardReference  =
      xform(seq(at,                                        // [0]
                optional(caret),                           // [1]
                optional(xform(parseInt, uint), 1),        // [2]
                optional(xform(parseInt,                   // [3]
                               cadr(dash, uint))),
                optional(/[,\.&|;]/),                      // [4]
                ident,                                     // [5]
                optional_punctuation_trailer,  // [6]
               ), 
            arr => {
              const ident   = arr[5];
              const min_ct  = arr[2];
              const max_ct  = arr[3] ?? min_ct;
              const joiner  = arr[4]; // ??''
              const caret   = arr[1];
              const trailer = arr[6];

              if (min_ct == 0 && max_ct == 0) {
                lm.log(`WARNING: retrieving 0 items from a named ` +
                       `wildcard is a strange thing to do. We'll allow ` +
                       `it, but you may have made a mistake in your ` +
                       `template.`,
                       false)
                
                return DISCARD;
              }
              
              return new ASTNamedWildcardReference(ident,
                                                   joiner,
                                                   caret,
                                                   min_ct,
                                                   max_ct,
                                                   trailer);
            })
      .abbreviate_str_repr('NamedWildcardReference');
// -------------------------------------------------------------------------------------------------
const NamedWildcardDesignator = cadr(at, ident)
      .abbreviate_str_repr('NamedWildcardDesignator');
// -------------------------------------------------------------------------------------------------
const NamedWildcardDefinition =
      xform(arr => new ASTNamedWildcardDefinition(arr[0], arr[1]),
            cutting_seq(head(NamedWildcardDesignator,
                             discarded_comments,
                             lws(equals)),
                        discarded_comments,
                        head(lws(AnonWildcardInDefinition),
                             optional(SpecialFunctionTail))))
      .abbreviate_str_repr('NamedWildcardDefinition');
// -------------------------------------------------------------------------------------------------
const NamedWildcardUsage      =
      xform(seq(at, optional(bang), optional(hash), ident),
            arr => {
              const [ bang, hash, ident, objs ] =
                    [ arr[1], arr[2], arr[3], []];
              
              if (!bang && !hash)
                return new ASTNamedWildcardReference(ident);

              // goes before hash so that "@!#" works correctly:
              if (bang) 
                objs.push(new ASTUnlatchNamedWildcard(ident));

              if (hash)
                objs.push(new ASTLatchNamedWildcard(ident));

              return objs;
            })
      .abbreviate_str_repr('NamedWildcardUsage');
// -------------------------------------------------------------------------------------------------
const ScalarReference         =
      xform(seq(dollar,
                optional(caret),
                ident,
                optional_punctuation_trailer),
            arr => new ASTScalarReference(arr[2],
                                          arr[1],
                                          arr[3]))
      .abbreviate_str_repr('ScalarReference');
// -------------------------------------------------------------------------------------------------
const ScalarDesignator        =
      xform(seq(dollar, ident),
            arr => new ASTScalarReference(arr[1]))
      .abbreviate_str_repr('ScalarDesignator');
// -------------------------------------------------------------------------------------------------
const ScalarAssignment        =
      xform(arr =>
        new ASTScalarAssignment(arr[0],
                                arr[1][1],
                                arr[1][0] == '='),
        seq(ScalarDesignator,                                 // [0]
            discarded_comments,                               // - 
            cutting_seq(lws(choice(plus_equals, equals)),     // [1][0]
                        discarded_comments,                   // -
                        lws(choice(                           // [1][1]
                          () => rjsonc_string,
                          () => LimitedContent,
                        )),
                        optional(SpecialFunctionTail))))
      .abbreviate_str_repr('ScalarAssignment');
// =================================================================================================
// Content-related rules:
// =================================================================================================
const make_LimitedContent_rule = (plain_text_rule, anon_wildcard_rule) =>
      choice(
        NamedWildcardReference,
        anon_wildcard_rule,
        plain_text_rule,
        ScalarReference,
      );
// -------------------------------------------------------------------------------------------------
const LimitedContent =
      make_LimitedContent_rule(plain_text, AnonWildcard)
      .abbreviate_str_repr('LimitedContent');
const LimitedContentNoAWCArticleCorrection =
      make_LimitedContent_rule(plain_text, AnonWildcardNoSJMergeArticleCorrection)
      .abbreviate_str_repr('LimitedContentNoAWCArticleCorrection');
const LimitedContentNoAwcSJMergeArticleCorrectionOrTrailer =
      make_LimitedContent_rule(plain_text_no_semis, AnonWildcardNoSJMergeArticleCorrectionOrTrailer)
      .abbreviate_str_repr('LimitedContentNoAwcSJMergeArticleCorrectionOrTrailer');
// -------------------------------------------------------------------------------------------------
const make_malformed_token_rule = rule => 
      unexpected(rule,
                 (rule, input, index, match_result) => {
                   // throw new Error('bomb');
                   return new FatalParseError(`encountered malformed token: ` +
                                              `${inspect_fun(match_result.value)}`,
                                              input,
                                              index);
                 }).abbreviate_str_repr(`malformed(${rule.toString()})`);
const make_Content_rule       = ({ before_plain_text_rules = [],
                                   after_plain_text_rules  = [] } = {}) => 
      choice(
        ...before_plain_text_rules,
        plain_text,
        ...after_plain_text_rules,
        discarded_comment,
        NamedWildcardReference,
        NamedWildcardUsage,
        SpecialFunctionNotInclude,
        UnsetFlag, // before SetFlag!
        SetFlag,
        ScalarAssignment,
        ScalarReference,
        make_malformed_token_rule(r_raw`(?![${structural_chars}])\S+`),
        // ^ reminder, structural_chars === '{|}'
      );
// -------------------------------------------------------------------------------------------------
const make_ContentInAnonWildcardAlternative_rule = nested_AnonWildcard_rule =>
      make_Content_rule({
        before_plain_text_rules: [
          end_quantified_match_if(structural_close_ahead),
          A1111StyleLora,
          TestFlagInAlternativeContent,
          nested_AnonWildcard_rule,
        ],
        after_plain_text_rules:  [
        ],
      });
const ContentInAnonWildcardAlternative =
      make_ContentInAnonWildcardAlternative_rule(AnonWildcard);
const ContentInAnonWildcardAlternativeNoSJMergeArticleCorrection =
      make_ContentInAnonWildcardAlternative_rule(AnonWildcardNoSJMergeArticleCorrection);
const ContentAtTopLevel                = make_Content_rule({
  before_plain_text_rules: [
    A1111StyleLora,
    TopLevelTestFlag,
    AnonWildcard,
  ],
  after_plain_text_rules:  [
    make_malformed_token_rule(r_raw`}\S*`),
    NamedWildcardDefinition,
    SpecialFunctionInclude,
  ],
});
const ContentAtTopLevelStar            = sj_merge(flat1(wst_star(ContentAtTopLevel)));
const Prompt                           = tws(ContentAtTopLevelStar);
// =================================================================================================
Prompt.finalize();
// =================================================================================================
// END OF SD PROMPT GRAMMAR SECTION.
// =================================================================================================


// =================================================================================================
// DEV NOTE: Copy into wildcards-plus.js through this line!
// =================================================================================================


// =================================================================================================
// MAIN SECTION: all of the Draw Things-specific code goes down here.
// -------------------------------------------------------------------------------------------------
// fallback prompt to be used if no wildcards are found in the UI prompt:
const fallback_prompt     = 'A {2 #cat cat|#dog dog} in a {field|2 kitchen} playing with a ' +
      '{ball|?cat catnip toy|?dog bone}';
const ui_prompt           = pipeline.prompts.prompt;
const ui_neg_prompt       = pipeline.prompts.negativePrompt;
const ui_hint             = "";
let   prompt_string       = ui_prompt;
const default_batch_count = 150;
LOG_LINE.line_width       = 113;
// -------------------------------------------------------------------------------------------------


// -------------------------------------------------------------------------------------------------
// UI:
// -------------------------------------------------------------------------------------------------
const doc_string = `Wildcards Plus v0.9 by ariane-emory (originally based on @wetcircuit's original wildcard.js script)

Generate a batch of images using inline wildcards to randomize elements within the prompt.

The wildcards-plus script adds a variety of useful features above and beyond simple wildcards, including: weighted alternatives in wildcards, nested wildcards, 'smart' text joining logic, comments, named wildcards (with 'latching' and the ability to retrieve multiple items at once), recursive wildcards, escaped characters, settable 'boolean' flags and guards.

The full documentation would be too large to fit in this tiny box, please see the README.md file for detailed descriptions of these features!`;

const user_selection = requestFromUser('Wildcards Plus', '', function() {
  return [
	  this.section('Prompt', ui_hint,
                 [ this.textField(prompt_string, fallback_prompt, true, 240) ]),
    this.section("Batch count", "",
                 [ this.slider(default_batch_count, this.slider.fractional(0), 1, 500) ]),
    this.switch(true, "Clear canvas first (maybe img2img if disabled):"),
    this.section("When picking a single item, prioritize:", "",
                 [ this.menu(picker_priority_descriptions.indexOf(picker_priority.ensure_weighted_distribution),
                             picker_priority_descriptions) ]),
    this.section("When picking multiple items, prioritize:", "",
                 [ this.menu(picker_priority_descriptions.indexOf(picker_priority.avoid_repetition_long),
                             picker_priority_descriptions) ]),
    this.section('about', doc_string, [])
  ];
});

// lm.log(`USER SELECTION:`);
// lm.log(JSON.stringify(user_selection));

prompt_string     = user_selection[0][0]
const batch_count = user_selection[1][0];
const clear_first = user_selection[2];
const user_selected_pick_one_priority =
      picker_priority_descriptions[user_selection[3][0]];
// lm.log(`GET ${user_selection[2][0]} FROM ${inspect_fun(picker_priority_descriptions)}} ` +
//             `= ${picker_configuration.pick_one_priority}`);
const user_selected_pick_multiple_priority =
      picker_priority_descriptions[user_selection[4][0]];
// lm.log(`GET ${user_selection[3][0]} FROM ${inspect_fun(picker_priority_descriptions)}} ` +
//             `= ${picker_configuration.pick_one_priority}`);

lm.log(`Single pick priority:   ${user_selected_pick_one_priority}`);
lm.log(`Multiple pick priority: ${user_selected_pick_multiple_priority}`);

// -------------------------------------------------------------------------------------------------
// parse the prompt_string here:
// -------------------------------------------------------------------------------------------------

try {
  const parse_result     = Prompt.match(prompt_string);

  if (! parse_result.is_finished)
    throw new Error(`parsing prompt did not finish parsing its input!`);

  const AST              = parse_result.value;

  // -----------------------------------------------------------------------------------------------

  const base_context = load_prelude();
  base_context.configuration          = pipeline.configuration;
  base_context.pick_one_priority      = user_selected_pick_one_priority;
  base_context.pick_multiple_priority = user_selected_pick_multiple_priority;

  // -----------------------------------------------------------------------------------------------
  // audit flags:
  let audit_elapsed, audit_warnings;

  lm.log(`auditing...`);
  lm.indent(() => {
    audit_elapsed = measure_time(() =>
      audit_warnings = audit_semantics(AST, { base_context: base_context }));
  });
  lm.log(`audit took ${audit_elapsed.toFixed(2)} ms`);

  const audit_warning_counts = count_occurrences(audit_warnings);
  
  for (let [warning, count] of audit_warning_counts)
    lm.log((count > 1
            ? `${warning} (${count} times)`
            : warning),
           false);

  // -----------------------------------------------------------------------------------------------
  LOG_LINE();
  lm.log(`pipeline.configuration is:`);
  LOG_LINE();
  lm.log(`${inspect_fun(pipeline.configuration)}`);

  LOG_LINE();
  lm.log(`base_context.configuration is:`);
  LOG_LINE();
  lm.log(`${inspect_fun(base_context.configuration)}`);

  LOG_LINE();
  lm.log(`The wildcards-plus prompt is:`);
  LOG_LINE();
  lm.log(`${prompt_string}`);

  // -----------------------------------------------------------------------------------------------
  // main loop:
  // -----------------------------------------------------------------------------------------------
  for (let ix = 0; ix < batch_count; ix++) {
    const start_date = new Date();

    LOG_LINE();
    lm.log(`Beginning expansion #${ix+1} out of ${batch_count} at ` +
           `${format_simple_time(start_date)}:`);
    LOG_LINE();

    // expand the wildcards using a cloned context and generate a new configuration:
    
    // lm.log(`BEFORE CLONING CONTEXT...`);
    const context = base_context.clone();
    // lm.log(`AFTER CLONING CONTEXT`);
    const prompt  = expand_wildcards(AST, context, { correct_articles: true });

    if (! is_empty_object(context.configuration)) {
      LOG_LINE();
      lm.log(`GENERATED CONFIGURATION:`);
      LOG_LINE();
      lm.log(`${inspect_fun(context.configuration)}`);
    }

    if (context.flags.length > 0) {
      LOG_LINE();
      lm.log(`Flags after:`);
      LOG_LINE();
      for (const flag of context.flags)
        lm.log(`  #${flag.join('.')}`);
    }
    
    if (context.scalar_variables.size > 0) {
      LOG_LINE();
      lm.log(`Scalars after:`);
      LOG_LINE();
      for (const [key, val] of context.scalar_variables)
        lm.log(`$${key} = ${inspect_fun(val)}`);
    }

    LOG_LINE();
    lm.log(`The expanded prompt is:`);
    LOG_LINE();
    lm.log(`${prompt}`);
    
    if (context.configuration.negativePrompt || context.configuration.negativePrompt === '') {
      LOG_LINE();
      lm.log(`Expanded negative prompt:`);
      LOG_LINE();
      lm.log(context.configuration.negativePrompt);
    } else {
      LOG_LINE();
      lm.log(`No negative prompt, using negative prompt from UI: ` +
             `${inspect_fun(ui_neg_prompt)}.`);
      
      context.configuration.negativePrompt = ui_neg_prompt;
    }
    
    LOG_LINE();

    if (clear_first) {
      lm.log(`Clearing canvas...`);
      canvas.clear();
    } else {
      lm.log(`Not clearing canvas`);
    }

    lm.log(`Generating image #${ix+1} out of ${batch_count} at ${format_simple_time()}...`);

    // ---------------------------------------------------------------------------------------------
    // run the pipeline:
    // ---------------------------------------------------------------------------------------------

    const negative_prompt = context.configuration.negativePrompt;
    delete context.configuration.negativePrompt;
    
    pipeline.run({
      configuration: context.configuration,
      prompt: prompt,
      negativePrompt: negative_prompt,
    });

    const end_time     = new Date().getTime();
    const elapsed_time = (end_time - start_date.getTime()) / 1000;

    lm.log(`... image generated in ${elapsed_time} seconds.`);
  }

  LOG_LINE();
  lm.log(`Job complete. Open the console to see the job report.`);
}
catch(ex) {
  if (ex instanceof Error) {
    if (ex.message === 'cancelled')
      lm.error(`Cancelled.`);
    else
      lm.error(`wildcards-plus caught a fatal exception, ` +
               `click here to open the console for more details\n\n` + 
               `exception:\n${ex}\n\nstack trace:\n${ex.stack}`);
  } else {
    lm.error(`wildcards-plus caught a fatal exception, ` +
             `click here to open the console for more details\n` +
             `exception:\n${inspect_fun(ex)}`);
  }
}
// =================================================================================================
// END OF MAIN SECTION.
// =================================================================================================
