
/**
 * Custom application, inherits from Koa Application
 * Gets requireModules which adds a module to handlers.
 *
 * Handlers are called on:
 *   - init (sync) - initial requires
 *   - boot (async) - ensure ready to get a request
 *   - close (async) - close connections
 *
 * @type {Application}
 */


const KoaApplication = require('koa');

const log = require('jsengine/log')();
const Cookies = require('cookies');


module.exports = class Application extends KoaApplication {
  constructor() {
    super();
    this.handlers = {};
    this.log = log;
  }

// wait for full app load and all associated warm-ups to finish
// mongoose buffers queries,
// so for TEST/DEV there's no reason to wait
// for PROD, there is a reason: to check if DB is ok before taking a request
  async waitBoot() {

    for (let path in this.handlers) {
      let handler = this.handlers[path];
      if (!handler.boot) continue;
      await handler.boot();
    }

  }

// adding middlewares only possible *before* app.run
// (before server.listen)
// assigns server instance (meaning only 1 app can be run)
//
// app.listen can also be called from tests directly (and synchronously), without waitBoot (many times w/ random port)
// it's ok for tests, db requests are buffered, no need to waitBoot

  async waitBootAndListen(host, port) {
    await this.waitBoot();

    await new Promise((resolve) => {
      this.server = this.listen(port, host, resolve);
    });

    this.log.info('Server is listening %s:%d', host, port);
  }

  async close() {
    this.log.info("Closing app server...");
    await new Promise(resolve => {
      this.server.close(resolve);
    });

    this.log.info("App connections are closed");

    for (let path in this.handlers) {
      let handler = this.handlers[path];
      if (!handler.close) continue;
      await handler.close();
    }

    this.log.info("App stopped");
  }

  createContext(req, res) {
    let context = super.createContext(req, res);
    context.cookies = new Cookies(req, res, {
      // no secure!!! we allow https cookies to go over http for auth
      // otherwise auth with soc networks returns 401 sometimes (https redirect sets secure auth cookie -> http, no cookies)
      keys: this.keys
    });
    return context;
  }

  requireHandler(path) {

    // if debug is on => will log the middleware travel chain
    if (process.env.NODE_ENV == 'development' || process.env.LOG_LEVEL) {
      let log = this.log;
      this.use(async function(ctx, next) {
        log.trace("-> setup " + path);
        let d = new Date();
        await next();
        log.trace("<- setup " + path, new Date() - d);
      });
    }

    let handler = require(path);

    // init is always fast & sync, for tests to run fast
    // boot may be slower and async
    if (handler.init) {
      handler.init(this);
    }

    this.handlers[path] = handler;

  }


};

