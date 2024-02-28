'use strict';

const debug = require('debug')('plugin:tracetest');

const Tracetest = require('@tracetest/client').default;

const fs = require('fs');
const yaml = require('js-yaml');
const { saveToFile, readFiles, getUrls, deleteDir } = require('./utils');
const { uuid } = require('uuidv4');

module.exports.Plugin = ArtilleryTracetestPlugin;

const urls = [];

function ArtilleryTracetestPlugin(script, events) {
  debug('ArtilleryTracetestPlugin setup');
  const id = uuid();

  this.registerURLs = function (url) {
    urls.push(url);
    saveToFile('.tracetest', `urls-${id}.json`, JSON.stringify(urls, null, 2));
    debug(urls);
  };

  events.on('done', function () {
    debug('ArtilleryTracetestPlugin done', urls);

    console.log('Tracetest Test Runs:');
    console.log();
    console.log(urls.join('\n'));
  });

  this.cleanup = function (done) {
    debug('ArtilleryTracetestPlugin cleanup');

    const files = readFiles('.tracetest');
    const urls = getUrls(files);
    deleteDir('.tracetest');

    console.log('Tracetest Test Runs:', urls);
    done();
  };

  const reporter = new TracetestReporter(id, script, events, this.registerURLs.bind(this));
  reporter.run();
}

class TracetestReporter {
  constructor(id, script, events, registerFn) {
    debug('TracetestReporter setup');
    this.id = id;
    this.script = script;
    this.events = events;
    this.recordURL = registerFn;
    this.config = script.config.plugins['tracetest'];
  }

  async initialize() {
    if (this.test) {
      debug('TracetestReporter already initialized');
      return;
    }

    debug('TracetestReporter initialize');
    try {
      const testDefYaml = fs.readFileSync(this.config.testFile, 'utf8');
      const testDef = yaml.load(testDefYaml);

      this.tracetest = await Tracetest(this.config.apiToken);
      this.test = await this.tracetest.newTest(testDef);
    } catch (error) {
      debug(error);
    }
    debug('TracetestReporter initialize complete');
  }

  run() {
    attachScenarioHooks(this.script, [
      {
        type: 'beforeRequest',
        name: 'startTest',
        hook: this.startTest.bind(this),
      },
      {
        type: 'afterResponse',
        name: 'getTestResults',
        hook: this.getTestResults.bind(this),
      },
    ]);
  }

  async startTest(requestParams, context, events, next) {
    debug('TracetestReporter startTest');
    await this.initialize();

    try {
      const traceID = context.vars['__httpScenarioSpan']._spanContext.traceId;
      const run = await this.tracetest.runTest(this.test, {
        variables: [{ key: 'TRACE_ID', value: traceID }],
      });
      events.emit('counter', 'tracetest.tests_started', 1);
      // debug('start wait')
      // await sleep(1000)
      // debug('done wait wait')
      context.vars['__tracetest_run'] = run;
      debug('TracetestReporter startTest run');

      if (!requestParams.headers) {
        requestParams.headers = {};
      }

      const requestSpanID = context.vars['__otlpHTTPRequestSpan']._spanContext.spanId;

      // link the artillery span to the service-under-test span if it supports this
      requestParams.headers['traceparent'] = `00-${traceID}-${requestSpanID}-01`;
    } catch (error) {
      debug(error);
    }

    return next();
  }

  async getTestResults(req, res, userContext, events, done) {
    await this.initialize();
    debug('TracetestReporter getTestResults');

    const run = userContext.vars['__tracetest_run'];
    if (!run) {
      return done();
    }

    try {
      const succeded = await run.getIsSuccessful();
      if (succeded) {
        events.emit('counter', 'tracetest.tests_succeeded', 1);
      } else {
        events.emit('counter', 'tracetest.tests_failed', 1);
      }
      this.recordURL(await run.getUrl());
    } catch (error) {
      debug(error);
    }

    done();
  }
}

function attachScenarioHooks(script, specs) {
  const scenarios = script.scenarios;

  if (typeof scenarios !== 'object' || scenarios.length < 1) {
    return;
  }

  scenarios.forEach(scenario => {
    specs.forEach(spec => {
      scenario[spec.type] = [].concat(scenario[spec.type] || []);
      scenario[spec.type].push(spec.name);
      addHelperFunction(script, spec.name, spec.hook);
    });
  });
}

function addHelperFunction(script, name, func) {
  if (!script.config.processor) {
    script.config.processor = {};
  }

  script.config.processor[name] = func;
}

const sleep = delay => new Promise(resolve => setTimeout(resolve, delay));
