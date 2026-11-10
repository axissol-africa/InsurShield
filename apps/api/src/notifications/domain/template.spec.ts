import { activeVersion, placeholders, render } from './template.js';

const version = (n: number, activeFrom: string | null, mandatory = true) => ({
  key: 'quote.ready',
  version: n,
  subject: `v${n}`,
  body: `body ${n}`,
  mandatory,
  activeFrom: activeFrom === null ? null : new Date(activeFrom),
});

const AT = new Date('2026-11-10T12:00:00.000Z');

describe('activeVersion', () => {
  it('takes the newest version already in use', () => {
    const chosen = activeVersion([version(1, '2026-01-01'), version(3, '2026-06-01'), version(2, '2026-03-01')], AT);

    expect(chosen?.version).toBe(3);
  });

  it('ignores a version published for later, so a scheduled edit does not send early', () => {
    const chosen = activeVersion([version(1, '2026-01-01'), version(2, '2026-12-01')], AT);

    expect(chosen?.version).toBe(1);
  });

  it('ignores a draft that was never put into use', () => {
    const chosen = activeVersion([version(1, '2026-01-01'), version(2, null)], AT);

    expect(chosen?.version).toBe(1);
  });

  it('finds nothing when no version is in use yet, rather than sending a draft', () => {
    expect(activeVersion([version(1, null)], AT)).toBeUndefined();
    expect(activeVersion([], AT)).toBeUndefined();
  });

  it('treats a version starting exactly now as in use', () => {
    expect(activeVersion([version(1, AT.toISOString())], AT)?.version).toBe(1);
  });
});

describe('render', () => {
  it('fills the placeholders it is given values for', () => {
    expect(render('Your quote from {{insurer}} is ready', { insurer: 'Prestige Assurance' }))
      .toBe('Your quote from Prestige Assurance is ready');
  });

  it('fills a placeholder used more than once', () => {
    expect(render('{{name}}, your {{name}} is ready', { name: 'quote' })).toBe('quote, your quote is ready');
  });

  it('leaves a placeholder it has no value for, so the gap is reported rather than overlooked', () => {
    expect(render('Your quote from {{insurer}} is ready', {})).toBe('Your quote from {{insurer}} is ready');
  });

  it('does not treat a value as a template of its own', () => {
    expect(render('{{a}}', { a: '{{b}}' })).toBe('{{b}}');
  });
});

describe('placeholders', () => {
  it('lists each name once', () => {
    expect(placeholders('{{a}} and {{b}} and {{a}}')).toEqual(['a', 'b']);
  });

  it('finds none in text that has none', () => {
    expect(placeholders('nothing to fill')).toEqual([]);
  });
});
