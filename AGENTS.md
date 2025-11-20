# AGENTS.md

## Build & Test Commands

- **Build**: No build step required - JavaScript ES modules
- **Test**: `./test.sh` (performance comparison between git commits)
- **Run tool**: `./wildcards-plus-tool.js <input-file> [count]`
- **With POST**: `./wildcards-plus-tool.js -p <input-file>` (posts to Draw Things API)
- **With confirmation**: `./wildcards-plus-tool.js -c <input-file>` (prompt before POSTing)

## Code Style Guidelines

### Language & Runtime
- JavaScript ES modules (type: "module" in package.json)
- Node.js for tool, Draw Things environment for main script
- No external dependencies beyond Node.js standard library

### Imports & Structure
- Node.js imports: `import * as util from 'util'`, `import * as fs from 'fs'`, etc.
- Group imports by module type with blank lines between groups
- Use absolute imports for standard library modules

### Naming Conventions
- **Variables**: `snake_case` (e.g., `log_match_enabled`, `abbreviate_str_repr_enabled`)
- **Functions**: `snake_case` (e.g., `parse_file`, `post_prompt`, `make_rule_func`)
- **Classes**: `PascalCase` (e.g., `Logger`, `Rule`, `MatchResult`)
- **Constants**: `UPPER_SNAKE_CASE` (e.g., `DISCARD`, `END_QUANTIFIED_MATCH`)
- **Private methods**: prefix with `__` (e.g., `__match`, `__impl_toString`)

### Error Handling
- Use custom `FatalParseError` class for parsing failures
- Throw errors with context using `inspect_fun()` for debugging
- Return `null` for non-matching rules, throw for actual errors
- Include input and index in error messages for parsing errors

### Code Patterns
- Parser Expression Grammar (PEG) style rule classes
- Memoization via `packrat_enabled` flag for performance
- Extensive logging controlled by global flags
- Symbolic constants (`DISCARD`, `END_QUANTIFIED_MATCH`) for special values
- Functional transformation pipelines (`pipe_funs`, `compose_funs`)

### Formatting
- 100-character line limit (indicated in file headers)
- 2-space indentation for most code
- Align related assignments vertically when helpful
- Use descriptive variable names, avoid abbreviations except common ones