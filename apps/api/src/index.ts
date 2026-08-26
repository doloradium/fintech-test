import { appConfig, resolveDatabaseFile } from './config.js';
import { openDatabase } from './db/database.js';
import { bootstrapFunnel } from './bootstrap.js';
import { buildServer } from './server.js';

const databaseFile = resolveDatabaseFile();
const db = openDatabase(databaseFile);

const bootstrapped = bootstrapFunnel(db, {
  configDir: appConfig.configDir,
  file: appConfig.bootstrapConfig,
});

const app = await buildServer({
  db,
  configDir: appConfig.configDir,
  adminToken: appConfig.adminToken,
  experimentSalt: appConfig.experimentSalt,
  webDist: appConfig.webDist,
  serveWeb: appConfig.serveWeb,
  logger: true,
});

await app.listen({ host: appConfig.host, port: appConfig.port });

app.log.info(
  { database: databaseFile, configDir: appConfig.configDir, bootstrapped: bootstrapped?.version ?? 'existing' },
  'funnel runtime is ready',
);

const shutdown = async (): Promise<void> => {
  await app.close();
  db.close();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
