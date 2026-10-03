import { describe, expect, it } from 'vitest';
import { csvCell, safeLink, sha256, publishedWorkAllowed } from '../src/lib';
import type { Publication } from '../src/lib';

describe('download and integrity boundaries', () => {
  it('prevents spreadsheet formula execution, including control-prefixed values', () => {
    for (const input of ['=1+1', '+1', '-2', '@SUM(A1)', '\t=1', '\r=1']) expect(csvCell(input).startsWith('"\'')).toBe(true);
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell(null)).toBe('""');
  });
  it('rejects script, plaintext and credential-bearing external links', () => {
    for (const url of ['javascript:alert(1)', 'http://imd.fun', 'https://user:password@imd.fun', '/relative']) expect(safeLink(url)).toBeNull();
    expect(safeLink('https://api.imd.fun/artifacts/abc')).toBe('https://api.imd.fun/artifacts/abc');
  });
  it('hashes actual file bytes using the standard SHA-256 algorithm', async () => {
    expect(await sha256(new File(['abc'], 'content.txt'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await sha256(new File([], 'empty'))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
  it('rejects oversized files before reading their bytes', async () => {
    let read = false;
    await expect(sha256({ size: 64 * 1024 * 1024 + 1, arrayBuffer: async () => { read = true; return new ArrayBuffer(0); } } as File)).rejects.toThrow('64 MB');
    expect(read).toBe(false);
  });
});

describe('eligible published records', () => {
  const record = (objective: string, chains: number[]) => ({ objective, chains } as Publication);
  it('keeps actual Ethereum and off-chain work', () => {
    expect(publishedWorkAllowed(record('Research democracy', []))).toBe(true);
    expect(publishedWorkAllowed(record('Ethereum contract', [1]))).toBe(true);
  });
  it('excludes illustrative work and non-Ethereum contract chains', () => {
    expect(publishedWorkAllowed(record('A sandbox application', []))).toBe(false);
    expect(publishedWorkAllowed(record('Sepolia contract', [11155111]))).toBe(false);
    expect(publishedWorkAllowed(record('Mixed contract deployment', [1, 11155111]))).toBe(false);
  });
});
