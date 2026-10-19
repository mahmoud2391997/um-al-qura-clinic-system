// Gateway owns HTTPS/HSTS; these headers also protect direct application responses.
const development=process.env.NODE_ENV==='development';
export const securityHeaders=[
 {key:'X-Content-Type-Options',value:'nosniff'},
 {key:'X-Frame-Options',value:'DENY'},
 {key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},
 {key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=()'},
 {key:'Content-Security-Policy',value:`default-src 'self'; script-src 'self' 'unsafe-inline'${development?" 'unsafe-eval'":''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'${development?' ws: wss:':''}; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'`},
];
export default {devIndicators:false,poweredByHeader:false,async headers(){return [{source:'/:path*',headers:securityHeaders}]}};
