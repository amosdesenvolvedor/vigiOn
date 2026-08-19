const raw = process.env.DATABASE_URL;
if (!raw) throw new Error('DATABASE_URL is required');
const url = new URL(raw);
const database = url.pathname.replace(/^\//u, '');
const localHosts = new Set(['127.0.0.1', 'localhost', 'test-db']);
if (!localHosts.has(url.hostname) || !/(?:^|_)test(?:$|_)/u.test(database)) {
  throw new Error(`Refusing non-test database: host=${url.hostname} database=${database}`);
}
console.log(`Test database safety check passed: ${url.hostname}/${database}`);
