import { describe, expect, it } from 'vitest';
import { MAX_DOCUMENT_BYTES, documentToRecord, formatBytes, imageToDataUrl } from './files';

const file = (name, type, bytes) => new File([new Uint8Array(bytes)], name, { type });

describe('documentToRecord', () => {
  it('stores a PDF or image as a data URL with its metadata', async () => {
    const record = await documentToRecord(file('quote.pdf', 'application/pdf', [0x25, 0x50, 0x44, 0x46]));
    expect(record).toMatchObject({ name: 'quote.pdf', type: 'application/pdf', size: 4 });
    expect(record.dataUrl).toBe('data:application/pdf;base64,JVBERg==');
  });

  it('rejects other file types and oversized files', async () => {
    await expect(documentToRecord(file('quote.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', [1]))).rejects.toThrow('PDF, JPG or PNG');
    const big = { name: 'big.pdf', type: 'application/pdf', size: MAX_DOCUMENT_BYTES + 1 };
    await expect(documentToRecord(big)).rejects.toThrow('limit is 3 MB');
  });
});

describe('imageToDataUrl', () => {
  it('only accepts images', async () => {
    await expect(imageToDataUrl(file('logo.pdf', 'application/pdf', [1]))).rejects.toThrow('image file');
  });

  it('passes SVG logos through untouched', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    const dataUrl = await imageToDataUrl(new File([svg], 'logo.svg', { type: 'image/svg+xml' }));
    expect(dataUrl).toBe(`data:image/svg+xml;base64,${btoa(svg)}`);
  });
});

describe('formatBytes', () => {
  it('shows KB below a megabyte and MB above', () => {
    expect(formatBytes(1)).toBe('1 KB');
    expect(formatBytes(512 * 1024)).toBe('512 KB');
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB');
  });
});
