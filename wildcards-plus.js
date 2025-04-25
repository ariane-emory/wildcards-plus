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
function expand_wildcards(thing) {
  const context = {
    flags:            new Set(),
    scalar_variables: new Map(),
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
      let got = context.scalar_variables.get(thing.name) ?? 'NOT FOUND';

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
          if (context.noisy)
            console.log(`CHECKING FOR NOT ${inspect_fun(not_flag)}...`);

          if (context.flags.has(not_flag.name)) {
            skip = true;
            break;
          }
        }

        if (skip)
          continue;
        
        for (const check_flag of option.check_flags) {
          // console.log(`CHECKING FOR ${inspect_fun(check_flag)}...`);
          
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
        return 'NOPICK';
      
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
const wb_uint                 = xform(parseInt, /\b\d+(?=\s|[{|}]|$)/);
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
                                                optional('\^'),                                       // 0
                                                optional(xform(parseInt, /\d+/)),                     // 1
                                                optional(xform(parseInt, (second(seq('-', /\d+/))))), // 2
                                                optional(/[,&]/),                                     // 3
                                                ident),                                               // 4
                                            arr => {
                                              // console.log(`NWR ARR: ${inspect_fun(arr)}`);

                                              const ident     = arr[4];
                                              const min_count = arr[1][0] ?? 1;
                                              const max_count = arr[2][0] ?? min_count;
                                              const join      = arr[3] ?? '';
                                              const caret     = arr[0][0];
                                              
                                              // console.log(inspect_fun({ident, min_count, join, caret}));
                                              
                                              return new ASTNamedWildcardReference(ident, join, caret, min_count, max_count);
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
                                       SetFlag, AnonWildcard, comment, plaintext);
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
const fallbackPrompt = String.raw`  // Cinematic terms
  @cinematicTerms :=  {
    IMAX spectacle | cinematic composition | widescreen format | 70mm film | anamorphic lens |
    deep focus | shallow depth of field | Dutch angle | establishing shot | extreme close-up |
    golden hour lighting | lens flare | magic hour | film grain | dramatic framing |
    dolly zoom | tracking shot | crane shot | panoramic vista | film noir aesthetic |
    extreme wideshot | symmetrical framing | forced perspective | rule of thirds |
    dramatic panning | aerial view | bird's eye view | worm's eye view | tracking movement |
    telephoto compression | wide-angle distortion | ultra high resolution | cinemascope |
    ARRI camera | RED Digital Cinema | Panavision lenses | Hollywood production value |
    volumetric lighting | diegetic lighting | high production value | Steadicam smoothness |
    Christopher Nolan aesthetic | Denis Villeneuve composition | Wes Anderson symmetry |
    Roger Deakins cinematography | Emmanuel Lubezki naturalism | IMAX resolution |
    cross-processed colors | color grading | blockbuster production | studio-quality production |
    director's cut | silver screen quality | motion picture grade | aspect ratio 2.39:1 }

  // 3D rendering terms
  @renderingTerms := {
    Cinema4D render | Octane render | V-Ray engine | Redshift render | Arnold renderer |
    photorealistic texturing | subsurface scattering | volumetric lighting | raytracing |
    ray tracing | global illumination | ambient occlusion | radiosity | reflection mapping |
    refraction modeling | caustics | procedural texturing | HDR lighting | HDRI environment |
    PBR materials | photogrammetry | 3D photorealism | displacement mapping | normal mapping |
    hyper-detailed modeling | physically accurate rendering | specular highlights |
    glossy reflections | photoreal CGI | 3D sculpting | micro-displacement | mesh subdivision |
    polygonal detail | tessellation | parallax occlusion | path tracing | indirect lighting |
    physically-based rendering | real-time rendering | bump mapping | geometric detail |
    render farm quality | shadow casting | soft shadows | hard shadows | shadow falloff |
    translucency | anisotropic shading | 3D compositing | multi-pass rendering |
    motion blur | depth of field | focal blur | chromatic aberration | polygon mesh |
    triangulation | metasurfaces | 3D asset | Digital Domain quality | ILM standards |
    Weta Digital precision | frame rate 24 fps | antialiasing | texture resolution 8K |
    Unreal Engine 5 quality | Nanite technology | Lumen lighting system | render pass }

  // Rembrandt lighting and artistic terms
  @lightingTerms := {
    Rembrandt lighting | chiaroscuro effect | dramatic shadows | 45-degree lighting |
    triangle light pattern | catch light in eyes | rim lighting | split lighting | broad lighting |
    short lighting | butterfly lighting | loop lighting | clamshell lighting | key light |
    fill light | back light | kicker light | practical light sources | motivated lighting |
    hard light | soft light | diffused light | dramatic contrast | low-key lighting |
    high-key lighting | practical lighting | three-point lighting | silhouette lighting |
    contre-jour lighting | natural light interplay | shadow detail | tenebrism technique |
    light ratio 4:1 | highlight retention | shadow recovery | shadow cascade | light falloff |
    light wrap | atmospheric lighting | volumetric god rays | golden ratio lighting |
    directional lighting | bounce light | reflected light | ambient light | specular highlight |
    fresnel effect | fresnel highlights | dramatic illumination | atmospheric perspective }

  // Subjects/scenes
  @subjects := {
    dystopian cityscape | cyberpunk street | ancient temple ruins | futuristic metropolis |
    enchanted forest | underwater civilization | space colony | desert oasis | mountain fortress |
    steampunk workshop | crystal cave | volcanic landscape | arctic research station |
    forgotten library | neon-lit alleyway | post-apocalyptic wasteland | floating islands |
    samurai dojo | medieval tavern | victorian mansion | underground bunker | martian settlement |
    bamboo forest | tropical paradise | moonlit cemetery | flying fortress | clockwork city |
    abandoned spacecraft | jungle temple | sky pirates | quantum laboratory | haunted lighthouse |
    ancient colosseum | crystal palace | neon skyline | terraformed planet | art deco hotel lobby |
    gothic cathedral | mist-shrouded valley | subterranean grotto | ornate throne room |
    galactic spaceport | industrial complex | ethereal dreamscape | bio-luminescent cave |
    interdimensional gateway | cherry blossom garden | retrofuturistic diner | alien marketplace |
    time-worn ruins | bioluminescent jungle | urban sprawl | orbital station | underground city |
    desert nomad camp | neo-tokyo streets | mountain temple | sunken city | corporate penthouse |
    Blade Runner cityscape | Dune-inspired desert | magical academy | military outpost |
    sprawling megacity | crystalline structure | secret underground base | floating market |
    royal banquet hall | sci-fi medical bay | parallel dimension | high-tech laboratory |
    mystical sanctuary | cosmic anomaly | holographic interface | mechanical clockwork world |
    solar punk community | viking settlement | art nouveau cafe | dieselpunk airship }

  // Characters/entities
  @characters := {
    weathered explorer | cybernetic assassin | mystic shaman | battle-hardened warrior |
    elegant aristocrat | rogue scientist | nomadic hunter | masked vigilante | royal diplomat |
    eccentric inventor | spiritual guru | mechanical automaton | ethereal spirit |
    hardened detective | alien ambassador | wasteland survivor | quantum physicist |
    legendary swordsman | gifted sorcerer | space marine | tribal chieftain | ruthless bounty hunter |
    ancient deity | digital consciousness | arctic ranger | shadow operative | divine messenger |
    nano-enhanced human | time traveler | jungle survivalist | robotic companion | plague doctor |
    wise oracle | master strategist | cosmic entity | notorious outlaw | haunted artist |
    brilliant engineer | noble knight | wilderness guide | void navigator | mystical guardian |
    chaos agent | dimensional traveler | artifact collector | mercenary captain | hivemind operator |
    forgotten god | street samurai | data courier | stellar cartographer | genetic experiment |
    memory dealer | reality hacker | cosmic pilgrim | dream architect | eldritch abomination |
    synthetic human | telepathic spy | void-touched scholar | tech-priest | biomechanical hybrid |
    holographic performer | reality bender | psionic adept | void walker | augmented veteran |
    stellar navigator | temporal agent | urban shaman | ancestral spirit | psychic investigator |
    corrupted paladin | peace negotiator | probability engineer | cosmic horror | energy being }
  
  // Moods/atmospheres
  @moods := {
    foreboding | mysterious | tranquil | chaotic | melancholic | ethereal | tense | serene |
    ominous | whimsical | nostalgic | dystopian | hopeful | eerie | majestic | desolate |
    vibrant | gritty | dreamlike | romantic | oppressive | harmonious | unsettling | triumphant |
    bleak | mystical | intense | peaceful | haunting | exhilarating | contemplative | threatening |
    awe-inspiring | somber | psychedelic | claustrophobic | liberating | surreal | suspenseful |
    idyllic | turbulent | apocalyptic | visionary | nightmarish | heavenly | primal | elegant }
  
  // Time periods
  @timePeriods := {
    prehistoric era | ancient civilizations | medieval times | renaissance period | victorian age |
    1920s art deco | 1950s retrofuturism | modern day | near future | distant future | post-apocalyptic future |
    alternate history | steampunk era | cyberpunk era | space age | prehistoric future | neo-victorian |
    dieselpunk 1940s | atomic age | information age | post-human era | bronze age | iron age |
    classical antiquity | feudal period | industrial revolution | digital revolution | post-singularity |
    interstellar age | galactic era | time collapse | end of time | beginning of universe |
    parallel timeline | temporal anomaly | quantum timeline }
  
  // Color palettes
  @colorPalettes := {
    vibrant neon colors | muted earth tones | monochromatic blue scheme | high contrast black and white |
    sepia tones | vibrant primary colors | pastel palette | dark gothic tones | cyberpunk neon and black |
    ethereal iridescent hues | vintage color grading | desaturated post-apocalyptic palette |
    rich jewel tones | technicolor vibrancy | neon noir palette | golden hour warmth |
    cool blue night tones | red and teal contrast | sunset gradient | lush green and brown forest palette |
    desert yellows and oranges | underwater blue-greens | arctic whites and blues | volcanic reds and blacks |
    misty gray scale | high saturation anime palette | low saturation dystopian palette | split complementary colors |
    analogous color harmony | triadic color scheme | cinematic color grading | sci-fi blue tint |
    action orange and teal | horror red and black | fantasy golden glow | 8-bit pixel art colors |
    oil painting richness | watercolor softness | metallic sheen | bioluminescent glow |
    infrared photography style | X-ray negative | thermal imaging colors | bleach bypass look |
    cross-processed film look | duotone stylization | technicolor dream | acid trip psychedelia }
  
  // Artistic styles
  @artisticStyles := {
    photorealistic | hyperrealistic | semi-realistic | stylized realism | impressionistic |
    expressionist | surrealist | art nouveau | art deco | cubist | baroque | renaissance |
    romantic | neoclassical | pop art | digital art | concept art | matte painting |
    illustration | comic book style | anime-inspired | watercolor effect | oil painting style |
    pencil sketch | ink drawing | pixel art | low poly | vaporwave aesthetic | minimalist |
    maximalist | abstract | figurative | trompe l'oeil | ukiyo-e | graffiti art | retro futurism |
    dieselpunk | biopunk | solarpunk | cassette futurism | atompunk | nanopunk | stonepunk |
    clockpunk | sandalpunk | nowpunk | cyberpunk | steampunk | graphic novel | cel-shaded |
    studio ghibli inspired | high renaissance | dutch golden age | bauhaus | synthwave | voxel art |
    papercraft | silhouette art | cutout animation style | collage | macabre | grotesque |
    psychedelic | outsider art | naive art | folk art | primitivism | brutalism | victorian illustration }
  
  // Video game graphics terms
  @gameGraphicsTerms := {
    RTX ray tracing | DLSS enhancement | 4K textures | 8K resolution | physically-based rendering |
    procedural generation | dynamic lighting | real-time global illumination | tessellation |
    LOD system | anti-aliasing | anisotropic filtering | ambient occlusion | screen space reflections |
    subsurface scattering | motion capture animation | skeletal animation | particle effects |
    volumetric fog | dynamic weather system | destructible environment | cloth physics |
    fluid dynamics | hair works | photogrammetry assets | next-gen character models |
    facial motion capture | high-polygon count | voxel-based rendering | real-time lighting |
    cascaded shadow maps | physics-based animation | vertex shading | pixel shading |
    post-processing effects | HDR rendering | tone mapping | bokeh depth of field |
    temporal anti-aliasing | occlusion culling | Nanite micro-polygon rendering | Lumen GI system |
    MetaHuman detail level | Quixel Megascans | parallax occlusion mapping | decal layering |
    dynamic vegetation | inverse kinematics | real-time reflections | TXAA | FXAA | MSAA |
    shader-based effects | realistic fur rendering | contact shadows | screen space global illumination |
    texture streaming | mip-mapping | normal map detail | specular mapping | micro-surface detail |
    hardware tessellation | DirectX ray tracing | Vulkan API | UE5 Virtual Shadow Maps |
    UE5 Lumen reflections | frame generation | NVIDIA DLSS 3 | AMD FSR 3 | Intel XeSS }
  
  // Camera settings
  @cameraSettings := {
    f/1.4 aperture | f/2.8 aperture | f/8 aperture | 85mm lens | 24mm wide-angle | 200mm telephoto |
    macro photography | ISO 100 | tilt-shift effect | panoramic view | long exposure | high-speed capture |
    polarizing filter | neutral density filter | fish-eye lens | anamorphic lens | prime lens |
    zoom lens | ultra-wide angle | medium format | full-frame sensor | shallow depth of field |
    deep focus | focus pull | 3-point perspective | orthographic view | 1-point perspective |
    2-point perspective | drone shot | GoPro wide | pinhole camera effect | 360-degree view |
    stereoscopic 3D | time-lapse | motion blur | rack focus | snorkel lens | close-up lens |
    "telephoto compression"
  }
  
  // Film directors for style references
  @directors := {
    Stanley Kubrick | Christopher Nolan | Denis Villeneuve | Ridley Scott | Wes Anderson |
    David Fincher | Andrei Tarkovsky | Akira Kurosawa | Steven Spielberg | James Cameron |
    Guillermo del Toro | Terrence Malick | Wong Kar-wai | Quentin Tarantino | Peter Jackson |
    Alfonso Cuarón | Hayao Miyazaki | David Lynch | Coen Brothers | George Miller |
    Bong Joon-ho | Paul Thomas Anderson | Martin Scorsese | Spike Lee | Yorgos Lanthimos |
    Park Chan-wook | Ari Aster | Robert Eggers | Jordan Peele | Andrzej Zulawski }
  
  // Technical details to add verisimilitude
  @technicalDetails := {
    rendered at 8K resolution | 1000 samples per pixel | Redshift render engine | 64GB memory usage |
    100 hours render time | 24-core CPU calculation | dual A6000 GPU rendering | Xeon processor |
    CUDA acceleration | OptiX denoising | AI-enhanced upscaling | super-sampling | 64-bit color depth |
    captured at 120fps | retopologized mesh | billion-polygon scene | procedural generation |
    trained on 10,000 reference images | hand-crafted topology | multi-pass rendering | composited in Nuke |
    deep learning enhancement | path-traced lighting | multi-bounce GI | 4K texture resolution |
    16K environment map | 12-stop dynamic range | filmed on IMAX 70mm | shot on RED camera |
    physical camera simulation | lens distortion simulation | chromatic aberration simulation |
    natural optical flaws | hand-animated | motion capture animation | 36-bit color space |
    VFX industry standard | studio lighting setup | on-location motion capture | zero noise floor |
    billion-triangle mesh | 16-bit floating point | photon mapping | particle simulation }
  
  // Adjectives for emphasis
  @emphasisAdjectives := {
    breathtaking | stunning | mesmerizing | photorealistic | hyperdetailed | intricate |
    astonishing | spectacular | extraordinary | phenomenal | unparalleled | incomparable |
    unmatched | magnificent | exquisite | impeccable | flawless | perfect | sublime |
    transcendent | meticulous | precise | masterful | virtuosic | visionary | revolutionary |
    groundbreaking | pioneering | innovative | cutting-edge | state-of-the-art | avant-garde |
    ultra-high-definition | crystal-clear | razor-sharp | cinematic | theatrical | dramatic |
    epic | grand | majestic | monumental | colossal | gigantic | immense | vast | sweeping |
    panoramic | expansive | immersive | engrossing | captivating | spellbinding | enthralling |
    enchanting | bewitching | hypnotic | surreal | dreamlike | fantastical | otherworldly |
    ethereal | mystical | magical | hypnotic | uncanny | intense | powerful | dynamic |
    energetic | vibrant | radiant | luminous | incandescent | lustrous | scintillating |
    coruscating | dazzling | glittering | sparkling | shimmering | gleaming | glowing | 
    phosphorescent | iridescent | resplendent | opulent | lavish | luxurious | sumptuous |
    elegant | sophisticated | refined | polished | impeccable | pristine | immaculate }
  
  // Scene descriptions
  @sceneDescriptors := {
    a single moment frozen in time | the aftermath of an epic battle | a tranquil scene disrupted |
    a pivotal moment of decision | an unexpected encounter | a revealing discovery |
    the calm before the storm | a fateful reunion | a desperate escape | a triumphant return |
    a moment of profound realization | a tense standoff | a spectacular reveal | a quiet moment of reflection |
    a chaotic convergence of events | the beginning of a journey | the end of an era |
    a mysterious ritual | an impossible occurrence | a dramatic transformation | a climactic confrontation |
    a subtle exchange | a shocking betrayal | an emotional farewell | a miraculous survival |
    a frightening revelation | an intimate conversation | a grand celebration | a somber ceremony |
    a spectacular demonstration | a clandestine meeting | a desperate last stand | a new dawn |
    the turning point | the final moments | an unexpected alliance | a moment of sacrifice |
    a glorious victory | a crushing defeat | a narrow escape | a moment suspended in time |
    the silence after chaos | a breathtaking vista revealed | a tense infiltration | a dazzling performance |
    a crucial experiment | a solemn oath | a tragic loss | a hopeful beginning | an ominous warning |
    a tearful reunion | a mysterious disappearance | an impossible choice | a desperate gamble |
    a spectacular failure | a surprising success | a world-changing event | a personal revelation |
    a quiet moment before action | the eye of the storm | a surreal dream sequence | a memory revisited |
    an altered state of consciousness | a glimpse of another world | a premonition of things to come |
    a vision of what might have been | the threshold of discovery | the brink of disaster |
    the edge of the unknown | the culmination of events | the convergence of destinies |
    the revelation of truth | the shattering of illusions | the moment everything changed }
  
  // Cinematography techniques
  @cinematographyTechniques := {
    tracking shot | steadicam movement | dolly zoom | extreme close-up | bird's eye view |
    worm's eye view | Dutch angle | long take | slow motion | time-lapse | freeze frame |
    split screen | rack focus | deep focus | shallow focus | handheld camera | whip pan |
    crane shot | aerial shot | establishing shot | medium shot | two-shot | over-the-shoulder shot |
    point-of-view shot | cutaway | insert shot | master shot | montage sequence | cross-cutting |
    parallel editing | jump cut | match cut | smash cut | dissolve transition | fade to black |
    lens flare | forced perspective | practical effects | anamorphic lens distortion | fish-eye perspective |
    tilt-shift focus | day for night | pull focus | snap zoom | push in | pull out | circular dolly |
    overhead shot | low-angle shot | high-angle shot | canted frame | locked-down shot | Snorricam |
    bullet-time | ramping | crash zoom | contre-jour | silhouette | Vertigo effect | timelapse |
    hyperlapse | dynamic framing | symmetrical composition | leading lines | rule of thirds }

  // Weather/environment conditions
  @weather := {
    golden hour sunlight | blue hour twilight | misty morning | heavy rainfall | light drizzle |
    snowfall | blizzard conditions | foggy atmosphere | hazy air | clear blue skies | stormy weather |
    thunderstorm approaching | lightning strikes | gusty winds | calm stillness | dust storm |
    sandstorm | heat wave distortion | aurora borealis | meteor shower | double rainbow |
    sunset glow | sunrise illumination | dappled sunlight | moonlit night | starry sky |
    cloudy overcast | partly cloudy | sunbeams through clouds | crepuscular rays | sunburst |
    lens flare | god rays | glare effect | diffused lighting | harsh shadows | soft shadows |
    rim lighting | backlit scene | silhouette | volumetric light | halo effect | light pollution |
    desert heat | tropical humidity | arctic chill | seasonal changes | autumn leaves |
    spring blossoms | summer haze | winter frost | morning dew | after rain wetness |
    dry desert air | humid jungle atmosphere | crisp mountain air | salty sea breeze }
  
  // Materials and textures
  @materialsTextures := {
    brushed metal | polished chrome | burnished bronze | weathered copper | rusted iron |
    carbon fiber | smooth glass | rough stone | polished marble | textured granite |
    rough wood grain | smooth leather | woven fabric | coarse burlap | fine silk |
    reflective surface | translucent material | transparent crystal | opaque material |
    iridescent surface | pearlescent finish | matte finish | glossy finish | satin finish |
    metallic sheen | plastic texture | rubber texture | ceramic glaze | porcelain smoothness |
    paper texture | cardboard surface | concrete texture | asphalt roughness | sandpaper grit |
    velvet softness | fur detail | feather detail | scale pattern | skin texture |
    veined stone | crystalline structure | liquid surface | water droplets | ice crystals |
    snow texture | sand granules | soil texture | grass blades | leaf texture |
    bark texture | moss covering | lichen growth | coral texture | shell patterns |
    bone structure | canvas weave | knitted pattern | woven pattern | embroidered detail |
    quilted surface | beaded decoration | sequined embellishment | hammered metal |
    etched surface | engraved detail | carved relief | 3D printed layers | anodized coating |
    patinated finish | bioluminescent glow | phosphorescent material | holographic surface |
    fractured glass | cracked leather | weathered wood | eroded stone | corroded meta }
  
  // Special effects
  @specialEffects := {
    particle effects | smoke simulation | fire dynamics | water simulation | cloth physics |
    hair dynamics | explosion effects | shockwave distortion | bullet time | time dilation |
    slow motion capture | speed ramping | motion blur | lens distortion | anamorphic lens flare |
    chromatic aberration | depth of field | tilt-shift effect | barrel distortion | fish-eye distortion |
    bloom effect | HDR lighting | tone mapping | color grading | LUT application |
    film grain | noise reduction | sharpening | vignette effect | edge darkening |
    glow effect | halo effect | god rays | light scattering | volumetric lighting |
    subsurface scattering | caustics | refraction | reflection | specular highlights |
    ambient occlusion | screen space reflections | ray-traced reflections | ray-traced shadows |
    ray-traced global illumination | path tracing | photon mapping | radiosity | real-time GI |
    soft particles | motion vectors | velocity buffer | atmospheric effects | weather system |
    day-night cycle | seasonal changes | snow accumulation | rain effects | puddle formation |
    wet surface reflections | dynamic weather | procedural clouds | volumetric clouds |
    holographic projection | force field visualization | energy effect | magic visualization |
    quantum effect | dimensional rift | optical illusion | mirage effect | heat distortion }

In a @moods, @timePeriods setting, a @characters appears in a @subjects, surrounded by @colorPalettes.
The moment captures @sceneDescriptors, featuring @2-5,renderingTerms, @2-5,cinematicTerms, and @2-5,lightingTerms.
Technical details include @gameGraphicsTerms, @2-5,gameGraphicsTerms, @1-3,technicalDetails.
Shot with @1-3,cameraSettings, composed using @1-3,cinematographyTechniques techniques under @weather.
The style leans toward @artisticStyles, influenced by @directors.
The environment includes @1-3,materialsTextures, enhanced with @1-3,specialEffects.
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
const userSelection = requestFromUser("Wildcards", "", function() {
  return [
	  this.section("Prompt", uiHint, [
		  this.textField(promptString, fallbackPrompt, true, 240),
		  this.slider(10, this.slider.fractional(0), 1, 500, "batch count")
    ]),
	  this.section("about",
                 `Wildcards Plus v0.2 by ariane-emory (based on wetcircuit's original wildcard.js script)

Generate a batch of images using inline wildcards to randomize elements within the Prompt.

Added features:
 -  support for weighted wildcards: if the first non-whitspace 'word' in an alternative is a positive integer, it is taken to be a weighting, otherwise an alternative's default weight is 1... so, this prompt generates 'cat' half of the time:
    '{ dog | 2 cat | bird }'

  - support for nested wildcards, for example the following prompt, which, when it generates a cat, will generate a siamese cat half of the time (note the empty alternative):
    'A { dog | 2 { 2 siamese | tabby | } cat | bird } in a { 2 field | kitchen }.'
`,
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
