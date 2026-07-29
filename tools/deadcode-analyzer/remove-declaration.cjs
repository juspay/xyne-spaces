#!/usr/bin/env node
/**
 * AST-based declaration removal using ts-morph.
 * Removes a specific exported symbol from a TypeScript file.
 *
 * Usage:
 *   node remove-declaration.cjs --tsconfig dashboard/tsconfig.json --file dashboard/src/foo.ts --symbol MyComponent --line 42
 */
const { Project, Node, SyntaxKind } = require("ts-morph");
const path = require("path");

function parseArgs() {
  const args = process.argv.slice(2);
  const tsconfig = getArg(args, "--tsconfig") || "tsconfig.json";
  const file = getArg(args, "--file");
  const symbol = getArg(args, "--symbol");
  const line = parseInt(getArg(args, "--line") || "0", 10);

  if (!file || !symbol || !line) {
    console.error("Usage: node remove-declaration.cjs --tsconfig <path> --file <path> --symbol <name> --line <number>");
    process.exit(1);
  }

  return { tsconfig, file, symbol, line };
}

function getArg(args, flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function getSymbolName(node) {
  if (Node.isVariableDeclaration(node)) return node.getName();
  if (Node.isFunctionDeclaration(node)) return node.getName();
  if (Node.isInterfaceDeclaration(node)) return node.getName();
  if (Node.isTypeAliasDeclaration(node)) return node.getName();
  if (Node.isClassDeclaration(node)) return node.getName();
  if (Node.isEnumDeclaration(node)) return node.getName();
  if (Node.isExportAssignment(node)) return "default";
  if (Node.isExportSpecifier(node)) return node.getName();
  return undefined;
}

function findBestDeclaration(sourceFile, targetLine, targetSymbol) {
  let bestMatch = null;
  const isDefault = targetSymbol === "default";

  function isTargetDeclaration(node) {
    return (
      Node.isVariableDeclaration(node) ||
      Node.isFunctionDeclaration(node) ||
      Node.isInterfaceDeclaration(node) ||
      Node.isTypeAliasDeclaration(node) ||
      Node.isClassDeclaration(node) ||
      Node.isEnumDeclaration(node) ||
      Node.isExportAssignment(node) ||
      Node.isExportSpecifier(node)
    );
  }

  function visit(node) {
    const startLine = node.getStartLineNumber();
    const endLine = node.getEndLineNumber();

    if (targetLine < startLine || targetLine > endLine) return;

    if (Node.isVariableStatement(node)) {
      for (const decl of node.getDeclarations()) {
        const declLine = decl.getStartLineNumber();
        const declName = getSymbolName(decl);
        if (declLine === targetLine) {
          if (declName === targetSymbol) { bestMatch = decl; return; }
          if (!bestMatch) bestMatch = decl;
        }
        visit(decl);
      }
      return;
    }

    if (isTargetDeclaration(node) && startLine === targetLine) {
      const nodeName = getSymbolName(node);
      if (nodeName === targetSymbol) { bestMatch = node; return; }
      if (isDefault && Node.isExportAssignment(node)) { bestMatch = node; return; }
      if (!bestMatch) bestMatch = node;
    }

    for (const child of node.getChildren()) visit(child);
  }

  visit(sourceFile);
  return bestMatch;
}

function removeDeclaration(node, symbol) {
  if (Node.isVariableDeclaration(node)) {
    const stmt = node.getVariableStatement();
    if (!stmt) throw new Error("VariableDeclaration without VariableStatement");

    const decls = stmt.getDeclarations();
    if (decls.length === 1) {
      stmt.remove();
    } else {
      const declList = stmt.getDeclarationList();
      const remainingDecls = decls.filter((d) => d !== node);
      if (remainingDecls.length === 0) {
        stmt.remove();
      } else {
        const modifiers = stmt.getModifiers();
        const modifierText = modifiers.map((m) => m.getText()).join(" ");
        const constOrLet = declList.getDeclarationKindKeyword().getText();
        const remainingText = remainingDecls.map((d) => d.getText()).join(", ");
        stmt.replaceWithText(`${modifierText} ${constOrLet} ${remainingText};`);
      }
    }
  } else if (Node.isFunctionDeclaration(node)) {
    node.remove();
  } else if (Node.isInterfaceDeclaration(node)) {
    node.remove();
  } else if (Node.isTypeAliasDeclaration(node)) {
    node.remove();
  } else if (Node.isClassDeclaration(node)) {
    node.remove();
  } else if (Node.isEnumDeclaration(node)) {
    node.remove();
  } else if (Node.isExportAssignment(node)) {
    node.remove();
  } else if (Node.isExportSpecifier(node)) {
    const exportDec = node.getFirstAncestorByKind(SyntaxKind.ExportDeclaration);
    if (!exportDec) throw new Error("ExportSpecifier without ExportDeclaration");
    const specs = exportDec.getNamedExports();
    if (specs.length === 1) exportDec.remove();
    else node.remove();
  } else {
    throw new Error(`Unsupported node kind: ${node.getKindName()}`);
  }
}

function main() {
  const { tsconfig, file, symbol, line } = parseArgs();

  const project = new Project({
    tsConfigFilePath: path.resolve(tsconfig),
  });

  const fullPath = path.resolve(file);
  const sourceFile = project.addSourceFileAtPath(fullPath);

  const decl = findBestDeclaration(sourceFile, line, symbol);

  if (!decl) {
    console.error(`DECL_NOT_FOUND: No declaration found at line ${line} for ${symbol} in ${file}`);
    process.exit(2);
  }

  try {
    removeDeclaration(decl, symbol);
    sourceFile.saveSync();
    console.log(`OK: Removed ${symbol} from ${file}`);
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(3);
  }
}

main();
