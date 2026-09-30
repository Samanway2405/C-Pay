// Mock for expo-crypto
import { randomBytes, randomUUID as nodeRandomUUID } from 'crypto';

export const getRandomBytesAsync = jest.fn(async (byteCount: number): Promise<Uint8Array> => {
  return new Uint8Array(randomBytes(byteCount));
});

export const randomUUID = jest.fn((): string => {
  return nodeRandomUUID();
});
