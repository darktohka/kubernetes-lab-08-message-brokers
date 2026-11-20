// Inter-service wire codec: MessagePack (plain maps, no record structures).
//
// `useRecords: false` keeps the encoding a plain map so other services/languages
// can read it; `mapsAsObjects` decodes back into ordinary JS objects.
import { Packr } from "msgpackr";

const packr = new Packr({ useRecords: false, mapsAsObjects: true });

export function encode(value: unknown): Buffer {
  return packr.pack(value);
}

/** Decodes a MessagePack frame; tolerates legacy JSON text for one release. */
export function decode<T>(input: Uint8Array | Buffer | string): T {
  if (typeof input === "string") return JSON.parse(input) as T;
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (bytes.length > 0 && bytes[0] === 0x7b) return JSON.parse(bytes.toString("utf8")) as T;
  return packr.unpack(bytes) as T;
}
