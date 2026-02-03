# safe-push

A Bun CLI tool for safe Git push operations. Detects changes to forbidden areas (default: `.github/`) and blocks pushes based on configurable conditions.

## Installation

```bash
bun install
bun run build
```

Global installation:

```bash
bun link
```

## Usage

### Check Push Permission

```bash
safe-push check           # Display result in human-readable format
safe-push check --json    # Output result as JSON
```

### Execute Push

```bash
safe-push push            # Check and push if allowed
safe-push push --force    # Bypass safety checks
safe-push push --dry-run  # Show result without actually pushing
```

### Configuration Management

```bash
safe-push config init     # Initialize configuration file
safe-push config init -f  # Overwrite existing configuration
safe-push config show     # Show current configuration
safe-push config path     # Show configuration file path
```

## Push Permission Rules

```
Push Allowed = (No forbidden changes) AND (New branch OR Last commit is yours)
```

| Forbidden Changes | New Branch | Last Commit Yours | Result  |
|-------------------|------------|-------------------|---------|
| No                | Yes        | -                 | Allowed |
| No                | No         | Yes               | Allowed |
| No                | No         | No                | Blocked |
| Yes               | -          | -                 | Blocked |

## Configuration

**Path**: `~/.config/safe-push/config.jsonc`

```jsonc
{
  // Forbidden paths (glob patterns)
  "forbiddenPaths": [".github/"],
  // Behavior on forbidden changes: "error" | "prompt"
  "onForbidden": "error"
}
```

### Options

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `forbiddenPaths` | `string[]` | `[".github/"]` | Paths to block changes (glob patterns) |
| `onForbidden` | `"error" \| "prompt"` | `"error"` | Behavior when forbidden changes detected |

- `error`: Display error and exit
- `prompt`: Ask user for confirmation

## Author Detection

Local email is determined by the following priority:

1. Environment variable `SAFE_PUSH_EMAIL`
2. `git config user.email`

## Development

```bash
# Run in development
bun run dev -- check

# Type check
bun run typecheck

# Build
bun run build
```

## License

MIT
