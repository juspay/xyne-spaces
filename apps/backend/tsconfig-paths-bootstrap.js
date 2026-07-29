// const tsConfig = require('./tsconfig.json');
// const tsConfigPaths = require('tsconfig-paths');

import tsConfig from "./tsconfig.json" with { type: "json" };
import {register} from "tsconfig-paths"

const baseUrl = './dist';
register({
  baseUrl,
  paths: tsConfig.compilerOptions.paths,
});
