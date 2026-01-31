/**
 * Python Client Code Generator
 * Generates typed Python client from Prisma DMMF
 *
 * Usage: npx tsx scripts/generate-python-client.ts
 */

import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

interface DMMFField {
  name: string
  kind: 'scalar' | 'object' | 'enum' | 'unsupported'
  isList: boolean
  isRequired: boolean
  isUnique: boolean
  isId: boolean
  type: string
  hasDefaultValue: boolean
  default?: unknown
}

interface DMMFModel {
  name: string
  dbName: string | null
  fields: DMMFField[]
}

interface DMMFEnumValue {
  name: string
  dbName: string | null
}

interface DMMFEnum {
  name: string
  values: DMMFEnumValue[]
}

interface ExtractedDMMF {
  models: DMMFModel[]
  enums: DMMFEnum[]
}

// Map Prisma types to Python types
const PRISMA_TO_PYTHON_TYPE: Record<string, string> = {
  String: 'str',
  Int: 'int',
  Float: 'float',
  Boolean: 'bool',
  DateTime: 'datetime',
  Json: 'Dict[str, Any]',
  BigInt: 'int',
  Decimal: 'float',
  Bytes: 'bytes',
}

// Python reserved keywords that need to be escaped
const PYTHON_RESERVED_KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await',
  'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except',
  'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is',
  'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try',
  'while', 'with', 'yield', 'type'
])

// Escape Python reserved keywords by adding underscore suffix
function escapePythonKeyword(name: string): string {
  if (PYTHON_RESERVED_KEYWORDS.has(name) || PYTHON_RESERVED_KEYWORDS.has(name.toLowerCase())) {
    return `${name}_`
  }
  return name
}

// Convert PascalCase to snake_case
function toSnakeCase(str: string): string {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '')
}

// Convert PascalCase to camelCase (first letter lowercase)
function toCamelCase(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1)
}

// Convert snake_case to PascalCase
function toPascalCase(str: string): string {
  return str
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')
}

function getPythonType(field: DMMFField, enums: Set<string>): string {
  let pyType: string

  if (field.kind === 'enum') {
    pyType = field.type
  } else if (field.kind === 'scalar') {
    pyType = PRISMA_TO_PYTHON_TYPE[field.type] || 'Any'
  } else {
    pyType = 'Any'
  }

  if (field.isList) {
    pyType = `List[${pyType}]`
  }

  if (!field.isRequired) {
    pyType = `Optional[${pyType}]`
  }

  return pyType
}

function generateEnumsFile(enums: DMMFEnum[]): string {
  const lines: string[] = [
    '"""',
    'Auto-generated Enums from Prisma Schema',
    'DO NOT EDIT MANUALLY',
    '"""',
    '',
    'from enum import Enum',
    '',
    '',
  ]

  for (const enumDef of enums) {
    lines.push(`class ${enumDef.name}(str, Enum):`)
    lines.push(`    """${enumDef.name} enum from Prisma schema"""`)
    for (const value of enumDef.values) {
      lines.push(`    ${value.name} = "${value.name}"`)
    }
    lines.push('')
    lines.push('')
  }

  return lines.join('\n')
}

function generateModelsFile(models: DMMFModel[], enums: Set<string>): string {
  const lines: string[] = [
    '"""',
    'Auto-generated Pydantic Models from Prisma Schema',
    'DO NOT EDIT MANUALLY',
    '"""',
    '',
    'from datetime import datetime',
    'from typing import Any, Dict, List, Optional',
    'from pydantic import BaseModel, Field',
    '',
    'from .enums import *',
    '',
    '',
  ]

  for (const model of models) {
    // Only include scalar and enum fields (skip relations)
    const scalarFields = model.fields.filter((f) => f.kind === 'scalar' || f.kind === 'enum')

    lines.push(`class ${model.name}(BaseModel):`)
    lines.push(`    """${model.name} model from Prisma schema"""`)
    lines.push(`    model_config = {"populate_by_name": True}`)
    lines.push('')

    if (scalarFields.length === 0) {
      lines.push('    pass')
    } else {
      for (const field of scalarFields) {
        const pyType = getPythonType(field, enums)
        // Keep original camelCase field names, only escape Python reserved keywords
        const fieldName = escapePythonKeyword(field.name)
        const isEscaped = fieldName !== field.name

        if (isEscaped) {
          // Use Field with alias for reserved keywords
          if (field.isRequired) {
            lines.push(`    ${fieldName}: ${pyType} = Field(alias="${field.name}")`)
          } else {
            lines.push(`    ${fieldName}: ${pyType} = Field(default=None, alias="${field.name}")`)
          }
        } else {
          const defaultValue = !field.isRequired ? ' = None' : ''
          lines.push(`    ${fieldName}: ${pyType}${defaultValue}`)
        }
      }
    }

    lines.push('')
    lines.push('')
  }

  return lines.join('\n')
}

function generateTypesFile(models: DMMFModel[], enums: Set<string>): string {
  const lines: string[] = [
    '"""',
    'Auto-generated Type Definitions for Query Inputs',
    'DO NOT EDIT MANUALLY',
    '"""',
    '',
    'from datetime import datetime',
    'from typing import Any, Dict, List, Literal, Optional, TypedDict, Union',
    '',
    'from .enums import *',
    '',
    '',
    '# String filter operations',
    'class StringFilter(TypedDict, total=False):',
    '    equals: str',
    '    contains: str',
    '    startsWith: str',
    '    endsWith: str',
    '    in_: List[str]  # "in" is reserved in Python, use in_',
    '    notIn: List[str]',
    '    not_: str  # "not" is reserved in Python, use not_',
    '',
    '',
    '# Int filter operations',
    'class IntFilter(TypedDict, total=False):',
    '    equals: int',
    '    gt: int',
    '    gte: int',
    '    lt: int',
    '    lte: int',
    '    in_: List[int]',
    '    notIn: List[int]',
    '    not_: int',
    '',
    '',
    '# DateTime filter operations',
    'class DateTimeFilter(TypedDict, total=False):',
    '    equals: datetime',
    '    gt: datetime',
    '    gte: datetime',
    '    lt: datetime',
    '    lte: datetime',
    '    not_: datetime',
    '',
    '',
    '# Boolean filter',
    'class BoolFilter(TypedDict, total=False):',
    '    equals: bool',
    '    not_: bool',
    '',
    '',
    '# Sort order',
    'SortOrder = Literal["asc", "desc"]',
    '',
    '',
  ]

  // Generate WhereInput and OrderBy for each model
  for (const model of models) {
    const scalarFields = model.fields.filter((f) => f.kind === 'scalar' || f.kind === 'enum')

    // WhereInput
    lines.push(`class ${model.name}WhereInput(TypedDict, total=False):`)
    lines.push(`    """Where filter for ${model.name}"""`)

    for (const field of scalarFields) {
      const fieldName = escapePythonKeyword(field.name)

      if (field.kind === 'enum') {
        lines.push(`    ${fieldName}: Union[${field.type}, List[${field.type}]]`)
      } else if (field.type === 'String') {
        lines.push(`    ${fieldName}: Union[str, StringFilter]`)
      } else if (field.type === 'Int' || field.type === 'BigInt') {
        lines.push(`    ${fieldName}: Union[int, IntFilter]`)
      } else if (field.type === 'DateTime') {
        lines.push(`    ${fieldName}: Union[datetime, DateTimeFilter]`)
      } else if (field.type === 'Boolean') {
        lines.push(`    ${fieldName}: Union[bool, BoolFilter]`)
      } else {
        lines.push(`    ${fieldName}: Any`)
      }
    }

    // Add AND/OR/NOT
    lines.push(`    AND: List['${model.name}WhereInput']`)
    lines.push(`    OR: List['${model.name}WhereInput']`)
    lines.push(`    NOT: '${model.name}WhereInput'`)
    lines.push('')
    lines.push('')

    // OrderBy
    lines.push(`class ${model.name}OrderBy(TypedDict, total=False):`)
    lines.push(`    """Order by for ${model.name}"""`)

    for (const field of scalarFields) {
      const fieldName = escapePythonKeyword(field.name)
      lines.push(`    ${fieldName}: SortOrder`)
    }
    lines.push('')
    lines.push('')
  }

  return lines.join('\n')
}

function generateClientFile(models: DMMFModel[]): string {
  const lines: string[] = [
    '"""',
    'Xyne Query Client',
    'Typed Python client for querying Xyne database',
    '"""',
    '',
    'from dataclasses import dataclass, field',
    'from typing import Any, Dict, Generic, List, Optional, Type, TypeVar',
    '',
    'import requests',
    '',
    'from .models import *',
    'from .types import *',
    '',
    '',
    'T = TypeVar("T")',
    '',
    '',
    '@dataclass',
    'class QueryAST:',
    '    """AST representation of a query"""',
    '    model: str',
    '    operation: str = "findMany"',
    '    where: Optional[Dict[str, Any]] = None',
    '    orderBy: Optional[List[Dict[str, str]]] = None',
    '    take: Optional[int] = None',
    '    skip: Optional[int] = None',
    '',
    '    def to_dict(self) -> Dict[str, Any]:',
    '        result = {"model": self.model, "operation": self.operation}',
    '        if self.where:',
    '            result["where"] = self._convert_where(self.where)',
    '        if self.orderBy:',
    '            result["orderBy"] = self.orderBy',
    '        if self.take is not None:',
    '            result["take"] = self.take',
    '        if self.skip is not None:',
    '            result["skip"] = self.skip',
    '        return result',
    '',
    '    def _convert_where(self, where: Dict[str, Any]) -> Dict[str, Any]:',
    '        """Convert Python naming (in_) to Prisma naming (in)"""',
    '        result = {}',
    '        for key, value in where.items():',
    '            if isinstance(value, dict):',
    '                result[key] = self._convert_where(value)',
    '            elif key == "in_":',
    '                result["in"] = value',
    '            elif key == "not_in":',
    '                result["notIn"] = value',
    '            elif key == "not_":',
    '                result["not"] = value',
    '            elif key == "starts_with":',
    '                result["startsWith"] = value',
    '            elif key == "ends_with":',
    '                result["endsWith"] = value',
    '            else:',
    '                result[key] = value',
    '        return result',
    '',
    '',
    'class QueryBuilder(Generic[T]):',
    '    """Fluent query builder"""',
    '',
    '    def __init__(self, model_name: str, model_class: Type[T], client: "XyneClient"):',
    '        self._model_name = model_name',
    '        self._model_class = model_class',
    '        self._client = client',
    '        self._where: Optional[Dict[str, Any]] = None',
    '        self._orderBy: List[Dict[str, str]] = []',
    '        self._take: Optional[int] = None',
    '        self._skip: Optional[int] = None',
    '',
    '    def where(self, conditions: Dict[str, Any]) -> "QueryBuilder[T]":',
    '        """Add where conditions"""',
    '        self._where = conditions',
    '        return self',
    '',
    '    def order_by(self, *orderings: Dict[str, str]) -> "QueryBuilder[T]":',
    '        """Add order by clauses"""',
    '        self._orderBy = list(orderings)',
    '        return self',
    '',
    '    def take(self, limit: int) -> "QueryBuilder[T]":',
    '        """Limit number of results"""',
    '        self._take = limit',
    '        return self',
    '',
    '    def skip(self, offset: int) -> "QueryBuilder[T]":',
    '        """Skip number of results"""',
    '        self._skip = offset',
    '        return self',
    '',
    '    def _build_ast(self) -> QueryAST:',
    '        """Build the query AST"""',
    '        return QueryAST(',
    '            model=self._model_name,',
    '            where=self._where,',
    '            orderBy=self._orderBy if self._orderBy else None,',
    '            take=self._take,',
    '            skip=self._skip,',
    '        )',
    '',
    '    def execute(self) -> List[T]:',
    '        """Execute the query and return typed results"""',
    '        ast = self._build_ast()',
    '        data = self._client._execute(ast)',
    '        return [self._model_class(**row) for row in data]',
    '',
    '    def count(self) -> int:',
    '        """Count matching records"""',
    '        ast = QueryAST(',
    '            model=self._model_name,',
    '            operation="count",',
    '            where=self._where,',
    '        )',
    '        return self._client._execute(ast)',
    '',
    '',
  ]

  // Generate typed query builders for each model
  for (const model of models) {
    const camelName = toCamelCase(model.name)
    lines.push(`class ${model.name}Query(QueryBuilder[${model.name}]):`)
    lines.push(`    """Typed query builder for ${model.name}"""`)
    lines.push('')
    lines.push(`    def __init__(self, client: "XyneClient"):`)
    lines.push(`        super().__init__("${camelName}", ${model.name}, client)`)
    lines.push('')
    lines.push(`    def where(self, conditions: ${model.name}WhereInput) -> "${model.name}Query":`)
    lines.push(`        """Add typed where conditions"""`)
    lines.push(`        return super().where(conditions)  # type: ignore`)
    lines.push('')
    lines.push(`    def order_by(self, *orderings: ${model.name}OrderBy) -> "${model.name}Query":`)
    lines.push(`        """Add typed order by clauses"""`)
    lines.push(`        return super().order_by(*orderings)  # type: ignore`)
    lines.push('')
    lines.push('')
  }

  // Generate XyneClient
  lines.push('class XyneClient:')
  lines.push('    """')
  lines.push('    Xyne Query Client - Electron Edition')
  lines.push('')
  lines.push('    Connects to Electron app for authentication and proxies queries to backend.')
  lines.push('    Token is cached in memory for the lifetime of the client object.')
  lines.push('')
  lines.push('    Usage:')
  lines.push('        # Context manager (recommended)')
  lines.push('        with XyneClient("my-agent", "Fetch tickets for analysis") as client:')
  lines.push('            tickets = client.ticket.where({"status": "OPEN"}).take(10).execute()')
  lines.push('')
  lines.push('        # Manual lifecycle')
  lines.push('        client = XyneClient("my-agent", "Description")')
  lines.push('        tickets = client.ticket.execute()  # Auto-authenticates on first query')
  lines.push('        client.release()  # Release token when done')
  lines.push('    """')
  lines.push('')
  lines.push('    def __init__(')
  lines.push('        self,')
  lines.push('        agent_name: str,')
  lines.push('        agent_description: str = "",')
  lines.push('        base_url: str = "http://127.0.0.1:49231",')
  lines.push('        timeout: int = 60,')
  lines.push('    ):')
  lines.push('        self._agent_name = agent_name')
  lines.push('        self._agent_description = agent_description')
  lines.push('        self._base_url = base_url.rstrip("/")')
  lines.push('        self._timeout = timeout')
  lines.push('        self._token: Optional[str] = None')
  lines.push('        self._authenticated: bool = False')
  lines.push('        self._auth_failed: bool = False  # Prevents re-auth loop after 401')
  lines.push('')

  // Add property for each model
  for (const model of models) {
    const camelName = toCamelCase(model.name)
    lines.push(`    @property`)
    lines.push(`    def ${camelName}(self) -> ${model.name}Query:`)
    lines.push(`        """Query ${model.name} table"""`)
    lines.push(`        return ${model.name}Query(self)`)
    lines.push('')
  }

  lines.push('    def _authenticate(self) -> None:')
  lines.push('        """Request authorization from Electron app, cache token in memory"""')
  lines.push('        if self._authenticated and self._token:')
  lines.push('            return')
  lines.push('        try:')
  lines.push('            response = requests.post(')
  lines.push('                f"{self._base_url}/auth/request",')
  lines.push('                json={')
  lines.push('                    "agentName": self._agent_name,')
  lines.push('                    "agentType": "python-script",')
  lines.push('                    "description": self._agent_description')
  lines.push('                },')
  lines.push('                timeout=self._timeout,')
  lines.push('            )')
  lines.push('            data = response.json()')
  lines.push('            if data.get("status") == "approved":')
  lines.push('                self._token = data["accessToken"]')
  lines.push('                self._authenticated = True')
  lines.push('            else:')
  lines.push('                from .exceptions import AuthorizationDeniedError')
  lines.push('                raise AuthorizationDeniedError(f"Access denied: {data.get(\'reason\', \'User denied\')}")')
  lines.push('        except requests.exceptions.ConnectionError:')
  lines.push('            from .exceptions import ElectronNotRunningError')
  lines.push('            raise ElectronNotRunningError(f"Cannot connect to Electron app at {self._base_url}")')
  lines.push('')
  lines.push('    def _execute(self, ast: QueryAST) -> Any:')
  lines.push('        """Execute query via Electron /interact endpoint"""')
  lines.push('        # If auth already failed with 401, don\'t try again')
  lines.push('        if self._auth_failed:')
  lines.push('            from .exceptions import AuthorizationDeniedError')
  lines.push('            raise AuthorizationDeniedError("Authentication failed. Please log in to Electron app first.")')
  lines.push('')
  lines.push('        if not self._authenticated:')
  lines.push('            self._authenticate()')
  lines.push('')
  lines.push('        response = requests.post(')
  lines.push('            f"{self._base_url}/interact",')
  lines.push('            json=ast.to_dict(),')
  lines.push('            headers={')
  lines.push('                "Authorization": f"Bearer {self._token}",')
  lines.push('                "Content-Type": "application/json"')
  lines.push('            },')
  lines.push('            timeout=self._timeout,')
  lines.push('        )')
  lines.push('')
  lines.push('        # Handle token expiry - retry once with re-authentication')
  lines.push('        if response.status_code == 401 and not self._auth_failed:')
  lines.push('            self._authenticated = False')
  lines.push('            self._token = None')
  lines.push('            self._authenticate()')
  lines.push('            response = requests.post(')
  lines.push('                f"{self._base_url}/interact",')
  lines.push('                json=ast.to_dict(),')
  lines.push('                headers={')
  lines.push('                    "Authorization": f"Bearer {self._token}",')
  lines.push('                    "Content-Type": "application/json"')
  lines.push('                },')
  lines.push('                timeout=self._timeout,')
  lines.push('            )')
  lines.push('            # If still 401 after retry, mark auth as permanently failed')
  lines.push('            if response.status_code == 401:')
  lines.push('                self._auth_failed = True')
  lines.push('                from .exceptions import AuthorizationDeniedError')
  lines.push('                raise AuthorizationDeniedError("Authentication failed after retry. Please log in to Electron app first.")')
  lines.push('')
  lines.push('        response.raise_for_status()')
  lines.push('        result = response.json()')
  lines.push('        if "error" in result:')
  lines.push('            raise Exception(result["error"])')
  lines.push('        return result.get("data", result)')
  lines.push('')
  lines.push('    def release(self) -> None:')
  lines.push('        """Release authorization session and clear cached token"""')
  lines.push('        if self._token:')
  lines.push('            try:')
  lines.push('                requests.post(')
  lines.push('                    f"{self._base_url}/auth/release",')
  lines.push('                    headers={"Authorization": f"Bearer {self._token}"},')
  lines.push('                    timeout=5,')
  lines.push('                )')
  lines.push('            except Exception:')
  lines.push('                pass  # Best effort cleanup')
  lines.push('            self._token = None')
  lines.push('            self._authenticated = False')
  lines.push('')
  lines.push('    def __enter__(self) -> "XyneClient":')
  lines.push('        """Context manager entry"""')
  lines.push('        return self')
  lines.push('')
  lines.push('    def __exit__(self, *args) -> None:')
  lines.push('        """Context manager exit - release token"""')
  lines.push('        self.release()')
  lines.push('')
  lines.push('    def __del__(self) -> None:')
  lines.push('        """Destructor - release token on garbage collection"""')
  lines.push('        self.release()')
  lines.push('')

  return lines.join('\n')
}

function generateInitFile(): string {
  return `"""
Xyne Query - Python client for Xyne database queries

Connects to Electron app for authentication and proxies queries to backend.
"""

from .client import XyneClient, QueryBuilder, QueryAST
from .models import *
from .enums import *
from .types import *
from .exceptions import (
    XyneQueryError,
    ValidationError,
    AuthenticationError,
    AuthorizationError,
    AuthorizationDeniedError,
    ElectronNotRunningError,
    TokenExpiredError,
    ConnectionError,
)

__version__ = "0.1.0"
__all__ = [
    "XyneClient",
    "QueryBuilder",
    "QueryAST",
    "XyneQueryError",
    "ValidationError",
    "AuthenticationError",
    "AuthorizationError",
    "AuthorizationDeniedError",
    "ElectronNotRunningError",
    "TokenExpiredError",
    "ConnectionError",
]
`
}

function generateExceptionsFile(): string {
  return `"""
Custom exceptions for Xyne Query client
"""


class XyneQueryError(Exception):
    """Base exception for Xyne Query errors"""
    pass


class ValidationError(XyneQueryError):
    """Query validation failed"""
    pass


class AuthenticationError(XyneQueryError):
    """Authentication failed"""
    pass


class AuthorizationError(XyneQueryError):
    """Authorization/ACL check failed"""
    pass


class AuthorizationDeniedError(XyneQueryError):
    """User denied authorization request in Electron consent dialog"""
    pass


class ElectronNotRunningError(XyneQueryError):
    """Cannot connect to Electron app - ensure it is running"""
    pass


class TokenExpiredError(XyneQueryError):
    """Authorization token has expired"""
    pass


class ConnectionError(XyneQueryError):
    """Failed to connect to backend"""
    pass
`
}

function generatePyProjectToml(): string {
  return `[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "xyne-query"
version = "0.1.0"
description = "Python client for querying Xyne database"
readme = "README.md"
license = "MIT"
requires-python = ">=3.9"
authors = [
    { name = "Xyne Team" }
]
classifiers = [
    "Development Status :: 3 - Alpha",
    "Intended Audience :: Developers",
    "License :: OSI Approved :: MIT License",
    "Programming Language :: Python :: 3",
    "Programming Language :: Python :: 3.9",
    "Programming Language :: Python :: 3.10",
    "Programming Language :: Python :: 3.11",
    "Programming Language :: Python :: 3.12",
    "Typing :: Typed",
]
dependencies = [
    "pydantic>=2.0.0",
    "requests>=2.28.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.0.0",
    "pytest-asyncio>=0.21.0",
    "mypy>=1.0.0",
    "black>=23.0.0",
    "ruff>=0.1.0",
    "responses>=0.23.0",
]

[tool.hatch.build.targets.wheel]
packages = ["xyne_query"]

[tool.mypy]
python_version = "3.9"
strict = true
warn_return_any = true
warn_unused_configs = true

[tool.ruff]
line-length = 100
target-version = "py39"

[tool.black]
line-length = 100
target-version = ["py39"]
`
}

function generateReadme(): string {
  return `# Xyne Query

Python client for querying Xyne database with type safety and ACL enforcement.

## Installation

\`\`\`bash
pip install xyne-query
\`\`\`

## Usage

\`\`\`python
from xyne_query import XyneClient

# Initialize client
client = XyneClient(
    api_url="https://api.xyne.io",
    api_key="your-api-key"
)

# Query tickets with type safety
tickets = client.tickets \\
    .where({"status": "OPEN", "priority": {"in_": ["HIGH", "CRITICAL"]}}) \\
    .order_by({"createdAt": "desc"}) \\
    .take(50) \\
    .execute()

for ticket in tickets:
    print(f"{ticket.id}: {ticket.title} ({ticket.status})")

# Count records
open_count = client.tickets.where({"status": "OPEN"}).count()
print(f"Open tickets: {open_count}")

# Pagination
page_2 = client.tickets \\
    .where({"status": "OPEN"}) \\
    .order_by({"createdAt": "desc"}) \\
    .skip(50) \\
    .take(50) \\
    .execute()
\`\`\`

## Supported Operations

### Where Filters

- **Equality**: \`{"field": "value"}\`
- **In list**: \`{"field": {"in_": ["a", "b", "c"]}}\`
- **Not in**: \`{"field": {"notIn": ["x", "y"]}}\`
- **Contains**: \`{"field": {"contains": "substring"}}\`
- **Starts with**: \`{"field": {"startsWith": "prefix"}}\`
- **Ends with**: \`{"field": {"endsWith": "suffix"}}\`
- **Greater than**: \`{"field": {"gt": 10}}\`
- **Less than**: \`{"field": {"lt": 100}}\`
- **AND/OR**: \`{"AND": [{...}, {...}]}\`, \`{"OR": [{...}, {...}]}\`

### Order By

\`\`\`python
.order_by({"createdAt": "desc"}, {"title": "asc"})
\`\`\`

### Pagination

\`\`\`python
.take(50)  # Limit results
.skip(100) # Offset for pagination
\`\`\`

## Type Safety

All queries are fully typed. Your IDE will provide autocomplete for:
- Model fields in \`where\` conditions
- Valid sort fields in \`order_by\`
- Return type of \`execute()\`

## Development

\`\`\`bash
# Install dev dependencies
pip install -e ".[dev]"

# Run tests
pytest

# Type check
mypy xyne_query

# Format code
black xyne_query
ruff check xyne_query
\`\`\`

## License

MIT
`
}

// Parse CLI arguments
function parseArgs(): { outputDir: string; version: string } {
  const args = process.argv.slice(2)
  let outputDir = path.join(__dirname, '../../xyne-query')
  let version = '0.1.0'

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output-dir' && args[i + 1]) {
      outputDir = path.resolve(args[i + 1])
      i++
    } else if (args[i] === '--version' && args[i + 1]) {
      version = args[i + 1]
      i++
    }
  }

  return { outputDir, version }
}

async function main(): Promise<void> {
  const { outputDir: packageDir, version } = parseArgs()
  const dmmfPath = path.join(__dirname, '../prisma/dmmf.json')
  const outputDir = path.join(packageDir, 'xyne_query')

  console.log('📖 Reading DMMF from:', dmmfPath)
  console.log(`📦 Output directory: ${packageDir}`)
  console.log(`🏷️  Version: ${version}`)

  if (!fs.existsSync(dmmfPath)) {
    throw new Error(`DMMF file not found: ${dmmfPath}. Run extract-dmmf.ts first.`)
  }

  const dmmf: ExtractedDMMF = JSON.parse(fs.readFileSync(dmmfPath, 'utf-8'))
  const enumNames = new Set(dmmf.enums.map((e) => e.name))

  console.log(`🔄 Generating Python client for ${dmmf.models.length} models and ${dmmf.enums.length} enums...`)

  // Create output directories
  fs.mkdirSync(outputDir, { recursive: true })

  // Write VERSION file
  fs.writeFileSync(path.join(packageDir, 'VERSION'), version + '\n')
  console.log(`   ✅ Generated: VERSION`)

  // Generate files
  const files: Array<{ path: string; content: string }> = [
    { path: path.join(outputDir, 'enums.py'), content: generateEnumsFile(dmmf.enums) },
    { path: path.join(outputDir, 'models.py'), content: generateModelsFile(dmmf.models, enumNames) },
    { path: path.join(outputDir, 'types.py'), content: generateTypesFile(dmmf.models, enumNames) },
    { path: path.join(outputDir, 'client.py'), content: generateClientFile(dmmf.models) },
    { path: path.join(outputDir, '__init__.py'), content: generateInitFile() },
    { path: path.join(outputDir, 'exceptions.py'), content: generateExceptionsFile() },
  ]

  for (const file of files) {
    fs.writeFileSync(file.path, file.content)
    console.log(`   ✅ Generated: ${path.relative(packageDir, file.path)}`)
  }

  // Create empty tests directory
  const testsDir = path.join(packageDir, 'tests')
  fs.mkdirSync(testsDir, { recursive: true })
  if (!fs.existsSync(path.join(testsDir, '__init__.py'))) {
    fs.writeFileSync(path.join(testsDir, '__init__.py'), '')
  }

  console.log('')
  console.log('✅ Python client generated successfully!')
  console.log(`   📁 Output: ${packageDir}`)
  console.log('')
  console.log('📦 To install locally:')
  console.log(`   cd ${packageDir}`)
  console.log('   pip install -e ".[dev]"')
}

main().catch((error) => {
  console.error('❌ Failed to generate Python client:', error)
  process.exit(1)
})
