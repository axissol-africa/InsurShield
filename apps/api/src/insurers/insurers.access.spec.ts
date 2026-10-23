import 'reflect-metadata';
import { InsurersController } from './insurers.controller.js';
import { REQUIRED_ROLES, IS_PUBLIC } from '../common/auth/auth.guard.js';

/**
 * Who may reach each insurer route.
 *
 * These are read off the decorators rather than asserted by hand, because the
 * failure this guards against is silent: inserting a method between a @Roles
 * decorator and the handler it was written for moves the guard onto the new
 * method and leaves the old one open. That exact slip would have exposed
 * licence, registration and tax numbers to every signed-in customer.
 */
const rolesOn = (method: string) =>
  Reflect.getMetadata(REQUIRED_ROLES, (InsurersController.prototype as never)[method]) ?? null;
const isPublic = (method: string) =>
  Reflect.getMetadata(IS_PUBLIC, (InsurersController.prototype as never)[method]) ?? false;

describe('insurer route access', () => {
  it('leaves the directory open, because guests compare before signing up', () => {
    expect(isPublic('directory')).toBe(true);
    expect(rolesOn('directory')).toBeNull();
  });

  it('keeps every record carrying licence and tax details with staff', () => {
    for (const method of ['list', 'get']) {
      expect(rolesOn(method)).toEqual(['SUPER_ADMIN', 'ADMIN']);
    }
  });

  it('keeps writes with staff, and deletion with a super administrator', () => {
    expect(rolesOn('create')).toEqual(['SUPER_ADMIN', 'ADMIN']);
    expect(rolesOn('update')).toEqual(['SUPER_ADMIN', 'ADMIN']);
    expect(rolesOn('setStatus')).toEqual(['SUPER_ADMIN', 'ADMIN']);
    expect(rolesOn('remove')).toEqual(['SUPER_ADMIN']);
  });

  it('lets any signed-in customer read reviews, but not the insurer record', () => {
    // Reviews are shown while comparing, so a customer must be able to read
    // them — without that also opening the record they sit against.
    expect(rolesOn('listReviews')).toBeNull();
    expect(isPublic('listReviews')).toBe(false);
    expect(rolesOn('get')).toEqual(['SUPER_ADMIN', 'ADMIN']);
  });
});
