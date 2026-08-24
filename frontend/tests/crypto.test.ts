import { describe, expect, it } from 'bun:test';
import { createKeyMaterial, recoverKeyA, type RandomBytes } from '../services/crypto';

function testRandomBytes(start = 1): RandomBytes {
  let seed = start;
  return async (length) => {
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
      bytes[index] = (seed * 31 + index) % 256;
    }
    seed += 1;
    return bytes;
  };
}

describe('フロント端末Key-A envelope', () => {
  it('Recovery KeyでKey-Aを復号できる', async () => {
    const material = await createKeyMaterial(testRandomBytes());
    const recovered = recoverKeyA(material.recoveryKey, material.envelope);
    expect(Array.from(recovered)).toEqual(Array.from(material.keyA));
  });

  it('違うRecovery Keyでは復号できない', async () => {
    const material = await createKeyMaterial(testRandomBytes(1));
    const other = await createKeyMaterial(testRandomBytes(10));
    expect(() => recoverKeyA(other.recoveryKey, material.envelope)).toThrow();
  });
});
