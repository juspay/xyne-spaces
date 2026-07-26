# Xyne Spaces

A comprehensive workflow automation platform that enables teams to create, manage, and execute complex workflows with AI-powered agents and intelligent automation.

## Overview

Xyne Spaces is a modern, scalable platform built with a TypeScript backend and React dashboard frontend. It provides powerful workflow automation capabilities, agent management, and real-time collaboration features.

## Features

### Core Platform
- **Workflow Automation**: Create and manage complex multi-step workflows
- **AI Agents**: Deploy and manage intelligent agents with various capabilities
- **Real-time Collaboration**: Live updates and multi-user support
- **Resource Management**: Efficient allocation and monitoring of system resources
- **Organization & Project Management**: Hierarchical structure with vision tracking

### Backend Capabilities
- **TypeScript/Express.js**: Type-safe, high-performance API server
- **Layered Architecture**: Clean separation of concerns
- **Health Monitoring**: Comprehensive health checks and monitoring
- **Security**: Built-in security features with rate limiting and CORS
- **Database Integration**: Prisma ORM with PostgreSQL
- **API Documentation**: Comprehensive REST API documentation

### Dashboard Features
- **React/TypeScript**: Modern, responsive frontend
- **Real-time UI**: Live updates with WebSocket connections
- **Rich Text Editing**: Advanced text editing with TipTap
- **File Management**: Support for multiple file formats
- **Interactive Workflows**: Visual workflow builder and editor
- **Component Library**: Built with Radix UI and Tailwind CSS

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Dashboard     │    │     Backend     │    │   Database      │
│   (React)       │◄──►│   (Express)     │◄──►│  (PostgreSQL)   │
│                 │    │                 │    │                 │
│ - UI Components │    │ - REST API      │    │ - Workflows     │
│ - State Mgmt    │    │ - WebSocket     │    │ - Agents        │
│ - Real-time     │    │ - Business Logic│    │ - Organizations │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Quick Start

### Prerequisites

- Node.js >= 18.0.0
- npm >= 8.0.0
- Docker (or OrbStack) with Docker Compose, or Podman with podman-compose

### Installation

1. **Clone the repository**:
```bash
git clone <repository-url>
cd xyne-spaces

```

2. **Install dependencies**:
```bash
# Install root dependencies
npm install

# Build shared package
cd shared && npm run build && cd ..

# Build icons package
cd icons && npm run build && cd ..

# Install backend dependencies
cd backend && npm install && cd ..

# Install dashboard dependencies
cd dashboard && npm install && cd ..

# Install xyne-claw-shared (shared dependency for claw services)
cd xyne-claw-shared && npm install && cd ..

# Install kata-sdk (dependency of xyne-claw-shared)
cd packages/kata-sdk && npm install && cd ..

# Install xyne-claw dependencies
cd xyne-claw && npm install && cd ..

# Install xyne-claw-auth backend dependencies
cd xyne-claw-auth/backend && npm install && cd ../..

# Install xyne-claw-auth frontend dependencies (optional)
cd xyne-claw-auth/frontend && npm install && cd ../..
```

3. **Start services**:
```bash
npm run services
```

This will:
- Start all infrastructure containers (PostgreSQL, Redis, LiveKit, Zero cache, fake-gcs, MinIO, etc.)
- Auto-create `.env.local` for backend and dashboard from `.env.example` if they don't exist
- Run database migrations and seed the ACL system
- Auto-create `.env` for `xyne-claw-auth/backend` and `xyne-claw` from their `.env.example` files
- Install dependencies for xyne-claw, xyne-claw-auth, xyne-claw-shared, and kata-sdk if needed
- Set up the claw-auth database schema, seed agents, link Spaces workspace to claw org, and create a dev admin user

4. **Start development servers**:
```bash
# Start backend (in one terminal)
cd backend && npm run dev

# Start dashboard (in another terminal)
cd dashboard && npm run dev

# Start XyneClaw agent server (in another terminal)
cd xyne-claw && npm run dev

# Start claw-auth backend (in another terminal)
cd xyne-claw-auth/backend && npm run dev

# Start claw-auth frontend (optional, in another terminal)
cd xyne-claw-auth/frontend && npm run dev
```

5. **Access the application**:
- Dashboard: http://localhost:5173
- Backend API: http://localhost:3001
- XyneClaw: http://localhost:3002
- Claw Auth: http://localhost:3003
- API Documentation: http://localhost:3001/api-docs

6. **Login**: The seed script creates a dev admin account using `DEFAULT_ADMIN_EMAIL` from `backend/.env.local` with password `xynelocal@123`. Email/password login is available at the login page — no OAuth setup required for local dev.

## Development Setup

### Backend

1. Navigate to the backend directory:
```bash
cd backend
```

2. Copy environment variables:
```bash
cp .env.example .env.local
```

3. Configure your environment variables in `.env.local`

4. Start the development server:
```bash
npm run dev
```

### Dashboard

1. Navigate to the dashboard directory:
```bash
cd dashboard
```

2. Start the development server:
```bash
npm run dev
```

The dashboard will automatically reload when you make changes.

### XyneClaw (Agent Server)

1. Navigate to the xyne-claw directory:
```bash
cd xyne-claw
```

2. Copy environment variables (auto-created by `npm run services`):
```bash
cp .env.example .env
```

3. Configure your environment variables in `.env`

4. Start the development server:
```bash
npm run dev
```

### Claw Auth (MCP Credential Management)

1. Navigate to the claw-auth backend directory:
```bash
cd xyne-claw-auth/backend
```

2. Copy environment variables (auto-created by `npm run services`):
```bash
cp .env.example .env
```

3. Configure your environment variables in `.env`

4. Start the development server:
```bash
npm run dev
```

5. (Optional) Start the claw-auth frontend:
```bash
cd ../frontend && npm run dev
```

## Project Structure

```
xyne-spaces/
├── backend/                 # TypeScript/Express.js API server
│   ├── src/
│   │   ├── config/         # Configuration files
│   │   ├── controllers/    # Route controllers
│   │   ├── middleware/     # Custom middleware
│   │   ├── routes/         # Route definitions
│   │   ├── services/       # Business logic
│   │   ├── types/          # TypeScript type definitions
│   │   ├── utils/          # Utility functions
│   │   └── validators/     # Request validation schemas
│   ├── tests/              # Test files
│   └── docs/               # Backend documentation
├── dashboard/              # React/TypeScript frontend
│   ├── src/
│   │   ├── components/     # Reusable UI components
│   │   ├── pages/          # Page components
│   │   ├── hooks/          # Custom React hooks
│   │   ├── services/       # API services
│   │   ├── types/          # TypeScript type definitions
│   │   └── utils/          # Utility functions
│   ├── public/             # Static assets
│   └── docs/               # Frontend documentation
├── xyne-claw/              # Multi-tenant agent orchestration server
│   ├── src/
│   └── scripts/
├── xyne-claw-auth/         # MCP credential management service
│   ├── backend/
│   │   ├── src/
│   │   └── prisma/
│   └── frontend/
├── xyne-claw-shared/       # Shared library for xyne-claw ecosystem
│   └── src/
├── packages/
│   └── kata-sdk/           # Kubernetes SDK for xyne-claw-shared
├── docker/                 # Docker configuration files
├── scripts/                # Build and deployment scripts
├── API_DOCUMENTATION.md    # Comprehensive API documentation
└── README.md              # This file
```

## Available Scripts

### Root Level
- `npm run services` - Start infrastructure services (Docker/OrbStack or Podman)
- `npm run services:stop` - Stop infrastructure services
- `npm run cleanup` - Clean up storage and containers

### Backend
- `npm run dev` - Start development server with hot reload
- `npm run build` - Build the application
- `npm start` - Start production server
- `npm test` - Run tests
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix ESLint issues
- `npm run format` - Format code with Prettier
- `npm run typecheck` - Run TypeScript type checking

### Dashboard
- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix ESLint issues
- `npm run typecheck` - Run TypeScript type checking
- `npm run format` - Format code with Prettier
- `npm run validate` - Run all validation checks

### XyneClaw
- `npm run dev` - Start agent server with hot reload
- `npm run typecheck` - Run TypeScript type checking

### Claw Auth
- `npm run dev` - Start auth backend with hot reload
- `npm run db:push` - Push database schema
- `npm run db:generate` - Generate Prisma client
- `npm run db:seed` - Seed database

## Documentation

- **[API Documentation](./API_DOCUMENTATION.md)** - Comprehensive REST API reference
- **[Backend README](./backend/README.md)** - Backend-specific documentation
- **[Dashboard README](./dashboard/README.md)** - Frontend-specific documentation

## Technology Stack

### Backend
- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL with Prisma ORM
- **Validation**: Joi
- **Testing**: Jest
- **Code Quality**: ESLint, Prettier, Husky

### Frontend
- **Framework**: React 19 with TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **UI Components**: Radix UI, Blend Design System
- **State Management**: React Query, XState
- **Rich Text**: TipTap
- **Testing**: ESLint, Prettier, Husky

### DevOps
- **Containerization**: Docker & Docker Compose
- **CI/CD**: Jenkins
- **Code Quality**: Husky git hooks
- **Monorepo Management**: Yama

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run the validation scripts:
   ```bash
   # Backend
   cd backend && npm run validate
   
   # Dashboard
   cd dashboard && npm run validate
   ```
5. Commit your changes (`git commit -m 'Add some amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

### Code Standards

- Follow TypeScript best practices
- Use ESLint and Prettier configurations
- Write meaningful commit messages
- Add tests for new features
- Update documentation as needed

## License

This project is licensed under the ISC License - see the package.json file for details.

## Support

For support and questions:
- Check the [API Documentation](./API_DOCUMENTATION.md)
- Review the [Backend README](./backend/README.md)
- Review the [Dashboard README](./dashboard/README.md)
- Open an issue in the repository

---

**Built with ❤️ by the Xyne Team**