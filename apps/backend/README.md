# Xyne Spaces Backend

A scalable, production-ready TypeScript backend server for the Xyne Spaces application.

## Features

- **TypeScript**: Full TypeScript support with strict type checking
- **Express.js**: Fast and minimalist web framework
- **Layered Architecture**: Clean separation of concerns with controllers, services, middleware, and routes
- **Health Checks**: Comprehensive health monitoring endpoints
- **Error Handling**: Centralized error handling with custom error classes
- **Logging**: Structured logging with Winston
- **Validation**: Request validation using Joi
- **Security**: Helmet, CORS, and rate limiting
- **Testing**: Jest testing framework with coverage reports
- **Code Quality**: ESLint and Prettier for consistent code style
- **Docker**: Multi-stage Dockerfile for production deployment

## Project Structure

```
backend/
├── src/
│   ├── config/          # Configuration files
│   ├── controllers/     # Route controllers
│   ├── middleware/      # Custom middleware
│   ├── routes/          # Route definitions
│   ├── services/        # Business logic
│   ├── types/           # TypeScript type definitions
│   ├── utils/           # Utility functions
│   ├── validators/      # Request validation schemas
│   ├── app.ts           # Express app configuration
│   └── index.ts         # Application entry point
├── tests/               # Test files
├── docs/                # Documentation
└── scripts/             # Build and deployment scripts
```

## Getting Started

### Prerequisites

- Node.js >= 18.0.0
- npm >= 8.0.0

### Installation

1. Install dependencies:
```bash
npm install
```

2. Copy environment variables:
```bash
cp .env.example .env
```

3. Configure environment variables in `.env`

### Development

Start the development server:
```bash
npm run dev
```

### Building

Build the application:
```bash
npm run build
```

### Production

Start the production server:
```bash
npm start
```

## API Endpoints

### Health Check

- `GET /api/health` - General health status
- `GET /api/health/readiness` - Readiness probe
- `GET /api/health/liveness` - Liveness probe

### API Versioning

- `GET /api/v1` - API v1 placeholder endpoint

## Scripts

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

## Docker

Build and run with Docker:

```bash
# Build image
docker build -t xyne-spaces-backend .

# Run container
docker run -p 3001:3001 --env-file .env xyne-spaces-backend
```

## Environment Variables

See `.env.example` for all available environment variables.

## License

Apache-2.0