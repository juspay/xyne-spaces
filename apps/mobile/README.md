# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install the repository root first (it builds `@xyne/shared`), then the app.
   The app has its own lockfile, so its install never changes the rest of the monorepo:

   ```bash
   pnpm install                 # from the repository root
   cd apps/mobile && pnpm install
   ```

2. Start the app (from `apps/mobile`):

   ```bash
   pnpm start         # Metro dev server
   pnpm ios:dev       # build + run the dev variant on iOS
   pnpm android:dev   # build + run the dev variant on Android
   ```

   After changing `packages/shared`, run `pnpm run build:shared` from the repository root.

For prerequisites, variants, every run command, checks and troubleshooting, see
[`DEV_SETUP.md`](DEV_SETUP.md).

## Testing

The mobile app uses a layered test strategy. It has two layers today: an **L1 logic layer** — fast, pure-TypeScript unit
tests that run under Node with no emulator, bundler, or rendering
([`docs/testing/logic-tests.md`](docs/testing/logic-tests.md)) — and an **L2
rendering layer** that renders real components with jest-expo + React Native
Testing Library ([`docs/testing/rendering-tests.md`](docs/testing/rendering-tests.md)).

```bash
cd apps/mobile
nvm use     # Node 22 (Expo SDK 57 needs >= 22.13); see .nvmrc
pnpm test   # runs L1 logic (node:test) then L2 rendering (jest)
```

| Script | Purpose |
|--------|---------|
| `pnpm test` | run the L1 logic layer and the L2 rendering layer |
| `pnpm run test:logic` | run all L1 logic tests once (node:test) |
| `pnpm run test:logic:watch` | re-run L1 on change while developing |
| `pnpm run test:render` | run all L2 rendering tests once (jest) |
| `pnpm run test:render:watch` | re-run L2 on change while developing |

## iOS runtime behavior

On iOS, `Debug` builds use the local Metro/dev-client flow and `Release` builds use Airborne.

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
pnpm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
