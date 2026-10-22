# wg-studio

[한국어](README-ko.md)

A browser-based configuration editor for WireGuard / wg-quick.

## Getting Started

With Node.js 22.18 or later, install the development dependencies and start the development server:

```sh
npm ci
npm run dev
```

Open http://localhost:5173 in your browser. To use a different port, run `npm run dev -- --port 8080`.

```sh
npm run typecheck
npm test
npm run build
npm run preview
```

## Features

- Edit multiple configuration files in separate tabs
- File menu: new configuration, open file, import plaintext, save, save as, and rename
- Interface and Peer sections with standard and custom fields, including field addition and removal
- Edit Address / DNS / AllowedIPs as either strings or lists, with changes synchronized in both directions
- Two-way synchronization between configuration source and form fields, with syntax error locations
- Preserve comments, blank lines, unknown fields, and repeated PostUp / PostDown entries
- Default Interface and Peer fields
- Generate private and preshared keys, and derive public keys from private keys
- Keep keys editable just like any other field
- Undo, unsaved-change indicators and close confirmation, light/dark themes, and a responsive layout
- Keyboard shortcuts: Ctrl/Cmd+O to open, Ctrl/Cmd+S to save, and Ctrl/Cmd+Shift+S to save as

## Project Structure

```text
src/
  main.ts                 # Register components, then start the application
  app/                    # Application controller and panel/export coordination
  core/                   # Config parsing, keys, canvas math, export and state models
  components/
    shell/                # App shell and top menu
    canvas/               # Network canvas and configuration cards
    editor/               # Config editor, fields and editable profile title
    tabs/                 # File tabs and section navigation
    panel/                # Resizable work panel and task views
    keys/                 # Key-pair library
    export/               # Export view
    shared/               # Component base, HTML escaping, tooltips and confirmations
    register.ts           # Custom Element registration
  i18n/                   # English/Korean catalogs and locale selection
  styles/app.css          # Shared theme and component styles
  types/                  # Browser and Vite ambient declarations
tests/                    # Core behavior tests
public/                   # Static hosting files
.github/workflows/        # GitHub Pages deployment
```

Component HTML templates live beside their TypeScript files and are bundled by Vite using `?raw` imports. Components use Light DOM to share the existing theme. `core/` modules do not depend on application controllers or UI components; `app/` coordinates document state and component updates.

Production builds use `/wg-studio/` as the base path. After `npm run build`, preview the result at `http://localhost:4173/wg-studio/`.
