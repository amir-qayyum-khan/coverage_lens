/**
 * @jest-environment node
 */
const fs = require('fs');
const path = require('path');

describe('src/index.html Content-Security-Policy', () => {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    const meta = html.match(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/i);
    const directives = {};
    if (meta) {
        meta[1].split(';').map((d) => d.trim()).filter(Boolean).forEach((d) => {
            const [name, ...values] = d.split(/\s+/);
            directives[name] = values;
        });
    }

    it('has a CSP meta tag', () => {
        expect(meta).not.toBeNull();
    });

    it('allows the renderer to reach the local assistant server', () => {
        expect(directives['connect-src']).toEqual(
            expect.arrayContaining(["'self'", 'http://127.0.0.1:7071', 'http://localhost:7071'])
        );
    });
});
