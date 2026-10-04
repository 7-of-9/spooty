// Isolated Nest lifecycle fixture. Never import main.ts (production bootstrap).
const path = require('node:path');
const net = require('node:net');
const childProcess = require('node:child_process');
const scratch = process.env.SPOOTY_LIFECYCLE_ROOT;
if (!scratch || require('node:fs').realpathSync(process.cwd()) !== require('node:fs').realpathSync(scratch)) {
  throw new Error('Scratch cwd required');
}

// Fail closed before application imports: only this fixture's Redis is reachable.
const socketConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options = typeof first === 'object' ? first : { port: first, host: args[1] };
  if (Number(options?.port) !== Number(process.env.REDIS_PORT) ||
      !['127.0.0.1', 'localhost'].includes(options?.host)) {
    throw new Error('Lifecycle fixture blocked non-fixture network access');
  }
  return socketConnect.apply(this, args);
};
global.fetch = async () => { throw new Error('Lifecycle fixture blocks fetch'); };
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  childProcess[name] = () => { throw new Error('Lifecycle fixture blocks subprocesses'); };
}

require('ts-node').register({
  project: path.resolve(__dirname, '../../src/backend/tsconfig.json'),
  transpileOnly: true,
});
require('reflect-metadata');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../../src/backend/src/app.module');
const emit = (event, fields = {}) => process.send?.({ event, ...fields });
const { NestApplicationContext } = require('@nestjs/core/nest-application-context');
const { NestApplication } = require('@nestjs/core/nest-application');
for (const method of ['callDestroyHook', 'callBeforeShutdownHook', 'dispose', 'callShutdownHook']) {
  const prototype = method === 'dispose' ? NestApplication.prototype : NestApplicationContext.prototype;
  const original = prototype[method];
  prototype[method] = async function (...args) {
    emit('phase-start', { method });
    await original.apply(this, args);
    emit('phase-end', { method });
  };
}

async function run() {
  const app = await NestFactory.create(AppModule, { forceCloseConnections: true, logger: false });
  let finishWork;
  if (process.env.SPOOTY_LIFECYCLE_ADMISSION_MODE) {
    const { LibraryService } = require('../../src/backend/src/library/library.service');
    const library = app.get(LibraryService);
    const prepare = library.prepareDownloads.bind(library);
    library.prepareDownloads = async (...args) => {
      const receipt = await prepare(...args);
      if (process.env.SPOOTY_LIFECYCLE_ADMISSION_MODE === 'fail-after-work') {
        throw new Error('Controlled fixture preparation failure');
      }
      emit('preparation-held');
      await new Promise(resolve => { finishWork = resolve; });
      return receipt;
    };
  }
  if (process.env.SPOOTY_LIFECYCLE_ACTIVE === '1' || process.env.SPOOTY_LIFECYCLE_FINISHED === '1') {
    const { TrackService } = require('../../src/backend/src/track/track.service');
    app.get(TrackService).findOnYoutube = async () => {
      emit('work-started');
      if (process.env.SPOOTY_LIFECYCLE_ACTIVE === '1') await new Promise(resolve => { finishWork = resolve; });
      emit('work-finished');
    };
  }
  // Diagnostic hook names only; never log configuration, tokens or request data.
  const seen = new Set();
  for (const module of app.container.getModules().values()) {
    for (const wrapper of module.providers.values()) {
      const instance = wrapper.instance;
      if (!instance || seen.has(instance)) continue;
      seen.add(instance);
      for (const method of ['onModuleDestroy', 'beforeApplicationShutdown', 'onApplicationShutdown']) {
        if (typeof instance[method] !== 'function') continue;
        const original = instance[method].bind(instance);
        instance[method] = async (...args) => {
          const provider = instance.constructor?.name;
          emit('hook-start', { provider, method });
          await original(...args);
          emit('hook-end', { provider, method });
        };
      }
    }
  }
  app.enableShutdownHooks(['SIGTERM', 'SIGINT']);
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  for (const instance of seen) {
    let target;
    if (/Track(?:Search|Download)Processor/.test(instance.constructor?.name)) target = instance.worker;
    if (instance.constructor?.name === 'Queue') target = instance;
    if (!target) continue;
    for (const method of ['pause', 'close', 'disconnect']) {
      if (typeof target[method] !== 'function') continue;
      const original = target[method].bind(target);
      target[method] = async (...args) => {
        const name = `${target.constructor.name}:${target.name}`;
        emit('queue-start', { name, method, force: args[0] });
        await original(...args);
        emit('queue-end', { name, method });
      };
    }
  }
  process.on('message', async message => {
    if (message === 'release') { finishWork?.(); return; }
    if (message === 'state') {
      const { workerShutdownDetails } = require('../../src/backend/src/track/shutdown-diagnostics');
      const workers = [...seen].filter(instance => /Track(?:Search|Download)Processor/.test(instance.constructor?.name));
      emit('worker-state', { workers: workers.map(instance => ({ name: instance.constructor.name,
        activity: instance.activity.active, loop: instance.worker.isRunning(), ...JSON.parse(workerShutdownDetails(instance.worker)) })) });
      return;
    }
    if (message !== 'close') return;
    await app.close();
    emit('closed');
    process.disconnect();
  });
  emit('ready', { port: app.getHttpServer().address().port });
}
run().catch(error => {
  emit('fixture-error', { message: error.message });
  process.exitCode = 1;
  process.disconnect?.();
});
