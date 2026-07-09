# Repository Guidelines

## Project Structure & Module Organization

This repository contains a React 19 application built with TypeScript and Vite. Application entry points and UI code live in `src/`; shared game-domain types are under `src/types/`, and imported images are under `src/assets/`. Static files copied directly into the build belong in `public/`. The game model specification is maintained in `docs/system/`, with example content in `docs/example/`. Keep model type changes synchronized with the corresponding documentation and JSON examples.

## Build, Test, and Development Commands

Use `pnpm`, as recorded by `pnpm-lock.yaml`.

- `pnpm install` installs dependencies from the lockfile.
- `pnpm dev` starts the Vite development server with hot module replacement.
- `pnpm build` type-checks the project and creates a production bundle in `dist/`.
- `pnpm lint` runs ESLint across the repository.
- `pnpm preview` serves the production bundle locally for final verification.

Run `pnpm lint` and `pnpm build` before opening a pull request.

## Coding Style & Naming Conventions

Follow the existing TypeScript style: two-space indentation, single quotes, no semicolons, and trailing commas where supported. Use PascalCase for React components and interfaces (`GameModelData`), camelCase for functions and variables, and descriptive lowercase file names for model documentation. Keep discriminated-union values in `snake_case` to match serialized JSON. ESLint enforces the baseline JavaScript, TypeScript, React Hooks, and Vite refresh rules; TypeScript also rejects unused locals, unused parameters, and switch fallthrough.

## Testing Guidelines

No automated test framework or coverage threshold is currently configured. Until one is added, treat `pnpm lint` and `pnpm build` as required checks, then exercise affected UI flows through `pnpm dev`. Validate model changes against examples in `docs/example/`. When introducing tests, colocate them with source files using `*.test.ts` or `*.test.tsx`, and add the runner command to `package.json`.

## Commit & Pull Request Guidelines

Recent history primarily uses Conventional Commit prefixes such as `feat:`, `refactor:`, and `docs:`. Write concise, imperative subjects focused on one logical change. Pull requests should explain the intent, summarize important implementation or model decisions, and list verification performed. Link related issues when available. Include screenshots or recordings for visible UI changes, and call out documentation or example-data migrations explicitly.
