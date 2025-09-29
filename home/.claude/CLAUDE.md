# **Core Principle**
Always think critically and deeply before acting. Implement only the specific tasks requested with the most concise, maintainable, and elegant solution that minimizes code changes.

## Tool Preferences - CRITICAL REQUIREMENTS
These are MANDATORY. Violations are unacceptable.

- **Code Modifications**: ONLY use ast-grep for code changes. Edit/MultiEdit tools are FORBIDDEN for code files
  - If ast-grep cannot handle a change, ASK FIRST before using alternatives
- **File Search**: ONLY use fd. The find command is FORBIDDEN.
- **Text Search**: ONLY use ripgrep (rg). The grep command and Grep tool are FORBIDDEN.
- **Text Processing**: ONLY use sed and awk for find/replace operations.
- **Directory Exploration**: ONLY use tree. Commands like ls -la are FORBIDDEN for directory exploration.

## Before Every Code Change
STOP and verify:
1. Am I using ast-grep? (Required for .ts, .js, .svelte, .tsx, .jsx, etc.)
2. Am I using fd for file search? (Not find)
3. Am I using rg for text search? (Not grep/Grep tool)

If NO to any: STOP and use the correct tool.

## Violations
If you ignore these preferences:
- STOP immediately when corrected
- Acknowledge the specific violation
- Explain what you should have done instead

## Development Standards
### Code Quality
- Prioritize readability and maintainability
- Make minimal, surgical changes
- Preserve existing code style and conventions
- Test changes before finalizing
- **Never compromise type safety**: No `any`, no non-null assertion operator (`!`), no type assertions (`as Type`)

### Testing Philosophy
- Write tests that verify semantically correct behaviour
- **Failing tests are acceptable** when they expose genuine bugs
- Let test failures guide TDD - they indicate what needs fixing
- Focus on testing the right behaviour, not just making tests pass

### Communication
- Never include AI attribution in commits or PRs
- Write clear, concise commit messages focused on the change itself
- Document only what's necessary for human developers

### Problem-Solving Approach
- **Understand**: Fully comprehend the specific task
- **Analyze**: Examine existing code structure and patterns
- **Plan**: Design the minimal change needed
- **Execute**: Implement with precision
- **Verify**: Ensure the solution works and doesn't break existing functionality

### Command Examples
```bash
# Find files
fd "pattern" --type f --extension js

# Search code
rg "function.*async" --type js

# AST-based refactoring
ast-grep --pattern 'console.log($ARG)' --rewrite 'logger.debug($ARG)' --lang js

# Explore structure
tree -I 'node_modules|.git' -L 3
```

**Remember**
Quality over quantity. Think twice, code once.
