// -*- fill-column: 90; eval: (display-fill-column-indicator-mode 1); -*-
//@api-1.0
// wildcards-plus
// author ariane-emory (includes some code from wetcircuit's original wildcards.js)
// v0.2
// Draw Things 1.20240502.2
// =======================================================================================


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
// (Rule) -|  The core/basic Rules:
//         |
//         |- Choice
//         |- Enclosed ------- CuttingEnclosed
//         |- Expect
//         |- Optional
//         |- Sequence ------- CuttingSequence
//         |- Xform
//         |
//         |- (Quantified) -|- Plus
//         |                |- Star
//         |
//         |  Technically these next 3 could be implemented as Xforms, but 
//         |  they're very convenient to have built-in (and are possibly faster
//         |  this way than equivalent Xforms, at least for the for simpler use
//         |  cases):
//         |
//         |- Discard
//         |- Elem
//         |- Label
//         |
//         |  Rules that make sense only when input is an Array of Tokens:
//         |
//         |- TokenLabel
//         |
//         |  Rules that make sense only when input is a string:
//         |
//         |- Literal
//         |- Regex
//
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

    if (! match_result)
      return new MatchResult([], input, index);

    if (match_result.value === '' || match_result.value)
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

      if (match_result.value === '' || match_result.value)
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
class Discard extends Rule  {
  // -------------------------------------------------------------------------------------
  constructor(rule) {
    super();
    this.rule = make_rule_func(rule);
  }
  // -------------------------------------------------------------------------------------
  __impl_finalize(indent, visited) {
    this.rule = this.__vivify(this.rule);    
    this.rule.__finalize(indent + 1, visited);
  }
  // -------------------------------------------------------------------------------------
  __match(indent, input, index) {
    const match_result = this.rule.match(
      input,
      index,
      indent + 1);

    if (! match_result)
      return null;

    return new MatchResult(null, input, match_result.index);
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
      // throw new Error("bang");
      
      log(indent, `taking elem ${this.index} from ` +
          `${JSON.stringify(rule_match_result)}'s value.`);
    }
    
    rule_match_result.value = rule_match_result.value[this.index];

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

    if (! match_result)
      return new MatchResult((this.default_value || this.default_value === '')
                             ? [ this.default_value ]
                             : [],
                             input, index);
    
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
      log(indent + 1, `matching sequence item #1 out of ` +
          `${this.elements.length}...`);
    
    const start_rule_match_result =
          this.elements[0].match(input, index, indent + 2);
    let last_match_result = start_rule_match_result;

    if (! last_match_result) {
      if (log_match_enabled)
        log(indent + 1, `did not match sequence item #1.`);
      return null;
    }

    if (log_match_enabled)
      log(indent + 1, `matched sequence item #1: ` +
          `${JSON.stringify(last_match_result)}.`);
    
    const values = [];
    index        = last_match_result.index;
    
    if (last_match_result.value || last_match_result.value === '')
      values.push(last_match_result.value);
    else if (log_match_enabled)
      log(indent + 1, `discarding ${JSON.stringify(last_match_result)}!`);

    for (let ix = 1; ix < this.elements.length; ix++) {
      if (log_match_enabled)
        log(indent + 1, `matching sequence item #${ix} out of ` +
            `${this.elements.length}...`);
      
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
      
      if (last_match_result.value === '' || last_match_result.value)
        values.push(last_match_result.value);

      index = last_match_result.index;
    }

    return new MatchResult(values, input, last_match_result.index);
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
// whitespace tolerant combinators:
// ---------------------------------------------------------------------------------------
const __make_wst_quantified_combinator = base_combinator => 
      ((rule, sep = null) => base_combinator(wse(rule), sep));
const __make_wst_quantified_combinator_alt = base_combinator =>
      ((rule, sep = null) =>
        lws(base_combinator(tws(rule),
                            sep ? seq(sep, whites_star) : null)));
const __make_wst_seq_combinator = base_combinator =>
      (...rules) => tws(base_combinator(...rules.map(x => lws(x))));
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

  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
// ---------------------------------------------------------------------------------------
function capitalize(string) {
  // console.log(`CAPITALIZING '${string}'`);
  return string.charAt(0).toUpperCase() + string.slice(1);
}
// ---------------------------------------------------------------------------------------
function smart_join(arr) {
  // console.log(`JOINING ${inspect_fun(arr)}`);
  const vowelp       = (ch)  => "aeiou".includes(ch.toLowerCase());
  const punctuationp = (ch)  => "'_-,.?!;:".includes(ch);
  const linkingp     = (ch)  => ch === "_" || ch === "-";
  const whitep       = (ch)  => ch === ' ' || ch === '\n';
  const unescape     = (str) => {
    return str
      .replace(/\\n/g,   '\n')
      .replace(/\\ /g,   ' ')
      .replace(/\\(.)/g, '$1')
  };
  
  let left_word = arr[0]?.toString() ?? "";
  let str       = left_word;

  for (let ix = 1; ix < arr.length; ix++)  {
    let right_word  = arr[ix]?.toString() ?? "";
    let prev_char   = left_word[left_word.length - 1] ?? "";
    let prev_char_is_escaped = left_word[left_word.length - 2] === '\\';
    const next_char = right_word[0] ?? '';

    // console.log(`"${str}",  '${left_word}' + '${right_word}'`);

    // console.log(`str = '${str}', ` +
    //             `left_word = '${left_word}', ` +
    //             `right_word = '${right_word}', ` +
    //             `prev_char = '${prev_char}', ` +
    //             `next_char = '${next_char}'`);

    // handle "a" → "an" if necessary
    if ((left_word === "a" || left_word.endsWith(" a")) && vowelp(next_char)) {
      if (left_word === "a") {
        str = str.slice(0, -1) + "an";
        left_word = "an"; 
      } else {
        str = str.slice(0, -2) + " an";
        left_word = "an"; 
      }
    }

    // handle "A" → "An" if necessary
    if ((left_word === "A" || left_word.endsWith(" A")) && vowelp(next_char)) {
      if (left_word === "A") {
        str = str.slice(0, -1) + "An";
        left_word = "An"; 
      } else {
        str = str.slice(0, -2) + " An";
        left_word = "An"; 
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
// deal with the possibility of not having util (or any module system) inside DT:
// =======================================================================================
let inspect_fun = JSON.stringify;

const is_node = typeof process !== "undefined" &&
      process.versions != null &&
      process.versions.node != null;

// if (is_node) {
//   const { inspect } = await import("util");
//   inspect_fun = inspect;
// }
// ---------------------------------------------------------------------------------------


// =======================================================================================
// the AST-walking function that I'll be using for the SD prompt grammar's output:
// =======================================================================================
function expand_wildcards(thing, flags = new Set(), scalar_variables = new Map()) {
  const context = {
    flags:            flags,
    scalar_variables: scalar_variables,
    named_wildcards:  new Map(),
    noisy:            false,
  };
  
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
      if (context.noisy)
        console.log(`SET FLAG '${thing.name}'.`);
      
      context.flags.add(thing.name);

      return ''; // produce nothing
    }
    // -----------------------------------------------------------------------------------
    // References:
    // -----------------------------------------------------------------------------------
    else if (thing instanceof ASTNamedWildcardReference) {
      const got = context.named_wildcards.get(thing.name);

      // if (!got)
      //   return `ERROR: Named wildcard $'{thing.name}' not found!`;

      // console.log(`THE OBJ: ${inspect_fun(thing)}`);
      
      // console.log(`FETCH WC @${thing.name} = ${JSON.stringify(got)}`);

      if (!got)
        return `\\<ERROR: NAMED WILDCARD '${thing.name}' NOT FOUND!>`;


      let res = [ walk(got, context) ];
      
      // console.log(`type: ${typeof walked}`);

      if (thing.capitalize)
        res[0] = capitalize(res[0]);

      const count = rand_int(thing.min_count, thing.max_count);
      
      for (let ix = 1; ix < count; ix++) {
        let val = walk(got, context);
        
        for (let iix = 0; ix < 5; ix++) {
          if (! res.includes(val))
            break;

          val = walk(got, context);
        }

        res.push(val);
      }

      // console.log(`'${thing.join}' vs '${','}'`);
      return thing.join == ','
        ? res.join(", ")
        : (thing.join == '&'
           ? pretty_list(res)
           :res.join(" "));
    }
    // -----------------------------------------------------------------------------------
    else if (thing instanceof ASTScalarReference) {
      let got = context.scalar_variables.get(thing.name) ??
          `SCALAR '${thing.name}' NOT FOUND}`;

      if (thing.capitalize)
        got = capitalize(got);

      // console.log(`FETCH SCALAR $${thing.name} = ${JSON.stringify(got)}`);
      
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
      context.named_wildcards.set(thing.destination.name, thing.wildcard);

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

        for (const not_flag of option.not_flags) {
          // if (context.noisy) 
          //   console.log(`CHECKING FOR NOT ${inspect_fun(not_flag.name)}...`);

          if (context.flags.has(not_flag.name)) {
            skip = true;
            break;
          }
        }

        if (skip)
          continue;
        
        for (const check_flag of option.check_flags) {
          // if (context.noisy)
          //   console.log(`CHECKING FOR ${inspect_fun(check_flag.name)}...`);
          
          if (! context.flags.has(check_flag.name)) {
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
    }
    // -----------------------------------------------------------------------------------
    // error case, unrecognized objects:
    // -----------------------------------------------------------------------------------
    else {
      throw new Error(`confusing thing: ` +
                      (typeof thing === 'object'
                       ? thing.constructor.name
                       : typeof thing) +
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
  constructor(name) {
    this.name = name;
  }
}
// ---------------------------------------------------------------------------------------
class ASTNotFlag  {
  constructor(name) {
    this.name = name;
  }
}
// ---------------------------------------------------------------------------------------
// References:
// ---------------------------------------------------------------------------------------
class ASTNamedWildcardReference {
  constructor(name, join, capitalize, min_count, max_count) {
    this.name       = name;
    this.min_count  = min_count;
    this.max_count  = max_count;
    this.join       = join;
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
// AnonWildcards:
// ---------------------------------------------------------------------------------------
class ASTAnonWildcard {
  constructor(options) {
    this.options = options;
  }
}
// ---------------------------------------------------------------------------------------
class ASTAnonWildcardOption {
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
const make_ASTAnonWildcardOption = arr => {
  // console.log(`ARR: ${inspect_fun(arr)}`);

  return (flags =>
    new ASTAnonWildcardOption(
      arr[1][0],
      flags.filter(f => f instanceof ASTCheckFlag),
      flags.filter(f => f instanceof ASTNotFlag),
      [
        ...flags.filter(f => f instanceof ASTSetFlag),
        ...arr[3]
      ]))([ ...arr[0], ...arr[2] ])};
// ---------------------------------------------------------------------------------------
const make_ASTFlagCmd = (klass, ...rules) =>
      xform(ident => new klass(ident),
            second(seq(...rules, ident, /(?=\s|[{|}]|$)/)));
// ---------------------------------------------------------------------------------------
// terminals:
const plaintext               = /[^{|}\s]+/;
const low_pri_text            = /[\(\)\[\]\,\.\?\!\:\;]+/;
const wb_uint                 = xform(parseInt, /\b\d+(?=\s|[{|}]|$)/);
// const wb_uint                 = xform(parseInt, /\b\d+\b/);
const ident                   = /[a-zA-Z_][0-9a-zA-Z_]*\b/;
const comment                 = discard(choice(c_block_comment, c_line_comment));
const assignment_operator     = discard(seq(wst_star(comment), ':=', wst_star(comment)));
// ---------------------------------------------------------------------------------------
// flag-related non-terminals:
const SetFlag                 = make_ASTFlagCmd(ASTSetFlag,   '#');
const CheckFlag               = make_ASTFlagCmd(ASTCheckFlag, '?');
const NotFlag                 = make_ASTFlagCmd(ASTNotFlag,   '!');
const FlagTest                = choice(CheckFlag, NotFlag);
// ---------------------------------------------------------------------------------------
// other non-terminals:
const AnonWildcardOption      = xform(make_ASTAnonWildcardOption,
                                      seq(wst_star(choice(comment, FlagTest)),
                                          optional(wb_uint, 1),
                                          wst_star(choice(comment, FlagTest)),
                                          () => ContentStar));
const AnonWildcard            = xform(arr => new ASTAnonWildcard(arr),
                                      brc_enc(wst_star(AnonWildcardOption, '|')));
const NamedWildcardReference        = xform(seq(discard('@'),
                                                optional('^'),                           // 0
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
                                              const join   = arr[3] ?? '';
                                              const caret  = arr[0][0];
                                              
                                              // console.log(inspect_fun({ident, min_ct, join, caret}));
                                              
                                              return new ASTNamedWildcardReference(ident,
                                                                                   join,
                                                                                   caret,
                                                                                   min_ct,
                                                                                   max_ct);
                                            });
const NamedWildcardDesignator = xform(second(seq('@', ident)),
                                      ident => new ASTNamedWildcardReference(ident));
const NamedWildcardDefinition = xform(arr => new ASTNamedWildcardDefinition(...arr),
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
const Content                 = choice(ScalarReference, NamedWildcardReference,
                                       NamedWildcardUsage, 
                                       SetFlag, AnonWildcard, comment, low_pri_text, plaintext);
const ContentStar             = xform(wst_star(Content), arr => arr.flat(1));
const Prompt                  = wst_star(choice(ScalarAssignment,
                                                NamedWildcardDefinition,
                                                Content));
// ---------------------------------------------------------------------------------------
Prompt.finalize();
// ---------------------------------------------------------------------------------------


// =======================================================================================
// MAIN SECTION: All of the Draw Things-specific code goes down here.
// ---------------------------------------------------------------------------------------
// fallback prompt to be used if no wildcards are found in the UI prompt:
const fallbackPrompt = String.raw`// just in case it's a Pony-based model, hopefully shouldn't make a big, difference otherwise: 
// score_9, score_8_up, score_7_up, score_6_up, \n

dark fantasy, masterpiece, ultra high resolution, 8k, detailed background, wide shot,
\n

{#m|#f}                // set an 'm' or 'f' gender flag that will help guide the selection of picks later on.
{3 #wizard|2 #warrior} // character, make 'wizards' 60% of the time.

@weapon  := {2 spear|2 {|short|two-handed|bastard|curved} sword|axe|halberd|scimitar
            |falchion|kukri|rapier|sabre|cutlass|mace|dagger|torch|dirk|stiletto|blade
            |trident|harpoon|cleaver|hammer|warhammer|flail|whip|scourge|lash|morningstar
            }

// oh no, an accidental Easter egg! I completely forgot to document scalar string
// variables in the README.md file.
//
// TODO: document this properly!
//
// in the mean time, this just picks an item from @wepon and stashes it in a 
// variable called $weapon:

$weapon  := @weapon 

@character_adjectives := {?wizard  {#scary inhuman|#scary alien|#scary evil|#scary ominous|#scary sinister
                                   |#scary infernal|#alone lonesome|erudite|wise|ancient|immortal|antediluvian
                                   |?f seductive|?f beautiful|?f alluring|?m dashing|?f enchanting
                                   |?m !scary charming|?f beguiling|?f captivating|powerful|godlike
                                   |!scary holy}
                         |?warrior {!scary heroic|mighty|?m handsome|?m musclebound|#scary fearsome|resolute
                                   |2 proud|noble|tattooed|solitary #alone|athletic|steadfast|?m humongous
                                   |strong|?f beautiful|?m handsome|?f alluring|?m musclebound
                                   |#scary bloodthirsty|?m dashing|?f enchanting|?m !scary charming
                                   |!scary brave|!scary daring}
                         }

@roles      := {?wizard  {{?m wizard|?f wizardress}|2 {?m sorcerer|?f sorceress}|2 {?m enchanter
                         |?f enchantress}|druid|alchemist|{?m priest|?f priestess}|adept|cultist
                         |vampire|lich|2 necromancer|?m warlock|?f witch}
               |?warrior {2 warrior|!scary paladin|knight|barbarian|conqueror|rogue|2 gladiator
                         |?m swordsman|?f swordswoman|?f amazon|dervish|blademaster
                         |{?m hunter|?f huntress}|?f valkyrie|mercenary|#scary {brigand|bandit}
                         |!scary hero|#scary raider} 
               }

// The gender flag and the guards here will ensure that only one alternative is available, we'll
// use that to pick appropriately gendered pros:
@pro_3rd_object  := {?f her |?m him | ?n it  }
@pro_3rd_subject := {?f she |?m he  | ?n it  }
@pro_pos_adj     := {?f her |?m his | ?n its }
@pro_pos         := {?f hers|?m his | ?n its }
@pro_pos_rand    := {4 @pro_pos_adj|3 a|1 their}

@video_game_descriptor := {highly anticipated|blockbuster|award winning}
@video_game_origin     := {|2 from {Japan's FROM Software|Hidetaka Miyazaki}}

{2 An oil painting for the cover of a fantasy novel published in the {3 1970s|2 1980s|1990s|early 2000s}
 , in the style of {Julie Bell|Boris Vallejo|Frank Frazetta|Ian Miller|Zdzislaw Beksinski|Brom
                   |an 'Ace double'|Tor Books|an Omni Magazine cover|a Weird Tales magazine cover
                   |a Heavy Metal magazine cover}
|A screenshot from a cinematic in a @video_game_descriptor video game @video_game_origin
|A promotional poster for a @video_game_descriptor video game @video_game_origin
}

, {which depicts|depicting} a @2-3&character_adjectives @roles

@wizard_clothing_adjs := {swirling|cowled|hooded|shadowy|multicolored|oily|many-layered
                         |ornate|silken|brightly colored|occult|embroidered}
@pluralize_clothing   := { {!used_pro <s} }

// Clothing: only reference any clothing half the time, because of the empty alternative at the start:
{|{clad in|wearing|dressed in} {|@pro_pos_rand #used_pro}
 {?wizard  @0-2&wizard_clothing_adjs
           {3 robe @pluralize_clothing|garb|raiment|vestments|?f dress|?f gown},
 |?warrior {3 {|battered|blood-smeared|2 leather|spiked|chainmail|rusted|ornate|golden}
           {3 armor|helmet|pauldrons|wargear|gauntlets}
           |{hides|furs|leather}
           }
 }
}

{2|{ in the {|early} morning|2 at mid-day|3 in mid-evening|3 at midnight|3 in the dead of night
   |3 on a {moonlit|starlit} night} , }

// A weapon or item: don't mention a weapon/item one time in six, because of the empty alternative at the
// start:
{|5 {presenting|brandishing|holding
    |?warrior wielding|?warrior swinging
    |?wizard cradling |?wizard waving|?wizard gesturing with}

    @pro_pos_rand

    {?wizard  {jewel-encrusted|enchanted|magical|glowing|ancient|3}
              {2 staff|2 wand|crystal ball|amulet|artifact
              |skull|spell book||dagger|2 candle|brazier|bell
              |2 {| glowing|?scary fiery} orb
              |potion
              }
    |?warrior {2 bloody|2 ornate|bejeweled|fiery|}
              $weapon
    }
    {|,}
}

{|#outdoors}
{|?outdoors #mounted}

{?mounted {sitting on|mounted on|riding on|astride|leading}
          @pro_pos_rand
          {|mighty|infernal|#scary terrifying|majestic|?warrior armored}
          {3 beast|wolf|2 lizard|reptile|snake|insect|2 steed|2 destrier|2 horse|2 dragon}
          ,
}

{!outdoors {lounging on|laying on|sitting on} @pro_pos_rand {throne|sofa|couch|chair} }

in {3|the heart of|the depths of} a

{!outdoors {|shadowy|smoky|crumbling|ruined|foggy|dimly lit|dusty|{candle|torch} <lit}
           {temple|palace|crypt|cave|tavern|church|lair|cavern
           |{|arcane|wizard's} library|castle|tunnel|dungeon}
}

{?outdoors {|shadowy|smoky|foggy|dimly lit|wintry|snowy|rainy|starlit|moonlit}
           {swamp|forest|desert|alleyway|field|battlefield|courtyard|garden}
}

{,|and}

@look_aim := {past|towards|2 {|up|down} {at|towards}}

// Expression/looking at:
{2 looking @look_aim
|#angry glaring @look_aim
|staring @look_aim
|beckoning {|@look_aim}
|inviting {|@look_aim}
|leering @look_aim
|#scary glowering @look_aim
|2 !scary smiling @look_aim
|grinning @look_aim
|scowling @look_aim
}

the viewer

{2 ?scary menacingly|pridefully|cunningly|drunkenly|!scary !angry jovially|!scary !angry fondly
|!angry gleefully|madly|?scary angrily|angrily|mockingly|?f seductively|?m roguishly|?m rakishly
|2 ?scary threateningly|!scary victoriously|3}

@minion_adjectives := { ?wizard   {?scary {demonic #demonic|fearsome|slavering|3 undead|eldrich
                                          |loathsome|squamous|chtonian|repulsive|chitinous} 
                                  |       {2 arcane|cowering|bewitched|hypnotized|2 ensorceled|reptilian
                                          |otherwordldly|mysterious|exotic|obedient|worshipping|2 dancing}
                                  }
                      |  ?warrior {fellow|loyal|brave|steadfast|armored|mighty
                                  |heavily armed|raucous|warlike|belligerant}
                      }

// unless flagged as #alone, warriors always have #many_minions, but wizards may have a single minion
// sometimes: 
{?warrior #many_minions|?wizard {|3 #many_minions}}
@pluralize_minions := { ?many_minions <s }

// Companions: mention some companions four times in seven, because of the empty alternative at the start 
{|2 !alone {2 ,|while}
           {accompanied by|?many_minions surrounded by|?many_minions encircled by
           |guarded by|leading|commanding|directing|guiding|rallying|alongside}
           @pro_pos_rand
           {?many_minions {horde|host|?warrior {|2 motley|3 merry} {band|crew}|?warrior gang|?warrior band
                          |army|?wizard coterie|?wizard circle|?wizard coven|?wizard variety}
                          of
           }
           {?warrior @0-2&minion_adjectives
                     {soldiers|warriors|companions|men at arms|compatriots}
           |?wizard  {@1-3&minion_adjectives|@2minion_adjectives}
                     {familiar|2 minion|slave|cultist|devil|!demonic demon|spirit|apprentice|followers}
                     @pluralize_minions
           }
}
.
`;

const configuration = pipeline.configuration;
const uiPrompt = pipeline.prompts.prompt;
var uiHint = "no wildcards found in the prompt.";

// look for wildcards in the UI prompt:
if (uiPrompt.includes('{') && uiPrompt.includes('}')) {
	uiHint = "wildcard detected in the prompt.";
	// console.log(uiHint);
	promptString = uiPrompt;
} else {
	// console.log(uiHint);
	promptString = "";
}
// ---------------------------------------------------------------------------------------


// ---------------------------------------------------------------------------------------
// UI:
// ---------------------------------------------------------------------------------------
const docString = `Wildcards Plus v0.5b by ariane-emory (based on wetcircuit's original wildcard.js script)

Generate a batch of images using inline wildcards to randomize elements within the prompt. This wildcard script adds a variety of useful features above and beyond simple wildcards, including: weighted alternatives in wildcards, nested wildcards, 'smart' text joining logic, comments, named wildcards (with 'latching' and the ability to retrieve multiple items at once), recursive wildcards, escaped characters, settable 'boolean' flags and guards.

The full documentation is far too large to fit in this tiny box, please see the README.md file for detailed descriptions of these features!`;

const userSelection = requestFromUser("Wildcards", "", function() {
  return [
	  this.section("Prompt", uiHint, [
		  this.textField(promptString, fallbackPrompt, true, 240),
		  this.slider(10, this.slider.fractional(0), 1, 500, "batch count")
    ]),
	  this.section("about",
                 docString,
                 [])
  ];
});

const batchCount = userSelection[0][1];
promptString     = userSelection[0][0]
// ---------------------------------------------------------------------------------------


// ---------------------------------------------------------------------------------------
// parse the promptString here:
// ---------------------------------------------------------------------------------------
const result     = Prompt.match(promptString);
// ---------------------------------------------------------------------------------------


// ---------------------------------------------------------------------------------------
// run pipeline
// ---------------------------------------------------------------------------------------
console.log("\nwildcards prompt:\n");
console.log(promptString + "\n");

for (i = 0; i < batchCount; i++) {
  editedString = expand_wildcards(result.value);
  configuration.seed = -1;
  let batchCountLog = `render ${i+1} of ${batchCount}`;
  console.log(batchCountLog);
  console.log(editedString);
  let startTime = new Date().getTime();
  pipeline.run({
    configuration: configuration,
    prompt: editedString
  });
  var endTime = new Date().getTime();
  var elapsedTime = (endTime - startTime) / 1000;
  console.log("generated in " + elapsedTime + " seconds\n");
}

console.log("Job complete. Open Console to see job report.");
// ---------------------------------------------------------------------------------------
