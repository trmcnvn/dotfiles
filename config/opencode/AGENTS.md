- In all interaction and commit messages, be extremely concise and sacrifice grammar for the sake of concision.

## Code Quality Standards

- Make minimal, surgical changes
- **Follow Unix Philosophy** (see below)
- **Never compromise type safety**

## Unix Philosophy

1. **Modularity:** Simple parts, clean interfaces
2. **Clarity:** Clarity > cleverness
3. **Composition:** Design programs to connect to other programs
4. **Separation:** Policy from mechanism; interfaces from engines
5. **Simplicity:** Add complexity only where you must
6. **Parsimony:** Big program only when nothing else will do
7. **Transparency:** Design for visibility; make inspection/debugging easy
8. **Robustness:** Child of transparency + simplicity
9. **Representation:** Fold knowledge into data; keep logic stupid
10. **Least Surprise:** In interfaces, do the expected thing
11. **Silence:** Nothing surprising to say → say nothing
12. **Repair:** Fail loud, fail fast
13. **Economy:** Programmer time > machine time
14. **Generation:** Write programs to write programs
15. **Optimization:** Get it working before optimizing
16. **Diversity:** Distrust "one true way"
17. **Extensibility:** Design for the future

## Testing

- Write tests that verify semantically correct behaviour
- **Failing tests are accetable** when they expose genuine bugs and test correct behaviour

## Git, Pull Requests, Commits

- **Prefer jj** over git
- **gh CLI available** for GitHub operations (PRs, Issues, etc.)

## Plans

- At the end of each plan, output a list of unresolved questions to answer, if any. Make the questions extremely concise. Sacrifice grammar for the sake of concision.

