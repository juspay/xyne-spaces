import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import {logger} from '@/utils/logger';
// import fetch from 'node-fetch';

export interface WorkflowGraphNode {
  id: string;
  name: string;
  type: 'checkpoint' | 'agent' | 'conditional' | 'external' | 'loop';
  position?: { x: number; y: number };
  childWorkflows?: Array<{workflowType: string, initialContext: any}>;
}

export interface WorkflowGraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  type?: 'default' | 'conditional-true' | 'conditional-false' | 'loop' | 'parallel-child' | 'loop-entry' | 'loop-back' | 'parallel' | 'parallel-join';
}

export interface WorkflowGraph {
  workflowType: string;
  name: string;
  description: string;
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
}

interface StepInfo {
  stepId: string;
  stepName: string;
  type: 'checkpoint' | 'agent' | 'conditional' | 'external' | 'loop';
  parentStepId?: string;
  isConditionalBranch?: boolean;
  conditionalResult?: boolean; // true or false branch
  loopBody?: string[]; // stepIds in loop body
  childWorkflows?: Array<{workflowType: string, initialContext: any}>;
  position?: { x: number; y: number };
}


export interface WorkflowFileInfo {
  filePath: string;
  workflowType: string;
  exportName: string;
}

export interface WorkflowContextFields {
  workflowType: string;
  fields: string[];
}

export class ASTWorkflowParser {
  private sourceFile: ts.SourceFile | null = null;
  private checker: ts.TypeChecker | null = null;
  private steps: StepInfo[] = [];
  private edges: WorkflowGraphEdge[] = [];
  private currentParentStep: string | null = null;
  private conditionalStack: Array<{ stepId: string; inTrueBranch: boolean; firstStepInBranch: boolean }> = [];
  private variableToStepId: Map<string, string> = new Map(); // Map variable names to step IDs
  private lastNonConditionalStep: string | null = null;
  private pendingFalseBranchFrom: string | null = null; // Track conditional that needs false branch edge
  private graphCache: Map<string, WorkflowGraph> = new Map();
  private parallelGroups: Map<string, string[]> = new Map();
  private stepCounter = 0;
  private discoveredConditionals: Set<string> = new Set();

  /**
   * Clear the workflow graph cache (useful for development/testing)
   */
  clearCache(): void {
    this.graphCache.clear();
  }

  /**
   * Resolve the actual runtime value of an enum property access using TypeScript's type checker
   *
   * How it works:
   * 1. When the AST parser sees: engine.createCheckpoint(UserOnboardingSteps.SEND_WELCOME_EMAIL, ...)
   * 2. It identifies `UserOnboardingSteps.SEND_WELCOME_EMAIL` as a PropertyAccessExpression
   * 3. This method uses TypeScript's type checker to find the enum declaration
   * 4. It reads the actual value assigned to SEND_WELCOME_EMAIL (e.g., 'Send Welcome Email')
   * 5. Returns that exact value, so the frontend receives the same string as stored in the DB
   *
   * Example: UserOnboardingSteps.SEND_WELCOME_EMAIL -> 'Send Welcome Email'
   * Falls back to lowercasing the property name if type checking is unavailable
   */
  private resolveEnumValue(propertyAccess: ts.PropertyAccessExpression): string | null {
    if (!this.checker || !this.sourceFile) {
      // Fallback: lowercase the property name (old behavior)
      return propertyAccess.name.getText(this.sourceFile || undefined).toLowerCase();
    }

    try {
      const propertyName = propertyAccess.name.getText(this.sourceFile);

      // Get the symbol for the enum member name (e.g., SEND_WELCOME_EMAIL)
      // We use propertyAccess.name (just "SEND_WELCOME_EMAIL") not the full expression
      const symbol = this.checker.getSymbolAtLocation(propertyAccess.name);

      if (!symbol || !symbol.valueDeclaration) {
        return propertyName.toLowerCase();
      }

      // Check if this symbol is actually an enum member declaration
      if (ts.isEnumMember(symbol.valueDeclaration)) {
        const enumMember = symbol.valueDeclaration;

        // Get the initializer (the value assigned to the enum member)
        // For: SEND_WELCOME_EMAIL = 'Send Welcome Email'
        // The initializer is the StringLiteral node containing 'Send Welcome Email'
        if (enumMember.initializer) {
          if (ts.isStringLiteral(enumMember.initializer)) {
            // Return the actual string value
            return enumMember.initializer.text;
          } else if (ts.isNumericLiteral(enumMember.initializer)) {
            // Support numeric enums as well
            return enumMember.initializer.text;
          }
        }
      }

      // Fallback if we couldn't resolve
      return propertyName.toLowerCase();
    } catch (error) {
      // Fallback on any error
      return propertyAccess.name.getText(this.sourceFile).toLowerCase();
    }
  }

  /**
   * Discover all workflow files in a directory and return their metadata
   */
  static discoverWorkflowFiles(definitionsDir: string): WorkflowFileInfo[] {
    const workflowFiles: WorkflowFileInfo[] = [];

    function scanDirectory(dir: string): void {
      try {
        const items = fs.readdirSync(dir);

        for (const item of items) {
          const fullPath = path.join(dir, item);
          const stat = fs.statSync(fullPath);

          if (stat.isDirectory()) {
            // Recursively scan subdirectories
            scanDirectory(fullPath);
          } else if (item.endsWith('.ts') && item !== 'index.ts') {
            // Parse TypeScript files (except index.ts)
            const workflowInfo = ASTWorkflowParser.extractWorkflowInfo(fullPath);
            if (workflowInfo) {
              workflowFiles.push(workflowInfo);
            }
          }
        }
      } catch (error) {
        logger.error(`Error scanning directory ${dir}:`, error);
      }
    }

    scanDirectory(definitionsDir);
    return workflowFiles;
  }

  /**
   * Extract workflow information from a single file
   */
  static extractWorkflowInfo(filePath: string): WorkflowFileInfo | null {
    try {
      const sourceCode = fs.readFileSync(filePath, 'utf-8');
      const sourceFile = ts.createSourceFile(
        path.basename(filePath),
        sourceCode,
        ts.ScriptTarget.Latest,
        true
      );

      let workflowInfo: WorkflowFileInfo | null = null;

      const visit = (node: ts.Node): void => {
        // Look for: export const xxxWorkflow: WorkflowDefinition = { ... }
        if (ts.isVariableStatement(node)) {
          const declaration = node.declarationList.declarations[0];
          if (declaration && ts.isVariableDeclaration(declaration)) {
            const exportName = declaration.name.getText(sourceFile);

            // Check if this looks like a workflow export
            if (exportName.toLowerCase().includes('workflow')) {
              if (declaration.initializer && ts.isObjectLiteralExpression(declaration.initializer)) {
                // Look for the type property in the workflow definition
                const workflowType = ASTWorkflowParser.extractWorkflowType(declaration.initializer, sourceFile);
                if (workflowType) {
                  workflowInfo = {
                    filePath,
                    workflowType,
                    exportName
                  };
                }
              }
            }
          }
        }

        ts.forEachChild(node, visit);
      }

      visit(sourceFile);
      return workflowInfo;
    } catch (error) {
      logger.error(`Error parsing workflow file ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Extract WorkflowType from workflow definition object
   */
  static extractWorkflowType(workflowDef: ts.ObjectLiteralExpression, sourceFile: ts.SourceFile): string | null {
    for (const prop of workflowDef.properties) {
      if (ts.isPropertyAssignment(prop)) {
        const propName = prop.name.getText(sourceFile);
        if (propName === 'type' && ts.isPropertyAccessExpression(prop.initializer)) {
          // Extract WorkflowType.XYZ -> return 'XYZ'
          const typeExpression = prop.initializer.getText(sourceFile);
          const match = typeExpression.match(/WorkflowType\.(\w+)/);
          return match ? match[1] : null;
        }
      }
    }
    return null;
  }

  /**
   * Create a mapping from workflow types to file paths
   */
  static createWorkflowFileMapping(definitionsDir: string): Record<string, string> {
    const workflowFiles = ASTWorkflowParser.discoverWorkflowFiles(definitionsDir);
    const mapping: Record<string, string> = {};

    for (const workflow of workflowFiles) {
      mapping[workflow.workflowType] = workflow.filePath;
    }

    return mapping;
  }

  /**
   * Advanced workflow parsing with all dynamic executor features
   * Includes parallel workflows, child workflow expansion, multi-path conditional analysis
   */
  async parseWorkflowFileAdvanced(filePath: string, workflowType: string): Promise<WorkflowGraph> {
    try {
      // Check cache first
      const cacheKey = workflowType.toLowerCase();
      if (this.graphCache.has(cacheKey)) {
        return this.graphCache.get(cacheKey)!;
      }

      // Parse the workflow file
      const baseGraph = await this.parseWorkflowFile(filePath);

      // Enhance with parallel workflow detection and child workflow expansion
      const enhancedGraph = await this.expandParallelWorkflows(baseGraph, filePath);

      // Cache the result
      this.graphCache.set(cacheKey, enhancedGraph);

      return enhancedGraph;
    } catch (error) {
      logger.error('Error in advanced workflow parsing:', error);
      throw error;
    }
  }

  /**
   * Parse a workflow definition file and extract graph structure
   */
  async parseWorkflowFile(filePath: string): Promise<WorkflowGraph> {
    // Create TypeScript program to get type checker for enum resolution
    try {
      // Create a program with the actual file to enable full type checking
      // IMPORTANT: We need proper module resolution to handle imported enums
      // Read tsconfig to get proper compiler options for import resolution
      const configPath = ts.findConfigFile(
        path.dirname(filePath),
        ts.sys.fileExists,
        'tsconfig.json'
      );

      let compilerOptions: ts.CompilerOptions = {
        target: ts.ScriptTarget.Latest,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        allowJs: true,
        noEmit: true,
        skipLibCheck: true,
        skipDefaultLibCheck: true
      };

      // If tsconfig exists, use its settings for better import resolution
      if (configPath) {
        const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
        if (!configFile.error) {
          const parsedConfig = ts.parseJsonConfigFileContent(
            configFile.config,
            ts.sys,
            path.dirname(configPath)
          );
          compilerOptions = { ...compilerOptions, ...parsedConfig.options };
        }
      }

      const program = ts.createProgram({
        rootNames: [filePath],
        options: compilerOptions
      });
      this.checker = program.getTypeChecker();

      // Use the source file from the program (which has type information)
      this.sourceFile = program.getSourceFile(filePath) || null;
    } catch (error) {
      logger.warn('Could not create type checker, falling back to name-based enum resolution:', error);
      this.checker = null;

      // Fallback: Create TypeScript AST manually
      const sourceCode = fs.readFileSync(filePath, 'utf-8');
      this.sourceFile = ts.createSourceFile(
        path.basename(filePath),
        sourceCode,
        ts.ScriptTarget.Latest,
        true
      );
    }

    // Reset state
    this.steps = [];
    this.edges = [];
    this.currentParentStep = null;
    this.conditionalStack = [];
    this.variableToStepId.clear();
    this.lastNonConditionalStep = null;

    // Find the workflow definition export
    const workflowDefinition = this.findWorkflowDefinition();
    if (!workflowDefinition) {
      throw new Error('Could not find workflow definition in file');
    }

    // Extract workflow metadata
    const metadata = this.extractWorkflowMetadata(workflowDefinition);

    // Parse the execute function
    this.parseExecuteFunction(workflowDefinition);

    // Perform enhanced conditional analysis
    this.analyzeConditionalPaths();

    // Build nodes from steps
    const nodes = this.steps.map((step, index) => ({
      id: step.stepId,
      name: step.stepName,
      type: step.type,
      position: { x: 250, y: index * 100 }, // Simple vertical layout
      ...(step.childWorkflows && { childWorkflows: step.childWorkflows })
    }));

    return {
      workflowType: metadata.type,
      name: metadata.name,
      description: metadata.description,
      nodes,
      edges: this.edges
    };
  }

  /**
   * Find the workflow definition object in the AST
   */
  private findWorkflowDefinition(): ts.ObjectLiteralExpression | null {
    let workflowDef: ts.ObjectLiteralExpression | null = null;

    const visit = (node: ts.Node) => {
      // Look for: export const xxxWorkflow: WorkflowDefinition = { ... }
      if (ts.isVariableStatement(node)) {
        const declaration = node.declarationList.declarations[0];
        if (declaration && ts.isVariableDeclaration(declaration)) {
          const name = declaration.name.getText(this.sourceFile!);
          if (name.toLowerCase().includes('workflow')) {
            if (declaration.initializer && ts.isObjectLiteralExpression(declaration.initializer)) {
              workflowDef = declaration.initializer;
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    if (this.sourceFile) {
      visit(this.sourceFile);
    }

    return workflowDef;
  }

  /**
   * Extract workflow metadata (type, name, description)
   */
  private extractWorkflowMetadata(workflowDef: ts.ObjectLiteralExpression): {
    type: string;
    name: string;
    description: string;
  } {
    let type = '';
    let name = '';
    let description = '';

    workflowDef.properties.forEach(prop => {
      if (ts.isPropertyAssignment(prop)) {
        const propName = prop.name.getText(this.sourceFile!);
        const value = prop.initializer;

        if (propName === 'type' && ts.isPropertyAccessExpression(value)) {
          const fullType = value.getText(this.sourceFile!);
          // Extract just the enum value: "WorkflowType.BUG_WORKFLOW" -> "bug_workflow"
          const match = fullType.match(/WorkflowType\.(\w+)/);
          type = match ? match[1].toLowerCase() : fullType.toLowerCase();
        } else if (propName === 'name' && ts.isStringLiteral(value)) {
          name = value.text;
        } else if (propName === 'description' && ts.isStringLiteral(value)) {
          description = value.text;
        }
      }
    });

    return { type, name, description };
  }

  /**
   * Parse the execute function to extract workflow steps using direct function call analysis
   */
  private parseExecuteFunction(workflowDef: ts.ObjectLiteralExpression): void {
    let executeMethod: ts.MethodDeclaration | null = null;

    // Find the execute method
    for (const prop of workflowDef.properties) {
      if (ts.isMethodDeclaration(prop)) {
        const methodName = prop.name?.getText(this.sourceFile!);
        if (methodName === 'execute') {
          executeMethod = prop;
          break;
        }
      }
    }

    if (executeMethod && executeMethod.body) {
      // Use direct function call analysis instead of sequential traversal
      this.analyzeWorkflowCalls(executeMethod.body);
    }
  }

  /**
   * Analyze all workflow function calls in the AST and build graph
   */
  private analyzeWorkflowCalls(node: ts.Node): void {
    const workflowCalls: Array<{
      stepId: string;
      stepType: StepInfo['type'];
      callNode: ts.CallExpression;
      parentContext: string;
    }> = [];

    // Step 1: Find all workflow function calls AND build variable mappings
    const findWorkflowCalls = (node: ts.Node) => {
      // Check for variable declarations with workflow calls (including await expressions)
      if (ts.isVariableDeclaration(node) && node.initializer) {
        let callExpression: ts.CallExpression | null = null;

        // Handle direct call: const x = engine.call()
        if (ts.isCallExpression(node.initializer)) {
          callExpression = node.initializer;
        }
        // Handle await call: const x = await engine.call()
        else if (ts.isAwaitExpression(node.initializer) && ts.isCallExpression(node.initializer.expression)) {
          callExpression = node.initializer.expression;
        }

        if (callExpression) {
          const stepInfo = this.extractStepInfoFromCall(callExpression);
          if (stepInfo) {
            const varName = node.name.getText(this.sourceFile!);
            this.variableToStepId.set(varName, stepInfo.stepId);

            const parentContext = this.analyzeParentContext(callExpression);
            workflowCalls.push({
              ...stepInfo,
              callNode: callExpression,
              parentContext
            });
          }
        }
      }
      // Also check for direct workflow calls (without variable assignment)
      else if (ts.isCallExpression(node)) {
        const stepInfo = this.extractStepInfoFromCall(node);
        if (stepInfo) {
          const parentContext = this.analyzeParentContext(node);
          workflowCalls.push({
            ...stepInfo,
            callNode: node,
            parentContext
          });
        }
      }
      // Handle await expressions for direct calls
      else if (ts.isAwaitExpression(node) && ts.isCallExpression(node.expression)) {
        const stepInfo = this.extractStepInfoFromCall(node.expression);
        if (stepInfo) {
          const parentContext = this.analyzeParentContext(node.expression);
          workflowCalls.push({
            ...stepInfo,
            callNode: node.expression,
            parentContext
          });
        }
      }
      ts.forEachChild(node, findWorkflowCalls);
    };

    findWorkflowCalls(node);

    // Step 1.5: Analyze createWhileLoop callbacks for nested steps
    this.analyzeWhileLoopCallbacks(node, workflowCalls);

    // Step 2: Find conditional statements and map them to steps
    this.analyzeConditionalStatements(node);

    // Step 3: Build steps and relationships
    this.buildGraphFromCalls(workflowCalls);
  }

  /**
   * Analyze createWhileLoop calls and extract steps from their callback functions
   */
  private analyzeWhileLoopCallbacks(
    node: ts.Node,
    workflowCalls: Array<{
      stepId: string;
      stepType: StepInfo['type'];
      callNode: ts.CallExpression;
      parentContext: string;
    }>
  ): void {
    const findWhileLoops = (node: ts.Node) => {
      if (ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.getText(this.sourceFile!) === 'createWhileLoop') {

        // Get the loop step ID from first argument
        const loopStepId = this.extractLoopStepId(node);

        // Get the third argument (callback function)
        const callbackArg = node.arguments[2];
        if (callbackArg && (ts.isArrowFunction(callbackArg) || ts.isFunctionExpression(callbackArg))) {

          // Get parameter names
          const params = callbackArg.parameters;
          if (params.length >= 2) {
            // const iterationParam = params[0]?.name?.getText(this.sourceFile!);
            const engineParam = params[1]?.name?.getText(this.sourceFile!); // scopedEngine

            // Parse callback body for workflow method calls with specific loop context
            if (callbackArg.body && loopStepId) {
              this.parseLoopCallbackBody(callbackArg.body, engineParam, workflowCalls, loopStepId);
            }
          }
        }
      }
      ts.forEachChild(node, findWhileLoops);
    };

    findWhileLoops(node);
  }

  /**
   * Extract the loop step ID from a createWhileLoop call
   */
  private extractLoopStepId(call: ts.CallExpression): string | null {
    if (call.arguments.length === 0) {
      return null;
    }

    const stepIdArg = call.arguments[0];
    let stepId: string | null = null;

    if (ts.isStringLiteral(stepIdArg)) {
      stepId = stepIdArg.text;
    } else if (ts.isPropertyAccessExpression(stepIdArg)) {
      // Use type checker to resolve actual enum value
      stepId = this.resolveEnumValue(stepIdArg);
    } else if (ts.isNoSubstitutionTemplateLiteral(stepIdArg)) {
      stepId = stepIdArg.text;
    }

    return stepId;
  }

  /**
   * Parse the body of a createWhileLoop callback to find workflow method calls
   */
  private parseLoopCallbackBody(
    body: ts.Block | ts.Expression,
    engineParamName: string,
    workflowCalls: Array<{
      stepId: string;
      stepType: StepInfo['type'];
      callNode: ts.CallExpression;
      parentContext: string;
    }>,
    loopStepId: string
  ): void {
    const findCallsInLoopBody = (node: ts.Node) => {
      // Check for variable declarations with workflow calls
      if (ts.isVariableDeclaration(node) && node.initializer) {
        let callExpression: ts.CallExpression | null = null;

        // Handle direct call: const x = engine.call()
        if (ts.isCallExpression(node.initializer)) {
          callExpression = node.initializer;
        }
        // Handle await call: const x = await engine.call()
        else if (ts.isAwaitExpression(node.initializer) && ts.isCallExpression(node.initializer.expression)) {
          callExpression = node.initializer.expression;
        }

        if (callExpression && this.isWorkflowMethodCall(callExpression, engineParamName)) {
          const stepInfo = this.extractStepInfoFromCall(callExpression);
          if (stepInfo) {
            // Mark with specific loop context
            workflowCalls.push({
              ...stepInfo,
              callNode: callExpression,
              parentContext: loopStepId
            });

            // Map variable name to step ID for conditional tracking
            const varName = node.name.getText(this.sourceFile!);
            this.variableToStepId.set(varName, stepInfo.stepId);
          }
        }
      }
      // Check for direct workflow calls (without variable assignment)
      else if (ts.isCallExpression(node) && this.isWorkflowMethodCall(node, engineParamName)) {
        const stepInfo = this.extractStepInfoFromCall(node);
        if (stepInfo) {
          workflowCalls.push({
            ...stepInfo,
            callNode: node,
            parentContext: loopStepId
          });
        }
      }
      // Handle await expressions for direct calls
      else if (ts.isAwaitExpression(node) && ts.isCallExpression(node.expression) &&
               this.isWorkflowMethodCall(node.expression, engineParamName)) {
        const stepInfo = this.extractStepInfoFromCall(node.expression);
        if (stepInfo) {
          workflowCalls.push({
            ...stepInfo,
            callNode: node.expression,
            parentContext: loopStepId
          });
        }
      }

      ts.forEachChild(node, findCallsInLoopBody);
    };

    findCallsInLoopBody(body);
  }

  /**
   * Check if a call expression is a workflow method call on the specified engine parameter
   */
  private isWorkflowMethodCall(call: ts.CallExpression, engineParamName: string): boolean {
    if (!ts.isPropertyAccessExpression(call.expression)) {
      return false;
    }

    const objectName = ts.isIdentifier(call.expression.expression)
      ? call.expression.expression.text
      : '';

    const methodName = call.expression.name.getText(this.sourceFile!);
    const engineMethods = [
      'createCheckpoint',
      'createAgenticCheckpoint',
      'createConditionalStep',
      'createExternalStep',
      'createWhileLoop',
      'createParallelWorkflows'
    ];

    // Check if it's a workflow method call on the engineParam or 'workflow'
    return engineMethods.includes(methodName) &&
           (objectName === engineParamName || objectName === 'workflow');
  }

  /**
   * Analyze conditional statements (if statements and switch statements) and create conditional edges
   */
  private analyzeConditionalStatements(node: ts.Node): void {
    const findConditionalStatements = (node: ts.Node) => {
      if (ts.isIfStatement(node)) {
        // Skip if statements that are part of else clauses (else-if chains)
        if (this.isPartOfElseClause(node)) {
          return;
        }

        const conditionalStepId = this.extractConditionalStepId(node.expression);
        if (conditionalStepId) {
          // Handle if-else-if-else chains
          const allBranches = this.extractIfElseIfChain(node);

          // Create edges for each branch
          allBranches.forEach(branch => {
            branch.steps.forEach(stepId => {
              // Find the actual preceding workflow step instead of using fake conditional node
              const precedingStep = this.findPrecedingWorkflowStep(node);
              const actualSource = precedingStep || this.lastNonConditionalStep;

              if (actualSource) {
                // Use "dynamic condition" label for complex expressions
                const edgeLabel = conditionalStepId.startsWith('dynamic_condition_') ||
                                 conditionalStepId.includes('_') && !this.variableToStepId.has(conditionalStepId) ?
                                 'dynamic condition' : branch.label;

                this.edges.push({
                  id: `${actualSource}-${stepId}-${branch.label}`,
                  source: actualSource,
                  target: stepId,
                  label: edgeLabel,
                  type: branch.label === 'true' || branch.isTrue ? 'conditional-true' : 'conditional-false'
                });
              }
            });
          });

          // Create convergence edges: all branches connect to the next step after if-else-if-else
          const nextStepAfterIf = this.findNextStepAfterNode(node);
          if (nextStepAfterIf.length > 0) {
            const nextStepId = nextStepAfterIf[0];

            allBranches.forEach(branch => {
              branch.steps.forEach(stepId => {
                this.edges.push({
                  id: `${stepId}-${nextStepId}`,
                  source: stepId,
                  target: nextStepId,
                  type: 'default'
                });
              });
            });
          }
        }
      }
      // Handle switch statements
      else if (ts.isSwitchStatement(node)) {
        const conditionalStepId = this.extractConditionalStepId(node.expression);
        if (conditionalStepId) {
          const allCaseSteps: string[] = [];

          // Process each case clause - treat them all generically
          for (const clause of node.caseBlock.clauses) {
            if (ts.isCaseClause(clause)) {
              // Extract case value generically
              const caseValue = this.extractCaseValue(clause.expression);

              // Find steps in this case
              const caseSteps: string[] = [];
              for (const statement of clause.statements) {
                caseSteps.push(...this.findStepsInNode(statement));
              }

              // Create edges with the actual case value as label
              caseSteps.forEach(stepId => {
                // Find the actual preceding workflow step instead of using fake conditional node
                const precedingStep = this.findPrecedingWorkflowStep(node);
                const actualSource = precedingStep || this.lastNonConditionalStep;

                if (actualSource) {
                  // Use "dynamic condition" label for complex expressions
                  const edgeLabel = conditionalStepId.startsWith('dynamic_condition_') ||
                                   conditionalStepId.includes('_') && !this.variableToStepId.has(conditionalStepId) ?
                                   'dynamic condition' : caseValue;

                  this.edges.push({
                    id: `${actualSource}-${stepId}-${caseValue}`,
                    source: actualSource,
                    target: stepId,
                    label: edgeLabel,
                    // type: caseValue === 'true' || caseValue === true ? 'conditional-true' : 'conditional-false'
                    type: caseValue === 'true' ? 'conditional-true' : 'conditional-false'
                  });
                }
              });

              allCaseSteps.push(...caseSteps);
            }
            // Handle default clause
            else if (ts.isDefaultClause(clause)) {
              const defaultSteps: string[] = [];
              for (const statement of clause.statements) {
                defaultSteps.push(...this.findStepsInNode(statement));
              }

              // Create default edges
              defaultSteps.forEach(stepId => {
                // Find the actual preceding workflow step instead of using fake conditional node
                const precedingStep = this.findPrecedingWorkflowStep(node);
                const actualSource = precedingStep || this.lastNonConditionalStep;

                if (actualSource) {
                  // Use "dynamic condition" label for complex expressions
                  const edgeLabel = conditionalStepId.startsWith('dynamic_condition_') ||
                                   conditionalStepId.includes('_') && !this.variableToStepId.has(conditionalStepId) ?
                                   'dynamic condition' : 'default';

                  this.edges.push({
                    id: `${actualSource}-${stepId}-default`,
                    source: actualSource,
                    target: stepId,
                    label: edgeLabel,
                    type: 'conditional-false'
                  });
                }
              });

              allCaseSteps.push(...defaultSteps);
            }
          }

          // Create convergence edges: all branches connect to the next step after switch
          const nextStepAfterSwitch = this.findNextStepAfterNode(node);
          if (nextStepAfterSwitch.length > 0) {
            const nextStepId = nextStepAfterSwitch[0];

            allCaseSteps.forEach(caseStepId => {
              this.edges.push({
                id: `${caseStepId}-${nextStepId}`,
                source: caseStepId,
                target: nextStepId,
                type: 'default'
              });
            });
          }
        }
      }
      ts.forEachChild(node, findConditionalStatements);
    };

    findConditionalStatements(node);
  }

  /**
   * Find the actual preceding workflow step before a conditional statement
   */
  private findPrecedingWorkflowStep(conditionalNode: ts.Node): string | null {
    // Find the parent block containing this conditional
    let parent = conditionalNode.parent;
    while (parent && !ts.isBlock(parent)) {
      parent = parent.parent;
    }

    if (!parent || !ts.isBlock(parent)) {
      return null;
    }

    // Find the index of the conditional statement in the block
    const statements = parent.statements;
    const conditionalIndex = statements.indexOf(conditionalNode as any);

    if (conditionalIndex === -1) {
      return null;
    }

    // Look backwards from the conditional to find the last workflow step
    for (let i = conditionalIndex - 1; i >= 0; i--) {
      const statement = statements[i];
      const stepsInStatement = this.findStepsInNode(statement);
      if (stepsInStatement.length > 0) {
        // Return the last step found in this statement
        return stepsInStatement[stepsInStatement.length - 1];
      }
    }

    return null;
  }

  /**
   * Find workflow steps within a given AST node
   */
  private findStepsInNode(node: ts.Node): string[] {
    const steps: string[] = [];

    const findSteps = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const stepInfo = this.extractStepInfoFromCall(node);
        if (stepInfo) {
          steps.push(stepInfo.stepId);
        }
      }
      ts.forEachChild(node, findSteps);
    };

    findSteps(node);
    return steps;
  }

  /**
   * Find the next step after a given node (for false branch when no else clause)
   */
  private findNextStepAfterNode(node: ts.IfStatement | ts.SwitchStatement): string[] {
    // Find the parent statement list and get the next statement
    let parent = node.parent;
    while (parent && !ts.isBlock(parent)) {
      parent = parent.parent;
    }

    if (parent && ts.isBlock(parent)) {
      const statements = parent.statements;
      const ifIndex = statements.indexOf(node as any);

      // Look for the next statement that contains a workflow step
      for (let i = ifIndex + 1; i < statements.length; i++) {
        const nextSteps = this.findStepsInNode(statements[i]);
        if (nextSteps.length > 0) {
          return [nextSteps[0]]; // Return first step found
        }
      }
    }

    return [];
  }

  /**
   * Extract step information from a function call
   */
  private extractStepInfoFromCall(call: ts.CallExpression): { stepId: string; stepType: StepInfo['type'] } | null {
    if (!ts.isPropertyAccessExpression(call.expression)) {
      return null;
    }

    const methodName = call.expression.name.getText(this.sourceFile!);
    const engineMethods = ['createCheckpoint', 'createAgenticCheckpoint', 'createConditionalStep', 'createExternalStep', 'createWhileLoop', 'createParallelWorkflows'];

    if (!engineMethods.includes(methodName)) {
      return null;
    }

    if (call.arguments.length === 0) {
      return null;
    }

    // Extract step ID (first argument) - handle string literals, template literals, and property access
    const stepIdArg = call.arguments[0];
    let stepId: string;

    if (ts.isStringLiteral(stepIdArg)) {
      stepId = stepIdArg.text;
    } else if (ts.isTemplateExpression(stepIdArg)) {
      // Template literal with substitutions like `build-code-${iteration}`
      // Create static name by using head + sanitized tail
      let templateText = stepIdArg.head.text;

      // For dynamic templates, create a static version
      if (stepIdArg.templateSpans.length > 0) {
        // Clean up template text and add generic suffix
        templateText = templateText.replace(/-$/, ''); // Remove trailing dash
        stepId = templateText + '_dynamic';
      } else {
        stepId = templateText;
      }
    } else if (ts.isNoSubstitutionTemplateLiteral(stepIdArg)) {
      // Simple template literal without substitutions like `code_fix`
      stepId = stepIdArg.text;
    } else if (ts.isPropertyAccessExpression(stepIdArg)) {
      // Property access like XyneSpacesWorkflowSteps.REQUIREMENT_ANALYSIS
      // Use type checker to resolve actual enum value
      stepId = this.resolveEnumValue(stepIdArg) || '';
    } else {
      return null;
    }
    let stepType: StepInfo['type'] = 'checkpoint';

    switch (methodName) {
      case 'createCheckpoint': stepType = 'checkpoint'; break;
      case 'createAgenticCheckpoint': stepType = 'agent'; break;
      case 'createConditionalStep': stepType = 'conditional'; break;
      case 'createExternalStep': stepType = 'external'; break;
      case 'createWhileLoop':
        stepType = 'loop';
        // Don't append _loop - use original step ID to match dynamic executor
        break;
      case 'createParallelWorkflows': stepType = 'checkpoint'; break;
    }

    return { stepId, stepType };
  }

  /**
   * Analyze the parent context of a function call to determine control flow
   */
  private analyzeParentContext(callNode: ts.Node): string {
    // Special case: check if this is a createWhileLoop call
    if (ts.isCallExpression(callNode)) {
      const methodName = ts.isPropertyAccessExpression(callNode.expression)
        ? callNode.expression.name.getText(this.sourceFile!)
        : '';

      // createWhileLoop calls should always be treated as main flow,
      // even if they're inside for loops over repositories
      if (methodName === 'createWhileLoop') {
        return 'main';
      }
    }

    let parent = callNode.parent;

    while (parent) {
      // Check if we're inside a createWhileLoop callback
      if (ts.isCallExpression(parent)) {
        const methodName = ts.isPropertyAccessExpression(parent.expression)
          ? parent.expression.name.getText(this.sourceFile!)
          : '';

        if (methodName === 'createWhileLoop') {
          // We're inside a createWhileLoop call, extract the specific loop step ID
          const loopStepId = this.extractLoopStepId(parent);
          return loopStepId || 'loop';
        }
      }

      if (ts.isIfStatement(parent)) {
        return 'conditional';
      }
      if (ts.isWhileStatement(parent) || ts.isForStatement(parent) || ts.isForOfStatement(parent) || ts.isForInStatement(parent)) {
        return 'loop';
      }
      if (ts.isSwitchStatement(parent)) {
        return 'switch';
      }
      if (ts.isTryStatement(parent)) {
        return 'try';
      }
      if (ts.isMethodDeclaration(parent) && parent.name?.getText(this.sourceFile!) === 'execute') {
        return 'main';
      }
      parent = parent.parent;
    }

    return 'main';
  }

  /**
   * Build the workflow graph from discovered function calls
   */
  private buildGraphFromCalls(calls: Array<{
    stepId: string;
    stepType: StepInfo['type'];
    callNode: ts.CallExpression;
    parentContext: string;
  }>): void {
    // Deduplicate calls by stepId
    const uniqueCalls = new Map<string, typeof calls[0]>();
    calls.forEach(call => {
      if (!uniqueCalls.has(call.stepId)) {
        uniqueCalls.set(call.stepId, call);
      }
    });

    const deduplicatedCalls = Array.from(uniqueCalls.values());

    // Create steps
    deduplicatedCalls.forEach((call) => {
      const stepInfo: StepInfo = {
        stepId: call.stepId,
        stepName: this.formatStepName(call.stepId),
        type: call.stepType,
        position: { x: 250, y: this.stepCounter * 100 }
      };

      // Extract child workflows for createParallelWorkflows calls
      if (call.stepType === 'checkpoint' && call.callNode.arguments.length >= 2) {
        const methodName = (call.callNode.expression as ts.PropertyAccessExpression).name.getText(this.sourceFile!);
        if (methodName === 'createParallelWorkflows') {
          const configArg = call.callNode.arguments[1];
          const childWorkflows = this.extractParallelWorkflowConfig(configArg);
          if (childWorkflows.length > 0) {
            stepInfo.childWorkflows = childWorkflows;
          }
        }
      }

      this.steps.push(stepInfo);
      this.stepCounter++;
    });

    // Create edges with proper loop handling
    this.createAdvancedEdges(deduplicatedCalls);
  }

  /**
   * Create edges with advanced logic for loops, conditionals, etc.
   */
  private createAdvancedEdges(calls: Array<{
    stepId: string;
    stepType: StepInfo['type'];
    callNode: ts.CallExpression;
    parentContext: string;
  }>): void {
    // Get all main flow steps (including loop steps)
    const mainSteps = calls.filter(call => call.parentContext === 'main' || call.parentContext === 'try');

    // Create sequential edges for main flow (with special handling for loops and conditionals)
    for (let i = 0; i < mainSteps.length - 1; i++) {
      const currentStep = mainSteps[i];
      const nextStep = mainSteps[i + 1];

      // If current step is a loop, skip creating edge - loop will handle its own connections
      if (currentStep.stepType === 'loop') {
        continue;
      }

      // If current step is conditional, skip creating edge - conditional analysis will handle it
      if (currentStep.stepType === 'conditional') {
        continue;
      }

      this.edges.push({
        id: `${currentStep.stepId}-${nextStep.stepId}`,
        source: currentStep.stepId,
        target: nextStep.stepId,
        type: 'default'
      });
    }

    // Handle ALL loop-specific edges (support multiple loops)
    const allLoopSteps = calls.filter(call => call.stepType === 'loop');

    for (const currentLoopStep of allLoopSteps) {
      // Get steps that belong specifically to THIS loop
      const innerLoopSteps = calls.filter(call =>
        call.parentContext === currentLoopStep.stepId && call.stepId !== currentLoopStep.stepId
      );

      if (innerLoopSteps.length > 0) {
        const firstInnerStep = innerLoopSteps[0];
        const lastInnerStep = innerLoopSteps[innerLoopSteps.length - 1];

        // 1. Loop step connects to first inner step (loop entry)
        this.edges.push({
          id: `${currentLoopStep.stepId}-${firstInnerStep.stepId}`,
          source: currentLoopStep.stepId,
          target: firstInnerStep.stepId,
          type: 'default'
        });

        // 2. Create sequential edges within the loop body
        for (let i = 0; i < innerLoopSteps.length - 1; i++) {
          const currentStep = innerLoopSteps[i];
          const nextStep = innerLoopSteps[i + 1];

          this.edges.push({
            id: `${currentStep.stepId}-${nextStep.stepId}`,
            source: currentStep.stepId,
            target: nextStep.stepId,
            type: 'default'
          });
        }

        // 3. Create loop-back edge: last inner step -> first inner step (for iteration)
        this.edges.push({
          id: `${lastInnerStep.stepId}-${firstInnerStep.stepId}`,
          source: lastInnerStep.stepId,
          target: firstInnerStep.stepId,
          type: 'loop-back'
        });

        // 4. Connect loop to next step in main flow
        const loopStepIndex = mainSteps.findIndex(step => step.stepId === currentLoopStep.stepId);
        if (loopStepIndex !== -1 && loopStepIndex < mainSteps.length - 1) {
          const nextStepAfterLoop = mainSteps[loopStepIndex + 1];

          // Connect last inner step to next step after loop (loop exit)
          this.edges.push({
            id: `${lastInnerStep.stepId}-${nextStepAfterLoop.stepId}`,
            source: lastInnerStep.stepId,
            target: nextStepAfterLoop.stepId,
            type: 'default'
          });
        }
      } else {
        // Handle loops with no inner steps - connect directly to next main step
        const loopStepIndex = mainSteps.findIndex(step => step.stepId === currentLoopStep.stepId);
        if (loopStepIndex !== -1 && loopStepIndex < mainSteps.length - 1) {
          const nextStepAfterLoop = mainSteps[loopStepIndex + 1];

          this.edges.push({
            id: `${currentLoopStep.stepId}-${nextStepAfterLoop.stepId}`,
            source: currentLoopStep.stepId,
            target: nextStepAfterLoop.stepId,
            type: 'default'
          });
        }
      }
    }
  }

  /**
   * Parse a block of statements
   */
  private parseBlock(block: ts.Block): void {
    logger.info(`🔍 Parsing block with ${block.statements.length} statements`);
    block.statements.forEach((statement, index) => {
      logger.info(`🔍 Statement ${index + 1}: ${ts.SyntaxKind[statement.kind]}`);
      this.parseStatement(statement);
    });
  }

  /**
   * Enhanced conditional analysis - discover all conditionals and their paths
   */
  private analyzeConditionalPaths(): void {
    const conditionalSteps = this.steps.filter(step => step.type === 'conditional');

    for (const conditional of conditionalSteps) {
      this.discoveredConditionals.add(conditional.stepId);

      // For each conditional, we need to ensure both true and false paths are represented
      const trueTargets = this.edges.filter(edge =>
        edge.source === conditional.stepId && edge.type === 'conditional-true'
      );

      const falseTargets = this.edges.filter(edge =>
        edge.source === conditional.stepId && edge.type === 'conditional-false'
      );

      // If no false targets exist, create a false path to the next logical step
      if (falseTargets.length === 0 && trueTargets.length > 0) {
        const nextStepAfterConditional = this.findNextStepAfterConditional(conditional.stepId);
        if (nextStepAfterConditional) {
          this.edges.push({
            id: `${conditional.stepId}-${nextStepAfterConditional}-false`,
            source: conditional.stepId,
            target: nextStepAfterConditional,
            label: 'false',
            type: 'conditional-false'
          });
        }
      }
    }
  }

  /**
   * Find the next step that should be executed if a conditional is false
   */
  private findNextStepAfterConditional(conditionalStepId: string): string | null {
    const conditionalIndex = this.steps.findIndex(step => step.stepId === conditionalStepId);
    if (conditionalIndex === -1) return null;

    // Look for the first non-conditional step after this conditional
    for (let i = conditionalIndex + 1; i < this.steps.length; i++) {
      const step = this.steps[i];
      if (step.type !== 'conditional') {
        return step.stepId;
      }
    }

    return null;
  }

  /**
   * Parse individual statements
   */
  private parseStatement(statement: ts.Statement): void {
    logger.info(`🔍 Parsing statement: ${ts.SyntaxKind[statement.kind]}`);

    // Handle await engine.createCheckpoint(...)
    if (ts.isExpressionStatement(statement)) {
      this.parseExpression(statement.expression);
    }
    // Handle const varName = await engine.createCheckpoint(...)
    else if (ts.isVariableStatement(statement)) {
      logger.info(`   → Processing VariableStatement`);
      statement.declarationList.declarations.forEach(decl => {
        const varName = decl.name.getText(this.sourceFile!);
        logger.info(`     → Variable: ${varName}`);
        if (decl.initializer) {
          const stepId = this.parseExpression(decl.initializer);
          // Map variable name to step ID for conditional tracking
          if (stepId) {
            logger.info(`✅ Variable mapping: ${varName} → ${stepId}`);
            this.variableToStepId.set(varName, stepId);
          }
        }
      });
    }
    // Handle if statements (conditionals)
    else if (ts.isIfStatement(statement)) {
      logger.info(`   → Processing IfStatement`);
      this.parseIfStatement(statement);
    }
    // Handle try-catch statements
    else if (ts.isTryStatement(statement)) {
      logger.info(`   → Processing TryStatement`);
      this.parseBlock(statement.tryBlock);
      // Also parse catch block if present
      if (statement.catchClause && statement.catchClause.block) {
        logger.info(`   → Processing CatchBlock`);
        this.parseBlock(statement.catchClause.block);
      }
      // Also parse finally block if present
      if (statement.finallyBlock) {
        logger.info(`   → Processing FinallyBlock`);
        this.parseBlock(statement.finallyBlock);
      }
    }
    // Handle for loops
    else if (ts.isForStatement(statement)) {
      logger.info(`   → Processing ForStatement`);
      if (statement.statement) {
        if (ts.isBlock(statement.statement)) {
          this.parseBlock(statement.statement);
        } else {
          this.parseStatement(statement.statement);
        }
      }
    }
    // Handle for...of and for...in loops
    else if (ts.isForOfStatement(statement) || ts.isForInStatement(statement)) {
      logger.info(`   → Processing ${ts.isForOfStatement(statement) ? 'ForOfStatement' : 'ForInStatement'}`);
      if (statement.statement) {
        if (ts.isBlock(statement.statement)) {
          this.parseBlock(statement.statement);
        } else {
          this.parseStatement(statement.statement);
        }
      }
    }
    // Handle while loops
    else if (ts.isWhileStatement(statement)) {
      logger.info(`   → Processing WhileStatement`);
      if (statement.statement) {
        if (ts.isBlock(statement.statement)) {
          this.parseBlock(statement.statement);
        } else {
          this.parseStatement(statement.statement);
        }
      }
    } else {
      logger.info(`   → Skipping statement type: ${ts.SyntaxKind[statement.kind]}`);
    }
  }

  /**
   * Parse expressions (await calls)
   * Returns the step ID if this is a step creation call
   */
  private parseExpression(expr: ts.Expression): string | null {
    // Handle await expressions
    if (ts.isAwaitExpression(expr)) {
      return this.parseExpression(expr.expression);
    }
    // Handle method calls: engine.createXXX(...)
    else if (ts.isCallExpression(expr)) {
      return this.parseEngineCall(expr);
    }
    return null;
  }

  /**
   * Parse engine method calls (createCheckpoint, createAgenticCheckpoint, etc.)
   * Returns the step ID
   */
  private parseEngineCall(call: ts.CallExpression): string | null {
    const callExpr = call.expression;

    if (!ts.isPropertyAccessExpression(callExpr)) {
      return null;
    }

    const methodName = callExpr.name.getText(this.sourceFile!);

    // Check if this is actually an engine method call (not sleep, etc.)
    const engineMethods = ['createCheckpoint', 'createAgenticCheckpoint', 'createConditionalStep', 'createExternalStep', 'createWhileLoop', 'createParallelWorkflows'];
    if (!engineMethods.includes(methodName)) {
      return null; // Ignore non-engine method calls like sleep()
    }

    const args = call.arguments;

    if (args.length === 0) {
      return null;
    }

    // Extract step ID (first argument) - handle string literals, template literals, and property access
    const stepIdArg = args[0];
    let stepId = '';

    if (ts.isStringLiteral(stepIdArg)) {
      stepId = stepIdArg.text;
    } else if (ts.isTemplateExpression(stepIdArg)) {
      // Template literal with substitutions like `build-code-${iteration}`
      // Create static name by using head + sanitized tail
      let templateText = stepIdArg.head.text;

      // For dynamic templates, create a static version
      if (stepIdArg.templateSpans.length > 0) {
        // Clean up template text and add generic suffix
        templateText = templateText.replace(/-$/, ''); // Remove trailing dash
        stepId = templateText + '_dynamic';
      } else {
        stepId = templateText;
      }
    } else if (ts.isNoSubstitutionTemplateLiteral(stepIdArg)) {
      // Simple template literal without substitutions like `code_fix`
      stepId = stepIdArg.text;
    } else if (ts.isPropertyAccessExpression(stepIdArg)) {
      // Property access like XyneSpacesWorkflowSteps.REQUIREMENT_ANALYSIS
      // Use type checker to resolve actual enum value
      stepId = this.resolveEnumValue(stepIdArg) || '';
    }

    if (!stepId) {
      return null;
    }

    // Determine step type and create step info
    let stepType: StepInfo['type'] = 'checkpoint';

    if (methodName === 'createCheckpoint') {
      stepType = 'checkpoint';
    } else if (methodName === 'createAgenticCheckpoint') {
      stepType = 'agent';
    } else if (methodName === 'createConditionalStep') {
      stepType = 'conditional';
    } else if (methodName === 'createExternalStep') {
      stepType = 'external';
    } else if (methodName === 'createWhileLoop') {
      stepType = 'loop';
      // Don't append _loop - use original step ID to match dynamic executor
    } else if (methodName === 'createParallelWorkflows') {
      stepType = 'checkpoint'; // Parallel workflows are represented as checkpoints with child workflows
    }

    const stepInfo: StepInfo = {
      stepId,
      stepName: this.formatStepName(stepId),
      type: stepType,
      parentStepId: this.currentParentStep || undefined,
      position: { x: 250, y: this.stepCounter * 100 }
    };

    // Handle parallel workflows - extract child workflow information
    if (methodName === 'createParallelWorkflows' && args.length >= 2) {
      const configArg = args[1];
      const childWorkflows = this.extractParallelWorkflowConfig(configArg);
      if (childWorkflows.length > 0) {
        stepInfo.childWorkflows = childWorkflows;
        // Store parallel group information for edge management
        const childIds = childWorkflows.map((_, index) => `${stepId}_child_${index}`);
        this.parallelGroups.set(stepId, childIds);
      }
    }

    this.steps.push(stepInfo);
    this.stepCounter++;

    logger.info(`✅ Added step: ${stepId} (${stepType}) - Total steps now: ${this.steps.length}`);

    // Create edge from previous step
    if (this.conditionalStack.length > 0) {
      // We're inside a conditional branch
      const conditional = this.conditionalStack[this.conditionalStack.length - 1];

      if (conditional.firstStepInBranch) {
        // First step in branch: edge from conditional to this step
        const label = conditional.inTrueBranch ? 'true' : 'false';
        const edgeType = conditional.inTrueBranch ? 'conditional-true' : 'conditional-false';

        this.edges.push({
          id: `${conditional.stepId}-${stepId}`,
          source: conditional.stepId,
          target: stepId,
          label,
          type: edgeType as any
        });

        // Mark that we've seen the first step
        conditional.firstStepInBranch = false;
      } else if (this.lastNonConditionalStep) {
        // Subsequent steps in branch: normal sequential flow
        this.edges.push({
          id: `${this.lastNonConditionalStep}-${stepId}`,
          source: this.lastNonConditionalStep,
          target: stepId,
          type: 'default'
        });
      }
    } else {
      // Outside any branch

      // Check if we have a pending false branch edge (from if-without-else)
      if (this.pendingFalseBranchFrom) {
        this.edges.push({
          id: `${this.pendingFalseBranchFrom}-${stepId}`,
          source: this.pendingFalseBranchFrom,
          target: stepId,
          label: 'false',
          type: 'conditional-false'
        });
        this.pendingFalseBranchFrom = null; // Clear after use
      }

      // Normal sequential flow - includes edges TO conditionals
      if (this.lastNonConditionalStep) {
        this.edges.push({
          id: `${this.lastNonConditionalStep}-${stepId}`,
          source: this.lastNonConditionalStep,
          target: stepId,
          type: 'default'
        });
      }
    }

    // Track last non-conditional step for sequential edges
    if (stepType !== 'conditional') {
      this.lastNonConditionalStep = stepId;
    }

    return stepId;
  }

  /**
   * Parse if statements (conditional branches)
   */
  private parseIfStatement(ifStmt: ts.IfStatement): void {
    // The condition should be a variable from createConditionalStep
    const conditionalStepId = this.extractConditionalStepId(ifStmt.expression);

    if (conditionalStepId) {
      // Save the last step before entering branches
      const savedLastStep = this.lastNonConditionalStep;

      // Parse true branch
      this.conditionalStack.push({ stepId: conditionalStepId, inTrueBranch: true, firstStepInBranch: true });

      // Handle both block statements and single statements
      if (ts.isBlock(ifStmt.thenStatement)) {
        this.parseBlock(ifStmt.thenStatement);
      } else {
        this.parseStatement(ifStmt.thenStatement);
      }

      // Remember the last step in true branch
      const lastStepInTrueBranch = this.lastNonConditionalStep;
      this.conditionalStack.pop();

      // Parse false branch (else)
      if (ifStmt.elseStatement) {
        // Reset to conditional for false branch
        this.lastNonConditionalStep = savedLastStep;
        this.conditionalStack.push({ stepId: conditionalStepId, inTrueBranch: false, firstStepInBranch: true });

        if (ts.isBlock(ifStmt.elseStatement)) {
          this.parseBlock(ifStmt.elseStatement);
        } else {
          this.parseStatement(ifStmt.elseStatement);
        }
        this.conditionalStack.pop();
      } else {
        // No else branch: the conditional's false path implicitly continues to next step
        // Mark that we need to create a false branch edge to the next step
        this.pendingFalseBranchFrom = conditionalStepId;
        // After the if block, lastNonConditionalStep should be the last step in true branch
        this.lastNonConditionalStep = lastStepInTrueBranch;
      }
    }
  }

  /**
   * Extract conditional step ID from if condition
   */
  private extractConditionalStepId(expr: ts.Expression): string {
    // Handle simple identifiers like isPremiumUser
    if (ts.isIdentifier(expr)) {
      const varName = expr.text;
      return this.variableToStepId.get(varName) || `dynamic_condition_${varName}`;
    }

    // Handle binary expressions like isPremiumUser === "1"
    if (ts.isBinaryExpression(expr)) {
      const leftSide = expr.left;
      if (ts.isIdentifier(leftSide)) {
        const varName = leftSide.text;
        const stepId = this.variableToStepId.get(varName);
        if (stepId) {
          return stepId;
        }
      }
    }

    // Handle complex expressions - sanitize to valid step ID
    return 'runtime_condition';
  }

  /**
   * Extract case value generically - string, number, enum, boolean, etc.
   */
  private extractCaseValue(expr: ts.Expression): string {
    if (ts.isStringLiteral(expr)) {
      return expr.text; // "true", "false", "premium", etc.
    } else if (ts.isNumericLiteral(expr)) {
      return expr.text; // 1, 2, 0, etc.
    } else if (expr.kind === ts.SyntaxKind.TrueKeyword) {
      return 'true';
    } else if (expr.kind === ts.SyntaxKind.FalseKeyword) {
      return 'false';
    } else if (ts.isPropertyAccessExpression(expr)) {
      return expr.name.getText(this.sourceFile!); // Enum.VALUE
    } else {
      return expr.getText(this.sourceFile!); // fallback
    }
  }

  /**
   * Extract all branches from if-else-if-else chain
   */
  private extractIfElseIfChain(node: ts.IfStatement): Array<{
    label: string;
    steps: string[];
    isTrue: boolean;
  }> {
    const branches: Array<{ label: string; steps: string[]; isTrue: boolean }> = [];

    // Process the main if condition
    const mainConditionValue = this.extractConditionValue(node.expression);
    const mainSteps = this.findStepsInNode(node.thenStatement);
    branches.push({
      label: mainConditionValue || 'true',
      steps: mainSteps,
      isTrue: mainConditionValue === 'true' //|| mainConditionValue === true || !mainConditionValue
    });

    // Process else-if and else chains
    let currentElse = node.elseStatement;
    while (currentElse) {
      if (ts.isIfStatement(currentElse)) {
        // This is an else-if
        const elseIfConditionValue = this.extractConditionValue(currentElse.expression);
        const elseIfSteps = this.findStepsInNode(currentElse.thenStatement);
        branches.push({
          label: elseIfConditionValue || 'false',
          steps: elseIfSteps,
          isTrue: elseIfConditionValue === 'true' //|| elseIfConditionValue === true
        });
        currentElse = currentElse.elseStatement;
      } else {
        // This is the final else clause
        const elseSteps = this.findStepsInNode(currentElse);
        branches.push({
          label: 'default',
          steps: elseSteps,
          isTrue: false
        });
        break;
      }
    }

    return branches;
  }

  /**
   * Check if this if statement is part of an else clause (i.e., an else-if)
   */
  private isPartOfElseClause(ifNode: ts.IfStatement): boolean {
    // Check if the parent of this if statement is another if statement's else clause
    let parent = ifNode.parent;

    // Walk up the tree to see if we're in an else statement
    while (parent) {
      if (ts.isIfStatement(parent)) {
        // Check if this if node is the else statement of the parent if
        return parent.elseStatement === ifNode;
      }
      parent = parent.parent;
    }

    return false;
  }

  /**
   * Extract the comparison value from a condition like isPremiumUser === "1"
   */
  private extractConditionValue(expr: ts.Expression): string | null {
    // Handle binary expressions like isPremiumUser === "1"
    if (ts.isBinaryExpression(expr)) {
      const operator = expr.operatorToken.kind;

      // Handle equality comparisons
      if (operator === ts.SyntaxKind.EqualsEqualsEqualsToken ||
          operator === ts.SyntaxKind.EqualsEqualsToken) {

        // Get the right side of the comparison (the value)
        const rightSide = expr.right;
        return this.extractCaseValue(rightSide);
      }
    }

    // Handle simple identifiers (like just isPremiumUser)
    if (ts.isIdentifier(expr)) {
      return 'true'; // Simple boolean check
    }

    return null;
  }

  /**
   * Format step ID to human-readable name
   */
  private formatStepName(stepId: string): string {
    return stepId
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Extract parallel workflow configuration from AST node
   */
  private extractParallelWorkflowConfig(configNode: ts.Node): Array<{workflowType: string, initialContext: any}> {
    const childWorkflows: Array<{workflowType: string, initialContext: any}> = [];

    if (ts.isObjectLiteralExpression(configNode)) {
      // Look for workflows property
      const workflowsProp = configNode.properties.find(prop =>
        ts.isPropertyAssignment(prop) &&
        ts.isIdentifier(prop.name) &&
        prop.name.text === 'workflows'
      );

      // Handle both direct arrays and "as const" assertions
      let workflowsArray: ts.ArrayLiteralExpression | null = null;

      if (workflowsProp && ts.isPropertyAssignment(workflowsProp)) {
        if (ts.isArrayLiteralExpression(workflowsProp.initializer)) {
          workflowsArray = workflowsProp.initializer;
        } else if (ts.isAsExpression(workflowsProp.initializer) && ts.isArrayLiteralExpression(workflowsProp.initializer.expression)) {
          // Handle "workflows: [...] as const"
          workflowsArray = workflowsProp.initializer.expression;
        }
      }

      if (workflowsArray) {
        for (const element of workflowsArray.elements) {
          if (ts.isObjectLiteralExpression(element)) {
            const workflowInfo = this.extractWorkflowInfo(element);
            if (workflowInfo) {
              childWorkflows.push(workflowInfo);
            }
          }
        }
      }
    }

    return childWorkflows;
  }

  /**
   * Extract workflow type and initial context from workflow configuration object
   */
  private extractWorkflowInfo(workflowObj: ts.ObjectLiteralExpression): {workflowType: string, initialContext: any} | null {
    let workflowType = '';
    let initialContext = {};

    for (const prop of workflowObj.properties) {
      if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
        const propName = prop.name.text;

        if (propName === 'workflowType') {
          // Handle both direct property access and "as const" assertions
          let propertyAccess: ts.PropertyAccessExpression | null = null;

          if (ts.isPropertyAccessExpression(prop.initializer)) {
            propertyAccess = prop.initializer;
          } else if (ts.isAsExpression(prop.initializer) && ts.isPropertyAccessExpression(prop.initializer.expression)) {
            // Handle "WorkflowType.XYZ as const"
            propertyAccess = prop.initializer.expression;
          }

          if (propertyAccess) {
            // Extract WorkflowType.XYZ -> 'XYZ'
            workflowType = propertyAccess.name.getText(this.sourceFile!);
          }
        } else if (propName === 'initialContext') {
          // Handle both object literals and spread syntax
          if (ts.isObjectLiteralExpression(prop.initializer)) {
            initialContext = this.extractContextObject(prop.initializer);
          } else {
            // For spread syntax like { ...context }, just use empty context
            initialContext = {};
          }
        }
      }
    }

    return workflowType ? { workflowType, initialContext } : null;
  }

  /**
   * Extract context object from AST (simplified extraction)
   */
  private extractContextObject(contextObj: ts.ObjectLiteralExpression): any {
    const context: any = {};

    for (const prop of contextObj.properties) {
      if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
        const key = prop.name.text;

        if (ts.isStringLiteral(prop.initializer)) {
          context[key] = prop.initializer.text;
        } else if (ts.isNumericLiteral(prop.initializer)) {
          context[key] = parseFloat(prop.initializer.text);
        } else if (prop.initializer.kind === ts.SyntaxKind.TrueKeyword) {
          context[key] = true;
        } else if (prop.initializer.kind === ts.SyntaxKind.FalseKeyword) {
          context[key] = false;
        }
      }
    }

    return context;
  }

  /**
   * Expand parallel workflows and child workflows
   */
  private async expandParallelWorkflows(baseGraph: WorkflowGraph, _filePath: string): Promise<WorkflowGraph> {
    // Find nodes with child workflows
    const nodesWithChildren = baseGraph.nodes.filter(node =>
      node.childWorkflows && node.childWorkflows.length > 0
    );

    if (nodesWithChildren.length === 0) {
      return baseGraph;
    }

    const expandedNodes = [...baseGraph.nodes];
    const expandedEdges = [...baseGraph.edges];

    // Process each node with child workflows
    for (const parentNode of nodesWithChildren) {
      // Remove the parent parallel container from final graph
      const parentNodeIndex = expandedNodes.findIndex(node => node.id === parentNode.id);
      if (parentNodeIndex !== -1) {
        expandedNodes.splice(parentNodeIndex, 1);
      }

      // Process each child workflow
      for (let childIndex = 0; childIndex < parentNode.childWorkflows!.length; childIndex++) {
        const childWorkflow = parentNode.childWorkflows![childIndex];
        const childWorkflowType = childWorkflow.workflowType;

        // Fetch child workflow graph internally (no HTTP call needed)
        let childGraph: WorkflowGraph;
        try {
          childGraph = await this.fetchWorkflowGraphInternally(childWorkflowType);
        } catch (error) {
          logger.warn(`Failed to fetch child workflow ${childWorkflowType}:`, error);
          childGraph = this.createPlaceholderGraph(childWorkflowType);
        }

        // Embed child graph with unique IDs and positioning
        this.embedChildGraph(expandedNodes, expandedEdges, parentNode, childGraph, childIndex);
      }
    }

    return {
      workflowType: baseGraph.workflowType,
      name: baseGraph.name,
      description: baseGraph.description,
      nodes: expandedNodes,
      edges: expandedEdges
    };
  }

  /**
   * Embed child graph into parent graph
   */
  private embedChildGraph(
    expandedNodes: WorkflowGraphNode[],
    expandedEdges: WorkflowGraphEdge[],
    parentNode: WorkflowGraphNode,
    childGraph: WorkflowGraph,
    childIndex: number
  ): void {
    const childNodePrefix = `${parentNode.id}_child_${childIndex}`;
    const baseX = (parentNode.position?.x || 250) + (childIndex * 300);
    const baseY = (parentNode.position?.y || 0) + 100;

    // Add child nodes with unique IDs
    for (let nodeIndex = 0; nodeIndex < childGraph.nodes.length; nodeIndex++) {
      const childNode = childGraph.nodes[nodeIndex];
      const newNodeId = `${childNodePrefix}_${childNode.id}`;

      expandedNodes.push({
        id: newNodeId,
        name: `${childNode.name} (${childGraph.workflowType})`,
        type: childNode.type,
        position: {
          x: baseX,
          y: baseY + (nodeIndex * 80)
        }
      });
    }

    // Add child edges with updated IDs
    for (const childEdge of childGraph.edges) {
      const newEdgeId = `${childNodePrefix}_${childEdge.id}`;
      const newSourceId = `${childNodePrefix}_${childEdge.source}`;
      const newTargetId = `${childNodePrefix}_${childEdge.target}`;

      expandedEdges.push({
        id: newEdgeId,
        source: newSourceId,
        target: newTargetId,
        label: childEdge.label,
        type: childEdge.type || 'default'
      });
    }

    // Connect parent edges to child workflow
    if (childGraph.nodes.length > 0) {
      const firstChildNodeId = `${childNodePrefix}_${childGraph.nodes[0].id}`;
      const lastChildNodeId = `${childNodePrefix}_${childGraph.nodes[childGraph.nodes.length - 1].id}`;

      // Handle parallel edge connections
      if (childIndex === 0) {
        // First child: redirect incoming edges
        const incomingEdges = expandedEdges.filter(edge => edge.target === parentNode.id);
        for (const edge of incomingEdges) {
          edge.target = firstChildNodeId;
          edge.type = 'parallel';
        }

        // Redirect outgoing edges
        const outgoingEdges = expandedEdges.filter(edge => edge.source === parentNode.id);
        for (const edge of outgoingEdges) {
          edge.source = lastChildNodeId;
          edge.type = 'parallel-join';
        }
      } else {
        // Subsequent children: create new parallel edges
        const parallelEdges = expandedEdges.filter(edge => edge.type === 'parallel');
        const joinEdges = expandedEdges.filter(edge => edge.type === 'parallel-join');

        if (parallelEdges.length > 0) {
          const sourceNode = parallelEdges[0].source;
          expandedEdges.push({
            id: `${sourceNode}-${firstChildNodeId}`,
            source: sourceNode,
            target: firstChildNodeId,
            type: 'parallel'
          });
        }

        if (joinEdges.length > 0) {
          const targetNode = joinEdges[0].target;
          expandedEdges.push({
            id: `${lastChildNodeId}-${targetNode}`,
            source: lastChildNodeId,
            target: targetNode,
            type: 'parallel-join'
          });
        }
      }
    }
  }

  /**
   * Fetch workflow graph internally without HTTP API call
   */
  private async fetchWorkflowGraphInternally(workflowType: string): Promise<WorkflowGraph> {
    // Get the workflow file mapping to find the file path
    // Use a relative path from the current working directory instead of __dirname
    const definitionsDir = path.resolve(process.cwd(), 'src/workflows/definitions');
    const workflowFileMap = ASTWorkflowParser.createWorkflowFileMapping(definitionsDir);

    const filePath = workflowFileMap[workflowType.toUpperCase()];
    if (!filePath) {
      throw new Error(`Workflow file not found for type: ${workflowType}`);
    }

    // Call the AST parser directly instead of making HTTP request
    return await this.parseWorkflowFileAdvanced(filePath, workflowType);
  }

  /**
   * Create placeholder graph for missing workflows
   */
  private createPlaceholderGraph(workflowType: string): WorkflowGraph {
    return {
      workflowType: workflowType.toLowerCase(),
      name: `${workflowType} (Placeholder)`,
      description: `Placeholder for ${workflowType} workflow`,
      nodes: [{
        id: 'placeholder',
        name: `${workflowType} Placeholder`,
        type: 'checkpoint',
        position: { x: 0, y: 0 }
      }],
      edges: []
    };
  }

  /**
   * Extract context fields from workflow file by analyzing getContext() destructuring patterns
   */
  static extractContextFields(filePath: string): string[] {
    try {
      const sourceCode = fs.readFileSync(filePath, 'utf-8');
      const sourceFile = ts.createSourceFile(
        path.basename(filePath),
        sourceCode,
        ts.ScriptTarget.Latest,
        true
      );

      const fields = new Set<string>();

      const visit = (node: ts.Node) => {
        // Look for variable declarations with destructuring from getContext()
        if (ts.isVariableDeclaration(node) &&
            node.initializer &&
            ts.isCallExpression(node.initializer)) {

          const callExpr = node.initializer;
          // Check if it's a getContext() call
          if (ts.isPropertyAccessExpression(callExpr.expression) &&
              ts.isIdentifier(callExpr.expression.name) &&
              callExpr.expression.name.text === 'getContext') {

            // Extract fields from destructuring pattern
            if (ts.isObjectBindingPattern(node.name)) {
              for (const element of node.name.elements) {
                if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) {
                  fields.add(element.name.text);
                }
              }
            }
          }
        }

        // Look for destructuring assignment from context variable
        if (ts.isVariableDeclaration(node) &&
            node.initializer &&
            ts.isIdentifier(node.initializer) &&
            node.initializer.text === 'context') {

          if (ts.isObjectBindingPattern(node.name)) {
            for (const element of node.name.elements) {
              if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) {
                fields.add(element.name.text);
              }
            }
          }
        }

        ts.forEachChild(node, visit);
      }

      visit(sourceFile);
      return Array.from(fields).sort();
    } catch (error) {
      logger.error(`Error extracting context fields from ${filePath}:`, error);
      return ['title', 'description']; // fallback
    }
  }
}
