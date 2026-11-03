const { askAdministrator, ASSISTANT_SETTINGS } = require('./assistantSettings');

describe('askAdministrator', () => {
    it('includes the configured admin email', () => {
        expect(ASSISTANT_SETTINGS.adminEmail).toBe('amir.khan@voyagerr.com');
        expect(askAdministrator()).toBe('ask your administrator (amir.khan@voyagerr.com)');
    });
    it('accepts another email and omits it when empty', () => {
        expect(askAdministrator('it@example.com')).toBe('ask your administrator (it@example.com)');
        expect(askAdministrator('')).toBe('ask your administrator');
    });
});
