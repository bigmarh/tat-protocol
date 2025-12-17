# Contributing to TAT Protocol

Thank you for your interest in contributing to TAT Protocol! This document provides guidelines for contributing to both the protocol specification and its reference implementation.

---

## Table of Contents

1. [Types of Contributions](#types-of-contributions)
2. [Protocol Changes](#protocol-changes)
3. [Code Contributions](#code-contributions)
4. [Documentation](#documentation)
5. [Community Guidelines](#community-guidelines)
6. [Development Setup](#development-setup)
7. [Testing](#testing)
8. [Submitting Changes](#submitting-changes)

---

## Types of Contributions

### Protocol-Level Contributions

Changes to the protocol specification itself:
- New token types
- New NWPC methods
- Cryptographic algorithm changes
- Protocol versioning changes
- Wire format modifications

**Process**: Follow the [TAT Protocol Standards (TPS) Process](#tat-protocol-standards-tps)

### Implementation Contributions

Changes to the TypeScript reference implementation:
- Bug fixes
- Performance improvements
- New features (that don't change protocol)
- Test coverage
- Documentation

**Process**: Standard GitHub pull request workflow

### Documentation Contributions

- Guides and tutorials
- API documentation
- Example code
- Translations
- Typo fixes

**Process**: Submit PR directly

---

## Protocol Changes

### TAT Protocol Standards (TPS)

For changes to the protocol itself, we follow a standards process similar to Bitcoin BIPs or Ethereum EIPs.

#### TPS Document Structure

```markdown
TPS-XXX: [Title]
Author: [Your Name] <email@example.com>
Status: Draft | Review | Accepted | Rejected | Superseded
Created: YYYY-MM-DD
Supersedes: TPS-YYY (if applicable)
Superseded-By: TPS-ZZZ (if applicable)

## Abstract
[Brief summary]

## Motivation
[Why this change is needed]

## Specification
[Technical details]

## Backwards Compatibility
[Impact on existing implementations]

## Reference Implementation
[Link to code or pseudocode]

## Security Considerations
[Security implications]

## Test Vectors
[Examples for validation]
```

#### TPS Process Steps

1. **Draft**: Create TPS document in `specs/tps/` directory
2. **Discussion**: Open GitHub issue for community feedback
3. **Review**: Core maintainers review technical details
4. **Implementation**: Create reference implementation
5. **Testing**: Ensure interoperability with test vectors
6. **Acceptance**: TPS merged, protocol version bumped if needed

#### TPS Categories

**Core (Breaking Changes)**
- Affects token structure
- Changes signature algorithm
- Modifies validation rules
- Requires MAJOR version bump

Examples: TPS-001 (Core Token Format), TPS-002 (NWPC Protocol)

**Feature (Additive Changes)**
- New optional fields
- New NWPC methods
- New token types
- Requires MINOR version bump

Examples: TPS-010 (Token Revocation), TPS-011 (Multi-Signature)

**Informational**
- Best practices
- Design patterns
- Implementation guidelines
- No version bump

Examples: TPS-100 (Storage Best Practices), TPS-101 (Key Management)

#### Versioning Rules

TAT Protocol uses semantic versioning:

**MAJOR.MINOR.PATCH** (e.g., 1.2.3)

- **MAJOR**: Breaking protocol changes (incompatible tokens)
  - Change signature algorithm
  - Modify required fields
  - Change token validation rules

- **MINOR**: Backward-compatible additions
  - New optional fields
  - New NWPC methods
  - New token types

- **PATCH**: Documentation, clarifications, no protocol changes
  - Fix typos in spec
  - Clarify ambiguous language
  - Add examples

**Example Protocol Evolution:**

```
1.0.0 → Core protocol (FUNGIBLE, TAT tokens)
1.1.0 → Add token revocation (new NWPC method)
1.2.0 → Add multi-signature support (new optional field)
1.2.1 → Clarify time lock behavior (documentation)
2.0.0 → Add new signature algorithm option (breaking change)
```

#### Template for New TPS

```bash
# Copy template
cp specs/tps/TPS-000-template.md specs/tps/TPS-XXX-your-title.md

# Edit with your changes
vim specs/tps/TPS-XXX-your-title.md

# Open discussion issue
gh issue create --title "TPS-XXX: Your Title" --body "Discussion for TPS-XXX"
```

---

## Code Contributions

### Before You Start

1. **Check Existing Issues**: Look for related issues or PRs
2. **Open an Issue**: For non-trivial changes, discuss first
3. **Fork the Repo**: Create your own fork
4. **Create Branch**: Use descriptive branch names

```bash
git checkout -b feature/add-token-validation
git checkout -b fix/double-spend-bug
git checkout -b docs/improve-readme
```

### Code Standards

**TypeScript Style:**
- Use TypeScript strict mode
- Prefer `const` over `let`
- Use explicit return types
- Document public APIs with JSDoc
- Follow existing code formatting

**Example:**
```typescript
/**
 * Validates a token's signature and structure
 * @param token - The JWT token string to validate
 * @returns True if valid, false otherwise
 * @throws {Error} If token format is invalid
 */
export async function validateToken(token: string): Promise<boolean> {
  // Implementation
}
```

**Linting and Formatting:**
```bash
# Run linter
pnpm lint

# Auto-fix formatting
pnpm format

# Type check
pnpm build
```

### Testing Requirements

All code changes must include tests:

**Unit Tests:**
```typescript
describe('Token.validate', () => {
  it('should accept valid FUNGIBLE token', async () => {
    const token = await createTestToken();
    expect(await token.validate()).toBe(true);
  });

  it('should reject expired token', async () => {
    const token = await createExpiredToken();
    expect(await token.validate()).toBe(false);
  });
});
```

**Integration Tests:**
```typescript
describe('Mint → Transfer flow', () => {
  it('should complete full token lifecycle', async () => {
    const forge = await createForge();
    const pocket1 = await createPocket();
    const pocket2 = await createPocket();

    // Mint
    await forge.mint(pocket1.publicKey, 100);
    expect(pocket1.balance).toBe(100);

    // Transfer
    await pocket1.transfer(pocket2.publicKey, 50);
    expect(pocket1.balance).toBe(50);
    expect(pocket2.balance).toBe(50);
  });
});
```

**Run Tests:**
```bash
# All tests
pnpm test

# Specific package
pnpm test --filter @tat-protocol/token

# Watch mode
pnpm test:watch

# Coverage
pnpm test:coverage
```

### Performance Considerations

- Use bloom filters for large spent-token sets
- Implement LRU caching for frequent lookups
- Batch Nostr events when possible
- Profile before optimizing

### Security Requirements

- Never log private keys
- Validate all inputs
- Use constant-time comparisons for secrets
- Handle errors without leaking information
- Follow [SECURITY.md](./SECURITY.md) guidelines

---

## Documentation

### Code Documentation

**Required for Public APIs:**
```typescript
/**
 * Brief one-line summary
 *
 * Longer description if needed, explaining behavior,
 * use cases, and any important caveats.
 *
 * @param paramName - Description of parameter
 * @returns Description of return value
 * @throws {ErrorType} When this error occurs
 *
 * @example
 * ```typescript
 * const result = await myFunction('example');
 * console.log(result);
 * ```
 */
```

### README Updates

When adding features, update relevant READMEs:
- Package README (packages/*/README.md)
- Main README (README.md)
- Getting Started guide (GETTING_STARTED.md)

### Protocol Documentation

When changing protocol, update:
- [PROTOCOL_SPEC.md](./PROTOCOL_SPEC.md) - Formal specification
- [INTEROPERABILITY.md](./INTEROPERABILITY.md) - Test vectors
- [TAT_PROTOCOL.md](./TAT_PROTOCOL.md) - Overview
- Add entry to CHANGELOG.md

---

## Community Guidelines

### Code of Conduct

We follow the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/).

**In Summary:**
- Be respectful and inclusive
- Welcome newcomers
- Provide constructive feedback
- Focus on what's best for the protocol
- Assume good intentions

### Communication Channels

- **GitHub Issues**: Bug reports, feature requests
- **GitHub Discussions**: General questions, ideas
- **Pull Requests**: Code review, technical discussion
- **Security Issues**: security@tat-protocol.org (private)

### Issue Guidelines

**Bug Reports:**
```markdown
## Description
[Clear description of the bug]

## Steps to Reproduce
1. Step one
2. Step two
3. Step three

## Expected Behavior
[What should happen]

## Actual Behavior
[What actually happens]

## Environment
- OS: [e.g., macOS 14.0]
- Node: [e.g., 20.10.0]
- Package Version: [e.g., 1.2.3]

## Additional Context
[Logs, screenshots, etc.]
```

**Feature Requests:**
```markdown
## Problem Statement
[What problem does this solve?]

## Proposed Solution
[How would you solve it?]

## Alternatives Considered
[What other approaches did you consider?]

## Impact
[Who benefits? Any breaking changes?]
```

---

## Development Setup

### Prerequisites

- Node.js >= 16.0.0
- pnpm >= 8.0.0
- Git

### Initial Setup

```bash
# Clone repository
git clone https://github.com/tat-protocol/tat-protocol.git
cd tat-protocol

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

### Monorepo Structure

```
tat-protocol/
├── packages/
│   ├── token/        # Token creation and validation
│   ├── forge/        # Token issuance
│   ├── pocket/       # Wallet functionality
│   ├── nwpc/         # Network protocol
│   ├── storage/      # Storage backends
│   ├── utils/        # Utility functions
│   ├── hdkeys/       # HD key management
│   ├── boxoffice/    # Event ticketing
│   ├── turnstile/    # Access control
│   ├── tdk/          # Complete SDK
│   └── config/       # Configuration
├── specs/
│   └── tps/          # Protocol standards
├── examples/         # Example applications
└── tests/            # Integration tests
```

### Working with Packages

```bash
# Add dependency to specific package
pnpm add --filter @tat-protocol/token some-dependency

# Build specific package
pnpm build --filter @tat-protocol/token

# Watch mode for development
pnpm build --filter @tat-protocol/token --watch
```

### Debugging

```bash
# Enable debug logging
DEBUG=* pnpm test

# Debug specific modules
DEBUG=NWPC:*,Token:* pnpm test

# Node.js debugger
node --inspect-brk node_modules/.bin/jest --runInBand
```

---

## Testing

### Test Structure

```
tests/
├── unit/              # Unit tests (fast, isolated)
├── integration/       # Integration tests (cross-package)
├── e2e/               # End-to-end tests (full scenarios)
└── performance/       # Performance benchmarks
```

### Writing Tests

**Good Test Characteristics:**
- **Fast**: Unit tests run in milliseconds
- **Isolated**: No external dependencies
- **Deterministic**: Same result every time
- **Descriptive**: Clear what's being tested

**Example:**
```typescript
describe('TokenValidator', () => {
  describe('validateSignature', () => {
    it('should accept valid Schnorr signature', async () => {
      const token = await createValidToken();
      const validator = new TokenValidator();

      const result = await validator.validateSignature(token);

      expect(result).toBe(true);
    });

    it('should reject tampered payload', async () => {
      const token = await createTamperedToken();
      const validator = new TokenValidator();

      const result = await validator.validateSignature(token);

      expect(result).toBe(false);
    });
  });
});
```

### Running Tests

```bash
# All tests
pnpm test

# Unit tests only
pnpm test:unit

# Integration tests
pnpm test:integration

# Performance tests
pnpm test:performance

# Watch mode
pnpm test:watch

# Coverage report
pnpm test:coverage
```

### Test Coverage Requirements

- **Unit Tests**: 80%+ coverage for core packages
- **Integration Tests**: Cover all NWPC methods
- **E2E Tests**: Cover main user flows

---

## Submitting Changes

### Pull Request Process

1. **Update Your Branch**
   ```bash
   git checkout main
   git pull upstream main
   git checkout your-branch
   git rebase main
   ```

2. **Run Checks**
   ```bash
   pnpm build
   pnpm test
   pnpm lint
   ```

3. **Commit Messages**

   Follow [Conventional Commits](https://www.conventionalcommits.org/):

   ```
   type(scope): description

   Longer explanation if needed.

   Fixes #123
   ```

   **Types:**
   - `feat`: New feature
   - `fix`: Bug fix
   - `docs`: Documentation only
   - `style`: Formatting, no code change
   - `refactor`: Code restructuring
   - `test`: Adding tests
   - `chore`: Maintenance tasks

   **Examples:**
   ```
   feat(token): add multi-signature support
   fix(forge): prevent double-spend in edge case
   docs(readme): improve installation instructions
   ```

4. **Push and Create PR**
   ```bash
   git push origin your-branch
   # Open PR on GitHub
   ```

5. **PR Description Template**
   ```markdown
   ## Description
   [What does this PR do?]

   ## Motivation
   [Why is this change needed?]

   ## Changes
   - [ ] Change one
   - [ ] Change two

   ## Testing
   [How was this tested?]

   ## Checklist
   - [ ] Tests pass
   - [ ] Documentation updated
   - [ ] CHANGELOG.md updated (if applicable)
   - [ ] No breaking changes (or documented)

   ## Related Issues
   Closes #123
   ```

### Review Process

1. **Automated Checks**: CI must pass
2. **Code Review**: At least one maintainer approval
3. **Testing**: Reviewers may test locally
4. **Discussion**: Address feedback
5. **Merge**: Squash and merge (typically)

### After Merge

- Delete your branch
- Update your fork
- Celebrate! 🎉

---

## Recognition

Contributors are recognized in:
- CHANGELOG.md (for significant contributions)
- GitHub contributors page
- Release notes

---

## Questions?

- Open a [Discussion](https://github.com/tat-protocol/tat-protocol/discussions)
- Ask in an existing Issue
- Review existing documentation

---

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

**Thank you for contributing to TAT Protocol!** 🚀

---

**Last Updated**: 2025-12-17
**Version**: 1.0.0
