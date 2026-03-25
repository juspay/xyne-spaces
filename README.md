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
- Docker & Docker Compose (for services)

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

# Install backend dependencies
cd backend && npm install && cd ..

# Install dashboard dependencies
cd dashboard && npm install && cd ..
```

3. **Start services**:
```bash
npm run services
```

4. **Start development servers**:
```bash
# Start backend (in one terminal)
cd backend && npm run dev

# Start dashboard (in another terminal)
cd dashboard && npm run dev
```

5. **Access the application**:
- Dashboard: http://localhost:5173
- Backend API: http://localhost:3001
- API Documentation: http://localhost:3001/api-docs

## Development Setup

### Backend

1. Navigate to the backend directory:
```bash
cd backend
```

2. Copy environment variables:
```bash
cp .env.example .env
```

3. Configure your environment variables in `.env`

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
├── docker/                 # Docker configuration files
├── scripts/                # Build and deployment scripts
├── API_DOCUMENTATION.md    # Comprehensive API documentation
└── README.md              # This file
```

## Available Scripts

### Root Level
- `npm run services` - Start Docker services (database, etc.)
- `npm run services:stop` - Stop Docker services
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