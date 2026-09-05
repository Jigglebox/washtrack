// Minimal, dependency-free PostgreSQL client: enough of the wire protocol to
// authenticate (SCRAM-SHA-256, MD5, cleartext), optionally over TLS, and run
// simple text queries. Used only to read pg_catalog; it never sends anything
// other than the statements the live-db source hands it, and those run inside
// a READ ONLY transaction.

import { createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

export type SslMode = 'disable' | 'require' | 'no-verify';
export type PgConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: SslMode;
  applicationName: string;
  /** Extra `-c key=value` startup options */
  options: string[];
};

export type QueryResult = { rows: Record<string, unknown>[]; fields: string[]; command: string };

export class PgError extends Error {
  code?: string;
  constructor(message: string, code?: string) { super(message); this.code = code; }
}

export function parseConnectionString(url: string, overrides: Partial<PgConfig> = {}): PgConfig {
  const u = new URL(url.replace(/^postgres(ql)?:\/\//, 'http://'));
  const host = decodeURIComponent(u.hostname);
  const sslParam = u.searchParams.get('sslmode');
  const ssl: SslMode = sslParam === 'disable' ? 'disable' : sslParam === 'no-verify' || sslParam === 'prefer' && false ? 'no-verify' : sslParam ? 'require' : host === 'localhost' || host === '127.0.0.1' ? 'disable' : 'require';
  return {
    host,
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')) || 'postgres',
    ssl,
    applicationName: 'schema-map',
    options: ['default_transaction_read_only=on'],
    ...overrides,
  };
}

// ---------------------------------------------------------------- framing helpers

const cstr = (s: string) => Buffer.concat([Buffer.from(s, 'utf8'), Buffer.from([0])]);
const int32 = (n: number) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
function frame(type: string | null, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  const head = type ? Buffer.from(type, 'ascii') : Buffer.alloc(0);
  return Buffer.concat([head, int32(body.length + 4), body]);
}
function readCString(b: Buffer, off: number): [string, number] {
  const end = b.indexOf(0, off);
  return [b.toString('utf8', off, end), end + 1];
}

type Pending = { resolve: (r: QueryResult) => void; reject: (e: Error) => void; rows: Record<string, unknown>[]; fields: string[]; types: number[]; command: string; error?: PgError };

export class PgClient {
  private sock!: Socket;
  private buf = Buffer.alloc(0);
  private pending: Pending | null = null;
  private connectResolve?: () => void;
  private connectReject?: (e: Error) => void;
  private scram?: { clientNonce: string; clientFirstBare: string; saltedPassword?: Buffer; authMessage?: string };
  private closed = false;

  private cfg: PgConfig;

  private constructor(cfg: PgConfig) { this.cfg = cfg; }

  static async connect(cfg: PgConfig): Promise<PgClient> {
    const c = new PgClient(cfg);
    await c.open();
    return c;
  }

  private async open(): Promise<void> {
    const raw: Socket = await new Promise((resolve, reject) => {
      const s = netConnect({ host: this.cfg.host, port: this.cfg.port }, () => resolve(s));
      s.once('error', reject);
      s.setTimeout(20_000, () => reject(new PgError(`timeout connecting to ${this.cfg.host}:${this.cfg.port}`)));
    });
    raw.setTimeout(0);
    let sock: Socket = raw;
    if (this.cfg.ssl !== 'disable') {
      raw.write(frame(null, int32(80877103)));
      const reply: Buffer = await new Promise((resolve, reject) => { raw.once('data', resolve); raw.once('error', reject); });
      if (reply.toString('ascii', 0, 1) !== 'S') throw new PgError('server does not support TLS; add ?sslmode=disable if this is a local database');
      sock = await new Promise((resolve, reject) => {
        const t = tlsConnect({ socket: raw, servername: this.cfg.host, rejectUnauthorized: this.cfg.ssl === 'require' }, () => resolve(t));
        t.once('error', reject);
      });
    }
    this.sock = sock;
    sock.on('data', (d: Buffer) => this.onData(d));
    sock.on('error', (e: Error) => this.fail(new PgError(e.message)));
    sock.on('close', () => { this.closed = true; this.fail(new PgError('connection closed')); });

    const params: string[][] = [
      ['user', this.cfg.user], ['database', this.cfg.database], ['application_name', this.cfg.applicationName], ['client_encoding', 'UTF8'],
    ];
    if (this.cfg.options.length) params.push(['options', this.cfg.options.map((o) => `-c ${o}`).join(' ')]);
    const body = Buffer.concat([int32(196608), ...params.flatMap(([k, v]) => [cstr(k), cstr(v)]), Buffer.from([0])]);
    await new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve; this.connectReject = reject;
      sock.write(frame(null, body));
    });
  }

  private fail(e: Error) {
    if (this.connectReject) { const r = this.connectReject; this.connectReject = undefined; this.connectResolve = undefined; r(e); }
    if (this.pending) { const p = this.pending; this.pending = null; p.reject(e); }
  }

  private onData(chunk: Buffer) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (this.buf.length >= 5) {
      const len = this.buf.readInt32BE(1);
      if (this.buf.length < len + 1) break;
      const type = String.fromCharCode(this.buf[0]);
      const body = this.buf.subarray(5, len + 1);
      this.buf = this.buf.subarray(len + 1);
      try { this.handle(type, body); } catch (e) { this.fail(e as Error); }
    }
  }

  private send(type: string, ...parts: Buffer[]) { this.sock.write(frame(type, ...parts)); }

  private handle(type: string, body: Buffer) {
    switch (type) {
      case 'R': return this.handleAuth(body);
      case 'S': case 'K': case 'N': case 'n': case 'I': return; // parameter status, backend key, notice, no data, empty query
      case 'Z': {
        if (this.connectResolve) { const r = this.connectResolve; this.connectResolve = undefined; this.connectReject = undefined; r(); return; }
        if (this.pending) {
          const p = this.pending; this.pending = null;
          if (p.error) p.reject(p.error); else p.resolve({ rows: p.rows, fields: p.fields, command: p.command });
        }
        return;
      }
      case 'T': {
        if (!this.pending) return;
        const n = body.readInt16BE(0);
        let off = 2;
        const fields: string[] = [], types: number[] = [];
        for (let i = 0; i < n; i++) {
          const [name, next] = readCString(body, off);
          off = next;
          types.push(body.readInt32BE(off + 6));
          off += 18;
          fields.push(name);
        }
        this.pending.fields = fields; this.pending.types = types;
        return;
      }
      case 'D': {
        if (!this.pending) return;
        const n = body.readInt16BE(0);
        let off = 2;
        const row: Record<string, unknown> = {};
        for (let i = 0; i < n; i++) {
          const len = body.readInt32BE(off); off += 4;
          let v: unknown = null;
          if (len >= 0) { v = decode(body.toString('utf8', off, off + len), this.pending.types[i]); off += len; }
          row[this.pending.fields[i]] = v;
        }
        this.pending.rows.push(row);
        return;
      }
      case 'C': { if (this.pending) this.pending.command = readCString(body, 0)[0]; return; }
      case 'E': {
        const err = parseError(body);
        if (this.connectReject) { this.fail(err); return; }
        if (this.pending) this.pending.error = err; else this.fail(err);
        return;
      }
      default: return;
    }
  }

  private handleAuth(body: Buffer) {
    const code = body.readInt32BE(0);
    const { user, password } = this.cfg;
    if (code === 0) return; // ok
    if (code === 3) { this.send('p', cstr(password)); return; }
    if (code === 5) {
      const salt = body.subarray(4, 8);
      const inner = createHash('md5').update(password + user).digest('hex');
      const outer = createHash('md5').update(Buffer.concat([Buffer.from(inner), salt])).digest('hex');
      this.send('p', cstr('md5' + outer));
      return;
    }
    if (code === 10) {
      const mechs: string[] = [];
      let off = 4;
      while (off < body.length && body[off] !== 0) { const [m, next] = readCString(body, off); mechs.push(m); off = next; }
      if (!mechs.includes('SCRAM-SHA-256')) throw new PgError(`unsupported SASL mechanisms: ${mechs.join(', ')}`);
      const clientNonce = randomBytes(18).toString('base64');
      const clientFirstBare = `n=*,r=${clientNonce}`;
      this.scram = { clientNonce, clientFirstBare };
      const msg = Buffer.from('n,,' + clientFirstBare);
      this.send('p', cstr('SCRAM-SHA-256'), int32(msg.length), msg);
      return;
    }
    if (code === 11) {
      const serverFirst = body.toString('utf8', 4);
      const kv = Object.fromEntries(serverFirst.split(',').map((p) => [p[0], p.slice(2)]));
      if (!kv.r?.startsWith(this.scram!.clientNonce)) throw new PgError('SCRAM: server nonce mismatch');
      const salted = pbkdf2Sync(password.normalize('NFKC'), Buffer.from(kv.s, 'base64'), Number(kv.i), 32, 'sha256');
      const clientKey = createHmac('sha256', salted).update('Client Key').digest();
      const storedKey = createHash('sha256').update(clientKey).digest();
      const clientFinalWithoutProof = `c=biws,r=${kv.r}`;
      const authMessage = `${this.scram!.clientFirstBare},${serverFirst},${clientFinalWithoutProof}`;
      const clientSig = createHmac('sha256', storedKey).update(authMessage).digest();
      const proof = Buffer.from(clientKey.map((b, i) => b ^ clientSig[i]));
      this.scram!.saltedPassword = salted; this.scram!.authMessage = authMessage;
      this.send('p', Buffer.from(`${clientFinalWithoutProof},p=${proof.toString('base64')}`));
      return;
    }
    if (code === 12) {
      const serverFinal = body.toString('utf8', 4);
      const v = serverFinal.match(/(?:^|,)v=([^,]+)/)?.[1];
      const serverKey = createHmac('sha256', this.scram!.saltedPassword!).update('Server Key').digest();
      const expected = createHmac('sha256', serverKey).update(this.scram!.authMessage!).digest();
      if (!v || !timingSafeEqual(Buffer.from(v, 'base64'), expected)) throw new PgError('SCRAM: server signature invalid');
      return;
    }
    throw new PgError(`unsupported authentication method (code ${code})`);
  }

  /** Run one statement. Only SELECT/WITH and transaction control are allowed; anything else is refused client-side. */
  query(sql: string): Promise<QueryResult> {
    if (this.closed) return Promise.reject(new PgError('connection closed'));
    if (this.pending) return Promise.reject(new PgError('query already in flight'));
    if (!/^\s*(select|with|begin|rollback|set\s+local|set\s+transaction|show)\b/i.test(sql)) return Promise.reject(new PgError(`schema-map refuses to run non-read statement: ${sql.slice(0, 40)}`));
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject, rows: [], fields: [], types: [], command: '' };
      this.send('Q', cstr(sql));
    });
  }

  end() {
    if (this.closed) return;
    this.closed = true;
    try { this.sock.write(frame('X')); this.sock.end(); } catch { /* ignore */ }
  }
}

function parseError(body: Buffer): PgError {
  const f: Record<string, string> = {};
  let off = 0;
  while (off < body.length && body[off] !== 0) { const t = String.fromCharCode(body[off]); const [v, next] = readCString(body, off + 1); f[t] = v; off = next; }
  const detail = [f.D, f.H].filter(Boolean).join(' ');
  return new PgError(`${f.S ?? 'ERROR'}: ${f.M ?? 'unknown error'}${detail ? ` (${detail})` : ''}`, f.C);
}

/** Text-format decoding for the handful of types we use; json/jsonb become objects. */
function decode(text: string, typeOid: number): unknown {
  switch (typeOid) {
    case 16: return text === 't';
    case 20: case 21: case 23: case 26: case 700: case 701: case 1700: return Number(text);
    case 114: case 3802: return JSON.parse(text);
    default: return text;
  }
}
