// Product to repository mapping configuration
// This mapping defines which repositories belong to each product

export interface ProductRepoMapping {
  [productName: string]: string[]
}

// Main product repository mapping
export const PRODUCT_REPO_MAPPING: ProductRepoMapping = {
  'Express Checkout': [
    'euler-api-gateway',
    'euler-api-order',
    'euler-api-customer',
    'euler-api-txns',
    'euler-api-cards',
    'euler-api-token',
    'euler-api-pre-txn',
    'euler-api-dashboard',
    'offer-engine'
  ],
  'xyne-spaces': [
    'xyne-spaces'
  ]
  // Add more products here as needed
  // 'Another Product': [
  //   'repo1',
  //   'repo2'
  // ]
}

// Repository metadata for clone URLs and branch configurations
export interface RepoMetadata {
  repoId: string
  projectId: string
  cloneUrl: string
  baseBranch: string
}

export const REPO_METADATA: { [repoName: string]: RepoMetadata } = {
  'euler-api-txns': {
    repoId: '1461',
    projectId: 'JBIZ',
    cloneUrl: 'ssh://git@github.com/example-org/euler-api-txns.git',
    baseBranch: 'staging'
  },
  'euler-api-gateway': {
    repoId: '1405',
    projectId: 'EXC',
    cloneUrl: 'ssh://git@github.com/example-org/euler-api-gateway.git',
    baseBranch: 'staging'
  },
  'euler-api-order': {
    repoId: '1454',
    projectId: 'JBIZ',
    cloneUrl: 'ssh://git@github.com/example-org/euler-api-order.git',
    baseBranch: 'staging'
  },
  'euler-api-customer': {
    repoId: '1452',
    projectId: 'JBIZ',
    cloneUrl: 'ssh://git@github.com/example-org/euler-api-customer.git',
    baseBranch: 'staging'
  },
  'euler-api-cards': {
    repoId: '1450',
    projectId: 'JBIZ',
    cloneUrl: 'ssh://git@github.com/example-org/euler-api-cards.git',
    baseBranch: 'staging'
  },
  'euler-api-token': {
    repoId: '1459',
    projectId: 'JBIZ',
    cloneUrl: 'ssh://git@github.com/example-org/euler-api-token.git',
    baseBranch: 'staging'
  },
  'euler-api-pre-txn': {
    repoId: '1456',
    projectId: 'JBIZ',
    cloneUrl: 'ssh://git@github.com/example-org/euler-api-pre-txn.git',
    baseBranch: 'staging'
  },
  'euler-api-dashboard': {
    repoId: '1453',
    projectId: 'JBIZ',
    cloneUrl: 'ssh://git@github.com/example-org/euler-api-dashboard.git',
    baseBranch: 'staging'
  },
  'offer-engine': {
    repoId: '1496',
    projectId: 'JBIZ',
    cloneUrl: 'ssh://git@github.com/example-org/offer-engine.git',
    baseBranch: 'staging'
  },
  'xyne-spaces': {
    repoId: 'TBD',
    projectId: 'XYNE',
    cloneUrl: 'ssh://git@github.com/example-org/xyne-spaces.git',
    baseBranch: 'main'
  }
}

// Helper functions
export function getRepositoriesForProduct(productName: string): string[] {
  return PRODUCT_REPO_MAPPING[productName] || []
}

export function getAvailableProducts(): string[] {
  return Object.keys(PRODUCT_REPO_MAPPING)
}

export function getRepoMetadata(repoName: string): RepoMetadata | undefined {
  return REPO_METADATA[repoName]
}

export function validateProduct(productName: string): boolean {
  return productName in PRODUCT_REPO_MAPPING
}

export function validateRepositories(repositories: string[]): { valid: string[], invalid: string[] } {
  const valid: string[] = []
  const invalid: string[] = []

  for (const repo of repositories) {
    if (repo in REPO_METADATA) {
      valid.push(repo)
    } else {
      invalid.push(repo)
    }
  }

  return { valid, invalid }
}

// Admin configuration - repositories that can be selected for products
export interface AdminProductConfig {
  productName: string
  repositories: string[]
  isActive: boolean
  createdAt: string
  updatedAt: string
}

// For future admin UI - this would be stored in database
export interface AdminRepoSelectionInterface {
  addProduct(config: AdminProductConfig): Promise<void>
  updateProduct(productName: string, repositories: string[]): Promise<void>
  deleteProduct(productName: string): Promise<void>
  getProducts(): Promise<AdminProductConfig[]>
  getAllRepositories(): Promise<string[]>
}