/**
 * Test Dependency Manager
 * Handles test dependencies, execution ordering, and priority-based execution
 */

import { 
  TestMetadata, 
  TestPriority, 
  DependencyNode, 
  DependencyGraph, 
  TestExecutionResult, 
  TestSkipInfo,
  PriorityExecutionStats 
} from '@/types';

export class DependencyManager {
  private testRegistry = new Map<string, TestMetadata>();
  private executionResults = new Map<string, TestExecutionResult>();
  private dependencyGraph: DependencyGraph | null = null;
  private priorityOrder: TestPriority[] = ['highest', 'high', 'medium', 'low'];

  /**
   * Register a test with its metadata
   */
  registerTest(testName: string, metadata: TestMetadata = {}): void {
    this.testRegistry.set(testName, {
      priority: 'medium', // default priority
      dependsOn: [],
      tags: [],
      ...metadata
    });
    
    console.log(` Registered test: "${testName}" with priority: ${metadata.priority || 'medium'}`);
    
    if (metadata.dependsOn && metadata.dependsOn.length > 0) {
      console.log(` Dependencies: ${metadata.dependsOn.join(', ')}`);
    }
  }

  /**
   * Build dependency graph from registered tests
   */
  buildDependencyGraph(): DependencyGraph {
    const nodes = new Map<string, DependencyNode>();
    
    // Create nodes for all registered tests
    for (const [testName, metadata] of this.testRegistry) {
      nodes.set(testName, {
        testName,
        fullTitle: testName, // Will be updated with actual full title during execution
        priority: metadata.priority || 'medium',
        dependencies: metadata.dependsOn || [],
        dependents: [],
        status: 'pending',
        metadata
      });
    }

    // Build dependent relationships
    for (const [testName, node] of nodes) {
      for (const dependency of node.dependencies) {
        const depNode = nodes.get(dependency);
        if (depNode) {
          depNode.dependents.push(testName);
        } else {
          console.warn(`️  Warning: Test "${testName}" depends on "${dependency}" which is not registered`);
        }
      }
    }

    // Detect cycles
    const { hasCycles, cycles } = this.detectCycles(nodes);
    
    if (hasCycles) {
      console.error('🚨 Circular dependencies detected:', cycles);
      throw new Error(`Circular dependencies detected: ${cycles?.map(cycle => cycle.join(' -> ')).join(', ')}`);
    }

    // Generate execution order
    const executionOrder = this.generateExecutionOrder(nodes);

    this.dependencyGraph = {
      nodes,
      executionOrder,
      hasCycles,
      cycles
    };

    console.log(` Dependency graph built with ${nodes.size} tests`);
    console.log(` Execution order: ${executionOrder.join(' -> ')}`);

    return this.dependencyGraph;
  }

  /**
   * Detect circular dependencies using DFS
   */
  private detectCycles(nodes: Map<string, DependencyNode>): { hasCycles: boolean; cycles?: string[][] } {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const cycles: string[][] = [];

    const dfs = (testName: string, path: string[]): boolean => {
      if (recursionStack.has(testName)) {
        // Found a cycle
        const cycleStart = path.indexOf(testName);
        cycles.push([...path.slice(cycleStart), testName]);
        return true;
      }

      if (visited.has(testName)) {
        return false;
      }

      visited.add(testName);
      recursionStack.add(testName);
      path.push(testName);

      const node = nodes.get(testName);
      if (node) {
        for (const dependency of node.dependencies) {
          if (dfs(dependency, [...path])) {
            return true;
          }
        }
      }

      recursionStack.delete(testName);
      return false;
    };

    let hasCycles = false;
    for (const testName of nodes.keys()) {
      if (!visited.has(testName)) {
        if (dfs(testName, [])) {
          hasCycles = true;
        }
      }
    }

    return { hasCycles, cycles: hasCycles ? cycles : undefined };
  }

  /**
   * Generate execution order based on dependencies and priorities
   */
  private generateExecutionOrder(nodes: Map<string, DependencyNode>): string[] {
    const executionOrder: string[] = [];
    const processed = new Set<string>();

    // Topological sort with priority consideration
    const visit = (testName: string) => {
      if (processed.has(testName)) {
        return;
      }

      const node = nodes.get(testName);
      if (!node) {
        return;
      }

      // First, visit all dependencies
      for (const dependency of node.dependencies) {
        visit(dependency);
      }

      processed.add(testName);
      executionOrder.push(testName);
    };

    // Group tests by priority and process in priority order
    const testsByPriority = new Map<TestPriority, string[]>();
    
    for (const priority of this.priorityOrder) {
      testsByPriority.set(priority, []);
    }

    for (const [testName, node] of nodes) {
      const priority = node.priority;
      testsByPriority.get(priority)?.push(testName);
    }

    // Process tests in priority order, respecting dependencies
    for (const priority of this.priorityOrder) {
      const testsInPriority = testsByPriority.get(priority) || [];
      
      // Sort tests within same priority by dependency depth
      testsInPriority.sort((a, b) => {
        const nodeA = nodes.get(a)!;
        const nodeB = nodes.get(b)!;
        return nodeA.dependencies.length - nodeB.dependencies.length;
      });

      for (const testName of testsInPriority) {
        visit(testName);
      }
    }

    return executionOrder;
  }

  /**
   * Check if a test should be skipped based on failed dependencies
   */
  shouldSkipTest(testName: string): TestSkipInfo {
    if (!this.dependencyGraph) {
      return { skip: false };
    }

    const node = this.dependencyGraph.nodes.get(testName);
    if (!node) {
      return { skip: false };
    }

    // Check if any dependencies have failed
    for (const dependency of node.dependencies) {
      const depResult = this.executionResults.get(dependency);
      if (depResult && depResult.status === 'failed') {
        return {
          skip: true,
          reason: `Dependency failed: "${dependency}"`,
          failedDependency: dependency
        };
      }
    }

    return { skip: false };
  }

  /**
   * Record test execution result
   */
  recordTestResult(result: TestExecutionResult): void {
    this.executionResults.set(result.testName, result);
    
    // Update dependency graph node status
    if (this.dependencyGraph) {
      const node = this.dependencyGraph.nodes.get(result.testName);
      if (node) {
        node.status = result.status;
        node.fullTitle = result.fullTitle;
      }
    }

    console.log(` Test result recorded: "${result.testName}" - ${result.status}`);

    // If test failed, mark all dependents for skipping
    if (result.status === 'failed') {
      this.markDependentsForSkipping(result.testName);
    }
  }

  /**
   * Mark all dependent tests for skipping when a dependency fails
   */
  private markDependentsForSkipping(failedTestName: string): void {
    if (!this.dependencyGraph) return;

    const node = this.dependencyGraph.nodes.get(failedTestName);
    if (!node) return;

    const toSkip = new Set<string>();
    const queue = [...node.dependents];

    // BFS to find all transitive dependents
    while (queue.length > 0) {
      const dependent = queue.shift()!;
      if (toSkip.has(dependent)) continue;

      toSkip.add(dependent);
      const depNode = this.dependencyGraph.nodes.get(dependent);
      if (depNode) {
        queue.push(...depNode.dependents);
      }
    }

    // Record skip results for all dependents
    for (const testName of toSkip) {
      const skipResult: TestExecutionResult = {
        testName,
        fullTitle: testName,
        status: 'skipped',
        reason: `Dependency failed: "${failedTestName}"`,
        priority: this.dependencyGraph.nodes.get(testName)?.priority,
        dependencies: this.dependencyGraph.nodes.get(testName)?.dependencies
      };
      
      this.executionResults.set(testName, skipResult);
      
      // Update node status
      const node = this.dependencyGraph.nodes.get(testName);
      if (node) {
        node.status = 'skipped';
      }
    }

    if (toSkip.size > 0) {
      console.log(`⏭  Marked ${toSkip.size} dependent tests for skipping: ${Array.from(toSkip).join(', ')}`);
    }
  }

  /**
   * Get execution statistics by priority
   */
  getExecutionStats(): PriorityExecutionStats {
    const stats: PriorityExecutionStats = {
      highest: { total: 0, passed: 0, failed: 0, skipped: 0 },
      high: { total: 0, passed: 0, failed: 0, skipped: 0 },
      medium: { total: 0, passed: 0, failed: 0, skipped: 0 },
      low: { total: 0, passed: 0, failed: 0, skipped: 0 },
      totalDependencySkips: 0,
      dependencyChains: 0
    };

    for (const [testName, result] of this.executionResults) {
      const priority = result.priority || 'medium';
      const priorityStats = stats[priority];
      
      priorityStats.total++;
      
      switch (result.status) {
        case 'passed':
          priorityStats.passed++;
          break;
        case 'failed':
          priorityStats.failed++;
          break;
        case 'skipped':
          priorityStats.skipped++;
          if (result.reason?.includes('Dependency failed')) {
            stats.totalDependencySkips++;
          }
          break;
      }
    }

    // Count dependency chains
    if (this.dependencyGraph) {
      stats.dependencyChains = Array.from(this.dependencyGraph.nodes.values())
        .filter(node => node.dependencies.length > 0).length;
    }

    return stats;
  }

  /**
   * Get test metadata by name
   */
  getTestMetadata(testName: string): TestMetadata | undefined {
    return this.testRegistry.get(testName);
  }

  /**
   * Get all registered tests
   */
  getAllTests(): Map<string, TestMetadata> {
    return new Map(this.testRegistry);
  }

  /**
   * Clear all data (useful for test cleanup)
   */
  clear(): void {
    this.testRegistry.clear();
    this.executionResults.clear();
    this.dependencyGraph = null;
    console.log(' Dependency manager cleared');
  }

  /**
   * Get dependency graph (for debugging/reporting)
   */
  getDependencyGraph(): DependencyGraph | null {
    return this.dependencyGraph;
  }

  /**
   * Get execution results
   */
  getExecutionResults(): Map<string, TestExecutionResult> {
    return new Map(this.executionResults);
  }
}

// Global singleton instance
export const dependencyManager = new DependencyManager();
