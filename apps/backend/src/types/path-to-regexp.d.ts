// path-to-regexp 0.1.x (the version Express 4 uses) ships no types.
declare module 'path-to-regexp' {
  interface Key {
    name: string | number;
    optional: boolean;
    offset: number;
  }
  interface Options {
    sensitive?: boolean;
    strict?: boolean;
    end?: boolean;
  }
  function pathToRegexp(path: string | RegExp | (string | RegExp)[], keys?: Key[], options?: Options): RegExp;
  export = pathToRegexp;
}
