# Xyne Spaces Backend API Documentation

## Base URL
```
http://localhost:3001/api
```

---

# Health APIs

## GET /api/health
Get application health status and system information.

**Request:**
```http
GET /api/health
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "status": "OK",
    "timestamp": "2024-03-15T10:30:00.000Z",
    "uptime": 3600,
    "version": "1.0.0",
    "environment": "development",
    "memory": {
      "used": 128,
      "total": 512
    },
    "database": {
      "status": "connected",
      "connected": true
    }
  },
  "timestamp": "2024-03-15T10:30:00.000Z"
}
```

## GET /api/health/readiness
Check if the application is ready to receive traffic.

**Request:**
```http
GET /api/health/readiness
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "status": "ready",
    "database": {
      "connected": true,
      "healthy": true
    }
  },
  "timestamp": "2024-03-15T10:30:00.000Z"
}
```

## GET /api/health/liveness
Check if the application is alive.

**Request:**
```http
GET /api/health/liveness
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "status": "alive",
    "pid": 12345
  },
  "timestamp": "2024-03-15T10:30:00.000Z"
}
```

---

# Ticket APIs

## POST /api/tickets
Create a new ticket and automatically trigger associated workflows.

**Request:**
```http
POST /api/tickets
Content-Type: application/json

{
  "title": "Fix login authentication bug",
  "workflowType": "BUG",
  "description": "Users are unable to log in with correct credentials",
  "scope": "authentication",
  "owner": "john.doe@example.com"
}
```

**Response (201):**
```json
{
  "id": "clp123abc456def789",
  "title": "Fix login authentication bug",
  "workflowType": "BUG",
  "description": "Users are unable to log in with correct credentials",
  "scope": "authentication",
  "owner": "john.doe@example.com",
  "status": "IN_PROGRESS",
  "humanReadableId": "BUG-001",
  "createdAt": "2024-03-15T10:30:00.000Z",
  "updatedAt": "2024-03-15T10:30:00.000Z"
}
```

## GET /api/tickets
Get all tickets with pagination support.

**Request:**
```http
GET /api/tickets?limit=20&offset=0
```

**Response (200):**
```json
{
  "data": [
    {
      "id": "clp123abc456def789",
      "title": "Fix login authentication bug",
      "workflowType": "BUG",
      "description": "Users are unable to log in with correct credentials",
      "scope": "authentication",
      "owner": "john.doe@example.com",
      "status": "IN_PROGRESS",
      "humanReadableId": "BUG-001",
      "createdAt": "2024-03-15T10:30:00.000Z",
      "updatedAt": "2024-03-15T10:30:00.000Z"
    }
  ],
  "pagination": {
    "totalCount": 1,
    "totalPages": 1,
    "currentPage": 1,
    "limit": 20,
    "offset": 0,
    "hasNextPage": false,
    "hasPreviousPage": false
  }
}
```

## GET /api/tickets/:id
Get ticket details by ID.

**Request:**
```http
GET /api/tickets/clp123abc456def789
```

**Response (200):**
```json
{
  "id": "clp123abc456def789",
  "title": "Fix login authentication bug",
  "workflowType": "BUG",
  "description": "Users are unable to log in with correct credentials",
  "scope": "authentication",
  "owner": "john.doe@example.com",
  "status": "IN_PROGRESS",
  "humanReadableId": "BUG-001",
  "createdAt": "2024-03-15T10:30:00.000Z",
  "updatedAt": "2024-03-15T10:30:00.000Z"
}
```

## GET /api/tickets/hr/:humanReadableId
Get ticket by human readable ID.

**Request:**
```http
GET /api/tickets/hr/BUG-001
```

**Response (200):**
```json
{
  "id": "clp123abc456def789",
  "title": "Fix login authentication bug",
  "workflowType": "BUG",
  "description": "Users are unable to log in with correct credentials",
  "scope": "authentication",
  "owner": "john.doe@example.com",
  "status": "IN_PROGRESS",
  "humanReadableId": "BUG-001",
  "createdAt": "2024-03-15T10:30:00.000Z",
  "updatedAt": "2024-03-15T10:30:00.000Z"
}
```

## GET /api/tickets/:id/relations
Get ticket with related workflows and workflow executions.

**Request:**
```http
GET /api/tickets/clp123abc456def789/relations
```

**Response (200):**
```json
{
  "ticket": {
    "id": "clp123abc456def789",
    "title": "Fix login authentication bug",
    "description": "Users are unable to log in with correct credentials",
    "humanReadableId": "BUG-001",
    "status": "IN_PROGRESS",
    "workflowType": "BUG",
    "environment": "production",
    "reportedBy": "user@example.com",
    "attachments": null,
    "createdBy": "system",
    "updatedBy": null,
    "scope": "authentication",
    "owner": "john.doe@example.com",
    "createdAt": "2024-03-15T10:30:00.000Z",
    "updatedAt": "2024-03-15T10:30:00.000Z"
  },
  "workflows": [
    {
      "id": "clw123abc456def789",
      "ticketId": "clp123abc456def789",
      "context": "Bug fixing workflow",
      "status": "RUNNING",
      "workflowName": "Bug Investigation Workflow",
      "metadata": {
        "priority": "high",
        "category": "authentication"
      },
      "configuration": {
        "autoAssign": true,
        "notifications": ["email", "slack"]
      },
      "workflowType": "USER_ONBOARDING",
      "scheduledAt": null,
      "createdAt": "2024-03-15T10:30:00.000Z",
      "updatedAt": "2024-03-15T10:30:00.000Z",
      "workflowExecutions": [
        {
          "id": "cle123abc456def789",
          "workflowId": "clw123abc456def789",
          "status": "RUNNING",
          "parentWorkflowExecutionId": null,
          "sourceStepsId": null,
          "createdAt": "2024-03-15T10:30:00.000Z",
          "updatedAt": "2024-03-15T10:30:00.000Z"
        }
      ]
    }
  ]
}
```

---

# Workflow APIs

## GET /api/workflows
Get all workflows with pagination.

**Request:**
```http
GET /api/workflows?page=1&limit=10
```

**Response (200):**
```json
{
  "workflows": [
    {
      "id": "clw123abc456def789",
      "ticketId": "clp123abc456def789",
      "context": "Bug fixing workflow",
      "status": "RUNNING",
      "workflowName": "Bug Investigation Workflow",
      "metadata": {
        "priority": "high",
        "category": "authentication"
      },
      "configuration": {
        "autoAssign": true,
        "notifications": ["email", "slack"]
      },
      "workflowType": "USER_ONBOARDING",
      "scheduledAt": null,
      "createdAt": "2024-03-15T10:30:00.000Z",
      "updatedAt": "2024-03-15T10:30:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 1,
    "totalPages": 1,
    "hasNext": false,
    "hasPrevious": false
  }
}
```

## GET /api/workflows/:id
Get workflow by ID.

**Request:**
```http
GET /api/workflows/clw123abc456def789
```

**Response (200):**
```json
{
  "id": "clw123abc456def789",
  "ticketId": "clp123abc456def789",
  "context": "Bug fixing workflow",
  "status": "RUNNING",
  "workflowName": "Bug Investigation Workflow",
  "metadata": {
    "priority": "high",
    "category": "authentication"
  },
  "configuration": {
    "autoAssign": true,
    "notifications": ["email", "slack"]
  },
  "workflowType": "USER_ONBOARDING",
  "scheduledAt": null,
  "createdAt": "2024-03-15T10:30:00.000Z",
  "updatedAt": "2024-03-15T10:30:00.000Z"
}
```

## POST /api/workflows
Create a new workflow.

**Request:**
```http
POST /api/workflows
Content-Type: application/json

{
  "ticketId": "clp123abc456def789",
  "context": "Feature development workflow",
  "status": "PENDING",
  "workflowName": "Feature Development Workflow",
  "metadata": {
    "priority": "medium",
    "estimatedHours": 40
  },
  "configuration": {
    "autoAssign": false,
    "reviewRequired": true
  },
  "workflowType": "FEATURE_DEVELOPMENT"
}
```

**Response (201):**
```json
{
  "id": "clw456def789abc123",
  "ticketId": "clp123abc456def789",
  "context": "Feature development workflow",
  "status": "PENDING",
  "workflowName": "Feature Development Workflow",
  "metadata": {
    "priority": "medium",
    "estimatedHours": 40
  },
  "configuration": {
    "autoAssign": false,
    "reviewRequired": true
  },
  "workflowType": "FEATURE_DEVELOPMENT",
  "scheduledAt": null,
  "createdAt": "2024-03-15T11:00:00.000Z",
  "updatedAt": "2024-03-15T11:00:00.000Z"
}
```

## PUT /api/workflows/:id
Update a workflow.

**Request:**
```http
PUT /api/workflows/clw123abc456def789
Content-Type: application/json

{
  "status": "COMPLETED",
  "metadata": {
    "priority": "high",
    "category": "authentication",
    "completedBy": "john.doe@example.com"
  }
}
```

**Response (200):**
```json
{
  "id": "clw123abc456def789",
  "ticketId": "clp123abc456def789",
  "context": "Bug fixing workflow",
  "status": "COMPLETED",
  "workflowName": "Bug Investigation Workflow",
  "metadata": {
    "priority": "high",
    "category": "authentication",
    "completedBy": "john.doe@example.com"
  },
  "configuration": {
    "autoAssign": true,
    "notifications": ["email", "slack"]
  },
  "workflowType": "USER_ONBOARDING",
  "scheduledAt": null,
  "createdAt": "2024-03-15T10:30:00.000Z",
  "updatedAt": "2024-03-15T11:30:00.000Z"
}
```

## GET /api/workflows/executions/:executionId/steps
Get workflow steps by execution ID.

**Request:**
```http
GET /api/workflows/executions/cle123abc456def789/steps
```

**Response (200):**
```json
{
  "workflowExecutionId": "cle123abc456def789",
  "totalSteps": 3,
  "steps": [
    {
      "id": "cls123abc456def789",
      "workflowExecutionId": "cle123abc456def789",
      "stepExecutorType": "AGENT",
      "stepName": "Initial Investigation",
      "type": "ANALYSIS",
      "previousStepId": null,
      "data": {
        "analysis": "Authentication service is down",
        "recommendation": "Restart authentication microservice"
      },
      "status": "COMPLETED",
      "createdAt": "2024-03-15T10:31:00.000Z",
      "updatedAt": "2024-03-15T10:35:00.000Z"
    },
    {
      "id": "cls456def789abc123",
      "workflowExecutionId": "cle123abc456def789",
      "stepExecutorType": "HUMAN",
      "stepName": "Manual Review",
      "type": "REVIEW",
      "previousStepId": "cls123abc456def789",
      "data": {
        "reviewer": "senior.engineer@example.com",
        "approved": true,
        "comments": "Analysis looks correct, proceed with restart"
      },
      "status": "COMPLETED",
      "createdAt": "2024-03-15T10:36:00.000Z",
      "updatedAt": "2024-03-15T10:40:00.000Z"
    },
    {
      "id": "cls789abc123def456",
      "workflowExecutionId": "cle123abc456def789",
      "stepExecutorType": "AGENT",
      "stepName": "Service Restart",
      "type": "ACTION",
      "previousStepId": "cls456def789abc123",
      "data": {
        "action": "restart_service",
        "service": "auth-service",
        "result": "success"
      },
      "status": "RUNNING",
      "createdAt": "2024-03-15T10:41:00.000Z",
      "updatedAt": "2024-03-15T10:41:00.000Z"
    }
  ]
}
```

## GET /api/workflows/executions
Get all workflow executions.

**Request:**
```http
GET /api/workflows/executions?page=1&limit=10
```

**Response (200):**
```json
{
  "workflowExecutions": [
    {
      "id": "cle123abc456def789",
      "workflowId": "clw123abc456def789",
      "status": "RUNNING",
      "parentWorkflowExecutionId": null,
      "sourceStepsId": null,
      "createdAt": "2024-03-15T10:30:00.000Z",
      "updatedAt": "2024-03-15T10:30:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 1,
    "totalPages": 1,
    "hasNext": false,
    "hasPrevious": false
  }
}
```

## POST /api/workflows/executions
Create a new workflow execution.

**Request:**
```http
POST /api/workflows/executions
Content-Type: application/json

{
  "workflowId": "clw123abc456def789",
  "status": "PENDING",
  "parentWorkflowExecutionId": null
}
```

**Response (201):**
```json
{
  "id": "cle789abc123def456",
  "workflowId": "clw123abc456def789",
  "status": "PENDING",
  "parentWorkflowExecutionId": null,
  "sourceStepsId": null,
  "createdAt": "2024-03-15T12:00:00.000Z",
  "updatedAt": "2024-03-15T12:00:00.000Z"
}
```

## GET /api/workflows/steps
Get all workflow steps.

**Request:**
```http
GET /api/workflows/steps?page=1&limit=10
```

**Response (200):**
```json
{
  "workflowSteps": [
    {
      "id": "cls123abc456def789",
      "workflowExecutionId": "cle123abc456def789",
      "stepExecutorType": "AGENT",
      "stepName": "Initial Investigation",
      "type": "ANALYSIS",
      "previousStepId": null,
      "data": {
        "analysis": "Authentication service is down",
        "recommendation": "Restart authentication microservice"
      },
      "status": "COMPLETED",
      "createdAt": "2024-03-15T10:31:00.000Z",
      "updatedAt": "2024-03-15T10:35:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 1,
    "totalPages": 1,
    "hasNext": false,
    "hasPrevious": false
  }
}
```

## POST /api/workflows/steps
Create a new workflow step.

**Request:**
```http
POST /api/workflows/steps
Content-Type: application/json

{
  "workflowExecutionId": "cle123abc456def789",
  "stepExecutorType": "AGENT",
  "stepName": "Code Analysis",
  "type": "ANALYSIS",
  "previousStepId": "cls123abc456def789",
  "data": {
    "filesParsed": 15,
    "bugsFound": 3,
    "severity": "medium"
  },
  "status": "PENDING"
}
```

**Response (201):**
```json
{
  "id": "cls999abc123def456",
  "workflowExecutionId": "cle123abc456def789",
  "stepExecutorType": "AGENT",
  "stepName": "Code Analysis",
  "type": "ANALYSIS",
  "previousStepId": "cls123abc456def789",
  "data": {
    "filesParsed": 15,
    "bugsFound": 3,
    "severity": "medium"
  },
  "status": "PENDING",
  "createdAt": "2024-03-15T11:00:00.000Z",
  "updatedAt": "2024-03-15T11:00:00.000Z"
}
```

---

# Agent APIs

## POST /api/agents
Create a new agent.

**Request:**
```http
POST /api/agents
Content-Type: application/json

{
  "userDefinedId": "bug-analyzer-agent-001",
  "model": "gpt-4",
  "systemPrompt": "You are a bug analysis agent specialized in identifying and categorizing software defects.",
  "name": "Bug Analyzer Agent",
  "scope": "bug-analysis",
  "description": "Analyzes bug reports and provides initial triage recommendations"
}
```

**Response (201):**
```json
{
  "id": "cla123abc456def789",
  "userDefinedId": "bug-analyzer-agent-001",
  "model": "gpt-4",
  "systemPrompt": "You are a bug analysis agent specialized in identifying and categorizing software defects.",
  "name": "Bug Analyzer Agent",
  "scope": "bug-analysis",
  "description": "Analyzes bug reports and provides initial triage recommendations",
  "createdAt": "2024-03-15T10:30:00.000Z",
  "updatedAt": "2024-03-15T10:30:00.000Z"
}
```

## GET /api/agents
Get all agents with pagination and filtering.

**Request:**
```http
GET /api/agents?page=1&pageSize=10&scope=bug-analysis&search=analyzer
```

**Response (200):**
```json
{
  "data": [
    {
      "id": "cla123abc456def789",
      "userDefinedId": "bug-analyzer-agent-001",
      "model": "gpt-4",
      "systemPrompt": "You are a bug analysis agent specialized in identifying and categorizing software defects.",
      "name": "Bug Analyzer Agent",
      "scope": "bug-analysis",
      "description": "Analyzes bug reports and provides initial triage recommendations",
      "createdAt": "2024-03-15T10:30:00.000Z",
      "updatedAt": "2024-03-15T10:30:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 10,
    "total": 1,
    "totalPages": 1
  }
}
```

## GET /api/agents/:id
Get agent by ID with optional relations.

**Request:**
```http
GET /api/agents/cla123abc456def789?include=all
```

**Response (200):**
```json
{
  "id": "cla123abc456def789",
  "userDefinedId": "bug-analyzer-agent-001",
  "model": "gpt-4",
  "systemPrompt": "You are a bug analysis agent specialized in identifying and categorizing software defects.",
  "name": "Bug Analyzer Agent",
  "scope": "bug-analysis",
  "description": "Analyzes bug reports and provides initial triage recommendations",
  "modelData": {
    "id": "clm123abc456def789",
    "name": "GPT-4",
    "provider": "openai",
    "version": "gpt-4-0613"
  },
  "agentToolsMappings": [
    {
      "id": "clat123abc456def789",
      "status": "enabled",
      "tool": {
        "id": "clt123abc456def789",
        "name": "code-analyzer",
        "description": "Static code analysis tool"
      }
    }
  ],
  "createdAt": "2024-03-15T10:30:00.000Z",
  "updatedAt": "2024-03-15T10:30:00.000Z"
}
```

## GET /api/agents/user-defined/:userDefinedId
Get agent by user-defined ID.

**Request:**
```http
GET /api/agents/user-defined/bug-analyzer-agent-001
```

**Response (200):**
```json
{
  "id": "cla123abc456def789",
  "userDefinedId": "bug-analyzer-agent-001",
  "model": "gpt-4",
  "systemPrompt": "You are a bug analysis agent specialized in identifying and categorizing software defects.",
  "name": "Bug Analyzer Agent",
  "scope": "bug-analysis",
  "description": "Analyzes bug reports and provides initial triage recommendations",
  "createdAt": "2024-03-15T10:30:00.000Z",
  "updatedAt": "2024-03-15T10:30:00.000Z"
}
```

## PUT /api/agents/:id
Update an agent.

**Request:**
```http
PUT /api/agents/cla123abc456def789
Content-Type: application/json

{
  "systemPrompt": "You are an advanced bug analysis agent specialized in identifying, categorizing, and prioritizing software defects with enhanced accuracy.",
  "description": "Enhanced bug analysis agent with improved triage capabilities"
}
```

**Response (200):**
```json
{
  "id": "cla123abc456def789",
  "userDefinedId": "bug-analyzer-agent-001",
  "model": "gpt-4",
  "systemPrompt": "You are an advanced bug analysis agent specialized in identifying, categorizing, and prioritizing software defects with enhanced accuracy.",
  "name": "Bug Analyzer Agent",
  "scope": "bug-analysis",
  "description": "Enhanced bug analysis agent with improved triage capabilities",
  "createdAt": "2024-03-15T10:30:00.000Z",
  "updatedAt": "2024-03-15T11:30:00.000Z"
}
```

## GET /api/agents/scope/:scope
Get agents by scope.

**Request:**
```http
GET /api/agents/scope/bug-analysis
```

**Response (200):**
```json
[
  {
    "id": "cla123abc456def789",
    "userDefinedId": "bug-analyzer-agent-001",
    "model": "gpt-4",
    "systemPrompt": "You are a bug analysis agent specialized in identifying and categorizing software defects.",
    "name": "Bug Analyzer Agent",
    "scope": "bug-analysis",
    "description": "Analyzes bug reports and provides initial triage recommendations",
    "createdAt": "2024-03-15T10:30:00.000Z",
    "updatedAt": "2024-03-15T10:30:00.000Z"
  }
]
```

---

# Model APIs

## POST /api/models
Create a new model.

**Request:**
```http
POST /api/models
Content-Type: application/json

{
  "userDefinedId": "gpt-4-turbo-001",
  "name": "GPT-4 Turbo",
  "provider": "openai",
  "credentials": {
    "apiKey": "sk-...",
    "organizationId": "org-..."
  },
  "version": "gpt-4-1106-preview",
  "description": "Latest GPT-4 Turbo model with improved performance"
}
```

**Response (201):**
```json
{
  "id": "clm123abc456def789",
  "userDefinedId": "gpt-4-turbo-001",
  "name": "GPT-4 Turbo",
  "provider": "openai",
  "credentials": {
    "apiKey": "sk-...",
    "organizationId": "org-..."
  },
  "version": "gpt-4-1106-preview",
  "description": "Latest GPT-4 Turbo model with improved performance",
  "createdAt": "2024-03-15T10:30:00.000Z",
  "updatedAt": "2024-03-15T10:30:00.000Z"
}
```

## GET /api/models
Get all models with pagination and filtering.

**Request:**
```http
GET /api/models?page=1&pageSize=10&provider=openai&search=gpt
```

**Response (200):**
```json
{
  "data": [
    {
      "id": "clm123abc456def789",
      "userDefinedId": "gpt-4-turbo-001",
      "name": "GPT-4 Turbo",
      "provider": "openai",
      "credentials": {
        "apiKey": "sk-...",
        "organizationId": "org-..."
      },
      "version": "gpt-4-1106-preview",
      "description": "Latest GPT-4 Turbo model with improved performance",
      "createdAt": "2024-03-15T10:30:00.000Z",
      "updatedAt": "2024-03-15T10:30:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 10,
    "total": 1,
    "totalPages": 1
  }
}
```

## GET /api/models/:id
Get model by ID with optional agents.

**Request:**
```http
GET /api/models/clm123abc456def789?includeAgents=true
```

**Response (200):**
```json
{
  "id": "clm123abc456def789",
  "userDefinedId": "gpt-4-turbo-001",
  "name": "GPT-4 Turbo",
  "provider": "openai",
  "credentials": {
    "apiKey": "sk-...",
    "organizationId": "org-..."
  },
  "version": "gpt-4-1106-preview",
  "description": "Latest GPT-4 Turbo model with improved performance",
  "agents": [
    {
      "id": "cla123abc456def789",
      "userDefinedId": "bug-analyzer-agent-001",
      "name": "Bug Analyzer Agent",
      "scope": "bug-analysis"
    }
  ],
  "createdAt": "2024-03-15T10:30:00.000Z",
  "updatedAt": "2024-03-15T10:30:00.000Z"
}
```

## GET /api/models/user-defined/:userDefinedId
Get model by user-defined ID.

**Request:**
```http
GET /api/models/user-defined/gpt-4-turbo-001
```

**Response (200):**
```json
{
  "id": "clm123abc456def789",
  "userDefinedId": "gpt-4-turbo-001",
  "name": "GPT-4 Turbo",
  "provider": "openai",
  "credentials": {
    "apiKey": "sk-...",
    "organizationId": "org-..."
  },
  "version": "gpt-4-1106-preview",
  "description": "Latest GPT-4 Turbo model with improved performance",
  "createdAt": "2024-03-15T10:30:00.000Z",
  "updatedAt": "2024-03-15T10:30:00.000Z"
}
```

## PUT /api/models/:id
Update a model.

**Request:**
```http
PUT /api/models/clm123abc456def789
Content-Type: application/json

{
  "description": "Updated GPT-4 Turbo model with enhanced capabilities",
  "version": "gpt-4-1106-preview-updated"
}
```

**Response (200):**
```json
{
  "id": "clm123abc456def789",
  "userDefinedId": "gpt-4-turbo-001",
  "name": "GPT-4 Turbo",
  "provider": "openai",
  "credentials": {
    "apiKey": "sk-...",
    "organizationId": "org-..."
  },
  "version": "gpt-4-1106-preview-updated",
  "description": "Updated GPT-4 Turbo model with enhanced capabilities",
  "createdAt": "2024-03-15T10:30:00.000Z",
  "updatedAt": "2024-03-15T11:30:00.000Z"
}
```

## GET /api/models/provider/:provider
Get models by provider.

**Request:**
```http
GET /api/models/provider/openai
```

**Response (200):**
```json
[
  {
    "id": "clm123abc456def789",
    "userDefinedId": "gpt-4-turbo-001",
    "name": "GPT-4 Turbo",
    "provider": "openai",
    "credentials": {
      "apiKey": "sk-...",
      "organizationId": "org-..."
    },
    "version": "gpt-4-1106-preview",
    "description": "Latest GPT-4 Turbo model with improved performance",
    "createdAt": "2024-03-15T10:30:00.000Z",
    "updatedAt": "2024-03-15T10:30:00.000Z"
  }
]
```

---

# Tool APIs

## POST /api/tools
Create a new tool.

**Request:**
```http
POST /api/tools
Content-Type: application/json

{
  "name": "code-analyzer",
  "description": "Static code analysis tool for bug detection",
  "version": "1.2.0",
  "status": "enabled",
  "configuration": {
    "maxFileSize": "10MB",
    "supportedLanguages": ["javascript", "typescript", "python"]
  }
}
```

**Response (201):**
```json
{
  "id": "clt123abc456def789",
  "name": "code-analyzer",
  "description": "Static code analysis tool for bug detection",
  "version": "1.2.0",
  "status": "enabled",
  "configuration": {
    "maxFileSize": "10MB",
    "supportedLanguages": ["javascript", "typescript", "python"]
  },
  "createdAt": "2024-03-15T10:30:00.000Z",
  "updatedAt": "2024-03-15T10:30:00.000Z"
}
```

## GET /api/tools
Get all tools with pagination and filtering.

**Request:**
```http
GET /api/tools?page=1&pageSize=10&status=enabled&search=analyzer
```

**Response (200):**
```json
{
  "data": [
    {
      "id": "clt123abc456def789",
      "name": "code-analyzer",
      "description": "Static code analysis tool for bug detection",
      "version": "1.2.0",
      "status": "enabled",
      "configuration": {
        "maxFileSize": "10MB",
        "supportedLanguages": ["javascript", "typescript", "python"]
      },
      "createdAt": "2024-03-15T10:30:00.000Z",
      "updatedAt": "2024-03-15T10:30:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 10,
    "total": 1,
    "totalPages": 1
  }
}
```

## GET /api/tools/:id
Get tool by ID with optional agents.

**Request:**
```http
GET /api/tools/clt123abc456def789?includeAgents=true
```

**Response (200):**
```json
{
  "id": "clt123abc456def789",
  "name": "code-analyzer",
  "description": "Static code analysis tool for bug detection",
  "version": "1.2.0",
  "status": "enabled",
  "configuration": {
    "maxFileSize": "10MB",
    "supportedLanguages": ["javascript", "typescript", "python"]
  },
  "agents": [
    {
      "id": "cla123abc456def789",
      "name": "Bug Analyzer Agent",
      "scope": "bug-analysis"
    }
  ],
  "createdAt": "2024-03-15T10:30:00.000Z",
  "updatedAt": "2024-03-15T10:30:00.000Z"
}
```

## GET /api/tools/name/:name
Get tool by name.

**Request:**
```http
GET /api/tools/name/code-analyzer
```

**Response (200):**
```json
{
  "id": "clt123abc456def789",
  "name": "code-analyzer",
  "description": "Static code analysis tool for bug detection",
  "version": "1.2.0",
  "status": "enabled",
  "configuration": {
    "maxFileSize": "10MB",
    "supportedLanguages": ["javascript", "typescript", "python"]
  },
  "createdAt": "2024-03-15T10:30:00.000Z",
  "updatedAt": "2024-03-15T10:30:00.000Z"
}
```

## PUT /api/tools/:id
Update a tool.

**Request:**
```http
PUT /api/tools/clt123abc456def789
Content-Type: application/json

{
  "description": "Enhanced static code analysis tool with improved bug detection",
  "version": "1.3.0",
  "configuration": {
    "maxFileSize": "20MB",
    "supportedLanguages": ["javascript", "typescript", "python", "java", "go"]
  }
}
```

**Response (200):**
```json
{
  "id": "clt123abc456def789",
  "name": "code-analyzer",
  "description": "Enhanced static code analysis tool with improved bug detection",
  "version": "1.3.0",
  "status": "enabled",
  "configuration": {
    "maxFileSize": "20MB",
    "supportedLanguages": ["javascript", "typescript", "python", "java", "go"]
  },
  "createdAt": "2024-03-15T10:30:00.000Z",
  "updatedAt": "2024-03-15T11:30:00.000Z"
}
```

## GET /api/tools/enabled
Get only enabled tools.

**Request:**
```http
GET /api/tools/enabled
```

**Response (200):**
```json
[
  {
    "id": "clt123abc456def789",
    "name": "code-analyzer",
    "description": "Static code analysis tool for bug detection",
    "version": "1.2.0",
    "status": "enabled",
    "configuration": {
      "maxFileSize": "10MB",
      "supportedLanguages": ["javascript", "typescript", "python"]
    },
    "createdAt": "2024-03-15T10:30:00.000Z",
    "updatedAt": "2024-03-15T10:30:00.000Z"
  }
]
```

---

# Agent-Tools Mapping APIs

## POST /api/agent-tools-mappings
Create a new agent-tool mapping.

**Request:**
```http
POST /api/agent-tools-mappings
Content-Type: application/json

{
  "agent": "cla123abc456def789",
  "tool": "clt123abc456def789",
  "status": "enabled",
  "configuration": {
    "autoExecute": true,
    "maxRetries": 3
  }
}
```

**Response (201):**
```json
{
  "id": "clat123abc456def789",
  "agentId": "cla123abc456def789",
  "toolId": "clt123abc456def789",
  "status": "enabled",
  "configuration": {
    "autoExecute": true,
    "maxRetries": 3
  },
  "createdAt": "2024-03-15T10:30:00.000Z",
  "updatedAt": "2024-03-15T10:30:00.000Z"
}
```

## GET /api/agent-tools-mappings
Get all mappings with pagination and filtering.

**Request:**
```http
GET /api/agent-tools-mappings?page=1&pageSize=10&agentId=cla123abc456def789&status=enabled
```

**Response (200):**
```json
{
  "data": [
    {
      "id": "clat123abc456def789",
      "agentId": "cla123abc456def789",
      "toolId": "clt123abc456def789",
      "status": "enabled",
      "configuration": {
        "autoExecute": true,
        "maxRetries": 3
      },
      "createdAt": "2024-03-15T10:30:00.000Z",
      "updatedAt": "2024-03-15T10:30:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 10,
    "total": 1,
    "totalPages": 1
  }
}
```

## GET /api/agent-tools-mappings/:id
Get mapping by ID.

**Request:**
```http
GET /api/agent-tools-mappings/clat123abc456def789
```

**Response (200):**
```json
{
  "id": "clat123abc456def789",
  "agentId": "cla123abc456def789",
  "toolId": "clt123abc456def789",
  "status": "enabled",
  "configuration": {
    "autoExecute": true,
    "maxRetries": 3
  },
  "createdAt": "2024-03-15T10:30:00.000Z",
  "updatedAt": "2024-03-15T10:30:00.000Z"
}
```

## PUT /api/agent-tools-mappings/:id
Update a mapping.

**Request:**
```http
PUT /api/agent-tools-mappings/clat123abc456def789
Content-Type: application/json

{
  "status": "disabled",
  "configuration": {
    "autoExecute": false,
    "maxRetries": 1
  }
}
```

**Response (200):**
```json
{
  "id": "clat123abc456def789",
  "agentId": "cla123abc456def789",
  "toolId": "clt123abc456def789",
  "status": "disabled",
  "configuration": {
    "autoExecute": false,
    "maxRetries": 1
  },
  "createdAt": "2024-03-15T10:30:00.000Z",
  "updatedAt": "2024-03-15T11:30:00.000Z"
}
```

## GET /api/agent-tools-mappings/agent/:agentId
Get mappings by agent ID.

**Request:**
```http
GET /api/agent-tools-mappings/agent/cla123abc456def789
```

**Response (200):**
```json
[
  {
    "id": "clat123abc456def789",
    "agentId": "cla123abc456def789",
    "toolId": "clt123abc456def789",
    "status": "enabled",
    "configuration": {
      "autoExecute": true,
      "maxRetries": 3
    },
    "createdAt": "2024-03-15T10:30:00.000Z",
    "updatedAt": "2024-03-15T10:30:00.000Z"
  }
]
```

## POST /api/agent-tools-mappings/agent/:agentId/tool/:toolId/enable
Enable a tool for an agent.

**Request:**
```http
POST /api/agent-tools-mappings/agent/cla123abc456def789/tool/clt456def789abc123/enable
```

**Response (200):**
```json
{
  "id": "clat456def789abc123",
  "agentId": "cla123abc456def789",
  "toolId": "clt456def789abc123",
  "status": "enabled",
  "configuration": null,
  "createdAt": "2024-03-15T11:00:00.000Z",
  "updatedAt": "2024-03-15T11:00:00.000Z"
}
```

## POST /api/agent-tools-mappings/agent/:agentId/tool/:toolId/disable
Disable a tool for an agent.

**Request:**
```http
POST /api/agent-tools-mappings/agent/cla123abc456def789/tool/clt456def789abc123/disable
```

**Response (200):**
```json
{
  "id": "clat456def789abc123",
  "agentId": "cla123abc456def789",
  "toolId": "clt456def789abc123",
  "status": "disabled",
  "configuration": null,
  "createdAt": "2024-03-15T11:00:00.000Z",
  "updatedAt": "2024-03-15T11:05:00.000Z"
}
```

## GET /api/agent-tools-mappings/agent/:agentId/details
Get mappings with full details for an agent.

**Request:**
```http
GET /api/agent-tools-mappings/agent/cla123abc456def789/details
```

**Response (200):**
```json
[
  {
    "id": "clat123abc456def789",
    "agentId": "cla123abc456def789",
    "toolId": "clt123abc456def789",
    "status": "enabled",
    "configuration": {
      "autoExecute": true,
      "maxRetries": 3
    },
    "agent": {
      "id": "cla123abc456def789",
      "name": "Bug Analyzer Agent",
      "scope": "bug-analysis"
    },
    "tool": {
      "id": "clt123abc456def789",
      "name": "code-analyzer",
      "description": "Static code analysis tool for bug detection",
      "version": "1.2.0"
    },
    "createdAt": "2024-03-15T10:30:00.000Z",
    "updatedAt": "2024-03-15T10:30:00.000Z"
  }
]
```

## GET /api/agent-tools-mappings/enabled
Get enabled mappings only.

**Request:**
```http
GET /api/agent-tools-mappings/enabled
```

**Response (200):**
```json
[
  {
    "id": "clat123abc456def789",
    "agentId": "cla123abc456def789",
    "toolId": "clt123abc456def789",
    "status": "enabled",
    "configuration": {
      "autoExecute": true,
      "maxRetries": 3
    },
    "createdAt": "2024-03-15T10:30:00.000Z",
    "updatedAt": "2024-03-15T10:30:00.000Z"
  }
]
```

---

# Error Responses

## Common Error Codes

**400 Bad Request:**
```json
{
  "error": "Missing required fields: title is required"
}
```

**404 Not Found:**
```json
{
  "error": "Ticket not found"
}
```

**409 Conflict:**
```json
{
  "error": "A ticket with this title already exists. Please use a different title.",
  "code": "DUPLICATE_TITLE"
}
```

**500 Internal Server Error:**
```json
{
  "error": "Internal server error"
}
```

**503 Service Unavailable:**
```json
{
  "success": false,
  "error": "Service not ready",
  "data": {
    "database": {
      "connected": false,
      "healthy": false
    }
  },
  "timestamp": "2024-03-15T10:30:00.000Z"
}
```