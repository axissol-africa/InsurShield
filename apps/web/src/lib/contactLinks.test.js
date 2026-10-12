import { describe, expect, it } from 'vitest';
import { mailtoHref, telHref } from './contactLinks';

describe('telHref', () => {
  it('dials the number however the customer spaced it', () => {
    expect(telHref('0970123456')).toBe('tel:0970123456');
    expect(telHref('+260 97 012-3456')).toBe('tel:+260970123456');
    expect(telHref('(0211) 255.100')).toBe('tel:0211255100');
  });

  it('gives no link for anything that is not a plain phone number', () => {
    // Dial codes and pauses would make the phone do more than call the customer.
    for (const phone of ['*21*0970000000#', '0970123456,,1234', '0970123456;ext=9', '0970123456?x=1', 'tel:0970123456', '12345', 'call me', '', null, undefined]) {
      expect(telHref(phone)).toBeNull();
    }
  });
});

describe('mailtoHref', () => {
  it('addresses the customer and nobody else', () => {
    expect(mailtoHref('mwiza.banda@insurshield.zm')).toBe('mailto:mwiza.banda@insurshield.zm');
    expect(mailtoHref('  k.tembo+claims@example.co.zm ')).toBe('mailto:k.tembo+claims@example.co.zm');
  });

  it('gives no link for an address that carries anything more than an address', () => {
    // Extra recipients, a subject or a body would be added to the officer's message.
    for (const email of ['a@b.zm?cc=x@evil.zm', 'a@b.zm&bcc=x@evil.zm', 'a@b.zm?subject=Refund&body=Pay', 'a@b.zm,x@evil.zm', 'a@b.zm%0Acc:x@evil.zm', 'a b@c.zm', 'nobody', 'a@b', '', null, undefined]) {
      expect(mailtoHref(email)).toBeNull();
    }
  });
});
