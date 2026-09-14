import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { promisify } from "node:util";
import { Injectable } from "@nestjs/common";

// node:crypto's typings declare several scrypt() overloads; promisify() alone
// resolves to the no-options one. Cast to the options-taking signature we
// actually use (options is required here, so this is a narrowing, not a lie).
const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions
) => Promise<Buffer>;

// N=16384, r=8, p=1: OWASP-recommended minimum scrypt cost parameters for
// interactive login (2024 cheat sheet), ~16MB memory cost per hash.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

/**
 * Uses Node's built-in crypto.scrypt rather than the argon2 npm package
 * (OWASP's #1 recommendation) deliberately: argon2 ships a native binary, and
 * this project's Alpine-based Docker images have already hit real native-module
 * friction once this session (Prisma's engine needing `apk add openssl`).
 * scrypt is OWASP's #2-recommended KDF, is a Node built-in (zero new
 * dependencies, zero native-binary build risk on Alpine), and is not
 * homemade cryptography — a deliberate, documented trade-off, not an oversight.
 */
@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derivedKey = (await scrypt(password, salt, KEY_LENGTH, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
    })) as Buffer;
    return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${derivedKey.toString("hex")}`;
  }

  async verify(storedHash: string, password: string): Promise<boolean> {
    try {
      const [scheme, nStr, rStr, pStr, saltHex, hashHex] = storedHash.split("$");
      if (scheme !== "scrypt" || !nStr || !rStr || !pStr || !saltHex || !hashHex) return false;
      const salt = Buffer.from(saltHex, "hex");
      const expected = Buffer.from(hashHex, "hex");
      const derivedKey = (await scrypt(password, salt, expected.length, {
        N: Number(nStr),
        r: Number(rStr),
        p: Number(pStr),
      })) as Buffer;
      return derivedKey.length === expected.length && timingSafeEqual(derivedKey, expected);
    } catch {
      return false;
    }
  }
}
