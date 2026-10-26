// TLS for every database connection is decided here, once (DEC-001). The host decides it, not
// `sslmode`: a local host gets plain TCP, anything else gets verified TLS against node's roots,
// and no parameter in the URL can weaken that.
import tls from "node:tls";
import { describe, expect, it } from "vitest";
import { pgConnectionConfig } from "./pg-connect.js";

const TRUST = { ca: [...tls.rootCertificates], rejectUnauthorized: true };
const REMOTE = "postgres://app:pw@db.example.com:5432/haul";
const SSL_PARAMS = ["sslmode", "sslrootcert", "sslcert", "sslkey", "sslpassword", "ssl"];

describe("AC1 — a local host gets no TLS", () => {
  it.each([
    "postgres://haul:haul@localhost:5434/haul_dev",
    "postgres://haul:haul@127.0.0.1:5434/haul_dev",
    "postgres://haul:haul@[::1]:5434/haul_dev",
  ])("AC1: returns %s unchanged, with no ssl", (url) => {
    const config = pgConnectionConfig(url);
    expect(config.connectionString).toBe(url);
    expect(config.ssl).toBeUndefined();
  });
});

describe("AC2 — any other host gets verified TLS, and the URL cannot weaken it", () => {
  it("AC2: returns node's root certificates with rejectUnauthorized true for a remote host with no sslmode", () => {
    expect(pgConnectionConfig(REMOTE).ssl).toEqual(TRUST);
  });

  it.each(SSL_PARAMS)("AC2: strips %s from the returned connection string and keeps the rest", (param) => {
    const config = pgConnectionConfig(`${REMOTE}?${param}=require&application_name=haul`);
    const returned = new URL(config.connectionString);
    expect(returned.searchParams.has(param)).toBe(false);
    expect(returned.searchParams.get("application_name")).toBe("haul");
    expect(returned.hostname).toBe("db.example.com");
    expect(returned.pathname).toBe("/haul");
    expect(config.ssl).toEqual(TRUST);
  });

  it("AC2: strips every ssl parameter at once", () => {
    const query = SSL_PARAMS.map((p) => `${p}=x`).join("&");
    const returned = new URL(pgConnectionConfig(`${REMOTE}?${query}`).connectionString);
    expect([...returned.searchParams.keys()]).toEqual([]);
  });

  it("AC2: sslmode=no-verify still yields rejectUnauthorized true and never reaches the connection string", () => {
    const config = pgConnectionConfig(`${REMOTE}?sslmode=no-verify`);
    expect(config.ssl).toEqual(TRUST);
    expect(config.connectionString).not.toMatch(/sslmode|no-verify/);
  });
});

describe("AC3 — the explicit escape hatch, and failing closed", () => {
  it("AC3: a non-local URL with sslmode=disable gets no ssl", () => {
    expect(pgConnectionConfig(`${REMOTE}?sslmode=disable`).ssl).toBeUndefined();
  });

  it("AC3: a URL that won't parse gets TLS required", () => {
    expect(pgConnectionConfig("not a url").ssl).toEqual(TRUST);
  });
});
