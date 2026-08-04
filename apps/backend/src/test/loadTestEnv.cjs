// Load environment for the DB-backed contract tests before the app's config/env.ts
// validates process.env. env.ts calls dotenv.config() (targets .env, absent here), so
// these tests need the vars loaded first.
//
//  - .env.test  (committed) holds CI/docker-compose values (service hostnames postgres/redis).
//  - .env.local (gitignored) holds a developer/sandbox host's values (localhost + published
//    ports) and, when present, OVERRIDES .env.test so the same runner works on a dev box.
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');

const backendRoot = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(backendRoot, '.env.test') });

const localEnv = path.join(backendRoot, '.env.local');
if (fs.existsSync(localEnv)) {
  dotenv.config({ path: localEnv, override: true });
}

process.env.NODE_ENV = 'test';
