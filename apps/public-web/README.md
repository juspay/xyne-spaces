# Xyne Spaces - Public Web (Deep Links)

This folder (`apps/public-web`) hosts the **Public Link Domain** for Xyne Spaces. 

It is hosted on **Firebase Hosting** (e.g., `https://xyne-spaces.web.app`) to serve standard "App Link" verification files that must be public (bypassing the VPN/mTLS of the main backend).

## Purpose
1.  **Deep Linking**: Hosts `.well-known/assetlinks.json` (Android) and `apple-app-site-association` (iOS) to enable direct app launching.
2.  **Smart Landing Page**: If the app is not installed (or on Desktop), `index.html` provides a fallback UI to download or open the app.

## Prerequisites
- **Node.js**: Ensure Node is installed.
- **Firebase CLI**: Install globally or use via `npx`.
  ```bash
  npm install -g firebase-tools
  ```

## Setup
1.  **Login to Firebase**:
    ```bash
    firebase login
    ```
    *Ensure you log in with an account that has **Editor** or **Firebase Hosting Admin** permissions on the `xyne-spaces` project.*

2.  **Initialize (Only if connecting to a new project)**:
    ```bash
    firebase init hosting
    ```
    *   **Public directory**: `public`
    *   **Single-page app**: `No` (We rely on custom rewrites in `firebase.json`)
    *   **Overwrite**: `No`

## Deployment

To deploy changes (e.g., updating the landing page or verification files):

```bash
cd apps/public-web
firebase deploy
```

## Structure
- **`firebase.json`**: Configures rewrites to route everything to `index.html` and sets correct content-type headers for `.well-known` files.
- **`public/index.html`**: The main entry point. Contains logic to:
    - Detect current path (e.g., `/chat/123`).
    - Redirect to custom scheme `xyne-spaces://chat/123`.
    - Show "Install via Kandji" on Desktop.
    - Show TestFlight/AppTester info on Mobile.
- **`public/.well-known/`**: Contains the static JSON files required by Android and iOS OS to verify the domain.
