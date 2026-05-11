import * as dgram from 'node:dgram';
import * as net from 'node:net';

export type RunMode = 'local' | 'ci';

const PORT_NAMES = [
  'POSTGRES_BIND_PORT',
  'REDIS_BIND_PORT',
  'LIVEKIT_HTTP_BIND_PORT',
  'LIVEKIT_HTTPS_BIND_PORT',
  'LIVEKIT_UDP_BIND_PORT',
  'FAKE_GCS_BIND_PORT',
  'MINIO_API_BIND_PORT',
  'MINIO_CONSOLE_BIND_PORT',
  'ZERO_BIND_PORT_1',
  'ZERO_BIND_PORT_2',
  'TRANSCRIPTION_AGENT_BIND_PORT',
  'YSWEET_BIND_PORT',
  'SUPERPOSITION_BIND_PORT',
  'CLAW_AUTH_POSTGRES_BIND_PORT',
  'OTEL_HTTP_BIND_PORT',
  'OTEL_GRPC_BIND_PORT',
  'OTEL_METRICS_BIND_PORT',
  'VICTORIAMETRICS_BIND_PORT',
  'GRAFANA_BIND_PORT',
  'BACKEND_BIND_PORT',
  'DASHBOARD_BIND_PORT',
] as const;

const UDP_PORT_NAME = 'LIVEKIT_UDP_BIND_PORT';
const TCP_PORT_COUNT = PORT_NAMES.filter((n) => n !== UDP_PORT_NAME).length;

export async function buildPortMap(mode: RunMode): Promise<Record<string, number>> {
  if (mode === 'ci') {
    return Object.fromEntries(PORT_NAMES.map((name) => [name, 0]));
  }

  const [tcpPorts, udpPort] = await Promise.all([
    findAvailablePorts(TCP_PORT_COUNT),
    findAvailableUDPPort(),
  ]);

  let tcpIdx = 0;
  const portMap: Record<string, number> = {};
  for (const name of PORT_NAMES) {
    portMap[name] = name === UDP_PORT_NAME ? udpPort : tcpPorts[tcpIdx++];
  }
  return portMap;
}

export function portMapToEnv(portMap: Record<string, number>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(portMap)) {
    env[key] = String(value);
  }
  return env;
}

async function findAvailablePorts(count: number): Promise<number[]> {
  const servers: net.Server[] = [];
  const ports: number[] = [];

  await Promise.all(
    Array.from(
      { length: count },
      () =>
        new Promise<void>((resolve, reject) => {
          const server = net.createServer();
          server.listen(0, '127.0.0.1', () => {
            const addr = server.address();
            if (addr && typeof addr === 'object') {
              ports.push(addr.port);
              servers.push(server);
              resolve();
            } else {
              reject(new Error('Failed to get port from server'));
            }
          });
          server.on('error', reject);
        })
    )
  );

  await Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));

  return ports;
}

async function findAvailableUDPPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    socket.bind(0, '127.0.0.1', () => {
      const port = socket.address().port;
      socket.close(() => resolve(port));
    });
    socket.on('error', reject);
  });
}
