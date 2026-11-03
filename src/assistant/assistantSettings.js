/**
 * Assistant settings. Change adminEmail here to point users at a different administrator;
 * it is shown wherever the assistant says "ask your administrator".
 */
const ASSISTANT_SETTINGS = {
    adminEmail: 'amir.khan@voyagerr.com'
};

/**
 * "ask your administrator (email)" fragment, or just "ask your administrator" when no email is set.
 * @param {string} [email]
 * @returns {string}
 */
function askAdministrator(email = ASSISTANT_SETTINGS.adminEmail) {
    return email ? `ask your administrator (${email})` : 'ask your administrator';
}

module.exports = { ASSISTANT_SETTINGS, askAdministrator };
